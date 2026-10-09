/* Plate coordinates are design coordinates: origin at printable area's rear-left,
   +X right, +Y toward the front. The physical outline never extends motion limits. */
(function(root){'use strict';
 const C=root.PenCore||(typeof require==='function'?require('./core.js'):null);
 const data=root.PenPlateOutlines||(typeof require==='function'?require('./assets/plates/outlines.js'):{});
 const rect=r=>[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]];
 function plate(machine){const model=machine.model==='a1-mini'?data.A1M:['a1','p1s'].includes(machine.model)?data.X1:null;return model||{points:rect({x:0,y:0,w:machine.w,h:machine.h}),holes:[],source:null};}
 function defaults(machine){return {spacing:10,visible:true,snap:false,cellNumbers:true,paperColor:'#fffdf4',inkColor:'#426852',base:{x:0,y:0,w:Math.min(machine.w,420),h:Math.min(machine.h,420),margin:1}};}
 function normalize(value,machine){const d=defaults(machine);if(value==null)return d;
  const num=(n,lo,hi)=>{if(!Number.isFinite(n)||n<lo||n>hi)throw Error('定位底板参数无效');return n;},p=value.base||d.base;
  const spacing=num(value.spacing??10,5,50);if(!Number.isInteger(spacing))throw Error('网格间距请使用整数毫米');
  const color=(v,f)=>/^#[\da-f]{6}$/i.test(v||'')?v:f;
  return {spacing,cellNumbers:value.cellNumbers===true,paperColor:color(value.paperColor,d.paperColor),inkColor:color(value.inkColor,d.inkColor),visible:value.visible!==false,snap:value.snap===true,base:{x:num(p.x,0,500),y:num(p.y,0,500),w:num(p.w,10,420),h:num(p.h,10,420),margin:num(p.margin??1,0,30)}};
 }
 function settings(state){return normalize(state.alignment,state.machine);}
 const glyphs={0:[[[0,0],[1,0],[1,2],[0,2],[0,0]]],1:[[[.3,.4],[.65,0],[.65,2]],[[.2,2],[1,2]]],2:[[[0,0],[1,0],[1,1],[0,1],[0,2],[1,2]]],3:[[[0,0],[1,0],[1,2],[0,2]],[[0,1],[1,1]]],4:[[[0,0],[0,1],[1,1]],[[1,0],[1,2]]],5:[[[1,0],[0,0],[0,1],[1,1],[1,2],[0,2]]],6:[[[1,0],[0,0],[0,2],[1,2],[1,1],[0,1]]],7:[[[0,0],[1,0],[.3,2]]],8:[[[0,1],[0,0],[1,0],[1,2],[0,2],[0,1],[1,1]]],9:[[[1,1],[0,1],[0,0],[1,0],[1,2],[0,2]]],'.':[[[.4,1.9],[.5,2]]],X:[[[0,0],[1,2]],[[1,0],[0,2]]],Y:[[[0,0],[.5,1],[1,0]],[[.5,1],[.5,2]]]};
 function lettering(text,x,y,size){const paths=[];[...String(text)].forEach((ch,i)=>{for(const p of glyphs[ch]||[])paths.push(p.map(([a,b])=>[x+(a+i*1.45)*size/2,y+b*size/2]));});return paths;}
 function grid(state,reachable){const cfg=settings(state),p=cfg.base,m=p.margin,board=C.board(state);
  // A backing template has its own edge clearance. Ordinary artwork margins
  // remain in the saved project; they must not add an invisible second border.
  const box=C.intersectRects([{x:p.x+m,y:p.y+m,w:p.w-2*m,h:p.h-2*m},board,...(reachable?[reachable]:[])],state.pen.width/2+.1);
  if(!box||box.w<15||box.h<15)throw Error('底纸与笔的可写范围交集太小，请调整底纸位置或笔架参数');
  const step=cfg.spacing,size=Math.min(2.4,step*.32),r=box.x+box.w,b=box.y+box.h;
  const x0=Math.ceil(box.x/step)*step,y0=Math.ceil(box.y/step)*step,x1=Math.floor(r/step)*step,y1=Math.floor(b/step)*step;
  if(x1-x0<step||y1-y0<step)throw Error('当前底纸放不下这个间距的网格，请减小网格间距或增大底纸');
  const lines=[],labels=[],ticks=[],labelBoxes=[],cells=[];
  function label(t,x,y){const width=(t.length*1.45-.45)*size/2;if(x+width>r-.3||y+size>b-.3)return;labels.push(...lettering(t,x,y,size));labelBoxes.push({x:x-.25,y:y-.25,w:width+.5,h:size+.5});}
  for(let x=x0;x<=x1+1e-7;x+=step){x=C.round(x);lines.push([[x,box.y],[x,b]]);label(String(x),x+.7,box.y+.7);ticks.push({axis:'x',value:x});}
  for(let y=y0;y<=y1+1e-7;y+=step){y=C.round(y);lines.push([[box.x,y],[r,y]]);label(String(y),box.x+.7,y+.7);ticks.push({axis:'y',value:y});}
  if(cfg.cellNumbers){const cols=Math.ceil(state.machine.w/step);for(let y=y0;y<y1;y+=step)for(let x=x0;x<x1;x+=step){const number=Math.round(y/step)*cols+Math.round(x/step)+1,t=String(number),width=(t.length*1.45-.45)*size/2,cx=x+step/2,cy=y+step/2;label(t,cx-width/2,cy-size/2);cells.push({number,x,y});}}
  // Leave small breaks beneath the inside labels, instead of reserving a large
  // empty numbering gutter. Grid coordinates still use the common board origin.
  let ink=lines;for(const q of labelBoxes){const split=[];for(const [a,c]of ink){if(a[0]===c[0]&&a[0]>q.x&&a[0]<q.x+q.w){if(q.y>a[1])split.push([a,[a[0],Math.min(c[1],q.y)]]);if(q.y+q.h<c[1])split.push([[a[0],Math.max(a[1],q.y+q.h)],c]);}else if(a[1]===c[1]&&a[1]>q.y&&a[1]<q.y+q.h){if(q.x>a[0])split.push([a,[Math.min(c[0],q.x),a[1]]]);if(q.x+q.w<c[0])split.push([[Math.max(a[0],q.x+q.w),a[1]],c]);}else split.push([a,c]);}ink=split;}
  const border=rect(box);const paths=[[...border,border[0]],...ink,...labels];
  // All label strokes stay inside the same physical paper and allowed rectangle.
  const clipped=paths.flatMap(p=>C.clipPolyline(p,box));
  return {paths:clipped,lines,labels,ticks,cells,box,rect:{...box},spacing:step};
 }
 function project(state,reachable){const g=grid(state,reachable),cfg=settings(state),p=cfg.base;
  const original=state.alignmentReturn||state,{alignmentReturn:unused,...saved}=original;
  return C.validateProject({...state,alignment:cfg,alignmentReturn:saved,paper:{...p},safe:C.board(state),objects:[{id:C.uid(),type:'svg',name:'定位底板 · '+cfg.spacing+' mm 网格',x:0,y:0,w:p.w,h:p.h,rotation:0,color:cfg.inkColor,preserveStrokes:true,paths:g.paths.map(path=>path.map(([x,y])=>[(x-p.x)/p.w,(y-p.y)/p.h]))}]});
 }
 function restore(state){if(!state.alignmentReturn)throw Error('没有待恢复的作品');return C.validateProject({...state.alignmentReturn,alignment:settings(state),...(state.backing?{backing:state.backing}:{})});}
 const pathD=(p,close=false)=>p.map((v,i)=>(i?'L':'M')+v.map(C.round).join(' ')).join(' ')+(close?' Z':'');
 function svg(state,reachable){const p=plate(state.machine),g=grid(state,reachable),bb=C.bounds([p.points,rect(settings(state).base)]),pad=4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C.round(bb.w+pad*2)}mm" height="${C.round(bb.h+pad*2)}mm" viewBox="${C.round(bb.x-pad)} ${C.round(bb.y-pad)} ${C.round(bb.w+pad*2)} ${C.round(bb.h+pad*2)}"><title>定位底板 · 100% 实际尺寸 · X 向右，Y 向前</title><desc>灰色虚线为板形参考，不是机器绘画路径。打印时选择实际大小，不缩放。</desc><g fill="none" stroke="#999" stroke-width="0.2" stroke-dasharray="1 1"><path d="${pathD(p.points,true)}"/>${p.holes.map(h=>`<path d="${pathD(h,true)}"/>`).join('')}</g><g fill="none" stroke="${settings(state).inkColor}" stroke-width="${state.pen.width}" stroke-linejoin="round" stroke-linecap="round">${g.paths.map(v=>`<path d="${pathD(v)}"/>`).join('')}</g></svg>`;
 }
 root.PenAlignment={plate,defaults,normalize,settings,grid,project,restore,svg,pathD,rect};if(typeof module!=='undefined')module.exports=root.PenAlignment;
})(typeof window!=='undefined'?window:globalThis);
