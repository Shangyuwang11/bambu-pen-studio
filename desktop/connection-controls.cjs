'use strict';
const Models=require('../printer-models.js');
// User auto-connect preference is separate from temporary pause during close/wake.
function createConnectionControls({bridge,autoConnect,loadPair=async()=>null,load=()=>null,save=()=>{}}){
 let working=false;const stored=load();autoConnect.setUserEnabled(stored?.enabled!==false);
 function preference(enabled){save({version:1,enabled});autoConnect.setUserEnabled(enabled);}
 async function exclusive(fn){
  if(working)throw Error('正在处理连接，请稍候');
  if(bridge.snapshot().busy&&!autoConnect.status().connecting)throw Error('请等待当前任务结束');
  working=true;autoConnect.pause();
  try{await autoConnect.connect().catch(()=>{});if(bridge.snapshot().busy)throw Error('请等待当前任务结束');return await fn();}
  finally{autoConnect.resume();working=false;}
 }
 async function pairingValue(value){
  const next={ip:String(value?.ip||'').trim(),serial:String(value?.serial||'').trim(),accessCode:String(value?.accessCode||'').trim(),model:Models.identity(value?.model).model};
  let saved;
  if(!next.accessCode)saved=await loadPair();
  const same=saved?.serial===next.serial;
  // Match the printer identity, not its IP: DHCP can change the address.
  if(!next.accessCode){if(!same)throw Error('请填写这台打印机的 8 位访问码');next.accessCode=saved.accessCode;}
  return next;
 }
 return{
  pair(value){return exclusive(async()=>{const result=await bridge.connect(await pairingValue(value));preference(true);return result;});},
  async savedAccessCode(serial){const saved=await loadPair();return saved&&saved.serial===serial?saved.accessCode:'';},
  reconnect(){return exclusive(async()=>{preference(true);autoConnect.resume();if(bridge.snapshot().printer?.connected)try{await bridge.refresh?.({force:true});}catch{}return autoConnect.connect(true);});},
  disconnect(){return exclusive(async()=>{preference(false);return bridge.disconnect();});},
  setAuto(enabled){if(typeof enabled!=='boolean')throw Error('自动连接选项无效');return exclusive(async()=>{preference(enabled);if(enabled){autoConnect.resume();return autoConnect.connect(true);}return bridge.snapshot();});}
 };
}
module.exports={createConnectionControls};
