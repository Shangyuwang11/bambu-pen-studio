'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.A1_PEN_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,file=process.env.A1_PEN_PACKAGE;
if(!file)throw Error('Set A1_PEN_PACKAGE to the portable EXE');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'pen-packaged-launch-')),readyFile=path.join(data,'ready.json');
let browser,ready;const errors=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function launch(){
 fs.rmSync(readyFile,{force:true});
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const env={...process.env,A1_PEN_TEST_DATA:data,A1_PEN_PREVIEW:'1',A1_PEN_TEST_HIDE:'1',A1_PEN_PORT:'0',A1_PEN_TEST_READY:readyFile};
 for(const key of ['ELECTRON_RUN_AS_NODE','A1_PEN_IP','A1_PEN_SERIAL','A1_PEN_ACCESS_CODE'])delete env[key];
 spawn(file,['--remote-debugging-port='+port],{env,stdio:'ignore',windowsHide:true}).unref();
 for(let i=0;i<300&&!fs.existsSync(readyFile);i++)await pause(200);
 assert(fs.existsSync(readyFile),'Packaged app did not start');ready=JSON.parse(fs.readFileSync(readyFile));assert.equal(ready.version,version);assert.equal(ready.userData,data);assert(ready.sandbox);
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);const page=browser.contexts()[0].pages()[0];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');return page;
}
async function close(page){
 await page.evaluate(()=>setTimeout(()=>window.close(),0));
 for(let i=0;i<100&&alive(ready.pid);i++)await pause(100);
 assert(!alive(ready.pid),'Packaged app did not exit after native close');await browser.close().catch(()=>{});browser=null;ready=null;
}
(async()=>{try{
 let page=await launch();const meta=await page.evaluate(()=>PenDesktopAPI.meta());assert.equal(meta.version,version);assert.equal(meta.paired,false);assert(meta.preview);
 await page.evaluate(()=>{const s=PenStudio.getState();s.objects=[PenCore.newText('Packaged restart test')];PenStudio.replaceProject(s);});
 await page.evaluate(()=>PenDesktop.flush());await page.evaluate(()=>PenSettings.open());
 assert.match(await page.locator('#settingsVersion').textContent(),new RegExp(version.replaceAll('.','\\.')));
 await page.evaluate(()=>PenI18n.setLanguage('en'));await page.waitForFunction(()=>document.documentElement.lang==='en');
 const status=await page.evaluate(()=>PenDesktopAPI.updateStatus());assert.equal(status.currentVersion,version);assert(status.canInstall);
 await close(page);assert(fs.existsSync(path.join(data,'workspace.json')));
 page=await launch();assert.equal(await page.evaluate(()=>PenStudio.getState().objects[0].text),'Packaged restart test');assert.equal(await page.evaluate(()=>document.documentElement.lang),'en');
 const snapshot=await page.evaluate(()=>fetch('/api/status').then(r=>r.json()));assert.equal(snapshot.printer,null);
 await page.screenshot({path:path.join(root,'test-output','packaged-'+version+'-launch.png')});await close(page);assert.deepEqual(errors,[]);
 console.log('PASS portable '+version+': payload extraction, isolated profile, version, settings, IPC save, language, normal close, restart persistence, no printer access');
 }finally{await browser?.close().catch(()=>{});if(ready&&alive(ready.pid))process.kill(ready.pid);}
})().catch(e=>{console.error(e);process.exitCode=1;});
