'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
function validate(p){const a=String(p?.ip||'').split('.').map(Number);if(net.isIP(p?.ip||'')!==4||!(a[0]===10||a[0]===192&&a[1]===168||a[0]===172&&a[1]>=16&&a[1]<=31)||!/^[A-Za-z0-9]{10,30}$/.test(p?.serial||'')||!/^[A-Za-z0-9]{8}$/.test(p?.accessCode||''))throw Error('保存的打印机资料格式无效');if(p.model!==undefined&&!require('../printer-models.js').supported(p.model))throw Error('保存的打印机机型无效');return{ip:p.ip,serial:p.serial,accessCode:p.accessCode,...(p.model?{model:p.model}:{})};}
function createPairStore({directory,bundledFile,safeStorage,allowBundled=true,unprotect=require('./dpapi.cjs').unprotect,onEvent=()=>{}}){
 const file=path.join(directory,'printer.enc.json'),disabled=path.join(directory,'pairing-disabled.json');let generation=0;
 const atomic=(name,value)=>{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(name+'.tmp',JSON.stringify(value));fs.renameSync(name+'.tmp',name);};
 function read(){if(fs.statSync(file).size>16384)throw Error('资料过大');const v=JSON.parse(fs.readFileSync(file,'utf8'));return validate({ip:v.ip,serial:v.serial,...(v.model?{model:v.model}:{}),accessCode:safeStorage.decryptString(Buffer.from(v.encrypted,'base64'))});}
 function save(value){const p=validate(value);if(!safeStorage.isEncryptionAvailable())throw Error('Windows 凭据加密暂不可用');const encrypted=safeStorage.encryptString(p.accessCode).toString('base64');atomic(file,{ip:p.ip,serial:p.serial,encrypted,...(p.model?{model:p.model}:{})});if(fs.existsSync(disabled))fs.unlinkSync(disabled);generation++;}
 function forget(){generation++;atomic(disabled,{disabled:true});if(fs.existsSync(file))fs.unlinkSync(file);}
 function hasBundled(){return allowBundled&&!!bundledFile&&fs.existsSync(bundledFile)&&!fs.existsSync(disabled);}
 function publicPair(){try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return{model:v.model||null,ip:v.ip,serial:v.serial};}catch{return null;}}
 async function load(){
  if(fs.existsSync(disabled))return null;let unreadable=false;
  if(fs.existsSync(file))try{return read();}catch{unreadable=true;}
  if(!hasBundled()){if(unreadable)throw Error('保存的访问码无法读取，请重新填写一次');return null;}
  const mine=generation;let recovered;
  try{if(fs.statSync(bundledFile).size>16384)throw Error();recovered=validate(JSON.parse((await unprotect(fs.readFileSync(bundledFile))).toString('utf8')));}catch{throw Error('内置打印机资料无法在当前 Windows 用户下恢复');}
  if(mine!==generation||fs.existsSync(disabled))return fs.existsSync(disabled)?null:read();
  if(unreadable)fs.copyFileSync(file,file+'.unreadable-'+Date.now());save(recovered);onEvent({event:'bundled-pair-restored',at:Date.now()});return recovered;
 }
 return{save,load,forget,publicPair,hasBundled};
}
module.exports={createPairStore,validate};
