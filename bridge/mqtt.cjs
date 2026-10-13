'use strict';
const tls=require('node:tls'),crypto=require('node:crypto'),{EventEmitter}=require('node:events'),Policy=require('./printer-policy.cjs');
const utf=s=>{const b=Buffer.from(s),n=Buffer.alloc(2);if(b.length>65535)throw Error('MQTT string too large');n.writeUInt16BE(b.length);return Buffer.concat([n,b]);};
function packet(h,b){let n=b.length,l=[];do{let d=n%128;n=Math.floor(n/128);if(n)d|=128;l.push(d);}while(n);return Buffer.concat([Buffer.from([h,...l]),b]);}
const KEYS=['gcode_state','gcode_file','subtask_name','home_flag','print_error','nozzle_temper','nozzle_target_temper','bed_temper','bed_target_temper','mc_percent','mc_remaining_time','mc_print_line_number','stg_cur','wifi_signal','sdcard','fun','spd_mag','spd_lvl'];
class Printer extends EventEmitter {
 constructor(options){super();this.options=options;this.state={};this.lastStatus=0;this.statusRevision=0;this.fieldRevision={};this.fieldTime={};this.lastPacketAt=Date.now();this.full=false;this.pending=new Map();this.sequence=24000+crypto.randomInt(2000);this.input=Buffer.alloc(0);this.connected=false;this.version=null;}
 async connect(code){
  if(!/^[A-Za-z0-9]{8}$/.test(code))throw Error('Invalid access code');
  if(this.socket)throw Error('Already initialized');
  const ready=this.waitFor(()=>this.connected&&this.full&&!!this.version,20000);
  ready.catch(()=>{});
  this.socket=tls.connect({...this.options,port:8883,rejectUnauthorized:true,minVersion:'TLSv1.2'},()=>{
   const payload=Buffer.concat([utf('a1pen-'+crypto.randomBytes(8).toString('hex')),utf('bblp'),utf(code)]);
   this.socket.write(packet(0x10,Buffer.concat([utf('MQTT'),Buffer.from([4,0xC2,0,30]),payload])));code='';
  });
  this.socket.on('data',b=>{try{this.receive(b);}catch(e){this.fail(e);}});this.socket.on('error',e=>this.fail(e));this.socket.on('close',()=>this.fail(Error('Printer connection closed')));
  this.ping=setInterval(()=>this.heartbeat(),10000);
  try{await ready;return this.snapshot();}catch(e){this.close();throw e;}
 }
 fail(e){this.connected=false;clearInterval(this.ping);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();this.emit('failure',e);if(this.socket&&!this.socket.destroyed)this.socket.destroy();}
 close(){this.fail(Error('Disconnected'));}
 heartbeat(now=Date.now()){
  if(!this.connected)return;
  if(now-this.lastPacketAt>45000){const e=Error('打印机连接已失去响应，正在等待重新连接');e.code='ETIMEDOUT';this.fail(e);return;}
  this.socket.write(Buffer.from([0xc0,0]));
 }
 snapshot(){const now=Date.now();return {connected:this.connected,tlsVerified:this.socket?.authorized===true,full:this.full,ageMs:now-this.lastStatus,fieldAgeMs:Object.fromEntries(Object.entries(this.fieldTime).map(([key,time])=>[key,now-time])),state:{...this.state},version:this.version};}
 async fresh({force=false,fields=[]}={}){
  if(!this.connected)throw Error('Printer not connected');
  if(!Array.isArray(fields)||fields.some(k=>!KEYS.includes(k)&&k!=='hms'))throw Error('Invalid printer status fields');
  if(force||fields.length){
   const before=this.statusRevision,check=()=>this.full&&this.statusRevision>before&&fields.every(k=>this.fieldRevision[k]>before);
   const pending=this.waitFor(check,8000);pending.catch(()=>{});
   try{this.publish('pushing','pushall',{version:1,push_target:1});return await pending;}catch(e){this.fail(e);throw e;}
  }
  if(this.full&&Date.now()-this.lastStatus<5000)return this.snapshot();
  if(this.refreshing)return this.refreshing;
  const before=this.lastStatus;
  this.refreshing=this.waitFor(()=>this.full&&this.lastStatus>before,8000);
  const pending=this.refreshing;pending.catch(()=>{});
  try{this.publish('pushing','pushall',{version:1,push_target:1});return await pending;}catch(e){this.fail(e);throw e;}finally{this.refreshing=null;}
 }
 idle({homed=false,operation='motion',thermal='cold'}={}){const s=this.snapshot();if(!s.connected||!s.full||s.ageMs>10000)throw Error('Printer status is missing or stale');const acknowledgedCancellation=s.state.gcode_state==='FAILED'&&s.state.print_error===0&&Array.isArray(s.state.hms)&&Policy.blockingHms(s.state).length===0&&this.cancelledTaskIsIdle?.()===true;if(!Policy.taskIdle(s.state)&&!acknowledgedCancellation)throw Error('Printer is busy');Policy.assertOperation(s.state,operation);if(s.state.nozzle_target_temper!==0||s.state.bed_target_temper!==0)throw Error('打印机仍设定了加热目标，请先关闭喷嘴和热床加热');if(!['cold','bare','observed'].includes(thermal))throw Error('未知温度检查模式');if(!Number.isFinite(s.state.nozzle_temper)||!Number.isFinite(s.state.bed_temper))throw Error('尚未收到有效的喷嘴与热床温度');if(thermal==='cold'&&(s.state.nozzle_temper>50||s.state.bed_temper>45))throw Error('加热已关闭；喷嘴 '+Math.round(s.state.nozzle_temper)+'°C、热床 '+Math.round(s.state.bed_temper)+'°C。装夹与绘画前请等喷嘴降至 50°C、热床降至 45°C 以下；已有校准参数保留');if(homed&&(!Number.isInteger(s.state.home_flag)||(s.state.home_flag&7)!==7)&&this.retainedPositionConfirmed?.()!==true)throw Error('XYZ homing is not confirmed');return s;}
 waitFor(predicate,ms){return new Promise((resolve,reject)=>{let timer;const clean=()=>{clearTimeout(timer);this.off('update',check);this.off('failure',bad);};const check=()=>{if(predicate()){clean();resolve(this.snapshot());}};const bad=e=>{clean();reject(e);};timer=setTimeout(()=>bad(Error('Printer observation timed out')),ms);this.on('update',check);this.on('failure',bad);check();});}
 publish(section,command,fields={},ack=false,ackTimeoutMs=12000){
  if(!this.connected)throw Error('Printer not connected');
  const allowed={info:['get_version'],pushing:['pushall'],print:['gcode_line','gcode_file','project_file','print_speed','stop','clean_print_error'],system:['uiop']};if(!allowed[section]?.includes(command))throw Error('Command not supported');
  if(command==='clean_print_error'&&(fields.print_error!==Policy.STORAGE_FAULT||fields.subtask_id!==''))throw Error('Only the verified storage error can be acknowledged');
  if(command==='uiop'&&(fields.name!=='print_error'||fields.action!=='close'||fields.source!==1||fields.type!=='dialog'||fields.err!=='0500C010'))throw Error('Only the verified storage dialog can be acknowledged');
  if(!Number.isFinite(ackTimeoutMs)||ackTimeoutMs<1||ackTimeoutMs>2147483647)throw Error('Invalid acknowledgement timeout');
  const sequence_id=String(++this.sequence),body={[section]:{...fields,command,sequence_id}};
  let result=Promise.resolve({sequence_id,sent:true});if(ack)result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(sequence_id);reject(Error('Command acknowledgement timed out; delivery is uncertain, do not retry automatically'));},ackTimeoutMs);this.pending.set(sequence_id,{command,resolve,reject,timer});});
  try{this.socket.write(packet(0x30,Buffer.concat([utf('device/'+this.options.servername+'/request'),Buffer.from(JSON.stringify(body))])));}catch(e){const pending=this.pending.get(sequence_id);if(pending){this.pending.delete(sequence_id);clearTimeout(pending.timer);pending.reject(e);result.catch(()=>{});return result;}throw e;}return result;
 }
 async probe(){this.idle();const motion=require('./motion.cjs');return await motion.ensureReady(this,false)||motion.run(this,'',0,{homed:false});}
 async restoreNormalSpeed(){
  await this.fresh({force:true,fields:['gcode_state','print_error','hms','spd_mag','nozzle_temper','nozzle_target_temper','bed_temper','bed_target_temper']});this.idle();
  if(this.state.spd_mag===100)return this.snapshot();
  let cleanup;const observed=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{cleanup();reject(Error('尚未收到正常倍率的实时确认，请刷新机器状态'));},8000);
   const status=value=>{if(value.print?.command==='push_status'&&Object.hasOwn(value.print,'spd_mag')&&value.print.spd_mag===100){cleanup();resolve(this.snapshot());}};
   const failure=e=>{cleanup();reject(e);};cleanup=()=>{clearTimeout(timer);this.off('message',status);this.off('failure',failure);};this.on('message',status);this.on('failure',failure);
  });observed.catch(()=>{});
  try{await Promise.all([this.publish('print','print_speed',{param:'2'},true),observed]);this.idle();if(this.state.spd_mag!==100)throw Error('打印机倍率已再次变化，请重新检查');return this.snapshot();}finally{cleanup();}
 }
 async acknowledgeStorageError(){
  this.idle({operation:'motion'});if(!Policy.storageFault(this.state)||this.state.sdcard!==true)throw Error('当前不是可确认的存储卡错误');
  // Bambu Studio DeviceManager.cpp uses these two commands. Their delivery is
  // not proof of recovery: only a new raw push_status with print_error=0 is.
  let cleanup;const observed=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{cleanup();reject(Error('打印机尚未确认存储错误已解除，请在机器上检查存储卡'));},8000);
   const status=value=>{if(value.print?.command==='push_status'&&Object.hasOwn(value.print,'print_error')&&value.print.print_error===0){cleanup();resolve(this.snapshot());}};
   const failure=e=>{cleanup();reject(e);};cleanup=()=>{clearTimeout(timer);this.off('message',status);this.off('failure',failure);};this.on('message',status);this.on('failure',failure);
  });observed.catch(()=>{});
  try{this.publish('print','clean_print_error',{subtask_id:'',print_error:Policy.STORAGE_FAULT});this.publish('system','uiop',{name:'print_error',action:'close',source:1,type:'dialog',err:'0500C010'});this.publish('pushing','pushall',{version:1,push_target:1});return await observed;}finally{cleanup();}
 }
 receive(b){this.input=Buffer.concat([this.input,b]);if(this.input.length>2*1024*1024)throw Error('MQTT frame budget exceeded');while(this.input.length>=2){let n=0,m=1,p=1,done=false;for(let i=0;i<4;i++){if(p>=this.input.length)return;const d=this.input[p++];n+=(d&127)*m;if(!(d&128)){done=true;break;}m*=128;}if(!done||n>1024*1024)throw Error('Invalid MQTT length');if(this.input.length<p+n)return;const h=this.input[0],body=this.input.subarray(p,p+n);this.input=this.input.subarray(p+n);this.handle(h,body);}}
 handle(h,b){
  this.lastPacketAt=Date.now();
  const type=h>>4;
  if(type===13){if(b.length)throw Error('Invalid MQTT ping response');return;}
  if(type===2){if(b.length!==2||b[1]!==0)throw Error('Printer login rejected');this.socket.write(packet(0x82,Buffer.concat([Buffer.from([0,1]),utf('device/'+this.options.servername+'/report'),Buffer.from([0])])));return;}
  if(type===9){if(b.length<3||b.readUInt16BE(0)!==1||b[2]===128)throw Error('Subscription rejected');this.connected=true;this.publish('info','get_version');this.publish('pushing','pushall',{version:1,push_target:1});return;}
  if(type!==3)return;
  if(b.length<2)throw Error('Malformed MQTT message');const n=b.readUInt16BE(0);let p=n+2;if(p>b.length)throw Error('Invalid topic');const topic=b.subarray(2,p).toString();if(((h>>1)&3)===1){if(p+2>b.length)throw Error('Missing packet id');this.socket.write(packet(0x40,b.subarray(p,p+2)));p+=2;}else if((h>>1)&3)throw Error('Unexpected MQTT QoS');
  if(topic!=='device/'+this.options.servername+'/report')return;const j=JSON.parse(b.subarray(p).toString());
  if(j.info?.command==='get_version')this.version=(j.info.module||[]).map(m=>({name:m.name,sw_ver:m.sw_ver,hw_ver:m.hw_ver,project_name:m.project_name}));
  if(j.print?.command==='push_status'){
   const v=j.print,now=Date.now(),revision=++this.statusRevision;for(const k of KEYS)if(Object.hasOwn(v,k)){this.state[k]=v[k];this.fieldRevision[k]=revision;this.fieldTime[k]=now;}if(Array.isArray(v.hms)){this.state.hms=v.hms.map(x=>({attr:x.attr,code:x.code}));this.fieldRevision.hms=revision;this.fieldTime.hms=now;}if(v.msg===0)this.full=true;this.lastStatus=now;
  }
  for(const section of ['print','info']){const v=j[section],pending=this.pending.get(String(v?.sequence_id));if(pending&&v.command===pending.command){this.pending.delete(String(v.sequence_id));clearTimeout(pending.timer);if(String(v.result).toLowerCase()==='success')pending.resolve(v);else pending.reject(Error('Printer command rejected: '+String(v.reason||v.result||'no success result')));}}
  this.emit('message',j);this.emit('update',this.snapshot());
 }
}
module.exports={Printer,packet,utf};
