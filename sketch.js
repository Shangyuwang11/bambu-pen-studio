/* Local grayscale-to-pen algorithms, implemented without remote services.
   Paths are physical millimeters; density is independent of image resolution. */
(function(root){
 'use strict';
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function blur(gray,w,h){const tmp=new Float32Array(gray.length),out=new Float32Array(gray.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)tmp[y*w+x]=(gray[y*w+Math.max(0,x-1)]+2*gray[y*w+x]+gray[y*w+Math.min(w-1,x+1)])/4;for(let y=0;y<h;y++)for(let x=0;x<w;x++)out[y*w+x]=(tmp[Math.max(0,y-1)*w+x]+2*tmp[y*w+x]+tmp[Math.min(h-1,y+1)*w+x])/4;return out;}
 function sampler(gray,w,h,W,H){return(x,y)=>{const px=clamp(x/W*(w-1),0,w-1),py=clamp(y/H*(h-1),0,h-1),a=Math.floor(px),b=Math.floor(py),u=px-a,v=py-b;return (gray[b*w+a]*(1-u)+gray[b*w+Math.min(w-1,a+1)]*u)*(1-v)+(gray[Math.min(h-1,b+1)*w+a]*(1-u)+gray[Math.min(h-1,b+1)*w+Math.min(w-1,a+1)]*u)*v;};}
 function edges(gray,w,h,threshold){
   const g=blur(gray,w,h),m=new Float32Array(g.length),dir=new Uint8Array(g.length),thin=new Float32Array(g.length);
   for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,gx=-g[i-w-1]+g[i-w+1]-2*g[i-1]+2*g[i+1]-g[i+w-1]+g[i+w+1],gy=-g[i-w-1]-2*g[i-w]-g[i-w+1]+g[i+w-1]+2*g[i+w]+g[i+w+1];m[i]=Math.hypot(gx,gy);dir[i]=Math.round((Math.atan2(gy,gx)+Math.PI)*4/Math.PI)%4;}
   const offsets=[1,w+1,w,w-1];for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,d=offsets[dir[i]];if(m[i]>=m[i-d]&&m[i]>m[i+d])thin[i]=m[i];}
   const high=clamp(110*150/threshold,45,240),low=high*.4,mask=new Uint8Array(g.length),stack=[];
   for(let i=0;i<thin.length;i++)if(thin[i]>=high){mask[i]=1;stack.push(i);}
   while(stack.length){const i=stack.pop(),x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,j=ny*w+nx;if(nx>0&&nx<w-1&&ny>0&&ny<h-1&&!mask[j]&&thin[j]>=low){mask[j]=1;stack.push(j);}}}
   return mask;
 }
 function hatching(gray,w,h,W,H,gap,threshold,strokeWidth=0){
   const sample=sampler(blur(gray,w,h),w,h,W,H),paths=[],diagonal=Math.hypot(W,H),step=Math.min(.25,gap/2);
   // Increasing darkness adds directions; smoothing and minimum stroke length
   // suppress isolated pixel noise without drawing bridges over white gaps.
   for(const [angle,cut] of [[-Math.PI/4,.13],[Math.PI/4,.42],[0,.7]]){const dx=Math.cos(angle),dy=Math.sin(angle),nx=-dy,ny=dx;let row=0;
     for(let offset=-diagonal;offset<=diagonal;offset+=gap,row++){const origin=[W/2+nx*offset,H/2+ny*offset];let lo=-Infinity,hi=Infinity;
       for(const [p,d,max] of [[origin[0],dx,W],[origin[1],dy,H]]){if(Math.abs(d)<1e-9){if(p<0||p>max){lo=1;hi=0;break;}}else{const a=-p/d,b=(max-p)/d;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}}
       if(hi<=lo)continue;let first=null,last=null;const lines=[],count=Math.ceil((hi-lo)/step);
       const finish=()=>{if(first&&last&&Math.hypot(last[0]-first[0],last[1]-first[1])>=Math.max(.35,gap*.5))lines.push([first,last]);first=last=null;};
       for(let k=0;k<=count;k++){const t=lo+(hi-lo)*k/count,p=[clamp(origin[0]+dx*t,0,W),clamp(origin[1]+dy*t,0,H)],dark=clamp((255-sample(...p))/255*threshold/150,0,1),passes=dark>=.7?3:dark>=.42?2:1,coverage=1-Math.pow(1-dark,1/passes),fraction=strokeWidth?clamp(coverage*gap/strokeWidth,0,1):1,rank=(row*.61803398875+cut)%1;if(dark>=cut&&rank<fraction){if(!first)first=p;last=p;}else finish();}finish();
       if(row%2)lines.reverse().forEach(p=>p.reverse());paths.push(...lines);
     }
   }
   return paths;
 }
 function wave(gray,w,h,W,H,gap,threshold,strokeWidth=0){
   if(!gray.some(v=>v<245))return[];
   const sample=sampler(blur(gray,w,h),w,h,W,H),path=[],count=Math.max(2,Math.ceil(W/Math.min(.2,gap/6))),rows=Math.max(1,Math.floor(H/gap));
   if((count+1)*rows>145000)throw Error('连续线太密，请增大排线间距或缩小图案（建议从 0.8 mm 开始）');
   for(let row=0;row<rows;row++){const y=(row+.5)*H/rows;for(let k=0;k<=count;k++){const x=W*(row%2?count-k:k)/count,dark=clamp((255-sample(x,y))/255*threshold/150,0,1),taper=Math.min(1,x/gap,(W-x)/gap),amplitude=Math.max(0,Math.min(.44*gap,(gap-strokeWidth*1.2)/2))*dark*taper;path.push([x,clamp(y+amplitude*Math.sin(x/gap*Math.PI),0,H)]);}}
   return[path];
 }
 root.PenSketch={blur,edges,hatching,wave};if(typeof module!=='undefined')module.exports=root.PenSketch;
})(typeof window!=='undefined'?window:globalThis);
