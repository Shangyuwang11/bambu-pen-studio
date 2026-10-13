'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createBridge}=require('../bridge/server.cjs'),{chromium}=require(process.env.A1_PEN_PLAYWRIGHT||'playwright');
(async()=>{
 const bridge=createBridge({printerFactory:()=>{throw Error('UI audit must not connect to a printer');}});await bridge.listen(0);
 const browser=await chromium.launch({headless:true,...(process.env.A1_PEN_BROWSER?{executablePath:process.env.A1_PEN_BROWSER}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:940}}),errors=[];page.setDefaultTimeout(10000);
 const output=path.join(__dirname,'../test-output');fs.mkdirSync(output,{recursive:true});
 try{
  page.on('pageerror',e=>errors.push(e.message));await page.goto(bridge.origin);await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');
  await page.evaluate(()=>PenNativeShell.go('design'));await page.locator('#newProject').click();await page.locator('#addText').click();
  await page.locator('#layers .layer').first().click({button:'right'});await page.locator('#objectContextMenu [data-action=edit]').click();
  await page.locator('#textContent').fill('Hello 世界');await page.locator('#closeObjectEditor').click();assert.equal(await page.evaluate(()=>PenStudio.getState().objects[0].text),'Hello 世界');
  await page.locator('#layers .layer').first().click({button:'right'});await page.locator('#objectContextMenu [data-action=copy]').click();assert.equal(await page.locator('#layers .layer').count(),2);
  await page.locator('#layers .layer').last().click({button:'right'});await page.locator('#objectContextMenu [data-action=delete]').click();assert.equal(await page.locator('#layers .layer').count(),1);
  await page.locator('#undo').click();assert.equal(await page.locator('#layers .layer').count(),2);await page.locator('#redo').click();assert.equal(await page.locator('#layers .layer').count(),1);
  console.log('PASS actual UI: text editing, right-click copy/delete, undo and redo');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,64,64);g.fillStyle='black';g.fillRect(12,12,40,40);g.fillStyle='#aaa';g.fillRect(24,24,16,16);return c.toDataURL().split(',')[1];});
  await page.locator('#imageFile').setInputFiles({name:'test-drawing.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>PenImageTrace.getResult());
  await page.locator('#convertDetail').fill('64');await page.locator('#convertWidth').fill('30');
  for(const mode of ['skeleton','outline','sketch','hatch','crosshatch','scan-hatch','wave']){
   await page.locator('#convertMode').selectOption(mode);await page.waitForFunction(mode=>PenImageTrace.getResult()?.mode===mode,mode);
   const r=await page.evaluate(()=>PenImageTrace.getResult());assert(r.paths.length>0,mode);assert.equal(r.strokeWidth,await page.evaluate(()=>PenStudio.getSettings().pen.width));
  }
  await page.locator('#convertMode').selectOption('natural');await page.locator('#naturalDetail').fill('64');await page.locator('#naturalStrokeLimit').fill('20');
  await page.waitForFunction(()=>{const r=PenImageTrace.getResult();return r?.mode==='natural'&&r.brush.strokeLimit===20;});assert((await page.evaluate(()=>PenImageTrace.getResult().paths.length))<=20);
  await page.locator('#convertMode').selectOption('outline');await page.waitForFunction(()=>PenImageTrace.getResult()?.mode==='outline');
  await page.locator('#traceErase').click();const canvas=page.locator('#traceEditor canvas'),rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+rect.width*.25,rect.y+rect.height*.5);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.75,rect.y+rect.height*.5,{steps:6});await page.mouse.up();
  assert.equal(await page.locator('#traceUndo').isDisabled(),false);await page.locator('#traceUndo').click();assert.equal(await page.locator('#traceRedo').isDisabled(),false);await page.locator('#traceRedo').click();await page.waitForFunction(()=>PenImageTrace.getResult());
  await page.locator('#traceApply').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));
  const original=await page.evaluate(()=>PenStudio.getState().objects.find(o=>o.type==='image'));assert(original.originalSource);assert(original.paths.length>0);
  await page.locator('#layers .layer').last().dblclick();await page.locator('#rotation').fill('45');await page.locator('#rotation').press('Tab');await page.locator('#objX').fill('-4');await page.locator('#objX').press('Tab');await page.locator('#closeObjectEditor').click();
  const changed=await page.evaluate(()=>PenStudio.getState().objects.find(o=>o.type==='image'));assert.deepEqual(changed.paths,original.paths);assert.equal(changed.rotation,45);assert.equal(changed.x,-4);
  assert.equal(await page.evaluate(()=>PenCore.traceStale(PenStudio.getState().objects.find(o=>o.type==='image'))),false);
  const download=page.waitForEvent('download');await page.locator('#exportSvg').click();const svg=fs.readFileSync(await(await download).path(),'utf8');assert(svg.includes('<svg'));assert(svg.includes('stroke-width="'+original.strokeWidth+'"'));
  console.log('PASS actual UI: all raster modes, 20-stroke sketch, erase/undo/redo, image placement without retracing, SVG export');
  await page.evaluate(()=>PenProfilesUI.saveReference({...PenMachineUI.getProfile(),name:'Test calibration',downZ:18,upZ:20,confirmed:true}));
  await page.locator('#presetName').fill('Test calibration');await page.locator('#penDialogConfirm').click();await page.waitForFunction(()=>!document.querySelector('#penProfileDialog').open);
  await page.evaluate(()=>PenProfilesUI.saveWidth(.7));assert.equal(await page.evaluate(()=>PenProfilesUI.selected().penSettings.width),.7);
  await page.evaluate(()=>{document.querySelector('#penLibraryFold').open=true;});
  await page.locator('#presetRename').click();await page.locator('#presetName').fill('Renamed calibration');await page.locator('#penDialogConfirm').click();await page.waitForFunction(()=>!document.querySelector('#penProfileDialog').open);
  assert.equal(await page.evaluate(()=>PenProfilesUI.selected().name),'Renamed calibration');
  await page.evaluate(()=>{window.PenDesktop={flush:async()=>{throw Error('TEST_SAVE_FAILED');}};});
  await page.locator('#presetRename').click();await page.locator('#presetName').fill('Must not persist');await page.locator('#penDialogConfirm').click();await page.waitForFunction(()=>document.querySelector('#penDialogError').textContent.includes('TEST_SAVE_FAILED'));
  assert.equal(await page.evaluate(()=>PenProfilesUI.selected().name),'Renamed calibration');assert.equal(await page.evaluate(()=>PenMachineUI.getProfile().name),'Renamed calibration');
  await page.evaluate(()=>{delete window.PenDesktop;});await page.locator('#penDialogClose').click();
  await page.evaluate(()=>PenStudio.ensureImagePaths());const artwork=await page.evaluate(()=>PenStudio.getState().objects);
  await page.locator('#stepAlignment').click();await page.locator('#alignmentCellNumbers').check();await page.locator('#alignmentGenerate').click();await page.waitForFunction(()=>document.body.dataset.page==='design');
  assert(await page.evaluate(()=>!!PenStudio.getState().alignmentReturn));await page.locator('#stepAlignment').click();await page.locator('#alignmentRestore').click();assert.deepEqual(await page.evaluate(()=>PenStudio.getState().objects),artwork);
  await page.waitForFunction(()=>JSON.stringify(JSON.parse(localStorage.getItem('a1-pen-studio-v1')).objects)===JSON.stringify(PenStudio.getState().objects));
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');assert.equal(await page.evaluate(()=>PenProfilesUI.selected().name),'Renamed calibration');assert.equal(await page.evaluate(()=>PenProfilesUI.selected().penSettings.width),.7);assert.equal(await page.evaluate(()=>PenMachineUI.getProfile().downZ),18);assert.deepEqual(await page.evaluate(()=>PenStudio.getState().objects),artwork);
  assert.deepEqual(errors,[]);assert.equal(bridge.snapshot().printer,null);await page.screenshot({path:path.join(output,'workspace-workflows.png')});
  console.log('PASS actual UI: calibration save/rename/width, failed-save rollback, numbered alignment generation/restore, reload persistence; no printer access');
 }finally{await browser.close();await bridge.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
