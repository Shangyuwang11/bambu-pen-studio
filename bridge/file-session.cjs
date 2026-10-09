'use strict';
const {Ftps}=require('./ftps.cjs'),Package=require('./file-package.cjs'),Policy=require('./printer-policy.cjs');
const terminal=new Set(['complete','stopped','failed','dismissed','foreign']);
function createFileSession({load=()=>null,save=()=>{},ftpFactory=options=>new Ftps(options),onComplete=()=>{},onStopped=()=>{},now=Date.now}={}){
 let record=null,printer=null,serial='',continuous=false,cancelledTask=null,cancellationRejected=false,stopPending=false,completionPending=null;
 try{const v=load();if(v?.version===1&&/^a1pen_[a-f0-9]{24}\.gcode\.3mf$/.test(v.filename)&&/^[A-Za-z0-9]{10,30}$/.test(v.serial)&&['uploading','starting','running','finishing','paused','stopping','disconnected','start_uncertain',...terminal].includes(v.phase))record={...v,connected:false};}catch{}
 const persist=()=>{save(record);};
 const active=()=>!!record&&(!terminal.has(record.phase)||stopPending);
 const snapshot=()=>record&&record.phase!=='dismissed'?JSON.parse(JSON.stringify(record)):null;
 async function confirmCompletion(){
  if(completionPending)return;
  const token={filename:record.filename,serial,printer};completionPending=token;
  try{
   // FINISH and home_flag can arrive in separate MQTT deltas. Confirm a full
   // post-completion report before deciding whether the calibrated XYZ survive.
   await printer.fresh({force:true,fields:['gcode_state','gcode_file','home_flag','print_error','hms','mc_percent']});
   if(completionPending!==token||printer!==token.printer||serial!==token.serial||record?.filename!==token.filename||record.phase!=='finishing')return;
   const s=printer.state,name=(s.gcode_file||'').split(/[\\/]/).at(-1),matches=name?name===record.filename:s.subtask_name===record.filename||(!s.subtask_name&&(continuous||!!cancelledTask)&&record.executionObserved===true);
   if(!matches||s.gcode_state!=='FINISH'||s.print_error!==0||!Array.isArray(s.hms)||Policy.blockingHms(s).length)throw Error('结束状态尚未确认');
   const homed=Number.isInteger(s.home_flag)&&(s.home_flag&7)===7;
   record={...record,phase:'complete',percent:100,completionConfirmed:true,completionInvalidated:false,completionHomeFlag:s.home_flag,completedAt:now(),stopRequested:false,cancelStartRequested:false,automaticStopAttempted:false,message:continuous&&homed?'绘画完成，已返回待机点；校准保留，可继续下一幅':'绘画完成，校准配置保留；可确认沿用上次完成位置，无需重新测笔高'};persist();
   onComplete({record:snapshot(),continuous,homed});
  }catch(e){if(record?.filename===token.filename&&record.phase==='finishing'){record={...record,phase:'start_uncertain',message:'结束回报未完整确认，校准配置保留：'+e.message};continuous=false;persist();}}
  finally{if(completionPending===token)completionPending=null;}
 }
 // A failed task is never generally idle. This certificate belongs only to
 // this application's acknowledged cancellation and the unchanged report.
 function cancelledIdle(){
  const s=printer?.state||{},name=(s.gcode_file||'').split(/[\\/]/).at(-1),matching=r=>name?name===r.filename:s.subtask_name?s.subtask_name===r.filename:(continuous||!!cancelledTask)&&record?.executionObserved===true&&r.filename===record.filename;
  const sameProof=p=>Number.isInteger(s.home_flag)&&(s.home_flag&7)===(p.homeFlag&7)&&(s.gcode_file||'')===p.gcodeFile&&(s.subtask_name||'')===p.subtaskName;
  if(cancelledTask&&(cancelledTask.serial!==serial||!matching(cancelledTask)||s.gcode_state!=='FAILED'||!sameProof(cancelledTask)||s.print_error!==0||!Array.isArray(s.hms)||Policy.blockingHms(s).length)){cancelledTask=null;cancellationRejected=true;if(record){record.cancelledIdleInvalidated=true;persist();}}
  if(!cancelledTask&&!cancellationRejected&&record?.cancelledIdleInvalidated!==true&&record?.serial===serial&&record.stopRequested===true&&record.stopAcknowledged===true&&(record.phase==='stopped'||record.phase==='dismissed'&&record.cancelledIdleConfirmed===true)&&matching(record)&&s.gcode_state==='FAILED'&&s.print_error===0&&Array.isArray(s.hms)&&Policy.blockingHms(s).length===0){
   if(record.cancelledIdleProof&&!sameProof(record.cancelledIdleProof)){cancellationRejected=true;record.cancelledIdleInvalidated=true;persist();}
   else{cancelledTask={filename:record.filename,serial,homeFlag:s.home_flag,gcodeFile:s.gcode_file||'',subtaskName:s.subtask_name||''};record.cancelledIdleProof={...cancelledTask};persist();}
  }
  return !!(printer?.connected&&cancelledTask);
 }
 function observe(){cancelledIdle();if(!record||record.serial!==serial||!printer?.connected)return;const s=printer.state,name=(s.gcode_file||'').split(/[\\/]/).at(-1),named=name?name===record.filename:s.subtask_name===record.filename,clearedAtEnd=!name&&!s.subtask_name&&continuous&&record.executionObserved===true&&['FINISH','FAILED'].includes(s.gcode_state),matches=named||clearedAtEnd;// A terminal local label must not freeze live telemetry. The operator may
  // have cleared a pause/fault or repeated this exact file on the printer.
  if(!active()){
   if(record.phase==='failed'&&Policy.clearedFailedTask(s)){
    const message='上次任务未完成；当前机器已空闲，可以重新校准或发送任务';
    if(record.connected!==true||record.lastPrintError!==0||record.message!==message){record={...record,connected:true,previousPrintError:record.previousPrintError||record.lastPrintError||0,lastPrintError:0,lastHms:[],observedAt:now(),message};persist();}
   }
   if(record.completionConfirmed&&(!Number.isInteger(s.home_flag)||!Number.isInteger(record.completionHomeFlag)||(s.home_flag&7)!==(record.completionHomeFlag&7)||s.gcode_state!=='FINISH'||!matches||s.print_error!==0||Policy.blockingHms(s).length)){record.completionInvalidated=true;persist();}
   if(!named||!record.uploaded||record.phase==='dismissed'||record.phase==='foreign')return;
   if(['RUNNING','PREPARE','PAUSE'].includes(s.gcode_state)){
    // Begin a new observed execution after a terminal attempt. Old stop intent
    // belongs to the old attempt and must never cancel an on-printer repeat.
    record={...record,phase:'starting',executionObserved:false,completionConfirmed:false,stopRequested:false,stopAcknowledged:false,cancelStartRequested:false,automaticStopAttempted:false,stopError:null,repeatedOnPrinter:true};
    cancelledTask=null;cancellationRejected=false;persist();
   }else if(!(s.gcode_state==='FINISH'&&s.mc_percent===100&&s.print_error===0&&Array.isArray(s.hms)&&!Policy.blockingHms(s).length&&record.executionObserved===true))return;
   else if(record.phase==='complete'&&record.completionConfirmed)return;
  }
  if(named&&s.gcode_state==='RUNNING'&&record.executionObserved!==true){record.executionObserved=true;persist();}
  if(matches){let phase=record.phase;if(s.gcode_state==='RUNNING'||s.gcode_state==='PREPARE')phase=record.stopRequested?'stopping':'running';else if(s.gcode_state==='PAUSE')phase='paused';else if(s.gcode_state==='FINISH'){const currentFile=(s.gcode_file||'').split(/[\\/]/).at(-1);if(record.executionObserved===true&&(!currentFile||currentFile===record.filename))phase='finishing';}else if(s.gcode_state==='FAILED')phase=record.stopRequested?'stopped':'failed';
   if(s.print_error||Policy.blockingHms(s).length){if(['RUNNING','PREPARE','PAUSE'].includes(s.gcode_state))phase='paused';else if(s.gcode_state!=='FINISH')phase='failed';}const was=record.phase;record={...record,phase,connected:true,lastPrinterState:s.gcode_state,lastPrintError:s.print_error,lastHms:Array.isArray(s.hms)?s.hms:[],observedAt:now(),message:phase==='failed'?(s.print_error===0x0500C010?'文件任务启动或读取失败（0500-C010）；不能仅凭此错误判断存储卡损坏。校准配置已保留。':'打印机报告任务故障，请查看机身屏幕'):phase==='stopping'?(record.stopError&&!record.stopAcknowledged?'停止回执未确认，不会自动重发；请查看打印机当前任务':'已请求停止，等待打印机确认任务结束'):phase==='stopped'?'文件任务已停止；笔参数保留，当前位置需要恢复':'',percent:Number.isFinite(s.mc_percent)?s.mc_percent:record.percent,observedSpeed:s.spd_lvl};
   if(phase!==was)persist();
   if(phase==='finishing')void confirmCompletion();
   if(record.cancelStartRequested&&['running','paused'].includes(record.phase)&&!record.stopRequested&&!record.automaticStopAttempted){const filename=record.filename;record.automaticStopAttempted=true;persist();Promise.resolve().then(()=>stop(filename)).catch(e=>{if(record?.filename===filename){record={...record,message:'停止未确认，不会自动重发：'+e.message};persist();}});}
  }else if(['RUNNING','PREPARE','PAUSE'].includes(s.gcode_state)&&(s.gcode_file||s.subtask_name)){record={...record,phase:'foreign',connected:true,message:'打印机正在执行另一份任务，本任务不再受本窗口控制'};continuous=false;persist();}
  else if(['starting','disconnected'].includes(record.phase)&&record.startSentAt&&now()-record.startSentAt>=60000){record={...record,phase:'start_uncertain',message:'文件已上传，但打印机未确认执行。校准配置保留；请核对机器状态，不会自动重发'};continuous=false;persist();}
 }
 function lost(){continuous=false;cancelledTask=null;if(active()){record={...record,connected:false,phase:'disconnected',message:'连接已断开；完整文件已在打印机上，不会自动重发'};persist();}}
 function attach(p,sn){if(printer){printer.off('update',observe);printer.off('failure',lost);}printer=p;serial=sn;continuous=false;cancelledTask=null;cancellationRejected=false;if(record&&record.serial!==serial){record=null;persist();}printer.cancelledTaskIsIdle=()=>cancelledIdle();printer.on('update',observe);printer.on('failure',lost);observe();}
 async function start(job,code,beforeStart=()=>{},{cancelled=()=>false,allowUnhomed=false}={}){
  if(active())throw Error('已有完整文件任务尚未结束');const taskSerial=serial;await printer.fresh();if(serial!==taskSerial)throw Error('打印机已变化，没有启动文件任务');printer.idle({homed:!(allowUnhomed&&job.fileOnly===true),operation:'file'});if(printer.state.sdcard!==true)throw Error('独立绘画需要打印机中有可用的存储卡');
  const pack=Package.build(job);record={version:1,filename:pack.filename,serial,phase:'uploading',connected:true,percent:0,sha256:pack.sha256,createdAt:now(),start:job.start,end:job.end,estimateSeconds:job.estimateSeconds,requestedSpeed:2,positionSource:job.positionSource||'observed',speedMode:job.state?.pen?.speedMode||'normal'};persist();
  const abort=()=>{if(record?.filename!==pack.filename||record?.serial!==taskSerial||serial!==taskSerial)throw Error('文件任务已变化，没有启动旧文件');if(!record.cancelStartRequested&&!cancelled())return false;record={...record,phase:'stopped',cancelStartRequested:true,uploadCancelled:true,message:'已取消文件启动；没有发送绘画任务，机器位置保留'};continuous=false;persist();return true;};
  if(abort())return snapshot();
  const ftp=ftpFactory(printer.options);let sent;
  try{await ftp.connect();if(abort())return snapshot();await ftp.login(code);if(abort())return snapshot();sent=await ftp.uploadVerified(pack.filename,pack.buffer);if(abort())return snapshot();if(!sent.readbackVerified||sent.sha256!==pack.sha256)throw Error('文件读回校验失败');if(ftp.finish)await ftp.finish();if(abort())return snapshot();await printer.fresh();if(abort())return snapshot();printer.idle({homed:!(allowUnhomed&&job.fileOnly===true),operation:'file'});}
  catch(e){if(record?.filename===pack.filename&&record?.serial===taskSerial){record={...record,phase:'failed',message:'上传未完成，没有启动任务：'+e.message};persist();}throw e;}finally{ftp.close();}
  record={...record,phase:'starting',startSentAt:now(),uploaded:true,bytes:sent.bytes};persist();beforeStart();continuous=true;
  try{await printer.publish('print','project_file',Package.startFields(pack),true,20000);if(record?.filename!==pack.filename||record?.serial!==taskSerial||serial!==taskSerial)throw Error('文件任务已变化，旧启动回执未应用于新任务');record={...record,startAcknowledged:true};persist();observe();return snapshot();}
  catch(e){if(record?.filename===pack.filename&&record?.serial===taskSerial){record={...record,phase:'start_uncertain',message:'启动回执未确认；任务可能已开始，不会自动重发'};continuous=false;persist();}throw e;}
 }
 async function speed(level){if(!Number.isInteger(level)||level<1||level>4)throw Error('速度档位无效');if(record?.speedMode==='extreme'&&level!==2)throw Error('极限整图按已生成速度执行，请保持正常倍率，避免重复加速与改变Z速度');const filename=record?.filename,taskSerial=serial;await printer.fresh();observe();if(record?.filename!==filename||record?.serial!==taskSerial||serial!==taskSerial)throw Error('文件任务已变化，没有发送调速指令');if(!active()||!['running','paused'].includes(record.phase))throw Error('请等待本任务开始执行后再调速');await printer.publish('print','print_speed',{param:String(level)},true);if(record?.filename!==filename||record?.serial!==taskSerial||serial!==taskSerial)throw Error('文件任务已变化，旧调速回执未应用于新任务');record.requestedSpeed=level;persist();return snapshot();}
 async function stop(filename=record?.filename){const taskSerial=serial;await printer.fresh();observe();if(record?.filename!==filename||record?.serial!==taskSerial||serial!==taskSerial)throw Error('文件任务已变化，没有发送停止指令');if(!active()||!['running','paused','stopping'].includes(record.phase))throw Error('尚未确认当前文件任务，请先核对打印机状态');if(record.stopRequested)return snapshot();cancelledTask=null;cancellationRejected=false;record.cancelledIdleInvalidated=false;delete record.cancelledIdleProof;record.stopRequested=true;record.phase='stopping';stopPending=true;persist();try{await printer.publish('print','stop',{param:''},true);if(record?.filename!==filename||record?.serial!==taskSerial||serial!==taskSerial)throw Error('文件任务已变化，停止回执未应用于新任务');record.stopAcknowledged=true;persist();cancelledIdle();return snapshot();}catch(e){if(record?.filename===filename&&record?.serial===taskSerial){record={...record,stopError:e.message,message:'停止回执未确认，不会自动重发；请查看打印机当前任务'};persist();}throw e;}finally{stopPending=false;onStopped();}}
 async function requestStop(){if(!active())return snapshot();record.cancelStartRequested=true;record.message=record.phase==='uploading'?'已请求取消，等待当前上传步骤结束；不会启动绘画':'已请求停止，等待本文件执行状态确认后停止';persist();if(['running','paused','stopping'].includes(record.phase))return stop();observe();return snapshot();}
 async function dismiss(){await printer.fresh();const stopped=cancelledIdle();printer.idle({homed:false});if(active()&&record.startSentAt&&now()-record.startSentAt<60000)throw Error('文件刚发出，请等待启动状态确认后再结束记录');if(record){record.cancelledIdleConfirmed=stopped;record.phase='dismissed';continuous=false;persist();}return snapshot();}
 function completedPosition(){
  const s=printer?.state||{},name=(s.gcode_file||'').split(/[\\/]/).at(-1);
  if(!printer?.connected||!record?.completionConfirmed||record.completionInvalidated||!Number.isInteger(s.home_flag)||record.phase!=='complete'||record.serial!==serial||s.gcode_state!=='FINISH'||s.mc_percent!==100||s.print_error!==0||!Array.isArray(s.hms)||Policy.blockingHms(s).length)return null;
  if(name?name!==record.filename:s.subtask_name? s.subtask_name!==record.filename:!continuous)return null;
  if(!record.end||!['x','y','z'].every(k=>Number.isFinite(record.end[k])&&record.end[k]>=0&&record.end[k]<=180))return null;
  return{filename:record.filename,serial,position:{...record.end},completedAt:record.completedAt};
 }
 function stoppedReference(){
  const s=printer?.state||{},name=(s.gcode_file||'').split(/[\\/]/).at(-1),matching=record&&(name?name===record.filename:s.subtask_name?s.subtask_name===record.filename:(continuous||!!cancelledTask)&&record.executionObserved===true);
  if(!printer?.connected||active()||record?.serial!==serial||!['stopped','failed','dismissed'].includes(record.phase)||!record.uploaded||!record.executionObserved||!record.stopRequested||!record.stopAcknowledged||!matching||s.gcode_state!=='FAILED'||s.print_error!==0||!Array.isArray(s.hms)||Policy.blockingHms(s).length||!Number.isInteger(s.home_flag))return null;
  return{filename:record.filename,serial,continuous,homeFlag:s.home_flag,idleConfirmed:cancelledIdle()};
 }
 function confirmStopped(filename){
  const proof=stoppedReference();if(!proof||proof.filename!==filename)throw Error('取消任务状态已变化，请刷新后确认');
  // Explicit user confirmation may replace a stale cancellation certificate.
  // It never supplies a guessed XYZ or a guessed completed endpoint.
  cancelledTask=null;cancellationRejected=false;record.cancelledIdleInvalidated=false;delete record.cancelledIdleProof;record.phase='stopped';persist();
  if(!cancelledIdle())throw Error('打印机尚未确认取消完成');return proof;
 }
 function detach(){if(printer){printer.off('update',observe);printer.off('failure',lost);}printer=null;continuous=false;cancelledTask=null;}
 return{start,speed,stop,requestStop,dismiss,attach,observe,active,snapshot,detach,cancelledIdle,completedPosition,stoppedReference,confirmStopped};
}
module.exports={createFileSession};



