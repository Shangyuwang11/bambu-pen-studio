'use strict';
const crypto=require('node:crypto'),cal=require('./calibration.cjs'),Models=require('../printer-models.js');
const PARK=Object.freeze({x:100,y:90,z:60});
const waitDefault=ms=>new Promise(r=>setTimeout(r,ms));
function create(model='a1-mini'){return{model,id:crypto.randomBytes(12).toString('hex'),phase:'homing',returnTo:{...Models.get(model).park},position:null,contact:null,progress:0,total:0,message:'原喷嘴归零中，请勿装回笔或纸'};}
async function fresh(printer,homed){await printer.fresh();printer.idle({homed,thermal:'bare'});if(printer.state.spd_mag!==100)throw Error('请保持打印机速度倍率100%');}
async function home(printer,state,{cancelled=()=>false,update=()=>{}}={}){
 const motion=require('./motion.cjs');await fresh(printer,false);await motion.ensureReady(printer,false,'bare');
 if(cancelled()){state.phase='cancelled';update();return;}
 await motion.run(printer,'G28\nM104 S0\nM140 S0\n',90,{homed:false,thermal:'bare',timeoutMs:180000});await fresh(printer,true);
 if(cancelled()){state.phase='cancelled';state.message='归零已完成，后续安装定位已停止';update();return;}
 state.phase='parking';state.message='归零完成，正在抬高并移到安装位置';state.progress=0;state.total=1;update();
 const park=Models.get(state.model).park;await motion.run(printer,`G90\nG1 Z${park.z} F300\nG1 X${park.x} Y${park.y} F1200\n`,30,{thermal:'bare'});
 state.position={...park};state.progress=1;state.phase=cancelled()?'cancelled':'install';state.message=cancelled()?'已完成当前安装定位并停止':'请放回纸张和笔，让笔尖保持悬空';update();
}
async function moves(printer,state,steps,{wait=waitDefault,cancelled=()=>false,update=()=>{}}={}){
 state.progress=0;state.total=steps.length;
 for(const step of steps){if(cancelled())break;await cal.execute(printer,step,wait);state.position={...step.end};state.progress++;update();}
 return state.progress===steps.length;
}
function requirePhase(state,id,phases){if(!state||state.id!==id||!phases.includes(state.phase))throw Error('校准步骤已变化，请刷新向导后继续');}
function zSteps(from,target,model){const steps=[];let p=cal.position(from,model);cal.position({...p,z:target},model);target=Math.round(target*1000)/1000;while(Math.abs(target-p.z)>.0001){const delta=Math.sign(target-p.z)*Math.min(50,Math.abs(target-p.z)),step=cal.toHeight(p,p.z+delta,model);steps.push(step);p=step.end;}return steps;}
function returnSteps(from,target,speed=40,liftSpeed=5,model){const T=require('../trajectory.js');cal.position(from,model);cal.position(target,model);return T.returnMoves(from,target,speed,liftSpeed).map(m=>({code:'G21\nG90\n'+T.gcode(m)+'\nM400\n',seconds:m.seconds,end:m.end}));}
function refineSteps(from,point,upZ,model){
 point=cal.position(point,model);
 const steps=returnSteps(from,{...point,z:Math.max(from.z,upZ,point.z+.5)},40,5,model);
 const p=steps.length?steps.at(-1).end:cal.position(from,model);
 steps.push(...zSteps(p,point.z+.5,model));
 steps.push(cal.directMove({...point,z:point.z+.5},-.5,model));return steps;
}
// Change the next job's contact plane only; never issue or infer a movement.
function adjustHeight(state,request,position){
 requirePhase(state,request.id,['complete']);
 if(request.revision!==(state.revision||0))throw Error('高度参数已更新，请刷新后再调整；没有重复应用');
 const M=require('../machine.js'),p=M.validateProfile(request.profile),contact=state.contact;
 if(!position)throw Error('本次位置已失效，请先重新校准');
 const model=p.machine.model,current=cal.position(position,model);
 if(!p.confirmed||!contact||!Number.isFinite(contact.downZ)||!Number.isFinite(contact.upZ)||!M.machineMatch(p.machine,state.profile.machine)||!Models.supported(p.machine.model)||p.downZ!==contact.downZ||p.upZ!==contact.upZ)throw Error('请先完成本次校准，或刷新当前高度参数');
 if(request.undo!==undefined&&typeof request.undo!=='boolean')throw Error('撤销参数无效');
 let delta=request.delta;
 if(request.undo===true){if(!state.heightEdit?.previous)throw Error('没有可撤销的高度微调');delta=state.heightEdit.previous.downZ-contact.downZ;}
 if(!Number.isFinite(delta)||Math.abs(delta)<.05-1e-7||Math.abs(delta)>3+1e-7||Math.abs(delta/.05-Math.round(delta/.05))>1e-6)throw Error('请输入0.05–3 mm，按0.05 mm递增');
 const round=n=>Math.round(n*1000)/1000,downZ=round(contact.downZ+delta),upZ=round(contact.upZ+delta);
 if(downZ<0||upZ>Models.get(model).z||upZ-downZ<.5-1e-7)throw Error('调整后高度超出行程或抬笔间隙不足，未保存');
 if(current.z<downZ-.001)throw Error('调整后落笔高度高于当前喷嘴位置，请使用返回校准点微调');
 const point=cal.position(state.calibrationPoint,model);
 if(Math.abs(point.z-contact.downZ)>.001)throw Error('校准点高度不一致，请重新校准');
 return {...state,revision:(state.revision||0)+1,position:current,contact:{downZ,upZ},profile:{...p,downZ,upZ},calibrationPoint:{...point,z:downZ},returnTo:{...state.returnTo,z:Math.max(state.returnTo.z,upZ)},heightEdit:{delta:round(delta),previous:request.undo?null:{...contact},undo:request.undo===true},message:`已${request.undo?'撤销上次微调':delta<0?'下调 '+Math.abs(delta)+' mm':'上调 '+delta+' mm'}：落笔 Z${downZ}，抬笔 Z${upZ}；机器未移动，下次绘画生效`};
}
module.exports={PARK,create,home,moves,requirePhase,zSteps,returnSteps,refineSteps,adjustHeight};
