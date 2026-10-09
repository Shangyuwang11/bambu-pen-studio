/* Integrated path-only sketch refinement engine. Every visible mark is an exported stroke.
 * Grouped sweeps are an engineering approximation, not a reproduction of the
 * coordinated-particle paper. This module does not infer an artist's chronology.
 * Fixed physical nib and per-stroke alpha; shade comes from stroke placement.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.PenSketchRefinementCore=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PI=Math.PI,TAU=2*PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const finite=(v,f)=>Number.isFinite(Number(v))?Number(v):f;
  function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6d2b79f5)>>>0;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
  function generate(input,options={}){
    const now=typeof options.now==='function'?options.now:()=>Date.now(),start=now(),w=input.width,h=input.height,n=w*h,ch=input.channels||input.arrays;
    const maxStrokes=Math.min(50000,Math.max(1,Math.floor(finite(options.maxStrokes,16000))));
    const maxPoints=Math.min(500000,Math.max(2,Math.floor(finite(options.maxPoints,145000))));
    const timeBudget=Math.max(1,finite(options.budgetMs,6500));
    const workLimit=Math.min(300000,Math.max(1,Math.floor(finite(options.workBudget,42000))));
    const sampleLimit=Math.min(80000000,Math.max(200000,workLimit*500));
    let termination='',rasterSamples=0;
    function stopped(){
      if(termination)return true;
      if(typeof options.cancelled==='function'&&options.cancelled()){termination='cancelled';return true;}
      if(now()-start>=timeBudget){termination='time';return true;}
      return false;
    }
    if(!Number.isInteger(w)||!Number.isInteger(h)||w<4||h<4||w>1024||h>1024||!ch)throw Error('Invalid prepared image dimensions');
    for(const k of ['T','M','A','B','C','D'])if(!ch[k]||ch[k].length!==n)throw Error('Missing or invalid channel '+k);
    const mode=['baseline','natural','grouped','loops'].includes(options.mode)?options.mode:'natural';
    const density=clamp(finite(options.density,1),0,30),detail=Math.max(.001,finite(options.detail,1));
    const widthMm=Math.max(1,finite(input.widthMm,100)),nibMm=Math.max(.1,finite(options.nibWidthMm,.5));
    const strokeWidth=nibMm*w/widthMm,alpha=1,random=rng(finite(options.seed,163));
    const variation=clamp(finite(options.randomness,.12),0,1),fit=clamp(finite(options.directionFit,.85),0,1);
    const highlight=mode==='baseline'?0:clamp(finite(options.highlightTexture,.5),0,1);
    const crossing=mode==='baseline'?0:clamp(finite(options.shadowCross,.35),0,1);
    const freedom=clamp(finite(options.freedom,0),0,1),curvature=clamp(finite(options.curvature,.65),0,1),lengthFactor=clamp(finite(options.length,1),.01,16);
    const paths=[],stageCounts={structure:0,tone:0,shadow:0,detail:0};
    const target=new Float32Array(n),ink=new Float32Array(n),angles=new Float32Array(n),fieldSin=new Float32Array(n),fieldCos=new Float32Array(n),valid=new Uint8Array(n);
    let active=0,targetSum=0;const detailEffect=1-Math.exp(-detail*.7);
    for(let i=0;i<n;i++){
      valid[i]=ch.M[i]>127?1:0;
      if(valid[i]){
        let t=ch.T[i]/255;
        t+=highlight*.31*(ch.D[i]/255)*Math.pow(1-t,1.6)*detailEffect;
        target[i]=1-Math.pow(1-clamp(t,0,.97),density);
        if(target[i]>.007)active++;
        targetSum+=target[i];
      }
      const a=ch.A[i]*PI/255,b=ch.B[i]*PI/255,f=mode==='baseline'?0:fit*(.35+.65*ch.C[i]/255);
      angles[i]=.5*Math.atan2((1-f)*Math.sin(2*a)+f*Math.sin(2*b),(1-f)*Math.cos(2*a)+f*Math.cos(2*b));
      fieldSin[i]=Math.sin(angles[i]*2);fieldCos[i]=Math.cos(angles[i]*2);
    }
    function at(arr,x,y){
      x=clamp(x,0,w-1);y=clamp(y,0,h-1);const x0=x|0,y0=y|0,x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),dx=x-x0,dy=y-y0;
      return arr[y0*w+x0]*(1-dx)*(1-dy)+arr[y0*w+x1]*dx*(1-dy)+arr[y1*w+x0]*(1-dx)*dy+arr[y1*w+x1]*dx*dy;
    }
    function nearest(a,reference){while(a-reference>PI/2)a-=PI;while(a-reference<-PI/2)a+=PI;return a;}
    function field(x,y,reference){
      return nearest(.5*Math.atan2(at(fieldSin,x,y),at(fieldCos,x,y)),reference);
    }
    const heightMm=Math.max(1,finite(input.heightMm,widthMm*h/w)),yScale=heightMm*w/(h*widthMm);
    const radius=strokeWidth/2,softness=.48,padding=radius+softness,paddingY=padding/yScale;
    function supported(x,y){
      if(x<padding||y<paddingY||x>w-1-padding||y>h-1-paddingY)return false;
      const i=(Math.floor(y))*w+Math.floor(x);
      return valid[i]&&target[i]>.005;
    }
    // Block averages model the visible tone of a fixed narrow dark nib. They
    // do not ask the generator to paint every uncovered fine pixel black.
    const cell=Math.max(3,Math.ceil(strokeWidth*3)),cols=Math.ceil(w/cell),rows=Math.ceil(h/cell),nc=cols*rows;
    const cTarget=new Float64Array(nc),cInk=new Float64Array(nc),cCount=new Uint16Array(nc),index=new Uint32Array(n);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,k=Math.floor(y/cell)*cols+Math.floor(x/cell);index[i]=k;cTarget[k]+=target[i];cCount[k]++;
    }
    const tree=new Float64Array(nc+1),weights=new Float64Array(nc);let mass=0;
    function treeAdd(k,d){for(let j=k+1;j<=nc;j+=j&-j)tree[j]+=d;mass+=d;}
    function weight(k){const r=Math.max(0,(cTarget[k]-cInk[k])/cCount[k]);return r*r*cCount[k];}
    for(let k=0;k<nc;k++){weights[k]=weight(k);treeAdd(k,weights[k]);}
    function seed(shadow){
      for(let tries=0;tries<8;tries++){
        if(mass<1e-10)return null;
        let v=random()*mass,k=0,bit=1;while(bit*2<=nc)bit*=2;
        for(;bit;bit>>=1){const j=k+bit;if(j<=nc&&tree[j]<v){k=j;v-=tree[j];}}
        k=Math.min(nc-1,k);
        const x0=(k%cols)*cell,y0=Math.floor(k/cols)*cell;
        let chosen=-1,best=-1;
        for(let p=0;p<8;p++){
          const x=clamp(x0+Math.floor(random()*cell),0,w-1),y=clamp(y0+Math.floor(random()*cell),0,h-1),i=y*w+x;
          const priority=valid[i]?target[i]*(.4+random()*.6):0;
          if(priority>best&&target[i]>.006&&(!shadow||target[i]>.48)){chosen=i;best=priority;}
        }
        if(chosen>=0)return{x:chosen%w+.1+random()*.8,y:Math.floor(chosen/w)+.1+random()*.8,t:target[chosen]};
      }
      return null;
    }
    const coverage=new Float32Array(n),stampAt=new Uint32Array(n),delta=new Float64Array(nc),cellStamp=new Uint32Array(nc);let stamp=0;
    let rejectedMask=0,rejectedTone=0,attempts=0,lengthPixels=0,pointCount=0;
    function candidate(points){
      if(points.length<2||stopped())return null;
      stamp++;const touched=[],cells=[];
      for(let p=1;p<points.length;p++){
        const a=points[p-1],b=points[p],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy*yScale*yScale;
        const x0=clamp(Math.floor(Math.min(a[0],b[0])-padding),0,w-1),x1=clamp(Math.ceil(Math.max(a[0],b[0])+padding),0,w-1);
        const y0=clamp(Math.floor(Math.min(a[1],b[1])-paddingY),0,h-1),y1=clamp(Math.ceil(Math.max(a[1],b[1])+paddingY),0,h-1);
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          rasterSamples++;if(rasterSamples>sampleLimit){termination='coverage-budget';return null;}
          if((rasterSamples&4095)===0&&stopped())return null;
          const t=den?clamp(((x+.5-a[0])*dx+(y+.5-a[1])*dy*yScale*yScale)/den,0,1):0;
          const d=Math.hypot(x+.5-a[0]-t*dx,(y+.5-a[1]-t*dy)*yScale);
          const c=clamp((radius+softness-d)/(2*softness),0,1)-clamp((-radius+softness-d)/(2*softness),0,1);
          if(c<=0)continue;const i=y*w+x;
          if(c>.015&&!valid[i]){rejectedMask++;return null;}
          if(stampAt[i]!==stamp){stampAt[i]=stamp;coverage[i]=c;touched.push(i);}else if(c>coverage[i])coverage[i]=c;
        }
      }
      let fine=0,newCoverage=0,repeatedCoverage=0;
      for(const i of touched){
        const d=(1-ink[i])*coverage[i]*alpha,r=target[i]-ink[i],k=index[i];fine+=r*r-(r-d)*(r-d);newCoverage+=d;repeatedCoverage+=ink[i]*coverage[i];
        if(cellStamp[k]!==stamp){cellStamp[k]=stamp;delta[k]=d;cells.push(k);}else delta[k]+=d;
      }
      let benefit=0;
      for(const k of cells){const r=cTarget[k]-cInk[k];benefit+=(r*r-(r-delta[k])*(r-delta[k]))/cCount[k];}
      const redundant=newCoverage<.12*(newCoverage+repeatedCoverage);
      return{touched,cells,benefit:redundant?-1:benefit+.035*fine-.025*repeatedCoverage};
    }
    function accept(points,stage){
      if(stopped())return false;
      if(paths.length>=maxStrokes){termination='strokes';return false;}
      if(pointCount+points.length>maxPoints){termination='points';return false;}
      const c=candidate(points);if(!c||c.benefit<=1e-7){if(c)rejectedTone++;return false;}
      for(const i of c.touched)ink[i]+=(1-ink[i])*coverage[i]*alpha;
      for(const k of c.cells){cInk[k]+=delta[k];const next=weight(k);treeAdd(k,next-weights[k]);weights[k]=next;}
      paths.push({points,stage});stageCounts[stage]++;pointCount+=points.length;
      for(let i=1;i<points.length;i++)lengthPixels+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
      return true;
    }
    // Split only at the source support boundary; no connection crosses a gap.
    function pieces(points){
      const out=[];let part=[];
      for(let p=0;p<points.length;p++){
        const a=points[p];
        if(p&&part.length){
          const b=points[p-1],distance=Math.hypot(a[0]-b[0],a[1]-b[1]),count=Math.ceil(distance/.65);
          for(let j=1;j<count;j++){
            const q=[b[0]+(a[0]-b[0])*j/count,b[1]+(a[1]-b[1])*j/count];
            if(!supported(q[0],q[1])){if(part.length>1)out.push(part);part=[];}
          }
        }
        if(supported(a[0],a[1]))part.push(a.slice());else{if(part.length>1)out.push(part);part=[];}
      }
      if(part.length>1)out.push(part);return out;
    }
    const sourcePaths=(input.detailPaths||[]).filter(p=>p&&Array.isArray(p.points)&&p.points.length>1).map(p=>{
      let length=0,t=0;for(let i=0;i<p.points.length;i++){const q=p.points[i];t+=at(target,q[0],q[1]);if(i)length+=Math.hypot(q[0]-p.points[i-1][0],q[1]-p.points[i-1][1]);}
      return{...p,length,t:t/p.points.length};
    }).sort((a,b)=>(b.darkness||b.t)*(1+Math.sqrt(b.length))-(a.darkness||a.t)*(1+Math.sqrt(a.length)));
    // A bright ridge can be lost by the coarse tonal cutoff even though its
    // source curve is reliable. Reserve ink only in a narrow band around a
    // selected actual ridge, rather than raising the whole highlight region.
    let highlightPaths=[],highlightTargetPixels=0;
    if(highlight>0){
      const eligible=sourcePaths.filter(p=>p.t<.12&&p.length>6&&p.darkness>.025&&p.confidence>.5)
        .sort((a,b)=>b.confidence*Math.sqrt(b.length)-a.confidence*Math.sqrt(a.length));
      highlightPaths=eligible.slice(0,Math.ceil(eligible.length*Math.min(1,highlight*Math.sqrt(detail)*1.3)));
      const bandRadius=Math.max(1.8,strokeWidth*1.65),minimum=.38*Math.sqrt(highlight)*(.7+.3*detailEffect);
      for(const p of highlightPaths)for(let k=1;k<p.points.length;k++){
        const a=p.points[k-1],b=p.points[k],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
        const x0=clamp(Math.floor(Math.min(a[0],b[0])-bandRadius),0,w-1),x1=clamp(Math.ceil(Math.max(a[0],b[0])+bandRadius),0,w-1);
        const y0=clamp(Math.floor(Math.min(a[1],b[1])-bandRadius),0,h-1),y1=clamp(Math.ceil(Math.max(a[1],b[1])+bandRadius),0,h-1);
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          const i=y*w+x;if(!valid[i]||ch.T[i]/255>.14)continue;
          const t=den?clamp(((x+.5-a[0])*dx+(y+.5-a[1])*dy)/den,0,1):0;
          const d=Math.hypot(x+.5-a[0]-t*dx,y+.5-a[1]-t*dy);
          if(d>bandRadius)continue;
          const value=minimum*(.85+.15*(1-d/bandRadius));
          if(value>target[i]){
            const extra=value-target[i];cTarget[index[i]]+=extra;targetSum+=extra;
            if(target[i]<=.007&&value>.007)active++;target[i]=value;highlightTargetPixels++;
          }
        }
      }
      // Update the residual sampler after adding the sparse support bands.
      tree.fill(0);mass=0;for(let k=0;k<nc;k++){weights[k]=weight(k);treeAdd(k,weights[k]);}
    }
    const structureLimit=Math.ceil(sourcePaths.length*(mode==='baseline'?.16:.3));
    for(let k=0;k<structureLimit&&!stopped();k++)for(const path of pieces(sourcePaths[k].points)){if(stopped())break;accept(path,'structure');}
    let earlyHighlightStrokes=0;
    for(const p of highlightPaths){if(stopped())break;for(const path of pieces(p.points)){if(stopped())break;if(accept(path,'detail'))earlyHighlightStrokes++;}}
    const finalCellTarget=cTarget.slice();
    function resetWeights(){
      tree.fill(0);mass=0;
      for(let k=0;k<nc;k++){weights[k]=weight(k);treeAdd(k,weights[k]);}
    }
    // Give the dark crossing pass its own share of the ink budget. Otherwise
    // ordinary sweeps can exhaust the target before the crossing slider acts.
    if(crossing>0&&mode!=='loops'){
      for(let k=0;k<nc;k++){
        const darkFraction=clamp((cTarget[k]/cCount[k]-.36)/.3,0,1);
        cTarget[k]*=1-crossing*.4*darkFraction;
      }
      resetWeights();
    }
    const scale=w/384;
    function sweep(s,offset=0,group=0){
      const base=field(s.x,s.y,0)+offset+(random()-.5)*(variation*.45+freedom*.7);
      const length=(mode==='grouped'?30:19)*scale*lengthFactor*(.65+random()*.8)*(1.1-.3*s.t)/Math.pow(Math.max(.3,detail),.2);
      const phase=mode==='grouped'?group*.21:random()*TAU;
      const bend=(random()-.5)*variation*.25,step=1.2*scale;
      function leg(sign){
        const out=[[s.x,s.y]];let x=s.x,y=s.y,angle=base+(sign<0?PI:0);
        const steps=Math.min(256,Math.max(3,Math.ceil(length/2/step)));
        for(let j=1;j<=steps;j++){
          const desired=field(x,y,angle)+offset;
          const steady=variation*.18*Math.sin(phase+j/steps*PI*1.3)+bend*j/steps;
          angle+=clamp(nearest(desired,angle)-angle,-.055,.055)*curvature;
          const a=angle+sign*steady*curvature,nx=x+Math.cos(a)*step,ny=y+Math.sin(a)*step;
          if(!supported(nx,ny))break;
          out.push([nx,ny]);x=nx;y=ny;
        }
        return out;
      }
      const a=leg(-1),b=leg(1);return a.reverse().concat(b.slice(1));
    }
    function loop(s){
      let a=field(s.x,s.y,0),phase=random()*TAU,rx=(2.3+2*(1-s.t))*scale*Math.sqrt(lengthFactor),ry=rx*.65;
      const sign=random()<.5?-1:1,cycles=1.2+random()*.6,steps=Math.ceil(cycles*TAU/.25),out=[];
      let cx=s.x-rx*Math.cos(phase)*Math.cos(a)+ry*Math.sin(phase)*Math.sin(a);
      let cy=s.y-rx*Math.cos(phase)*Math.sin(a)-ry*Math.sin(phase)*Math.cos(a);
      for(let k=0;k<=steps;k++){
        const desired=field(cx,cy,a);a+=clamp(desired-a,-.025,.025)*curvature;
        const breathing=1+variation*.15*Math.sin(k/steps*PI),t=phase+sign*k*.25;
        const x=cx+rx*Math.cos(t)*Math.cos(a)*breathing-ry*Math.sin(t)*Math.sin(a)*breathing;
        const y=cy+rx*Math.cos(t)*Math.sin(a)*breathing+ry*Math.sin(t)*Math.cos(a)*breathing;
        if(!supported(x,y))break;out.push([x,y]);cx+=Math.cos(a)*rx*.025;cy+=Math.sin(a)*rx*.025;
      }
      return out;
    }
    // Budget is a continuous function of requested detail and footprint, with
    // an explicit portable-preview ceiling instead of silent fixed detail tiers.
    const requestedBudget=Math.ceil(active*Math.max(.55,Math.sqrt(detail))*1.4/Math.max(.3,strokeWidth));
    const budget=Math.min(workLimit,Math.max(32,requestedBudget)),stageBudget=Math.ceil(budget*.78);
    let stalled=0;
    for(let k=0;k<stageBudget&&!stopped();k++){
      attempts++;const s=seed(false);if(!s)break;
      if(!supported(s.x,s.y)){stalled++;continue;}
      if(mode==='grouped'){
        const a=field(s.x,s.y,0),spacing=Math.max(strokeWidth*2,1.8*scale)*(1-.45*s.t)/Math.sqrt(density);
        let gained=false;
        // Shared seed family creates coherent parallel neighbours; each must
        // independently reduce tone loss, so grouping cannot uniformly fill.
        for(let j=-1;j<=1;j++){
          const q={x:s.x-Math.sin(a)*spacing*j,y:s.y+Math.cos(a)*spacing*j,t:s.t};
          if(supported(q.x,q.y))gained=accept(sweep(q,0,k),'tone')||gained;
        }
        stalled=gained?0:stalled+1;
      }else stalled=accept(mode==='loops'?loop(s):sweep(s),'tone')?0:stalled+1;
      if(stalled>650||mass/Math.max(1,active)<.00007)break;
    }
    if(crossing>0&&mode!=='loops'){
      cTarget.set(finalCellTarget);resetWeights();
      const crossBudget=Math.ceil(budget*.22*crossing);stalled=0;
      for(let k=0;k<crossBudget&&!stopped();k++){
        attempts++;const s=seed(true);if(!s)break;
        const path=sweep(s,PI/2+.12,0);
        // Crosshatching stays in genuinely dark source areas.
        const parts=[];let part=[];for(const q of path){if(at(target,q[0],q[1])>.43)part.push(q);else{if(part.length>1)parts.push(part);part=[];}}if(part.length>1)parts.push(part);
        let gain=false;for(const p of parts)gain=accept(p,'shadow')||gain;
        stalled=gain?0:stalled+1;if(stalled>180)break;
      }
    }
    if(mode!=='baseline'){
      const detailLimit=Math.min(sourcePaths.length,Math.ceil(sourcePaths.length*Math.min(1,detail*.65)));
      for(let k=0;k<detailLimit&&!stopped();k++){
        const p=sourcePaths[k];if(p.length<1.4)continue;
        for(const q of pieces(p.points))accept(q,'detail');
      }
    }
    let drawn=0,error=0,backgroundInk=0,foreground=0,blank=0;
    for(let i=0;i<n;i++){drawn+=ink[i];if(valid[i]){foreground++;if(ink[i]<.01)blank++;}else backgroundInk+=ink[i];}
    for(let k=0;k<nc;k++){const r=(cTarget[k]-cInk[k])/cCount[k];error+=r*r*cCount[k];}
    if(!termination&&requestedBudget>budget&&attempts>=stageBudget)termination='work-budget';
    if(!termination&&Math.sqrt(error/n)>.025)termination='support-exhausted';
    const stats={mode,termination:termination||'converged',complete:!termination,rasterSamples,sampleLimit,elapsedMs:now()-start,strokeCount:paths.length,pointCount,lengthMm:paths.reduce((sum,p)=>sum+p.points.slice(1).reduce((a,q,i)=>a+Math.hypot((q[0]-p.points[i][0])*widthMm/w,(q[1]-p.points[i][1])*heightMm/h),0),0),
      meanInk:drawn/n,targetMean:targetSum/n,toneRmse:Math.sqrt(error/n),backgroundInk,blankForegroundFraction:blank/Math.max(1,foreground),
      attempts,rejectedMask,rejectedTone,requestedBudget,budget,budgetLimited:requestedBudget>budget&&attempts>=stageBudget,
      highlightSourcePaths:highlightPaths.length,highlightTargetPixels,earlyHighlightStrokes,
      nibWidthMm:nibMm,alpha,algorithm:mode==='grouped'?'coordinated-sweep-approximation':mode==='loops'?'residual-continuous-loops':mode==='baseline'?'original-field-residual-sweeps':'detail-aware-field-residual-sweeps',
      process:'structure, selected bright-source details, tone, shadow, final detail; designed sequence, not recovered human chronology'};
    return{paths,strokeWidth,alpha,stageCounts,stats};
  }
  return Object.freeze({VERSION:'1.0.0',generate});
});
