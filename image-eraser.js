/* Local raster editing. History stores strokes, never full-size pixel snapshots. */
(function(){'use strict';
 const valid=s=>typeof s==='string'&&/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(s)&&s.length<=15000000;
 async function decode(source){if(!valid(source))throw Error('图片数据无效或过大');const img=new Image();img.src=source;await img.decode();if(img.naturalWidth*img.naturalHeight>50000000)throw Error('图片尺寸过大，请先缩小');return img;}
 async function create(container,input,callbacks){
  const image=await decode(input.source),original=input.originalSource||input.source,originalImage=original===input.source?image:await decode(original);
  if(Math.abs((image.naturalWidth/image.naturalHeight)/(originalImage.naturalWidth/originalImage.naturalHeight)-1)>.05)throw Error('原图与编辑图的比例不一致');
  const canvas=container.querySelector('canvas'),cursor=container.querySelector('.eraser-cursor'),ctx=canvas.getContext('2d'),scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.style.aspectRatio=canvas.width+'/'+canvas.height;
  let source=input.source,actions=[],future=[],stroke=null,pointer=null,enabled=false,disposed=false,diameter=8;
  const frame=container.querySelector('.eraser-frame');let observer;
  function fit(){const r=container.getBoundingClientRect(),s=Math.min((r.width-20)/canvas.width,(r.height-20)/canvas.height);frame.style.width=Math.max(1,canvas.width*s)+'px';frame.style.height=Math.max(1,canvas.height*s)+'px';}
  function paintStroke(a){ctx.strokeStyle=ctx.fillStyle='#fff';ctx.lineWidth=a.width;ctx.lineCap=ctx.lineJoin='round';ctx.beginPath();const first=a.points[0];ctx.moveTo(first[0],first[1]);for(const p of a.points.slice(1))ctx.lineTo(p[0],p[1]);ctx.stroke();ctx.beginPath();ctx.arc(first[0],first[1],a.width/2,0,Math.PI*2);ctx.fill();}
  function repaint(){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);for(const a of actions){if(a.reset){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(originalImage,0,0,canvas.width,canvas.height);}else paintStroke(a);}if(stroke)paintStroke(stroke);}
  function state(){return{enabled,undo:actions.length>0,redo:future.length>0,modified:source!==original,drawing:!!stroke};}
  function signal(){callbacks.state(state());}
  function publish(){source=actions.length===0?input.source:actions.at(-1).reset?original:canvas.toDataURL('image/png');if(!valid(source))throw Error('编辑后的图片过大，请缩小图片');signal();callbacks.change(source,source===original?undefined:original);}
  function location(e){const r=canvas.getBoundingClientRect();return[(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];}
  function hover(e){const r=canvas.getBoundingClientRect();cursor.hidden=!enabled;cursor.style.width=cursor.style.height=diameter/100*Math.max(r.width,r.height)+'px';cursor.style.left=e.clientX-r.left+'px';cursor.style.top=e.clientY-r.top+'px';}
  function down(e){if(!enabled||e.button!==0||disposed||stroke)return;e.preventDefault();callbacks.begin();pointer=e.pointerId;canvas.setPointerCapture(pointer);stroke={width:diameter/100*Math.max(canvas.width,canvas.height),points:[location(e)]};paintStroke(stroke);hover(e);signal();}
  function move(e){hover(e);if(!stroke||e.pointerId!==pointer)return;const events=e.getCoalescedEvents?.()||[e];for(const p of events){const point=location(p),previous=stroke.points.at(-1);if(Math.hypot(point[0]-previous[0],point[1]-previous[1])<.5)continue;stroke.points.push(point);paintStroke({width:stroke.width,points:[previous,point]});}}
  function finish(e){if(!stroke||e.pointerId!==pointer)return;actions.push(stroke);future=[];stroke=null;pointer=null;publish();}
  function cancel(e){if(!stroke||e.pointerId!==pointer)return;stroke=null;pointer=null;repaint();signal();callbacks.change(source,source===original?undefined:original);}
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',finish);canvas.onpointerleave=()=>{cursor.hidden=true;};
  observer=new ResizeObserver(fit);observer.observe(container);repaint();signal();
  return {setEnabled(value){enabled=!!value;canvas.classList.toggle('erasing',enabled);cursor.hidden=true;signal();},setSize(value){diameter=Math.max(1,Math.min(40,Number(value)||8));},undo(){if(stroke||!actions.length)return;callbacks.begin();future.push(actions.pop());repaint();publish();},redo(){if(stroke||!future.length)return;callbacks.begin();actions.push(future.pop());repaint();publish();},reset(){if(stroke||source===original)return;callbacks.begin();actions.push({reset:true});future=[];repaint();publish();},state,dispose(){disposed=true;observer.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',finish);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',finish);canvas.onpointerleave=null;cursor.hidden=true;canvas.classList.remove('erasing');}};
 }
 window.PenImageEraser={create};
})();
