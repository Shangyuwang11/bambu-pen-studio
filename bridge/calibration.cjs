'use strict';
const crypto=require('node:crypto');
function position(value){const p={};for(const k of ['x','y','z']){if(!Number.isFinite(value?.[k])||value[k]<0||value[k]>180)throw Error('请填写本次已经建立并现场核对的喷嘴 XYZ');p[k]=value[k];}return p;}
function begin(value){return {id:crypto.randomBytes(12).toString('hex'),position:position(value),startedAt:new Date().toISOString()};}
function move(session,id,delta){if(!session||id!==session.id)throw Error('校准会话已失效，请重新开始');if(![-1,-.5,-.1,-.05,.05,.1,.5,1,5,10].includes(delta))throw Error('请选择0.05、0.1、0.5或1mm微调；大距离请使用校准向导');return command(session.position,delta);}
function command(current,delta){const from=position(current),z=Math.round((from.z+delta)*1000)/1000;if(z<0||z>180)throw Error('目标高度超出A1 mini行程');const speed=Math.abs(delta)<=.5?.5:1;return {code:`G21\nG90\nG1 Z${z.toFixed(3)} F${(speed*60).toFixed(3)}\nM400\n`,seconds:Math.abs(delta)/speed,end:{...from,z}};}
function finish(session,id,lift,contact){if(!session||id!==session.id)throw Error('校准会话已失效');if(contact!==true)throw Error('请先确认笔尖刚好轻触纸面');if(!Number.isFinite(lift)||lift<.5||lift>10)throw Error('抬笔距离须在0.5–10mm之间');const step=command(session.position,lift);return {...step,downZ:session.position.z,upZ:step.end.z};}
async function execute(printer,step){const motion=require('./motion.cjs');await motion.ensureReady(printer);const result=await motion.run(printer,step.code,step.seconds);return {position:step.end,...result};}
function jogSteps(current,delta){
 if(!Number.isFinite(delta)||Math.abs(delta)<.05-1e-9||Math.abs(delta)>50||Math.abs(delta*20-Math.round(delta*20))>1e-7)throw Error('移动距离须为0.05的倍数，范围0.05–50 mm');
 const start=position(current),target=position({...start,z:Math.round((start.z+delta)*1000)/1000});
 const steps=[];let p=start;const size=delta<0?1:5;
 while(Math.abs(target.z-p.z)>.0001){const amount=Math.sign(delta)*Math.min(size,Math.abs(target.z-p.z));let step=command(p,amount);
  if(amount>1){step={...step,code:`G21\nG90\nG1 Z${step.end.z.toFixed(3)} F180\nM400\n`,seconds:amount/3};}
  steps.push(step);p=step.end;
 }
 return steps;
}
function directMove(current,delta){
 // Reuse distance/bounds validation, but send exactly one absolute Z move.
 const parts=jogSteps(current,delta),end=parts.at(-1).end,speed=Math.abs(delta)>1?5:Math.abs(delta)<=.5?.5:1;
 return {code:`G21\nG90\nG1 Z${end.z.toFixed(3)} F${(speed*60).toFixed(3)}\nM400\n`,seconds:Math.abs(delta)/speed,end};
}
function toHeight(current,z){
 const from=position(current),end=position({...from,z:Math.round(z*1000)/1000}),delta=end.z-from.z,speed=Math.abs(delta)>1?5:Math.abs(delta)<=.5?.5:1;
 return {code:`G21\nG90\nG1 Z${end.z.toFixed(3)} F${(speed*60).toFixed(3)}\nM400\n`,seconds:Math.abs(delta)/speed,end};
}
module.exports={position,begin,move,finish,execute,jogSteps,directMove,toHeight};
