/* Portable preparation for uploaded photos and sketches. No example-specific
 * crops, pretrained segmentation, browser canvas, or external dependencies.
 * Every detail curve follows a coherent image tangent, never a skeleton graph.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PenSketchRefinementInput=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PI=Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function blur(src,w,h,passes){
    let a=Float32Array.from(src);const tmp=new Float32Array(a.length),out=new Float32Array(a.length);
    const k=[1/16,4/16,6/16,4/16,1/16];
    for(let p=0;p<passes;p++){
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        let sum=0;for(let j=-2;j<=2;j++)sum+=a[y*w+clamp(x+j,0,w-1)]*k[j+2];tmp[y*w+x]=sum;
      }
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        let sum=0;for(let j=-2;j<=2;j++)sum+=tmp[clamp(y+j,0,h-1)*w+x]*k[j+2];out[y*w+x]=sum;
      }
      a=out.slice();
    }
    return a;
  }
  function nearest(a,reference){while(a-reference>PI/2)a-=PI;while(a-reference<-PI/2)a+=PI;return a;}
  function prepare(gray,sourceW,sourceH,options={}){
    if(!Number.isInteger(sourceW)||!Number.isInteger(sourceH)||sourceW<1||sourceH<1||sourceW>1024||sourceH>1024||!gray||gray.length!==sourceW*sourceH)
      throw Error('素描灰度图需为1–1024像素，数据长度必须匹配');
    for(let i=0;i<gray.length;i++)if(!Number.isFinite(gray[i])||gray[i]<0||gray[i]>255)throw Error('素描灰度值需为0–255的有限数字');
    const b=options.brush||{},rgba=options.rgba,warnings=[];
    if(rgba&&rgba.length!==gray.length*4)throw Error('素描彩色像素长度与灰度图不匹配');
    const mode=b.backgroundMode||'keep';
    if(!['keep','white','plant'].includes(mode))throw Error('未知素描背景方式');
    const cap=Math.max(32,Math.min(640,b.maxSide||480)),ratio=Math.min(1,cap/Math.max(sourceW,sourceH));
    const w=Math.max(4,Math.round(sourceW*ratio)),h=Math.max(4,Math.round(sourceH*ratio)),n=w*h;
    const mask=new Uint8Array(sourceW*sourceH);mask.fill(1);
    let plantUsed=mode==='plant'&&!!rgba;
    if(mode==='plant'&&!rgba)warnings.push('当前输入没有彩色像素；植物选区使用保留背景方式。');
    for(let i=0;i<mask.length;i++){
      if(gray[i]>=254.5||(rgba&&rgba[i*4+3]<128))mask[i]=0;
      if(plantUsed){const r=rgba[i*4],g=rgba[i*4+1],blue=rgba[i*4+2];mask[i]=(2*g-r-blue>37&&g-blue>32&&g-r>-35&&r<205)?1:0;}
    }
    if(mode==='white'){
      // Only near-white regions connected to the frame are background. White
      // highlights inside an object are retained by the same pure-paper rule.
      const queue=new Int32Array(mask.length),seen=new Uint8Array(mask.length);let head=0,tail=0;
      function push(i){if(!seen[i]&&gray[i]>=242){seen[i]=1;queue[tail++]=i;}}
      for(let x=0;x<sourceW;x++){push(x);push((sourceH-1)*sourceW+x);}
      for(let y=0;y<sourceH;y++){push(y*sourceW);push(y*sourceW+sourceW-1);}
      while(head<tail){const i=queue[head++],x=i%sourceW,y=Math.floor(i/sourceW);mask[i]=0;if(x)push(i-1);if(x+1<sourceW)push(i+1);if(y)push(i-sourceW);if(y+1<sourceH)push(i+sourceW);}
    }
    const L=new Float32Array(n),M=new Uint8Array(n),hist=new Uint32Array(256);let foreground=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const x0=Math.floor(x*sourceW/w),x1=Math.max(x0+1,Math.ceil((x+1)*sourceW/w));
      const y0=Math.floor(y*sourceH/h),y1=Math.max(y0+1,Math.ceil((y+1)*sourceH/h));
      let sum=0,count=0,supported=0;
      for(let sy=y0;sy<Math.min(sourceH,y1);sy++)for(let sx=x0;sx<Math.min(sourceW,x1);sx++){
        const i=sy*sourceW+sx;sum+=gray[i]/255;count++;supported+=mask[i];
      }
      const i=y*w+x;L[i]=sum/Math.max(1,count);
      // A protected source-paper gap must survive working-image reduction.
      M[i]=supported===count?255:0;
      if(M[i]){foreground++;hist[clamp(Math.round(L[i]*255),0,255)]++;}
    }
    function quantile(p){let total=0;for(let i=0;i<256;i++){total+=hist[i];if(total>=foreground*p)return i/255;}return 1;}
    const low=quantile(.03),high=quantile(.95),expandPlant=plantUsed&&high-low>.12;
    const black=expandPlant?low:Math.min(.18,low),white=expandPlant?high:Math.max(.9,quantile(.98));
    const smooth=blur(L,w,h,1),broad=blur(L,w,h,5),xx=new Float32Array(n),yy=new Float32Array(n),xy=new Float32Array(n);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,gx=(smooth[y*w+Math.min(w-1,x+1)]-smooth[y*w+Math.max(0,x-1)])*.5;
      const gy=(smooth[Math.min(h-1,y+1)*w+x]-smooth[Math.max(0,y-1)*w+x])*.5;
      xx[i]=gx*gx;yy[i]=gy*gy;xy[i]=gx*gy;
    }
    const jxx=blur(xx,w,h,2),jyy=blur(yy,w,h,2),jxy=blur(xy,w,h,2);
    const T=new Uint8Array(n),A=new Uint8Array(n),B=new Uint8Array(n),C=new Uint8Array(n),D=new Uint8Array(n);
    const angle=new Float32Array(n),ridge=new Float32Array(n),cut=plantUsed?.16:.035;
    for(let i=0;i<n;i++){
      const dark=clamp((white-smooth[i])/Math.max(expandPlant?.12:.25,white-black),0,1);
      const tone=.96*Math.pow(clamp((dark-cut)/(1-cut),0,1),plantUsed?1.3:1.18);
      T[i]=M[i]?Math.round(255*(1-Math.pow(1-tone,Math.max(.01,b.contrast||1)))):0;
      let a=.5*Math.atan2(2*jxy[i],jxx[i]-jyy[i])+PI/2;a=((a%PI)+PI)%PI;
      const coherence=Math.sqrt(Math.pow(jxx[i]-jyy[i],2)+4*jxy[i]*jxy[i])/(jxx[i]+jyy[i]+.00002);
      angle[i]=a;A[i]=Math.round(255/3);B[i]=Math.round(a*255/PI);C[i]=Math.round(clamp(coherence,0,1)*255);
      ridge[i]=M[i]?clamp((broad[i]-L[i]-.005)*4.2,0,1):0;D[i]=Math.round(ridge[i]*255);
    }
    const ridgeAngle=angle.slice();
    if(plantUsed){
      // Local mask covariance approximates an elongated leaf's axis; this is a
      // shape cue rather than a inferred 3D surface normal.
      const R=15;
      for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){
        const i=y*w+x;if(!M[i])continue;let count=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
        for(let dy=-R;dy<=R;dy+=2)for(let dx=-R;dx<=R;dx+=2){const qx=x+dx,qy=y+dy;if(qx<0||qy<0||qx>=w||qy>=h||!M[qy*w+qx])continue;count++;sx+=dx;sy+=dy;sxx+=dx*dx;syy+=dy*dy;sxy+=dx*dy;}
        if(count<5)continue;const u=sxx/count-Math.pow(sx/count,2),v=syy/count-Math.pow(sy/count,2),z=sxy/count-sx*sy/(count*count);
        const conf=Math.hypot(u-v,2*z)/(u+v+.001),axis=.5*Math.atan2(2*z,u-v),mix=.75*conf;
        const a=.5*Math.atan2((1-mix)*Math.sin(2*angle[i])+mix*Math.sin(2*axis),(1-mix)*Math.cos(2*angle[i])+mix*Math.cos(2*axis));
        for(let dy=0;dy<2&&y+dy<h;dy++)for(let dx=0;dx<2&&x+dx<w;dx++){const q=(y+dy)*w+x+dx;if(M[q]){angle[q]=((a%PI)+PI)%PI;B[q]=Math.round(angle[q]*255/PI);C[q]=Math.max(C[q],Math.round(conf*255));}}
      }
      warnings.push('植物选区按绿色提取，棕色枝干与叶尖可能被排除。');
    }
    const seeds=[];
    function pixel(a,x,y){return a[clamp(Math.round(y),0,h-1)*w+clamp(Math.round(x),0,w-1)];}
    for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
      const i=y*w+x;if(!M[i]||ridge[i]<.02||C[i]<45)continue;
      const a=ridgeAngle[i],nx=-Math.sin(a)*1.3,ny=Math.cos(a)*1.3;
      if(ridge[i]>=pixel(ridge,x+nx,y+ny)&&ridge[i]>=pixel(ridge,x-nx,y-ny))seeds.push(i);
    }
    seeds.sort((i,j)=>ridge[j]*C[j]-ridge[i]*C[i]);
    // Reserve source-curve candidates for bright texture so high-contrast dark
    // clothing and backgrounds cannot consume the entire detail allocation.
    const brightSeeds=seeds.filter(i=>T[i]<36&&ridge[i]>.025&&C[i]>100),otherSeeds=seeds.filter(i=>!(T[i]<36&&ridge[i]>.025&&C[i]>100));
    seeds.length=0;let brightIndex=0,otherIndex=0;
    while(brightIndex<brightSeeds.length||otherIndex<otherSeeds.length){
      if(brightIndex<brightSeeds.length)seeds.push(brightSeeds[brightIndex++]);
      for(let j=0;j<3&&otherIndex<otherSeeds.length;j++)seeds.push(otherSeeds[otherIndex++]);
    }
    const maskDistance=new Float32Array(n);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)maskDistance[y*w+x]=M[y*w+x]?(x===0||y===0||x===w-1||y===h-1?1:10000):0;
    for(let y=1;y<h;y++)for(let x=1;x<w;x++){const i=y*w+x;maskDistance[i]=Math.min(maskDistance[i],maskDistance[i-1]+1,maskDistance[i-w]+1,maskDistance[i-w-1]+1.414);}
    for(let y=h-2;y>=0;y--)for(let x=w-2;x>=0;x--){const i=y*w+x;maskDistance[i]=Math.min(maskDistance[i],maskDistance[i+1]+1,maskDistance[i+w]+1,maskDistance[i+w+1]+1.414);}
    const margin=Math.min(16,Math.max(1.1,(b.strokeWidth||.5)*w/(options.width||130)/2+.6));
    function inset(point){
      let x=point[0],y=point[1];
      for(let k=0;k<36&&pixel(maskDistance,x,y)<margin;k++){
        const gx=pixel(maskDistance,x+1,y)-pixel(maskDistance,x-1,y),gy=pixel(maskDistance,x,y+1)-pixel(maskDistance,x,y-1),length=Math.hypot(gx,gy);
        if(length<.01)break;x=clamp(x+gx/length*.4,0,w-1);y=clamp(y+gy/length*.4,0,h-1);
      }
      return [x,y];
    }
    const used=new Uint8Array(n),detailPaths=[],detail=Math.max(.001,(b.detail||640)/640),pathLimit=Math.min(1600,Math.max(8,Math.round(360*Math.sqrt(detail))));
    for(const seed of seeds){
      if(detailPaths.length>=pathLimit)break;if(used[seed])continue;
      const origin=[seed%w,Math.floor(seed/w)],initial=ridgeAngle[seed];
      function trace(sign){
        const points=[origin.slice()];let x=origin[0],y=origin[1],a=initial+(sign<0?PI:0);
        for(let k=0;k<160;k++){
          const wanted=nearest(pixel(ridgeAngle,x,y),a);a+=clamp(wanted-a,-.14,.14);
          const nx=x+Math.cos(a),ny=y+Math.sin(a);
          if(nx<1||ny<1||nx>w-2||ny>h-2||!pixel(M,nx,ny)||pixel(ridge,nx,ny)<.013||pixel(C,nx,ny)<25)break;
          if(k>3&&used[clamp(Math.round(ny),0,h-1)*w+clamp(Math.round(nx),0,w-1)])break;
          points.push([nx,ny]);x=nx;y=ny;
        }
        return points;
      }
      const points=trace(-1).reverse().concat(trace(1).slice(1));if(points.length<5)continue;
      let darkness=0,confidence=0;
      for(const p of points){darkness+=pixel(ridge,p[0],p[1]);confidence+=pixel(C,p[0],p[1])/255;const px=Math.round(p[0]),py=Math.round(p[1]);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)used[clamp(py+dy,0,h-1)*w+clamp(px+dx,0,w-1)]=1;}
      detailPaths.push({points:points.map(inset),darkness:darkness/points.length,confidence:confidence/points.length});
    }
    return {width:w,height:h,widthMm:options.width||130,channels:{T,M,A,B,C,D},detailPaths,warnings,
      stats:{sourceWidth:sourceW,sourceHeight:sourceH,workWidth:w,workHeight:h,foregroundPixels:foreground,backgroundMode:mode,plantMaskUsed:plantUsed,sourceDetailCurves:detailPaths.length,tonalBlackPoint:black,tonalWhitePoint:white,plantToneExpanded:expandPlant},
      sourceSupport:{mask,width:sourceW,height:sourceH}};
  }
  return Object.freeze({VERSION:'1.0.0',prepare});
});
