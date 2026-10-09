(function(root){'use strict';
 const C=root.PenCore||(typeof require==='function'?require('./core.js'):null),A=root.PenAlignment||(typeof require==='function'?require('./alignment.js'):null);
 const STORE='bambu-fixed-backings-v1',key=m=>[m.model,m.w,m.h].join(':'),color=(v,fallback)=>/^#[\da-f]{6}$/i.test(v||'')?v:fallback;
 function validate(v){
  const finite=(n,lo,hi)=>{if(!Number.isFinite(n)||n<lo||n>hi)throw Error('固定底板数据无效');return n;};
  if(!v||!['a1-mini','a1','p1s','custom'].includes(v.machine?.model))throw Error('固定底板机型无效');
  const machine={model:v.machine.model,w:finite(v.machine.w,10,500),h:finite(v.machine.h,10,500)};
  if(!Array.isArray(v.paths)||v.paths.length>50000)throw Error('固定底板路径过多');let count=0;
  const paths=v.paths.map(p=>{if(!Array.isArray(p)||p.length<2||(count+=p.length)>150000)throw Error('固定底板路径无效');return p.map(q=>{if(!Array.isArray(q)||q.length!==2)throw Error('固定底板坐标无效');return [finite(q[0],0,500),finite(q[1],0,500)];});});
  const b=v.base||{},base={x:finite(b.x,0,500),y:finite(b.y,0,500),w:finite(b.w,10,420),h:finite(b.h,10,420),margin:finite(b.margin??0,0,30)};
  return {version:1,name:String(v.name||'定位底板').slice(0,48),machine,base,paths,width:finite(v.width,.1,100),spacing:finite(v.spacing,5,50),cellNumbers:v.cellNumbers===true,paperColor:color(v.paperColor,'#fffdf4'),inkColor:color(v.inkColor,'#426852')};
 }
 function library(entries){if(!Array.isArray(entries))return [];return entries.slice(0,12).map(validate);}
 function capture(state,reachable,name){const a=A.settings(state),generated=state.alignmentReturn&&state.objects.length===1&&state.objects[0].type==='svg';return validate({name,machine:state.machine,base:generated?state.paper:a.base,paths:generated?C.objectPaths(state.objects[0],state.paper):A.grid(state,reachable).paths,width:state.pen.width,spacing:a.spacing,cellNumbers:a.cellNumbers,paperColor:a.paperColor,inkColor:generated?state.objects[0].color:a.inkColor});}
 function resolve(state){const b=state.backing;return b&&key(b.machine)===key(state.machine)&&state.alignment?.visible!==false&&!state.alignmentReturn?b:null;}
 // Only fixed snapshots are restored. Draft grid parameters never overwrite one.
 function sync(state,storage){if(state.backing&&key(state.backing.machine)===key(state.machine))return;delete state.backing;try{const saved=library(JSON.parse(storage.getItem(STORE)||'[]')).find(b=>key(b.machine)===key(state.machine));if(saved)state.backing=saved;}catch{}}
 root.PenBacking={STORE,key,color,validate,library,capture,resolve,sync};if(typeof module!=='undefined')module.exports=root.PenBacking;
})(typeof window!=='undefined'?window:globalThis);
