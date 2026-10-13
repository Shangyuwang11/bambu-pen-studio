'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require(process.env.A1_PEN_PLAYWRIGHT||'playwright');
const root=path.resolve(process.env.A1_PEN_APP_ROOT||path.join(__dirname,'..')),data=fs.mkdtempSync(path.join(os.tmpdir(),'pen-close-audit-'));
let app,page;const errors=[];
async function launch(){
 const env={...process.env,A1_PEN_TEST_DATA:data,A1_PEN_TEST_HIDE:'1',A1_PEN_PREVIEW:'1',A1_PEN_PORT:'0'};
 for(const key of ['ELECTRON_RUN_AS_NODE','A1_PEN_IP','A1_PEN_SERIAL','A1_PEN_ACCESS_CODE'])delete env[key];
 app=await _electron.launch({executablePath:process.env.A1_PEN_ELECTRON,args:[root],env,timeout:30000});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');
 await app.evaluate(({dialog})=>{global.closeDialogs=[];global.closeChoice=0;global.closeErrors=[];dialog.showMessageBox=async(...args)=>{closeDialogs.push(args.at(-1));return{response:closeChoice};};dialog.showErrorBox=(...args)=>closeErrors.push(args);});
}
async function until(check,timeout=9000){const start=Date.now();while(!await check()){if(Date.now()-start>timeout)throw Error('Native close did not reach expected state');await new Promise(r=>setTimeout(r,100));}}
(async()=>{try{
 await launch();await page.evaluate(()=>{window.originalFlush=PenDesktop.flush;PenDesktop.flush=()=>new Promise(()=>{});});
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.close();win.close();win.close();});
 await until(()=>app.evaluate(()=>closeDialogs.length===1));assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
 assert.match(await app.evaluate(()=>closeDialogs[0].message),/保存/);assert.equal(await app.evaluate(()=>closeDialogs[0].buttons.length),3);
 console.log('PASS native close: stalled renderer save prompts after 5s, repeated clicks share one close, cancel preserves window');
 await page.evaluate(()=>{PenDesktop.flush=originalFlush;});
 const closed=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>{setTimeout(()=>BrowserWindow.getAllWindows()[0].close(),0);});await closed;app=null;
 assert(fs.existsSync(path.join(data,'workspace.json')),'normal close saves the project');
 console.log('PASS native close can be retried normally and writes the workspace backup');
 await launch();await page.evaluate(()=>{PenDesktop.flush=()=>Promise.reject(Error('TEST_SAVE_FAILED'));});
 await app.evaluate(()=>{closeChoice=2;});
 const discarded=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>{setTimeout(()=>BrowserWindow.getAllWindows()[0].close(),0);});await discarded;app=null;
 assert(fs.existsSync(path.join(data,'workspace.json')));assert.deepEqual(errors,[]);
 console.log('PASS actual Electron: explicit quit after a failed save retains existing backup and releases the window');
 }finally{if(app){await app.evaluate(({app})=>{setTimeout(()=>app.exit(0),0);}).catch(()=>{});}}
})().catch(e=>{console.error(e);process.exitCode=1;});
