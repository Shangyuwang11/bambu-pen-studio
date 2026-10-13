(function(){'use strict';
 const $=id=>document.getElementById(id),P=PenFeedbackPolicy,en=()=>window.PenI18n?.language==='en',t=(a,b)=>en()?b:a;
 let latest=null,snapshot=null,draft=null,result=null,working=false,revision=0,timer,seen='',availability={enabled:false};
 const notice=document.createElement('aside');notice.id='problemNotice';notice.hidden=true;notice.setAttribute('role','status');
 notice.innerHTML='<div class="problem-heading"><strong id="problemTitle"></strong><button id="problemDismiss" class="icon-button" type="button"></button></div><p id="problemAdvice"></p><details><summary id="problemDetailsLabel"></summary><pre id="problemDetails" data-i18n-skip></pre></details><div class="problem-actions"><button id="problemFix" type="button"></button><button id="problemReport" type="button"></button></div>';
 document.body.append(notice);$('problemDismiss').append(PenIcons.svg('close'));
 const box=document.createElement('dialog');box.id='feedbackDialog';box.className='feedback-dialog';box.setAttribute('aria-labelledby','feedbackTitle');
 box.innerHTML='<header><div><h2 id="feedbackTitle"></h2><p id="feedbackPrivacy"></p></div><button id="feedbackClose" class="icon-button" type="button"></button></header><div class="feedback-content"><label for="feedbackSteps" id="feedbackStepsLabel"></label><textarea id="feedbackSteps" rows="3" maxlength="3000"></textarea><label class="feedback-check"><input id="feedbackDiagnostics" type="checkbox" checked><span id="feedbackDiagnosticsLabel"></span></label><h3 id="feedbackPreviewLabel"></h3><pre id="feedbackPreview" tabindex="0" data-i18n-skip></pre><label class="feedback-check"><input id="feedbackConsent" type="checkbox"><span id="feedbackConsentLabel"></span></label><p id="feedbackService" class="settings-note"></p><p id="feedbackResult" role="status"></p></div><footer><button id="feedbackCopy" type="button"></button><button id="feedbackExport" type="button"></button><button id="feedbackIssue" type="button" hidden></button><button id="feedbackSubmit" class="primary" type="button"></button></footer>';
 document.body.append(box);$('feedbackClose').append(PenIcons.svg('close'));
 function message(error){const code=String(error?.message||error).match(/FEEDBACK_[A-Z_]+/)?.[0],messages={
  FEEDBACK_UNCONFIGURED:['匿名反馈通道尚未启用，可以先导出报告。','Anonymous reporting is not configured yet. You can export this report.'],
  FEEDBACK_CONSENT:['请查看报告并确认提交到公开 GitHub Issues。','Review the report and confirm publication to GitHub Issues.'],
  FEEDBACK_EXPIRED:['报告已过期，请修改说明或重新打开反馈窗口。','Report expired. Edit the description or reopen this window.'],
  FEEDBACK_RATE_LIMIT:['提交太频繁，请稍后再试；报告仍保留在这里。','Too many reports. Try later; this draft remains here.'],
  FEEDBACK_PENDING:['服务还未确认结果，请稍后重试这份报告，不要重复新建。','The result is not confirmed yet. Retry this same report later instead of creating another.'],
  FEEDBACK_UNCERTAIN:['暂未收到结果，可能已提交。稍后重试同一份报告可避免重复。','No result received; submission may have succeeded. Retry this same report later to avoid duplicates.'],
  FEEDBACK_SERVICE:['反馈服务暂不可用，可以导出报告，或稍后重试。','Feedback service is unavailable. Export the report or retry later.'],
  FEEDBACK_BUSY:['正在提交，请稍候。','Submitting. Please wait.']
 };return(messages[code]||['未能完成反馈操作，报告可以导出保存。','Could not complete the operation. You can export the report.'])[en()?1:0];}
 function render(){
  const labels={feedbackTitle:['报告问题','Report a problem'],feedbackPrivacy:['提交后会出现在公开 GitHub Issues。提交前请检查下方内容；不附作品、图片或完整日志。','Reports appear in public GitHub Issues. Review the contents below; artwork, images and full logs are not attached.'],feedbackStepsLabel:['你点了什么，之后发生了什么？（可选）','What did you do, and what happened? (optional)'],feedbackDiagnosticsLabel:['附带程序错误位置和机器状态','Include application error location and printer state'],feedbackPreviewLabel:['将要发送的内容','Content to be sent'],feedbackConsentLabel:['我已检查内容，同意提交到公开 GitHub Issues','I reviewed this content and agree to publish it to GitHub Issues'],feedbackCopy:['复制报告','Copy report'],feedbackExport:['导出报告','Export report'],feedbackIssue:['查看 GitHub 记录','View GitHub issue'],feedbackSubmit:[working?'提交中…':result?'已提交':'提交到 GitHub',working?'Submitting…':result?'Submitted':'Submit to GitHub'],problemDetailsLabel:['查看原始提示','View original message'],problemReport:['报告问题','Report a problem']};
  for(const[id,v]of Object.entries(labels))$(id).textContent=v[en()?1:0];
  for(const id of ['feedbackClose','problemDismiss']){$(id).title=t('关闭','Close');$(id).setAttribute('aria-label',t('关闭','Close'));}
  const status=availability.enabled?t('无需登录 GitHub。只在你点击提交后发送。','No GitHub login required. Sent only when you click Submit.'):t('匿名反馈通道尚未启用，可以导出报告；当前不会上传。','Anonymous reporting is not enabled yet. Export a report; nothing is uploaded.');
  $('feedbackService').textContent=status;if($('feedbackAvailability'))$('feedbackAvailability').textContent=status;
  $('feedbackSubmit').disabled=working||!!result||!draft||!availability.enabled||!$('feedbackConsent').checked;
  $('feedbackCopy').disabled=working||!draft;$('feedbackExport').disabled=working||!draft;$('feedbackIssue').hidden=!result;
  $('feedbackClose').disabled=working;
  for(const id of ['feedbackSteps','feedbackDiagnostics','feedbackConsent'])$(id).disabled=working||!!result;
  if(latest){const c=latest.classification;$('problemTitle').textContent=c.title[en()?'en':'zh'];$('problemAdvice').textContent=c.advice[en()?'en':'zh'];$('problemDetails').textContent=P.redact(latest.message);$('problemFix').hidden=!c.action;$('problemReport').classList.toggle('primary',c.reportable);$('problemFix').classList.toggle('primary',!c.reportable);$('problemFix').textContent=c.action==='refresh'?t('刷新状态','Refresh status'):t('打开对应设置','Open settings');}
 }
 function capture(value){
  const event=typeof value==='string'?{message:value}:value||{},text=P.cleanError(event.message??event.error);if(!text)return;
  const classification=P.classify(text,event),key=classification.id+text;
  latest={message:text,stack:String(event.stack||event.error?.stack||''),classification};
  // The connection editor already displays this error beside its form. A
  // second floating notice obscures its controls, including the close button.
  const inline=event.source==='connection'&&$('deviceForm')?.hidden===false&&$('deviceError')?.hidden===false&&P.cleanError($('deviceError').textContent)===text;
  if(inline)notice.hidden=true;else if(seen!==key)notice.hidden=false;seen=key;render();
 }
 async function refreshDraft(){
  const mine=++revision;draft=null;result=null;$('feedbackConsent').checked=false;render();
  const input={category:latest?.classification.kind||'unknown',code:latest?.classification.code||'user-report',message:latest?.message||'',stack:latest?.stack||'',steps:$('feedbackSteps').value,diagnostics:$('feedbackDiagnostics').checked,model:snapshot?.device?.model||PenStudio.getSettings().machine.model,printerState:snapshot?.printer?.state?.gcode_state,locale:en()?'en':'zh-CN'};
  try{
   const next=window.PenDesktopAPI?.prepareFeedback?await PenDesktopAPI.prepareFeedback(P.normalize(input)):{id:crypto.randomUUID(),report:P.normalize({...input,version:window.PenDesktopAPI?.version||'0.22.0',platform:'browser'}),enabled:false};
   if(mine!==revision||!box.open)return;draft=next;availability={...availability,enabled:next.enabled};draft.markdown=next.markdown||P.markdown(next.report);$('feedbackPreview').textContent=draft.markdown;$('feedbackResult').textContent='';
  }catch(e){if(mine===revision)$('feedbackResult').textContent=message(e);}render();
 }
 function changed(){revision++;draft=null;result=null;$('feedbackConsent').checked=false;$('feedbackPreview').textContent=t('正在更新预览…','Updating preview…');clearTimeout(timer);render();timer=setTimeout(refreshDraft,180);}
 async function open(){
  if(working)return;
  if($('settingsDialog')?.open)$('settingsDialog').close();notice.hidden=true;clearTimeout(timer);
  if(!box.open){$('feedbackSteps').value='';$('feedbackDiagnostics').checked=true;box.showModal();}render();await refreshDraft();
 }
 $('openFeedback').onclick=open;$('problemReport').onclick=open;$('feedbackClose').onclick=()=>{if(!working)box.close();};$('problemDismiss').onclick=()=>{notice.hidden=true;};
 box.addEventListener('cancel',e=>{if(working)e.preventDefault();});box.addEventListener('close',()=>{revision++;clearTimeout(timer);});
 $('feedbackSteps').addEventListener('input',changed);$('feedbackDiagnostics').addEventListener('change',changed);$('feedbackConsent').onchange=render;
 $('problemFix').onclick=async()=>{const action=latest?.classification.action;notice.hidden=true;if(action==='refresh'){try{await PenConnection.refreshStatus({force:true});}catch(e){capture({message:e.message,source:'connection'});}}else if(action)PenNativeShell.go(action);};
 $('feedbackCopy').onclick=async()=>{if(!draft)return;try{if(window.PenDesktopAPI?.copyFeedback)await PenDesktopAPI.copyFeedback(draft.id);else await navigator.clipboard.writeText(draft.markdown);$('feedbackResult').textContent=t('报告已复制。','Report copied.');}catch(e){$('feedbackResult').textContent=t('无法复制，请使用导出报告。','Could not copy. Use Export report.');}};
 $('feedbackExport').onclick=()=>{if(!draft)return;const url=URL.createObjectURL(new Blob([draft.markdown],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='bambu-pen-feedback.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('feedbackSubmit').onclick=async()=>{if(working||!draft||!$('feedbackConsent').checked||!availability.enabled)return;working=true;render();try{result=await PenDesktopAPI.submitFeedback({id:draft.id,consent:true});$('feedbackResult').textContent=t('已提交，GitHub 记录 #','Submitted as GitHub issue #')+result.number;}catch(e){$('feedbackResult').textContent=message(e);}finally{working=false;render();}};
 $('feedbackIssue').onclick=async()=>{if(result)try{await PenDesktopAPI.openFeedbackIssue(result.url);}catch(e){$('feedbackResult').textContent=message(e);}};
 window.addEventListener('penproblem',e=>capture(e.detail));window.addEventListener('penconnectionerror',e=>capture({message:e.detail,source:'connection'}));
 window.addEventListener('error',e=>{if(e.message)capture({message:e.message,stack:e.error?.stack,source:'runtime'});});
 window.addEventListener('unhandledrejection',e=>capture({message:e.reason?.message||String(e.reason),stack:e.reason?.stack,source:'runtime'}));
 window.addEventListener('penconnection',e=>{snapshot=e.detail;if(snapshot.run?.status==='failed'&&snapshot.run.error)capture({message:snapshot.run.error,source:'motion'});});
 window.addEventListener('penlanguagechange',render);
 window.PenFeedbackUI={open,capture};if(window.PenDesktopAPI?.feedbackStatus)PenDesktopAPI.feedbackStatus().then(s=>{availability=s;render();}).catch(()=>{});render();
})();

