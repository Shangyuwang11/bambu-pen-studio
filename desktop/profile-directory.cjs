'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// AppData can be redirected by the process that starts an application. Keep
// the durable profile outside that virtualized tree, independent of releases.
function chooseProfileDirectory({home,appData,testDirectory}){
 if(testDirectory)return {directory:path.resolve(testDirectory),migrated:false,isolated:true};
 const directory=path.join(home,'.a1-pen-studio');
 if(fs.existsSync(directory))return {directory,migrated:false};
 const roots=[path.join(appData,'A1 Pen Studio'),path.join(home,'AppData','Roaming','A1 Pen Studio')];
 const packages=path.join(home,'AppData','Local','Packages');
 try{for(const name of fs.readdirSync(packages))if(/^OpenAI\.Codex_[A-Za-z0-9]+$/.test(name))roots.push(path.join(packages,name,'LocalCache','Roaming','A1 Pen Studio'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const unique=[...new Set(roots.map(p=>path.resolve(p)))],read=(root,name,max=32*1024*1024)=>{
  const file=path.join(root,name);try{const stat=fs.statSync(file);if(!stat.isFile()||stat.size>max)throw Error('旧配置文件过大或无效：'+name);return {value:JSON.parse(fs.readFileSync(file,'utf8')),mtime:stat.mtimeMs,file};}catch(e){if(e.code==='ENOENT')return null;throw e;}
 };
 const sources=unique.filter(p=>fs.existsSync(p)).map(root=>{
  const pair=read(root,'printer.enc.json',16384),work=read(root,'workspace.json'),forgot=read(root,'pairing-disabled.json',16384);
  if(pair&&(!pair.value.ip||!pair.value.serial||typeof pair.value.encrypted!=='string'))throw Error('旧打印机配置无法读取；原文件已保留');
  if(work&&(!work.value.state||!Array.isArray(work.value.state.objects)))throw Error('旧作品配置无法读取；原文件已保留');
  return {root,pair,work,forgot};
 });
 const forgotten=sources.filter(s=>s.forgot?.value.disabled===true).sort((a,b)=>b.forgot.mtime-a.forgot.mtime)[0];
 const paired=sources.filter(s=>s.pair&&!s.forgot).sort((a,b)=>b.pair.mtime-a.pair.mtime)[0];
 const keepForgotten=forgotten&&(!paired||forgotten.forgot.mtime>=paired.pair.mtime);
 const connection=keepForgotten?forgotten:paired;
 const richness=s=>(s.work?.value.state.objects.length||0)+(s.work?.value.library?.length||0)+(s.work?.value.presets?.length||0);
 const workspace=sources.filter(s=>s.work).sort((a,b)=>Number(richness(b)>0)-Number(richness(a)>0)||b.work.mtime-a.work.mtime)[0];
 const staging=directory+'.migration-'+crypto.randomUUID();fs.mkdirSync(staging,{recursive:false});
 try{
  const copy=(source,name)=>{if(!source)return;const input=path.join(source.root,name);if(fs.existsSync(input))fs.copyFileSync(input,path.join(staging,name));};
  // Chromium's encryption key belongs with its encrypted printer record.
  for(const name of ['printer.enc.json','Local State','connection-preferences.json','pairing-disabled.json','file-job.json'])copy(connection,name);
  copy(workspace,'workspace.json');
  const backup=path.join(staging,'migration-backups');
  for(let i=0;i<sources.length;i++){
   const dest=path.join(backup,String(i+1));fs.mkdirSync(dest,{recursive:true});
   for(const name of ['printer.enc.json','Local State','workspace.json','connection-preferences.json','pairing-disabled.json','file-job.json']){const input=path.join(sources[i].root,name);if(fs.existsSync(input))fs.copyFileSync(input,path.join(dest,name));}
  }
  const record={version:1,at:new Date().toISOString(),sources:sources.map(s=>s.root),connectionSource:connection?.root||null,workspaceSource:workspace?.root||null};
  fs.writeFileSync(path.join(staging,'profile-migration.json'),JSON.stringify(record,null,2));
  try{fs.renameSync(staging,directory);}catch(e){if(!fs.existsSync(path.join(directory,'profile-migration.json')))throw e;fs.rmSync(staging,{recursive:true,force:true});}
  return {directory,migrated:sources.length>0};
 }catch(e){e.message='无法迁移原来的应用数据，原配置仍保留：'+e.message;throw e;}
}
module.exports={chooseProfileDirectory};
