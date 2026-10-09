// Extract the boundary of the coplanar top triangles; preserve concave tabs/notches.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const folder=__dirname;fs.mkdirSync(folder,{recursive:true});
const models={};
for(const [name,height] of [['A1M',180],['X1',256]]){
 const file='bbl-3dp-'+name+'.stl',b=fs.readFileSync(path.join(__dirname,file)),edges=new Map();
 const key=p=>p.map(n=>n.toFixed(4)).join(',');
 for(let i=0,n=b.readUInt32LE(80);i<n;i++){
  const t=Array.from({length:3},(_,j)=>Array.from({length:3},(_,k)=>b.readFloatLE(84+i*50+12+j*12+k*4)));
  if(!t.every(p=>Math.abs(p[2])<1e-5))continue;
  const p=t.map(v=>[+v[0].toFixed(4),+(height-v[1]).toFixed(4)]);
  for(let j=0;j<3;j++){const a=p[j],c=p[(j+1)%3],k=[key(a),key(c)].sort().join('|');if(edges.has(k))edges.delete(k);else edges.set(k,[a,c]);}
 }
 const links=new Map();for(const [a,b]of edges.values())for(const [p,q]of [[a,b],[b,a]]){const k=key(p);if(!links.has(k))links.set(k,[]);links.get(k).push(q);}
 assert.ok([...links.values()].every(a=>a.length===2),'Boundary must be manifold');
 const pending=new Set(links.keys()),loops=[];
 while(pending.size){const first=pending.values().next().value;let current=first,prev=null;const loop=[];do{pending.delete(current);loop.push(current.split(',').map(Number));const next=links.get(current).find(p=>key(p)!==prev);prev=current;current=key(next);assert.ok(loop.length<=links.size);}while(current!==first);loops.push(loop);}
 const area=p=>Math.abs(p.reduce((n,a,i)=>{const c=p[(i+1)%p.length];return n+a[0]*c[1]-c[0]*a[1];},0)/2);
 loops.sort((a,b)=>area(b)-area(a));
 console.log(name,loops.map(p=>({area:area(p),vertices:p.length})));
 models[name]={file,source:'https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/'+file,sha256:crypto.createHash('sha256').update(b).digest('hex'),points:loops[0],holes:loops.slice(1)};
 fs.writeFileSync(path.join(folder,file),b);
}
fs.writeFileSync(path.join(folder,'outlines.js'),'/* Bambu Studio plate model data, AGPL-3.0. See NOTICE.md. Extracted 2026-10-02. */\n(function(r){r.PenPlateOutlines='+JSON.stringify(models)+';if(typeof module!=="undefined")module.exports=r.PenPlateOutlines;})(typeof window!=="undefined"?window:globalThis);\n');
console.log(Object.fromEntries(Object.entries(models).map(([k,v])=>[k,{vertices:v.points.length,sha256:v.sha256}])));
