/* Offline raster geometry; shared by the conversion worker and tests. */
(function(root){'use strict';const C={clamp:(n,a,b)=>Math.max(a,Math.min(b,n))};
  function simplify(points, epsilon = .6) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(), p = points[a], q = points[b], dx = q[0] - p[0], dy = q[1] - p[1], l2 = dx * dx + dy * dy;
      let max = epsilon * epsilon, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const t = l2 ? C.clamp(((points[i][0] - p[0]) * dx + (points[i][1] - p[1]) * dy) / l2, 0, 1) : 0;
        const d = (points[i][0] - p[0] - t * dx) ** 2 + (points[i][1] - p[1] - t * dy) ** 2;
        if (d > max) { max = d; idx = i; }
      }
      if (idx !== -1) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return points.filter((_, i) => keep[i]);
  }
  function outlines(mask, w, h) {
    const edges = new Map();
    const add = (ax, ay, bx, by) => { const k = ay * (w + 1) + ax, v = by * (w + 1) + bx; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(v); };
    const on = (x, y) => x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) {
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
    const result = [];
    while (edges.size) {
      const start = edges.keys().next().value; let k = start; const path = [[k % (w + 1), Math.floor(k / (w + 1))]];
      do {
        const out = edges.get(k); if (!out?.length) break;
        const next = out.pop(); if (!out.length) edges.delete(k); k = next;
        path.push([k % (w + 1), Math.floor(k / (w + 1))]);
      } while (k !== start && path.length <= w * h * 4);
      if (path.length > 4) result.push(simplify(path, .65));
    }
    return result;
  }
  function skeleton(input, w, h) {
    const mask = input.slice(), around = [ -w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1 ];
    for (let i = 0; i < w; i++) mask[i] = mask[(h - 1) * w + i] = 0;
    for (let i = 0; i < h; i++) mask[i * w] = mask[i * w + w - 1] = 0;
    for (let iter = 0; iter < 150; iter++) {
      let changed = 0;
      for (let pass = 0; pass < 2; pass++) {
        const remove = [];
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x; if (!mask[i]) continue;
          const a = around.map(o => mask[i + o]); let n = 0, transitions = 0;
          for (let j = 0; j < 8; j++) { n += a[j]; if (!a[j] && a[(j + 1) % 8]) transitions++; }
          if (n < 2 || n > 6 || transitions !== 1) continue;
          if (pass === 0 ? a[0] * a[2] * a[4] || a[2] * a[4] * a[6] : a[0] * a[2] * a[6] || a[0] * a[4] * a[6]) continue;
          remove.push(i);
        }
        remove.forEach(i => { mask[i] = 0; }); changed += remove.length;
      }
      if (!changed) break;
      if(iter===149)throw Error('黑块过厚，单线提取未收敛；请选择轮廓或排线，或降低细节');
    }
    function neighbors(i) {
      const list = [];
      for (let k = 0; k < 8; k++) {
        const j = i + around[k]; if (!mask[j]) continue;
        // Avoid redundant diagonal edges around a 90-degree corner.
        if (k % 2 && (mask[i + around[(k + 7) % 8]] || mask[i + around[(k + 1) % 8]])) continue;
        list.push(j);
      }
      return list;
    }
    const visited = new Set(), paths = [], active = [];
    const key = (a, b) => Math.min(a, b) * (w * h) + Math.max(a, b);
    for (let i = 0; i < mask.length; i++) if (mask[i]) active.push(i);
    const trace = start => {
      for (const next of neighbors(start)) {
        if (visited.has(key(start, next))) continue;
        const p = [[start % w, Math.floor(start / w)]]; let prev = start, current = next;
        while (true) {
          visited.add(key(prev, current)); p.push([current % w, Math.floor(current / w)]);
          const n = neighbors(current); if (n.length !== 2) break;
          const dest = n.find(j => j !== prev); if (dest === undefined || visited.has(key(current, dest))) break;
          prev = current; current = dest;
        }
        if (p.length >= 2) paths.push(simplify(p, .65));
      }
    };
    for(const i of active)if(neighbors(i).length===0)paths.push([[i%w-.25,Math.floor(i/w)],[i%w+.25,Math.floor(i/w)]]);
    active.filter(i => neighbors(i).length !== 2).forEach(trace); active.forEach(trace);
    return paths;
  }

  root.PenRaster={simplify,outlines,skeleton};if(typeof module!=='undefined')module.exports=root.PenRaster;
})(typeof self!=='undefined'?self:globalThis);
