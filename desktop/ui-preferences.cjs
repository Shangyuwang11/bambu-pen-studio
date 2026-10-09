'use strict';
const fs=require('node:fs'),path=require('node:path');
function normalize(value={},language='en'){
 return {language:['zh-CN','en'].includes(value.language)?value.language:language,
 theme:['system','light','dark'].includes(value.theme)?value.theme:'system'};
}
function createPreferences(directory,language){
 const file=path.join(directory,'ui-preferences.json');let value;
 try{value=normalize(JSON.parse(fs.readFileSync(file,'utf8')),language);}catch{value=normalize({},language);}
 return {get:()=>({...value}),patch(change){
  if(!change||typeof change!=='object'||Object.keys(change).some(k=>!['language','theme'].includes(k)))throw Error('Invalid preferences');
  if('language' in change&&!['zh-CN','en'].includes(change.language)||'theme' in change&&!['system','light','dark'].includes(change.theme))throw Error('Invalid preferences');
  const next=normalize({...value,...change},language);fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify(next));fs.renameSync(file+'.tmp',file);value=next;return {...value};
 }};
}
module.exports={normalize,createPreferences};
