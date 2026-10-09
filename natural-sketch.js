/* Natural pencil paths, in physical millimetres. No printer or device access.
 * render(gray0to255, widthPixels, heightPixels, {width,height,gap,brush}, control)
 * CommonJS requires the shared natural-sketch-options.js; browsers load that
 * file first. Each accepted stroke deposits one fixed-width coverage union,
 * and must reduce the squared tone residual. No bitmap is added to the paths.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./natural-sketch-options.js'));
  else root.PenNaturalSketch = factory(root.PenNaturalOptions);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Options) {
  'use strict';
  if (!Options || typeof Options.normalize !== 'function')
    throw Error('请先加载 natural-sketch-options.js');

  const VERSION = '1.1.0';
  const TAU = Math.PI * 2;
  // A faint halo may be used only at a stroke's end. Pure white is always a
  // barrier, even with freedom enabled and even after working-image reduction.
  const CORE_GRAY = 250.5;
  const WHITE_GRAY = 254.5;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  function randomStream(seed) {
    let value = seed >>> 0;
    return function () {
      value = (value + 0x6d2b79f5) >>> 0;
      let t = Math.imul(value ^ (value >>> 15), 1 | value);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function positive(value, name, lo, hi) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi)
      throw Error(name + ' 必须为 ' + lo + '–' + hi + ' 的有限数字');
    return value;
  }
  function settingsFor(options, w, h) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw Error('素描设置无效');
    const width = positive(options.width === undefined ? 130 : options.width, '图案宽度(mm)', 1, 500);
    const height = positive(options.height === undefined ? width * h / w : options.height, '图案高度(mm)', 1, 500);
    const gap = positive(options.gap === undefined ? .8 : options.gap, '笔触间距参考(mm)', .05, Infinity);
    const inputBrush = options.brush === undefined ? {} : options.brush;
    if (!inputBrush || typeof inputBrush !== 'object' || Array.isArray(inputBrush))
      throw Error('素描笔刷参数无效');
    const values = { ...inputBrush };
    if (options.detail !== undefined) {
      // A new conversion detail replaces the saved brush's automatic budget.
      // Bare brush budgets without a saved detail remain explicit user limits.
      if (values.detail !== undefined && values.detail !== options.detail)
        for (const key of ['maxStrokes', 'maxPoints', 'budgetMs']) delete values[key];
      values.detail = options.detail;
    }
    const brush = Options.normalize(values, { detail: options.detail });
    return { width, height, gap, brush };
  }
  function sample(values, w, h, x, y) {
    x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
    const ix = Math.floor(x), iy = Math.floor(y), ux = x - ix, uy = y - iy;
    const jx = Math.min(w - 1, ix + 1), jy = Math.min(h - 1, iy + 1);
    return values[iy * w + ix] * (1 - ux) * (1 - uy)
      + values[iy * w + jx] * ux * (1 - uy)
      + values[jy * w + ix] * (1 - ux) * uy
      + values[jy * w + jx] * ux * uy;
  }
  // Float convolution throughout: no 8-bit intermediate channels or rounding.
  function blur(values, w, h, passes, checkpoint) {
    let current = values.slice();
    const horizontal = new Float32Array(w * h);
    const vertical = new Float32Array(w * h);
    const kernel = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let k = -2; k <= 2; k++) sum += current[y * w + clamp(x + k, 0, w - 1)] * kernel[k + 2];
          horizontal[y * w + x] = sum;
        }
        if ((y & 63) === 0 && checkpoint()) return null;
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let k = -2; k <= 2; k++) sum += horizontal[clamp(y + k, 0, h - 1) * w + x] * kernel[k + 2];
          vertical[y * w + x] = sum;
        }
        if ((y & 63) === 0 && checkpoint()) return null;
      }
      current = vertical.slice();
    }
    return current;
  }
  function nearestAngle(angle, reference) {
    while (angle - reference > Math.PI / 2) angle -= Math.PI;
    while (angle - reference < -Math.PI / 2) angle += Math.PI;
    return angle;
  }
  function lineDistance(point, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], den = dx * dx + dy * dy;
    const t = den ? clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / den, 0, 1) : 0;
    return Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dy * t);
  }

  function render(gray, sourceW, sourceH, options = {}, control = {}) {
    if (!Number.isInteger(sourceW) || !Number.isInteger(sourceH) || sourceW < 1 || sourceH < 1
        || sourceW > 1024 || sourceH > 1024 || !gray || gray.length !== sourceW * sourceH)
      throw Error('素描灰度图需为1–1024像素，数据长度必须匹配');
    if (!control || typeof control !== 'object') throw Error('素描执行控制无效');
    const settings = settingsFor(options, sourceW, sourceH), brush = settings.brush;
    const now = typeof control.now === 'function' ? control.now
      : (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? () => performance.now() : () => Date.now());
    const started = now();
    if (!Number.isFinite(started)) throw Error('素描时钟无效');
    const random = randomStream(brush.seed), paths = [];
    const stats = {
      algorithm: 'structure-guided-residual-hatching', version: VERSION,
      inputWidth: sourceW, inputHeight: sourceH, workWidth: 0, workHeight: 0,
      style: brush.style, strokeWidthMm: brush.strokeWidth, penDarkness: brush.penDarkness,
      workUnits: 0, workBudget: brush.workBudget, iterations: 0,
      acceptedStrokes: 0, strokeCount: 0, pointCount: 0,
      rejectedTone: 0, rejectedSupport: 0, rejectedShort: 0, rejectedOverdraw: 0,
      sourceSupportSamples: 0, rasterSamples: 0, simplificationFallbacks: 0,
      inkModel: 'per-stroke antialiased capsule union; fixed physical nib and alpha',
      lengthMm: 0, targetMeanDarkness: 0, drawnMeanDarkness: 0,
      initialRmse: 0, residualRmse: 0, fineResidualRmse: 0, positiveResidualRmse: 0,
      initialToneRmse: 0, residualToneRmse: 0, initialLossRmse: 0, residualLossRmse: 0,
      lossMode: brush.penDarkness >= .5 ? 'physical-block-mean+0.03-fine' : 'pixel-residual',
      fineLossWeight: brush.penDarkness >= .5 ? .03 : 1, toneScaleMm: 0,
      acceptedImprovement: 0, acceptedFineImprovement: 0, acceptedToneImprovement: 0,
      minimumImprovement: null,
      termination: null, complete: false, converged: false, cancelled: false, partial: true,
      elapsedMs: 0, sourceWhiteThreshold: WHITE_GRAY,
      sourceCoreThreshold: CORE_GRAY,
      simplificationToleranceMm: brush.style === 'loops'
        ? Math.min(.12, Math.max(.04, brush.strokeWidth * .25)) : Math.min(.04, brush.strokeWidth * .12),
      rasterSampleBudget: Math.min(80000000, brush.workBudget * 512),
      sourceSampleBudget: Math.min(240000000, brush.workBudget * 8192)
    };
    let target = null, ink = null, tone = null, w = 0, h = 0, positiveMass = 0;
    function checkedClock() {
      const clock = now();
      if (!Number.isFinite(clock)) throw Error('素描时钟无效');
      if (clock - started > brush.budgetMs) {
        // A CPU-dependent prefix is not a reproducible image conversion. The
        // caller receives an error, never a result to preview/cache as success.
        const error = Error('自然素描计算超过 ' + brush.budgetMs + ' ms 硬时限；未返回部分笔迹，请降低精细度后重试。');
        error.code = 'NATURAL_TIMEOUT';
        throw error;
      }
      return clock;
    }
    function checkpoint(progress) {
      checkedClock();
      if (stats.termination) return true;
      if (typeof control.shouldCancel === 'function' && control.shouldCancel()) {
        stats.termination = 'cancelled'; stats.cancelled = true; return true;
      }
      if (progress && typeof control.onProgress === 'function') control.onProgress({
        ...progress, workUnits: stats.workUnits, workBudget: stats.workBudget,
        strokes: paths.length, points: stats.pointCount
      });
      return false;
    }
    function finish() {
      if (!stats.termination) stats.termination = 'converged';
      if (target && ink) {
        let squared = 0, positiveSquared = 0, drawn = 0, source = 0, active = 0;
        for (let i = 0; i < target.length; i++) {
          const residual = target[i] - ink[i];
          squared += residual * residual; positiveSquared += Math.max(0, residual) ** 2;
          drawn += ink[i]; source += target[i]; if (target[i] > .007) active++;
        }
        stats.targetMeanDarkness = source / target.length;
        stats.drawnMeanDarkness = drawn / target.length;
        stats.residualRmse = Math.sqrt(squared / target.length);
        stats.fineResidualRmse = stats.residualRmse;
        stats.positiveResidualRmse = Math.sqrt(positiveSquared / Math.max(1, active));
        if (tone) {
          let toneSquared = 0;
          for (let i = 0; i < tone.counts.length; i++) {
            if (tone.counts[i] === 0) continue; // cancelled during tone-grid setup
            const residualSum = tone.targetSum[i] - tone.inkSum[i];
            toneSquared += residualSum * residualSum / tone.counts[i];
          }
          stats.residualToneRmse = Math.sqrt(toneSquared / target.length);
          stats.residualLossRmse = Math.sqrt((toneSquared + .03 * squared) / target.length);
        } else {
          stats.residualToneRmse = stats.residualRmse;
          stats.residualLossRmse = stats.residualRmse;
        }
      }
      // A sampler can run out of eligible support while some tone remains.
      // That is a partial result, not convergence of the actual drawing.
      if (stats.termination === 'converged' && (tone
        ? stats.residualToneRmse > .012001 : stats.positiveResidualRmse > .012001))
        stats.termination = 'support-exhausted';
      stats.complete = stats.termination === 'converged';
      stats.converged = stats.complete; stats.partial = !stats.complete;
      stats.strokeCount = stats.acceptedStrokes = paths.length;
      stats.elapsedMs = Math.max(0, checkedClock() - started);
      const warnings = ['笔宽与每笔浓度是纸笔行为的估计；此算法不控制压力或落笔高度。'];
      if (tone) warnings.push('当前深色笔以笔触疏密表现浅灰；细小纹理受实际笔宽影响。');
      if (!stats.complete) warnings.push(stats.termination==='strokes'&&brush.strokeLimit===brush.maxStrokes
        ? '已达到设定的 '+brush.strokeLimit+' 笔上限。'
        : '已按预算停止补笔；仍有未还原的明暗。');
      return { paths, brush, stats, settings, warnings, budget: {
        workUnits: stats.workUnits, workBudget: stats.workBudget,
        maxStrokes: brush.maxStrokes, maxPoints: brush.maxPoints, termination: stats.termination
      } };
    }
    if (checkpoint({ phase: 'prepare', fraction: 0 })) return finish();
    for (let i = 0; i < gray.length; i++) {
      if (typeof gray[i] !== 'number' || !Number.isFinite(gray[i]) || gray[i] < 0 || gray[i] > 255)
        throw Error('素描灰度值需为0–255的有限数字（0黑、255白）');
      if ((i & 65535) === 0 && checkpoint()) return finish();
    }
    const scale = Math.min(1, brush.maxSide / Math.max(sourceW, sourceH));
    w = Math.max(1, Math.round(sourceW * scale)); h = Math.max(1, Math.round(sourceH * scale));
    stats.workWidth = w; stats.workHeight = h;
    const mmX = settings.width / w, mmY = settings.height / h, cell = Math.min(mmX, mmY);
    const sourceX = sourceW / settings.width, sourceY = sourceH / settings.height;
    const raw = new Float32Array(w * h), rawGray = new Float32Array(w * h);
    const seedSupport = new Uint8Array(w * h);
    let rawMass = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const value = sample(gray, sourceW, sourceH, (x + .5) * sourceW / w - .5, (y + .5) * sourceH / h - .5);
        const nearestX = clamp(Math.floor((x + .5) * sourceW / w), 0, sourceW - 1);
        const nearestY = clamp(Math.floor((y + .5) * sourceH / h), 0, sourceH - 1);
        seedSupport[i] = gray[nearestY * sourceW + nearestX] <= CORE_GRAY ? 1 : 0;
        rawGray[i] = value; raw[i] = value > CORE_GRAY || !seedSupport[i] ? 0 : (255 - value) / 255;
        rawMass += raw[i];
      }
      if ((y & 63) === 0 && checkpoint()) return finish();
    }
    if (rawMass === 0) { target = new Float32Array(w * h); ink = new Float32Array(w * h); return finish(); }
    const smooth = blur(raw, w, h, 1, checkpoint);
    if (!smooth) return finish();
    target = new Float32Array(w * h); ink = new Float32Array(w * h);
    let mean = 0, adjustedSum = 0;
    for (let i = 0; i < smooth.length; i++) {
      if (rawGray[i] <= CORE_GRAY && seedSupport[i]) { mean += smooth[i]; adjustedSum += Math.pow(smooth[i], brush.contrast); }
    }
    const contrastGain = adjustedSum > 1e-12 ? mean / adjustedSum : 1;
    let initialSquared = 0;
    for (let i = 0; i < target.length; i++) {
      target[i] = rawGray[i] > CORE_GRAY || !seedSupport[i] ? 0 : clamp(Math.pow(smooth[i], brush.contrast) * contrastGain * brush.density, 0, .985);
      initialSquared += target[i] * target[i];
    }
    stats.initialRmse = Math.sqrt(initialSquared / target.length);
    stats.initialToneRmse = stats.initialLossRmse = stats.initialRmse;
    if (brush.penDarkness >= .5) {
      // Black ink reproduces light gray by distributing real dark strokes over
      // an area. Pixel L2 alone would reject every opaque mark on a light patch.
      // This loss averages at a physical nib-related scale without changing the
      // nib, alpha, source support, or deposited ink.
      const edge = Math.max(2 * mmX, 2 * mmY, 2.5 * brush.strokeWidth);
      const cellX = Math.min(w, Math.max(1, Math.ceil(edge / mmX)));
      const cellY = Math.min(h, Math.max(1, Math.ceil(edge / mmY)));
      const cols = Math.ceil(w / cellX), rows = Math.ceil(h / cellY), count = cols * rows;
      tone = {
        cellX, cellY, cols,
        counts: new Uint32Array(count), index: new Uint32Array(w * h),
        targetSum: new Float64Array(count), inkSum: new Float64Array(count),
        delta: new Float64Array(count), stamp: new Int32Array(count), squared: 0
      };
      stats.toneScaleMm = Math.max(cellX * mmX, cellY * mmY);
      stats.toneScaleMmXY = [cellX * mmX, cellY * mmY];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x, cellIndex = Math.floor(y / cellY) * cols + Math.floor(x / cellX);
          tone.index[i] = cellIndex; tone.counts[cellIndex]++; tone.targetSum[cellIndex] += target[i];
        }
        if ((y & 63) === 0 && checkpoint()) return finish();
      }
      for (let i = 0; i < count; i++) tone.squared += tone.targetSum[i] ** 2 / tone.counts[i];
      stats.initialToneRmse = Math.sqrt(tone.squared / target.length);
      stats.initialLossRmse = Math.sqrt((tone.squared + .03 * initialSquared) / target.length);
    }
    const xx = new Float32Array(w * h), yy = new Float32Array(w * h), xy = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const gx = (smooth[y * w + Math.min(w - 1, x + 1)] - smooth[y * w + Math.max(0, x - 1)]) / (2 * mmX);
        const gy = (smooth[Math.min(h - 1, y + 1) * w + x] - smooth[Math.max(0, y - 1) * w + x]) / (2 * mmY);
        xx[i] = gx * gx; yy[i] = gy * gy; xy[i] = gx * gy;
      }
      if ((y & 63) === 0 && checkpoint()) return finish();
    }
    const jxx = blur(xx, w, h, 2, checkpoint); if (!jxx) return finish();
    const jyy = blur(yy, w, h, 2, checkpoint); if (!jyy) return finish();
    const jxy = blur(xy, w, h, 2, checkpoint); if (!jxy) return finish();
    const fieldX = new Float32Array(w * h), fieldY = new Float32Array(w * h);
    const fallbackAngle = Math.PI * .29, fallbackX = Math.cos(2 * fallbackAngle), fallbackY = Math.sin(2 * fallbackAngle);
    let reliabilitySum = 0;
    for (let i = 0; i < fieldX.length; i++) {
      const energy = jxx[i] + jyy[i], anisotropy = Math.hypot(jxx[i] - jyy[i], 2 * jxy[i]);
      const reliability = clamp(anisotropy / (energy + 1e-12), 0, 1) * energy / (energy + .0025);
      reliabilitySum += reliability;
      fieldX[i] = reliability * (jyy[i] - jxx[i]) / (anisotropy + 1e-12) + (1 - reliability) * fallbackX;
      fieldY[i] = -reliability * 2 * jxy[i] / (anisotropy + 1e-12) + (1 - reliability) * fallbackY;
    }
    stats.meanStructureReliability = reliabilitySum / fieldX.length;
    const phaseX = random() * TAU, phaseY = random() * TAU;
    function fieldAngle(x, y, reference) {
      const px = x / mmX - .5, py = y / mmY - .5;
      const fx = sample(fieldX, w, h, px, py), fy = sample(fieldY, w, h, px, py);
      let angle = fx * fx + fy * fy < .0025 ? fallbackAngle : Math.atan2(fy, fx) / 2;
      angle += brush.randomness * .075 * (Math.sin(x / 13 + phaseX) + Math.sin(y / 17 + phaseY));
      return reference === undefined ? angle : nearestAngle(angle, reference);
    }
    const haloAllowance = brush.freedom * Math.min(.4, brush.strokeWidth * 1.5);
    function inside(x, y) { return x >= 0 && x <= settings.width && y >= 0 && y <= settings.height; }
    function sourceClass(x, y) {
      if (!inside(x, y)) return 2;
      const sx = clamp(Math.floor(x * sourceX), 0, sourceW - 1);
      const sy = clamp(Math.floor(y * sourceY), 0, sourceH - 1);
      const value = gray[sy * sourceW + sx];
      stats.sourceSupportSamples++;
      if (stats.sourceSupportSamples > stats.sourceSampleBudget) {
        stats.termination = 'support-budget'; return 2;
      }
      if ((stats.sourceSupportSamples & 32767) === 0 && checkpoint()) return 2;
      return value >= WHITE_GRAY ? 2 : (value > CORE_GRAY ? 1 : 0);
    }
    // Scan the full original, not the blurred/downsampled support. L-infinity
    // distance between samples is <=.5 source pixel, including the end points.
    function scanSegment(a, b, visit) {
      const count = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]) * sourceX, Math.abs(b[1] - a[1]) * sourceY) * 2));
      for (let k = 0; k <= count; k++) {
        const t = k / count, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        if (!visit(sourceClass(x, y), t)) return false;
      }
      return true;
    }
    function coreSegment(a, b) { return scanSegment(a, b, kind => kind === 0); }
    function noWhiteSegment(a, b) { return scanSegment(a, b, kind => kind !== 2); }
    function supportPath(path) {
      let total = 0;
      for (let i = 1; i < path.length; i++) total += distance(path[i - 1], path[i]);
      let offset = 0, state = 0, firstCore = null, lastCore = null;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], span = distance(a, b);
        if (!scanSegment(a, b, (kind, t) => {
          const at = offset + t * span;
          if (kind === 2) return false;
          if (kind === 0) {
            if (state === 2) return false; // a halo cannot reconnect two ink regions
            if (firstCore === null) firstCore = at;
            lastCore = at; state = 1;
          } else if (state === 1) state = 2;
          return true;
        })) return false;
        offset += span;
      }
      return firstCore !== null && firstCore <= haloAllowance + 1e-9 && total - lastCore <= haloAllowance + 1e-9;
    }
    function simplify(path) {
      if (path.length < 3) return path;
      const keep = new Uint8Array(path.length); keep[0] = keep[path.length - 1] = 1;
      const stack = [[0, path.length - 1]], tolerance = stats.simplificationToleranceMm;
      while (stack.length) {
        const pair = stack.pop(), first = pair[0], last = pair[1];
        if (last - first < 2) continue;
        let error = -1, at = first + 1;
        for (let i = first + 1; i < last; i++) {
          const d = lineDistance(path[i], path[first], path[last]);
          if (d > error) { error = d; at = i; }
        }
        if (error > tolerance || !noWhiteSegment(path[first], path[last])) {
          keep[at] = 1; stack.push([first, at], [at, last]);
        }
      }
      const result = path.filter((point, i) => keep[i]);
      if (!supportPath(result)) { stats.simplificationFallbacks++; return path; }
      return result;
    }
    const step = Math.min(.35, Math.max(.10, brush.strokeWidth * .8));
    const baseLength = clamp(settings.gap * 8, 4.5, 10);
    function traceLeg(seed, initial, length, bend) {
      const out = [seed], rate = .06 + .34 * brush.curvature;
      let x = seed[0], y = seed[1], angle = initial, travelled = 0, halo = false, haloLength = 0;
      const maximumSteps = Math.min(240, Math.ceil(length / step));
      for (let k = 0; k < maximumSteps; k++) {
        const ds = Math.min(step, length - travelled);
        if (ds <= 1e-9) break;
        const local = fieldAngle(x + Math.cos(angle) * ds / 2, y + Math.sin(angle) * ds / 2, angle);
        const desired = initial + (nearestAngle(local, initial) - initial) * (.10 + .90 * brush.curvature)
          + bend * (travelled + ds / 2) / Math.max(length, step);
        const nextAngle = angle + clamp(desired - angle, -rate * ds, rate * ds);
        const direction = (angle + nextAngle) / 2;
        const next = [x + Math.cos(direction) * ds, y + Math.sin(direction) * ds];
        if (!inside(next[0], next[1])) break;
        let nextHalo = halo, enteredAt = null;
        const valid = scanSegment([x, y], next, (kind, t) => {
          if (kind === 2 || (kind === 1 && haloAllowance === 0)) return false;
          if (kind === 1) { if (!nextHalo) enteredAt = t; nextHalo = true; }
          if (kind === 0 && nextHalo) return false;
          return true;
        });
        if (!valid) break;
        const addition = nextHalo ? ds * (enteredAt === null ? 1 : 1 - enteredAt) : 0;
        if (haloLength + addition > haloAllowance + 1e-9) break;
        halo = nextHalo; haloLength += addition;
        out.push(next); x = next[0]; y = next[1]; angle = nextAngle; travelled += ds;
      }
      return out;
    }
    function flowPath(seed, tone) {
      const initial = fieldAngle(seed[0], seed[1]) + (random() - .5) * .55 * brush.randomness;
      const length = baseLength * brush.length * (.82 + tone * .45) * Math.max(.05, 1 + (random() - .5) * .4 * brush.randomness);
      const bend = (random() - .5) * .6 * brush.curvature;
      const backwards = traceLeg(seed, initial + Math.PI, length / 2, -bend);
      const forwards = traceLeg(seed, initial, length / 2, bend);
      return backwards.reverse().concat(forwards.slice(1));
    }
    function loopsPath(seed, tone) {
      let angle = fieldAngle(seed[0], seed[1]) + (random() - .5) * .3 * brush.randomness;
      // Larger, slowly drifting loops carry more tone per retained vertex than
      // tiny beads. Original support still clips every arc at a white boundary.
      const radius = (2.0 + 2.4 * (1 - tone)) * (.8 + .4 * brush.curvature)
        * Math.max(.05, 1 + (random() - .5) * .18 * brush.randomness);
      const ellipticity = .5 + .5 * brush.curvature;
      const phase = random() * TAU, direction = random() > .5 ? 1 : -1;
      let centerX = seed[0] - radius * (Math.cos(phase) * Math.cos(angle) - Math.sin(phase) * Math.sin(angle) * ellipticity);
      let centerY = seed[1] - radius * (Math.cos(phase) * Math.sin(angle) + Math.sin(phase) * Math.cos(angle) * ellipticity);
      const cycles = 1.05 + brush.length * .8;
      const angleStep = clamp(.22 * Math.sqrt(brush.strokeWidth / .2) / Math.sqrt(radius / .9), .12, .28);
      const count = Math.min(170, Math.ceil(TAU * cycles / angleStep));
      const drift = radius * (.12 + .05 * (1 - tone));
      const path = [seed];
      let halo = false, haloLength = 0;
      for (let k = 1; k <= count; k++) {
        const advance = drift * angleStep;
        const desired = fieldAngle(centerX, centerY, angle);
        angle += clamp((desired - angle) * (.15 + .85 * brush.curvature), -.025, .025);
        centerX += Math.cos(angle) * advance; centerY += Math.sin(angle) * advance;
        const turn = phase + direction * k * angleStep;
        const breathe = 1 + .08 * brush.randomness * Math.sin(k / count * Math.PI);
        const c = Math.cos(turn) * radius * breathe, s = Math.sin(turn) * radius * ellipticity * breathe;
        const next = [centerX + c * Math.cos(angle) - s * Math.sin(angle), centerY + c * Math.sin(angle) + s * Math.cos(angle)];
        if (!inside(next[0], next[1])) break;
        // A halo may finish a loop, but it can never lead back into another
        // dark region. In particular even freedom=1 cannot traverse pure white.
        const previous = path[path.length - 1], span = distance(previous, next);
        let nextHalo = halo, enteredAt = null;
        if (!scanSegment(previous, next, (kind, t) => {
          if (kind === 2 || (kind === 1 && haloAllowance === 0)) return false;
          if (kind === 1) { if (!nextHalo) enteredAt = t; nextHalo = true; }
          if (kind === 0 && nextHalo) return false;
          return true;
        })) break;
        const addition = nextHalo ? span * (enteredAt === null ? 1 : 1 - enteredAt) : 0;
        if (haloLength + addition > haloAllowance + 1e-9) break;
        halo = nextHalo; haloLength += addition;
        path.push(next);
      }
      return path;
    }

    // Exact per-tile residual sums and a Fenwick tree avoid repeatedly scanning
    // the image. Updating the drawing updates the seed distribution as well.
    const tileSize = 16, tilesX = Math.ceil(w / tileSize), tilesY = Math.ceil(h / tileSize), tileCount = tilesX * tilesY;
    const tree = new Float64Array(tileCount + 1), weights = new Float64Array(tileCount);
    const pixelWeight = new Float32Array(w * h), pixelTile = new Uint16Array(w * h);
    function treeAdd(tile, delta) { for (let i = tile + 1; i <= tileCount; i += i & -i) tree[i] += delta; }
    function weightAt(i) {
      let residual;
      if (tone) {
        const cellIndex = tone.index[i];
        residual = Math.max(0, (tone.targetSum[cellIndex] - tone.inkSum[cellIndex]) / tone.counts[cellIndex]);
      } else residual = Math.max(0, target[i] - ink[i]);
      return target[i] > .007 && rawGray[i] <= CORE_GRAY && seedSupport[i] ? residual * residual : 0;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, tile = Math.floor(y / tileSize) * tilesX + Math.floor(x / tileSize);
      pixelTile[i] = tile; pixelWeight[i] = weightAt(i); weights[tile] += pixelWeight[i];
    }
    for (let i = 0; i < tileCount; i++) { treeAdd(i, weights[i]); positiveMass += weights[i]; }
    const activePixels = target.reduce((sum, value) => sum + (value > .007 ? 1 : 0), 0);
    function seedPoint() {
      if (!(positiveMass > 1e-12)) return null;
      let value = random() * positiveMass, index = 0, bit = 1;
      while (bit * 2 <= tileCount) bit *= 2;
      for (; bit; bit >>= 1) {
        const next = index + bit;
        if (next <= tileCount && tree[next] < value) { index = next; value -= tree[next]; }
      }
      const tile = Math.min(tileCount - 1, index), tx = (tile % tilesX) * tileSize, ty = Math.floor(tile / tilesX) * tileSize;
      let pick = random() * Math.max(0, weights[tile]), chosen = -1;
      for (let y = ty; y < Math.min(h, ty + tileSize); y++) {
        for (let x = tx; x < Math.min(w, tx + tileSize); x++) {
          const i = y * w + x;
          if (pixelWeight[i] > 0) { pick -= pixelWeight[i]; chosen = i; if (pick <= 0) break; }
        }
        if (pick <= 0 && chosen >= 0) break;
      }
      if (chosen < 0) return null;
      const x = chosen % w, y = Math.floor(chosen / w);
      const point = [(x + .5 + (random() - .5) * .8) * mmX, (y + .5 + (random() - .5) * .8) * mmY];
      return { point, tone: target[chosen], index: chosen };
    }
    const coverage = new Float32Array(w * h), stamps = new Int32Array(w * h);
    const tileDelta = new Float64Array(tileCount), tileStamp = new Int32Array(tileCount);
    let stamp = 0;
    const radius = brush.strokeWidth / 2, softness = Math.min(mmX, mmY) * .45;
    function raster(path) {
      stamp++;
      const touched = [], padding = radius + softness;
      for (let s = 1; s < path.length; s++) {
        const a = path[s - 1], b = path[s], dx = b[0] - a[0], dy = b[1] - a[1], den = dx * dx + dy * dy;
        const minX = clamp(Math.floor((Math.min(a[0], b[0]) - padding) / mmX - .5), 0, w - 1);
        const maxX = clamp(Math.ceil((Math.max(a[0], b[0]) + padding) / mmX - .5), 0, w - 1);
        const minY = clamp(Math.floor((Math.min(a[1], b[1]) - padding) / mmY - .5), 0, h - 1);
        const maxY = clamp(Math.ceil((Math.max(a[1], b[1]) + padding) / mmY - .5), 0, h - 1);
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
          const px = (x + .5) * mmX, py = (y + .5) * mmY;
          const t = den ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / den, 0, 1) : 0;
          const d = Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
          // Difference of two edge ramps preserves a subpixel nib's width.
          // One ramp alone would make a .1 mm nib too dark on a coarse grid.
          const c = clamp((radius + softness - d) / (2 * softness), 0, 1)
            - clamp((-radius + softness - d) / (2 * softness), 0, 1);
          stats.rasterSamples++;
          if (stats.rasterSamples > stats.rasterSampleBudget) { stats.termination = 'coverage-budget'; return null; }
          if ((stats.rasterSamples & 16383) === 0 && checkpoint()) return null;
          if (c <= 0) continue;
          const i = y * w + x;
          if (stamps[i] !== stamp) { stamps[i] = stamp; coverage[i] = c; touched.push(i); }
          else if (c > coverage[i]) coverage[i] = c; // union, never segment-by-segment deposition
        }
      }
      let fineImprovement = 0, toneImprovement = 0, newCoverage = 0, repeatedCoverage = 0;
      const toneTouched = [];
      for (const i of touched) {
        const oldResidual = target[i] - ink[i];
        newCoverage += coverage[i] * (1 - ink[i]);
        repeatedCoverage += coverage[i] * ink[i];
        let deposited = (1 - ink[i]) * coverage[i] * brush.penDarkness;
        if (tone) deposited = Math.fround(ink[i] + deposited) - ink[i];
        fineImprovement += oldResidual * oldResidual - (oldResidual - deposited) ** 2;
        if (tone) {
          const cellIndex = tone.index[i];
          if (tone.stamp[cellIndex] !== stamp) {
            tone.stamp[cellIndex] = stamp; tone.delta[cellIndex] = deposited; toneTouched.push(cellIndex);
          } else tone.delta[cellIndex] += deposited;
        }
      }
      if (tone) for (const cellIndex of toneTouched) {
        const residualSum = tone.targetSum[cellIndex] - tone.inkSum[cellIndex];
        toneImprovement += (residualSum * residualSum - (residualSum - tone.delta[cellIndex]) ** 2) / tone.counts[cellIndex];
      }
      else toneImprovement = fineImprovement;
      // With opaque ink, revisiting black pixels adds almost no useful tone.
      // Prefer new coverage; do not spend strokes repainting antialiased edges.
      const redundant=brush.penDarkness===1&&newCoverage<.12*(newCoverage+repeatedCoverage);
      if(redundant)stats.rejectedOverdraw++;
      const improvement = redundant ? -1 : (tone ? toneImprovement + .03 * fineImprovement : fineImprovement) - (brush.penDarkness===1?.025*repeatedCoverage:0);
      return { touched, toneTouched, improvement, fineImprovement, toneImprovement };
    }
    function apply(candidate) {
      const changedTiles = [];
      function reweight(i) {
        const oldWeight = pixelWeight[i], newWeight = weightAt(i), delta = newWeight - oldWeight;
        pixelWeight[i] = newWeight;
        const tile = pixelTile[i];
        if (tileStamp[tile] !== stamp) { tileStamp[tile] = stamp; tileDelta[tile] = delta; changedTiles.push(tile); }
        else tileDelta[tile] += delta;
      }
      for (const i of candidate.touched) ink[i] += (1 - ink[i]) * coverage[i] * brush.penDarkness;
      if (tone) {
        for (const cellIndex of candidate.toneTouched) tone.inkSum[cellIndex] += tone.delta[cellIndex];
        tone.squared = Math.max(0, tone.squared - candidate.toneImprovement);
        // The score and sampler use the same remaining block tone. A black
        // stroke's uncovered fine pixels are not a request to blacken the block.
        for (const cellIndex of candidate.toneTouched) {
          const startX = cellIndex % tone.cols * tone.cellX;
          const startY = Math.floor(cellIndex / tone.cols) * tone.cellY;
          for (let y = startY; y < Math.min(h, startY + tone.cellY); y++)
            for (let x = startX; x < Math.min(w, startX + tone.cellX); x++) reweight(y * w + x);
        }
      } else for (const i of candidate.touched) reweight(i);
      for (const tile of changedTiles) {
        weights[tile] = Math.max(0, weights[tile] + tileDelta[tile]);
        treeAdd(tile, tileDelta[tile]); positiveMass = Math.max(0, positiveMass + tileDelta[tile]);
      }
    }
    if (checkpoint({ phase: 'draw', fraction: 0 })) return finish();
    let stalled = 0;
    const minLength = Math.max(.45, brush.strokeWidth * 1.25);
    for (let attempt = 0; attempt < brush.workBudget; attempt++) {
      stats.workUnits = stats.iterations = attempt + 1;
      if ((attempt & 127) === 0 && checkpoint({ phase: 'draw', fraction: attempt / brush.workBudget })) break;
      if (paths.length >= brush.maxStrokes) { stats.termination = 'strokes'; break; }
      if (stats.pointCount >= brush.maxPoints) { stats.termination = 'points'; break; }
      if (tone ? tone.squared / Math.max(1, activePixels) < .000144
        : positiveMass / Math.max(1, activePixels) < .000144) { stats.termination = 'converged'; break; }
      const seed = seedPoint();
      if (!seed) { stats.termination = 'converged'; break; }
      if (sourceClass(seed.point[0], seed.point[1]) !== 0) {
        stats.rejectedSupport++; stalled++;
        // This reduced-image seed lies over a full-resolution white barrier.
        // Remove it from the sampler without changing the actual drawn tone.
        const value = pixelWeight[seed.index], tile = pixelTile[seed.index];
        pixelWeight[seed.index] = 0; weights[tile] -= value; treeAdd(tile, -value); positiveMass = Math.max(0, positiveMass - value);
        continue;
      }
      let path = brush.style === 'loops' ? loopsPath(seed.point, seed.tone) : flowPath(seed.point, seed.tone);
      if (stats.termination) break;
      let length = 0;
      for (let i = 1; i < path.length; i++) length += distance(path[i - 1], path[i]);
      if (path.length < 2 || length < minLength) { stats.rejectedShort++; stalled++; continue; }
      if (!supportPath(path)) { stats.rejectedSupport++; stalled++; continue; }
      path = simplify(path);
      if (stats.termination) break;
      if (!supportPath(path)) { stats.rejectedSupport++; stalled++; continue; }
      if (stats.pointCount + path.length > brush.maxPoints) { stats.termination = 'points'; break; }
      const candidate = raster(path);
      if (!candidate) break;
      if (candidate.improvement > 1e-8) {
        apply(candidate); paths.push(path); stats.pointCount += path.length;
        let emittedLength = 0;
        for (let i = 1; i < path.length; i++) emittedLength += distance(path[i - 1], path[i]);
        stats.lengthMm += emittedLength; stats.acceptedImprovement += candidate.improvement;
        stats.acceptedFineImprovement += candidate.fineImprovement;
        stats.acceptedToneImprovement += candidate.toneImprovement;
        stats.minimumImprovement = stats.minimumImprovement === null ? candidate.improvement : Math.min(stats.minimumImprovement, candidate.improvement);
        stalled = 0;
      } else { stats.rejectedTone++; stalled++; }
      // Many no-gain candidates indicate that this fixed physical pen cannot
      // improve the remaining tones. Report partial rather than false success.
      if (stalled >= 1800) { stats.termination = 'stalled'; break; }
    }
    if (!stats.termination) stats.termination = 'work-budget';
    checkpoint({ phase: 'done', fraction: 1 });
    return finish();
  }
  return Object.freeze({ VERSION, render });
});
