'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createBridge}=require('../bridge/server.cjs'),{createPairStore}=require('../desktop/pair-store.cjs'),{createAutoConnect}=require('../desktop/autoconnect.cjs'),{createConnectionControls}=require('../desktop/connection-controls.cjs'),Models=require('../printer-models.js');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'pen-connection-edit-'));
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
const original={ip:'192.168.240.10',serial:'TESTMODEL0001',accessCode:'12345678'};
class Fake extends EventEmitter{
 constructor(model,calls){super();this.version=[{name:'esp32',hw_ver:Models.get(model).hardware}];this.calls=calls;this.connected=false;}
 async connect(code){this.calls.push(code);this.connected=true;}close(){this.connected=false;}async fresh(){return this.snapshot();}
 snapshot(){return{connected:this.connected,full:true,ageMs:0,state:{gcode_state:'IDLE',home_flag:7,print_error:0,hms:[]}};}
 publish(){throw Error('Connection editing must not move a printer');}
}
(async()=>{try{
 for(const model of ['a1-mini','a1','p1s']){
  const store=createPairStore({directory:path.join(data,model),safeStorage,allowBundled:false});store.save(original);
  const calls=[],bridge=createBridge({printerFactory:()=>new Fake(model,calls),onCredentials:p=>store.save(p)}),autoConnect=createAutoConnect({bridge,loadPair:()=>store.load()});
  const controls=createConnectionControls({bridge,autoConnect,loadPair:()=>store.load()});
  try{
   await autoConnect.connect();assert.equal(autoConnect.status().phase,'model_required');assert.deepEqual(autoConnect.status().modelOptions,['a1-mini','a1','p1s']);
   assert.equal(calls.length,0,'missing saved model must prompt before connecting to hardware');const incompleteCalls=calls.length;autoConnect.resume();await autoConnect.connect();assert.equal(calls.length,incompleteCalls,'incomplete model must wait for a choice instead of retrying forever');
   await assert.rejects(controls.pair({...original,model:'auto',accessCode:''}),/请选择打印机型号/);
   const connected=await controls.pair({...original,model,accessCode:''});assert.equal(connected.device.model,model);
   await autoConnect.connect();assert.equal(autoConnect.status().phase,'connected');assert.deepEqual(autoConnect.status().modelOptions,[]);
   const before=calls.length;await controls.pair({...original,model,accessCode:''});assert.equal(calls.length,before,'unchanged details must keep the live connection');
   const movedIP='192.168.240.11';await controls.pair({...original,ip:movedIP,model,accessCode:''});
   assert.deepEqual(await store.load(),{...original,ip:movedIP,model});assert.equal(calls.at(-1),original.accessCode);
   assert.equal(await controls.savedAccessCode(original.serial),original.accessCode);assert.equal(await controls.savedAccessCode('OTHERPRINTER1'),'');assert(!Object.hasOwn(store.publicPair(),'accessCode'));
   const count=calls.length;await assert.rejects(controls.pair({...original,serial:'OTHERPRINTER1',model,accessCode:''}),/访问码/);assert.equal(calls.length,count);
   await controls.pair({...original,model,accessCode:'87654321'});assert.equal((await store.load()).accessCode,'87654321');
   fs.writeFileSync(path.join(data,model,'printer.enc.json'),'broken');await assert.rejects(controls.pair({...original,model,accessCode:''}),/无法读取/);
   await controls.pair({...original,model});assert.equal((await store.load()).accessCode,original.accessCode);
   store.forget();await assert.rejects(controls.pair({...original,model,accessCode:''}),/访问码/);assert.equal(await controls.savedAccessCode(original.serial),'');
   console.log('PASS '+model+': legacy pairing, select model with saved code, IP change, explicit model preserved, replace code, corrupt store, forget, no motion');
  }finally{await bridge.close();}
 }
}finally{const base=path.resolve(os.tmpdir())+path.sep;if(!path.resolve(data).startsWith(base)||!path.basename(data).startsWith('pen-connection-edit-'))throw Error('Unexpected test directory');fs.rmSync(data,{recursive:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
