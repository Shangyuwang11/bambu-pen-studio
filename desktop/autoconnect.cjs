'use strict';
function createAutoConnect({bridge,loadPair,now=Date.now,delay=30000,onEvent=()=>{}}){
 let pending=null,next=0,error='',enabled=true,userEnabled=true,phase='idle',attempts=0,lastAttemptAt=null,lastSuccessAt=null;
 const emit=(event,code)=>{try{onEvent({event,at:now(),...(code?{code}:{}),attempts});}catch{}};
 function status(){return {connecting:!!pending,retryAt:next,error,enabled:enabled&&userEnabled,userEnabled,phase,attempts,lastAttemptAt,lastSuccessAt};}
 async function connect(force=false){
  if(pending)return pending;
  const s=bridge.snapshot();
  if(!enabled||!userEnabled||(s.busy&&!s.autonomous))return s;
  if(s.printer?.connected){phase='connected';error='';return s;}
  // A clock correction must not postpone reconnect indefinitely.
  if(!force&&now()<next&&next-now()<=delay)return s;
  pending=Promise.resolve().then(async()=>{
   phase='credentials';const pair=await loadPair();
   if(!pair){phase='unpaired';error='';return bridge.snapshot();}
   if(!enabled||!userEnabled)return bridge.snapshot();
   attempts++;lastAttemptAt=now();phase='connecting';emit('connect-start');
   await bridge.connect(pair);error='';phase='connected';lastSuccessAt=now();emit('connect-ok');return bridge.snapshot();
  }).catch(e=>{phase=phase==='credentials'?'credential_error':'waiting';error=e.message;emit(phase==='credential_error'?'credential-error':'connect-error',/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'UNAVAILABLE');if(force)throw e;return bridge.snapshot();}).finally(()=>{pending=null;next=now()+delay;});
  return pending;
 }
 return {connect,status,setUserEnabled(value){userEnabled=value===true;if(userEnabled){next=0;}else if(!pending){phase='paused';error='';}},pause(){enabled=false;},resume(){enabled=true;next=0;}};
}
module.exports={createAutoConnect};
