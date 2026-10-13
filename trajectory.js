/* Shared, side-effect-free movement model for preview and machine streaming. */
(function(root){
 'use strict';
 const round=n=>Math.round(n*1000)/1000,keys=['x','y','z'];
 function compactLinear(points){
  const out=[];for(const p of points){const q=[Math.round(p[0]*1000),Math.round(p[1]*1000)],last=out.at(-1);if(last&&q[0]===last[0]&&q[1]===last[1])continue;
   while(out.length>1){const a=out.at(-2),b=out.at(-1),ab=[b[0]-a[0],b[1]-a[1]],bc=[q[0]-b[0],q[1]-b[1]];if(ab[0]*bc[1]!==ab[1]*bc[0]||ab[0]*bc[0]+ab[1]*bc[1]<0)break;out.pop();}out.push(q);
  }return out.map(p=>[p[0]/1000,p[1]/1000]);
 }
 function point(p){const q={};for(const k of keys){if(!Number.isFinite(p?.[k]))throw Error('运动坐标必须是有限数字');q[k]=round(p[k]);}return q;}
 function movement(from,target,speed,kind,phase='plot',stroke=-1,color='#235d55'){
  if(!Number.isFinite(speed)||speed<=0)throw Error('运动速度必须大于0');
  const a=point(from),b=point({...from,...target}),seconds=Math.hypot(...keys.map(k=>b[k]-a[k]))/speed;
  return {from:a,end:b,speed,seconds,kind,phase,stroke,color};
 }
 function returnMoves(from,target,speed,liftSpeed=5){
  let p=point(from);target=point(target);const moves=[];
  function z(to){while(Math.abs(p.z-to)>.0001){const end=round(p.z+Math.sign(to-p.z)*Math.min(50,Math.abs(to-p.z))),delta=Math.abs(end-p.z),m=movement(p,{z:end},end>p.z?liftSpeed:delta>1?5:delta<=.5?.5:1,end>p.z?'up':'down','return');moves.push(m);p=m.end;}}
  z(Math.max(p.z,target.z));const xy=movement(p,{x:target.x,y:target.y},speed,'travel','return');if(xy.seconds>1e-9){moves.push(xy);p=xy.end;}z(target.z);return moves;
 }
 function* iterate(paths,settings,start,park=start){
  const {downZ,upZ,zSpeed,drawSpeed,travelSpeed}=settings;
  const liftSpeed=settings.liftSpeed??zSpeed;
  if(![downZ,upZ,zSpeed,drawSpeed,travelSpeed].every(Number.isFinite)||upZ-downZ<.5-1e-7||zSpeed<=0||drawSpeed<=0||travelSpeed<=0)throw Error('升降高度或速度无效');
  if(!Number.isFinite(liftSpeed)||liftSpeed<=0)throw Error('抬笔速度必须大于0');
  let p=point(start);park=point({...park,z:Math.max(park.z,upZ)});if(p.z<downZ-.001)throw Error('起点低于记录的接触高度');
  let elapsed=0;
  function* add(target,speed,kind,phase,stroke,color){const m=movement(p,target,speed,kind,phase,stroke,color);p=m.end;if(m.seconds>1e-9){m.t=elapsed;elapsed+=m.seconds;yield m;}}
  yield* add({z:upZ},upZ>p.z?liftSpeed:zSpeed,upZ>p.z?'up':'down','approach',-1);
  for(let i=0;i<paths.length;i++){const path=paths[i];if(path.points.length<2)continue;const points=compactLinear(path.points);yield* add({x:points[0][0],y:points[0][1]},travelSpeed,'travel',i?'plot':'approach',i,path.color);yield* add({z:downZ},zSpeed,'down','plot',i,path.color);for(let j=1;j<points.length;j++)yield* add({x:points[j][0],y:points[j][1]},drawSpeed,'draw','plot',i,path.color);yield* add({z:upZ},liftSpeed,'up','plot',i,path.color);}
  for(const m of returnMoves(p,park,travelSpeed,liftSpeed)){m.t=elapsed;elapsed+=m.seconds;yield m;}
 }
 // The preview materializes the same iterator the job compiler consumes.
 // Compiling large drawings does not need to retain every movement object.
 function build(paths,settings,start,park=start){
  const moves=Array.from(iterate(paths,settings,start,park));
  return timeline(moves,settings,start,moves.at(-1)?.end||start,{...park,z:Math.max(park.z,settings.upZ)});
 }
 function timeline(moves,settings,start,end,park){let duration=0;const breakdown={draw:0,travel:0,z:0,return:0};for(const m of moves){m.t=duration;duration+=m.seconds;breakdown[m.phase==='return'?'return':m.kind==='draw'?'draw':m.kind==='travel'?'travel':'z']+=m.seconds;}return {moves,settings:{...settings},start:point(start),end:point(end),returnTo:point(park),duration,breakdown};}
 // Fastest rest-to-rest motion for a length and a published acceleration cap.
 // Curves, cornering, firmware configuration, ink and transport can only add
 // time. This analysis never changes the actual trajectory or its fences.
 function restTime(length,speed,acceleration){if(![length,speed,acceleration].every(Number.isFinite)||length<0||speed<=0||acceleration<=0)throw Error('运动估算参数无效');if(length===0)return{seconds:0,peak:0};const peak=Math.min(speed,Math.sqrt(length*acceleration));return{seconds:length>=speed*speed/acceleration?length/speed+speed/acceleration:2*Math.sqrt(length/acceleration),peak};}
 function efficiency(model){
  const settings=model?.settings||{},Policy=root.PenSpeedPolicy||(typeof require==='function'?require('./speed-policy.js'):null),cap=Policy.limits(settings,settings.machine),moves=model?.moves||[],breakdown={draw:0,travel:0,z:0,return:0},groups=[];let current=null;
  for(const move of moves){
   const length=Math.hypot(...keys.map(k=>move.end[k]-move.from[k]));
   if(move.kind==='draw'&&move.phase==='plot'&&current?.kind==='draw'&&current.stroke===move.stroke){current.length+=length;current.speed=Math.max(current.speed,move.speed);continue;}
   current={kind:move.kind,phase:move.phase,stroke:move.stroke,length,speed:move.speed};groups.push(current);
  }
  let bestCaseSeconds=0,shortStrokeCount=0,maxSpeedStrokeCount=0,attainablePeak=0;
  for(const group of groups){const z=['up','down'].includes(group.kind),value=restTime(group.length,group.speed,z?cap.zAcceleration:cap.xyAcceleration),category=group.phase!=='plot'?'return':group.kind==='draw'?'draw':group.kind==='travel'?'travel':'z';bestCaseSeconds+=value.seconds;breakdown[category]+=value.seconds;if(group.kind==='draw'&&group.phase==='plot'){attainablePeak=Math.max(attainablePeak,value.peak);if(value.peak<group.speed-.000001)shortStrokeCount++;else maxSpeedStrokeCount++;}}
  const strokes=new Set(moves.filter(m=>m.kind==='down'&&m.phase==='plot').map(m=>m.stroke)).size,critical=Object.keys(breakdown).reduce((a,b)=>breakdown[b]>breakdown[a]?b:a,'draw');
  return{nominalSeconds:model?.duration||0,bestCaseSeconds,breakdown,strokes,liftGap:Number.isFinite(settings.upZ)&&Number.isFinite(settings.downZ)?round(settings.upZ-settings.downZ):null,shortStrokeCount,maxSpeedStrokeCount,attainablePeak,critical,assumptions:{referenceMachine:settings.machine?.model||'a1-mini',xyAcceleration:cap.xyAcceleration,zAcceleration:cap.zAcceleration,cornering:false,communication:false,kind:'published-cap-lower-bound'}};
 }
 // Isolate every Z movement from XY in the firmware planner. These are local
 // completion fences, not timed dwells or one network round trip per stroke.
 function gcode(m){const f=(m.speed*60).toFixed(3);return m.kind==='draw'||m.kind==='travel'?`G1 X${m.end.x.toFixed(3)} Y${m.end.y.toFixed(3)} F${f}`:`M400\nG1 Z${m.end.z.toFixed(3)} F${f}\nM400`;}
 function inverse(x,y,p){return [round(p.refX+(x-p.machineX)/p.xSign),round(p.refY+(y-p.machineY)/p.ySign)];}
 function reachable(profile,machine){if(!profile||!['refX','refY','machineX','machineY','xSign','ySign'].every(k=>Number.isFinite(profile[k]))||!root.PenMachine.machineMatch(profile.machine,machine))return null;const a=inverse(0,0,profile),b=inverse(machine.w,machine.h,profile),x=Math.max(0,Math.min(a[0],b[0])),y=Math.max(0,Math.min(a[1],b[1]));return {x,y,w:Math.max(0,Math.min(machine.w,Math.max(a[0],b[0]))-x),h:Math.max(0,Math.min(machine.h,Math.max(a[1],b[1]))-y)};}
 function preview(state,profile,position,park,design){
  const C=root.PenCore,M=root.PenMachine;design=design||C.plan(state,{timeline:false});let r=null;if(profile)try{r=M.projectDesign(state,profile,design);}catch{}
  let data,mode,reason,boardPoint,activeProfile=null;
  if(r&&!r.errors.length&&r.paths.length){
   const p=r.profile,known=profile.confirmed&&position&&keys.every(k=>Number.isFinite(position[k]))&&position.z>=p.downZ;
   data=build(r.paths,{...state.pen,machine:state.machine,downZ:p.downZ,upZ:p.upZ,zSpeed:p.zSpeed,liftSpeed:p.liftSpeed},known?position:r.start,known?(park||position):r.start);
   mode=known?'machine':'parameters';reason=known?'机器路径预演 · 与发送共用路径、速度和归位模型':'参数预演 · 起点暂设在首笔上方，校准后显示完整进出场';boardPoint=pnt=>[...inverse(pnt.x,pnt.y,p),round(pnt.z-p.downZ)];activeProfile=p;
  }else{
   const zSpeed=Number.isFinite(profile?.zSpeed)&&profile.zSpeed>=.1&&profile.zSpeed<=15?profile.zSpeed:5,liftSpeed=Number.isFinite(profile?.liftSpeed)&&profile.liftSpeed>=.1&&profile.liftSpeed<=30?profile.liftSpeed:zSpeed,first=design.paths[0]?.points[0]||[state.paper.x,state.paper.y];
   data=build(design.paths,{...state.pen,machine:state.machine,downZ:0,upZ:state.pen.lift,zSpeed,liftSpeed},{x:first[0],y:first[1],z:state.pen.lift});mode='design';reason='设计预演 · 尚未具备有效机器参数，不代表实机位置';boardPoint=pnt=>[pnt.x,pnt.y,pnt.z];
  }
  const segments=data.moves.map(m=>({...m,a:boardPoint(m.from),b:boardPoint(m.end),duration:m.seconds,...(design.paths[m.stroke]?.render?{render:design.paths[m.stroke].render}:{})}));
  return {...data,segments,mode,reason,profile:activeProfile,reachable:reachable(profile,state.machine),boardStart:boardPoint(data.start),errors:r?.errors||design.errors};
 }
 function sample(model,time){const a=model.segments||model.moves;if(!a.length)return null;time=Math.max(0,Math.min(model.duration,time));let lo=0,hi=a.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(a[mid].t<=time)lo=mid;else hi=mid-1;}const s=a[lo],fraction=s.seconds?Math.min(1,(time-s.t)/s.seconds):1,from=s.a||keys.map(k=>s.from[k]),to=s.b||keys.map(k=>s.end[k]);return {index:lo,segment:s,fraction,point:from.map((n,i)=>n+(to[i]-n)*fraction),done:time>=model.duration};}
 root.PenTrajectory={iterate,build,returnMoves,gcode,inverse,reachable,preview,sample,efficiency,restTime,compactLinear};if(typeof module!=='undefined')module.exports=root.PenTrajectory;
})(typeof window!=='undefined'?window:globalThis);
