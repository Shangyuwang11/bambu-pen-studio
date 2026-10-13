'use strict';
// Runs independently of the renderer's load event. Never sends motion or jobs.
function startConnectionLifecycle({autoConnect,bridge,powerMonitor,setIntervalFn=setInterval,clearIntervalFn=clearInterval,onEvent=()=>{},canRun=()=>true,now=Date.now}){
 let stopped=false,suspended=false,waking=null,checking=null,nextHealth=0;
 const report=event=>{try{onEvent({event,at:now()});}catch{}};
 const tick=(force=false)=>{
  if(stopped||suspended||!canRun())return Promise.resolve();if(checking)return checking;
  checking=Promise.resolve().then(async()=>{
   const s=bridge.snapshot(),due=force||now()>=nextHealth||nextHealth-now()>30000;
   if(s.printer?.connected&&(!s.busy||s.autonomous)&&due){
    nextHealth=now()+30000;
    try{await bridge.refresh?.({force:true});}catch{report('connection-health-failed');}
   }
   if(!stopped&&!suspended&&canRun())return autoConnect.connect(force);
  }).catch(()=>{report('connection-check-failed');}).finally(()=>{checking=null;});return checking;
 };
 const suspend=()=>{suspended=true;onEvent({event:'system-suspend',at:Date.now()});};
 const wake=()=>{
  if(stopped||!canRun())return Promise.resolve();if(waking)return waking;
  suspended=false;autoConnect.resume();onEvent({event:'connection-wake',at:Date.now()});
  waking=Promise.resolve().then(async()=>{
   // A half-open TCP session can survive sleep. Do not reuse cached status.
   if(checking)await checking;
   if(!stopped)return tick(true);
  }).finally(()=>{waking=null;});return waking;
 };
 tick();const timer=setIntervalFn(()=>tick(),5000);timer.unref?.();
 powerMonitor?.on('suspend',suspend);powerMonitor?.on('resume',wake);
 return {wake,stop(){stopped=true;clearIntervalFn(timer);powerMonitor?.off('suspend',suspend);powerMonitor?.off('resume',wake);autoConnect.pause();}};
}
module.exports={startConnectionLifecycle};
