(function(){'use strict';
 const root=document.documentElement;let finished=false,resolve;
 const settled=new Promise(r=>{resolve=r;});
 function message(){const label=document.getElementById('startupMessage'),retry=document.getElementById('startupRetry');if(root.dataset.uiBoot==='error'){if(label)label.textContent='界面未能加载完成。请重试；已有作品和校准配置不会被清除。';if(retry){retry.hidden=false;retry.onclick=()=>location.reload();}}}
 function fail(){if(finished)return;finished=true;clearTimeout(timeout);root.dataset.uiBoot='error';message();resolve('error');}
 const timeout=setTimeout(fail,30000);
 window.addEventListener('error',e=>{if(e.target?.tagName==='SCRIPT'||e instanceof ErrorEvent)fail();},true);
 document.addEventListener('DOMContentLoaded',message,{once:true});
 window.PenUIBoot={settled,fail,complete(){if(finished)return;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(finished)return;finished=true;clearTimeout(timeout);root.dataset.uiBoot='ready';resolve('ready');window.dispatchEvent(new Event('pen-ui-ready'));}));}};
})();
