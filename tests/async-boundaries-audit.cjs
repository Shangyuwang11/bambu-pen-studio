'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),crypto=require('node:crypto');
const {createBridge}=require('../bridge/server.cjs'),{Printer}=require('../bridge/mqtt.cjs'),C=require('../core.js'),M=require('../machine.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
class Fake extends EventEmitter{
 constructor(){super();this.connected=true;this.full=true;this.ageMs=0;this.version=[{name:'esp32',hw_ver:'AP05',project_name:'N1'}];this.commands=[];this.state={gcode_state:'IDLE',gcode_file:'',subtask_name:'',stg_cur:255,home_flag:7,spd_mag:100,print_error:0,hms:[],mc_percent:0,mc_remaining_time:0,sdcard:true,nozzle_temper:25,bed_temper:25,nozzle_target_temper:0,bed_target_temper:0};}
 async connect(){this.connected=true;}close(){this.connected=false;}
 snapshot(){return{connected:this.connected,full:true,ageMs:0,state:{...this.state}};}
 idle(o){return Printer.prototype.idle.call(this,o);}
 deferFresh(){const gate={entered:deferred(),done:deferred()};this.gate=gate;return gate;}
 async fresh(){const gate=this.gate;if(gate){this.gate=null;gate.entered.resolve();await gate.done.promise;}return this.snapshot();}
 async publish(section,command,fields){this.commands.push({section,command,...fields});const m=/M73 P(\d+) R(\d+)/.exec(fields?.param||'');if(m)setImmediate(()=>{const patch={mc_percent:+m[1],mc_remaining_time:+m[2]};Object.assign(this.state,patch);this.emit('message',{print:{command:'push_status',...patch}});this.emit('update');});return{result:'success'};}
}
async function settled(b){for(let i=0;i<1000;i++){if(!b.snapshot().busy)return b.snapshot();await new Promise(r=>setTimeout(r,5));}throw Error('Mock action did not finish');}
async function rig(){const p=new Fake(),uploads=[],ftpGate={};async function hold(stage){if(ftpGate.stage===stage){ftpGate.stage=null;ftpGate.entered.resolve();await ftpGate.done.promise;}}
 const b=createBridge({printerFactory:()=>p,ftpFactory:()=>({async connect(){await hold('connect');},async login(){await hold('login');},async uploadVerified(name,bytes){uploads.push(name);await hold('upload');return{bytes:bytes.length,readbackVerified:true,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};},async finish(){await hold('finish');},close(){}})});await b.connect({ip:'192.168.240.10',serial:'TESTASYNC001',accessCode:'12345678',model:'a1-mini'});await b.action('wizard/home',{bare:true});let s=await settled(b),id=s.wizard.id;await b.action('wizard/installed',{id,installed:true});await b.action('wizard/jog',{id,delta:-40,continuous:true});await settled(b);const state=C.initial();state.objects=[C.newText('C')];const profile={...M.defaults(state),confirmed:true,downZ:20,upZ:22};await b.action('wizard/finish',{id,contact:true,lift:2,profile});s=await settled(b);return{b,p,uploads,ftpGate,state,profile:s.wizard.profile};}
(async()=>{
 for(const action of ['start','start-file']){
  const {b,p,uploads,state,profile}=await rig();
  try{await b.action('prepare',{state,profile,position:b.snapshot().position});const task=b.snapshot().prepared,gate=p.deferFresh(),before=p.commands.length;
   const starting=b.action(action,{id:task.id,sha256:task.sha256,observedStart:true,clearRoute:true}).catch(e=>({error:e.message}));await gate.entered.promise;await b.action('stop',{});gate.done.resolve();await starting;await settled(b);
   assert.equal(p.commands.length,before,action+' must not send movement after stop during readiness');assert.deepEqual(uploads,[],action+' must not upload after cancellation');assert.equal(b.snapshot().motionReference.ready,true,'cancel before motion must retain calibration');
   console.log('PASS '+action+': stop during delayed readiness sends no motion/upload and retains calibration');
  }finally{await settled(b);await b.close();}
 }
 for(const action of ['prepare','wizard/refine']){
  const {b,p,state,profile}=await rig();try{const before=b.snapshot(),gate=p.deferFresh(),payload=action==='prepare'?{state,profile,position:before.position}:{id:before.wizard.id,profile,unchanged:true},n=p.commands.length;
   const waiting=b.action(action,payload).catch(e=>e.message);await gate.entered.promise;assert(b.snapshot().busy);await assert.rejects(b.action(action,payload),/尚未完成/);await b.action('stop',{});gate.done.resolve();await waiting;const after=await settled(b);assert.equal(p.commands.length,n);assert.deepEqual(after.position,before.position);assert.equal(after.wizard.profile.downZ,before.wizard.profile.downZ);assert.notEqual(after.run.status,'stop_requested');
   await b.action('prepare',{state,profile,position:after.position});assert(b.snapshot().prepared);console.log('PASS '+action+': double click rejected, stop cancels delayed action, calibration retained, next task prepares');
  }finally{await settled(b);await b.close();}
 }
 for(const stage of ['connect','login','upload','finish']){
  const {b,p,ftpGate,state,profile}=await rig();try{await b.action('prepare',{state,profile,position:b.snapshot().position});const task=b.snapshot().prepared,payload={id:task.id,sha256:task.sha256,observedStart:true,clearRoute:true},before=p.commands.length;Object.assign(ftpGate,{stage,entered:deferred(),done:deferred()});
   const starting=b.action('start-file',payload);await ftpGate.entered.promise;await assert.rejects(b.action('start-file',payload),/尚未完成/);await b.action('stop',{});ftpGate.done.resolve();await starting;await settled(b);assert.equal(p.commands.length,before);assert.equal(b.snapshot().motionReference.ready,true);await b.action('prepare',{state,profile,position:b.snapshot().position});assert(b.snapshot().prepared);console.log('PASS cancel during FTP '+stage+': no file-start command, duplicate start rejected, next job ready');
  }finally{await settled(b);await b.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
