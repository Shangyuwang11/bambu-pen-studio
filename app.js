(function () {
  'use strict';
  const C = PenCore, $ = id => document.getElementById(id), canvas = $('canvas'), ctx = canvas.getContext('2d');
  PenAlgorithms.populateModes($('traceMode'),false);
  const STORE = 'a1-pen-studio-v1';
  let state = C.initial(), selected = state.objects[0].id, history = [], future = [], result, motion, connection=null, motionKey='';
  const scene=PenScene3D.create($('sceneCanvas'));
  let view = 'top', zoom = 1, matrix, inverse, screenW = 0, screenH = 0, handles = [], drag = null;
  let imageUpdatePromise=null,imageUpdateTimer=null,imageUpdateError='';
  let playing = false, previewActive = false, elapsed = 0, lastFrame = 0, frameId = 0, saveTimer, toastTimer, busy = false, recoveryHold = false;
  const clone = v => JSON.parse(JSON.stringify(v));
  const current = () => state.objects.find(o => o.id === selected);
  const snapshot = () => JSON.stringify(state);
  const nameOf = o => o.type === 'text' ? (o.text.split('\n')[0] || '空白文字') : o.name;
  function fault(error){window.dispatchEvent(new CustomEvent('penproblem',{detail:{message:(error?.name&&error.name!=='Error'?error.name+': ':'')+(error?.message||String(error)),stack:error?.stack||'',source:'application'}}));}
  function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4200); }
  try { const stored = window.PenDesktopAPI?.initialState ? JSON.stringify(PenDesktopAPI.initialState) : localStorage.getItem(STORE); if (stored) { state = C.validateProject(JSON.parse(stored)); selected = state.objects[0]?.id || 'paper'; } } catch { recoveryHold=true;toast('自动保存未能读取，原数据已保留。当前编辑请用“保存作品”另存。'); }
  function checkpoint() { history.push(snapshot()); while (history.length > 35 || (history.length > 1 && history.reduce((sum, s) => sum + s.length, 0) > 20000000)) history.shift(); future = []; }
  function autoSave() {
    clearTimeout(saveTimer); $('saveStatus').textContent = '保存中…';
    if(recoveryHold){$('saveStatus').textContent='恢复失败 · 请手动保存';return;}
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, snapshot()); $('saveStatus').textContent = '已在本机保存'; } catch { $('saveStatus').textContent = '请手动保存作品'; } }, 400);
  }
  function stop(reset = false) { playing = false; cancelAnimationFrame(frameId); frameId = 0; $('play').textContent = '▶ 播放'; if (reset) { elapsed = 0; previewActive = false; $('progress').value = 0; $('penState').textContent = '等待播放'; $('strokeStep').textContent='逐笔预演 · 保留文字笔顺'; } }
  function designOptions(){let profile;try{profile=window.PenMachineUI?.getProfile();}catch{}return {timeline:false,clipRect:window.PenMachine?.reachable(profile,state.machine)};}
  function syncImagePen(){for(const o of state.objects)if(o.type==='image'){o.strokeWidth=state.pen.width;if(o.mode==='natural')o.brush=PenNaturalOptions.normalize({...o.brush,strokeWidth:state.pen.width,penDarkness:1});}}
  function refresh(options = {}) {
    PenBacking.sync(state,localStorage);syncImagePen();stop(true); result = C.plan(state,designOptions()); rebuildMotion(); updateMetrics(true,options.derivedPaths); renderLayers(); if (!options.keepInspector) syncFields();
    $('undo').disabled = !history.length; $('redo').disabled = !future.length;
    draw(); autoSave(); scheduleImagePaths();
  }
  function mutate(fn, options = {}) {
    const before = snapshot();
    try { fn(); } catch (e) { state = JSON.parse(before); fault(e); toast(e.message); syncFields(); return; }
    if (before !== snapshot()) { history.push(before); while (history.length > 35 || (history.length > 1 && history.reduce((sum, s) => sum + s.length, 0) > 20000000)) history.shift(); future = []; }
    refresh(options);
  }
  function numeric(id, getter, setter) {
    $(id).addEventListener('change', () => {
      const input = $(id), value = Number(input.value), min = input.min===''?-Infinity:Number(input.min), max = input.max===''?Infinity:Number(input.max);
      if (!input.value.trim() || !Number.isFinite(value) || value < min || value > max) { toast(Number.isFinite(max)?'请输入 ' + min + ' 到 ' + max + ' 之间的数字':'请输入不小于 '+min+' 的有限数字'); syncFields(); return; }
      mutate(() => setter(value));
    });
  }
  function syncFields() {
    window.dispatchEvent(new Event('penselectionchange'));
    const p = state.paper, pen = state.pen, s = state.safe, machine = state.machine;
    const limits=PenSpeedPolicy.limits(pen,machine);$('drawSpeed').max=limits.draw;$('travelSpeed').max=limits.travel;
    $('printerModel').value = machine.model; $('bedW').value = machine.w; $('bedH').value = machine.h;
    $('bedW').readOnly = $('bedH').readOnly = machine.model !== 'custom'; $('plateType').value = machine.plate;
    $('machineTag').textContent = C.profiles[machine.model].name.replace('Bambu Lab ', '');
    $('stageLabel').textContent = C.profiles[machine.model].name.toUpperCase() + ' · PEN WORKSPACE';
    $('boardDimensions').textContent = machine.w + ' × ' + machine.h + ' mm';
    $('plateHint').textContent = { smooth: '光面通常便于支撑纸张；仍需确认纸张固定与笔尖接触高度。', textured: '纹理可能透过薄纸影响笔迹。此选项仅记录表面，不自动补偿高度。', custom: '垫板厚度和固定方式需另行测量，此处不会改变 Z 高度。' }[machine.plate];
    $('safeX').max = $('safeRight').max = machine.w; $('safeY').max = $('safeBottom').max = machine.h;
    const presets = {note:[100,100],postcard:[100,148],a6:[105,148],square:[160,160],a4:[210,297]};
    $('paperPreset').value = Object.keys(presets).find(k => presets[k][0] === p.w && presets[k][1] === p.h) || 'custom';
    const values = { paperW: p.w, paperH: p.h, paperX: p.x, paperY: p.y, margin: p.margin, penWidth: pen.width, drawSpeed: pen.drawSpeed, travelSpeed: pen.travelSpeed, lift: pen.lift, safeX: s.x, safeY: s.y, safeRight: s.x + s.w, safeBottom: s.y + s.h };
    for (const [id, v] of Object.entries(values)) $(id).value = C.round(v);if(motion?.profile)$('lift').value=C.round(motion.settings.upZ-motion.settings.downZ);
    $('pathOptimization').value=state.pen.optimization||'quality';
    const speeds=window.PenMachineUI?.getProfile();if(speeds){$('liftSpeed').value=speeds.liftSpeed??speeds.zSpeed;$('lowerSpeed').value=speeds.zSpeed;}
    const obj = current(); $('objectInspector').hidden = !obj; $('paperInspector').hidden = !!obj;
    $('inspectorTitle').textContent = obj ? obj.type === 'text' ? '文字属性' : '图案属性' : '纸张布局';
    $('objectType').textContent = obj ? obj.type.toUpperCase() : 'PAPER';
    $('selectPaper').classList.toggle('primary', selected === 'paper');
    for (const id of ['remove', 'duplicate', 'layerUp', 'layerDown']) $(id).disabled = !obj;
    $('undo').disabled = !history.length; $('redo').disabled = !future.length;
    if (!obj) return;
    const g = C.geometry(obj,{paths:false});
    $('textFields').hidden = obj.type !== 'text'; $('imageFields').hidden = obj.type !== 'image';
    for (const [id, v] of Object.entries({ objX: obj.x, objY: obj.y, objW: g.w, objH: g.h, rotation: obj.rotation, color: obj.color })) $(id).value = typeof v === 'number' ? C.round(v) : v;
    if (obj.type === 'text') {
      $('textContent').value = obj.text; $('font').value = obj.font; $('fontSize').value = obj.size; $('letterSpacing').value = obj.spacing; $('lineHeight').value = obj.leading; $('wrapWidth').value = obj.wrap; $('align').value = obj.align;
    }
    $('lockRatio').disabled = obj.type === 'text'; if (obj.type === 'text') $('lockRatio').checked = true;
    if (obj.type === 'image') { $('imageAlgorithmHint').textContent=PenAlgorithms.describe(obj.mode,obj.brush?.style);$('traceMode').value = obj.mode; $('threshold').value = obj.threshold; $('thresholdValue').textContent = obj.threshold; $('hatchGap').value = obj.gap; $('retrace').textContent = C.traceStale(obj) ? '路径自动更新中' : '重新生成图案路径';const natural=obj.mode==='natural';$('threshold').closest('label').hidden=$('hatchGap').closest('label').hidden=natural;$('naturalObjectSummary').hidden=!natural;if(natural){const brush=PenNaturalOptions.normalize(obj.brush);$('naturalObjectSummary').textContent=(PenNaturalOptions.STYLE_LABELS?.[brush.style]||brush.style)+' · 密度 '+brush.density+'× · 预估笔宽 '+brush.strokeWidth+' mm';} }
  }
  function renderLayers() {
    $('layers').replaceChildren(); $('layerCount').textContent = state.objects.length;
    state.objects.forEach((obj, i) => {
      const b = document.createElement('button'); b.className = 'layer' + (selected === obj.id ? ' active' : '');
      const symbol = document.createElement('span'); symbol.className = 'symbol'; if(window.PenIcons)symbol.append(PenIcons.svg(obj.type === 'text' ? 'text' : 'image'));else symbol.textContent = obj.type === 'text' ? 'T' : '⌁'; symbol.style.color = obj.color;
      const label = document.createElement('span'); label.className = 'label'; label.textContent = nameOf(obj);
      const order = document.createElement('span'); order.className = 'kind'; order.textContent = String(i + 1).padStart(2, '0');
      b.oncontextmenu=e=>{e.preventDefault();contextElement(obj.id,e.clientX||b.getBoundingClientRect().right,e.clientY||b.getBoundingClientRect().top);};b.ondblclick=()=>editElement(obj.id);b.append(symbol, label, order); b.onclick = () => select(obj.id); $('layers').append(b);
    });
  }
  function select(id) { selected = id; renderLayers(); syncFields(); draw(); }
  function rebuildMotion(){
    let profile=null;try{profile=window.PenMachineUI?.getProfile();}catch{}
    motion=PenTrajectory.preview(state,profile,connection?.position,connection?.wizard?.returnTo,result);result.segments=motion.segments;result.duration=motion.duration;
    motionKey=JSON.stringify({profile,position:connection?.position,park:connection?.wizard?.returnTo});
    $('motionSource').textContent=motion.reason+'；预演按请求速度播放，实际还受加速度、转角、笔架和通信影响。';
    const calibrated=!!motion.profile;$('showHolder').disabled=!calibrated;$('showHolder').title=calibrated?'显示笔与喷嘴的相对位置示意':'填写有效笔架参数后显示喷嘴参考';$('reachabilityInfo').hidden=!motion.reachable||motion.reachable.w>=state.machine.w&&motion.reachable.h>=state.machine.h;$('lift').readOnly=calibrated;$('liftLabel').textContent=calibrated?'已校准抬笔间隙 mm':'预演抬笔间隙 mm';
    $('timeBreakdown').replaceChildren(...Object.entries(motion.breakdown).map(([k,v])=>{const e=document.createElement('span');e.className='time-'+k;e.textContent=({draw:'书写',travel:'空移',z:'升降',return:'返回'}[k])+' '+Math.ceil(v)+'s';return e;}));
  }
  function updateMetrics(notify=true,derivedPaths=false) {
    const opt=result.optimization; $('optimizationSummary').textContent='图案优化：空移 '+opt.before.travel.toFixed(1)+' → '+opt.after.travel.toFixed(1)+' mm · 路径点 '+opt.before.points+' → '+opt.after.points+' · 文字笔顺保持';
    $('strokeCount').textContent = result.strokes.toLocaleString(); $('drawLength').textContent = (result.draw / 1000).toFixed(2) + ' m'; $('travelLength').textContent = (result.travel / 1000).toFixed(2) + ' m';
    $('duration').textContent = result.duration < 60 ? Math.ceil(result.duration) + ' 秒' : Math.floor(result.duration / 60) + ' 分 ' + Math.ceil(result.duration % 60) + ' 秒';
    $('status').classList.toggle('error', !!result.errors.length);
    $('status').textContent = result.errors.length ? '⚠ ' + result.errors.join('；') : (result.clippedIds.length?'✓ 已自动裁切 '+result.clippedIds.length+' 个图层的越界笔迹 · ':'✓ ')+'预览与发送使用当前范围内的路径';
    $('exportSvg').disabled = $('exportPlan').disabled = $('svgFromDialog').disabled = $('planFromDialog').disabled = !!result.errors.length;
    $('play').disabled = !result.segments.length;
    if(notify)window.dispatchEvent(new CustomEvent('penstudiochange',{detail:{derivedPaths}}));
  }
  function project(p) {return [matrix.a*p[0]+matrix.c*p[1]+matrix.e,matrix.b*p[0]+matrix.d*p[1]+matrix.f];}
  function unproject(p) { const r = new DOMPoint(p[0], p[1]).matrixTransform(inverse); return [r.x, r.y]; }
  function polygon(points, fill, stroke, width = 1, dash = []) {
    if (!points.length) return;
    ctx.beginPath(); points.forEach((p, i) => { const q = project(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]); }
  }
  const rectPoints = r => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  function polyline(points, color, width, dash = [], alpha = 1) {
    if (points.length < 2) return;
    ctx.beginPath(); points.forEach((p, i) => { const q = project(p); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.globalAlpha = alpha; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
  }
  function textAt(text, p, color = '#8b968c', size = 10, align = 'center') { const q = project(p); ctx.font = size + 'px "Segoe UI", "Microsoft YaHei", sans-serif'; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, q[0], q[1]); }
  function setMatrix() {
    if (drag) return;
    const p = state.paper, bed = C.board(state), minX = Math.min(-14, p.x - 12), minY = Math.min(-15, p.y - 10), maxX = Math.max(bed.w + 14, p.x + p.w + 12), maxY = Math.max(bed.h + 19, p.y + p.h + 15);
    const a = view === 'top' ? 1 : .94, b = view === 'top' ? 0 : .17, c = view === 'top' ? 0 : -.37, d = view === 'top' ? 1 : .73;
    const corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].map(([x, y]) => [a * x + c * y, b * x + d * y]);
    const bb = C.bounds([corners]), scale = Math.min((screenW - 60) / bb.w, (screenH - 68) / bb.h) * zoom;
    matrix = new DOMMatrix([a * scale, b * scale, c * scale, d * scale, screenW / 2 - (bb.x + bb.w / 2) * scale, screenH / 2 - (bb.y + bb.h / 2) * scale]); inverse = matrix.inverse();
  }
  function pointInObject(p, obj) {
    const g = C.geometry(obj,{paths:false}), cx = state.paper.x + obj.x + g.w / 2, cy = state.paper.y + obj.y + g.h / 2, rad = -obj.rotation * Math.PI / 180;
    const x = (p[0] - cx) * Math.cos(rad) - (p[1] - cy) * Math.sin(rad) + g.w / 2, y = (p[0] - cx) * Math.sin(rad) + (p[1] - cy) * Math.cos(rad) + g.h / 2;
    return x >= -1 && y >= -1 && x <= g.w + 1 && y <= g.h + 1;
  }
  function draw() {
    if (!screenW || !screenH || !result) return;
    if(view==='scene'){drawScene();return;}
    const dpr = window.devicePixelRatio || 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, screenW, screenH); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; setMatrix();
    const scale = Math.hypot(matrix.a, matrix.b), p = state.paper, bed = C.board(state), W = bed.w, H = bed.h;
    ctx.shadowColor = '#25342830'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 14;
    const plate=PenAlignment.plate(state.machine);polygon(plate.points, state.machine.plate === 'textured' ? '#7b7463' : '#69736b', '#606a63'); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    for(const hole of plate.holes)polygon(hole,'#e9eee5','#606a63',.5);
    if (view === 'tilt') {
      polygon([[0, H], [W, H], [W, H+3], [0, H+3]], '#454f47', null);
      polygon([[W, 0], [W+3, 0], [W+3, H], [W, H+3], [W, H]], '#505c51', null);
    }
    const alignment=PenAlignment.settings(state),gridStep=alignment.spacing;
    for (let x = gridStep; x < W; x += gridStep) polyline([[x, 0], [x, H]], '#9da79b', .5, [], .3);
    for (let y = gridStep; y < H; y += gridStep) polyline([[0, y], [W, y]], '#9da79b', .5, [], .3);
    const tick = Math.max(W, H) > 300 ? 50 : 30;
    for (let i = 0; i < W-10; i += tick) textAt(i, [i, -5]); textAt(W, [W,-5]);
    for (let i = 0; i < H-10; i += tick) textAt(i, [-7, i+1], '#8b968c', 10, 'right'); textAt(H, [-7,H+1], '#8b968c',10,'right');
    textAt('X / mm →', [W-22, -12], '#7e897e', 9); textAt(W+' × '+H+' mm', [W/2, H+13], '#7a857a', 10);
    const backing=PenBacking.resolve(state);
    if(backing){polygon(rectPoints(backing.base),backing.paperColor,'#d4decb',.6);for(const path of backing.paths)polyline(path,backing.inkColor,backing.width*scale);}
    else if(state.alignment&&alignment.visible&&!state.alignmentReturn){
      polygon(rectPoints(alignment.base),alignment.paperColor,'#d4decb',.6);
      try{for(const path of PenAlignment.grid(state,motion?.reachable).paths)polyline(path,alignment.inkColor,state.pen.width*scale);}catch{}
    }
    ctx.shadowColor = '#18241b33'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    polygon(rectPoints(p), backing?'#fffef9b3':state.alignmentReturn?alignment.paperColor:'#fffef9', '#d7dbd0', .8); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    const area=motion?.reachable;if(area){const blocked=[{x:0,y:0,w:W,h:area.y},{x:0,y:area.y+area.h,w:W,h:H-area.y-area.h},{x:0,y:area.y,w:area.x,h:area.h},{x:area.x+area.w,y:area.y,w:W-area.x-area.w,h:area.h}];for(const r of blocked)if(r.w>0&&r.h>0)polygon(rectPoints(r),'#e8aa4833',null);}
    const m = p.margin;
    if (p.w > m * 2 && p.h > m * 2) polygon(rectPoints({ x: p.x + m, y: p.y + m, w: p.w - m * 2, h: p.h - m * 2 }), null, '#ccd7c9', .7, [3, 4]);
    const safe = state.safe; if (safe.w > 0 && safe.h > 0) polygon(rectPoints(safe), null, '#bfaa77', .8, [5, 4]);
    const lineWidth = Math.max(.7, state.pen.width * scale);
    for (const path of result.paths) {if(previewActive&&path.render)continue;polyline(path.points,path.color,path.render?path.render.width*scale:lineWidth,[],path.render?path.render.opacity:previewActive?.12:1);}
    if ($('showTravel').checked && !previewActive && !drag) for (let i = 1; i < result.paths.length; i++) polyline([result.paths[i - 1].points.at(-1), result.paths[i].points[0]], '#c89a55', .8, [3, 4], .65);
    if (previewActive) drawSimulation(lineWidth);
    // Missing glyphs are UI-only placeholders. They never enter exported paths.
    for (const obj of state.objects) {
      const g = C.geometry(obj,{paths:false});
      for (const ph of g.placeholders) {
        const corners = [[ph.x, ph.y], [ph.x + obj.size * .85, ph.y], [ph.x + obj.size * .85, ph.y + obj.size * .9], [ph.x, ph.y + obj.size * .9]].map(pt => C.transformPoint(pt, obj, g, p));
        polygon(corners, '#fae6df', '#c54d3b', 1, [2, 2]); textAt(ph.char, C.transformPoint([ph.x + obj.size * .4, ph.y + obj.size * .7], obj, g, p), '#a13f31', Math.max(10, obj.size * scale * .6));
      }
    }
    handles = [];
    const obj = current();
    for (const o of state.objects) if (result.badIds.has(o.id) && o.id !== selected) { const g = C.geometry(o,{paths:false}); polygon(rectPoints({ x: 0, y: 0, w: g.w, h: g.h }).map(pt => C.transformPoint(pt, o, g, p)), null, '#c25744', 1, [4, 3]); }
    if (!previewActive) {
      if (selected === 'paper') { polygon(rectPoints(p), null, '#267e5c', 1.5); handle([p.x + p.w, p.y + p.h], 'paperResize', 'square'); textAt((window.PenI18n?.t('纸张')||'纸张')+' ' + C.round(p.w) + ' × ' + C.round(p.h) + ' mm', [p.x + p.w / 2, p.y - 3], '#247953', 10); }
      else if (obj) {
        const g = C.geometry(obj,{paths:false}), corners = rectPoints({ x: 0, y: 0, w: g.w, h: g.h }).map(pt => C.transformPoint(pt, obj, g, p));
        const color = result.badIds.has(obj.id) ? '#bd5740' : '#2d8662'; polygon(corners, null, color, 1.2);
        const top = C.transformPoint([g.w / 2, 0], obj, g, p), rotate = C.transformPoint([g.w / 2, -10 / scale - 4], obj, g, p);
        polyline([top, rotate], color, 1); handle(rotate, 'rotate', 'circle', color); handle(corners[2], 'resize', 'square', color);
        const first = result.paths.find(v => v.id === obj.id)?.points[0];
        if (first) { const q = project(first); ctx.beginPath(); ctx.arc(...q, 3, 0, Math.PI * 2); ctx.fillStyle = '#c39a42'; ctx.fill(); }
      }
    }
  }
  function drawScene(){
    const v=scene.render({state,model:motion,paths:result.paths,elapsed,active:previewActive,travel:$('showTravel').checked,exaggerate:$('exaggerateLift').checked,holder:$('showHolder').checked});
    if(!v)return;const pose=v.pose,s=pose?.segment,labels={up:'抬笔',down:'落笔',travel:'空移',draw:'书写'},phase=!previewActive?'等待预演':pose?.done?'预演完成':s?.phase==='return'?'抬笔返回':s?.phase==='approach'?'进入起点':labels[s?.kind]||'等待预演';
    $('scenePhase').textContent=phase;$('sceneCoordinates').textContent='画板 X '+C.round(v.point[0])+' · Y '+C.round(v.point[1])+' · 离纸 '+C.round(v.point[2])+' mm';if(previewActive)$('penState').textContent=phase+' · '+Math.floor(elapsed)+' / '+Math.ceil(result.duration)+' s';
  }
  function handle(point, kind, shape, color = '#2d8662') {
    const q = project(point); handles.push({ point: q, kind }); ctx.fillStyle = 'white'; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); if (shape === 'circle') ctx.arc(...q, 5, 0, Math.PI * 2); else ctx.rect(q[0] - 4.5, q[1] - 4.5, 9, 9); ctx.fill(); ctx.stroke();
  }
  function drawSimulation(lineWidth) {
    let active = null,ink=null;const scale=Math.hypot(matrix.a,matrix.b),flush=()=>{if(!ink)return;polyline(ink.points,ink.color,ink.render?ink.render.width*scale:lineWidth,[],ink.render?.opacity??1);ink=null;};
    for (const s of result.segments) {
      if (elapsed < s.t) break;
      const t = s.duration ? C.clamp((elapsed - s.t) / s.duration, 0, 1) : 1;
      const end = s.a.map((n,i)=>n+(s.b[i]-n)*t);
      if (s.kind === 'draw') {if(ink&&ink.stroke!==s.stroke)flush();if(!ink)ink={stroke:s.stroke,points:[s.a],color:s.color,render:s.render||result.paths[s.stroke]?.render};ink.points.push(end);}else flush();
      if (s.kind === 'travel' && $('showTravel').checked) polyline([s.a, end], '#b78c4e', 1, [3, 4], .8);
      active = { ...s, end, progress: t }; if (t < 1) break;
    }
    flush();
    if (active) {
      const q = project(active.end), raised = active.end[2]>.001;
      const lift = C.clamp((active.a[2]+(active.b[2]-active.a[2])*active.progress)/Math.max(.5,motion.settings.upZ-motion.settings.downZ),0,1);
      ctx.fillStyle = '#173e321c'; ctx.beginPath(); ctx.ellipse(q[0], q[1], 8, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(q[0], q[1] - lift * 14, 5, 0, Math.PI * 2); ctx.fillStyle = raised ? '#d8ab54' : '#2b8058'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      const labels = { up: '抬笔', down: '落笔', travel: '空移', draw: '书写' }; $('penState').textContent = (elapsed >= result.duration ? '预演完成' : labels[active.kind]) + ' · ' + Math.floor(elapsed) + ' / ' + Math.ceil(result.duration) + ' s';
    }
  }
  function resizeCanvas() { const rect = $('stage').getBoundingClientRect(); screenW = rect.width; screenH = rect.height; canvas.width = Math.round(screenW * (devicePixelRatio || 1)); canvas.height = Math.round(screenH * (devicePixelRatio || 1)); draw(); }
  // Drawing updates layout-dependent labels. Defer that work out of the
  // observer delivery cycle so localized labels cannot trigger a resize loop.
  let resizeFrame=0;
  new ResizeObserver(()=>{if(!resizeFrame)resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;resizeCanvas();});}).observe($('stage'));
  function eventPoint(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function contextElement(id,x,y){if(busy||drag||!state.objects.some(o=>o.id===id))return;stop(true);select(id);window.dispatchEvent(new CustomEvent('pencontextobject',{detail:{id,x,y}}));}
  function editElement(id){if(busy||drag||!state.objects.some(o=>o.id===id))return;stop(true);select(id);window.dispatchEvent(new CustomEvent('peneditobject',{detail:{id}}));}
  canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(busy||drag)return;const point=unproject(eventPoint(e)),hit=[...state.objects].reverse().find(o=>pointInObject(point,o));if(hit)contextElement(hit.id,e.clientX,e.clientY);});
  let dragFrame=0,wheelFrame=0;
  function previewDrag(){dragFrame=0;if(!drag)return;result=C.plan({...state,pen:{...state.pen,optimization:'off'}},designOptions());draw();}
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || busy) return; stop(true);clearTimeout(imageUpdateTimer);
    const screen = eventPoint(e), point = unproject(screen), handleHit = handles.find(h => C.distance(h.point, screen) < 12);
    let kind = handleHit?.kind;
    if (!kind) {
      const active = current();
      const hit = active && pointInObject(point, active) ? active : [...state.objects].reverse().find(o => pointInObject(point, o));
      if (hit) { selected = hit.id; kind = 'move'; } else { selected = 'paper'; kind = 'paperMove'; }
    }
    if (kind === 'paperMove' && !(point[0] >= state.paper.x && point[0] <= state.paper.x + state.paper.w && point[1] >= state.paper.y && point[1] <= state.paper.y + state.paper.h)) { select('paper'); return; }
    checkpoint(); drag = { kind, start: point, obj: current() ? clone(current()) : null, paper: clone(state.paper), geometry: current() ? C.geometry(current(),{paths:false}) : null };
    canvas.setPointerCapture(e.pointerId); renderLayers(); syncFields(); draw();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) { const p = eventPoint(e); canvas.style.cursor = handles.some(h => C.distance(h.point, p) < 12) ? 'nwse-resize' : 'default'; return; }
    const p = unproject(eventPoint(e)), dx = p[0] - drag.start[0], dy = p[1] - drag.start[1], snap = v => $('snap').checked ? Math.round(v) : C.round(v), o = current();
    if (drag.kind === 'paperMove') { const a=PenAlignment.settings(state),paperSnap=v=>a.snap?C.round(Math.round(v/a.spacing)*a.spacing):snap(v);state.paper.x = C.clamp(paperSnap(drag.paper.x + dx), -420, 420); state.paper.y = C.clamp(paperSnap(drag.paper.y + dy), -420, 420); }
    else if (drag.kind === 'paperResize') { state.paper.w = C.clamp(snap(drag.paper.w + dx), 10, 420); state.paper.h = C.clamp(snap(drag.paper.h + dy), 10, 420); }
    else if (o && drag.kind === 'move') { o.x = C.clamp(snap(drag.obj.x + dx), -500, 500); o.y = C.clamp(snap(drag.obj.y + dy), -500, 500); }
    else if (o && drag.kind === 'rotate') {
      const cx = state.paper.x + drag.obj.x + drag.geometry.w / 2, cy = state.paper.y + drag.obj.y + drag.geometry.h / 2;
      const angle = Math.atan2(p[1] - cy, p[0] - cx) * 180 / Math.PI + 90;
      o.rotation = e.shiftKey ? Math.round(angle / 15) * 15 : C.round(angle);
    } else if (o && drag.kind === 'resize') {
      const g = drag.geometry, center = [state.paper.x + drag.obj.x + g.w / 2, state.paper.y + drag.obj.y + g.h / 2];
      const rad = -drag.obj.rotation * Math.PI / 180, rx = (p[0]-center[0])*Math.cos(rad)-(p[1]-center[1])*Math.sin(rad), ry = (p[0]-center[0])*Math.sin(rad)+(p[1]-center[1])*Math.cos(rad);
      const scale = C.clamp((rx*g.w/2+ry*g.h/2)/Math.max(.001,(g.w*g.w+g.h*g.h)/4), .02, 10);
      if (o.type === 'text') { const ratio = C.clamp(drag.obj.size * scale, 2, 50) / drag.obj.size; o.size = C.round(drag.obj.size * ratio); o.spacing = C.clamp(drag.obj.spacing * ratio, 0, 10); o.wrap = C.clamp(drag.obj.wrap * ratio, 5, 400); }
      else if ($('lockRatio').checked) { const ratio = C.clamp(scale, Math.max(1/g.w,1/g.h), Math.min(500/g.w,500/g.h)); o.w = g.w*ratio; o.h = g.h*ratio; }
      else { o.w=C.clamp(rx*2,1,500);o.h=C.clamp(ry*2,1,500); }
      const ng = C.geometry(o,{paths:false}); o.x = C.clamp(drag.obj.x + (g.w - ng.w) / 2,-500,500); o.y = C.clamp(drag.obj.y + (g.h - ng.h) / 2,-500,500);
    }
    if(!dragFrame)dragFrame=requestAnimationFrame(previewDrag);
  });
  const endDrag = () => { if (drag) {cancelAnimationFrame(dragFrame);dragFrame=0;drag = null; refresh(); } };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = C.clamp(zoom * (e.deltaY > 0 ? .91 : 1.1), .5, 3);if(!wheelFrame)wheelFrame=requestAnimationFrame(()=>{wheelFrame=0;draw();}); }, { passive: false });
  $('fit').onclick = () => { zoom = 1;scene.reset();draw(); };
  function setView(v) { view = v;for(const [id,mode] of [['topView','top'],['tiltView','tilt'],['sceneView','scene']]){$(id).classList.toggle('active',v===mode);$(id).setAttribute('aria-pressed',String(v===mode));}canvas.hidden=v==='scene';for(const id of ['sceneCanvas','sceneControls','sceneHud'])$(id).hidden=v!=='scene';$('stage').classList.toggle('is-3d',v==='scene');document.querySelector('.stage-guide').textContent=v==='scene'?'拖动旋转视角 · 滚轮缩放 · 双击复位 · 此处不移动机器':'拖动定位 · 角点缩放 · 顶点旋转 · 滚轮缩放';draw(); }
  $('topView').onclick = () => setView('top'); $('tiltView').onclick = () => setView('tilt'); $('showTravel').onchange = draw;$('sceneView').onclick=()=>setView('scene');$('resetCamera').onclick=()=>scene.reset();$('showHolder').onchange=draw;$('exaggerateLift').onchange=draw;
  function resetSafe() { state.safe = { x: 5, y: 5, w: state.machine.w-10, h: state.machine.h-10 }; }
  $('printerModel').onchange = () => { const model = $('printerModel').value; mutate(() => { const preset = C.profiles[model]; state.machine = { model, w: model==='custom'?state.machine.w:preset.w, h:model==='custom'?state.machine.h:preset.h, plate:state.machine.plate }; resetSafe(); }); zoom=1;draw();toast('已切换设计配置；纸张与内容位置保留，可写区已重置，需重新检查'); };
  numeric('bedW',null,v=>{if(state.machine.model!=='custom')throw Error('请先选择自定义画板');state.machine.w=v;resetSafe();});
  numeric('bedH',null,v=>{if(state.machine.model!=='custom')throw Error('请先选择自定义画板');state.machine.h=v;resetSafe();});
  $('plateType').onchange=()=>mutate(()=>{state.machine.plate=$('plateType').value;});
  $('centerPaper').onclick=()=>mutate(()=>{state.paper.x=(state.machine.w-state.paper.w)/2;state.paper.y=(state.machine.h-state.paper.h)/2;});
  $('newProject').onclick=()=>{mutate(()=>{state.objects=[];selected='paper';});toast('已清空画布；纸张与机型设置保留，可撤销恢复');};
  $('selectPaper').onclick = () => select('paper');
  for (const [id, key] of [['paperW', 'w'], ['paperH', 'h'], ['paperX', 'x'], ['paperY', 'y'], ['margin', 'margin']]) numeric(id, null, v => { state.paper[key] = v; $('paperPreset').value = 'custom'; });
  $('paperPreset').onchange = () => { const sizes = { note: [100, 100], postcard: [100, 148], a6: [105, 148], square: [160, 160], a4: [210, 297] }, s = sizes[$('paperPreset').value]; if (s) mutate(() => { state.paper.w = s[0]; state.paper.h = s[1]; state.paper.x = (state.machine.w - s[0]) / 2; state.paper.y = (state.machine.h - s[1]) / 2; }); };
  for(const [button,draw,travel,zSpeed,liftSpeed] of [['balancedSpeed',40,80,5,10],['fastSpeed',80,150,8,20],['fasterSpeed',120,200,10,25]])$(button).onclick=()=>{mutate(()=>{state.pen.drawSpeed=draw;state.pen.travelSpeed=travel;});if(window.PenMachineUI){const p=PenMachineUI.getProfile();PenMachineUI.setProfile({...p,zSpeed,liftSpeed:Math.min(liftSpeed,PenSpeedPolicy.limits(state.pen,state.machine).lift)},p.confirmed);}};
  // Pen width is committed by brush-settings-ui only after preset persistence.
  for (const [id, key] of [['drawSpeed', 'drawSpeed'], ['travelSpeed', 'travelSpeed'], ['lift', 'lift']]) numeric(id, null, v => { state.pen[key] = v; });
  for(const [id,key] of [['liftSpeed','liftSpeed'],['lowerSpeed','zSpeed']])$(id).onchange=()=>{const v=Number($(id).value);if(!$(id).value.trim()||!Number.isFinite(v)||v<.1||v>(key==='liftSpeed'?PenSpeedPolicy.limits(state.pen,state.machine).lift:15)){toast('请输入范围内的速度');syncFields();return;}const p=PenMachineUI.getProfile();PenMachineUI.setProfile({...p,[key]:v},p.confirmed);};
  numeric('safeX', null, v => { const right = state.safe.x + state.safe.w; if(v>=right)throw Error('左边界必须小于右边界');state.safe.x = v; state.safe.w = right - v; });
  numeric('safeY', null, v => { const bottom = state.safe.y + state.safe.h; if(v>=bottom)throw Error('上边界必须小于下边界');state.safe.y = v; state.safe.h = bottom - v; });
  numeric('safeRight', null, v => { if(v<=state.safe.x)throw Error('右边界必须大于左边界');state.safe.w = v - state.safe.x; }); numeric('safeBottom', null, v => { if(v<=state.safe.y)throw Error('下边界必须大于上边界');state.safe.h = v - state.safe.y; });
  for (const [id, key] of [['objX', 'x'], ['objY', 'y'], ['rotation', 'rotation'], ['fontSize', 'size'], ['letterSpacing', 'spacing'], ['lineHeight', 'leading'], ['wrapWidth', 'wrap']]) numeric(id, null, v => { const o = current(); if (o) o[key] = v; });
  function dimension(key, value) {
    const o = current(); if (!o) return;
    const g = C.geometry(o,{paths:false}), ratio = value / g[key];
    if (o.type === 'text') { const r = C.clamp(o.size * ratio, 2, 50) / o.size; o.size = C.round(o.size * r); o.spacing = C.clamp(o.spacing * r, 0, 10); o.wrap = C.clamp(o.wrap * r, 5, 400); }
    else {
      if ($('lockRatio').checked) { const r=C.clamp(ratio,Math.max(1/o.w,1/o.h),Math.min(500/o.w,500/o.h));o.w*=r;o.h*=r; }
      else o[key]=value;
    }
  }
  numeric('objW', null, v => dimension('w', v)); numeric('objH', null, v => dimension('h', v));
  let textCheckpoint = false;
  $('textContent').onfocus = () => { textCheckpoint = false; };
  $('textContent').oninput = () => { const o = current(); if (o?.type !== 'text') return; if (!textCheckpoint) { checkpoint(); textCheckpoint = true; } o.text = $('textContent').value.slice(0,1200); refresh({ keepInspector: true }); const g=C.geometry(o,{paths:false});$('objW').value=C.round(g.w);$('objH').value=C.round(g.h); };
  for (const [id, key] of [['font', 'font'], ['align', 'align'], ['color', 'color']]) $(id).onchange = () => { const o = current(); if (o) mutate(() => { o[key] = $(id).value; }); };
  $('centerObject').onclick = () => { const o = current(); if (o) mutate(() => { const g = C.geometry(o,{paths:false}); o.x = (state.paper.w - g.w) / 2; o.y = (state.paper.h - g.h) / 2; }); };
  function add(obj) {
    if (state.objects.length >= 100) { toast('最多支持 100 个图层'); return; }
    try { C.validateProject({...state,objects:[...state.objects,obj]}); } catch(e) { toast('无法添加：'+e.message);return; }
    mutate(() => { state.objects.push(obj); selected = obj.id; });
  }
  $('addText').onclick = () => { const o = C.newText(); o.wrap = C.clamp(state.paper.w - state.paper.margin * 2,5,400); o.x = state.paper.margin + 1; o.y = state.paper.margin + 1; add(o); $('textContent').focus(); $('textContent').select(); };
  $('addFlower').onclick = () => { const f = C.flowerPaths(); add({ id: C.uid(), type: 'shape', name: '线条花朵', paths: f.paths, x: 15, y: 20, w: 40 * f.ratio, h: 40, rotation: 0, color: '#517650' }); };
  $('addFrame').onclick = () => { const m = state.paper.margin + 2; add({ id: C.uid(), type: 'shape', name: '纸内边框', paths: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], x: m, y: m, w: Math.max(1, state.paper.w - m * 2), h: Math.max(1, state.paper.h - m * 2), rotation: 0, color: '#57755d' }); };
  function remove() { if (!current()) return; mutate(() => { state.objects = state.objects.filter(o => o.id !== selected); selected = state.objects.at(-1)?.id || 'paper'; }); }
  function duplicate() { const o = current(); if (!o) return; const copy = clone(o); copy.id = C.uid(); copy.x = C.clamp(copy.x + 4, -500, 500); copy.y = C.clamp(copy.y + 4, -500, 500); add(copy); }
  $('remove').onclick = remove; $('duplicate').onclick = duplicate;
  function reorder(delta) { const index = state.objects.findIndex(o => o.id === selected), next = index + delta; if (index < 0 || next < 0 || next >= state.objects.length) return; mutate(() => { const [o] = state.objects.splice(index, 1); state.objects.splice(next, 0, o); }); }
  $('layerUp').onclick = () => reorder(-1); $('layerDown').onclick = () => reorder(1);
  function undo(redo = false) { const from = redo ? future : history, to = redo ? history : future; if (!from.length) return; to.push(snapshot()); state = JSON.parse(from.pop()); if (!current()) selected = state.objects[0]?.id || 'paper'; refresh(); }
  $('undo').onclick = () => undo(); $('redo').onclick = () => undo(true);
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.querySelector('dialog[open]') || document.getElementById('objectContextMenu')?.hidden===false || busy) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
    else if (e.key.startsWith('Arrow')) { const o = current(); if (!o) return; e.preventDefault(); const amount = e.shiftKey ? 5 : 1; mutate(() => { if (e.key === 'ArrowLeft') o.x -= amount; if (e.key === 'ArrowRight') o.x += amount; if (e.key === 'ArrowUp') o.y -= amount; if (e.key === 'ArrowDown') o.y += amount; o.x = C.clamp(o.x, -500, 500); o.y = C.clamp(o.y, -500, 500); }); }
  });
  $('pathOptimization').onchange=()=>mutate(()=>{state.pen.optimization=$('pathOptimization').value;});
  function stepStroke(direction){
    stop();const starts=result.segments.filter(s=>s.kind==='down'&&s.phase==='plot'), ends=result.segments.filter(s=>s.kind==='up'&&s.phase==='plot').map(s=>s.t);
    if(!starts.length)return;let index=previewActive?ends.findIndex(t=>t>=elapsed-1e-6):-1;
    if(index<0)index=direction>0?-1:starts.length;
    index=C.clamp(index+direction,0,starts.length-1);elapsed=ends[index];previewActive=true;
    $('progress').value=result.duration?elapsed/result.duration*1000:0;$('strokeStep').textContent='第 '+(index+1)+' / '+starts.length+' 笔';draw();
  }
  $('prevStroke').onclick=()=>stepStroke(-1);$('nextStroke').onclick=()=>stepStroke(1);
  $('play').onclick = () => { if (playing) { stop(); draw(); return; } if (!result.segments.length) return; if (elapsed >= result.duration) elapsed = 0; playing = true; previewActive = true; lastFrame = performance.now(); $('play').textContent = 'Ⅱ 暂停'; frameId=requestAnimationFrame(animate); };
  function animate(now) { if (!playing) return; elapsed = Math.min(result.duration, elapsed + Math.min(.1, (now - lastFrame) / 1000) * Number($('playSpeed').value)); lastFrame = now; $('progress').value = result.duration ? elapsed / result.duration * 1000 : 0; draw(); if (elapsed >= result.duration) stop(); else frameId=requestAnimationFrame(animate); }
  $('progress').oninput = () => { stop(); elapsed = result.duration * Number($('progress').value) / 1000; previewActive = true; draw(); };
  $('restart').onclick = () => { stop(true); draw(); };
  async function runBusy(fn) {
    if (busy) return; busy = true; stop(true); document.body.classList.add('busy');
    const panels = [...document.querySelectorAll('aside,header,.toolbar,.preview-panel')]; panels.forEach(p => { p.inert = true; });
    await new Promise(r => setTimeout(r, 35));
    try { await fn(); } catch (error) { fault(error); toast(error.message || '处理失败'); } finally { busy = false; document.body.classList.remove('busy'); panels.forEach(p => { p.inert = false; }); }
  }
  function imagePlacement(){
    const p=state.paper,m=p.margin;let x=p.x+m,y=p.y+m,right=p.x+p.w-m,bottom=p.y+p.h-m;
    for(const box of [state.safe,motion?.reachable].filter(Boolean)){x=Math.max(x,box.x);y=Math.max(y,box.y);right=Math.min(right,box.x+box.w);bottom=Math.min(bottom,box.y+box.h);}
    if(right-x<1||bottom-y<1)throw Error('纸张与当前可写区域没有足够交集，请先调整纸张位置');
    return {x:x-p.x,y:y-p.y,w:right-x,h:bottom-y};
  }
  async function importFiles(files,at){
    await runBusy(async()=>{for(const file of files){
      if(state.objects.length>=100)throw Error('图层已满，最多100个');if(file.size>10000000)throw Error('单个图案请控制在10 MB以内');
      const ext=file.name.split('.').pop().toLowerCase(),place=imagePlacement();let o;
      if(ext==='svg'){const data=PenImport.svg(await file.text());let w=Math.min(120,place.w,place.h*data.ratio),h=w/data.ratio;if(w<1||h<1){const grow=Math.max(1/w,1/h);w*=grow;h*=grow;}if(w>500||h>500)throw Error('图案比例过于极端');o={type:'svg',name:file.name,paths:data.paths,w,h,...(data.preserveStrokes===true?{preserveStrokes:true}:{})};}
      else if(['png','jpg','jpeg','webp'].includes(ext)){const data=await PenImageTrace.open(file,{maxWidth:Math.min(120,place.w),maxHeight:Math.min(150,place.h)});if(!data)break;o={...data,type:'image'};}
      else throw Error('支持PNG、JPG、WebP和SVG图案');
      Object.assign(o,{id:C.uid(),x:at?at[0]-state.paper.x-o.w/2:place.x+(place.w-o.w)/2,y:at?at[1]-state.paper.y-o.h/2:place.y+(place.h-o.h)/2,rotation:0,color:o.mode==='natural'?'#000000':'#243d32'});
      o.x=C.clamp(o.x,-500,500);o.y=C.clamp(o.y,-500,500);C.validateProject({...state,objects:[...state.objects,o]});add(o);toast('路径已加入纸张，可拖动、缩放、预演或导出SVG');
    }});
  }
  $('importImage').onclick = () => $('imageFile').click(); $('imageFile').onchange = () => { importFiles([...$('imageFile').files]); $('imageFile').value = ''; };
  $('stage').addEventListener('dragover', e => { e.preventDefault(); if (!busy) $('stage').classList.add('drag-over'); });
  $('stage').addEventListener('dragleave', e => { if (!$('stage').contains(e.relatedTarget)) $('stage').classList.remove('drag-over'); });
  $('stage').addEventListener('drop', e => { e.preventDefault(); $('stage').classList.remove('drag-over'); if (!busy) importFiles([...e.dataTransfer.files], unproject(eventPoint(e))); });
  document.addEventListener('dragover', e => e.preventDefault()); document.addEventListener('drop', e => e.preventDefault());
  $('threshold').oninput = () => { $('thresholdValue').textContent = $('threshold').value; };
  $('threshold').onchange=()=>{const o=current();if(o?.type==='image')mutate(()=>{o.threshold=Number($('threshold').value);});};
  $('traceMode').onchange=()=>{const o=current();if(o?.type==='image')mutate(()=>{o.mode=$('traceMode').value;if(o.mode==='natural')o.brush=PenNaturalOptions.normalize(o.brush||{style:'refined',strokeWidth:state.pen.width},{detail:o.detail});});};
  numeric('hatchGap',null,v=>{const o=current();if(o?.type==='image')o.gap=v;});
  $('editImageConversion').onclick=()=>{const o=current();if(o?.type!=='image')return;runBusy(async()=>{const data=await PenImageTrace.open(o,{width:o.w,mode:o.mode,threshold:o.threshold,gap:o.gap,detail:o.detail,cleanup:o.cleanup,brush:o.brush,edit:true});if(data){C.validateProject({...state,objects:state.objects.map(x=>x.id===o.id?{...o,...data}:x)});mutate(()=>Object.assign(o,data));}});};
  $('retrace').onclick = () => {
    const o = current(); if (o?.type !== 'image') return;
    const mode = $('traceMode').value, threshold = Number($('threshold').value), gap = Number($('hatchGap').value);
    if(mode==='natural'){$('editImageConversion').click();return;}
    if (!Number.isFinite(gap) || gap < .3) { toast('排线间距须不小于 0.3 mm'); return; }
    runBusy(async () => { const data = await PenImport.raster(o.source, mode, threshold, gap, o.w, o.h,{detail:o.detail||320,cleanup:o.cleanup??0,strokeWidth:state.pen.width}); mutate(() => { o.paths = data.paths; o.mode = mode; o.threshold = threshold; o.gap = gap;o.trace={mode,threshold,gap,w:o.w,h:o.h,detail:o.detail||320,cleanup:o.cleanup??0,strokeWidth:data.strokeWidth,algorithm:'opaque-ink-v2'}; }); toast('路径已更新'); });
  };

  // Geometry-only edits reuse image paths. Only changed conversion inputs reach
  // the worker; a late worker result never overwrites a newer edit or deletion.
  function imageKey(o){return JSON.stringify({source:o.source,mode:o.mode,threshold:o.threshold,gap:o.gap,w:o.w,h:o.h,detail:o.detail,cleanup:o.cleanup,brush:o.brush,strokeWidth:o.strokeWidth});}
  function scheduleImagePaths(){clearTimeout(imageUpdateTimer);if(state.objects.some(C.traceStale)&&!imageUpdatePromise)imageUpdateTimer=setTimeout(()=>ensureImagePaths().catch(e=>toast('路径更新失败：'+e.message)),220);}
  function ensureImagePaths(){
    clearTimeout(imageUpdateTimer);if(imageUpdatePromise)return imageUpdatePromise;
    imageUpdateError='';
    imageUpdatePromise=(async()=>{while(true){
      const o=state.objects.find(C.traceStale);if(!o)return;const id=o.id,key=imageKey(o),input=clone(o);
      let data;try{data=await PenImport.raster(input.source,input.mode,input.threshold,input.gap,input.w,input.h,{detail:input.detail||320,cleanup:input.cleanup??0,brush:input.brush,strokeWidth:input.strokeWidth});}catch(e){const now=state.objects.find(x=>x.id===id);if(!now||imageKey(now)!==key)continue;throw e;}
      const now=state.objects.find(x=>x.id===id);if(!now||imageKey(now)!==key)continue;
      const updated={...now,paths:data.paths,...(data.brush?{brush:data.brush}:{}),trace:{mode:input.mode,threshold:input.threshold,gap:input.gap,w:input.w,h:input.h,detail:input.detail||320,cleanup:input.cleanup??0,strokeWidth:data.strokeWidth,algorithm:'opaque-ink-v2',...(data.brush?{brush:data.brush}:{})}};
      C.validateProject({...state,objects:state.objects.map(x=>x.id===id?updated:x)});Object.assign(now,updated);refresh({derivedPaths:true});
    }})().catch(e=>{imageUpdateError=e.message;throw e;}).finally(()=>{imageUpdatePromise=null;});return imageUpdatePromise;
  }
  function download(name, content, mime) { const url = URL.createObjectURL(new Blob([content], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  $('saveProject').onclick = () => { try{C.validateProject(state);const json=JSON.stringify(state);if(new Blob([json]).size>30000000)throw Error('作品超过 30 MB，请拆分后保存');download('纸上作品.a1pen.json', json, 'application/json'); toast('作品已导出，可继续编辑；这不是打印机文件');}catch(e){fault(e);toast('保存失败：'+e.message);} };
  $('openProject').onclick = () => $('projectFile').click();
  $('projectFile').onchange = async () => {
    const file = $('projectFile').files[0]; $('projectFile').value = ''; if (!file) return;
    await runBusy(async()=>{if (file.size > 30000000) throw Error('作品文件请小于 30 MB'); const loaded = C.validateProject(JSON.parse(await file.text())); checkpoint(); state = loaded; selected = state.objects[0]?.id || 'paper'; zoom = 1; refresh(); toast('作品已打开，可撤销返回上一份');});
  };
  $('exportSvg').onclick = async () => { try { await ensureImagePaths(); download('纸上笔迹.svg', C.toSVG(state,designOptions()), 'image/svg+xml'); toast('已导出毫米单位 SVG；用于矢量软件，不能直接在打印机上运行'); } catch (e) { fault(e);toast(e.message); } };
  $('exportPlan').onclick = async () => {
    try{await ensureImagePaths();download('纸上路径.plan.json', JSON.stringify(C.toDesignPlan(state,designOptions())), 'application/json');toast('已导出设计路径，不是可执行的 G-code / 3MF');}catch(e){fault(e);toast(e.message);}
  };
  $('exportInfo').onclick=()=>{$('exportDialog').showModal();};$('closeExport').onclick=()=>{$('exportDialog').close();};
  $('saveFromDialog').onclick=()=>$('saveProject').click();$('svgFromDialog').onclick=()=>$('exportSvg').click();$('planFromDialog').onclick=()=>$('exportPlan').click();
  $('help').onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
  // Read-only test access, also useful when developing the next hardware stage.
  function setPenSettings(settings) { const next=C.validateProject({...state,pen:{...state.pen,...settings}}).pen;mutate(()=>{state.pen=next;});return clone(state.pen); }
  function replaceProject(next){const validated=C.validateProject(next);mutate(()=>{state=validated;selected=state.objects[0]?.id||'paper';zoom=1;});}
  function setAlignment(next){const a=PenAlignment.normalize(next,state.machine);mutate(()=>{state.alignment=a;});}
  function setPaper(paper){const next=C.validateProject({...state,paper:{...state.paper,...paper}}).paper;mutate(()=>{state.paper=next;selected='paper';});}
  function upsertFrame(frame,existing){const index=state.objects.findIndex(o=>o.id===frame.id);if(existing&&(index<0||!state.objects[index].frame))throw Error('边框已变化，请重新选择');const objects=existing?state.objects.map(o=>o.id===frame.id?frame:o):[...state.objects,frame];const next=C.validateProject({...state,objects});mutate(()=>{state=next;selected=frame.id;});}
  let validationCache=null;
  function getDesignErrors(profile){const key=JSON.stringify(profile);if(!validationCache||validationCache.plan!==result||validationCache.key!==key)validationCache={plan:result,key,errors:PenMachine.projectDesign(state,profile,result).errors};return validationCache.errors.slice();}
  function getSettings(){return clone({machine:state.machine,paper:state.paper,pen:state.pen,safe:state.safe});}
  function getObjectInfo(id){const o=state.objects.find(o=>o.id===id);return o?{id:o.id,type:o.type,name:o.name}:null;}
  window.PenStudio = { getSettings,getDesignErrors,getObjectInfo, editElement,upsertFrame, replaceProject,setAlignment,setPaper,ensureImagePaths,getImagePathStatus:()=>({pending:!!imageUpdatePromise,error:imageUpdateError}), getState: () => clone(state), setPenSettings, getPlan: () => ({ ...result, badIds: [...result.badIds] }), importFiles, project: point => project(point), getMotion:()=>motion, getPlayback:()=>({elapsed,playing,view,active:previewActive}), getScene:()=>scene, getSelected: () => selected, getHandles:()=>clone(handles) };
  function paramsChanged(){if(!result||drag)return;let profile=null;try{profile=window.PenMachineUI?.getProfile();}catch{}const key=JSON.stringify({profile,position:connection?.position,park:connection?.wizard?.returnTo});if(key===motionKey)return;stop(true);result=C.plan(state,designOptions());rebuildMotion();updateMetrics(false);syncFields();draw();}
  window.addEventListener('penmachinechange',paramsChanged);window.addEventListener('penconnection',e=>{if(!e.detail.busy){connection=e.detail;paramsChanged();}});
  refresh(); resizeCanvas();
})();
