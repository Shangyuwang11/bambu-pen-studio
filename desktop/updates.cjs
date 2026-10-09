'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REPO='Shangyuwang11/bambu-pen-studio',RELEASES=`https://github.com/${REPO}/releases`,API=`https://api.github.com/repos/${REPO}/releases/latest`;
function parts(v){const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);if(!m||m.slice(1).some(x=>!Number.isSafeInteger(+x)))throw Error('Invalid release version');return m.slice(1).map(Number);}
function newer(a,b){const x=parts(a),y=parts(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
function releaseInfo(r){if(!r||r.draft||r.prerelease)return null;parts(r.tag_name);const version=r.tag_name.replace(/^v/,''),name=`Bambu-Pen-Studio-${version}-win-x64.exe`,asset=r.assets?.find(a=>a.name===name);if(!asset)throw Error('Release has no Windows x64 application');const expected=`https://github.com/${REPO}/releases/download/${r.tag_name}/${name}`;if(asset.browser_download_url!==expected||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>512*1024*1024)throw Error('Invalid release asset');const digest=/^sha256:([a-f0-9]{64})$/i.exec(asset.digest||'');if(!digest)throw Error('Release is missing its SHA-256 digest');return{version,name,url:expected,size:asset.size,sha256:digest[1].toLowerCase(),notes:String(r.body||'').slice(0,12000)};}
async function response(url,fetchImpl,signal,headers={}){for(let i=0;i<6;i++){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('Unexpected update host');const r=await fetchImpl(url,{headers:{'User-Agent':'Bambu-Pen-Studio-Updater','Accept':'application/vnd.github+json',...headers},redirect:'manual',signal});if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw Error('Invalid update redirect');url=new URL(next,url).href;continue;}return r;}throw Error('Too many update redirects');}
async function hash(file){const h=crypto.createHash('sha256');for await(const data of fs.createReadStream(file))h.update(data);return h.digest('hex');}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,file);}
function createUpdater({version,directory,fetchImpl=global.fetch,now=Date.now}){
 parts(version);const cache=path.join(directory,'updates'),prefs=path.join(directory,'update-preferences.json');let enabled=true,lastChecked=null,working=false,candidate=null;
 try{const v=JSON.parse(fs.readFileSync(prefs,'utf8'));enabled=v.autoCheck!==false;lastChecked=v.lastChecked||null;}catch{}
 let state={phase:'idle',currentVersion:version,autoCheck:enabled,lastChecked,releaseURL:RELEASES};
 const snapshot=()=>({...state,release:candidate?{version:candidate.version,size:candidate.size,notes:candidate.notes}:null});
 function setAutoCheck(value){if(typeof value!=='boolean')throw Error('Invalid update preference');enabled=value;state.autoCheck=value;atomic(prefs,{autoCheck:enabled,lastChecked});return snapshot();}
 async function check(){if(working)return snapshot();working=true;const previous=candidate;state.phase='checking';delete state.error;try{const r=await response(API,fetchImpl,AbortSignal.timeout(25000));if(r.status===404){candidate=null;state.phase='unpublished';}else{if(!r.ok)throw Error(`GitHub HTTP ${r.status}`);const chunks=[];let bytes=0;for await(const chunk of r.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw Error('Release metadata is too large');chunks.push(Buffer.from(chunk));}const info=releaseInfo(JSON.parse(Buffer.concat(chunks).toString('utf8')));if(info&&newer(info.version,version)){candidate=info;state.phase='available';const file=path.join(cache,info.name);if(fs.existsSync(file)&&fs.statSync(file).size===info.size&&await hash(file)===info.sha256)state.phase='downloaded';}else{candidate=null;state.phase='current';}}lastChecked=now();state.lastChecked=lastChecked;atomic(prefs,{autoCheck:enabled,lastChecked});}catch(e){candidate=previous;state.phase='error';state.error=e.message;}finally{working=false;}return snapshot();}
 async function download(){
  if(working)return snapshot();if(!candidate)throw Error('Check for a new version first');working=true;state.phase='downloading';state.progress=0;delete state.error;
  const file=path.join(cache,candidate.name),temp=file+'.part';let integrityFailed=false;
  try{
   fs.mkdirSync(cache,{recursive:true});let size=fs.existsSync(temp)?fs.statSync(temp).size:0;if(size>candidate.size){fs.unlinkSync(temp);size=0;}
   const h=crypto.createHash('sha256');if(size)for await(const data of fs.createReadStream(temp))h.update(data);
   state.progress=Math.floor(size/candidate.size*100);let url=candidate.url,failures=0;
   while(size<candidate.size){
    const begin=size,end=Math.min(candidate.size-1,begin+4*1024*1024-1);let r;
    try{
     r=await response(url,fetchImpl,AbortSignal.timeout(45000),{Accept:'application/octet-stream',Range:`bytes=${begin}-${end}`});
     if(r.status===403&&url!==candidate.url){await r.body?.cancel();url=candidate.url;throw Error('Download link expired; retrying');}
     if(r.status!==206&&!(r.status===200&&begin===0))throw Error('Server did not return the requested byte range');
     const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')||'');
     if(r.status===206&&(!range||+range[1]!==begin||+range[2]!==end||+range[3]!==candidate.size))throw Error('Incorrect download byte range');
     url=r.url||url;const limit=r.status===206?end+1:candidate.size,fd=fs.openSync(temp,'a');
     try{for await(const chunk of r.body){if(size+chunk.length>limit)throw Error('Download exceeds declared range');let written=0;while(written<chunk.length)written+=fs.writeSync(fd,chunk,written,chunk.length-written);size+=chunk.length;h.update(chunk);state.progress=Math.floor(size/candidate.size*100);}}finally{fs.closeSync(fd);}
     if(size!==limit)throw Error('Download interrupted');failures=0;
    }catch(e){try{await r?.body?.cancel();}catch{}if(size>begin)failures=0;if(++failures>=3)throw e;url=candidate.url;await new Promise(resolve=>setTimeout(resolve,failures*1000));}
   }
   if(h.digest('hex')!==candidate.sha256){integrityFailed=true;throw Error('Downloaded file failed SHA-256 verification');}
   fs.renameSync(temp,file);state.phase='downloaded';state.progress=100;
  }catch(e){if(integrityFailed)try{fs.unlinkSync(temp);}catch{}state.phase='error';state.error=e.message;}finally{working=false;}return snapshot();
 }
 async function verifiedFile(){if(working||state.phase!=='downloaded'||!candidate)throw Error('Download and verify an update first');const file=path.join(cache,candidate.name);if(fs.statSync(file).size!==candidate.size||await hash(file)!==candidate.sha256)throw Error('Update file changed; download it again');return{file,...candidate};}
 return{snapshot,check,download,setAutoCheck,verifiedFile};
}
function busyForUpdate(s){return !!(s?.busy||s?.localBusy||(s?.printer?.connected&&['RUNNING','PAUSE','PREPARE'].includes(s.printer.state?.gcode_state)));}
function backupData(directory,version){const dest=path.join(directory,'backups',`before-${version}-${Date.now()}`);fs.mkdirSync(dest,{recursive:true});for(const name of ['workspace.json','printer.enc.json','Local State','connection-preferences.json','pairing-disabled.json','ui-preferences.json']){const file=path.join(directory,name);if(fs.existsSync(file))fs.copyFileSync(file,path.join(dest,name));}return dest;}
module.exports={createUpdater,newer,releaseInfo,response,hash,busyForUpdate,backupData,RELEASES};
