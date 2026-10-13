'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const P=require('../feedback-policy.js'),{createFeedback,validIssue}=require('../desktop/feedback.cjs'),{createRelay}=require('../feedback-relay/server.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pen-feedback-')),input={schema:1,version:'0.22.0',platform:'win32 x64',locale:'zh-CN',category:'software',code:'runtime',model:'a1',message:"TypeError: Cannot read properties of undefined",steps:'Click Import',diagnostics:true,stack:'at draw (C:\\Users\\PrivatePerson\\secret-project\\app.js:10:2)',printerState:'IDLE'};
let checks=0;async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{try{
 await check('Known setup, network and hardware errors give guidance; runtime and unknown errors remain reportable',()=>{
  for(const [text,kind,action]of [['请选择 A1 mini、A1 或 P1S','settings','devices'],['请先归零建立本次位置','settings','calibration'],['抬笔高度超出机器行程','settings','calibration'],['请输入范围内的速度','settings','design'],['ECONNREFUSED 192.168.1.1','connection','devices'],['当前动作尚未完成，请等待','printer','refresh'],['打印机有故障','printer','refresh']]){const c=P.classify(text);assert.equal(c.kind,kind,text);assert.equal(c.action,action);}
  assert.equal(P.classify(input.message).kind,'software');assert(P.classify('unexpected issue').reportable);assert.equal(P.classify('文件任务读取失败 0500-C010').kind,'unknown');
  assert.equal(P.cleanError("Error invoking remote method 'pen:pair': Error: 请填写访问码"),'请填写访问码');
 });
 await check('Whitelisted diagnostics and free text remove credentials, IPs, paths, serials and image data',()=>{
  const r=P.normalize({...input,message:'accessCode=87654321 serial=PrivateSerialXYZ 192.168.1.12 https://example.com/private ghp_SECRETabc user@example.com',steps:'AbCdE123 data:image/png;base64,AAAA C:\\Users\\PrivatePerson\\work.png',code:'87654321',accessCode:'secret',objects:[{source:'data:image/png;base64,AAAA'}]},['AbCdE123','PrivateSerialXYZ']);
  const raw=JSON.stringify(r);for(const value of ['secret-project','87654321','PrivateSerialXYZ','192.168.1.12','example.com','ghp_SECRETabc','user@example','AbCdE123','PrivatePerson','AAAA','objects','accessCode":"secret'])assert(!raw.includes(value),value);
  assert(!Object.hasOwn(P.normalize({...input,diagnostics:false}),'stack'));
  assert(Buffer.byteLength(JSON.stringify(P.normalize({...input,steps:'画'.repeat(50000),message:'字'.repeat(50000),stack:'行'.repeat(50000)})))<P.MAX_BYTES-100);
 });
 await check('No configured endpoint never uploads; consent and prepared immutable content are enforced',async()=>{
  let count=0,body;const disabled=createFeedback({version:'0.22.0',fetchImpl:()=>{count++;}}),a=await disabled.prepare(input);
  await assert.rejects(disabled.submit({id:a.id,consent:true}),/UNCONFIGURED/);assert.equal(count,0);
  const sender=createFeedback({version:'0.22.0',url:'https://feedback.example/reports',secrets:async()=>['AbCdE123'],fetchImpl:async(_url,v)=>{count++;body=JSON.parse(v.body);return new Response(JSON.stringify({number:1,url:'https://github.com/'+P.REPO+'/issues/1'}));}});
  const draft=await sender.prepare({...input,steps:'AbCdE123'}),preview=draft.markdown;draft.report.steps='changed after preview';
  await assert.rejects(sender.submit({id:draft.id}),/CONSENT/);assert.equal(count,0);
  const result=await sender.submit({id:draft.id,consent:true});assert.equal(result.number,1);assert.equal(P.markdown(body.report),preview);assert(!JSON.stringify(body).includes('AbCdE123'));
  await sender.submit({id:draft.id,consent:true});assert.equal(count,1);
  assert(!validIssue('https://github.com/attacker/repo/issues/1'));assert(!validIssue('https://github.com/'+P.REPO+'/issues/1?redirect=evil'));
  assert.throws(()=>createFeedback({url:'http://unsafe/reports'}),/CONFIG/);
 });
 await check('Submission failure never claims success or exposes response bodies; draft IDs survive retries',async()=>{
  let calls=[];const sender=createFeedback({version:'0.22.0',url:'https://feedback.example/reports',fetchImpl:async(_url,v)=>{calls.push(JSON.parse(v.body).id);return new Response('private server details',{status:calls.length===1?429:409});}}),d=await sender.prepare(input);
  await assert.rejects(sender.submit({id:d.id,consent:true}),/RATE_LIMIT/);await assert.rejects(sender.submit({id:d.id,consent:true}),/PENDING/);assert.equal(calls[0],calls[1]);
 });
 let upstream=[],server=createRelay({token:'server-only-secret',rateSecret:'rate-secret-must-remain-on-server-12345',directory:path.join(root,'relay'),perIp:2,fetchImpl:async(url,v)=>{upstream.push({url,...v});return new Response(JSON.stringify({number:upstream.length,html_url:'https://github.com/'+P.REPO+'/issues/'+upstream.length}),{status:201});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const send=(id,report=input,extra={})=>fetch(origin+'/reports',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify({id,report})});
 try{
  await check('Anonymous HTTP relay creates a GitHub issue using only server credentials and fixed repository',async()=>{
   const id=crypto.randomUUID(),r=await send(id),j=await r.json();assert.equal(r.status,201);assert.equal(j.number,1);assert(!JSON.stringify(j).includes('secret'));
   assert.equal(upstream[0].url,'https://api.github.com/repos/'+P.REPO+'/issues');assert.equal(upstream[0].headers.Authorization,'Bearer server-only-secret');assert(!upstream[0].body.includes('PrivatePerson'));
   const again=await send(id);assert.equal(again.status,200);assert.equal(upstream.length,1);
   assert.equal((await send(id,{...input,steps:'different'})).status,409);assert.equal(upstream.length,1);
  });
  await check('Persistent relay rate limits, bounded inputs and browser-origin refusal prevent issue flooding',async()=>{
   assert.equal((await send(crypto.randomUUID())).status,201);assert.equal((await send(crypto.randomUUID())).status,429);assert.equal(upstream.length,2);
   assert.equal((await send(crypto.randomUUID(),input,{Origin:'https://untrusted.example'})).status,415);
   assert.equal((await send(crypto.randomUUID(),{...input,steps:'x'.repeat(20000)})).status,413);
   const ledger=fs.readFileSync(path.join(root,'relay','feedback-ledger.json'),'utf8');assert(!ledger.includes('127.0.0.1'));assert(!ledger.includes('server-only-secret'));assert(!ledger.includes('Click Import'));
  });
 }finally{await new Promise(r=>server.close(r));}
 await check('An uncertain upstream result is not resent after retry or service restart',async()=>{
  let calls=0;const directory=path.join(root,'pending'),id=crypto.randomUUID(),options={token:'server-only-secret',rateSecret:'rate-secret-must-remain-on-server-12345',directory,fetchImpl:async()=>{calls++;throw Error('network timeout after creation');}};
  for(let n=0;n<2;n++){const s=createRelay(options);await new Promise(r=>s.listen(0,'127.0.0.1',r));try{const r=await fetch('http://127.0.0.1:'+s.address().port+'/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,report:input})});assert.equal(r.status,409);}finally{await new Promise(r=>s.close(r));}}assert.equal(calls,1);
 });
 console.log('PASS '+checks+' feedback checks; no real GitHub issues created');
}finally{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('pen-feedback-'))throw Error('Unexpected temp directory');fs.rmSync(root,{recursive:true});}})().catch(e=>{console.error(e);process.exitCode=1;});

