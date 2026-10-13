'use strict';
// Standalone server. Never packaged with or run by the desktop application.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const Policy=require('../feedback-policy.js');
function createRelay({token,repository=Policy.REPO,directory,rateSecret,fetchImpl=fetch,now=Date.now,trustLoopbackProxy=false,perIp=6,globalLimit=30}){
 if(typeof token!=='string'||!token||!directory||typeof rateSecret!=='string'||rateSecret.length<32||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw Error('Set server credentials, storage directory and a 32-character rate secret');
 const file=path.join(directory,'feedback-ledger.json');fs.mkdirSync(directory,{recursive:true,mode:0o700});
 let db={records:{},counts:{}};
 if(fs.existsSync(file)){if(fs.statSync(file).size>2*1024*1024)throw Error('Feedback ledger exceeds budget');db=JSON.parse(fs.readFileSync(file,'utf8'));if(!db.records||!db.counts)throw Error('Invalid feedback ledger');}
 const persist=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(db),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 function address(req){let ip=req.socket.remoteAddress||'unknown';if(trustLoopbackProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)){const forwarded=req.headers['x-real-ip'];if(typeof forwarded==='string'&&net.isIP(forwarded))ip=forwarded;}return crypto.createHmac('sha256',rateSecret).update(ip).digest('hex');}
 function reserve(id,digest,peer){
  const time=now();for(const[k,v]of Object.entries(db.records))if(time-v.at>7*86400000)delete db.records[k];
  for(const[k,v]of Object.entries(db.counts))if(time-v.at>3600000)delete db.counts[k];
  const current=db.records[id];if(current)return current.digest===digest?{existing:current}:{error:409};
  for(const[key,max]of [[peer,perIp],['global',globalLimit]])if((db.counts[key]?.count||0)>=max)return{error:429};
  for(const key of [peer,'global'])db.counts[key]={at:db.counts[key]?.at||time,count:(db.counts[key]?.count||0)+1};
  db.records[id]={at:time,digest,state:'pending'};persist();return{};
 }
 async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>Policy.MAX_BYTES)throw Error('SIZE');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/health'&&req.method==='GET')return json(res,200,{ok:true});
   if(req.url!=='/reports'||req.method!=='POST')return json(res,404,{error:'NOT_FOUND'});
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')||req.headers.origin)return json(res,415,{error:'DESKTOP_CLIENT_REQUIRED'});
   if(Number(req.headers['content-length']||0)>Policy.MAX_BYTES)return json(res,413,{error:'TOO_LARGE'});
   const input=await body(req);
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input?.id||'')||input.report?.schema!==1)return json(res,400,{error:'INVALID_REPORT'});
   const report=Policy.normalize(input.report,[token]),encoded=JSON.stringify(report);
   if(!report.message&&!report.steps)return json(res,400,{error:'EMPTY_REPORT'});
   const digest=crypto.createHash('sha256').update(encoded).digest('hex'),limit=reserve(input.id,digest,address(req));
   if(limit.error)return json(res,limit.error,{error:limit.error===429?'RATE_LIMIT':'ID_CONFLICT'});
   if(limit.existing)return limit.existing.result?json(res,200,limit.existing.result):json(res,409,{error:'SUBMISSION_PENDING',id:input.id});
   let response;
   try{
    response=await fetchImpl('https://api.github.com/repos/'+repository+'/issues',{method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Bambu-Pen-Feedback'},body:JSON.stringify({title:'[Bambu Pen '+report.version+'] '+report.category+' · '+report.code,body:Policy.markdown(report)+'\nReport ID: '+input.id}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok){db.records[input.id].state='rejected';persist();return json(res,502,{error:'GITHUB_REJECTED',id:input.id});}
    const result=await response.json(),expected='https://github.com/'+repository+'/issues/'+result.number;
    if(!Number.isSafeInteger(result.number)||result.number<1||result.html_url!==expected)throw Error('Invalid upstream response');
    const publicResult={number:result.number,url:expected};db.records[input.id]={...db.records[input.id],state:'sent',result:publicResult};persist();return json(res,201,publicResult);
   }catch{
    // An upstream timeout can occur AFTER issue creation. Retain this ID as
    // pending; retries must never blindly create a second issue.
    return json(res,409,{error:'SUBMISSION_PENDING',id:input.id});
   }
  }catch(e){return json(res,e.message==='SIZE'?413:e instanceof SyntaxError?400:503,{error:'REPORT_NOT_ACCEPTED'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=30;
 return server;
}
if(require.main===module){
 const server=createRelay({token:process.env.FEEDBACK_GITHUB_TOKEN,repository:process.env.FEEDBACK_REPOSITORY||Policy.REPO,directory:process.env.FEEDBACK_DATA_DIR||path.join(__dirname,'data'),rateSecret:process.env.FEEDBACK_RATE_SECRET,trustLoopbackProxy:process.env.FEEDBACK_TRUST_LOOPBACK_PROXY==='1'});
 server.listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('Feedback relay listening on loopback. Use an HTTPS reverse proxy.'));
}
module.exports={createRelay};

