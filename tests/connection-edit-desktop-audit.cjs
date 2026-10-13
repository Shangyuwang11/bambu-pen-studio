'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require(process.env.A1_PEN_PLAYWRIGHT||'playwright');
const root=path.resolve(process.env.A1_PEN_APP_ROOT||path.join(__dirname,'..')),data=fs.mkdtempSync(path.join(os.tmpdir(),'pen-connection-ui-'));
const pair={ip:'192.168.240.10',serial:'TESTMODEL0001',accessCode:'12345678',model:'a1-mini'};
let app,page;const errors=[];
async function openEditor(){await page.evaluate(()=>PenNativeShell.go('devices'));await page.locator('#deviceEdit').click();}
(async()=>{try{
 const env={...process.env,A1_PEN_TEST_DATA:data,A1_PEN_PREVIEW:'1',A1_PEN_TEST_HIDE:'1',A1_PEN_PORT:'0'};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:process.env.A1_PEN_ELECTRON,args:[root],env,timeout:30000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');
 assert.equal(path.resolve(await app.evaluate(({app})=>app.getAppPath())),root);
 const encrypted=await app.evaluate(({safeStorage},code)=>safeStorage.encryptString(code).toString('base64'),pair.accessCode);
 fs.writeFileSync(path.join(data,'printer.enc.json'),JSON.stringify({ip:pair.ip,serial:pair.serial,model:pair.model,encrypted}));
 await page.evaluate(()=>PenNativeShell.refreshMeta());assert.equal(await page.evaluate(()=>PenDesktopAPI.savedAccessCode('OTHERPRINTER1')),'');
 assert(!JSON.stringify(await page.evaluate(()=>PenDesktopAPI.meta())).includes(pair.accessCode));
 await openEditor();await page.waitForFunction(()=>document.querySelector('#lanCode').value.length===8);assert.equal(await page.locator('#lanCode').getAttribute('type'),'password');assert.equal(await page.locator('#deviceModel').inputValue(),pair.model);
 await page.locator('#deviceShowCode').click();assert.equal(await page.locator('#lanCode').getAttribute('type'),'text');assert.equal(await page.locator('#lanCode').inputValue(),pair.accessCode);
 await page.locator('#deviceShowCode').click();await page.locator('#lanCode').fill('');await page.locator('#deviceShowCode').click();await page.waitForFunction(()=>document.querySelector('#lanCode').value.length===8);assert.equal(await page.locator('#lanCode').inputValue(),pair.accessCode);
 await page.locator('#lanCode').fill('');assert.equal(await page.locator('#devicePairForm').evaluate(n=>n.checkValidity()),true);
 await page.locator('#deviceModel').selectOption('a1');await page.locator('#devicePair').click();await page.waitForFunction(()=>!document.querySelector('#devicePair').disabled);
 // The isolated preview refuses the connection at its printer factory. Getting
 // this error proves both browser validation and real saved-code IPC succeeded.
 assert.match(await page.locator('#deviceError').textContent(),/独立界面预览/);assert.equal(await page.locator('#deviceForm').isVisible(),true);
 await page.locator('#deviceCancel').click();assert.equal(await page.locator('#lanCode').inputValue(),'');
 await openEditor();await page.waitForFunction(()=>document.querySelector('#lanCode').value.length===8);
 await page.locator('#lanIP').fill('192.168.240.11');assert.equal(await page.locator('#lanCode').inputValue(),pair.accessCode);
 await page.locator('#lanSerial').fill('OTHERPRINTER1');assert.equal(await page.locator('#lanCode').inputValue(),'');assert.equal(await page.locator('#devicePairForm').evaluate(n=>n.checkValidity()),false);
 await page.waitForTimeout(3200);assert(!/已保存|Saved/.test(await page.locator('#lanCode').getAttribute('placeholder')));
 await page.locator('#deviceCancel').click();await openEditor();await page.waitForFunction(()=>document.querySelector('#lanCode').value.length===8);
 await page.evaluate(()=>PenI18n.setLanguage('en'));await page.waitForFunction(()=>document.querySelector('#deviceFormNote').textContent.includes('Access code saved'));
 await page.locator('#deviceCancel').click();assert.equal(await page.locator('#lanCode').inputValue(),'');
 // Delay the reply to verify typing and closing cannot be overwritten later.
 await app.evaluate(({ipcMain},code)=>{ipcMain.removeHandler('pen:saved-access-code');ipcMain.handle('pen:saved-access-code',async()=>{await new Promise(r=>setTimeout(r,300));return code;});},pair.accessCode);
 await openEditor();await page.locator('#lanCode').fill('87654321');await page.waitForTimeout(450);assert.equal(await page.locator('#lanCode').inputValue(),'87654321');
 await page.locator('#deviceCancel').click();await openEditor();await page.locator('#deviceCancel').click();await page.waitForTimeout(450);assert.equal(await page.locator('#lanCode').inputValue(),'');
 await page.evaluate(()=>{const s=PenStudio.getState();s.objects=[PenCore.newText('Restart artwork')];PenStudio.replaceProject(s);return PenProfilesUI.saveReference({...PenMachineUI.getProfile(),name:'Restart calibration',downZ:18,upZ:20,confirmed:true});});
 await page.locator('#presetName').fill('Restart calibration');await page.locator('#penDialogConfirm').click();await page.waitForFunction(()=>!document.querySelector('#penProfileDialog').open);await page.evaluate(()=>PenDesktop.flush());
 await app.close();app=null;app=await _electron.launch({executablePath:process.env.A1_PEN_ELECTRON,args:[root],env,timeout:30000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');
 assert.equal(await page.evaluate(()=>PenStudio.getState().objects[0].text),'Restart artwork');assert.equal(await page.evaluate(()=>PenProfilesUI.selected().name),'Restart calibration');assert.equal(await page.evaluate(()=>PenMachineUI.getProfile().downZ),18);
 assert.equal((await page.evaluate(()=>PenDesktopAPI.meta())).printer.serial,pair.serial);await openEditor();await page.waitForFunction(()=>document.querySelector('#lanCode').value.length===8);assert.equal(await page.locator('#lanCode').inputValue(),pair.accessCode);assert.equal(await page.locator('#deviceModel').inputValue(),pair.model);
 assert.deepEqual(errors,[]);console.log('PASS actual Electron: encrypted code, edit/reveal/reuse, model edit, identity matching, bilingual hints, async races, artwork/calibration/printer restored after restart; no printer connection');
}finally{await app?.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
