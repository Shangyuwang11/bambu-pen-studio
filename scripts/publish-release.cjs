// Run after tests, build and git push. Credentials remain in gh / the environment.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),repo='Shangyuwang11/bambu-pen-studio',version=require('../package.json').version,tag='v'+version,base='https://api.github.com/repos/'+repo;
async function main(){
 if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw Error('Commit the release source before publishing.');
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const name=`Bambu-Pen-Studio-${version}-win-x64.exe`,file=path.join(root,'dist',name),info=JSON.parse(fs.readFileSync(path.join(root,'dist/build-info.json'),'utf8').replace(/^\uFEFF/,''));
 const bytes=fs.readFileSync(file),digest=crypto.createHash('sha256').update(bytes).digest('hex');if(info.version!==version||info.sha256.toLowerCase()!==digest)throw Error('Build metadata does not match the EXE.');
 const token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN||execFileSync(process.env.GH_PATH||'gh',['auth','token'],{encoding:'utf8',windowsHide:true}).trim();
 async function request(url,method='GET',data){const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});if(!r.ok)throw Error(`GitHub ${method} ${r.status}: ${await r.text()}`);return r.json();}
 await request(base+'/commits/'+commit);
 const notes=fs.readFileSync(path.join(root,'docs',`release-${version}.txt`),'utf8');
 const releases=await request(base+'/releases?per_page=100');let release=releases.find(r=>r.tag_name===tag);
 if(release&&!release.draft)throw Error('This version is already published. Increment the version rather than replace public assets.');
 if(!release)release=await request(base+'/releases','POST',{tag_name:tag,target_commitish:commit,name:'Bambu Pen Studio '+version,body:notes,draft:true,prerelease:false});
 for(const assetName of [name,'SHA256SUMS.txt']){
  const data=fs.readFileSync(path.join(root,'dist',assetName)),sha=crypto.createHash('sha256').update(data).digest('hex');const existing=release.assets.find(a=>a.name===assetName);
  if(existing){if(existing.digest!=='sha256:'+sha)throw Error('Draft has a different asset. Review it before publishing.');continue;}
  const r=await fetch(release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(assetName),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','Content-Length':String(data.length)},body:data});if(!r.ok)throw Error('Asset upload failed: '+r.status);const result=await r.json();if(result.digest!=='sha256:'+sha)throw Error('GitHub asset digest does not match local bytes');console.log('Uploaded and verified '+assetName);
 }
 const published=await request(base+'/releases/'+release.id,'PATCH',{draft:false,make_latest:'true'});console.log(published.html_url);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
