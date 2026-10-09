/* Deterministic geometry-only optimization. Never joins separated marks or
   crosses layer boundaries. Text keeps its original stroke order/direction. */
(function(root){
  'use strict';
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const equal=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  function simplify(points,epsilon=0){
    const p=points.filter((v,i)=>!i||!equal(v,points[i-1]));
    if(!epsilon||p.length<3)return p;
    const keep=new Uint8Array(p.length);keep[0]=keep[p.length-1]=1;
    const stack=[[0,p.length-1]];
    while(stack.length){const [a,b]=stack.pop(),dx=p[b][0]-p[a][0],dy=p[b][1]-p[a][1],l2=dx*dx+dy*dy;let best=epsilon*epsilon,index=-1;
      for(let i=a+1;i<b;i++){const t=l2?Math.max(0,Math.min(1,((p[i][0]-p[a][0])*dx+(p[i][1]-p[a][1])*dy)/l2)):0,d=(p[i][0]-p[a][0]-t*dx)**2+(p[i][1]-p[a][1]-t*dy)**2;if(d>best){best=d;index=i;}}
      if(index>=0){keep[index]=1;stack.push([a,index],[index,b]);}
    }
    // Keep tiny closed loops rather than simplifying them into a dot.
    const out=p.filter((_,i)=>keep[i]);return equal(p[0],p.at(-1))&&out.length<4?p:out;
  }
  function stats(paths){let draw=0,travel=0,points=0,last=null;for(const s of paths){const p=s.points;points+=p.length;if(last)travel+=dist(last,p[0]);for(let i=1;i<p.length;i++)draw+=dist(p[i-1],p[i]);last=p.at(-1);}return{draw,travel,points,strokes:paths.length};}
  function cost(paths,before,after){let total=0,last=before;for(const s of paths){if(last)total+=dist(last,s.points[0]);last=s.points.at(-1);}if(last&&after)total+=dist(last,after);return total;}
  // Balanced endpoint kd-tree with live subtree counts. Avoids an O(n^2)
  // all-path scan on photo hatching (thousands of disconnected strokes).
  function nearestOrder(paths){
    if(paths.length<3)return paths;
    const refs=paths.map(()=>[]),active=new Uint8Array(paths.length).fill(1);
    function tree(items,depth=0,parent=null){if(!items.length)return null;const axis=depth%2;items.sort((a,b)=>a.p[axis]-b.p[axis]||a.i-b.i||a.end-b.end);const mid=items.length>>1,n={v:items[mid],axis,parent,count:items.length};refs[n.v.i].push(n);n.left=tree(items.slice(0,mid),depth+1,n);n.right=tree(items.slice(mid+1),depth+1,n);return n;}
    const t=tree(paths.flatMap((s,i)=>[{p:s.points[0],i,end:0},{p:s.points.at(-1),i,end:1}]));
    function remove(i){active[i]=0;for(const n of refs[i])for(let p=n;p;p=p.parent)p.count--;}
    function closest(p){let best=null,d2=Infinity;function visit(n){if(!n?.count)return;const delta=p[n.axis]-n.v.p[n.axis],near=delta<=0?n.left:n.right,far=delta<=0?n.right:n.left;visit(near);if(active[n.v.i]){const d=(p[0]-n.v.p[0])**2+(p[1]-n.v.p[1])**2;if(d<d2||(d===d2&&(!best||n.v.i<best.i))){best=n.v;d2=d;}}if(delta*delta<=d2)visit(far);}visit(t);return best;}
    const out=[paths[0]];remove(0);
    while(out.length<paths.length){const hit=closest(out.at(-1).points.at(-1));if(!hit)break;const s=paths[hit.i];out.push(hit.end?{...s,points:s.points.slice().reverse()}:s);remove(hit.i);}
    return out;
  }
  function join(paths){const out=[];for(const s of paths){const prev=out.at(-1);if(prev&&!prev.preserveStrokes&&!s.preserveStrokes&&equal(prev.points.at(-1),s.points[0]))prev.points=prev.points.concat(s.points.slice(1));else out.push({...s,points:s.points.slice()});}return out;}
  function reloop(paths,before,after){
    const out=[];for(let i=0;i<paths.length;i++){const s=paths[i],p=s.points,previous=out.at(-1)?.points.at(-1)||before,next=paths[i+1]?.points[0]||after;
      if(p.length<4||!equal(p[0],p.at(-1))||(!previous&&!next)){out.push(s);continue;}
      const cost=q=>(previous?dist(previous,q):0)+(next?dist(q,next):0);let best=0,value=cost(p[0]);for(let j=1;j<p.length-1;j++){const v=cost(p[j]);if(v<value-1e-9){best=j;value=v;}}
      if(!best){out.push(s);continue;}const loop=p.slice(0,-1),rotated=loop.slice(best).concat(loop.slice(0,best));out.push({...s,points:rotated.concat([rotated[0]])});
    }return out;
  }
  function optimize(paths,mode='quality',penWidth=.35){
    const before=stats(paths);if(mode==='off')return{paths,metrics:{before,after:before,mode,tolerance:0}};
    const epsilon=mode==='balanced'?Math.min(.08,penWidth*.2):0;
    const out=[];
    for(let start=0;start<paths.length;){let end=start+1;while(end<paths.length&&paths[end].id===paths[start].id&&paths[end].color===paths[start].color)end++;
      const group=paths.slice(start,end);start=end;
      if(group[0].type==='text'||group.some(p=>p.preserveOrder===true)){out.push(...group);continue;}
      const seen=new Set(),clean=[];
      for(const s of group){const p=simplify(s.points,s.preserveStrokes?0:epsilon);if(p.length<2)continue;if(!s.preserveStrokes){const a=JSON.stringify(p),b=JSON.stringify(p.slice().reverse()),key=a<b?a:b;if(seen.has(key))continue;seen.add(key);}clean.push({...s,points:p});}
      const sorted=nearestOrder(clean),previous=out.at(-1)?.points.at(-1),next=paths[end]?.points[0];
      const order=cost(sorted,previous,next)<=cost(clean,previous,next)+1e-9?sorted:clean;
      out.push(...join(mode==='balanced'?reloop(order,previous,next):order));
    }
    // Global fallback includes layer transitions. Optimization must not increase
    // travel; simplification and joining are permitted only within each layer.
    if(stats(out).travel>before.travel+1e-7)return{paths,metrics:{before,after:before,mode,tolerance:epsilon}};
    return{paths:out,metrics:{before,after:stats(out),mode,tolerance:epsilon}};
  }
  root.PenPaths={simplify,stats,optimize,reloop};if(typeof module!=='undefined')module.exports=root.PenPaths;
})(typeof window!=='undefined'?window:globalThis);
