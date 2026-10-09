'use strict';
// MQTT acceptance is not a queue-capacity or execution acknowledgement.
// Keep one bounded G-code packet in flight, with its receipt IN that packet.
const MAX_BYTES=1800, RECEIPT_RESERVE=32, active=new WeakSet(), verified=new WeakSet();
const receiptModes=new WeakMap(),remainingMarkers=new WeakMap();
const randomInt=require('node:crypto').randomInt;
// Two immediately adjacent planner drains prove the same boundary. Keep every
// drain separated by any other command, especially all Z/XY transitions.
function compactFences(code){const lines=[];for(const line of code.split(/\r?\n/)){if(/^\s*M400\s*$/.test(line)&&/^\s*M400\s*$/.test(lines.at(-1)||''))continue;lines.push(line);}return lines.join('\n');}
function endpoint(code,start){
 const p={...start};for(const k of ['x','y','z'])if(!Number.isFinite(p[k])||p[k]<0||p[k]>180)throw Error('数据包起点未确认');
 for(const line of code.trim().split(/\r?\n/)){
  if(/^\s*G(?!1\s|21\s*$|90\s*$)/.test(line))throw Error('绘画数据包只能使用毫米和绝对直线坐标');
  if(!/^G1\s/.test(line))continue;
  if(!/^G1(?:\s+[XYZF]-?\d+(?:\.\d+)?)+$/.test(line))throw Error('绘画数据包坐标无法确认');
  for(const k of ['X','Y','Z']){const matches=[...line.matchAll(new RegExp('\\b'+k+'(-?\\d+(?:\\.\\d+)?)','g'))];if(matches.length>1)throw Error('绘画数据包有重复坐标');if(matches[0])p[k.toLowerCase()]=Number(matches[0][1]);}
  if(Object.values(p).some(n=>!Number.isFinite(n)||n<0||n>180))throw Error('数据包终点超出行程');
 }
 return p;
}
function packets(code,maxBytes=MAX_BYTES){
 const result=[];let part='';
 for(const line of code.trim().split(/\r?\n/)){if(Buffer.byteLength(line+'\n')>maxBytes)throw Error('单行运动指令过长');if(Buffer.byteLength(part+line+'\n')>maxBytes){result.push(part);part='';}part+=line+'\n';}
 if(part.trim())result.push(part);return result;
}
// Lossless wire encoding. Canonical G-code remains explicit for validation,
// file export and live tuning. Only transport omits repeated modal feed rates.
// Every packet starts with its own explicit feed: no state from an earlier
// connection, calibration or packet is assumed. XYZ and Z/XY fences are kept.
function transportPackets(code,maxBytes=MAX_BYTES-RECEIPT_RESERVE){
 const result=[];let part='',feed=null,sourceFeed=null;
 for(const raw of compactFences(code).trim().split(/\r?\n/)){
  if(!raw.trim())continue;
  let line=raw;
  if(/^G1\s/.test(line)){
   line=line.replace(/\b([XYZF])(-?\d+(?:\.\d+)?)/g,(_,key,value)=>key+String(Number(value)));
   const match=/\bF(-?\d+(?:\.\d+)?)/.exec(line);
   if(match)sourceFeed=match[1];
   if(!sourceFeed||Number(sourceFeed)<=0)throw Error('运动速度无效');
   line=line.replace(/\s+F-?\d+(?:\.\d+)?/,'');
   const encode=()=>line+(feed===sourceFeed?'':' F'+sourceFeed)+'\n';
   if(Buffer.byteLength(part+encode())>maxBytes&&part){result.push(part);part='';feed=null;}
   line=encode();feed=sourceFeed;
  }else{
   line+='\n';
   if(Buffer.byteLength(part+line)>maxBytes&&part){result.push(part);part='';feed=null;}
  }
  if(Buffer.byteLength(line)>maxBytes)throw Error('单行运动指令过长');
  part+=line;
 }
 if(part.trim())result.push(part);return result;
}
function timeoutFor(code,seconds){
 const lines=code.trim().split(/\r?\n/),fences=lines.filter(l=>/^\s*M400\s*$/.test(l)).length;
 // Distance/feed alone omits acceleration, planner drains and parser overhead.
 return Math.max(30000,seconds*4000+15000,lines.length*100+fences*200+15000);
}
async function packetRun(printer,body,seconds,{homed,timeoutMs,thermal,receiptField},detail){
 let timer,poll,resolveDone,rejectDone,armed=false,settled=false;
 const cleanup=()=>{clearTimeout(timer);clearInterval(poll);printer.off('message',message);printer.off('failure',failure);};
 const finish=error=>{if(settled)return;settled=true;cleanup();error?rejectDone(error):resolveDone();};
 const failure=error=>finish(error);
 const message=j=>{
  const p=j.print;if(!armed||p?.command!=='push_status')return;
  if(Object.hasOwn(p,receiptField)){detail.observedMarker=p[receiptField];detail.reports++;}
  // Require the field in a new raw report, never just the cached snapshot.
  if(Object.hasOwn(p,receiptField)&&p[receiptField]===detail.marker&&(receiptField==='mc_remaining_time'||printer.state.mc_remaining_time===0))finish();
 };
 try{
  await printer.fresh();printer.idle({homed,thermal});
  if(printer.state.spd_mag!==100)throw Error('请保持打印机速度倍率100%');
  if(!Number.isInteger(printer.state.mc_percent)||printer.state.mc_percent<0||printer.state.mc_percent>100)throw Error('缺少打印机进度字段，不能确认运动完成');
  detail.receiptField=receiptField;
  let receipt;
  if(receiptField==='mc_remaining_time'){
   // Some A1 firmware pins mc_percent at zero after FAILED, but still reports
   // M73 R. Use an increasing challenge above the observed countdown: time
   // passing or an old acknowledged packet cannot satisfy the next receipt.
   const current=printer.state.mc_remaining_time;
   if(!Number.isInteger(current)||current<0)throw Error('缺少有效的剩余时间字段，不能确认运动完成');
   detail.marker=Math.max(current,remainingMarkers.get(printer)??randomInt(100,200))+1;
   if(detail.marker>65535)throw Error('完成标记已达到上限，请重新连接打印机');
   remainingMarkers.set(printer,detail.marker);receipt=`M73 P${printer.state.mc_percent} R${detail.marker}\n`;
  }else{detail.marker=(printer.state.mc_percent+1)%100;receipt=`M73 P${detail.marker} R0\n`;}
  const code=body+'M400\n'+receipt;
  if(Buffer.byteLength(code)>MAX_BYTES)throw Error('运动数据包超过发送上限');
  detail.bytes=Buffer.byteLength(code);detail.timeoutMs=timeoutMs??timeoutFor(body,seconds);detail.startedAt=Date.now();
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});done.catch(()=>{});
  printer.on('message',message);printer.on('failure',failure);
  timer=setTimeout(()=>{const e=Error(`第 ${detail.index}/${detail.total} 个数据包未收到运动完成标记，当前位置未确认；不会自动重发。请检查机器状态后恢复位置；已测笔高保留。`);e.code='MOTION_RECEIPT_TIMEOUT';finish(e);},detail.timeoutMs);
  // Arm before publishing: fast firmware can report before its command ACK.
  armed=true;
  const acknowledgement=Promise.resolve().then(()=>printer.publish('print','gcode_line',{param:code},true,detail.timeoutMs)).then(ack=>{detail.ackMs=Date.now()-detail.startedAt;return ack;});
  poll=setInterval(()=>{Promise.resolve().then(()=>printer.publish('pushing','pushall',{version:1,push_target:1})).catch(failure);},1000);
  const [ack]=await Promise.all([acknowledgement,done]);
  await printer.fresh();printer.idle({homed,thermal:'observed'});
  if(printer.state.spd_mag!==100)throw Error('速度倍率改变，请重新核对位置');
  detail.completed=true;
  return {acknowledgement:ack.result,completion:'M400/M73',receiptField,marker:detail.marker};
 }finally{cleanup();if(detail.startedAt)detail.elapsedMs=Date.now()-detail.startedAt;}
}
async function run(printer,code,seconds,{homed=true,thermal='cold',timeoutMs,startPosition,cancelled=()=>false,onPacket=()=>{},compact=false,receiptField=receiptModes.get(printer)||'mc_percent'}={}){
 if(!['mc_percent','mc_remaining_time'].includes(receiptField))throw Error('未知完成确认方式');
 if(active.has(printer))throw Error('运动确认仍在进行');
 active.add(printer);
 const trace={at:Date.now(),status:'sending',nominalSeconds:seconds,completedPackets:0,packets:[]};
 try{
  // Retain all internal Z/XY fences. Only replace the final completion fence.
  const lines=compactFences(code).trim().split(/\r?\n/);while(lines.length&&/^\s*M400\s*$/.test(lines.at(-1)))lines.pop();
  const parts=(compact?transportPackets:packets)(lines.join('\n'),MAX_BYTES-RECEIPT_RESERVE);if(!parts.length)parts.push('');trace.totalPackets=parts.length;
  trace.canonicalBytes=Buffer.byteLength(lines.join('\n'));trace.transportBytes=parts.reduce((n,p)=>n+Buffer.byteLength(p),0);
  let receipt,position=startPosition?endpoint('',startPosition):null,stopped=false;
  for(let i=0;i<parts.length;i++){
   if(startPosition&&cancelled()){stopped=true;break;}
   const end=position?endpoint(parts[i],position):null;
   const detail={index:i+1,total:parts.length,reports:0};trace.packets.push(detail);if(trace.packets.length>16)trace.packets.shift();
   receipt=await packetRun(printer,parts[i],seconds,{homed,timeoutMs,thermal,receiptField},detail);trace.completedPackets++;
   if(end){position=end;onPacket({index:i+1,total:parts.length,position:{...position},acknowledgement:receipt.acknowledgement,completion:receipt.completion});}
  }
  trace.status=stopped?'stopped':'complete';return {...receipt,packets:parts.length,completedPackets:trace.completedPackets,...(position?{position,stopped}:{})};
 }catch(e){trace.status='failed';trace.errorCode=e.code||'MOTION_UNCONFIRMED';e.motion=trace;throw e;
 }finally{trace.elapsedMs=Date.now()-trace.at;active.delete(printer);printer.emit('motion-diagnostic',trace);}
}
async function ensureReady(printer,homed=true,thermal='cold',probeTimeoutMs=8000){
 if(verified.has(printer)&&!(printer.state.gcode_state==='FAILED'&&receiptModes.get(printer)!=='mc_remaining_time'))return;
 // Before the first movement on a connection, check support without moving.
 await printer.fresh();printer.idle({homed,thermal});
 const first=printer.state.gcode_state==='FAILED'?'mc_remaining_time':'mc_percent';
 try{const result=await run(printer,'',0,{homed,thermal,timeoutMs:probeTimeoutMs,receiptField:first});receiptModes.set(printer,first);verified.add(printer);return result;}
 catch(e){
  // Retry only an empty probe. Never resend a packet containing movement.
  if(first!=='mc_percent'||e.code!=='MOTION_RECEIPT_TIMEOUT')throw e;
  await printer.fresh();printer.idle({homed,thermal});
  const result=await run(printer,'',0,{homed,thermal,timeoutMs:probeTimeoutMs,receiptField:'mc_remaining_time'});receiptModes.set(printer,'mc_remaining_time');verified.add(printer);return result;
 }
}
module.exports={run,ensureReady,packets,transportPackets,timeoutFor,endpoint,compactFences,MAX_BYTES,RECEIPT_RESERVE};
