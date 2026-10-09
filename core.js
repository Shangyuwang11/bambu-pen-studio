/* Geometry and path planning. All coordinates here are design coordinates, in mm.
   No machine G-code, networking, or machine-coordinate calibration is performed. */
(function (root) {
  'use strict';
  const finite = Number.isFinite;
  const pathTools=root.PenPaths||(typeof require==='function'?require('./path-tools.js'):null);
  const speedPolicy=root.PenSpeedPolicy||(typeof require==='function'?require('./speed-policy.js'):null);
  function naturalDetail(v){if(v===undefined)return 640;if(!Number.isSafeInteger(v)||v<1)throw Error('自然素描精细度需为正整数');return v;}
  function naturalBrush(v,detail){const policy=root.PenNaturalOptions||(typeof require==='function'?require('./natural-sketch-options.js'):null);if(!policy)throw Error('自然素描参数模块未加载');const b=policy.normalize(v??{},detail===undefined?{}:{detail});if(detail!==undefined&&b.detail!==detail)throw Error('自然素描的精细度与笔刷记录不一致');return b;}
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const round = n => Math.round(n * 1000) / 1000;
  const uid = () => 'o' + Math.random().toString(36).slice(2, 11);
  const profiles = Object.freeze({
    'a1-mini': { name: 'Bambu Lab A1 mini', w: 180, h: 180 },
    a1: { name: 'Bambu Lab A1', w: 256, h: 256 },
    p1s: { name: 'Bambu Lab P1S', w: 256, h: 256 },
    custom: { name: '自定义画板', w: 180, h: 180 }
  });
  const defaultMachine = () => ({ model: 'a1-mini', w: 180, h: 180, plate: 'smooth' });
  const board = state => ({ x: 0, y: 0, w: state.machine?.w || 180, h: state.machine?.h || 180 });
  const circle = (cx, cy, r, n = 32) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(i / n * Math.PI * 2), cy + r * Math.sin(i / n * Math.PI * 2)]);
  function bounds(paths) {
    let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
    for (const path of paths) for (const p of path) { x = Math.min(x, p[0]); y = Math.min(y, p[1]); r = Math.max(r, p[0]); b = Math.max(b, p[1]); }
    return finite(x) ? { x, y, w: r - x, h: b - y } : { x: 0, y: 0, w: 0, h: 0 };
  }
  function normalize(paths) {
    const b = bounds(paths), padding = Math.max(b.w, b.h, .001) * .01;
    const w = Math.max(b.w, padding), h = Math.max(b.h, padding);
    return { paths: paths.map(p => p.map(([x, y]) => [(x - b.x) / w, (y - b.y) / h])), ratio: w / h };
  }
  const punctuation = {
    '，': [[[.3, .72], [.27, .84], [.2, .9]]], '、': [[[.25, .65], [.4, .8]]],
    '。': [circle(.27, .79, .075, 12)], '：': [circle(.25, .35, .025, 6), circle(.25, .75, .025, 6)],
    '；': [circle(.25, .35, .025, 6), [[.27, .72], [.23, .84], [.17, .9]]],
    '“': [[[.42, .12], [.3, .2], [.3, .31]], [[.66, .12], [.54, .2], [.54, .31]]],
    '”': [[[.3, .12], [.3, .23], [.18, .31]], [[.54, .12], [.54, .23], [.42, .31]]],
    '‘': [[[.42, .12], [.3, .2], [.3, .31]]], '’': [[[.3, .12], [.3, .23], [.18, .31]]],
    '—': [[[0, .5], [1, .5]]], '…': [circle(.2, .75, .018, 6), circle(.5, .75, .018, 6), circle(.8, .75, .018, 6)],
    '·': [circle(.5, .5, .025, 6)], '《': [[[.43, .2], [.18, .5], [.43, .8]], [[.7, .2], [.45, .5], [.7, .8]]],
    '》': [[[.3, .2], [.55, .5], [.3, .8]], [[.57, .2], [.82, .5], [.57, .8]]]
  };
  const glyphCache = new Map();
  function glyph(char, style = 'simple') {
    const key = style + char;
    if (glyphCache.has(key)) return glyphCache.get(key);
    let result;
    if (/\s/u.test(char)) result = { paths: [], advance: char === '　' ? 1 : .45 };
    else if (root.PEN_FONTS?.hanzi?.[char]) result = { paths: root.PEN_FONTS.hanzi[char].map(p => p.map(([x, y]) => [x / 1024, (900 - y) / 1024])), advance: 1 };
    else if (punctuation[char]) result = { paths: punctuation[char], advance: 1 };
    else {
      const code = char.codePointAt(0), latin = code >= 0xff01 && code <= 0xff5e ? String.fromCodePoint(code - 0xfee0) : char;
      const data = root.PEN_FONTS?.[style]?.[latin];
      if (data) result = { paths: data.p, advance: code >= 0xff01 && code <= 0xff5e ? 1 : data.a };
    }
    if (result) glyphCache.set(key, result);
    return result;
  }
  function textGeometry(obj) {
    const lines = [[]]; let advance = 0; const missing = new Set();
    const max = obj.wrap / obj.size;
    for (const ch of obj.text.replace(/\r/g, '')) {
      if (ch === '\n') { lines.push([]); advance = 0; continue; }
      const g = glyph(ch, obj.font);
      if (!g) missing.add(ch);
      const item = { char: ch, glyph: g, advance: (g?.advance || 1) + obj.spacing / obj.size };
      if (advance + item.advance - obj.spacing / obj.size > max + 1e-7 && lines.at(-1).length) { lines.push([]); advance = 0; }
      lines.at(-1).push(item); advance += item.advance;
    }
    const paths = [], placeholders = [];
    const width = Math.max(obj.size * .3, ...lines.map(l => Math.max(0, l.reduce((a, v) => a + v.advance, 0) * obj.size - obj.spacing)));
    lines.forEach((line, i) => {
      const lw = Math.max(0, line.reduce((a, v) => a + v.advance, 0) * obj.size - obj.spacing);
      let x = obj.align === 'center' ? (width - lw) / 2 : obj.align === 'right' ? width - lw : 0;
      for (const item of line) {
        if (item.glyph) {
          for (const path of item.glyph.paths) if (path.length >= 2) paths.push(path.map(([px, py]) => [x + px * obj.size, i * obj.size * obj.leading + py * obj.size]));
        }
        if (!item.glyph) placeholders.push({ x, y: i * obj.size * obj.leading, char: item.char });
        x += item.advance * obj.size;
      }
    });
    return { paths, w: width, h: Math.max(obj.size, (lines.length - 1) * obj.size * obj.leading + obj.size), missing: [...missing], placeholders };
  }
  function drawingPaths(obj){return obj.frame?(root.PenFrames||(typeof require==='function'?require('./frames.js'):null)).paths(obj.w,obj.h,obj.frame):obj.paths;}
  function geometry(obj, options={}) {
    if (obj.type === 'text') return textGeometry(obj);
    return { paths: options.paths===false?[]:drawingPaths(obj).map(p => p.map(([x, y]) => [x * obj.w, y * obj.h])), w: obj.w, h: obj.h, missing: [], placeholders: [] };
  }
  function transformPoint(p, obj, g, paper = { x: 0, y: 0 }, scaleX=1, scaleY=1) {
    const rad = obj.rotation * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    const x = p[0]*scaleX - g.w / 2, y = p[1]*scaleY - g.h / 2;
    return [paper.x + obj.x + g.w / 2 + x * c - y * s, paper.y + obj.y + g.h / 2 + x * s + y * c];
  }
  function objectPaths(obj, paper) { const g = geometry(obj); return g.paths.map(p => p.map(v => transformPoint(v, obj, g, paper))); }
  function contains(p, rect, radius = 0) { return p[0] - radius >= rect.x - 1e-6 && p[1] - radius >= rect.y - 1e-6 && p[0] + radius <= rect.x + rect.w + 1e-6 && p[1] + radius <= rect.y + rect.h + 1e-6; }
  function intersectRects(rects, radius=0) {
    const x=Math.max(...rects.map(r=>r.x))+radius,y=Math.max(...rects.map(r=>r.y))+radius;
    return {x,y,w:Math.max(0,Math.min(...rects.map(r=>r.x+r.w))-radius-x),h:Math.max(0,Math.min(...rects.map(r=>r.y+r.h))-radius-y)};
  }
  // Segment clipping, not vertex clamping: crossings gain real intersections;
  // every excursion outside the rectangle ends the current pen-down stroke.
  function clipPolyline(points,rect) {
    if(rect.w<=0||rect.h<=0)return [];
    const out=[];let stroke=null;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1];let enter=0,leave=1,ok=true;
      for(const [p,q]of [[-dx,a[0]-rect.x],[dx,rect.x+rect.w-a[0]],[-dy,a[1]-rect.y],[dy,rect.y+rect.h-a[1]]]){
        if(p===0){if(q<0){ok=false;break;}continue;}
        const t=q/p;if(p<0)enter=Math.max(enter,t);else leave=Math.min(leave,t);if(enter>leave){ok=false;break;}
      }
      if(!ok){stroke=null;continue;}
      if(dx===0&&dy===0)continue;
      if(leave-enter<=1e-12){stroke=null;continue;}
      const at=t=>[clamp(a[0]+dx*t,rect.x,rect.x+rect.w),clamp(a[1]+dy*t,rect.y,rect.y+rect.h)];
      const first=enter===0?a:at(enter),last=leave===1?b:at(leave);
      if(!stroke||enter>0||distance(stroke.at(-1),first)>1e-9){stroke=[first];out.push(stroke);}
      stroke.push(last);if(leave<1)stroke=null;
    }
    return out;
  }
  function plan(state, options={}) {
    const { paper, pen, safe } = state, margin = paper.margin;
    const bed = board(state);
    const printable = { x: paper.x + margin, y: paper.y + margin, w: paper.w - margin * 2, h: paper.h - margin * 2 };
    const errors = [], badIds = new Set(), rawPaths = [], missing = new Set(),clippedIds=new Set();
    const clipRect=intersectRects([printable,safe,bed,...(options.clipRect?[options.clipRect]:[])],pen.width/2);
    if (printable.w <= 0 || printable.h <= 0) errors.push('纸内留白过大，没有可写空间');
    if (safe.w <= 0 || safe.h <= 0) errors.push('可写区域边界顺序不正确');
    if (!contains([safe.x, safe.y], bed) || !contains([safe.x + safe.w, safe.y + safe.h], bed)) errors.push('设计可写区超出所选画板');
    if (!contains([paper.x, paper.y], bed) || !contains([paper.x + paper.w, paper.y + paper.h], bed)) errors.push('纸张悬出打印板：需检查移动热床干涉，当前禁止导出路径');
    let totalPoints = 0, outputPoints=0, complexityExceeded = false;
    for (const obj of state.objects) {
      if (obj.type === 'image' && traceStale(obj)) { errors.push('图案“' + obj.name + '”的路径待自动更新'); badIds.add(obj.id); }
      const render={width:pen.width,opacity:1};const preserveStrokes=obj.preserveStrokes===true||obj.type==='image'&&['natural','scan-hatch'].includes(obj.mode);const preserveOrder=obj.preserveOrder===true||obj.type==='image'&&obj.mode==='natural'&&['refined','grouped','tonalLoops'].includes(obj.brush?.style);
      const g = geometry(obj,{paths:false});if(obj.type!=='text')g.paths=drawingPaths(obj);
      g.missing.forEach(ch => missing.add(ch));
      for (const local of g.paths) {
        totalPoints += local.length;
        if (totalPoints > 500000 || rawPaths.length >= 50000) { complexityExceeded = true; break; }
        const p = local.map(v => transformPoint(v, obj, g, paper,obj.type==='text'?1:obj.w,obj.type==='text'?1:obj.h));
        if (p.length < 2) continue;
        if(p.some(pt=>pt.some(v=>!finite(v)))){errors.push('图案坐标无效');badIds.add(obj.id);continue;}
        const clipped=clipRect.w<=0||clipRect.h<=0||p.some(pt=>!contains(pt,clipRect));
        if(clipped)clippedIds.add(obj.id);
        const fragments=clipped?clipPolyline(p,clipRect):[p];
        for(const points of fragments){if(rawPaths.length>=50000||outputPoints+points.length>500000){complexityExceeded=true;break;}outputPoints+=points.length;const path={points,color:obj.type==='image'?'#000000':obj.color,id:obj.id,type:obj.type};if(render)path.render=render;if(preserveStrokes||clipped)path.preserveStrokes=true;if(preserveOrder)path.preserveOrder=true;rawPaths.push(path);}
      }
      if (complexityExceeded) break;
    }
    if (complexityExceeded) errors.push('作品超过 50 万路径点或 5 万笔画，预览已截断；请拆分作品后再导出');
    if (missing.size) errors.push('字库缺字：' + [...missing].join(' '));
    const optimized=pathTools.optimize(rawPaths,state.pen.optimization||'quality',pen.width),paths=optimized.paths;
    if (!paths.length) errors.push(clippedIds.size?'范围内暂无笔迹，请将图案移回纸张':'还没有可导出的笔迹');
    const segments = []; let previous = null, elapsed = 0, draw = 0, travel = 0;
    function seg(a, b, kind, duration, color) { if(options.timeline!==false)segments.push({ a, b, kind, t: elapsed, duration, color }); elapsed += duration; }
    for (const path of paths) {
      const first = path.points[0];
      if (previous) {
        seg(previous, previous, 'up', pen.lift / 5, path.color);
        const d = distance(previous, first); travel += d;
        seg(previous, first, 'travel', d / pen.travelSpeed, path.color);
      }
      seg(first, first, 'down', pen.lift / 5, path.color);
      for (let i = 1; i < path.points.length; i++) { const d = distance(path.points[i - 1], path.points[i]); draw += d; seg(path.points[i - 1], path.points[i], 'draw', d / pen.drawSpeed, path.color); }
      previous = path.points.at(-1);
    }
    if (previous) seg(previous, previous, 'up', pen.lift / 5, paths.at(-1).color);
    return { paths, optimization:optimized.metrics, errors, badIds, clippedIds:[...clippedIds],clipRect, missing: [...missing], segments, duration: elapsed, draw, travel, strokes: paths.length };
  }
  function toSVG(state,options={}) {
    // Always revalidate current geometry; a previously valid preview is not an
    // authorization to export a subsequently edited document.
    const result = plan(state,{...options,timeline:false});
    if (result.errors.length) throw Error(result.errors.join('；'));
    const { paper, pen } = state;
    const lines = result.paths.map(p => '<path'+(p.render?' stroke-width="'+round(p.render.width)+'" stroke-opacity="'+p.render.opacity+'"':'')+' d="' + p.points.map((v, i) => (i ? 'L' : 'M') + round(v[0] - paper.x) + ' ' + round(v[1] - paper.y)).join(' ') + '"/>');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + paper.w + 'mm" height="' + paper.h + 'mm" viewBox="0 0 ' + paper.w + ' ' + paper.h + '">\n<title>A1 Pen Studio · paper-local design paths, not machine coordinates</title>\n<g fill="none" stroke="#000000" stroke-width="' + pen.width + '" stroke-linecap="round" stroke-linejoin="round">\n' + lines.join('\n') + '\n</g>\n</svg>';
  }
  function traceStale(o) {
    if (o.type !== 'image' || !o.trace) return false;
    return o.trace.algorithm!=='opaque-ink-v2'||o.trace.strokeWidth!==o.strokeWidth||(o.trace.detail??320)!==(o.detail??320)||(o.trace.cleanup??0)!==(o.cleanup??0)||o.trace.mode !== o.mode || o.trace.threshold !== o.threshold || o.trace.gap !== o.gap ||
      (['hatch','scan-hatch','crosshatch','wave','natural'].includes(o.mode) && (Math.abs(o.trace.w - o.w) > 1e-6 || Math.abs(o.trace.h - o.h) > 1e-6)) ||
      (o.mode==='natural'&&JSON.stringify(naturalBrush(o.brush))!==JSON.stringify(naturalBrush(o.trace.brush)));
  }
  function toDesignPlan(state,options={}) {
    const result = plan(state,{...options,timeline:false}); if (result.errors.length) throw Error(result.errors.join('；'));
    const paper = { ...state.paper };
    return { format: 'a1-pen-design-paths', version: 2, units: 'mm', coordinateSystem: 'paper-top-left-x-right-y-down', machine: { ...state.machine }, designSafeArea: { ...state.safe }, machineCalibrated: false, machineExecutable: false, penDownMachineZ: null, paper, pen: { ...state.pen }, start: result.paths[0].points[0].map((v, i) => round(v - (i ? paper.y : paper.x))), paths: result.paths.map(p => ({ objectId: p.id, color: p.color, penUpBefore: true, penUpAfter: true, points: p.points.map(v => [round(v[0] - paper.x), round(v[1] - paper.y)]) })), notes: 'Design paths only. Not G-code. No machine-origin transform, holder offset, absolute contact Z, firmware startup or collision calibration. Drawing direction is X-right/Y-down, not machine axes.' };
  }
  function flowerPaths() {
    const paths = [];
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; paths.push(Array.from({ length: 49 }, (_, j) => { const t = j / 48 * Math.PI * 2, r = 14 + 11 * Math.cos(t); return [25 + r * Math.cos(a) - 5 * Math.sin(t) * Math.sin(a), 25 + r * Math.sin(a) + 5 * Math.sin(t) * Math.cos(a)]; })); }
    paths.push(circle(25, 25, 5)); paths.push([[25, 51], [26, 61], [24, 76]]); paths.push([[25, 65], [14, 60], [11, 51], [21, 54], [25, 65]]);
    return normalize(paths);
  }
  const newText = (text = '写下你的想法\nHello, paper.') => ({ id: uid(), type: 'text', text, font: 'simple', size: 9, spacing: .6, leading: 1.65, wrap: 110, align: 'left', x: 13, y: 15, rotation: 0, color: '#263d34' });
  function initial() {
    const title = newText('把日子写成诗'); title.size = 12; title.x = 12; title.y = 17;
    const sub = newText('Slow down. Make a little art.'); sub.size = 4.5; sub.x = 14; sub.y = 37; sub.spacing = .15; sub.color = '#557867';
    const f = flowerPaths();
    const flower = { id: uid(), type: 'shape', name: '一朵线条花', paths: f.paths, w: 38 * f.ratio, h: 38, x: 54, y: 54, rotation: -9, color: '#577a59' };
    const note = newText('你好，世界。\nHello, world.'); note.x = 17; note.y = 103; note.size = 5; note.leading = 1.5;
    return { version: 2, machine: defaultMachine(), paper: { x: 20, y: 40, w: 140, h: 130, margin: 6 }, safe: { x: 5, y: 5, w: 170, h: 170 }, pen: { optimization: 'quality', speedMode: 'normal', width: .35, drawSpeed: 20, travelSpeed: 50, lift: 2 }, objects: [title, sub, flower, note] };
  }
  function validateProject(input, allowAlignmentReturn = true) {
    // Compatibility only: recover the artwork if 0.18.11 was closed on a trial
    // card. The deferred trial feature and its metadata are not retained.
    if(input?.testCardReturn!==undefined){
      if(!allowAlignmentReturn)throw Error('作品备份不可嵌套');
      const recovered=validateProject(input.testCardReturn,false);
      return validateProject({...recovered,pen:input.pen},false);
    }
    if (!input || ![1, 2].includes(input.version) || !Array.isArray(input.objects) || input.objects.length > 100) throw Error('不是有效的纸上作品文件，或图层超过 100 个');
    const num = (v, lo, hi) => { if (!finite(v) || v < lo || v > hi) throw Error('作品中的数字超出允许范围'); return v; };
    const p = input.paper, s = input.safe, pen = input.pen;
    if (!p || !s || !pen) throw Error('作品缺少纸张或笔迹参数');
    const machine = input.version === 1 ? defaultMachine() : input.machine;
    if (!machine || !Object.hasOwn(profiles, machine.model) || !['smooth', 'textured', 'custom'].includes(machine.plate)) throw Error('打印机或打印板配置无效');
    const device = { model: machine.model, w: num(machine.w, 20, 500), h: num(machine.h, 20, 500), plate: machine.plate };
    if (device.model !== 'custom' && (device.w !== profiles[device.model].w || device.h !== profiles[device.model].h)) throw Error('预设机型画板尺寸不匹配；如需其他尺寸请选择自定义');
    const speedMode=speedPolicy.mode(pen),speedLimits=speedPolicy.limits(pen,device);
    const result = { version: 2, machine: device, paper: { x: num(p.x, -420, 420), y: num(p.y, -420, 420), w: num(p.w, 10, 420), h: num(p.h, 10, 420), margin: num(p.margin, 0, 80) }, safe: { x: num(s.x, 0, 500), y: num(s.y, 0, 500), w: num(s.w, -500, 500), h: num(s.h, -500, 500) }, pen: { optimization: ['off','quality','balanced'].includes(pen.optimization)?pen.optimization:'quality', speedMode, width: num(pen.width, .1, Infinity), drawSpeed: num(pen.drawSpeed, 1, speedLimits.draw), travelSpeed: num(pen.travelSpeed, 1, speedLimits.travel), lift: num(pen.lift, .5, 10) }, objects: [] };
    let points = 0; const ids = new Set();
    for (const o of input.objects) {
      if (!o || !['text', 'image', 'shape', 'svg'].includes(o.type)) throw Error('未知图层类型');
      const id = typeof o.id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(o.id) && !ids.has(o.id) ? o.id : uid(); ids.add(id);
      const a = { id, type: o.type, x: num(o.x, -500, 500), y: num(o.y, -500, 500), rotation: num(o.rotation, -360, 360), color: /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#263d34' };
      if (o.type === 'text') {
        if (typeof o.text !== 'string' || o.text.length > 1200) throw Error('文字太长，单图层最多 1200 字符');
        Object.assign(a, { text: o.text, size: num(o.size, 2, 50), spacing: num(o.spacing, 0, 10), leading: num(o.leading, 1, 3), wrap: num(o.wrap, 5, 400), font: o.font === 'script' ? 'script' : 'simple', align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'left' });
      } else {
        Object.assign(a, { name: String(o.name || '图案').slice(0, 100), w: num(o.w, 1, 500), h: num(o.h, 1, 500) });
        if(o.type==='svg'&&o.preserveStrokes!==undefined){if(typeof o.preserveStrokes!=='boolean')throw Error('笔迹保留设置无效');a.preserveStrokes=o.preserveStrokes;}
        if(o.type==='svg'&&o.preserveOrder!==undefined){if(typeof o.preserveOrder!=='boolean')throw Error('笔顺保留设置无效');a.preserveOrder=o.preserveOrder;}
        if (!Array.isArray(o.paths) || o.paths.length > 50000) throw Error('路径数量过多');
        a.paths = o.paths.map(path => { if (!Array.isArray(path) || path.length < 2) throw Error('无效路径'); return path.map(v => { if (!Array.isArray(v) || v.length !== 2 || ++points > 500000) throw Error('作品路径过大或无效'); return [num(v[0], -1, 2), num(v[1], -1, 2)]; }); });
        if(o.frame!==undefined){if(o.type!=='shape')throw Error('边框类型无效');const F=root.PenFrames||(typeof require==='function'?require('./frames.js'):null);a.frame=F.options(o.frame);a.paths=F.paths(a.w,a.h,a.frame);}
        if (o.type === 'image') {
          if (typeof o.source !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(o.source) || o.source.length > 15000000) throw Error('图像数据无效或过大');
          if(o.originalSource!=null){if(typeof o.originalSource!=='string'||!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(o.originalSource)||o.originalSource.length>15000000)throw Error('原图数据无效或过大');a.originalSource=o.originalSource;}
          Object.assign(a, { source: o.source, mode: ['outline', 'skeleton', 'hatch', 'sketch', 'scan-hatch','crosshatch', 'wave','natural'].includes(o.mode) ? o.mode : 'outline', threshold: num(o.threshold, 0, 255), gap: num(o.gap, .3, Infinity) });
          a.detail=a.mode==='natural'?naturalDetail(o.detail):Number.isSafeInteger(o.detail)&&o.detail>=2&&o.detail<=1024?o.detail:320;a.cleanup=num(o.cleanup??0,0,Infinity);
          a.strokeWidth=result.pen.width;if(a.mode==='natural')a.brush=naturalBrush({...o.brush,strokeWidth:result.pen.width,penDarkness:1},a.detail);
          const tr = o.trace || a;
          if (!['outline', 'skeleton', 'hatch', 'sketch', 'scan-hatch','crosshatch', 'wave','natural'].includes(tr.mode)) throw Error('图像路径生成记录无效');
          a.trace = { mode: tr.mode, threshold: num(tr.threshold, 0, 255), gap: num(tr.gap, .3, Infinity), w: num(tr.w, 1, 500), h: num(tr.h, 1, 500),detail:tr.mode==='natural'?naturalDetail(tr.detail):Number.isSafeInteger(tr.detail)&&tr.detail>=2&&tr.detail<=1024?tr.detail:320,cleanup:num(tr.cleanup??0,0,Infinity) };
          a.trace.algorithm=tr.algorithm==='opaque-ink-v2'?'opaque-ink-v2':'legacy';a.trace.strokeWidth=tr.strokeWidth==null?(tr.brush?.strokeWidth??.35):num(tr.strokeWidth,.1,Infinity);if(tr.mode==='natural')a.trace.brush=naturalBrush(tr.brush??a.brush,a.trace.detail);
        }
      }
      result.objects.push(a);
    }
    if(input.backing!==undefined){const B=root.PenBacking||(typeof require==='function'?require('./backing.js'):null);result.backing=B.validate(input.backing);}
    if(input.alignment!==undefined){const A=root.PenAlignment||(typeof require==='function'?require('./alignment.js'):null);if(!A)throw Error('定位底板模块未加载');result.alignment=A.normalize(input.alignment,device);}
    if(input.alignmentReturn!==undefined){if(!allowAlignmentReturn)throw Error('定位底板备份不可嵌套');result.alignmentReturn=validateProject(input.alignmentReturn,false);}
    return result;
  }
  function taskState(state) {
    const s=validateProject(state);delete s.alignmentReturn;delete s.backing;s.objects=s.objects.map(o=>{if(o.type!=='image')return o;if(traceStale(o))throw Error('图像转换参数已改变，请重新生成路径');const {source,originalSource,trace,mode,threshold,gap,detail,cleanup,brush,...geometry}=o;return {...geometry,type:'svg',...(mode==='scan-hatch'?{preserveStrokes:true}:mode==='natural'?{preserveStrokes:true,...(['refined','grouped','tonalLoops'].includes(brush?.style)?{preserveOrder:true}:{})}:{})};});return s;
  }
  root.PenCore = { clipPolyline,intersectRects,taskState, profiles, defaultMachine, board, traceStale, toDesignPlan, clamp, round, uid, distance, bounds, normalize, circle, glyph, geometry, textGeometry, transformPoint, objectPaths, plan, toSVG, flowerPaths, newText, initial, validateProject };
  if (typeof module !== 'undefined') module.exports = root.PenCore;
})(typeof window !== 'undefined' ? window : globalThis);
