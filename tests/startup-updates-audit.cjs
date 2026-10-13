'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require(process.env.A1_PEN_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'pen-startup-update-'));
let app,page;const errors=[];
async function launch(){
 const env={...process.env,A1_PEN_TEST_DATA:data,A1_PEN_TEST_HIDE:'1',A1_PEN_PORT:'0'};
 for(const key of ['ELECTRON_RUN_AS_NODE','A1_PEN_PREVIEW','A1_PEN_ACCESS_CODE','A1_PEN_IP','A1_PEN_SERIAL'])delete env[key];
 app=await _electron.launch({executablePath:process.env.A1_PEN_ELECTRON,args:[root],env,timeout:30000});
 await app.evaluate(()=>{
  global.updateRequests=[];global.testReleaseVersion='0.23.0';global.offlineUpdate=false;
  global.fetch=async url=>{
   updateRequests.push(String(url));if(offlineUpdate)throw Error('Test offline');
   if(!String(url).endsWith('/releases/latest'))throw Error('Automatic checks must not download files');
   const version=testReleaseVersion,name='Bambu-Pen-Studio-'+version+'-win-x64.exe';
   return Response.json({tag_name:'v'+version,body:'Update test',assets:[{name,size:5,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/Shangyuwang11/bambu-pen-studio/releases/download/v'+version+'/'+name}]});
  };
 });
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');
}
(async()=>{try{
 await launch();await page.waitForFunction(()=>!document.getElementById('updateNotice').hidden,{},{timeout:12000});assert.match(await page.locator('#updateNoticeTitle').textContent(),/0\.23\.0/);assert.equal(await app.evaluate(()=>updateRequests.length),1);assert.equal(await page.locator('#settingsDialog').evaluate(n=>n.open),false);
 await page.locator('#updateNoticeLater').click();await page.waitForTimeout(2300);assert.equal(await page.locator('#updateNotice').isVisible(),false);
 await app.evaluate(()=>{testReleaseVersion='0.24.0';});await page.evaluate(()=>PenDesktopAPI.checkUpdates());await page.waitForFunction(()=>!document.getElementById('updateNotice').hidden);
 await page.evaluate(()=>PenI18n.setLanguage('en'));await page.waitForFunction(()=>document.getElementById('updateNoticeOpen').textContent==='View update');await page.screenshot({path:path.join(root,'test-output','startup-update-notice.png')});await page.locator('#updateNoticeOpen').click();await page.waitForFunction(()=>document.getElementById('settingsDialog').open);assert.equal(await page.locator('#updatesDownload').isVisible(),true);
 await page.locator('#updatesAuto').uncheck();await page.waitForFunction(()=>!document.getElementById('updatesAuto').disabled);assert.equal(JSON.parse(fs.readFileSync(path.join(data,'update-preferences.json'))).autoCheck,false);
 await app.close();app=null;await launch();await page.waitForTimeout(4200);assert.equal(await app.evaluate(()=>updateRequests.length),0);assert.equal(await page.locator('#updateNotice').isVisible(),false);
 await page.evaluate(()=>PenDesktopAPI.setUpdateAuto(true));await app.close();app=null;await launch();await page.waitForFunction(()=>!document.getElementById('updateNotice').hidden,{},{timeout:12000});assert.match(await page.locator('#updateNoticeTitle').textContent(),/0\.23\.0/);
 await app.evaluate(()=>{offlineUpdate=true;});await page.evaluate(()=>PenDesktopAPI.checkUpdates());await page.waitForFunction(()=>document.getElementById('updateNotice').hidden);assert.equal(await page.locator('#settingsDialog').evaluate(n=>n.open),false);assert.deepEqual(errors,[]);
 console.log('PASS actual Electron startup: automatic check, visible notice, per-session dismissal, new release notice, bilingual, Settings link, persisted opt-out, next-launch check, offline quiet, no automatic downloads');
}finally{await app?.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
