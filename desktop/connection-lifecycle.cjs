'use strict';
// Runs independently of the renderer's load event. Never sends motion or jobs.
function startConnectionLifecycle({autoConnect,bridge,powerMonitor,setIntervalFn=setInterval,clearIntervalFn=clearInterval,onEvent=()=>{},canRun=()=>true}){
 let stopped=false,suspended=false,waking=null;
 const tick=()=>{if(!stopped&&!suspended&&canRun())return autoConnect.connect();};
 const suspend=()=>{suspended=true;onEvent({event:'system-suspend',at:Date.now()});};
 const wake=()=>{
  if(stopped||!canRun())return Promise.resolve();if(waking)return waking;
  suspended=false;autoConnect.resume();onEvent({event:'connection-wake',at:Date.now()});
  waking=Promise.resolve().then(async()=>{
   // A half-open TCP session can survive sleep. Verify it before reusing it.
   if(!bridge.snapshot().busy||bridge.snapshot().autonomous){try{await bridge.refresh?.();}catch{}}
   if(!stopped)return tick();
  }).finally(()=>{waking=null;});return waking;
 };
 tick();const timer=setIntervalFn(tick,5000);timer.unref?.();
 powerMonitor?.on('suspend',suspend);powerMonitor?.on('resume',wake);
 return {wake,stop(){stopped=true;clearIntervalFn(timer);powerMonitor?.off('suspend',suspend);powerMonitor?.off('resume',wake);autoConnect.pause();}};
}
module.exports={startConnectionLifecycle};
