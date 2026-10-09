(function(){'use strict';if(!window.PenDesktopAPI)return;let timer;
 const $=id=>document.getElementById(id),note=document.createElement('p');note.className='desktop-note';note.id='desktopStorageNote';$('connectionSummary').after(note);
 async function flush(){clearTimeout(timer);try{const data={backings:PenBacking.library(JSON.parse(localStorage.getItem(PenBacking.STORE)||'[]')),state:PenStudio.getState(),profile:window.PenProfilesUI?.persistentProfile()||PenMachineUI.getProfile(),activePreset:localStorage.getItem('bambu-active-pen')||'',penLibraryVersion:2,library:JSON.parse(localStorage.getItem('a1-pen-library-v1')||'[]'),presets:JSON.parse(localStorage.getItem('a1-pen-position-presets-v1')||'[]')};await PenDesktopAPI.save(data);try{localStorage.setItem('a1-pen-studio-v1',JSON.stringify(data.state));}catch{}if(!PenMachineUI.isRecoveryPending())try{localStorage.setItem('a1-pen-machine-profile-v1',JSON.stringify(data.profile));}catch{}note.textContent='作品已自动备份 · 校准配置需点保存';}catch(e){note.textContent='自动备份未完成：'+e.message+'。请手动保存作品。';throw e;}}
 const save=()=>{clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),600);};window.addEventListener('penstudiochange',save);window.addEventListener('penmachinechange',save);window.addEventListener('penpresetchange',save);window.PenDesktop={flush};
 const autoNote=document.createElement('p');autoNote.id='desktopAutoConnectNote';autoNote.className='desktop-note';autoNote.setAttribute('role','status');$('connectionSummary').before(autoNote);
 const forget=document.createElement('button');forget.textContent='清除记住的访问码';forget.id='forgetPrinter';forget.onclick=async()=>{try{await PenDesktopAPI.forget();note.textContent='已清除保存的访问码，下次打开需要重新填写。';}catch(e){note.textContent=e.message;}};$('lanConnect').parentElement.append(forget);
 const pairNote=document.createElement('p');pairNote.id='pairedPrinterNote';pairNote.className='hint';$('lanStatus').before(pairNote);let printerConnected=false;
 async function pairing(){try{const m=await PenDesktopAPI.meta(),p=m.printer;
  const a=m.autoConnect||{};window.dispatchEvent(new CustomEvent('penpairing',{detail:m}));autoNote.textContent=printerConnected?'打印机已连接 · 已记住资料，下次打开自动连接':a.userEnabled===false?'自动连接已暂停':a.connecting?'正在自动连接已保存的打印机…':a.phase==='credential_error'?'连接资料恢复失败，请查看连接设置':m.paired||m.bundledPairAvailable?'已记住打印机 · 等待上线后自动连接':'尚未保存打印机连接资料';window.PenDesktopConnection={phase:a.phase,attempts:a.attempts,lastAttemptAt:a.lastAttemptAt,lastSuccessAt:a.lastSuccessAt,events:m.connectionEvents||[]};
  if(p){for(const [id,value] of [['lanIP',p.ip],['lanSerial',p.serial]])if(!$(id).value&&document.activeElement!==$(id))$(id).value=value;
   $('lanCode').placeholder='访问码已保存，无需重填';$('lanConnect').textContent='连接 / 重试';
   const state=printerConnected?'已连接':a.connecting?'正在自动连接…':a.phase==='credential_error'?'保存的访问码读取失败，请重新填写一次':`等待打印机上线，${Math.max(0,Math.ceil(((a.retryAt||Date.now())-Date.now())/1000))}秒后自动重试`;
   pairNote.textContent=`已保存 ${p.model} · ${p.ip} · ${p.serial} · ${state}`+(m.connectError&&!printerConnected?'。上次连接：'+m.connectError:'');
   if(!printerConnected)$('connectionBadge').textContent=a.userEnabled===false?'A1 mini 已断开':m.autoConnect?.connecting?'A1 mini 连接中':'A1 mini 等待上线';
  }else{pairNote.textContent=m.paired?'连接资料未能读取，请重新填写连接信息。':'尚未保存打印机，首次填写后会自动记住。';$('lanCode').placeholder='8位局域网访问码';}
 }catch(e){pairNote.textContent='读取连接资料失败：'+e.message;}}
 window.addEventListener('penconnection',e=>{printerConnected=e.detail.printer?.connected===true;pairing();});pairing();setInterval(pairing,3000);save();
 window.addEventListener('online',()=>{PenDesktopAPI.networkOnline?.().catch(()=>{});});
})();
