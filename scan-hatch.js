/* Straight, physical-scale scanline hatching. No printer or image I/O. */
(function(root){'use strict';
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 // Sliding-window blur keeps work bounded even for small physical images.
 function blurAxis(input,w,h,r,vertical){
  r=Math.min(Math.ceil(r),vertical?h-1:w-1);if(r<1)return input;
  const out=new Float32Array(input.length),n=vertical?h:w,lines=vertical?w:h;
  for(let j=0;j<lines;j++){
   const at=i=>vertical?clamp(i,0,n-1)*w+j:j*w+clamp(i,0,n-1);let sum=0;
   for(let k=-r;k<=r;k++)sum+=input[at(k)];
   for(let i=0;i<n;i++){out[at(i)]=sum/(2*r+1);sum+=input[at(i+r+1)]-input[at(i-r)];}
  }return out;
 }
 function render(gray,w,h,{width:W,height:H,gap=.8,strokeWidth=.5,threshold=150,cleanup=2}={}){
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||w>1024||h>1024||gray.length!==w*h||!gray.every(v=>Number.isFinite(v)&&v>=0&&v<=255)||![W,H,gap,strokeWidth,threshold,cleanup].every(Number.isFinite)||W<1||H<1||W>500||H>500||gap<.3||strokeWidth<.1||cleanup<0||threshold<0||threshold>255)throw Error('扫描排线参数无效');
  const strength=Math.min(cleanup,30),radiusMm=strokeWidth*(.45+.22*strength),minLength=Math.max(strokeWidth*3,.35+strength*.3);
  const pitch=Math.max(gap,strokeWidth*2.2),step=Math.min(.15,Math.max(.025,strokeWidth/2)),joinGap=Math.min(strokeWidth,.25),paths=[];
  const softened=cleanup>0?blurAxis(blurAxis(gray,w,h,radiusMm*w/W,false),w,h,radiusMm*h/H,true):gray;
  function sample(data,x,y){const fx=clamp(x/W*w-.5,0,w-1),fy=clamp(y/H*h-.5,0,h-1),ix=Math.floor(fx),iy=Math.floor(fy),xx=Math.min(ix+1,w-1),yy=Math.min(iy+1,h-1),a=fx-ix,b=fy-iy;return (data[iy*w+ix]*(1-a)+data[iy*w+xx]*a)*(1-b)+(data[yy*w+ix]*(1-a)+data[yy*w+xx]*a)*b;}
  // A fixed threshold per row avoids per-pixel stochastic dots. Darker bands
  // add two further directions; all output strokes have exactly two endpoints.
  let samples=0;
  for(const [angle,base,range]of [[0,.065,.34],[Math.PI/4,.36,.31],[-Math.PI/4,.65,.29]]){
   const dx=Math.cos(angle),dy=Math.sin(angle),nx=-dy,ny=dx;
   const corners=[[0,0],[W,0],[0,H],[W,H]],offsets=corners.map(([x,y])=>x*nx+y*ny),low=Math.min(...offsets),high=Math.max(...offsets);
   let row=0;
   for(let offset=low+pitch/2;offset<high;offset+=pitch,row++){
    const ox=nx*offset,oy=ny*offset;let lo=-Infinity,hi=Infinity;
    for(const [origin,direction,size]of [[ox,dx,W],[oy,dy,H]]){
     if(Math.abs(direction)<1e-9){if(origin<0||origin>size){hi=-Infinity;break;}}
     else{const a=-origin/direction,b=(size-origin)/direction;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}
    }
    if(hi-lo<minLength)continue;
    const cut=base+range*((row*.618033988749895+.5)%1),gain=threshold/150;
    let start=null,last=null,gapAt=null;
    const point=t=>[clamp(ox+dx*t,0,W),clamp(oy+dy*t,0,H)];
    const finish=()=>{if(start!==null&&last-start>=minLength){const p=[point(start),point(last)];paths.push(row%2?p.reverse():p);if(paths.length>20000)throw Error('扫描排线路径过多，请增大间距或去碎线强度');}start=last=gapAt=null;};
    const count=Math.ceil((hi-lo)/step);
    for(let i=0;i<=count;i++){
     if(++samples>16000000)throw Error('扫描排线计算量过大，请减小图幅或增大间距');
     const t=lo+(hi-lo)*i/count,[x,y]=point(t),dark=(1-sample(softened,x,y)/255)*gain;
     if(start===null){if(dark>cut+.015)start=last=t;continue;}
     if(dark>Math.max(.01,cut-.015)){last=t;gapAt=null;}
     else{if(gapAt===null)gapAt=t;if(t-gapAt>=joinGap||sample(gray,x,y)>=245)finish();}
    }finish();
   }
  }
  return paths;
 }
 root.PenScanHatch={render};if(typeof module!=='undefined')module.exports=root.PenScanHatch;
})(typeof self!=='undefined'?self:globalThis);
