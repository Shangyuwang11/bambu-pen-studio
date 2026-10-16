'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),crypto=require('node:crypto');
const Models=require('../printer-models.js'),Job=require('../bridge/job.cjs'),C=require('../core.js'),M=require('../machine.js'),P=require('../position-presets.js');
const Cal=require('../bridge/calibration.cjs'),Wizard=require('../bridge/wizard.cjs'),Motion=require('../bridge/motion.cjs'),Pack=require('../bridge/file-package.cjs'),Speed=require('../speed-policy.js'),Tune=require('../bridge/live-tuning.cjs'),Receipt=require('../bridge/position-receipt.cjs'),Memory=require('../bridge/calibration-memory.cjs');
const {Printer}=require('../bridge/mqtt.cjs'),{createBridge}=require('../bridge/server.cjs'),{createFileSession}=require('../bridge/file-session.cjs');
const serial='TESTMODEL0001',pair={ip:'192.168.240.10',serial,accessCode:'12345678'};
class Fake extends EventEmitter{
 constructor(model){super();const m=Models.get(model);this.model=model;this.connected=true;this.full=true;this.ageMs=0;this.version=[{name:'esp32',hw_ver:m.hardware,project_name:m.project}];this.commands=[];this.state={gcode_state:'IDLE',gcode_file:'',subtask_name:'',stg_cur:255,print_error:0,hms:[],home_flag:7,spd_mag:100,sdcard:true,nozzle_temper:25,bed_temper:25,nozzle_target_temper:0,bed_target_temper:0,mc_percent:0,mc_remaining_time:0};}
 async connect(){this.connected=true;}async fresh(){return this.snapshot();}close(){this.connected=false;}
 snapshot(){return{connected:this.connected,full:this.full,ageMs:this.ageMs,state:{...this.state}};}idle(o){return Printer.prototype.idle.call(this,o);}
 report(p){Object.assign(this.state,p);this.emit('update');}
 async publish(section,command,fields){this.commands.push({section,command,...fields});if(command==='gcode_line'){if(/\bG28\b/.test(fields.param))this.state.home_flag=7;const mark=/M73 P(\d+) R(\d+)/.exec(fields.param);if(mark)setImmediate(()=>{const patch={mc_percent:+mark[1],mc_remaining_time:+mark[2]};Object.assign(this.state,patch);this.emit('message',{print:{command:'push_status',...patch}});this.emit('update');});}return{result:'success'};}
}
function scene(model){
 const m=Models.get(model),s=C.initial();s.machine={model,w:m.w,h:m.h,plate:'smooth'};s.paper={x:0,y:0,w:m.w,h:m.h,margin:0};s.safe={x:0,y:0,w:m.w,h:m.h};s.pen={...s.pen,drawSpeed:60,travelSpeed:120};
 s.objects=[{id:'stroke',type:'shape',name:'Test',paths:[[[0,0],[1,1]]],w:20,h:20,x:m.w-48,y:70,rotation:0,color:'#000000'}];
 const p={...M.defaults(s),downZ:18,upZ:20,confirmed:true};
 return{s,p,start:{...m.park},m};
}
async function check(name,fn){await fn();console.log('PASS '+name);}
async function settled(b){for(let n=0;n<500;n++){if(!b.snapshot().busy){assert.notEqual(b.snapshot().run.status,'failed',JSON.stringify(b.snapshot().run));return b.snapshot();}await new Promise(r=>setTimeout(r,5));}throw Error('Mock did not settle');}
(async()=>{
 await check('Model must be selected explicitly; no automatic identity or default bed',()=>{
  for(const model of ['a1-mini','a1','p1s']){assert.equal(Models.identity(model).model,model);assert.equal(Models.identity(model).source,'selected');}
  for(const model of [undefined,null,'','auto','x1','AP05'])assert.throws(()=>Models.identity(model),e=>{assert.deepEqual(Models.selectionOptions(e),['a1-mini','a1','p1s']);return /请选择打印机型号/.test(e.message);});
 });
 await check('MQTT version parsing preserves the actual project identifier',()=>{
  const p=new Printer({servername:serial}),topic=Buffer.from('device/'+serial+'/report'),len=Buffer.alloc(2);len.writeUInt16BE(topic.length);
  p.handle(0x30,Buffer.concat([len,topic,Buffer.from(JSON.stringify({info:{command:'get_version',module:[{name:'esp32',hw_ver:'AP05',project_name:'N2S'}]}}))]));
  assert.equal(p.version[0].project_name,'N2S');
 });
 for(const model of ['a1-mini','a1','p1s']){
  const {s,p,start,m}=scene(model),job=Job.prepare(s,p,start),fake=new Fake(model);
  await check(model+': drawing and full-file metadata use actual bed, Z and machine ID',()=>{
   const pack=Pack.build(job),settings=JSON.parse(pack.entries['Metadata/project_settings.config']);
   assert.equal(settings.printer_model,'Bambu Lab '+m.name);assert.equal(settings.printable_height,String(m.z));assert.deepEqual(settings.printable_area,['0x0',m.w+'x0',m.w+'x'+m.h,'0x'+m.h]);
   assert(pack.entries['Metadata/slice_info.config'].includes('value="'+m.project+'"'));assert.equal(settings.printer_structure,m.structure);assert.equal(settings.curr_bed_type,'High Temp Plate');assert.equal(JSON.parse(pack.entries['Metadata/plate_1.json']).bed_type,'hot_plate');assert.equal(Pack.startFields(pack).bed_type,'hot_plate');
   assert.equal(crypto.createHash('md5').update(pack.code).digest('hex').toUpperCase(),pack.entries['Metadata/plate_1.gcode.md5']);
   assert(!/^(G28|G29|G92|M17|M84|M109|M190)\b/m.test(pack.code));assert(!/^M10[49] S[1-9]|^M1[49]0 S[1-9]/m.test(pack.code));
   for(const [key,value]of Object.entries(settings))if(key.endsWith('_gcode'))assert(!String(value).trim(),key);
   assert.equal(Motion.endpoint(job.code,start,model).x,job.end.x);if(model!=='a1-mini')assert(job.code.match(/X2\d\d\./));
   if(model!=='a1-mini')assert(!/A1 mini|A1M|180x/.test(JSON.stringify(settings)),'No inherited mini-specific zones or preset names');
   if(model==='a1')assert.deepEqual(settings.head_wrap_detect_zone,['226x224','256x224','256x256','226x256']);
   if(model==='p1s')assert.deepEqual(settings.head_wrap_detect_zone,[]);
   assert.throws(()=>Pack.validateCode('G1 Z'+(m.z+1)+' F60\n',job),/超出/);
   if(model==='p1s'){assert.equal(settings.bed_exclude_area.join(','),'0x0,18x0,18x28,0x28');assert.equal(Speed.limits(s.pen,s.machine).lift,20);assert.equal(M.reachable(p,s.machine).x,18);}
  });
  await check(model+': height calibration, saved presets and position records support full travel',()=>{
   const pos={x:m.w-20,y:m.h-20,z:m.z-4},q={...p,downZ:m.z-6,upZ:m.z-4};
   assert.equal(Cal.directMove(pos,-40,model).end.z,m.z-44);assert.equal(Cal.directMove(pos,-40,model).code.match(/^G1 /gm).length,1);
   const session=Cal.begin(pos,model);assert.equal(Cal.finish(session,session.id,2,true).upZ,m.z-2);assert.throws(()=>Cal.directMove(pos,5,model),/超出/);
   const snap={device:{serial},position:pos,wizard:{phase:'complete',contact:{downZ:q.downZ,upZ:q.upZ},profile:q,calibrationPoint:{...pos,z:q.downZ},returnTo:pos}};
   const saved=P.capture(snap,'Model pen',{penSettings:s.pen});assert.equal(P.validate(saved).position.x,pos.x);
   const memory=Memory.createMemory();memory.remember(snap.wizard,serial);assert.equal(memory.forDevice(serial).calibrationPoint.z,q.downZ);
   const receipt=Receipt.create({});receipt.record(serial,fake.state,pos,q);assert(Receipt.allowed(receipt.get(),serial,fake.state,q));
   assert.equal(Wizard.returnSteps(pos,{...pos,x:pos.x-5},40,5,model).at(-1).end.x,pos.x-5);
   const highJob=Job.prepare(s,q,pos,pos);Pack.build(highJob);
   assert.equal(Tune.chunk(highJob.chunks[0],highJob,Tune.request(Tune.create(highJob),{level:3},highJob),pos,0).end.z,q.upZ);
  });
  await check(model+': whole command is rejected before any packet if later motion is outside range',async()=>{
   const n=fake.commands.length;await assert.rejects(Motion.run(fake,'G1 X10 F60\nG1 Z'+(m.z+1)+' F60\n',1),/超出/);assert.equal(fake.commands.length,n);
  });
  await check(model+': streaming completes two jobs and a stop at the same return point',async()=>{
   const one=await Job.execute(fake,job);assert.deepEqual(one.position,start);assert.equal(one.status,'commands_sent');
   assert.deepEqual((await Job.execute(fake,Job.prepare(s,p,one.position))).position,start);
   const stopped=await Job.execute(fake,job,{cancelled:()=>true});assert.equal(stopped.status,'stopped');assert.deepEqual(stopped.position,start);
  });
  await check(model+': pairing, homing, calibration and next-job lifecycle through actual bridge',async()=>{
   let saved;const printer=new Fake(model),b=createBridge({printerFactory:()=>printer,onCredentials:v=>{saved=v;}});try{
    await b.connect({...pair,model});assert.equal(b.snapshot().device.model,model);assert.equal(saved.model,model);assert.equal(printer.commands.length,0);
    const wrong=scene(model==='a1-mini'?'a1':'a1-mini').p;
    await assert.rejects(b.action('wizard/finish',{profile:wrong}),/不一致/);assert.equal(printer.commands.length,0);
    await b.action('wizard/home',{bare:true});let snap=await settled(b);assert.equal(snap.wizard.phase,'install');assert.deepEqual(snap.position,m.park);
    const id=snap.wizard.id;await b.action('wizard/installed',{id,installed:true});await b.action('wizard/jog',{id,delta:-40,continuous:true});snap=await settled(b);assert.equal(snap.position.z,20);
    await b.action('wizard/finish',{id,contact:true,lift:2,profile:p});snap=await settled(b);assert(snap.motionReference.ready);assert.equal(snap.wizard.profile.downZ,20);
    const commandsBeforeSave=printer.commands.length,positionBeforeSave={...snap.position};await b.connect({...pair,model});snap=b.snapshot();assert(snap.motionReference.ready);assert.equal(snap.wizard.id,id);assert.deepEqual(snap.position,positionBeforeSave);assert.equal(printer.commands.length,commandsBeforeSave);
    const profile=snap.wizard.profile;await b.action('prepare',{state:s,profile,position:snap.position});snap=b.snapshot();
    await b.action('start',{id:snap.prepared.id,sha256:snap.prepared.sha256,observedStart:true,clearRoute:true});snap=await settled(b);
    assert(snap.motionReference.ready);assert.deepEqual(snap.position,m.park);
    await b.action('prepare',{state:s,profile,position:snap.position});assert(b.snapshot().prepared);assert.equal(printer.commands.filter(c=>/\bG28\b/.test(c.param||'')).length,1);
    printer.state.home_flag=0;await b.connect({...pair,model});assert.equal(b.snapshot().position,null);assert.equal(b.snapshot().motionReference.ready,false);assert.equal(b.snapshot().wizard.profile.downZ,20);
   }finally{await b.close();}
  });
  await check(model+': complete upload is read back, started with correct fields and can be repeated',async()=>{
   const printer=new Fake(model),uploads=[],session=createFileSession({ftpFactory:()=>({async connect(){},async login(){},async uploadVerified(filename,buffer){uploads.push({filename,buffer});return{bytes:buffer.length,readbackVerified:true,sha256:crypto.createHash('sha256').update(buffer).digest('hex')};},async finish(){},close(){}})});
   session.attach(printer,serial);
   for(let n=0;n<2;n++){
    const task=Job.prepare(s,p,start),result=await session.start(task,'12345678');assert(result.uploaded);assert.equal(result.model,model);
    const sent=printer.commands.at(-1);assert.equal(sent.command,'project_file');assert.equal(sent.bed_type,'hot_plate');assert.equal(sent.bed_leveling,false);assert.equal(sent.use_ams,false);
    printer.report({gcode_state:'RUNNING',gcode_file:result.filename,mc_percent:1});printer.report({gcode_state:'FINISH',mc_percent:100});await new Promise(r=>setImmediate(r));
    assert.equal(session.snapshot().phase,'complete');assert.deepEqual(session.completedPosition().position,start);
   }
   assert.equal(uploads.length,2);assert.notEqual(uploads[0].filename,uploads[1].filename);session.detach();
  });
  await check(model+': full-file finish, speed changes, cancellation and next job retain calibration through bridge',async()=>{
   const printer=new Fake(model),b=createBridge({printerFactory:()=>printer,ftpFactory:()=>({async connect(){},async login(){},async uploadVerified(filename,buffer){return{bytes:buffer.length,readbackVerified:true,sha256:crypto.createHash('sha256').update(buffer).digest('hex')};},async finish(){},close(){}})});
   try{
    await b.connect({...pair,model});await b.action('wizard/home',{bare:true});let snap=await settled(b),id=snap.wizard.id;
    await b.action('wizard/installed',{id,installed:true});await b.action('wizard/jog',{id,delta:-40,continuous:true});await settled(b);
    await b.action('wizard/finish',{id,contact:true,lift:2,profile:p});snap=await settled(b);const profile=snap.wizard.profile;
    for(const outcome of ['complete','stop','complete']){
     await b.action('prepare',{state:s,profile,position:b.snapshot().position});const task=b.snapshot().prepared;
     await b.action('start-file',{id:task.id,sha256:task.sha256,observedStart:true,clearRoute:true});const filename=b.snapshot().fileTask.filename;
     printer.report({gcode_state:'RUNNING',gcode_file:filename,mc_percent:1});
     for(const level of [1,2,3,4,2]){await b.action('file/speed',{level});assert.equal(printer.commands.at(-1).command,'print_speed');assert.equal(printer.commands.at(-1).param,String(level));}
     if(outcome==='stop'){await b.action('stop',{});assert.equal(printer.commands.at(-1).command,'stop');printer.report({gcode_state:'FAILED',mc_percent:20});}
     else printer.report({gcode_state:'FINISH',mc_percent:100});
     snap=await settled(b);assert(snap.motionReference.ready,JSON.stringify(snap.motionReference));assert.deepEqual(snap.position,m.park);assert.equal(snap.wizard.profile.downZ,20);assert.equal(snap.wizard.profile.upZ,22);
    }
    assert.equal(printer.commands.filter(c=>/\bG28\b/.test(c.param||'')).length,1,'No repeated homing between tasks');
   }finally{await b.close();}
  });
  await check(model+': saved full-travel preset, reconnect, height refinement and user-confirmed file send',async()=>{
   let storedReceipt=null,storedMemory=null,printer;
   const b=createBridge({printerFactory:()=>printer=new Fake(model),loadPositionReceipt:()=>storedReceipt,savePositionReceipt:v=>storedReceipt=v,loadCalibrationReference:()=>storedMemory,saveCalibrationReference:v=>storedMemory=v});
   try{
    await b.connect({...pair,model});const park={x:m.w-22,y:m.h-24,z:m.z-3},profile={...p,downZ:m.z-8,upZ:m.z-6};
    const saved=P.capture({device:{serial},busy:false,position:park,wizard:{phase:'complete',profile,contact:{downZ:profile.downZ,upZ:profile.upZ},calibrationPoint:{...park,z:profile.downZ},returnTo:park}},'Saved '+model,{penSettings:s.pen});
    await b.action('position',{position:park,observed:true});await b.action('wizard/activate-preset',{preset:saved,unchanged:true});assert(b.snapshot().motionReference.ready);
    printer.close();await b.connect({...pair,model});assert.equal(printer.commands.length,0);assert(b.snapshot().motionReference.canReusePosition);
    await b.action('wizard/reuse-position',{preset:saved,unchanged:true});assert.equal(printer.commands.length,0);assert.deepEqual(b.snapshot().position,park);
    let snap=b.snapshot();await b.action('wizard/refine',{id:snap.wizard.id,profile:snap.wizard.profile,unchanged:true});snap=await settled(b);
    assert.equal(snap.wizard.phase,'adjust');assert.equal(snap.position.z,profile.downZ);assert.equal(snap.position.x,park.x);
    await b.action('wizard/finish',{id:snap.wizard.id,contact:true,lift:2,profile});snap=await settled(b);assert(snap.motionReference.ready);
    // Loss of the firmware homed flag does not invent a motion-ready position.
    printer.report({home_flag:0});assert(!b.snapshot().motionReference.ready);
    const commands=printer.commands.length;await b.action('prepare-file',{state:s,profile:snap.wizard.profile,unchanged:true,clearRoute:true});
    assert(b.snapshot().prepared.fileOnly);assert.equal(printer.commands.length,commands);assert(!b.snapshot().motionReference.ready);
   }finally{await b.close();}
  });
  await check(model+': damaged upload cannot start the file and extreme speed stays within model limits',async()=>{
   const printer=new Fake(model),session=createFileSession({ftpFactory:()=>({async connect(){},async login(){},async uploadVerified(){return{readbackVerified:true,sha256:'0'.repeat(64)};},close(){}})});
   session.attach(printer,serial);try{await assert.rejects(session.start(job,'12345678'),/读回/);assert.equal(printer.commands.length,0);}finally{session.detach();}
   const fast=scene(model);fast.s.pen.speedMode='extreme';fast.s.pen.drawSpeed=500;fast.s.pen.travelSpeed=500;fast.p.liftSpeed=m.lift;fast.p.zSpeed=15;
   const prepared=Job.prepare(fast.s,fast.p,fast.start);Pack.build(prepared);
   const tuned=Tune.chunk(prepared.chunks[0],prepared,Tune.request(Tune.create(prepared),{level:4,delta:-.05},prepared),fast.start,0);
   for(const line of tuned.code.split('\n'))if(/^G1\b/.test(line)){const feed=+(/F([\d.]+)/.exec(line)?.[1]);assert(feed<=(/\bZ/.test(line)?m.lift:500)*60+.001);}
   assert.throws(()=>Tune.request(Tune.create(prepared),{delta:-2},prepared),/0.05/);
  });
  await check(model+': completed file retains large coordinates and does not attach to another model',()=>{
   const filename='a1pen_1234567890abcdef12345678.gcode.3mf',end={x:m.w-20,y:m.h-20,z:m.z-2};
   fake.report({gcode_state:'FINISH',gcode_file:filename,mc_percent:100});
   const record={version:1,model,serial,filename,phase:'complete',completionConfirmed:true,completionHomeFlag:7,end},session=createFileSession({load:()=>record});session.attach(fake,serial);
   assert.deepEqual(session.completedPosition().position,end);
   session.attach(new Fake(model==='p1s'?'a1':'p1s'),serial);assert.equal(session.completedPosition(),null);session.detach();
  });
 }
 await check('Missing model is rejected before network I/O; absent firmware identity does not block a selected model',async()=>{
  let count=0;const p=new Fake('a1');p.version=null;const b=createBridge({printerFactory:()=>{count++;return p;}});try{for(const model of [undefined,'auto','x1'])await assert.rejects(b.connect({...pair,model}),/请选择打印机型号/);assert.equal(count,0);assert.equal(p.commands.length,0);await b.connect({...pair,model:'a1'});assert.equal(b.snapshot().device.model,'a1');assert.equal(count,1);}finally{await b.close();}
 });
 await check('Changing the selected model replaces the session instead of reusing old model coordinates',async()=>{
  const connections=[];const b=createBridge({printerFactory:()=>{const p=new Fake('a1');p.version=null;connections.push(p);return p;}});try{await b.connect({...pair,model:'a1'});await b.action('wizard/home',{bare:true});await settled(b);assert(b.snapshot().position);await b.connect({...pair,model:'p1s'});const s=b.snapshot();assert.equal(s.device.model,'p1s');assert.equal(s.position,null);assert.equal(s.wizard,null);assert.equal(connections.length,2);assert.equal(connections[0].connected,false);assert.equal(connections[1].commands.length,0);}finally{await b.close();}
 });
})().catch(e=>{console.error(e);process.exitCode=1;});

