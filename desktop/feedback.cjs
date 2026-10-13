'use strict';
const crypto=require('node:crypto'),os=require('node:os'),Policy=require('../feedback-policy.js');
const config=require('./feedback-config.json');
function endpoint(value){if(!value)return null;let u;try{u=new URL(value);}catch{throw Error('FEEDBACK_CONFIG');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('FEEDBACK_CONFIG');return u.href;}
function validIssue(url,repo=config.repository){try{const u=new URL(url);return u.origin==='https://github.com'&&new RegExp('^/'+repo.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&')+'/issues/[1-9][0-9]*$').test(u.pathname)&&!u.search&&!u.hash;}catch{return false;}}
function createFeedback({version,platform=process.platform+' '+process.arch+' '+os.release(),url=config.endpoint,repo=config.repository,fetchImpl=fetch,secrets=async()=>[],now=Date.now}={}){
 const target=endpoint(url),drafts=new Map();let sending=false;
 function status(){return{enabled:!!target,repository:repo,public:true};}
 function get(id){const d=drafts.get(id);if(!d||now()-d.at>30*60*1000)throw Error('FEEDBACK_EXPIRED');return d;}
 async function prepare(input){
  const report=Policy.normalize({...input,version,platform},await secrets());
  if(!report.message&&!report.steps)report.message=report.locale==='en'?'User-reported issue':'用户反馈的问题';
  const id=crypto.randomUUID(),draft={id,report,at:now()};drafts.set(id,draft);while(drafts.size>8)drafts.delete(drafts.keys().next().value);
  return structuredClone({id,report,markdown:Policy.markdown(report),...status()});
 }
 async function submit(v){
  if(v?.consent!==true)throw Error('FEEDBACK_CONSENT');const d=get(v.id);
  if(d.result)return d.result;if(!target)throw Error('FEEDBACK_UNCONFIGURED');if(sending)throw Error('FEEDBACK_BUSY');
  sending=true;try{
   const response=await fetchImpl(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:d.id,report:d.report}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(response.status===429)throw Error('FEEDBACK_RATE_LIMIT');if(!response.ok)throw Error(response.status===409?'FEEDBACK_PENDING':'FEEDBACK_SERVICE');
   if(Number(response.headers?.get('content-length')||0)>8192)throw Error('FEEDBACK_SERVICE');
   const text=await response.text();if(Buffer.byteLength(text)>8192)throw Error('FEEDBACK_SERVICE');const result=JSON.parse(text);
   if(!Number.isSafeInteger(result.number)||!validIssue(result.url,repo)||!result.url.endsWith('/'+result.number))throw Error('FEEDBACK_SERVICE');
   d.result={number:result.number,url:result.url};return d.result;
  }catch(e){if(/^FEEDBACK_/.test(e.message))throw e;throw Error('FEEDBACK_UNCERTAIN');}finally{sending=false;}
 }
 return{status,prepare,submit,markdown:id=>Policy.markdown(get(id).report),validIssue:url=>validIssue(url,repo)};
}
module.exports={createFeedback,validIssue,endpoint};

