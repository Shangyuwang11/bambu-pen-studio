'use strict';
// User auto-connect preference is separate from temporary pause during close/wake.
function createConnectionControls({bridge,autoConnect,load=()=>null,save=()=>{}}){
 let working=false;const stored=load();autoConnect.setUserEnabled(stored?.enabled!==false);
 function preference(enabled){save({version:1,enabled});autoConnect.setUserEnabled(enabled);}
 async function exclusive(fn){
  if(working)throw Error('正在处理连接，请稍候');
  if(bridge.snapshot().busy&&!autoConnect.status().connecting)throw Error('请等待当前任务结束');
  working=true;autoConnect.pause();
  try{await autoConnect.connect().catch(()=>{});if(bridge.snapshot().busy)throw Error('请等待当前任务结束');return await fn();}
  finally{autoConnect.resume();working=false;}
 }
 return{
  pair(value){return exclusive(async()=>{const result=await bridge.connect(value);preference(true);return result;});},
  reconnect(){return exclusive(async()=>{preference(true);autoConnect.resume();return autoConnect.connect(true);});},
  disconnect(){return exclusive(async()=>{preference(false);return bridge.disconnect();});},
  setAuto(enabled){if(typeof enabled!=='boolean')throw Error('自动连接选项无效');return exclusive(async()=>{preference(enabled);if(enabled){autoConnect.resume();return autoConnect.connect(true);}return bridge.snapshot();});}
 };
}
module.exports={createConnectionControls};
