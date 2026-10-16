'use strict';
const assert=require('node:assert/strict'),tls=require('node:tls'),net=require('node:net'),{EventEmitter}=require('node:events');
const {Printer,packet,utf}=require('../bridge/mqtt.cjs'),{createBridge}=require('../bridge/server.cjs');
const {createAutoConnect}=require('../desktop/autoconnect.cjs'),{startConnectionLifecycle}=require('../desktop/connection-lifecycle.cjs');
const pair={ip:'192.168.240.10',serial:'TESTSOAK0001',accessCode:'12345678',model:'a1-mini'};
const state={gcode_state:'IDLE',home_flag:7,print_error:0,hms:[],nozzle_temper:25,nozzle_target_temper:0,bed_temper:25,bed_target_temper:0,spd_mag:100};
let online=true,handshake=true;const sockets=[],printers=[];const originalConnect=tls.connect;
class Socket extends EventEmitter{
 constructor(){super();this.authorized=true;this.destroyed=false;this.status=true;this.writes=[];}
 send(header,body){queueMicrotask(()=>{if(!this.destroyed)this.emit('data',packet(header,body));});}
 report(value){this.send(0x30,Buffer.concat([utf('device/'+pair.serial+'/report'),Buffer.from(JSON.stringify(value))]));}
 write(buffer){
  if(this.destroyed)throw Error('Closed socket');const type=buffer[0]>>4;
  if(type===1){if(handshake&&online)this.send(0x20,Buffer.from([0,0]));return;}
  if(type===8){this.send(0x90,Buffer.from([0,1,0]));return;}
  if(type===12){if(online)this.send(0xd0,Buffer.alloc(0));return;}
  if(type!==3)return;let p=1;while(buffer[p++]&128){}const n=buffer.readUInt16BE(p);p+=2+n;
  const value=JSON.parse(buffer.subarray(p).toString());this.writes.push(value);
  assert(!value.print,'Reconnect and status checks must never send printer commands');
  if(!online)return;
  if(value.info)this.report({info:{command:'get_version',module:[null,{name:'esp32',hw_ver:'AP05',project_name:'N1'}]}});
  if(value.pushing&&this.status)this.report({print:{command:'push_status',msg:0,...state}});
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;queueMicrotask(()=>this.emit('close'));}
}
tls.connect=(_options,callback)=>{const s=new Socket();sockets.push(s);queueMicrotask(callback);return s;};
function makePrinter(){const p=new Printer({host:pair.ip,servername:pair.serial});const wait=p.waitFor.bind(p);p.waitFor=(fn,ms)=>wait(fn,Math.min(ms,60));printers.push(p);return p;}
const turn=()=>new Promise(r=>setImmediate(r));
(async()=>{let bridge,lifecycle,raw;try{
 const p=makePrinter();await p.connect(pair.accessCode);const socket=sockets.at(-1);assert.equal(p.version,null);assert(socket.writes.every(v=>!v.info),'connect must not request or wait for model detection');
 const count=socket.writes.length;await Promise.all(Array.from({length:25},()=>p.fresh({force:true})));assert.equal(socket.writes.length-count,1);assert.equal(p.listenerCount('failure'),0);
 await assert.rejects(p.fresh({force:true,fields:['gcode_file','stg_cur']}),/timed out/);assert(p.connected,'Missing optional fields must not disconnect responding printer');
 await p.fresh({force:true});console.log('PASS real MQTT parser: no model report or request needed, 25 refreshes share one request, missing fields reject without disconnect');
 let failures=0;p.on('failure',()=>failures++);p.fail(Error('Network lost'));socket.emit('error',Error('Late socket error'));p.close();await turn();assert.equal(failures,1);assert.equal(p.connected,false);p.handle(0x90,Buffer.from([0,1,0]));assert.equal(p.connected,false);
 const broken=makePrinter();await broken.connect(pair.accessCode);broken.socket.write=()=>{throw Error('Write failed');};assert.doesNotThrow(()=>broken.heartbeat());assert.equal(broken.connected,false);console.log('PASS error/close races report once; late packets cannot revive dead sockets; heartbeat write errors are contained');
 bridge=createBridge({printerFactory:makePrinter});await bridge.listen(0);
 let now=0,interval;const events=[],power=new EventEmitter();const auto=createAutoConnect({bridge,loadPair:()=>pair,now:()=>now});
 lifecycle=startConnectionLifecycle({bridge,autoConnect:auto,powerMonitor:power,now:()=>now,setIntervalFn:fn=>(interval=fn,{unref(){}}),clearIntervalFn:()=>{},onEvent:e=>events.push(e)});
 await interval();assert(bridge.snapshot().printer.connected);const initial=printers.length;
 // Advance wall time without sleeping or touching a real printer.
 for(let i=0;i<144;i++){now+=30*60*1000;await interval();}
 assert.equal(printers.length,initial);assert(bridge.snapshot().printer.connected);
 for(let i=0;i<12;i++){
  const old=printers.at(-1);old.fail(Error('Wi-Fi interrupted'));now+=30000;await interval();assert(bridge.snapshot().printer.connected);assert.notEqual(printers.at(-1),old);
 }
 console.log('PASS 72 simulated idle hours, 12 Wi-Fi outages: status checked with no renderer and one replacement connection per outage');
 const stale=printers.at(-1);stale.socket.status=false;now+=30000;await interval();assert.equal(stale.connected,false);assert(bridge.snapshot().printer.connected);assert(events.some(e=>e.event==='connection-health-failed'));
 const beforeWake=printers.length;power.emit('suspend');printers.at(-1).socket.status=false;now+=5*60*60*1000;await interval();assert.equal(printers.length,beforeWake);await lifecycle.wake();assert.equal(printers.length,beforeWake+1);assert(bridge.snapshot().printer.connected);
 console.log('PASS ping-responsive but stale status reconnects; suspend pauses checks and wake probes immediately');
 online=false;printers.at(-1).fail(Error('Offline'));now+=30000;await interval();assert.equal(bridge.snapshot().busy,false);const offlineCount=printers.length;await interval();assert.equal(printers.length,offlineCount);online=true;now+=30000;await interval();assert(bridge.snapshot().printer.connected);
 auto.setUserEnabled(false);printers.at(-1).fail(Error('Manual disconnect'));now+=30000;await interval();assert.equal(bridge.snapshot().printer.connected,false);auto.setUserEnabled(true);await interval();assert(bridge.snapshot().printer.connected);
 console.log('PASS offline timeout releases busy state, retries respect backoff, manual disconnect remains disconnected');
 lifecycle.stop();lifecycle=null;await bridge.disconnect();handshake=false;
 const connecting=bridge.connect(pair);await turn();bridge.abortConnect();await assert.rejects(connecting,/Disconnected|取消/);assert.equal(bridge.snapshot().busy,false);handshake=true;await bridge.connect(pair);
 console.log('PASS closing during login cancels the socket and releases connection state');
 raw=net.connect(new URL(bridge.origin).port,'127.0.0.1');await new Promise(r=>raw.once('connect',r));raw.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
 await Promise.race([bridge.close(),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('HTTP connection kept shutdown open')),1000);t.unref();})]);await assert.rejects(bridge.connect(pair),/关闭/);
 console.log('PASS partial HTTP request cannot keep shutdown open; a closed service cannot reconnect');
 }finally{raw?.destroy();lifecycle?.stop();for(const p of printers)p.close();tls.connect=originalConnect;await bridge?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
