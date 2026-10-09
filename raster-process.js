/* Pure image-to-path processing; no source image or network access. */
(function(root){'use strict';
 const G=root.PenRaster||(typeof require==='function'?require('./raster.js'):null),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function thresholdFor(gray){
  const hist=new Uint32Array(256);for(const g of gray)hist[Math.round(g)]++;
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let count=0,subtotal=0,best=-1,value=150;
  for(let i=0;i<255;i++){count+=hist[i];subtotal+=i*hist[i];if(!count||count===gray.length)continue;const a=subtotal/count,b=(sum-subtotal)/(gray.length-count),score=count*(gray.length-count)*(a-b)**2;if(score>best){best=score;value=i+1;}}
  return clamp(value,20,240);
 }
 function clean(mask,w,h,min){
  if(!min)return mask;const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length);
  for(let i=0;i<mask.length;i++)if(mask[i]&&!seen[i]){let read=0,write=1;queue[0]=i;seen[i]=1;while(read<write){const j=queue[read++],x=j%w,y=Math.floor(j/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,k=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[k]&&!seen[k]){seen[k]=1;queue[write++]=k;}}}if(write<=min)for(let j=0;j<write;j++)mask[queue[j]]=0;}return mask;
 }
 function render(gray,w,h,options={}){
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||w>1024||h>1024||gray.length!==w*h||!gray.every(v=>Number.isFinite(v)&&v>=0&&v<=255))throw Error('图像像素数据无效');
  const W=options.width??65,H=options.height??W*h/w,gap=options.gap??.8,threshold=options.autoThreshold?thresholdFor(gray):(options.threshold??150),cleanup=options.cleanup??2;
  if(![W,H,gap,threshold,cleanup].every(Number.isFinite)||W<1||H<1||W>500||H>500||gap<.3||threshold<0||threshold>255||cleanup<0)throw Error('图片转换参数超出范围');
  const strokeWidth=options.strokeWidth??options.brush?.strokeWidth??.5;if(!Number.isFinite(strokeWidth)||strokeWidth<.1)throw Error('实际笔触宽度无效');const effectiveGap=Math.max(gap,strokeWidth*(options.mode==='scan-hatch'?2.2:1.25));
  let mode=options.mode||'auto';const ink=gray.reduce((n,g)=>n+(g<threshold),0)/gray.length;if(mode==='auto')mode=ink>.4?'crosshatch':'skeleton';
  if(!['skeleton','outline','sketch','hatch','scan-hatch','crosshatch','wave','natural'].includes(mode))throw Error('未知的图片转换方式');
  let paths,natural=null;const S=root.PenSketch||(typeof require==='function'?require('./sketch.js'):null);
  if(mode==='natural'){
   const N=root.PenNaturalSketch||(typeof require==='function'?require('./natural-sketch.js'):null),O=root.PenNaturalOptions||(typeof require==='function'?require('./natural-sketch-options.js'):null);
   if(!N||!O)throw Error('自然素描模块未加载');
   const detail=options.detail??options.brush?.detail??640,b={...(options.brush??{})};if(b.detail!==undefined&&b.detail!==detail)for(const key of ['maxStrokes','maxPoints','budgetMs'])delete b[key];
   const brush=O.normalize({...b,detail,strokeWidth,penDarkness:1});
   const refined=['refined','grouped','tonalLoops'].includes(brush.style),engine=refined?(root.PenRefinedSketch||(typeof require==='function'?require('./sketch-refinement.js'):null)):N;
   if(!engine)throw Error('细化素描模块未加载');
   natural=engine.render(gray,w,h,{width:W,height:H,gap,brush,detail,rgba:options.rgba});paths=natural.paths;
   if(!Array.isArray(paths)||paths.length>50000||paths.reduce((n,p)=>n+(Array.isArray(p)?p.length:500001),0)>500000)throw Error('自然素描超出路径预算，请降低细节或密度');
   if(paths.some(p=>!Array.isArray(p)||p.length<2||p.some(q=>!Array.isArray(q)||q.length!==2||!q.every(Number.isFinite)||q[0]<-1e-7||q[0]>W+1e-7||q[1]<-1e-7||q[1]>H+1e-7)))throw Error('自然素描生成了无效或越界路径');
  }
  else if(mode==='scan-hatch')paths=(root.PenScanHatch||(typeof require==='function'?require('./scan-hatch.js'):null)).render(gray,w,h,{width:W,height:H,gap:effectiveGap,threshold,strokeWidth,cleanup});
  else if(['crosshatch','wave'].includes(mode))paths=S[mode==='wave'?'wave':'hatching'](gray,w,h,W,H,effectiveGap,threshold,strokeWidth);
  else if(mode==='hatch'){
   paths=[];const step=effectiveGap*h/H;let row=0;
   for(let y=step/2;y<h;y+=step,row++){let start=-1;for(let x=0;x<=w;x++){const g=x<w?gray[Math.floor(y)*w+x]:255,on=g<threshold&&(g<threshold*.38||(g<threshold*.72?row%2===0:row%3===0));if(on&&start<0)start=x;if(!on&&start>=0){paths.push((row%2?[[x,y],[start,y]]:[[start,y],[x,y]]).map(([xx,yy])=>[xx/w*W,yy/h*H]));start=-1;}}}
  }else{
   // Padding retains ink touching the image edges during skeleton thinning.
   const pw=w+2,ph=h+2,mask=new Uint8Array(pw*ph),input=mode==='sketch'?S.edges(gray,w,h,threshold):Uint8Array.from(gray,g=>g<threshold?1:0);
   for(let y=0;y<h;y++)mask.set(input.subarray(y*w,(y+1)*w),(y+1)*pw+1);clean(mask,pw,ph,cleanup);
   const offset=mode==='outline'?0:.5;
   paths=(mode==='outline'?G.outlines(mask,pw,ph):G.skeleton(mask,pw,ph)).map(p=>p.map(([x,y])=>[clamp((x-1+offset)/w*W,0,W),clamp((y-1+offset)/h*H,0,H)]));
  }
  paths=paths.filter(p=>p.length>=2&&p.some(q=>Math.hypot(q[0]-p[0][0],q[1]-p[0][1])>.0001));
  if(!paths.length)throw Error(mode==='natural'?'没有可画线条：可提高精细度或密度，并检查原图是否有笔迹；空白图片不会生成路径':'没有可画线条：可提高黑白阈值、减少去杂点，或选择另一种方式');
  if(paths.length>50000||paths.reduce((n,p)=>n+p.length,0)>(natural?500000:300000))throw Error('图案噪点或细节过多，请降低细节或增加去杂点');
  const P=root.PenPaths||(typeof require==='function'?require('./path-tools.js'):null);
  paths=P.optimize(paths.map(points=>({id:'raster',type:'image',points,...(mode==='scan-hatch'?{preserveStrokes:true}:natural?{preserveStrokes:true,...(['refined','grouped','tonalLoops'].includes(natural.brush.style)?{preserveOrder:true}:{})}:{})})),'quality').paths.map(p=>p.points);
  const points=paths.reduce((n,p)=>n+p.length,0);if(points>(natural?500000:150000)||paths.length>(natural?50000:20000))throw Error('路径过多，请降低细节、增大排线间距或增加去杂点');
  const length=paths.reduce((n,p)=>n+p.slice(1).reduce((m,q,i)=>m+Math.hypot(q[0]-p[i][0],q[1]-p[i][1]),0),0);
  const result={paths:paths.map(p=>p.map(([x,y])=>[clamp(x/W,0,1),clamp(y/H,0,1)])),ratio:w/h,mode,threshold,gap,strokeWidth,effectiveGap,algorithm:'opaque-ink-v2',width:W,height:H,cleanup,stats:{strokes:paths.length,points,length,inkFraction:ink}};
  if(natural){result.brush=natural.brush;result.warnings=natural.warnings||[];result.budget=natural.budget||null;result.model=natural.stats||{};result.algorithm='opaque-ink-v2';}
  return result;
 }
 function toSVG(result,width,height,penWidth=.35){
  if(![width,height,penWidth].every(Number.isFinite)||width<1||height<1||width>500||height>500||penWidth<.1||!result?.paths?.length)throw Error('SVG 参数无效');
  const fmt=n=>(Math.round(n*1000)/1000).toString();
  penWidth=result.strokeWidth??penWidth;const model=' stroke-opacity="1"';
  const lines=result.paths.map(p=>'<path d="'+p.map((q,i)=>{if(q.length!==2||!q.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('SVG 路径越界');return(i?'L':'M')+fmt(q[0]*width)+' '+fmt(q[1]*height);}).join(' ')+'"/>');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="'+fmt(width)+'mm" height="'+fmt(height)+'mm" viewBox="0 0 '+fmt(width)+' '+fmt(height)+'"><g fill="none" stroke="#000" stroke-width="'+fmt(penWidth)+'"'+model+' stroke-linecap="round" stroke-linejoin="round">\n'+lines.join('\n')+'\n</g></svg>';
 }
 root.PenRaster=Object.assign(G,{thresholdFor,clean,render,toSVG});if(typeof module!=='undefined')module.exports=root.PenRaster;
})(typeof self!=='undefined'?self:globalThis);
