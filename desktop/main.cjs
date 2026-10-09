'use strict';
const {app,BrowserWindow,ipcMain,dialog,Menu,screen,safeStorage,powerSaveBlocker,powerMonitor,clipboard,shell,nativeTheme}=require('electron');
const {createUpdater,busyForUpdate,backupData,RELEASES}=require('./updates.cjs');
const fs=require('node:fs'),path=require('node:path');
const {createBridge}=require('../bridge/server.cjs'),C=require('../core.js'),M=require('../machine.js');
const {createAutoConnect}=require('./autoconnect.cjs');
const {createConnectionControls}=require('./connection-controls.cjs');
const {startConnectionLifecycle}=require('./connection-lifecycle.cjs');
const {createPairStore}=require('./pair-store.cjs');
app.setName('Bambu Pen');app.setAppUserModelId('local.a1pen.studio');
const profileDirectory=require('./profile-directory.cjs').chooseProfileDirectory({home:app.getPath('home'),appData:app.getPath('appData'),testDirectory:process.env.A1_PEN_TEST_DATA});
app.setPath('userData',profileDirectory.directory);
const preview=!!process.env.A1_PEN_TEST_DATA&&process.env.A1_PEN_PREVIEW==='1';
let uiPresented=false,win,bridge,autoConnect,connectionControls,connectionLifecycle,quitting=false,closing=false,powerId=null,powerTimer=null,connectError='',initialData=null;
let preferences;let uiLanguage='zh-CN',updater,updateTimer,updateStartTimer;
function updateState(){const target=process.env.A1_PEN_LAUNCHER_PATH;return {...updater.snapshot(),dataDirectory:app.getPath('userData'),canInstall:process.platform==='win32'&&!!target&&path.isAbsolute(target)&&path.extname(target).toLowerCase()==='.exe'&&fs.existsSync(target)};}
async function installUpdate(){
 if(closing||quitting||busyForUpdate(bridge.snapshot()))throw Error(nt('绘画或校准结束后才能更新。'));
 if(!updateState().canInstall)throw Error(nt('请从下载的 EXE 启动软件后再更新。'));
 let helper;closing=true;autoConnect.pause();
 try{
  if(autoConnect.status().connecting)await autoConnect.connect();
  if(busyForUpdate(bridge.snapshot()))throw Error(nt('绘画或校准结束后才能更新。'));
  const item=await updater.verifiedFile();
  await win.webContents.executeJavaScript('window.PenDesktop.flush()');
  // Checking and downloading do not alter data. Installation always saves and
  // snapshots the durable profile before replacing only the portable launcher.
  backupData(app.getPath('userData'),item.version);
  if(busyForUpdate(bridge.snapshot()))throw Error(nt('绘画或校准结束后才能更新。'));
  const job=path.join(app.getPath('userData'),'updates','install-job.json');
  atomic(job,{pid:process.pid,target:path.resolve(process.env.A1_PEN_LAUNCHER_PATH),source:item.file,sha256:item.sha256,version:item.version,result:path.join(app.getPath('userData'),'updates','install-result.json')});
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  helper=require('node:child_process').spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'update-helper.ps1'),'-Manifest',job],{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{helper.once('spawn',resolve);helper.once('error',reject);});
  await bridge.close();connectionLifecycle.stop();releasePower();helper.unref();finishQuit();return updateState();
 }catch(e){helper?.kill();closing=false;autoConnect.resume();throw e;}
}
const uiLabels={'文件':'File','保存作品':'Save project','退出':'Quit','编辑':'Edit','撤销':'Undo','重做':'Redo','剪切':'Cut','复制':'Copy','粘贴':'Paste','显示':'View','恢复大小':'Actual size','放大':'Zoom in','缩小':'Zoom out','全屏':'Full screen','帮助':'Help','换笔与桌面版使用说明':'Getting started','拓竹写字机':'Bambu Pen','外部资料链接':'External reference','复制链接':'Copy link','关闭':'Close','保存作品或导出文件':'Save project or export','当前仍在执行机器动作':'The printer is still moving','继续运行':'Keep running','停止后退出':'Stop and quit','正在上传或启动完整文件，请等启动确认后再关闭。':'Uploading or starting a file. Wait for startup confirmation before closing.','机器动作尚未结束，窗口保持打开，请查看状态。':'Motion has not finished. The window will remain open. Check printer status.','绘图会等待已发送指令确认完成，再抬笔返回待机位置；校准会在当前已发送动作结束后停住，请现场观察笔尖。':'Drawing waits for sent commands, then lifts the pen and returns to standby. Calibration stops after the current movement. Watch the pen at the printer.','未能完成关闭':'Could not close','Bambu Pen 启动失败':'Could not start Bambu Pen'};
const nt=s=>uiLanguage==='en'?(uiLabels[s]||s):s;
Object.assign(uiLabels,{'绘画或校准结束后才能更新。':'Finish drawing or calibration before updating.','请从下载的 EXE 启动软件后再更新。':'Start the downloaded EXE to enable in-app installation.'});
const connectionEvents=[],motionEvents=[];
function motionEvent(value){motionEvents.push(value);if(motionEvents.length>40)motionEvents.shift();try{atomic(path.join(app.getPath('userData'),'motion-log.json'),motionEvents);}catch{}}
function connectionEvent(value){connectionEvents.push(value);if(connectionEvents.length>80)connectionEvents.shift();try{atomic(path.join(app.getPath('userData'),'connection-log.json'),connectionEvents);}catch{}}
const pairStore=createPairStore({directory:app.getPath('userData'),bundledFile:path.join(__dirname,'bundled-printer.dpapi'),safeStorage,allowBundled:false,onEvent:connectionEvent});
const one=app.requestSingleInstanceLock();if(!one){app.quit();}else{
 app.on('second-instance',()=>{if(uiPresented&&win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
 app.on('before-quit',event=>{if(!quitting){event.preventDefault();closeApp();}});
 app.on('window-all-closed',()=>{if(!quitting)closeApp();});
 app.whenReady().then(start).catch(async e=>{autoConnect?.pause();connectionLifecycle?.stop();try{await bridge?.close();}catch{}releasePower();dialog.showErrorBox(nt('Bambu Pen 启动失败'),e.message);finishQuit(1);});
}
function releasePower(){if(powerTimer){clearInterval(powerTimer);powerTimer=null;}if(powerId!==null){powerSaveBlocker.stop(powerId);powerId=null;}}
function finishQuit(code=0){quitting=true;app.releaseSingleInstanceLock();const fallback=setTimeout(()=>app.exit(code),2000);fallback.unref();app.quit();}
function showCloseMessage(options){return win&&!win.isDestroyed()?dialog.showMessageBox(win,options):dialog.showMessageBox(options);}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);}
function workFile(){return path.join(app.getPath('userData'),'workspace.json');}
function pairFile(){return path.join(app.getPath('userData'),'printer.enc.json');}
function validateWork(v){if(!v||Buffer.byteLength(JSON.stringify(v))>32*1024*1024)throw Error('作品备份过大或无效');return {backings:require('../backing.js').library(v.backings),activePreset:typeof v.activePreset==='string'?v.activePreset:'',penLibraryVersion:v.penLibraryVersion===2?2:1,state:C.validateProject(v.state),profile:M.validateProfile(v.profile),library:(Array.isArray(v.library)?v.library:[]).slice(0,100).map(M.validateProfile),presets:(Array.isArray(v.presets)?v.presets:[]).slice(0,40).map(require('../position-presets.js').validate)};}
function trusted(event){if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||new URL(event.senderFrame.url).origin!==bridge.origin)throw Error('页面来源无效');}
function savePair(v){return pairStore.save(v);}
function loadPair(){return pairStore.load();}
function publicPair(){return pairStore.publicPair();}
async function start(){
 fs.mkdirSync(app.getPath('userData'),{recursive:true});
 updater=createUpdater({version:app.getVersion(),directory:app.getPath('userData')});
 preferences=require('./ui-preferences.cjs').createPreferences(app.getPath('userData'),preview||app.getLocale().startsWith('zh')?'zh-CN':'en');uiLanguage=preferences.get().language;nativeTheme.themeSource=preferences.get().theme;
 try{const log=path.join(app.getPath('userData'),'connection-log.json');if(fs.statSync(log).size<65536){const old=JSON.parse(fs.readFileSync(log,'utf8'));if(Array.isArray(old))for(const item of old.slice(-60)){if(/^[a-z-]+$/.test(item.event)&&Number.isFinite(item.at))connectionEvents.push({event:item.event,at:item.at,...(Number.isInteger(item.attempts)?{attempts:item.attempts}:{})});}}}catch{}
 connectionEvent({event:'app-start',at:Date.now(),version:app.getVersion()});
 const importArg=process.argv.find(x=>x.startsWith('--import-session='));
 if(importArg){const file=path.resolve(importArg.slice(17));if(fs.statSync(file).size>32*1024*1024)throw Error('导入的作品过大');initialData=validateWork(JSON.parse(fs.readFileSync(file,'utf8')));atomic(workFile(),initialData);}
 else if(fs.existsSync(workFile())){try{initialData=validateWork(JSON.parse(fs.readFileSync(workFile(),'utf8')));}catch(e){const backup=workFile()+'.unreadable-'+Date.now()+'.json';fs.copyFileSync(workFile(),backup);dialog.showErrorBox(nt('作品恢复未完成'),'原备份已另存至 '+backup+'。请使用保存的作品文件导入。'+e.message);}}
 bridge=createBridge({loadPositionReceipt:()=>{try{return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'position-receipt.json'),'utf8'));}catch{return null;}},savePositionReceipt:v=>atomic(path.join(app.getPath('userData'),'position-receipt.json'),v),...(preview?{printerFactory:()=>{throw Error('独立界面预览不会连接打印机，请绘画结束后打开正式应用');}}:{}),onPositionInvalidated:v=>connectionEvent({event:'position-invalidated',...v}),loadFileJob:()=>{try{return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'file-job.json'),'utf8'));}catch{return null;}},saveFileJob:v=>atomic(path.join(app.getPath('userData'),'file-job.json'),v),onMotionDiagnostic:motionEvent,onCredentials:savePair,caPath:path.join(__dirname,'printer.cer')});
 autoConnect=createAutoConnect({bridge,loadPair,onEvent:connectionEvent});
 connectionControls=createConnectionControls({bridge,autoConnect,load:()=>{try{return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'connection-preferences.json'),'utf8'));}catch{return null;}},save:v=>atomic(path.join(app.getPath('userData'),'connection-preferences.json'),v)});
 try{await bridge.listen(Number(process.env.A1_PEN_PORT||8765));}catch(e){if(e.code==='EADDRINUSE')throw Error('本地连接端口已被占用。请先结束旧联网版的绘图并关闭它的连接服务，再打开桌面版。');throw e;}
 ipcMain.on('pen:bootstrap',event=>{try{trusted(event);event.returnValue={...initialData,language:uiLanguage,preferences:preferences.get(),dark:nativeTheme.shouldUseDarkColors,version:app.getVersion()};}catch{event.returnValue=null;}});
 ipcMain.handle('pen:language',(event,value)=>{trusted(event);if(!['zh-CN','en'].includes(value))throw Error('Invalid language');uiLanguage=value;preferences.patch({language:value});installMenu();win.setTitle('Bambu Pen');return value;});
 ipcMain.handle('pen:preferences',(event,value)=>{trusted(event);const next=preferences.patch(value);nativeTheme.themeSource=next.theme;applyWindowTheme();return next;});
 ipcMain.handle('pen:save',(event,value)=>{trusted(event);const data=validateWork(value);atomic(workFile(),data);initialData=data;return {saved:true};});
 ipcMain.handle('pen:update-status',event=>{trusted(event);return updateState();});
 ipcMain.handle('pen:update-check',async event=>{trusted(event);await updater.check();return updateState();});
 ipcMain.handle('pen:update-download',async event=>{trusted(event);await updater.download();return updateState();});
 ipcMain.handle('pen:update-auto',(event,value)=>{trusted(event);updater.setAutoCheck(value);return updateState();});
 ipcMain.handle('pen:update-install',event=>{trusted(event);return installUpdate();});
 ipcMain.handle('pen:update-file',async event=>{trusted(event);shell.showItemInFolder((await updater.verifiedFile()).file);});
 ipcMain.handle('pen:open-releases',event=>{trusted(event);return shell.openExternal(RELEASES);});
 ipcMain.handle('pen:open-data',async event=>{trusted(event);await win.webContents.executeJavaScript('window.PenDesktop.flush()');const error=await shell.openPath(app.getPath('userData'));if(error)throw Error(error);});
 ipcMain.handle('pen:meta',event=>{trusted(event);return {preview,paired:fs.existsSync(pairFile()),bundledPairAvailable:pairStore.hasBundled(),printer:publicPair(),autoConnect:autoConnect.status(),connectionEvents:connectionEvents.slice(),connectError:autoConnect.status().error||connectError,version:app.getVersion(),dataDirectory:app.getPath('userData')};});
 ipcMain.handle('pen:network-online',event=>{trusted(event);if(closing||quitting)return;return connectionLifecycle.wake();});
 ipcMain.handle('pen:reconnect',event=>{trusted(event);return connectionControls.reconnect();});
 ipcMain.handle('pen:pair',(event,value)=>{trusted(event);return connectionControls.pair(value);});
 ipcMain.handle('pen:disconnect',event=>{trusted(event);return connectionControls.disconnect();});
 ipcMain.handle('pen:auto-connect',(event,enabled)=>{trusted(event);return connectionControls.setAuto(enabled);});
 ipcMain.handle('pen:forget',async event=>{trusted(event);if(bridge.snapshot().busy||autoConnect.status().connecting)throw Error('请等待当前连接或绘图结束');await connectionControls.disconnect();pairStore.forget();return {forgotten:true};});
 try{if(process.env.A1_PEN_ACCESS_CODE){const pair={ip:process.env.A1_PEN_IP,serial:process.env.A1_PEN_SERIAL,accessCode:process.env.A1_PEN_ACCESS_CODE};delete process.env.A1_PEN_ACCESS_CODE;savePair(pair);}}catch(e){connectError=e.message;}
 connectionLifecycle=startConnectionLifecycle({autoConnect,bridge,powerMonitor,onEvent:connectionEvent,canRun:()=>!closing&&!quitting});
 const size=screen.getPrimaryDisplay().workAreaSize;
 win=new BrowserWindow({title:'Bambu Pen',width:Math.min(1420,size.width),height:Math.min(940,size.height),minWidth:900,minHeight:640,show:false,autoHideMenuBar:true,titleBarStyle:'hidden',titleBarOverlay:{color:'#f4f5f2',symbolColor:'#283b35',height:42},backgroundColor:'#f4f5f2',icon:path.join(__dirname,'icon.ico'),webPreferences:{backgroundThrottling:!(process.env.A1_PEN_TEST_DATA&&process.env.A1_PEN_TEST_HIDE==='1'),preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false,webSecurity:true}});
 win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
 win.webContents.on('will-navigate',(e,url)=>{if(new URL(url).origin!==bridge.origin)e.preventDefault();});
 win.webContents.setWindowOpenHandler(({url})=>{if(new URL(url).origin===bridge.origin)return {action:'allow',overrideBrowserWindowOptions:{width:1000,height:800,autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}};dialog.showMessageBox(win,{type:'info',message:nt('外部资料链接'),detail:url,buttons:[nt('复制链接'),nt('关闭')]}).then(r=>{if(r.response===0)clipboard.writeText(url);});return {action:'deny'};});
 win.webContents.on('did-create-window',child=>{child.webContents.on('will-navigate',(e,url)=>{if(new URL(url).origin!==bridge.origin)e.preventDefault();});child.webContents.setWindowOpenHandler(()=>({action:'deny'}));});
 win.webContents.session.on('will-download',(_event,item)=>{item.setSaveDialogOptions({title:nt('保存作品或导出文件'),defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});});
 installMenu();applyWindowTheme();nativeTheme.on('updated',applyWindowTheme);
 // A first paint can still contain the legacy markup. Presentation waits
 // for the final workspace layout, not Electron's ready-to-show event.
 win.webContents.on('did-finish-load',()=>{if(preview)win.setTitle('Bambu Pen '+app.getVersion()+' · Preview');connectionEvent({event:'ui-loaded',at:Date.now()});});
 win.webContents.on('did-fail-load',(_e,code,_description,_url,isMainFrame)=>{if(isMainFrame)connectionEvent({event:'ui-load-error',at:Date.now(),code});});
 win.on('close',event=>{if(quitting)return;event.preventDefault();closeApp();});
 await win.loadURL(bridge.origin);
 const uiState=await win.webContents.executeJavaScript('window.PenUIBoot?.settled || Promise.resolve("missing")');
 if(uiState==='missing')throw Error('启动界面文件未能载入，请重新打开软件。已有配置保留。');
 uiPresented=true;connectionEvent({event:uiState==='ready'?'ui-ready':'ui-startup-error',at:Date.now()});
 const checkAutomatically=()=>{if(!preview&&!closing&&!quitting&&updater.snapshot().autoCheck)updater.check().catch(()=>{});};
 updateStartTimer=setTimeout(checkAutomatically,15000);updateStartTimer.unref();updateTimer=setInterval(checkAutomatically,6*60*60*1000);updateTimer.unref();
 if(!(process.env.A1_PEN_TEST_DATA&&process.env.A1_PEN_TEST_HIDE==='1')){win.show();win.focus();}
 powerTimer=setInterval(()=>{const busy=bridge.snapshot().localBusy;if(busy&&powerId===null)powerId=powerSaveBlocker.start('prevent-app-suspension');if(!busy&&powerId!==null){powerSaveBlocker.stop(powerId);powerId=null;}},1000);powerTimer.unref();
 if(process.env.A1_PEN_TEST_READY)fs.writeFileSync(process.env.A1_PEN_TEST_READY,JSON.stringify({pid:process.pid,origin:bridge.origin,version:app.getVersion(),sandbox:win.webContents.getLastWebPreferences().sandbox,userData:app.getPath('userData')}));
}
async function closeApp(){if(closing||quitting)return;closing=true;autoConnect?.pause();try{
 if(autoConnect?.status().connecting)await autoConnect.connect().catch(()=>{});
 if(bridge?.snapshot().localBusy&&bridge.snapshot().fileTask){await showCloseMessage({message:nt('正在上传或启动完整文件，请等启动确认后再关闭。')});return;}
 if(bridge?.snapshot().busy&&!bridge.snapshot().autonomous){const choice=await showCloseMessage({type:'question',message:nt('当前仍在执行机器动作'),detail:nt('绘图会等待已发送指令确认完成，再抬笔返回待机位置；校准会在当前已发送动作结束后停住，请现场观察笔尖。'),buttons:[nt('继续运行'),nt('停止后退出')],defaultId:0,cancelId:0});if(choice.response!==1)return;await bridge.action('stop',{});for(let i=0;i<100&&bridge.snapshot().busy;i++)await new Promise(r=>setTimeout(r,500));if(bridge.snapshot().busy){await showCloseMessage({message:nt('机器动作尚未结束，窗口保持打开，请查看状态。')});return;}}
 // window.close() can dispose the renderer while the native close event is
 // being handled. Keep the last atomic backup and release the bridge in that
 // case; a live renderer's real save failure must still keep its window open.
 if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed()){
  try{await win.webContents.executeJavaScript('window.PenDesktop?.flush()');}
  catch(e){if(!win.isDestroyed()&&!win.webContents.isDestroyed())throw e;}
 }
 await bridge?.close();connectionLifecycle?.stop();releasePower();finishQuit();
 }catch(e){dialog.showErrorBox(nt('未能完成关闭'),e.message);}finally{closing=false;if(!quitting)autoConnect?.resume();}}

function applyWindowTheme(){if(!win||win.isDestroyed())return;const dark=nativeTheme.shouldUseDarkColors;win.webContents.send('pen:theme',dark);win.setTitleBarOverlay({color:dark?'#171d20':'#f4f5f2',symbolColor:dark?'#e5eeea':'#283b35',height:42});win.setBackgroundColor(dark?'#171d20':'#f4f5f2');}
function installMenu(){Menu.setApplicationMenu(Menu.buildFromTemplate([{label:nt('文件'),submenu:[{label:uiLanguage==='en'?'Settings':'设置',accelerator:'CmdOrCtrl+,',click:()=>win.webContents.executeJavaScript("window.PenSettings?.open()")},{type:'separator'},{label:nt('保存作品'),accelerator:'CmdOrCtrl+S',click:()=>win.webContents.executeJavaScript("document.getElementById('saveProject').click()")},{type:'separator'},{role:'quit',label:nt('退出')}]},{label:nt('编辑'),submenu:[{role:'undo',label:nt('撤销')},{role:'redo',label:nt('重做')},{type:'separator'},{role:'cut',label:nt('剪切')},{role:'copy',label:nt('复制')},{role:'paste',label:nt('粘贴')}]},{label:nt('显示'),submenu:[{role:'resetZoom',label:nt('恢复大小')},{role:'zoomIn',label:nt('放大')},{role:'zoomOut',label:nt('缩小')},{role:'togglefullscreen',label:nt('全屏')}]},{label:nt('帮助'),submenu:[{label:nt('换笔与桌面版使用说明'),click:()=>win.webContents.executeJavaScript("window.open('DESKTOP-GUIDE.html','_blank')")}]}]));}
