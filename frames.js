(function(root){'use strict';
 const styles={solid:'单线框',dashed:'虚线框',double:'双线框',corners:'角标框',scallop:'波浪花边',deco:'装饰画框'};
 function options(v={}){const out={style:v.style||'solid'};if(!styles[out.style])throw Error('边框样式无效');for(const[k,d,lo,hi]of [['spacing',2,.2,30],['dash',4,.2,50],['depth',2,.2,20],['pitch',10,2,50],['margin',3,0,50]]){const n=v[k]??d;if(!Number.isFinite(n)||n<lo||n>hi)throw Error('边框参数超出范围：'+k);out[k]=n;}return out;}
 function paths(w,h,value){const o=options(value);if(!Number.isFinite(w)||!Number.isFinite(h)||w<2||h<2||w>500||h>500)throw Error('边框宽高需为 2–500 mm');const out=[],rect=d=>[[d,d],[w-d,d],[w-d,h-d],[d,h-d],[d,d]];
  if(o.style==='solid')out.push(rect(0));
  if(o.style==='double'||o.style==='deco'){if(o.spacing*2>=Math.min(w,h))throw Error('边框太小，需减小双线间距');out.push(rect(0),rect(o.spacing));}
  const corners=[[0,0],[w,0],[w,h],[0,h]];
  for(let e=0;e<4;e++){const a=corners[e],b=corners[(e+1)%4],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),point=(t,d=0)=>[a[0]+dx*t-dy/len*d,a[1]+dy*t+dx/len*d];
   if(o.style==='dashed')for(let d=0;d<len;d+=o.dash+o.spacing)out.push([point(d/len),point(Math.min(len,d+o.dash)/len)]);
   if(o.style==='corners'){const arm=Math.min(o.dash,len*.4);out.push([point(0),point(arm/len)],[point(1-arm/len),point(1)]);}
   if(o.style==='scallop'){const count=Math.max(1,Math.round(len/o.pitch)),depth=Math.min(o.depth,Math.min(w,h)/4),p=[];for(let i=0;i<=count*16;i++){const t=i/(count*16);p.push(point(t,depth*(1-Math.cos(t*count*2*Math.PI))/2));}out.push(p);}
   if(o.style==='deco'){const count=Math.max(1,Math.floor(len/o.pitch)),size=Math.min(o.spacing*.4,len/(count*4));for(let i=0;i<count;i++){const d=len*(i+.5)/count;out.push([point((d-size)/len,o.spacing/2),point(d/len,o.spacing/2-size),point((d+size)/len,o.spacing/2),point(d/len,o.spacing/2+size),point((d-size)/len,o.spacing/2)]);}}
  }
  return out.map(p=>p.map(([x,y])=>[x/w,y/h]));
 }
 root.PenFrames={styles,options,paths};if(typeof module!=='undefined')module.exports=root.PenFrames;
})(typeof window!=='undefined'?window:globalThis);
