(function(root){'use strict';
 const dictionary=root.PenTranslations||{},records=new WeakMap(),attrRecords=new WeakMap(),pending=new Set();let frame=0,observer,started=false,language='zh-CN';
 try{language=localStorage.getItem('bambu-language')||'zh-CN';}catch{}
 if(!['zh-CN','en'].includes(language))language='en';document.documentElement.lang=language;
 const chinese=/[\u3400-\u9fff]/,escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');let fragments;
 function text(value){const s=String(value??'');if(language!=='en'||!chinese.test(s))return s;const trim=s.trim();if(Object.hasOwn(dictionary,trim))return s.replace(trim,dictionary[trim]);
  if(!fragments)fragments=new RegExp(Object.keys(dictionary).filter(k=>k.length>1&&chinese.test(k)).sort((a,b)=>b.length-a.length).map(escape).join('|'),'g');
  return s.replace(fragments,key=>dictionary[key]).replace(/(\d+)\s*分\s*(\d+)\s*秒/g,'$1 min $2 s').replace(/(\d+)\s*秒/g,'$1 s');
 }
 const ignore='script,style,textarea,[translate="no"],[data-i18n-skip],#layers .label,#penCards strong,#appLanguage';
 function skip(n){const e=n.nodeType===1?n:n.parentElement;return !e||!!e.closest(ignore)||e.tagName==='OPTION'&&['workspacePen','penLibrary','presetSelect','backingLibrary'].includes(e.closest('select')?.id)&&e.value!=='';}
 function displayText(source,n){
  if(language!=='en'||!n.parentElement?.closest('#calReuseSummary,#penDialogDescription,#penLibraryNote,#calPenValue,#penCurrentLabel'))return text(source);
  let names=[];try{names=(root.PenProfilesUI?.list()||[]).map(p=>p.name);const profile=root.PenMachineUI?.getProfile();if(profile?.name)names.push(profile.name);}catch{}
  names=[...new Set(names.filter(Boolean))].sort((a,b)=>b.length-a.length);if(!names.length)return text(source);
  const pieces=source.split(new RegExp('('+names.map(escape).join('|')+')','g'));return pieces.map(p=>names.includes(p)?p:text(p)).join('');
 }
 function updateText(n){if(skip(n))return;const old=records.get(n),current=n.nodeValue;if(!current?.trim())return;const source=old&&old.rendered===current?old.source:current;const rendered=displayText(source,n);if(current!==rendered)n.nodeValue=rendered;records.set(n,{source,rendered});}
 const attrs=['title','aria-label','placeholder','label'];
 function updateAttrs(e){if(skip(e))return;let map=attrRecords.get(e);if(!map){map={};attrRecords.set(e,map);}for(const a of attrs){const current=e.getAttribute(a);if(current===null)continue;const old=map[a],source=old&&old.rendered===current?old.source:current,rendered=text(source);if(current!==rendered)e.setAttribute(a,rendered);map[a]={source,rendered};}}
 function translate(node=document.body){if(!node)return;if(node.nodeType===3)return updateText(node);if(node.nodeType!==1)return;updateAttrs(node);const walker=document.createTreeWalker(node,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.nodeType===3)updateText(n);else updateAttrs(n);}}
 function flush(){frame=0;observer?.disconnect();const list=[...pending];pending.clear();for(const n of list)if(n.isConnected&&!list.some(parent=>parent!==n&&parent.nodeType===1&&parent.contains(n)))translate(n);observe();}
 function observe(){observer?.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attrs});}
 function start(){if(started)return;started=true;document.title="Bambu Pen";translate(document.body);observer=new MutationObserver(mutations=>{for(const m of mutations){if(m.type==='childList')for(const n of m.addedNodes)pending.add(n);else pending.add(m.target);}if(pending.size&&!frame)frame=requestAnimationFrame(flush);});observe();}
 async function setLanguage(value){if(!['zh-CN','en'].includes(value))return;if(root.PenDesktopAPI?.setLanguage)await root.PenDesktopAPI.setLanguage(value);language=value;document.documentElement.lang=language;try{localStorage.setItem('bambu-language',language);}catch{}observer?.disconnect();translate(document.body);observe();document.title='Bambu Pen';window.dispatchEvent(new CustomEvent('penlanguagechange',{detail:{language}}));}
 root.PenI18n={get language(){return language;},t:text,translate,start,setLanguage};
})(globalThis);
