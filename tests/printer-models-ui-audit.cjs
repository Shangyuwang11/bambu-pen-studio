'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path');
const Models=require('../printer-models.js'),{Printer}=require('../bridge/mqtt.cjs'),{createBridge}=require('../bridge/server.cjs');
const {chromium}=require(process.env.A1_PEN_PLAYWRIGHT||'playwright');
class Fake extends EventEmitter {
 constructor(model){super();const m=Models.get(model);this.version=[{name:'esp32',hw_ver:m.hardware,project_name:m.project}];this.connected=true;this.state={gcode_state:'IDLE',gcode_file:'',subtask_name:'',home_flag:7,spd_mag:100,print_error:0,hms:[],mc_percent:0,mc_remaining_time:0,sdcard:true,nozzle_temper:25,nozzle_target_temper:0,bed_temper:25,bed_target_temper:0};this.commands=[];}
 async connect(){this.connected=true;}async fresh(){return this.snapshot();}close(){this.connected=false;}
 snapshot(){return{connected:this.connected,full:true,ageMs:0,state:{...this.state}};}
 idle(o){return Printer.prototype.idle.call({...this,full:true,ageMs:0},o);}
 async publish(...v){this.commands.push(v);throw Error('UI test must never issue machine commands');}
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.A1_PEN_BROWSER?{executablePath:process.env.A1_PEN_BROWSER}:{})});
 try{for(const model of ['a1','p1s']){
  const p=new Fake(model),b=createBridge({printerFactory:()=>p});await b.listen(0);const context=await browser.newContext(),page=await context.newPage(),errors=[];
  try{page.on('pageerror',e=>errors.push(e.message));await page.goto(b.origin);await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');
   await page.evaluate(()=>PenNativeShell.go('devices'));await page.locator('#deviceAdd').click();assert.equal(await page.locator('#deviceModel').inputValue(),'');assert.equal(await page.locator('#deviceModel option[value=auto]').count(),0);
   await page.locator('#deviceModel').selectOption(model);await page.locator('#lanIP').fill('192.168.240.10');await page.locator('#lanSerial').fill('TESTMODEL0001');await page.locator('#lanCode').fill('12345678');await page.locator('#devicePair').click();
   await page.waitForFunction(()=>document.querySelector('#deviceState').dataset.connected==='true');
   assert.equal(await page.locator('.device-model-label').textContent(),Models.get(model).name);assert(await page.locator('#deviceModelInfo').textContent().then(t=>t.includes('尚未实机验证')));
   await page.locator('#stepCalibration').click();await page.locator('#calBare').check();assert(await page.locator('#calHome').isDisabled());assert.match(await page.locator('#calHome').getAttribute('title'),/机型/);
   await page.evaluate(()=>PenNativeShell.go('devices'));await page.locator('#deviceUseModel').click();
   assert.deepEqual(await page.evaluate(()=>{const m=PenStudio.getSettings().machine;return[m.model,m.w,m.h];}),[model,256,256]);
   await page.locator('#stepCalibration').click();assert.equal(await page.locator('#calHome').isDisabled(),false);
   await page.evaluate(()=>{PenNativeShell.go('design');document.querySelector('#fasterSpeed').click();});
   assert.equal(await page.evaluate(()=>PenMachineUI.getProfile().liftSpeed),model==='p1s'?20:25);
   assert.equal(await page.locator('#mc_downZ').getAttribute('max'),String(Models.get(model).z));assert.equal(await page.locator('#mc_upZ').getAttribute('max'),String(Models.get(model).z));assert.equal(await page.locator('#mc_liftSpeed').getAttribute('max'),String(Models.get(model).lift));
   await page.evaluate(()=>document.querySelector('#extremeSpeedPreset').click());assert.equal(await page.evaluate(()=>PenMachineUI.getProfile().liftSpeed),model==='p1s'?20:30);
   await page.evaluate(()=>{PenNativeShell.go('devices');PenI18n.setLanguage('en');});await page.waitForTimeout(100);
   assert.match(await page.locator('#deviceModelInfo').textContent(),/not.*hardware/i);
   await page.screenshot({path:path.join(__dirname,'..','test-output',model+'-connection.png')});
   assert.deepEqual(p.commands,[]);assert.deepEqual(errors,[]);console.log('PASS '+model+' actual UI: required model selection, pairing, canvas match, calibration enabled, speed caps and bilingual notice');
  }finally{await context.close();await b.close();}
 }
 for(const model of ['a1','a1-mini','p1s']){
  const p=new Fake(model);p.version=null;let saved,calls=0;
  const b=createBridge({printerFactory:()=>{calls++;return p;},onCredentials:v=>{saved=v;}});await b.listen(0);const page=await browser.newPage();
  try{
   await page.goto(b.origin);await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');await page.evaluate(()=>PenNativeShell.go('devices'));await page.locator('#deviceAdd').click();
   await page.locator('#lanIP').fill('192.168.240.10');await page.locator('#lanSerial').fill('TESTMODEL0001');await page.locator('#lanCode').fill('12345678');await page.locator('#devicePair').click();
   assert.equal(await page.locator('#deviceModel').evaluate(n=>n.validity.valueMissing),true);assert.equal(calls,0);assert.equal(await page.locator('#deviceModelDialog').evaluate(n=>n.open),false);
   assert.equal(await page.locator('#lanCode').inputValue(),'12345678');assert.equal(await page.locator('#lanSerial').inputValue(),'TESTMODEL0001');
   await page.evaluate(()=>PenI18n.setLanguage('en'));await page.waitForFunction(()=>document.querySelector('#deviceModel option[value=""]').textContent==='Choose your printer model');
   await page.locator('#deviceModel').selectOption(model);await page.screenshot({path:path.join(__dirname,'..','test-output',model+'-model-picker.png')});await page.locator('#devicePair').click();await page.waitForFunction(()=>document.querySelector('#deviceState').dataset.connected==='true');
   assert.equal(saved.model,model);assert.equal(saved.accessCode,'12345678');assert.deepEqual(p.commands,[]);
   await b.disconnect();await b.connect(saved);assert.equal(b.snapshot().device.model,model);assert.deepEqual(p.commands,[]);
   await page.locator('#deviceEdit').click();assert.equal(await page.locator('#deviceModel').inputValue(),model);
   console.log('PASS '+model+' no firmware identity: selection required before network I/O, bilingual, one-click connect, saved model reconnect/edit, no motion');
  }finally{await page.close();await b.close();}
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

