/* Converts the current drawing to a motion-only segment in machine coordinates.
   No connection, homing, heater, extrusion, or arbitrary command interface. */
(function(root){
  'use strict';
  const C=root.PenCore||(typeof require==='function'?require('./core.js'):null), finite=Number.isFinite, clone=v=>JSON.parse(JSON.stringify(v));
  // Same cooling-fan off commands used by the official A1 mini templates.
  const fanOffCommands=Object.freeze(['M106 S0','M106 P2 S0','M106 P3 S0']);
  const numeric=['refX','refY','machineX','machineY','downZ','upZ','zSpeed'];
  function defaults(state){const p={format:'a1-pen-machine-profile',version:1,name:'校准配置',material:'卡纸',machine:clone(state.machine),refX:state.paper.x,refY:state.paper.y,machineX:null,machineY:null,xSign:null,ySign:null,downZ:null,upZ:null,zSpeed:5,liftSpeed:20,confirmed:false};return state.machine.model==='custom'?p:fromFrontMount(p,37.5,0);}
  function validateProfile(v){
    if(!v||v.format!=='a1-pen-machine-profile'||v.version!==1)throw Error('不是有效的笔架参数文件');
    const m=v.machine;
    if(!m||!Object.hasOwn(C.profiles,m.model)||!['smooth','textured','custom'].includes(m.plate)||!finite(m.w)||!finite(m.h)||m.w<20||m.h<20||m.w>500||m.h>500)throw Error('参数中的机型无效');
    if(m.model!=='custom'&&(m.w!==C.profiles[m.model].w||m.h!==C.profiles[m.model].h))throw Error('机型尺寸不匹配');
    const p={format:v.format,version:1,machine:{model:m.model,w:m.w,h:m.h,plate:m.plate},name:String(v.name||'校准配置').slice(0,80),material:String(v.material||'未记录').slice(0,80),confirmed:v.confirmed===true};
    for(const k of numeric){if(v[k]!==null&&(!finite(v[k])||Math.abs(v[k])>1000))throw Error('笔架参数 '+k+' 必须为有限数字或留空');p[k]=v[k];}
    p.liftSpeed=v.liftSpeed===undefined?v.zSpeed:v.liftSpeed;
    if(p.liftSpeed!==null&&(!finite(p.liftSpeed)||Math.abs(p.liftSpeed)>1000))throw Error('抬笔速度必须为有限数字或留空');
    for(const k of ['xSign','ySign']){if(v[k]!==null&&v[k]!==1&&v[k]!==-1)throw Error('坐标方向无效');p[k]=v[k];}
    const oldLocal=Math.abs(p.refX-65.64285714285714)<1e-8&&p.refY===85&&p.machineX===100&&p.machineY===90&&p.xSign===1&&p.ySign===-1;
    if(v.xyReference!==undefined&&!['local-test','measured','unspecified'].includes(v.xyReference))throw Error('XY参考来源无效');
    p.xyReference=v.xyReference|| (oldLocal?'local-test':'unspecified');
    return p;
  }
  function fromFrontMount(input,front,lateral){
    const p=validateProfile(input);
    if(!finite(front)||front<=0||front>100||!finite(lateral)||Math.abs(lateral)>100)throw Error('请输入真实的笔尖前向距离（0–100 mm）和横向偏移');
    // Board Y increases towards the front. Machine Y increases towards the rear.
    // pen = nozzle + [lateral, -front], hence nozzle = desiredPen - offset.
    p.refX=p.machine.w/2;p.refY=p.machine.h/2;p.machineX=p.refX-lateral;p.machineY=p.machine.h-p.refY+front;p.xSign=1;p.ySign=-1;
    if(p.machineX<0||p.machineX>p.machine.w||p.machineY>p.machine.h)throw Error('该笔尖偏移使参考点超出机器行程');
    p.xyReference='measured';p.confirmed=false;return p;
  }
  const machineMatch=(a,b)=>['model','w','h','plate'].every(k=>a[k]===b[k]);
  // Capturing nozzle coordinates with the PEN over a known board point already
  // includes the pen-holder offset. Do not add a second offset to this mapping.
  function map(point,p){return [p.machineX+p.xSign*(point[0]-p.refX),p.machineY+p.ySign*(point[1]-p.refY)];}
  const fmt=n=>C.round(n).toFixed(3);
  function reachable(input,machine){
    let p;try{p=validateProfile(input);}catch{return null;}
    if(!machineMatch(p.machine,machine)||!['refX','refY','machineX','machineY','xSign','ySign'].every(k=>finite(p[k]))||!p.xSign||!p.ySign)return null;
    const a=[p.refX-p.machineX/p.xSign,p.refY-p.machineY/p.ySign],b=[p.refX+(machine.w-p.machineX)/p.xSign,p.refY+(machine.h-p.machineY)/p.ySign];
    const x=Math.max(0,Math.min(a[0],b[0])),y=Math.max(0,Math.min(a[1],b[1]));
    return {x,y,w:Math.max(0,Math.min(machine.w,Math.max(a[0],b[0]))-x),h:Math.max(0,Math.min(machine.h,Math.max(a[1],b[1]))-y)};
  }
  function plan(state,input){
    try{state=C.validateProject(state);return projectDesign(state,input,C.plan(state,{timeline:false,clipRect:reachable(input,state.machine)}));}catch(e){return {errors:['作品参数无效：'+e.message],paths:[],design:null};}
  }
  // Rendering may reuse geometry from the current document. Export and send
  // always enter through plan(), which validates and rebuilds from the document.
  function projectDesign(state,input,design){
    const errors=[];let p;
    try{p=validateProfile(input)}catch(e){return {errors:[e.message],paths:[],design};}
    const area=reachable(p,state.machine),radius=state.pen.width/2;
    if(area&&design.paths.some(s=>s.points.some(([x,y])=>x<area.x+radius-1e-6||x>area.x+area.w-radius+1e-6||y<area.y+radius-1e-6||y>area.y+area.h-radius+1e-6)))design=C.plan(state,{timeline:false,clipRect:area});
    errors.push(...design.errors);
    if(!machineMatch(p.machine,state.machine))errors.push('当前机型、画板尺寸或板面与笔架参数不一致，请重新核对');
    if(!['a1-mini','a1'].includes(state.machine.model))errors.push('此机型目前支持排版与 SVG / 路径导出，尚未适配机器指令与校准');
    const labels={refX:'参考点画板 X',refY:'参考点画板 Y',machineX:'参考点喷嘴 X',machineY:'参考点喷嘴 Y',xSign:'X 方向',ySign:'Y 方向',downZ:'落笔 Z',upZ:'抬笔 Z',zSpeed:'落笔速度'};
    for(const [k,label] of Object.entries(labels))if(p[k]===null)errors.push('请填写或选择：'+label);
    const maxZ=state.machine.model==='a1'?256:180;
    if(p.refX!==null&&(p.refX<0||p.refX>state.machine.w)||p.refY!==null&&(p.refY<0||p.refY>state.machine.h))errors.push('参考点必须位于设计画板内');
    if(p.machineX!==null&&(p.machineX<0||p.machineX>state.machine.w)||p.machineY!==null&&(p.machineY<0||p.machineY>state.machine.h))errors.push('实测参考点喷嘴坐标超出所选机型范围');
    if(p.downZ!==null&&(p.downZ<0||p.downZ>maxZ)||p.upZ!==null&&(p.upZ<0||p.upZ>maxZ))errors.push('Z 高度超出所选机型范围');
    if(p.downZ!==null&&p.upZ!==null&&C.round(p.upZ)-C.round(p.downZ)<.5-1e-7)errors.push('抬笔 Z 至少比落笔 Z 高 0.5 mm');
    if(p.zSpeed!==null&&(p.zSpeed<.1||p.zSpeed>15))errors.push('落笔速度须在 0.1–15 mm/s 之间');
    if(p.liftSpeed===null||p.liftSpeed<.1||p.liftSpeed>30)errors.push('抬笔速度须在 0.1–30 mm/s 之间');
    if(errors.length)return {errors:[...new Set(errors)],paths:[],design,profile:p};
    // Check the exact rounded coordinates that will be serialized.
    const paths=design.paths.map(s=>({id:s.id,color:s.color,type:s.type,points:s.points.map(v=>map(v,p).map(C.round))}));
    const out=paths.some(s=>s.points.some(([x,y])=>!finite(x)||!finite(y)||x<0||x>state.machine.w||y<0||y>state.machine.h));
    if(out)errors.push('补偿后的喷嘴路径超出机器 XY 行程，请移动纸张/图案或修正参考点');
    const start=paths.length?{x:paths[0].points[0][0],y:paths[0].points[0][1],z:C.round(p.upZ)}:null;
    return {errors:[...new Set(errors)],paths,design,profile:p,start,bounds:C.bounds(paths.map(s=>s.points)),confirmed:p.confirmed,
      offset:{x:C.round(p.machineX-p.xSign*p.refX),y:C.round(p.machineY-p.ySign*p.refY)}};
  }
  function toGcode(state,input){
    // No cached plan accepted: every export reflects current paper and artwork.
    const r=plan(state,input);
    if(r.errors.length)throw Error(r.errors.join('；'));
    if(!r.confirmed)throw Error('请先确认本组参考点、方向和 Z 高度是实测值');
    if(r.profile.xyReference==='local-test')throw Error('当前XY仍是Hello World局部试写基准，尚未标定笔尖与画板位置；Z校准不能代替XY对位');
    const p=r.profile,lines=[
      '; Bambu Pen Studio 0.20.0 - DRAWING SEGMENT ONLY',
      '; Not a standalone Bambu print job. No startup or homing included.',
      '; PRECONDITION: machine already homed, same coordinate frame as calibration.',
      `; PRECONDITION: nozzle already positioned at X${fmt(r.start.x)} Y${fmt(r.start.y)} Z${fmt(r.start.z)} before this segment.`,
      '; PRECONDITION: pen/paper setup unchanged; entire pen-up route clear of obstacles.',
      '; One physical pen; preview colors do not trigger pen changes.',
      `; Paper board origin ${fmt(state.paper.x)},${fmt(state.paper.y)}; size ${fmt(state.paper.w)}x${fmt(state.paper.h)} mm`,
      `; Board reference ${fmt(p.refX)},${fmt(p.refY)} => nozzle ${fmt(p.machineX)},${fmt(p.machineY)}`,
      `; Axes ${p.xSign},${p.ySign}; down Z${fmt(p.downZ)}; up Z${fmt(p.upZ)}`,
      'G21','G90',...fanOffCommands
    ];
    const T=root.PenTrajectory||(typeof require==='function'?require('./trajectory.js'):null);
    const model=T.build(r.paths,{...state.pen,downZ:p.downZ,upZ:p.upZ,zSpeed:p.zSpeed,liftSpeed:p.liftSpeed},r.start,r.start);
    for(const move of model.moves)lines.push(T.gcode(move));
    lines.push('M400','; End: back at segment start, pen up. Motors remain enabled.');
    return lines.join('\n')+'\n';
  }
  root.PenMachine={reachable,defaults,validateProfile,fromFrontMount,machineMatch,map,plan,projectDesign,toGcode,fanOffCommands};
  if(typeof module!=='undefined')module.exports=root.PenMachine;
})(typeof window!=='undefined'?window:globalThis);
