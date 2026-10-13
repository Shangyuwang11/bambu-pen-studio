'use strict';
const crypto=require('node:crypto'),Models=require('../printer-models.js');
const motion=require('./motion.cjs');
const flow=require('./wizard.cjs'),T=require('../trajectory.js'),Speed=require('../speed-policy.js');
const MAX_SECONDS=12,MAX_BYTES=motion.MAX_BYTES;
require('../path-tools.js');
global.window=globalThis;require('../assets/fonts.js');const C=require('../core.js'),M=require('../machine.js');
function prepare(state,profile,position,returnTo){
 const limits=Speed.limits(state?.pen,state?.machine);
 if(!Number.isFinite(state?.pen?.drawSpeed)||state.pen.drawSpeed<1||state.pen.drawSpeed>limits.draw||!Number.isFinite(state.pen.travelSpeed)||state.pen.travelSpeed<1||state.pen.travelSpeed>limits.travel)throw Error(`实机发送限书写1–${limits.draw}、空移1–${limits.travel} mm/s`);
 state=C.validateProject(state);profile=M.validateProfile(profile);
 if(profile.xyReference==='local-test')throw Error('当前XY仍是Hello World局部试写基准；请先在笔架参数中标定真实笔尖位置。完成Z校准不会自动完成XY对位。');
 // The document was just validated above. Reuse it for geometry generation
 // instead of validating and copying up to 500,000 points a second time.
 const plan=M.projectDesign(state,profile,C.plan(state,{timeline:false}));if(plan.errors.length)throw Error(plan.errors.join('；'));if(!profile.confirmed)throw Error('实测参数尚未确认');
 Models.get(state.machine.model);
 Models.point(position,state.machine.model);
 position={x:position.x,y:position.y,z:position.z};
 if(position.z<profile.downZ-.001)throw Error('当前 Z 低于已校准纸面接触高度，请先复核位置');
 if(profile.zSpeed>limits.lower||profile.liftSpeed>limits.lift)throw Error(`实机发送限落笔${limits.lower}、抬笔${limits.lift} mm/s`);
 const park=require('./calibration.cjs').position(returnTo||position,state.machine.model);park.z=Math.max(park.z,profile.upZ);
 if(plan.paths.length>20000)throw Error('作品超过20000笔，请增加照片排线间距或拆分作品');
 const settings={...state.pen,downZ:profile.downZ,upZ:profile.upZ,zSpeed:profile.zSpeed,liftSpeed:profile.liftSpeed};
 const breakdown={draw:0,travel:0,z:0,return:0};let duration=0,end={...position},lastPlot={...position};const returnChunks=[];
 let chunk={lines:['G21','G90',...M.fanOffCommands],seconds:0},chunks=[],current={...position};
 const flush=()=>{if(chunk.lines.some(l=>/(^|\n)G1 /.test(l))){chunk.lines.push('M400');chunks.push({code:motion.compactFences(chunk.lines.join('\n')+'\n'),seconds:chunk.seconds,end:{...current}});}chunk={lines:['G90',...M.fanOffCommands],seconds:0};};
 // Pack complete strokes into a single acknowledged payload when possible.
 // A long individual stroke is bounded again by motion.run; never flood the
 // printer's parser with the following packets just because it returned ACK.
 const payloadBudget=MAX_BYTES-motion.RECEIPT_RESERVE-8;
 const fits=lines=>motion.transportPackets(lines.join('\n'),payloadBudget).length<=1;
 let strokeLines=[],strokeSeconds=0;
 for(const move of T.iterate(plan.paths,settings,position,park)){
  duration+=move.seconds;breakdown[move.phase==='return'?'return':move.kind==='draw'?'draw':move.kind==='travel'?'travel':'z']+=move.seconds;end=move.end;
  if(move.phase==='return'){returnChunks.push({code:motion.compactFences('G21\nG90\n'+T.gcode(move)+'\nM400\n'),seconds:move.seconds,end:move.end});continue;}
  lastPlot=move.end;strokeLines.push(T.gcode(move));strokeSeconds+=move.seconds;
  if(move.kind==='up'&&move.phase==='plot'){
   if(chunk.lines.some(l=>/(^|\n)G1 /.test(l))&&(chunk.seconds+strokeSeconds>MAX_SECONDS||!fits([...chunk.lines,...strokeLines])))flush();
   chunk.lines.push(...strokeLines);chunk.seconds+=strokeSeconds;current=move.end;strokeLines=[];strokeSeconds=0;
   if(chunk.seconds>=MAX_SECONDS||!fits(chunk.lines))flush();
  }
 }
 if(strokeLines.length){chunk.lines.push(...strokeLines);chunk.seconds+=strokeSeconds;current=lastPlot;}
 flush();
 const all=[...chunks,...returnChunks],code='; A1 Pen Studio supervised streamed job\n; Prepared from the current measured position, no homing or heating.\n; Shared movement model: preview, feed rates and return.\n'+all.map(c=>c.code).join('');
 return {id:crypto.randomBytes(12).toString('hex'),sha256:crypto.createHash('sha256').update(code).digest('hex'),code,chunks,returnChunks,returnTo:park,start:{...position},end:{...end},bounds:plan.bounds,strokes:plan.paths.length,profile,state,speedPolicy:{mode:Speed.mode(state.pen),limits},maxBatchSeconds:Math.max(...all.map(c=>c.seconds)),estimateSeconds:duration,breakdown};
}
async function execute(printer,job,{cancelled=()=>false,onProgress=()=>{},getTuning=()=>null,onApplied=()=>{}}={}){
 await motion.ensureReady(printer);let done=0,position={...job.start};
 for(const [index,original] of job.chunks.entries()){
  if(cancelled())break;
  const requested=getTuning(),chunk=requested?require('./live-tuning.cjs').chunk(original,job,requested,position,index):original;
  const receipt=await motion.run(printer,chunk.code,chunk.seconds,{compact:true,startPosition:position,cancelled,onPacket:p=>onProgress({acceptedChunks:done,totalChunks:job.chunks.length,completedPackets:p.index,totalPackets:p.total,position:p.position,acknowledgement:p.acknowledgement,completion:p.completion})});if(chunk.tuning&&receipt.completedPackets)onApplied(chunk.tuning);
  position={...receipt.position};if(receipt.completedPackets===receipt.packets)done++;onProgress({acceptedChunks:done,totalChunks:job.chunks.length,completedPackets:receipt.completedPackets,totalPackets:receipt.packets,position,acknowledgement:receipt.acknowledgement,completion:receipt.completion});
  if(receipt.stopped||cancelled())break;
 }
 // A normal stop completes only the packet already in flight. Its exact
 // endpoint is confirmed, even in a long pen-down stroke, before the return
 // first lifts Z. Unconfirmed transport/fault errors never initiate a return.
 const steps=flow.returnSteps(position,{...job.returnTo,z:Math.max(job.returnTo.z,position.z)},job.state.pen.travelSpeed,job.profile.liftSpeed,job.state.machine.model);
 for(const step of steps){onProgress({phase:'returning',acceptedChunks:done,totalChunks:job.chunks.length,position});await motion.run(printer,step.code,step.seconds);position={...step.end};}
 return {status:cancelled()?'stopped':'commands_sent',returned:true,acceptedChunks:done,totalChunks:job.chunks.length,position,completion:'M400/M73',physicalResultRequiresObservation:true};
}
module.exports={prepare,execute,MAX_SECONDS,MAX_BYTES};
