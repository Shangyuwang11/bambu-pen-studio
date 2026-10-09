'use strict';
const SPEEDS=Object.freeze({1:.5,2:1,3:1.24,4:1.66}),round=n=>Math.round(n*1000)/1000;
const Speed=require('../speed-policy.js');
function create(job){return {level:2,offset:0,appliedLevel:2,appliedOffset:0,revision:0,appliedRevision:0,jobId:job.id};}
function request(state,v,job){const next={...state};if(v.level!==undefined){if(!Number.isInteger(v.level)||!SPEEDS[v.level])throw Error('速度档位无效');next.level=v.level;}
 if(v.delta!==undefined){if(![-.05,.05].includes(v.delta))throw Error('绘画中每次只能调整 0.05 mm');next.offset=round(next.offset+v.delta);if(Math.abs(next.offset)>1||job.profile.downZ+next.offset<0||job.profile.upZ+next.offset>180)throw Error('本次微调已达范围，请停笔后校准');}
 if(v.delta===undefined&&v.level===undefined)throw Error('缺少调整内容');next.revision++;return next;
}
function chunk(original,job,tuning,position,index){
 const lines=[],profile=job.profile,limits=Speed.limits(job.state.pen,job.state.machine);let p={...position},seconds=0,down=p.z<profile.upZ+tuning.appliedOffset-.001;
 if(index>0&&tuning.offset!==tuning.appliedOffset){const z=round(profile.upZ+tuning.offset),speed=profile.zSpeed;lines.push('G90','M400',`G1 Z${z.toFixed(3)} F${(speed*60).toFixed(3)}`,'M400');seconds+=Math.abs(z-p.z)/speed;p.z=z;down=false;}
 for(let line of original.code.trim().split('\n')){
  if(!line.startsWith('G1 ')){lines.push(line);continue;}
  const end={...p};for(const k of ['X','Y','Z']){const m=new RegExp(k+'(-?\\d+(?:\\.\\d+)?)').exec(line);if(m)end[k.toLowerCase()]=+m[1];}
  if(/\bZ/.test(line)){const originalZ=end.z;if(Math.abs(originalZ-profile.downZ)<.001||Math.abs(originalZ-profile.upZ)<.001){end.z=round(originalZ+tuning.offset);line=line.replace(/Z-?[\d.]+/,'Z'+end.z.toFixed(3));down=Math.abs(originalZ-profile.downZ)<.001;}}
  let feed=+(/F([\d.]+)/.exec(line)?.[1]);if(!Number.isFinite(feed)||feed<=0)throw Error('运动速度无效');
  if(/\b[XY]/.test(line)){feed=Math.min((down?limits.draw:limits.travel)*60,feed*SPEEDS[tuning.level]);line=line.replace(/F[\d.]+/,'F'+feed.toFixed(3));}
  if(Object.values(end).some(n=>!Number.isFinite(n)||n<0||n>180))throw Error('高度调整超出机器范围');seconds+=Math.hypot(end.x-p.x,end.y-p.y,end.z-p.z)/(feed/60);p=end;lines.push(line);
 }
 return{code:require('./motion.cjs').compactFences(lines.join('\n')+'\n'),seconds,end:p,tuning:{...tuning,appliedLevel:tuning.level,appliedOffset:tuning.offset,appliedRevision:tuning.revision}};
}
module.exports={create,request,chunk,SPEEDS};
