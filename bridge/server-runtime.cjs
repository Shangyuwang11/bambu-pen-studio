'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {Printer}=require('./mqtt.cjs'),{Ftps}=require('./ftps.cjs'),{prepare,execute}=require('./job.cjs'),Calibration=require('./calibration.cjs');
const Wizard=require('./wizard.cjs'),Models=require('../printer-models.js'),M=require('../machine.js'),Presets=require('../position-presets.js'),Tuning=require('./live-tuning.cjs'),{createFileSession}=require('./file-session.cjs'),Policy=require('./printer-policy.cjs');
const {recheckStorage}=require('./storage-recovery.cjs');
function privateIP(ip){if(net.isIP(ip)!==4)return false;const a=ip.split('.').map(Number);return a[0]===10||(a[0]===192&&a[1]===168)||(a[0]===172&&a[1]>=16&&a[1]<=31);}
function createBridge(options={}){
 const ROOT=path.resolve(__dirname,'..'),token=crypto.randomBytes(32).toString('hex');let origin='',printer=null,device=null,access='',job=null,busy=false,cancel=false,run={status:'idle'},lastMotion=null,knownPosition=null,calibration=null,wizard=null,live=null,liveJob=null,nativeReturn=null,positionIssue=null,retainedPosition=null,autoReturnAttempt=null;
 const model=()=>device?.model||'a1-mini',spec=()=>Models.get(model());
 const cal={...Calibration,position:p=>Calibration.position(p,model()),begin:p=>Calibration.begin(p,model()),move:(session,id,delta)=>Calibration.move({...session,model:model()},id,delta),finish:(session,id,lift,contact)=>Calibration.finish({...session,model:model()},id,lift,contact),directMove:(p,d)=>Calibration.directMove(p,d,model()),jogSteps:(p,d)=>Calibration.jogSteps(p,d,model())};
 const flow={...Wizard,get PARK(){return spec().park;},create:()=>Wizard.create(model()),returnSteps:(a,b,s,l)=>Wizard.returnSteps(a,b,s,l,model()),zSteps:(a,b)=>Wizard.zSteps(a,b,model()),refineSteps:(a,b,z)=>Wizard.refineSteps(a,b,z,model())};
 function matching(profile){return !!device&&profile?.machine?.model===device.model&&profile.machine.w===spec().w&&profile.machine.h===spec().h;}
 function assertModel(profile){if(!matching(profile))throw Error('画布或校准配置与实际连接的 '+(device?.name||'打印机')+' 不一致，请切换为相同机型');}
 const Receipt=require('./position-receipt.cjs'),receipt=Receipt.create({load:options.loadPositionReceipt,save:options.savePositionReceipt});
 const saveReceipt=()=>{if(!busy&&!file.active()&&printer?.connected&&wizard?.phase==='complete'&&wizard.contact)try{receipt.record(device.serial,printer.state,knownPosition,wizard.profile);}catch{}};
 const retainedValid=()=>!!(retainedPosition&&printer?.connected&&retainedPosition.serial===device?.serial&&Number.isInteger(printer.state.home_flag)&&(retainedPosition.homeFlag&7)===(printer.state.home_flag&7));
 const memory=require('./calibration-memory.cjs').createMemory({load:options.loadCalibrationReference,save:options.saveCalibrationReference});
 const remember=()=>{if(wizard?.phase==='complete'&&device?.serial)wizard.serial=device.serial;memory.remember(wizard,device?.serial);};
 const recovery=()=>{const r=memory.forDevice(device?.serial);return r?{name:r.profile.name,downZ:r.profile.downZ,upZ:r.profile.upZ,backupError:memory.error()}:null;};
 const measured=()=>wizard?.phase==='complete'&&wizard.contact?{profile:wizard.profile,calibrationPoint:wizard.calibrationPoint,returnTo:wizard.returnTo}:memory.forDevice(device?.serial);
 const motionReference=()=>{const s=printer?.state||{},homed=Number.isInteger(s.home_flag)&&(s.home_flag&7)===7||retainedValid(),ref=measured(),faulted=!!(printer?.connected&&Policy.motionFaulted(s)),storageFault=Policy.storageFault(s),fileBlockedReason=printer?.connected?Policy.fileBlockedReason(s):'connection_required',needsSafeLift=!!(knownPosition&&wizard?.phase==='complete'&&wizard.contact&&knownPosition.z<wizard.contact.upZ-.001),ready=!!(printer?.connected&&homed&&!faulted&&knownPosition&&wizard?.phase==='complete'&&wizard.contact&&!needsSafeLift),idle=Policy.taskIdle(s)||file.cancelledIdle(),clear=!Policy.motionFaulted(s);
  return{ready,canReusePosition:!!(printer?.connected&&!busy&&!file.active()&&ref&&Receipt.allowed(receipt.get(),device?.serial,s,ref.profile)),savedPosition:receipt.get()?.position||null,canRecoverStopped:!!(ref&&!busy&&file.stoppedReference()),cancelledTaskFilename:file.stoppedReference()?.filename||null,canResumeCompleted:!!(printer?.connected&&!busy&&!file.active()&&file.completedPosition()&&ref),completedPosition:file.completedPosition()?.position||null,retainedPositionConfirmed:retainedValid(),needsSafeLift,faulted,storageFault,fileBlockedReason,blockedReason:faulted?'printer_fault':!printer?.connected?'connection_required':!idle?'printer_busy':!homed?'homing_required':null,canRecover:!!(printer?.connected&&ref&&homed&&idle&&clear&&!busy&&!file.active()&&!wizardActive()),needsHome:!!(printer?.connected&&!homed),reason:needsSafeLift?'safe_lift_required':knownPosition?null:positionIssue?.reason||'position_unknown',message:faulted?'机器有故障，请先在打印机上清除故障；笔参数已保留':storageFault?'文件任务读写失败（0500-C010）；校准配置保留，请先检测存储或检查任务文件':ready?'已校准，可继续绘画':!ref?'请选择已有校准配置，或新建并校准':!homed?'打印机未保留 XYZ 归零状态；恢复机器坐标后可沿用校准配置，无需重新测笔高':needsSafeLift?'笔参数已载入，先抬到待机点即可绘画':'笔参数已保留，回到待机点后即可继续',returnTo:ref?.returnTo?{...ref.returnTo}:ref?{...flow.PARK}:null};};
 const caPath=options.caPath||process.env.A1_PEN_CA||'C:/Program Files/Bambu Studio/resources/cert/printer.cer';
 const invalidatePosition=(reason='position_unknown',message='当前位置未确认')=>{remember();if(!['reconnect','connection_lost'].includes(reason)||busy&&reason!=='reconnect')try{receipt.clear();}catch{}retainedPosition=null;knownPosition=null;calibration=null;if(reason!=='homing_lost'||!job?.fileOnly)job=null;wizard=wizard?.phase==='complete'?{...wizard,position:null}:null;nativeReturn=null;positionIssue={reason,message,at:Date.now()};try{options.onPositionInvalidated?.({...positionIssue,homeFlag:printer?.state?.home_flag,gcodeState:printer?.state?.gcode_state});}catch{}};
 const file=createFileSession({load:options.loadFileJob,save:options.saveFileJob,ftpFactory:options.ftpFactory,onStopped:maybeReturnAfterStop,onComplete:info=>{if(info.continuous&&(info.homed||retainedValid())&&nativeReturn){knownPosition={...info.record.end};wizard=nativeReturn;wizard.position={...knownPosition};positionIssue=null;nativeReturn=null;remember();}}});
 const nativeRun=()=>{const n=file.snapshot();return n?{status:'file_'+n.phase,mode:'file',percent:n.percent,stopRequested:file.active()&&!!(n.stopRequested||n.cancelStartRequested),note:n.message}:run;};
 const snapshot=()=>{saveReceipt();return ({device,printer:printer?.snapshot()||null,run:file.snapshot()?nativeRun():run,busy:busy||file.active(),localBusy:busy,autonomous:file.active()&&!busy,fileTask:file.snapshot(),tuning:live,lastMotion,position:knownPosition,positionIssue:knownPosition?null:positionIssue,motionReference:motionReference(),calibrationReference:recovery(),wizard:wizard?JSON.parse(JSON.stringify(wizard)):null,calibration:calibration?{id:calibration.id,position:calibration.position}:null,prepared:job?{id:job.id,sha256:job.sha256,start:job.start,end:job.end,bounds:job.bounds,strokes:job.strokes,estimateSeconds:job.estimateSeconds,breakdown:job.breakdown,returnTo:job.returnTo,maxBatchSeconds:job.maxBatchSeconds,fileOnly:job.fileOnly===true,positionSource:job.positionSource||'observed'}:null});};
 const wizardActive=()=>wizard&&!['complete','cancelled','error'].includes(wizard.phase);
 function runWizard(work){if(busy)throw Error('当前动作尚未完成，请等待');busy=true;cancel=false;job=null;calibration=null;const active=wizard;
  Promise.resolve().then(work).catch(e=>{invalidatePosition();wizard={...active,phase:'error',position:null,message:e.message};run={status:'failed',error:e.message,note:'位置未确认，不自动重试'};}).finally(()=>{busy=false;if(cancel&&run.status==='stop_requested')run={...run,status:'stopped',note:'已完成当前受控动作并停止'};});return snapshot();
 }
 const wizardOptions=()=>({wait:options.wait,cancelled:()=>cancel,update:()=>{knownPosition=wizard.position?{...wizard.position}:null;run={status:cancel?'stop_requested':'calibration',stopRequested:cancel,phase:wizard.phase};}});
 async function connect(v){
  if(busy)throw Error('有绘图动作进行中');if(!privateIP(v.ip)||!/^[A-Za-z0-9]{10,30}$/.test(v.serial)||!/^[A-Za-z0-9]{8}$/.test(v.accessCode))throw Error('请填写局域网 IPv4、序列号和8位访问码');
  saveReceipt();busy=true;try{if(printer){printer.removeAllListeners('failure');printer.close();}invalidatePosition('reconnect');if(wizard?.serial!==v.serial)wizard=null;printer=null;device=null;access='';const next=options.printerFactory?options.printerFactory():new Printer({host:v.ip,servername:v.serial,ca:fs.readFileSync(caPath)});
   try{await next.connect(v.accessCode);const identity=Models.detect(next.version,v.model||'auto');next.model=identity.model;printer=next;next.retainedPositionConfirmed=retainedValid;device={ip:v.ip,serial:v.serial,...identity};access=v.accessCode;run={status:'idle'};file.attach(next,v.serial);next.cancelledTaskIsIdle=()=>file.cancelledIdle();next.on('failure',()=>invalidatePosition('connection_lost','连接中断，当前位置待重新建立；已测笔高保留'));next.on('motion-diagnostic',d=>{lastMotion=d;try{options.onMotionDiagnostic?.(d);}catch{}});next.on('update',()=>{const s=next.state;if(receipt.get()&&(Number.isInteger(s.home_flag)&&(s.home_flag&7)!==7||Policy.motionFaulted(s)||s.gcode_state&&!Policy.taskIdle(s))){try{receipt.clear();}catch{}}if(retainedPosition&&(!retainedValid()||Policy.motionFaulted(s)||file.snapshot()?.phase==='foreign'))retainedPosition=null;if(!busy&&knownPosition){const lost=Number.isInteger(s.home_flag)&&(s.home_flag&7)!==7&&!retainedValid(),foreign=s.gcode_state&&!Policy.taskIdle(s)&&!file.cancelledIdle();if(lost||foreign){const reason=lost?'homing_lost':'external_task',message=lost?'打印机已清除 XYZ 归零状态；笔高已保留，需要恢复坐标':'检测到其他机器任务；笔高已保留，需要恢复坐标';invalidatePosition(reason,message);if(!['commands_sent','stopped'].includes(run.status))run={status:'position_required',note:message};}}maybeReturnAfterStop();});if(options.onCredentials)await options.onCredentials({...v,model:identity.model});}catch(e){next.close();throw e;}
  }finally{busy=false;}return snapshot();
 }
 async function locked(action){if(busy)throw Error('当前动作尚未完成，请等待');busy=true;let result;try{result=await action();}finally{busy=false;}return result&&Object.hasOwn(result,'busy')?{...result,...snapshot()}:result;}
 async function ready({normalSpeed=false,homed=true}={}){if(!printer)throw Error('请先连接打印机');await printer.fresh(normalSpeed?{force:true,fields:['gcode_state','home_flag','print_error','hms','spd_mag','nozzle_temper','nozzle_target_temper','bed_temper','bed_target_temper']}:undefined);printer.idle({homed});if(normalSpeed&&printer.state.spd_mag!==100)throw Error('打印机倍率不是100%，请先恢复正常倍率；笔参数与坐标保留');}
 function maybeReturnAfterStop(){
  const proof=file.stoppedReference();if(busy||knownPosition||!nativeReturn||!proof?.continuous||!proof.idleConfirmed||autoReturnAttempt===proof.filename)return;
  if((printer.state.home_flag&7)!==7&&!retainedValid())return;
  autoReturnAttempt=proof.filename;
  void startRecovery({filename:proof.filename,unchanged:true,clearRoute:true},{stopped:true,automatic:true}).catch(e=>{run={status:'position_required',error:e.message,note:'取消已完成；自动返回未确认，可按提示恢复，校准配置保留'};});
 }
 async function startRecovery(v,{stopped=false,automatic=false}={}){
  if(busy)throw Error('当前动作尚未完成');busy=true;cancel=false;let scheduled=false,claimed=false;
  try{
   if(!printer?.connected)throw Error('请先连接打印机');if(wizardActive())throw Error('请先完成或退出当前校准步骤');
   if(v.unchanged!==true||v.clearRoute!==true)throw Error('请确认机器未重启、未手推，纸笔和装夹未变，返回路线畅通');
   if(v.id&&v.id!==wizard?.id)throw Error('校准配置已变化，请刷新后继续');
   const preset=v.preset?Presets.validate(v.preset):null,ref=preset||measured();
   if(preset?.serial&&preset.serial!==device.serial)throw Error('校准配置对应的打印机不匹配');
   if(!ref||!matching(ref.profile)||!preset&&!ref.profile.confirmed)throw Error('请先选择原校准配置');
   const profile=M.validateProfile({...ref.profile,confirmed:true}),point=cal.position(ref.calibrationPoint||{...flow.PARK,z:profile.downZ}),target=cal.position({...ref.returnTo||flow.PARK,z:Math.max((ref.returnTo||flow.PARK).z,profile.upZ)}),safeZ=Math.max(flow.PARK.z,target.z,profile.upZ),motion=require('./motion.cjs');
   if(stopped){
    await printer.fresh({force:true,fields:['gcode_state','gcode_file','subtask_name','home_flag','print_error','hms']});
    const proof=file.stoppedReference();if(!proof||v.filename&&proof.filename!==v.filename)throw Error('未确认本软件任务已取消，没有发送移动');
    if(automatic&&(!proof.continuous||!proof.idleConfirmed||!nativeReturn||((printer.state.home_flag&7)!==7&&!retainedValid())))throw Error('本次坐标连续性未确认，不能自动返回');
    if(!automatic)file.confirmStopped(proof.filename);
    retainedPosition={serial:device.serial,homeFlag:proof.homeFlag,filename:proof.filename,confirmedAt:Date.now()};claimed=true;
    await file.dismiss();
    const latest=file.stoppedReference();if(!latest||latest.filename!==proof.filename||!retainedValid())throw Error('取消状态已变化，没有发送返回指令');
    if(printer.state.spd_mag!==100)await printer.restoreNormalSpeed();
   }else if(file.snapshot())await file.dismiss();
   await ready({normalSpeed:true});
   const active=!preset&&wizard?.phase==='complete'?wizard:{...flow.create(),phase:'complete',profile,contact:{downZ:profile.downZ,upZ:profile.upZ},calibrationPoint:point,returnTo:target,position:null};
   wizard={...active,returnTo:target};job=null;calibration=null;nativeReturn=null;
   run={status:'recovering_position',phase:'returning',note:stopped?'任务已取消，正在抬笔返回；原校准配置保留':'正在抬笔返回待机点；沿用原校准配置'};
   Promise.resolve().then(async()=>{
    if(cancel)return;await motion.ensureReady(printer);if(cancel)return;
    // First confirm Z alone; do not invent XY from the interrupted drawing.
    await motion.run(printer,`G21\nG90\nG1 Z${safeZ} F${profile.liftSpeed*60}\n`,spec().z/profile.liftSpeed);
    if(knownPosition){knownPosition={...knownPosition,z:safeZ};wizard.position={...knownPosition};}
    if(cancel)return;
    await motion.run(printer,`G21\nG90\nG1 X${target.x} Y${target.y} F2400\n`,Math.hypot(spec().w,spec().h)/40);
    knownPosition={x:target.x,y:target.y,z:safeZ};wizard.position={...knownPosition};positionIssue=null;
    if(cancel)return;
    if(Math.abs(safeZ-target.z)>.001){await motion.run(printer,`G21\nG90\nG1 Z${target.z} F${profile.zSpeed*60}\n`,(safeZ-target.z)/profile.zSpeed);knownPosition={...target};wizard.position={...target};}
   }).then(()=>{wizard.message=knownPosition?'已返回待机点，可直接发送下一幅；校准配置保留':'返回已取消，校准配置保留';remember();run={status:knownPosition?'calibrated':'position_required',note:wizard.message};}).catch(e=>{invalidatePosition('motion_unconfirmed','返回未确认完成，校准配置保留；不会自动重试');run={status:'failed',error:e.message,note:'返回位置未确认'};}).finally(()=>{busy=false;});
   scheduled=true;return snapshot();
  }catch(e){if(claimed)retainedPosition=null;throw e;}finally{if(!scheduled)busy=false;}
 }
 async function action(name,v){
  if(printer?.connected){if(v.profile?.machine)assertModel(v.profile);if(v.preset?.profile?.machine)assertModel(v.preset.profile);if(v.state?.machine)assertModel(v.state);}
  if(['start','start-file','wizard/home','wizard/use-preset','wizard/recover-position','wizard/recover-stopped','wizard/refine','wizard/jog','wizard/finish','calibration/move-z','calibration/finish'].includes(name)){try{receipt.clear();}catch{throw Error('无法更新位置记录，未发送移动');}}
  if(name==='wizard/reuse-position')return locked(async()=>{
   if(v.unchanged!==true)throw Error('请确认机器、纸笔和平台没有移动');if(!printer?.connected||file.active()||wizardActive())throw Error('请先连接打印机并等待任务或校准结束');
   await printer.fresh({force:true,fields:['gcode_state','home_flag','print_error','hms','gcode_file','subtask_name']});
   const preset=v.preset?Presets.validate(v.preset):null,ref=preset||measured(),saved=receipt.get();
   if(preset?.serial&&preset.serial!==device.serial)throw Error('校准配置不属于这台打印机');
   if(!ref||!Receipt.allowed(saved,device.serial,printer.state,ref.profile))throw Error('无法确认原坐标仍有效；打印机丢失归零状态、运行过其他任务或配置改变时，需要恢复机器坐标。笔高配置保留。');
   printer.idle({homed:true});knownPosition={...saved.position};positionIssue=null;job=null;calibration=null;
   const profile={...ref.profile,confirmed:true};wizard={...flow.create(),phase:'complete',profile,contact:{downZ:profile.downZ,upZ:profile.upZ},position:{...knownPosition},returnTo:{...knownPosition},calibrationPoint:ref.calibrationPoint||{...knownPosition,z:profile.downZ},message:'已沿用上次停稳位置；没有发送归零或移动指令'};
   remember();run={status:'calibrated',note:wizard.message};return snapshot();
  });
  if(name==='connect')return connect(v);
  if(name==='storage/recheck')return locked(async()=>{
   if(file.active()||wizardActive())throw Error('请等当前任务或校准结束后再检查存储卡');
   const storage=await recheckStorage({printer,access,ftpFactory:options.ftpFactory});return{ok:true,storage,...snapshot()};
  });
  if(name==='speed/normal')return locked(async()=>{
   if(!printer?.connected)throw Error('请先连接打印机');if(file.active()||wizardActive())throw Error('请等当前任务或校准结束后恢复正常倍率');
   await printer.restoreNormalSpeed();return snapshot();
  });
  if(name==='file/dismiss'){if(busy)throw Error('动作尚未完成');await file.dismiss();job=null;nativeReturn=null;return snapshot();}
  if(name==='file/speed'){if(busy)throw Error('请等待文件上传结束');await file.speed(v.level);return snapshot();}
  if(name==='live/tune'){
   if(file.active())throw Error('整图已上传，不能改写其中的 Z 坐标；请使用边画边调整模式');
   if(!busy||!live||!liveJob||run.phase==='returning')throw Error('当前没有可调整的分段绘画');if(cancel)throw Error('正在停止绘画，不再接受调整');if(v.jobId!==live.jobId)throw Error('绘画任务已变化，请刷新后再调整');live=Tuning.request(live,v,liveJob);return snapshot();
  }
  if(name==='stop'&&file.active()){await file.requestStop();maybeReturnAfterStop();return snapshot();}
  if(file.active())throw Error('完整文件任务尚未结束，请先停止或等待；断线不会自动停止打印机');
  if(file.snapshot()&&!['stop','invalidate','wizard/activate-preset','wizard/new','wizard/resume-completed','wizard/recover-stopped','wizard/recover-position'].includes(name))await file.dismiss();
  if(name==='start-file'){
   if(busy)throw Error('当前动作尚未完成');await ready({normalSpeed:true,homed:!job?.fileOnly});if(busy)throw Error('当前动作尚未完成');
   if(!job||job.id!==v.id||job.sha256!==v.sha256||!job.fileOnly&&!knownPosition)throw Error('任务或本次位置已失效，请重新准备');
   if(v.observedStart!==true||v.clearRoute!==true)throw Error('请核对起点与路线');
   if(job.fileOnly&&v.unchanged!==true)throw Error('请确认平台、工具头和纸笔未手动位移，沿用原校准配置');
   const active=job,previousWizard=wizard;busy=true;cancel=false;
   try{await file.start(active,access,()=>{const frame=retainedPosition;invalidatePosition('file_running','整图执行中，完成后自动恢复；笔参数已保留');retainedPosition=frame;nativeReturn=previousWizard;},{cancelled:()=>cancel,allowUnhomed:active.fileOnly===true&&v.unchanged===true});}finally{busy=false;maybeReturnAfterStop();}return snapshot();
  }
  if(name==='wizard/activate-preset')return locked(async()=>{
   if(!printer?.connected)throw Error('请先连接打印机');await printer.fresh();if(wizardActive())throw Error('请先完成归零和装笔步骤');
   if(v.unchanged!==true)throw Error('请确认已装好这支笔，伸出长度和纸厚一致');const preset=Presets.validate(v.preset),p=preset.profile;
   if(!matching(p)||preset.serial&&preset.serial!==device.serial)throw Error('校准配置对应的打印机不匹配');
   if(knownPosition&&((!retainedValid()&&(printer.state.home_flag&7)!==7)||!['IDLE','FINISH'].includes(printer.state.gcode_state)&&!file.cancelledIdle()))invalidatePosition('position_unknown','机器坐标待恢复；笔参数已保留');
   wizard={...flow.create(),phase:'complete',profile:{...p,name:preset.name,confirmed:true},position:knownPosition?{...knownPosition}:null,calibrationPoint:preset.calibrationPoint||{...(knownPosition||flow.PARK),z:p.downZ},returnTo:preset.returnTo||{...(knownPosition||flow.PARK)},contact:{downZ:p.downZ,upZ:p.upZ},message:knownPosition?'已使用保存的校准配置，机器没有移动':'整套校准参数已载入；恢复机器坐标后即可绘画，不需要重新测笔高'};job=null;calibration=null;remember();run={status:knownPosition?'calibrated':'position_required'};return snapshot();
  });
  if(name==='wizard/resume-completed')return locked(async()=>{
   if(!printer?.connected)throw Error('请先连接打印机');await printer.fresh({force:true,fields:['gcode_state','gcode_file','subtask_name','home_flag','print_error','hms','mc_percent']});
   const proof=file.completedPosition();if(!proof)throw Error('未确认本软件任务已完整结束，不能沿用结束位置');
   if(v.unchanged!==true)throw Error('请确认打印机未重启、未手推，纸笔与校准配置未改变');
   const preset=v.preset?Presets.validate(v.preset):null,ref=preset||measured();if(!ref)throw Error('请选择原校准配置');
   if(preset?.serial&&preset.serial!==device.serial)throw Error('校准配置对应的打印机不匹配');
   const profile=M.validateProfile({...ref.profile,confirmed:true});if(!matching(profile)||proof.position.z<profile.upZ)throw Error('完成位置与校准配置不匹配');
   printer.idle({homed:false});
   retainedPosition={serial:device.serial,homeFlag:printer.state.home_flag,filename:proof.filename,confirmedAt:Date.now()};
   knownPosition={...proof.position};positionIssue=null;job=null;
   wizard={...flow.create(),phase:'complete',position:{...knownPosition},profile,contact:{downZ:profile.downZ,upZ:profile.upZ},returnTo:{...knownPosition},calibrationPoint:ref.calibrationPoint||{...knownPosition,z:profile.downZ},message:'已沿用上次完成位置与原校准配置；机器没有移动'};
   remember();run={status:'calibrated',note:wizard.message};return snapshot();
  });
  if(name==='wizard/recover-position')return startRecovery(v);
  if(name==='wizard/recover-stopped')return startRecovery(v,{stopped:true});
  if(name==='wizard/use-preset'){
   if(busy)throw Error('动作尚未完成');await ready();if(!knownPosition)throw Error('请先归零建立本次位置，保存的坐标不能代替归零');
   if(v.unchanged!==true)throw Error('请确认是同一支笔、相同装夹和纸厚，返回路线畅通');
   const preset=Presets.validate(v.preset);if(!preset.calibrationPoint||!preset.returnTo)throw Error('此旧配置没有校准点，请先使用配置或重新校准');if(preset.serial&&preset.serial!==device?.serial)throw Error('校准配置对应的打印机不匹配');if(!matching(preset.profile))throw Error('预设机型不匹配');
   const steps=flow.refineSteps(knownPosition,preset.calibrationPoint,preset.profile.upZ);
   wizard={...flow.create(),mode:'preset',phase:'approaching',position:{...knownPosition},returnTo:preset.returnTo,profile:preset.profile,message:'正在抬笔返回预设点，最后 0.5 mm 缓慢接近'};
   return runWizard(async()=>{const done=await flow.moves(printer,wizard,steps,wizardOptions());wizard.phase=done?'adjust':'cancelled';wizard.message=done?'已到预设接触高度，检查后确认即可；需要时可上下微调':'已停止，请重新检查位置';});
  }
  if(name==='stop'){if(!busy)return{...snapshot(),status:'idle',note:'当前没有正在执行的受控动作'};cancel=true;const note=wizardActive()?'已请求停止；等待当前动作完成，不再继续下降':run.phase==='returning'?'已在抬笔归位，等待归位完成':'已请求停止；等待当前已发送指令的完成回执，然后抬笔返回待机点';run={...run,status:'stop_requested',stopRequested:true,stopPolicy:liveJob?'packet-boundary':'action-boundary',note};return{...snapshot(),status:'stop_requested',note};}
  if(name==='invalidate'){if(busy)throw Error('当前动作尚未完成');job=null;calibration=null;return snapshot();}
  if(name==='wizard/new'){if(busy)throw Error('当前动作尚未完成');wizard=null;calibration=null;job=null;memory.clear();run={status:'idle'};return snapshot();}
  if(name==='wizard/home'){
   if(busy)throw Error('当前动作尚未完成');if(v.bare!==true)throw Error('请先取下纸和笔，保留原打印板');if(!printer?.connected)throw Error('请先连接打印机');
   remember();wizard=flow.create();knownPosition=null;positionIssue=null;return runWizard(async()=>{await flow.home(printer,wizard,wizardOptions());knownPosition=wizard.position?{...wizard.position}:null;run={status:'calibration',phase:wizard.phase};});
  }
  if(name==='wizard/reuse-height')return locked(async()=>{
   flow.requirePhase(wizard,v.id,['install']);await ready();if(!knownPosition)throw Error('请先完成本次归零');
   if(v.unchanged!==true||v.installed!==true)throw Error('请确认同一支笔、伸出长度和纸厚未变，纸笔已装回且笔尖悬空');
   const saved=v.preset?Presets.validate(v.preset):null;if(saved?.serial&&saved.serial!==device?.serial)throw Error('校准配置对应的打印机不匹配');const ref=saved||memory.forDevice(device?.serial);if(!ref)throw Error('请先选择已保存的校准配置');
   const profile=M.validateProfile({...v.profile,downZ:ref.profile.downZ,upZ:ref.profile.upZ,confirmed:true});
   if(!M.machineMatch(profile.machine,ref.profile.machine))throw Error('笔高参考的机型或打印板不匹配');
   if(knownPosition.z<profile.upZ)throw Error('安装位置低于保存的抬笔高度，请先抬高');
   wizard.profile=profile;wizard.contact={downZ:profile.downZ,upZ:profile.upZ};wizard.calibrationPoint=ref.calibrationPoint?{...ref.calibrationPoint}:{...knownPosition,z:profile.downZ};wizard.returnTo={...knownPosition};wizard.position={...knownPosition};wizard.phase='complete';wizard.reusedHeight=true;wizard.message='坐标已重新建立，沿用上次实测笔高；没有下降或重新触碰纸面';positionIssue=null;remember();run={status:'calibrated'};return snapshot();
  });
  if(name==='wizard/installed')return locked(async()=>{flow.requirePhase(wizard,v.id,['install']);await ready();if(v.installed!==true)throw Error('请确认纸笔已装回，笔尖仍悬空');wizard.phase='adjust';wizard.message='点击微调或输入移动距离，找到轻触纸面的高度';return snapshot();});
  if(name==='wizard/offset-height'){
   if(busy)throw Error('当前动作尚未完成，请等待绘画结束再改高度');
   if(!printer?.connected)throw Error('请先连接打印机并完成本次校准');
   printer.idle({homed:true});
   wizard=flow.adjustHeight(wizard,v,knownPosition);job=null;calibration=null;remember();run={status:'calibrated'};return snapshot();
  }
  if(name==='wizard/lift-gap')return locked(async()=>{
   if(!printer?.connected)throw Error('请先连接打印机并选择已校准的笔');await printer.fresh();printer.idle({homed:true});
   flow.requirePhase(wizard,v.id||wizard?.id,['complete']);
   if(!wizard.contact||!wizard.profile.confirmed||!Number.isFinite(v.gap)||v.gap<.5||v.gap>10)throw Error('请选择已校准的笔，抬笔间隙须为 0.5–10 mm');
   if(v.revision!==undefined&&v.revision!==(wizard.revision||0))throw Error('笔参数已变化，请刷新后重新应用间隙');
   const downZ=wizard.contact.downZ,upZ=Math.round((downZ+v.gap)*1000)/1000;
   if(upZ>spec().z)throw Error('抬笔高度超出机器行程');
   if(wizard.profile.downZ!==downZ||wizard.profile.upZ!==wizard.contact.upZ)throw Error('当前笔参数与已测接触高度不一致');
   const profile=M.validateProfile({...wizard.profile,upZ}),returnTo={...wizard.returnTo,z:Math.max(wizard.returnTo.z,upZ)};
   wizard={...wizard,profile,contact:{downZ,upZ},returnTo,revision:(wizard.revision||0)+1,message:'抬笔间隙已更新，接触高度不变；机器未移动，下次绘画生效'};job=null;calibration=null;remember();run={status:'calibrated',note:wizard.message};return snapshot();
  });
  if(name==='wizard/refine'){
   if(busy)throw Error('当前动作尚未完成，请先停止绘图并等待');flow.requirePhase(wizard,v.id,['complete']);
   if(v.unchanged!==true)throw Error('请确认纸笔未更换、未手推或重启机器，返回校准点的路线畅通');
   if(!knownPosition)throw Error('机器位置待恢复；校准配置已保留，无需重新测笔高');
   const profile=M.validateProfile(v.profile),contact=wizard.contact;
   if(!M.machineMatch(profile.machine,wizard.profile.machine)||!profile.confirmed||!contact||Math.abs(profile.downZ-contact.downZ)>.001||Math.abs(profile.upZ-contact.upZ)>.001)throw Error('笔高度已变化，请重新校准');
   const point=cal.position(wizard.calibrationPoint);if(Math.abs(point.z-contact.downZ)>.001)throw Error('校准点与落笔高度不一致，请重新校准');
   await ready();const from={...knownPosition},previous=wizard,steps=flow.refineSteps(from,point,contact.upZ);
   wizard={...flow.create(),phase:'approaching',mode:'refine',position:from,returnTo:{...previous.returnTo},calibrationPoint:point,profile,previousContact:{...contact},message:'正在抬笔返回原校准点，再下降至上次接触高度；最后0.5 mm缓慢靠近'};
   return runWizard(async()=>{const completed=await flow.moves(printer,wizard,steps,wizardOptions());if(!completed){wizard={...previous,position:{...knownPosition},message:'已停止返回校准点，原参数未改变；可再次点击微调'};return;}wizard.phase='adjust';wizard.message='已回到原校准点和上次接触高度，可直接上下微调，确认轻触后保存';});
  }
  if(name==='wizard/jog'){
   if(busy)throw Error('当前动作尚未完成');flow.requirePhase(wizard,v.id,['install','adjust']);if(wizard.phase==='install'&&v.delta<0)throw Error('装笔步骤只能抬高；装好后进入微调');
   if(v.continuous!==undefined&&typeof v.continuous!=='boolean')throw Error('移动模式无效');
   await ready();const steps=v.continuous?[cal.directMove(wizard.position,v.delta)]:cal.jogSteps(wizard.position,v.delta),returnPhase=wizard.phase;wizard.resumePhase=returnPhase;wizard.phase='jogging';wizard.contact=null;wizard.message=`正在${v.delta<0?'下降':'抬高'} ${Math.abs(v.delta)} mm，目标 Z${steps.at(-1).end.z}`+(v.continuous?'；本次连续移动会到达输入的终点':'');
   return runWizard(async()=>{await flow.moves(printer,wizard,steps,wizardOptions());wizard.phase=returnPhase;wizard.message=cancel?'本次移动已停止，请观察当前笔尖位置':'移动完成；接近纸面时用0.05 mm微调';});
  }
  if(name==='wizard/finish'){
   if(busy)throw Error('当前动作尚未完成');flow.requirePhase(wizard,v.id,['adjust']);
   await ready();const measured=cal.finish({id:wizard.id,position:wizard.position},v.id,v.lift,v.contact),profile=M.validateProfile({...v.profile,downZ:measured.downZ,upZ:measured.upZ,confirmed:true});
   assertModel(profile);
   const point={...wizard.position},parkZ=Math.max(wizard.returnTo.z,measured.upZ),steps=flow.zSteps(wizard.position,parkZ);
   wizard.phase='returning';wizard.message='轻触高度已采集，正在抬笔返回安装位置';wizard.contact=null;
   return runWizard(async()=>{const completed=await flow.moves(printer,wizard,steps,wizardOptions());
    if(!completed){wizard.phase='cancelled';wizard.message='返回已中止，本次高度未确认为可发送参数；请重新校准';return;}
    wizard.calibrationPoint=point;wizard.returnTo={...point,z:parkZ};wizard.contact={downZ:measured.downZ,upZ:measured.upZ};wizard.profile=profile;wizard.phase='complete';wizard.message='校准完成，已返回固定待机位置；下一步设置作品';remember();run={status:'calibrated'};
   });
  }
  if(name==='wizard/cancel'){if(busy){cancel=true;return snapshot();}wizard=wizard?.phase==='complete'?wizard:null;calibration=null;job=null;run={status:knownPosition&&wizard?'calibrated':'idle'};return snapshot();}
  if(name==='start'){
   if(busy)throw Error('当前动作尚未完成');busy=true;
   try{if(job?.fileOnly)throw Error('该任务仅用于整图上传，请重新准备分段任务');await ready({normalSpeed:true});if(!job||v.id!==job.id||v.sha256!==job.sha256)throw Error('任务已过期，请重新准备');if(v.observedStart!==true||v.clearRoute!==true)throw Error('请核对当前起点与整条抬笔路线');}catch(e){busy=false;throw e;}
   cancel=false;calibration=null;const active=job;liveJob=active;live=Tuning.create(active);job=null;knownPosition={...active.start};run={status:'sending',acceptedChunks:0,totalChunks:active.chunks.length};
   execute(printer,active,{cancelled:()=>cancel,getTuning:()=>({...live}),onApplied:t=>{live={...live,appliedOffset:t.appliedOffset,appliedLevel:t.appliedLevel,appliedRevision:t.appliedRevision};},onProgress:p=>{knownPosition={...p.position};run={...run,status:cancel?'stop_requested':'sending',stopRequested:cancel,...p,...(cancel?{note:p.phase==='returning'?'正在抬笔返回待机点，等待归位完成':'已请求停止；等待当前已发送指令的完成回执，然后抬笔返回待机点'}:{})};}}).then(result=>{knownPosition={...result.position};
    if(wizard?.phase==='complete'&&live.appliedOffset){const d=live.appliedOffset,r=n=>Math.round(n*1000)/1000;wizard.profile={...wizard.profile,...active.profile,downZ:r(active.profile.downZ+d),upZ:r(active.profile.upZ+d)};wizard.contact={downZ:wizard.profile.downZ,upZ:wizard.profile.upZ};wizard.calibrationPoint.z=wizard.profile.downZ;wizard.returnTo={...wizard.returnTo,z:Math.max(wizard.returnTo.z,wizard.profile.upZ)};wizard.revision=(wizard.revision||0)+1;result.updatedProfile=wizard.profile;}
    if(wizard?.phase==='complete')wizard.position={...knownPosition};remember();run=result;}).catch(e=>{const progress={acceptedChunks:run.acceptedChunks||0,totalChunks:active.chunks.length};invalidatePosition();run={status:'failed',...progress,error:e.message,failureCode:e.code||'MOTION_UNCONFIRMED',motion:e.motion||null,note:'位置未确认，不自动返回或重试'};}).finally(()=>{busy=false;liveJob=null;if(live)live={...live,offset:live.appliedOffset,level:live.appliedLevel};});return {status:'sending'};
  }
  return locked(async()=>{
   if(name==='probe'){if(!printer)throw Error('请先连接打印机');await printer.fresh();return printer.probe();}
   if(name==='prepare-file'){
    await ready({normalSpeed:true,homed:false});
    if(wizardActive()||calibration)throw Error('请先完成或退出校准向导');
    if(v.unchanged!==true||v.clearRoute!==true)throw Error('请确认平台、工具头和纸笔未手动位移，沿用原校准配置，路线畅通');
    const ref=measured();if(!ref||!ref.profile.confirmed)throw Error('请选择已保存的校准配置，或先完成校准');
    if(v.profile?.downZ!==ref.profile.downZ||v.profile?.upZ!==ref.profile.upZ||!v.profile?.machine||!M.machineMatch(v.profile.machine,ref.profile.machine))throw Error('校准配置已更新，请重新选择后发送');
    // This is an operator-confirmed coordinate frame for a file, not proof of
    // the machine's current position. Never promote it to homed or jog-ready.
    const park=cal.position({...ref.returnTo||flow.PARK,z:Math.max((ref.returnTo||flow.PARK).z,ref.profile.upZ)});
    const reference=knownPosition&&knownPosition.z>=ref.profile.upZ?knownPosition:park;
    const next=prepare(v.state,v.profile,reference,park);
    next.fileOnly=true;next.positionSource='operator-confirmed';job=next;run={status:'prepared',note:'沿用校准配置准备整图；不发送归零或坐标重置指令'};return snapshot();
   }
   await ready();
   if(wizardActive())throw Error('请先完成或退出校准向导');
   if(name==='position'){if(v.observed!==true)throw Error('请现场核对当前坐标');knownPosition=cal.position(v.position);job=null;calibration=null;return snapshot();}
   if(name==='prepare'){if(calibration)throw Error('请先结束换笔校准');if(!knownPosition)throw Error('机器坐标待恢复，请先回到待机点；已校准笔参数保留');if(wizard?.phase==='complete'&&knownPosition.z<wizard.contact.upZ-.001)throw Error('当前低于这支笔的安全抬笔高度，请先抬到待机点；校准参数已保留');if(wizard?.phase==='complete'&&(v.profile?.downZ!==wizard.contact.downZ||v.profile?.upZ!==wizard.contact.upZ||!v.profile?.machine||!M.machineMatch(v.profile.machine,wizard.profile.machine)))throw Error('校准配置已更新，请使用最新参数重新准备任务');const next=prepare(v.state,v.profile,v.position,wizard?.phase==='complete'?wizard.returnTo:undefined);if(['x','y','z'].some(k=>Math.abs(knownPosition[k]-next.start[k])>.001))throw Error('起点与本次受控移动记录不同，请先核对当前位置');job=next;run={status:'prepared'};return snapshot();}
   if(name==='calibration/begin'){if(v.observed!==true)throw Error('请核对已归零且当前笔尖悬空');const pos=cal.position(v.position);if(knownPosition&&['x','y','z'].some(k=>Math.abs(knownPosition[k]-pos[k])>.001))throw Error('填写的起点与本次位置记录不一致');calibration=cal.begin(pos);knownPosition=pos;job=null;run={status:'calibration'};return snapshot();}
   if(name==='calibration/move-z'||name==='calibration/finish'){
    const step=name.endsWith('finish')?cal.finish(calibration,v.id,v.lift,v.contact):cal.move(calibration,v.id,v.delta);
    try{await cal.execute(printer,step,options.wait);knownPosition={...step.end};calibration.position={...step.end};if(name.endsWith('finish')){calibration=null;run={status:'calibrated'};return {...snapshot(),contact:{downZ:step.downZ,upZ:step.upZ}};}return snapshot();}catch(e){invalidatePosition();run={status:'failed',error:e.message};throw e;}
   }
   if(name==='calibration/cancel'){calibration=null;job=null;run={status:'idle'};return snapshot();}
   if(name==='upload'){if(!job||v.id!==job.id||v.sha256!==job.sha256)throw Error('任务已过期，请重新准备');printer.idle({homed:true,operation:'file'});const ftp=new Ftps(printer.options);try{await ftp.connect();await ftp.login(access);const sent=await ftp.uploadVerified('a1pen_'+job.id+'.gcode',Buffer.from(job.code));run={status:'uploaded',...sent};return sent;}finally{ftp.close();}}
   throw Error('Unknown action');
  });
 }
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const respond=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(req.headers.host!==new URL(origin).host){respond(403,{error:'Invalid host'});return;}
  try{const url=new URL(req.url,origin);
   if(url.pathname.startsWith('/api/')){
    if(req.headers.origin&&req.headers.origin!==origin)throw Error('Origin rejected');
    if(req.method==='GET'&&url.pathname==='/api/session'){respond(200,{token,...snapshot()});return;}
    if(req.method==='GET'&&url.pathname==='/api/status'){if(printer?.connected){const fields=['gcode_state','home_flag','print_error','hms','gcode_file','subtask_name','stg_cur'],ages=printer.snapshot().fieldAgeMs||{},stale=fields.some(k=>Number.isFinite(ages[k])&&ages[k]>15000);await printer.fresh(url.searchParams.get('fresh')==='1'||stale?{force:true,fields}:undefined);file.observe();}respond(200,snapshot());return;}
    if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-a1-session']!==token||!String(req.headers['content-type']).startsWith('application/json')){respond(403,{error:'Request rejected'});return;}
    let raw='';for await(const b of req){raw+=b;if(Buffer.byteLength(raw)>16*1024*1024)throw Error('Request too large');}respond(200,await action(url.pathname.slice(5),JSON.parse(raw||'{}')));return;
   }
   if(req.method!=='GET'){respond(405,{error:'Method rejected'});return;}
   const rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname).slice(1),staticFile=path.resolve(ROOT,rel);
   if(!staticFile.startsWith(ROOT+path.sep)||rel.split(/[\\/]/).some(p=>['bridge','tests','desktop'].includes(p))||!mime[path.extname(staticFile)]||!fs.existsSync(staticFile)||!fs.statSync(staticFile).isFile()){respond(404,{error:'Not found'});return;}
   let body=fs.readFileSync(staticFile);if(path.basename(staticFile)==='index.html')body=Buffer.from(body.toString().replace("connect-src 'none'","connect-src 'self'"));res.writeHead(200,{'Content-Type':mime[path.extname(staticFile)]});res.end(body);
  }catch(e){respond(400,{error:e.message});}
 });
 async function disconnect(){if(busy||file.active())throw Error('请等待当前任务结束后再断开');file.detach();if(printer)printer.close();printer=null;device=null;access='';invalidatePosition();run={status:'idle'};return snapshot();}
 return {snapshot,connect,disconnect,action,server,async refresh(){if(printer?.connected)await printer.fresh();return snapshot();},get origin(){return origin;},get token(){return token;},async listen(port=8765){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;resolve();});});return origin;},async close(){if(busy)throw Error('动作进行中，请先停止并等待');file.detach();if(printer)printer.close();await new Promise(r=>server.close(r));}};
}
function launch(){const bridge=createBridge();bridge.listen(Number(process.env.A1_PEN_PORT||8765)).then(async origin=>{console.log('A1 Pen Studio local connection: '+origin);if(process.env.A1_PEN_ACCESS_CODE){const code=process.env.A1_PEN_ACCESS_CODE;delete process.env.A1_PEN_ACCESS_CODE;try{await bridge.connect({ip:process.env.A1_PEN_IP,serial:process.env.A1_PEN_SERIAL,accessCode:code});console.log('Printer connected, no motion sent.');}catch(e){console.error(e.message);}}}).catch(e=>{console.error(e.message);process.exitCode=1;});process.on('SIGINT',async()=>{if(bridge.snapshot().busy){await bridge.action('stop',{});return;}await bridge.close();process.exit();});}
module.exports={createBridge,launch};



