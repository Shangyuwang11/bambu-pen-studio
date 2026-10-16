(function(){
 'use strict';const $=id=>document.getElementById(id);let token='',prepared=null,busy=false,lastTerminal='',quickWorking=false,lastSnapshot=null;
 let statusRequest=null,statusForced=false,mutationVersion=0,quickRequest=null;
 const local=location.protocol==='http:'&&location.hostname==='127.0.0.1';
 const controls=['lanConnect','lanProbe','lanRefresh','lanPrepare','lanUpload','lanStart','lanStop'];
 const quick=document.createElement('button');quick.id='lanQuickStart';quick.textContent='发送当前作品';quick.className='primary full spaced';$('lanStart').parentElement.before(quick);
 function notice(s){$('lanNotice').textContent=s;$('connectionSummary').textContent=s;}
 function buttons(){const directFile=document.getElementById('taskMode')?.value==='file',supported=PenPrinterModels.supported(PenStudio.getSettings().machine.model),matched=!lastSnapshot?.device?.model||lastSnapshot.device.model===PenStudio.getSettings().machine.model,ref=lastSnapshot?.motionReference,stopping=lastSnapshot?.run?.stopRequested||lastSnapshot?.run?.status==='stop_requested',normalSpeed=lastSnapshot?.printer?.state?.spd_mag===100;let ready=false,profile,errors=[];try{profile=PenMachineUI.getProfile();errors=PenStudio.getDesignErrors(profile);ready=!!lastSnapshot?.printer?.connected&&!ref?.faulted&&(directFile?!!(lastSnapshot?.calibrationReference||lastSnapshot?.wizard?.phase==='complete'):!!lastSnapshot?.position&&lastSnapshot.position.z>=profile.upZ&&ref?.ready!==false)&&profile.confirmed&&!errors.length&&profile.xyReference!=='local-test';}catch(e){errors=[e.message];}for(const id of controls)$(id).disabled=!local||!token||(busy&&!['lanRefresh','lanStop'].includes(id));$('lanUpload').disabled=!token||busy||!prepared;$('lanStart').disabled=!token||busy||!prepared||!$('lanObserved').checked||!normalSpeed;$('lanStop').disabled=!token||!busy||!!stopping;const fileBlock=document.getElementById('taskMode')?.value==='file'?ref?.fileBlockedReason:null;quick.disabled=!supported||!matched||!token||busy||!ready||!$('lanObserved').checked||!!fileBlock||!normalSpeed;
  const reason=busy?(lastSnapshot?.run?.phase==='returning'?'正在抬笔返回待机点，请等待完成':stopping?'停止已请求，等待已发送指令完成':'当前动作尚未完成'):!supported?'此机型当前支持排版和导出，联网支持 A1 mini、A1、P1S':!matched?'画布机型与打印机不一致，请在打印机页点击“使用该机型画布”':!local||!token||!lastSnapshot?.printer?.connected?'请先在打印机页连接设备':ref?.faulted?'请先处理打印机故障，查看机身屏幕':!normalSpeed?'请点击“恢复正常倍率”，等待打印机确认100%；笔参数与坐标保留':!profile?.confirmed?'请选择已保存的校准配置，或到校准页测量笔高':errors.length?'布局待调整：'+errors[0]:profile?.xyReference==='local-test'?'请设置笔尖相对喷嘴的真实偏移':!ready?ref?.message||'笔参数保留，请先恢复机器坐标':fileBlock==='storage_fault'?'存储卡读写异常，可改用边画边调整':fileBlock==='missing_sdcard'?'未检测到存储卡，可改用边画边调整':fileBlock==='printer_fault'?'请先处理打印机故障':!$('lanObserved').checked?'勾选上方确认，核对纸笔与移动路线':'';
  quick.dataset.disabledReason=reason;quick.title=reason;quick.setAttribute('aria-describedby','taskActionHint');const hint=$('taskActionHint');if(hint){hint.textContent=reason;hint.hidden=!reason;}$('lanStop').dataset.disabledReason=stopping?'已请求停止，请等待抬笔返回完成':!busy?'当前没有正在执行的任务':'';for(const id of ['lanPrepare','lanUpload','lanStart'])if(!supported)$(id).disabled=true;
 }
 function invalidate(event){prepared=null;if(!event?.detail?.derivedPaths)$('lanObserved').checked=false;$('lanJob').textContent='作品或参数已变化，请根据当前作品重新准备任务。';buttons();}
 async function api(action,data){if(data)mutationVersion++;if(['prepare','prepare-file'].includes(action)&&data?.state)data={...data,state:PenCore.taskState(data.state)};const r=await fetch('/api/'+action,data?{method:'POST',headers:{'Content-Type':'application/json','X-A1-Session':token},body:JSON.stringify(data)}:{}),j=await r.json();if(!r.ok)throw Error(j.error||'连接请求失败');return j;}
 function show(r){mutationVersion++;lastSnapshot=r;busy=r.busy===true||quickWorking;const p=r.printer,s=p?.state;
  $('connectionBadge').textContent=p?.connected?(lastSnapshot?.device?.name||'打印机')+' 已连接':local?'本机连接版':'离线设计';
  $('lanStatus').textContent=s?`${p.connected?'已连接':'已断开'} · ${r.device?.ip||''} · 状态 ${s.gcode_state} · XYZ归零 ${Number.isInteger(s.home_flag)&&(s.home_flag&7)===7?'已报告':'未确认'} · 喷嘴 ${s.nozzle_temper}℃ / 热床 ${s.bed_temper}℃ · 速度倍率 ${s.spd_mag??'未知'}%`:'尚未连接打印机';
  if(r.device&&(!$('deviceForm')||$('deviceForm').hidden)){$('lanIP').value=r.device.ip;$('lanSerial').value=r.device.serial;}
  if(r.position&&!r.busy)for(const k of ['x','y','z'])$('lan'+k.toUpperCase()).value=r.position[k];
  if(r.fileTask&&!r.position)for(const k of ['X','Y','Z'])$('lan'+k).value='';
  if(r.run?.status==='sending')notice(`正在发送绘图：${r.run.acceptedChunks||0} / ${r.run.totalChunks} 段。请保持连接服务运行并观察机器。`);
  if(r.run?.status==='stop_requested')notice('已请求停止：等待已发送指令的完成回报，再抬笔返回待机点。');
  if(r.run?.phase==='returning')notice('正在抬笔返回固定待机位置，请等待返回完成。');
  if(r.run?.status==='commands_sent')notice('绘画完成，已抬笔返回待机位置。请现场检查实际笔迹。');
  if(r.run?.status==='stopped')notice('绘画已停止，已抬笔返回待机位置。');
  if(r.run?.status==='failed')notice('发送停止：'+r.run.error+(Number.isInteger(r.run.acceptedChunks)?` 已确认完成 ${r.run.acceptedChunks}/${r.run.totalChunks} 段，中断段的完成情况未知。`:'')+' 请现场检查，勿直接重复发送。');
  if(['commands_sent','stopped','failed'].includes(r.run?.status)){
   const key=JSON.stringify(r.run);if(key!==lastTerminal){lastTerminal=key;if(r.run.updatedProfile)PenMachineUI.setProfile(r.run.updatedProfile,true);prepared=null;$('lanObserved').checked=false;
    for(const k of ['x','y','z'])$('lan'+k.toUpperCase()).value=r.run.status==='failed'?'':r.run.position?.[k]??'';
    $('lanJob').textContent=r.run.status==='failed'?'本次中断，起始位置已清空；重新核对位置后再准备任务。':'已填入指令预计结束位置，请现场核对后为下一次作品重新准备任务。';
   }
  }window.dispatchEvent(new CustomEvent('penconnection',{detail:r}));buttons();
 }
 async function refreshStatus({force=false}={}){
  if(statusRequest){if(force&&!statusForced)return statusRequest.catch(()=>{}).then(()=>refreshStatus({force:true}));return statusRequest;}
  statusForced=force;
  const request=(async()=>{let version=mutationVersion,r=await api(force?'status?fresh=1':'status');while(version!==mutationVersion){version=mutationVersion;r=await api('status');}show(r);return r;})();statusRequest=request;
  try{return await request;}finally{if(statusRequest===request){statusRequest=null;statusForced=false;}}
 }
 async function attempt(fn){try{await fn();}catch(e){notice(e.message);window.dispatchEvent(new CustomEvent('penconnectionerror',{detail:e.message}));}finally{buttons();}}
 $('lanConnect').onclick=()=>attempt(async()=>{const code=$('lanCode').value.trim();if(window.PenDesktopAPI&&!code){const m=await PenDesktopAPI.meta();if(!m.printer||m.printer.ip!==$('lanIP').value.trim()||m.printer.serial!==$('lanSerial').value.trim())throw Error('更换打印机需要填写访问码');show(await PenDesktopAPI.reconnect());}else show(await api('connect',{model:$('deviceModel')?.value,ip:$('lanIP').value.trim(),serial:$('lanSerial').value.trim(),accessCode:code}));$('lanCode').value='';prepared=null;lastTerminal='';for(const k of ['X','Y','Z'])$('lan'+k).value='';notice('已连接。需要建立位置时，请打开“一步一步校准”。');});
 $('lanProbe').onclick=()=>attempt(async()=>{const r=await api('probe',{});notice('已收到运动完成标记 '+r.marker+'；本次测试没有移动或加热。');});
 $('lanRefresh').onclick=()=>attempt(()=>refreshStatus({force:true}));
 function preparedSummary(job){const b=job.bounds,p=job.returnTo;return job.strokes+' 笔 · 喷嘴范围 X '+b.x.toFixed(2)+'–'+(b.x+b.w).toFixed(2)+' / Y '+b.y.toFixed(2)+'–'+(b.y+b.h).toFixed(2)+' mm。纯运动估算 '+Math.ceil(job.estimateSeconds)+' 秒（含进场和返回，不含加减速/通信）。'+(p?'结束/正常停止后返回 X'+p.x+' Y'+p.y+' Z'+p.z+'。':'')+'停止会等待已发送指令确认完成，再抬笔返回；最长绘画批次运动估算 '+Math.ceil(job.maxBatchSeconds)+' 秒（不是停止延迟保证）。';}
 $('lanPrepare').onclick=()=>attempt(async()=>{await PenStudio.ensureImagePaths();const position={};for(const k of ['x','y','z']){const v=$('lan'+k.toUpperCase()).value;if(v.trim()==='')throw Error('请填写当前已知的喷嘴 XYZ');position[k]=Number(v);}const r=await api('prepare',{state:PenStudio.getState(),profile:PenMachineUI.getProfile(),position});prepared=r.prepared;$('lanObserved').checked=false;show(r);$('lanJob').textContent=preparedSummary(prepared);notice('任务已根据当前作品准备，请核对实际起点与整条抬笔路线（含结束后返回待机位置）。');});
 $('lanUpload').onclick=()=>attempt(async()=>{const r=await api('upload',{id:prepared.id,sha256:prepared.sha256});notice('已上传 '+r.filename+'，并逐字节读回验证；没有启动文件。');});
 $('lanStart').onclick=()=>attempt(async()=>{if(!prepared||!$('lanObserved').checked)throw Error('请先准备任务并核对现场');await api('start',{id:prepared.id,sha256:prepared.sha256,observedStart:true,clearRoute:true});prepared=null;lastTerminal='';busy=true;notice('开始发送小段绘图指令。请留在机器旁。');});
 quick.onclick=()=>attempt(async()=>{window.dispatchEvent(new CustomEvent('penconnectionerror',{detail:''}));
  if(busy||!$('lanObserved').checked)throw Error('请先勾选现场确认');busy=true;quickWorking=true;const request={cancelled:false};quickRequest=request;const checkCancelled=()=>{if(request.cancelled)throw Error('发送准备已取消');};buttons();
  try{await PenStudio.ensureImagePaths();checkCancelled();const state=PenStudio.getState(),profile=PenMachineUI.getProfile(),signature=JSON.stringify({state,profile}),fileMode=document.getElementById('taskMode')?.value==='file',s=await api('status');checkCancelled();
   if(s.busy)throw Error('当前动作尚未完成');if(s.printer?.state?.spd_mag!==100)throw Error('请先恢复正常倍率，等待打印机确认100%；笔参数与坐标保留');if(document.getElementById('taskMode')?.value==='file'&&s.motionReference?.fileBlockedReason)throw Error(s.motionReference.fileBlockedReason==='storage_fault'?'存储卡读写异常，整图上传暂不可用；可改用边画边调整':s.motionReference.fileBlockedReason==='missing_sdcard'?'未识别到存储卡，可改用边画边调整或插入存储卡':'打印机有故障，请查看机身屏幕');if(!fileMode&&!s.position)throw Error('笔参数保留，机器坐标待恢复。请在绘图页的任务区点击“回到待机点”。');
   const r=await api(fileMode?'prepare-file':'prepare',{state,profile,position:s.position,unchanged:true,clearRoute:true});checkCancelled();$('lanJob').textContent=preparedSummary(r.prepared);
   if(signature!==JSON.stringify({state:PenStudio.getState(),profile:PenMachineUI.getProfile()}))throw Error('作品或参数刚刚改变，请重新点击发送');
   if(!$('lanObserved').checked)throw Error('现场确认已变化，请重新核对');
   if(fileMode!==(document.getElementById('taskMode')?.value==='file'))throw Error('发送方式已改变，请重新发送');
   await api(fileMode?'start-file':'start',{id:r.prepared.id,sha256:r.prepared.sha256,observedStart:true,clearRoute:true,unchanged:true});prepared=null;lastTerminal='';busy=true;notice(fileMode?'文件已上传，正在等待打印机实际开始执行。':'当前作品已开始发送。');
  }catch(e){busy=lastSnapshot?.busy===true;throw e;}finally{quickWorking=false;if(quickRequest===request)quickRequest=null;}
 });
 $('lanStop').onclick=()=>attempt(async()=>{if(quickRequest)quickRequest.cancelled=true;$('lanObserved').checked=false;const r=await api('stop',{});if(r?.run||r?.printer)show(r);notice(lastSnapshot?.fileTask?'已请求打印机停止完整任务；等待打印机确认。':'已请求停止：等待已发送指令完成，再抬笔返回待机位置。');});
 $('lanObserved').onchange=buttons;
 for(const id of ['lanX','lanY','lanZ'])$(id).oninput=invalidate;
 $('machineDialog').addEventListener('input',e=>{if(e.target.id.startsWith('mc_'))invalidate();});window.addEventListener('penstudiochange',invalidate);window.addEventListener('penmachinechange',invalidate);
 $('openConnection').onclick=()=>{$('machineSetup').click();$('lanControls').open=true;requestAnimationFrame(()=>$('lanControls').scrollIntoView({block:'start'}));};
 window.PenConnection={api,show,refreshStatus,invalidate,position:()=>{const p={};for(const k of ['x','y','z']){const v=$('lan'+k.toUpperCase()).value;if(!v.trim())throw Error('当前XYZ尚未建立，请先在“连接与发送”里核对起点');p[k]=Number(v);}return p;},setPosition:p=>{for(const k of ['x','y','z'])$('lan'+k.toUpperCase()).value=p?.[k]??'';invalidate();}};
 buttons();if(local){attempt(async()=>{const r=await api('session');token=r.token;show(r);if(!['sending','commands_sent','stopped','failed'].includes(r.run?.status))notice(r.printer?.connected?'打印机已连接。先修改和预演作品，再点击“连接与发送”。':'本机服务已启动，点击“连接与发送”填写打印机信息。');});setInterval(()=>{if(!document.hidden)attempt(()=>refreshStatus());},2500);}
})();
