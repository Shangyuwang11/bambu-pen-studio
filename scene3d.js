/* Offline 3D orthographic preview. All units are mm; camera controls never move hardware. */
(function(root){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function projection(w,h,width,height,yaw=-.38,pitch=.95,zoom=1){
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const raw=([x,y,z=0])=>{x-=w/2;y-=h/2;const a=cy*x-sy*y,b=sy*x+cy*y;return [a,b*cp-z*sp,b*sp+z*cp];};
  const corners=[[0,0,0],[w,0,0],[w,h,0],[0,h,0],[w/2,h/2,105]].map(raw),xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.max(.1,Math.min((width-90)/(maxX-minX+30),(height-110)/(maxY-minY+20)))*zoom;
  return {scale,point:p=>{const v=raw(p);return [width/2+(v[0]-(minX+maxX)/2)*scale,height/2+(v[1]-(minY+maxY)/2)*scale,v[2]];}};
 }
 function create(canvas,onCamera=()=>{}){
  const ctx=canvas.getContext('2d'),base=document.createElement('canvas'),ink=document.createElement('canvas');let yaw=-.38,pitch=.95,zoom=1,drag=null,last=null,cacheKey='',lastModel=null,drawn=-1,width=0,height=0,dpr=1,P,scale;
  function size(){const r=canvas.getBoundingClientRect(),ratio=Math.min(2,devicePixelRatio||1);if(r.width!==width||r.height!==height||dpr!==ratio){width=r.width;height=r.height;dpr=ratio;for(const c of [canvas,base,ink]){c.width=Math.round(width*dpr);c.height=Math.round(height*dpr);}cacheKey='';}}
  function context(c){c.setTransform(dpr,0,0,dpr,0,0);c.lineJoin='round';c.lineCap='round';}
  function poly(c,points,fill,stroke,line=1){c.beginPath();points.forEach((p,i)=>{const q=P(p);i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]);});c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=line;c.stroke();}}
  function line(c,a,b,color,lineWidth=1,dash=[]){const x=P(a),y=P(b);c.beginPath();c.moveTo(x[0],x[1]);c.lineTo(y[0],y[1]);c.strokeStyle=color;c.lineWidth=lineWidth;c.setLineDash(dash);c.stroke();c.setLineDash([]);}
  function label(c,text,p,color='#7b8d92',align='center'){const q=P(p);c.font='11px "Segoe UI","Microsoft YaHei",sans-serif';c.fillStyle=color;c.textAlign=align;c.fillText(window.PenI18n?.t(text)||text,q[0],q[1]);}
  const rect=(p,z=0)=>[[p.x,p.y,z],[p.x+p.w,p.y,z],[p.x+p.w,p.y+p.h,z],[p.x,p.y+p.h,z]];
  function foundation(data){const {state,model}=data,c=base.getContext('2d'),{w,h}=state.machine;context(c);c.clearRect(0,0,width,height);const camera=projection(w,h,width,height,yaw,pitch,zoom);P=camera.point;scale=camera.scale;
   const board={x:0,y:0,w,h},plate=root.PenAlignment?.plate(state.machine),top=plate?plate.points.map(p=>[...p,0]):rect(board),bottom=top.map(p=>[p[0],p[1],-5]);c.shadowColor='#142d3426';c.shadowBlur=24;c.shadowOffsetY=18;poly(c,bottom,'#3e4f59');c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetY=0;
   for(let i=0;i<top.length;i++){const j=(i+1)%top.length;poly(c,[top[i],top[j],bottom[j],bottom[i]],i%2?'#53616c':'#46535e');}
   poly(c,top,state.machine.plate==='textured'?'#766f60':'#64717a','#83939a');
   for(let x=10;x<w;x+=10)line(c,[x,0,0],[x,h,0],'#a5b4b92e',.6);for(let y=10;y<h;y+=10)line(c,[0,y,0],[w,y,0],'#a5b4b92e',.6);
   if(plate)for(const hole of plate.holes)poly(c,hole.map(p=>[...p,.01]),'#e9eee5');
   const backing=root.PenBacking.resolve(state);
   if(backing){poly(c,rect(backing.base,.1),backing.paperColor,'#d4decb',.6);for(const p of backing.paths)for(let i=1;i<p.length;i++)line(c,[...p[i-1],.12],[...p[i],.12],backing.inkColor,backing.width*scale);}
   else if(state.alignment&&state.alignment.visible&&!state.alignmentReturn){const a=root.PenAlignment.settings(state);poly(c,rect(a.base,.1),a.paperColor,'#d4decb',.6);try{for(const p of root.PenAlignment.grid(state,model.reachable).paths)for(let i=1;i<p.length;i++)line(c,[...p[i-1],.12],[...p[i],.12],a.inkColor,state.pen.width*scale);}catch{}}
   const paper=state.paper;c.shadowColor='#15292f22';c.shadowBlur=9;c.shadowOffsetY=3;poly(c,rect(paper,.2),backing?'#fffdf8b3':state.alignmentReturn?root.PenAlignment.settings(state).paperColor:'#fffdf8','#e0ddd1',.8);c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetY=0;
   if(paper.w>paper.margin*2&&paper.h>paper.margin*2){c.setLineDash([4,4]);poly(c,rect({x:paper.x+paper.margin,y:paper.y+paper.margin,w:paper.w-paper.margin*2,h:paper.h-paper.margin*2},.25),null,'#c0cfc5',.7);c.setLineDash([]);}
   const area=model.reachable;if(area){const unavailable=[{x:0,y:0,w,h:area.y},{x:0,y:area.y+area.h,w,h:h-area.y-area.h},{x:0,y:area.y,w:area.x,h:area.h},{x:area.x+area.w,y:area.y,w:w-area.x-area.w,h:area.h}];for(const r of unavailable)if(r.w>.001&&r.h>.001)poly(c,rect(r,.3),'#df9b3c35');}
   const lw=Math.max(.75,state.pen.width*scale);for(const path of data.paths){if(data.active&&path.render)continue;c.beginPath();path.points.forEach((p,i)=>{const q=P([...p,.4]);i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]);});c.strokeStyle=data.active?'#809c9340':path.color;c.lineWidth=path.render?path.render.width*scale:lw;c.globalAlpha=path.render?path.render.opacity:1;c.stroke();c.globalAlpha=1;}
   if(data.travel)for(const s of model.segments)if(s.kind==='travel'){line(c,[s.a[0],s.a[1],.5],[s.b[0],s.b[1],.5],'#c2955c66',.8,[3,4]);}
   const tick=w>300?50:30;for(let x=0;x<=w;x+=tick)label(c,String(x),[x,-7,0]);for(let y=0;y<=h;y+=tick)label(c,String(y),[-7,y,0],'#7b8d92','right');label(c,'后方 / BACK',[w/2,-18,0]);label(c,'前方 / FRONT · '+w+' × '+h+' mm',[w/2,h+14,0]);
   line(c,[0,h+6,0],[25,h+6,0],'#b46458',2);line(c,[0,h+6,0],[0,h-19,0],'#548477',2);line(c,[0,h+6,0],[0,h+6,25],'#6186b4',2);label(c,'X',[29,h+6,0],'#b46458');label(c,'Z',[0,h+6,29],'#6186b4');
   context(ink.getContext('2d'));ink.getContext('2d').clearRect(0,0,width,height);drawn=-1;
  }
  function pen(at,data){const [x,y,z]=at,faces=[],visualZ=Math.max(0,z)*(data.exaggerate?4:1),baseZ=visualZ+.6;
   const ring=(radius,height)=>Array.from({length:18},(_,i)=>[x+Math.cos(i*Math.PI/9)*radius,y+Math.sin(i*Math.PI/9)*radius,baseZ+height]);
   function frustum(a,b,ra,rb,colors){const low=ring(ra,a),high=ring(rb,b);for(let i=0;i<18;i++){const j=(i+1)%18,points=[low[i],low[j],high[j],high[i]];faces.push({points,color:colors[i%colors.length],depth:points.reduce((n,p)=>n+P(p)[2],0)/4});}faces.push({points:high,color:colors[0],depth:high.reduce((n,p)=>n+P(p)[2],0)/18});}
   const q=P([x,y,.6]);ctx.save();ctx.translate(q[0],q[1]);ctx.scale(1,.5);ctx.fillStyle='#1c3f4930';ctx.beginPath();ctx.arc(0,0,Math.max(5,6*scale),0,Math.PI*2);ctx.fill();ctx.restore();
   if(z>.03)line(ctx,[x,y,.6],[x,y,baseZ],'#bb944b',1,[3,4]);
   frustum(0,3,.25,1.25,['#37434a','#69777d','#a1abb1']);frustum(3,10,1.25,3.2,['#cbd0cb','#e0e3dc','#9ca9a9']);frustum(10,57,3.2,3.2,['#315f5c','#426f68','#234c4d','#5c8b7d']);frustum(57,61,3.45,3.45,['#d0c293','#f2e6c5','#a59b7e']);frustum(61,68,3.2,2.7,['#24494a','#3d6963','#183b40']);
   faces.sort((a,b)=>a.depth-b.depth);for(const f of faces)poly(ctx,f.points,f.color);
   if(data.holder&&data.model.profile){const p=data.model.profile,mx=p.machineX+p.xSign*(x-p.refX),my=p.machineY+p.ySign*(y-p.refY),nozzle=[mx,data.state.machine.h-my,baseZ+Math.max(8,p.downZ)];line(ctx,[x,y,baseZ+30],[nozzle[0],nozzle[1],baseZ+30],'#8b969b99',4);line(ctx,nozzle,[nozzle[0],nozzle[1],baseZ+43],'#6b7a8199',5);label(ctx,'喷嘴参考', [nozzle[0],nozzle[1],baseZ+49],'#819096');}
   const color=z>.03?'#ac833c':'#278c6d';ctx.fillStyle=color;ctx.beginPath();ctx.arc(...P([x,y,baseZ]).slice(0,2),2.5,0,Math.PI*2);ctx.fill();
  }
  function naturalStroke(c,segments,start,end,partial){const s=segments[start],first=P([...s.a.slice(0,2),.5]);c.beginPath();c.moveTo(first[0],first[1]);for(let i=start;i<=end;i++){const q=P([...(partial&&i===end?partial:segments[i].b).slice(0,2),.5]);c.lineTo(q[0],q[1]);}c.strokeStyle=s.color;c.lineWidth=s.render.width*scale;c.globalAlpha=s.render.opacity;c.stroke();c.globalAlpha=1;}
  function render(data){last=data;size();if(!width||!height)return;const key=[yaw,pitch,zoom,width,height,dpr,data.active,data.travel,JSON.stringify(data.state.paper),JSON.stringify(data.state.alignment),JSON.stringify(data.state.backing),!!data.state.alignmentReturn,data.state.machine.plate].join('|');if(cacheKey!==key||lastModel!==data.model){cacheKey=key;lastModel=data.model;foundation(data);}context(ctx);ctx.clearRect(0,0,width,height);ctx.drawImage(base,0,0,width,height);
   const pose=root.PenTrajectory.sample(data.model,data.active?data.elapsed:0),segments=data.model.segments,c=ink.getContext('2d');context(c);
   if(data.active&&pose){if(pose.index<drawn){c.clearRect(0,0,width,height);drawn=-1;}let i=drawn+1;for(;i<pose.index;i++){const s=segments[i];if(s.kind!=='draw')continue;if(s.render){let end=i;while(segments[end+1]?.kind==='draw'&&segments[end+1].stroke===s.stroke)end++;if(end>=pose.index)break;naturalStroke(c,segments,i,end);i=end;}else line(c,[s.a[0],s.a[1],.5],[s.b[0],s.b[1],.5],s.color,Math.max(.8,data.state.pen.width*scale));}drawn=i-1;ctx.drawImage(ink,0,0,width,height);if(pose.segment.kind==='draw'){if(pose.segment.render){let start=pose.index;while(start>0&&segments[start-1].kind==='draw'&&segments[start-1].stroke===pose.segment.stroke)start--;naturalStroke(ctx,segments,start,pose.index,pose.point);}else line(ctx,[pose.segment.a[0],pose.segment.a[1],.5],[pose.point[0],pose.point[1],.5],pose.segment.color,Math.max(.8,data.state.pen.width*scale));}}
   const at=pose?.point||data.model.boardStart;pen(at,data);return {point:at,pose,camera:{yaw,pitch,zoom},scale};
  }
  function redraw(){cacheKey='';if(last)render(last);onCamera({yaw,pitch,zoom});}
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,yaw,pitch};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw=drag.yaw+(e.clientX-drag.x)*.006;pitch=clamp(drag.pitch-(e.clientY-drag.y)*.004,.42,1.45);redraw();});const release=()=>{drag=null;};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=clamp(zoom*(e.deltaY>0?.91:1.1),.55,2.5);redraw();},{passive:false});canvas.addEventListener('dblclick',()=>{yaw=-.38;pitch=.95;zoom=1;redraw();});
  return {render,reset(){yaw=-.38;pitch=.95;zoom=1;redraw();},getCamera:()=>({yaw,pitch,zoom}),project:p=>P?.(p)};
 }
 root.PenScene3D={create,projection};if(typeof module!=='undefined')module.exports=root.PenScene3D;
})(typeof window!=='undefined'?window:globalThis);
