'use strict';
const assert=require('node:assert/strict'),C=require('../core.js'),M=require('../machine.js'),Models=require('../printer-models.js');
let seed=0x19ab04;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};let drawings=0,empty=0,points=0;
for(const model of ['a1-mini','a1','p1s'])for(let n=0;n<150;n++){
 const m=Models.get(model);let s=C.initial();s.machine={model,w:m.w,h:m.h,plate:'smooth'};s.paper={x:random()*30,y:random()*30,w:50+random()*(m.w-80),h:50+random()*(m.h-80),margin:random()*6};s.safe={x:5,y:5,w:m.w-10,h:m.h-10};s.pen.width=.1+random()*1.9;s.pen.optimization=['quality','balanced','off'][n%3];
 s.objects=Array.from({length:4},(_,i)=>({id:'shape-'+i,type:'svg',name:'Random geometry',color:'#000000',x:-60+random()*200,y:-60+random()*200,w:10+random()*240,h:10+random()*240,rotation:random()*360,paths:[Array.from({length:12},()=>[random(),random()])]}));
 s=C.validateProject(s);const profile={...M.defaults(s),confirmed:true,downZ:18,upZ:20},reach=M.reachable(profile,s.machine),plan=C.plan(s,{timeline:false,clipRect:reach});
 if(!plan.paths.length){empty++;continue;}drawings++;
 const radius=s.pen.width/2,x0=Math.max(0,s.paper.x+s.paper.margin,s.safe.x,reach.x)+radius,y0=Math.max(0,s.paper.y+s.paper.margin,s.safe.y,reach.y)+radius,x1=Math.min(m.w,s.paper.x+s.paper.w-s.paper.margin,s.safe.x+s.safe.w,reach.x+reach.w)-radius,y1=Math.min(m.h,s.paper.y+s.paper.h-s.paper.margin,s.safe.y+s.safe.h,reach.y+reach.h)-radius;
 for(const path of plan.paths){assert.equal(path.render.opacity,1);assert.equal(path.render.width,s.pen.width);for(const[x,y]of path.points){points++;assert(Number.isFinite(x)&&Number.isFinite(y));assert(x>=x0-.001&&x<=x1+.001&&y>=y0-.001&&y<=y1+.001,'clipped physical ink must remain inside paper, plate and reachable area');}}
 const machine=M.projectDesign(s,profile,plan);assert.deepEqual(machine.errors,[]);for(const path of machine.paths)for(const[x,y]of path.points)assert(x>=m.minDrawX-.001&&x<=m.w+.001&&y>=-.001&&y<=m.h+.001,'nozzle path must fit actual model envelope');
}
assert(drawings>300);console.log(`PASS 450 seeded geometry scenarios: ${drawings} drawable, ${empty} fully clipped, ${points} points; rotations, off-paper layouts, pen width and A1 mini/A1/P1S nozzle bounds`);
