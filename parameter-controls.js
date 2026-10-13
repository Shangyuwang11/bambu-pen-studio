/* Shared local design controls. Slider ranges are shortcuts, not value caps. */
(function(){'use strict';
 const controls=new Map();
 function attach(id,{label,min=0,max=null,quickMax=2,step=.01,sliderId=id+'Slider',optional=false,onInput}={}){
  const input=document.getElementById(id);if(!input||controls.has(id))return controls.get(id);
  const field=input.closest('label');field.classList.add('parameter-field');
  if(label)field.firstChild.textContent=label;
  input.min=min;input.step=max===null&&step<1?'any':step;
  if(max===null)input.removeAttribute('max');else input.max=max;
  input.setAttribute('aria-label',label||field.firstChild.textContent.trim());
  const row=document.createElement('span');row.className='parameter-row';
  const slider=document.createElement('input');slider.id=sliderId;slider.type='range';slider.min=min;slider.step=step;
  slider.setAttribute('aria-label',(label||input.getAttribute('aria-label'))+'滑块');
  input.before(row);row.append(slider,input);
  let adjusting=false;
  const sync=()=>{
   const value=input.valueAsNumber,valid=Number.isFinite(value);
   if(!adjusting)slider.max=max??Math.max(quickMax,valid?Math.min(Number.MAX_VALUE,value*1.25||quickMax):quickMax);
   // Preserve a typed value and never write the slider's rounded value back.
   slider.value=valid?value:min;slider.disabled=input.disabled;
   slider.setAttribute('aria-valuetext',input.value===''&&optional?'自动':input.value);
  };
  // Expanding the scale under a held pointer turns one drag into an ever
  // increasing value. Resize shortcuts only between user gestures.
  const release=()=>{if(adjusting){adjusting=false;sync();}};
  slider.addEventListener('pointerdown',()=>{adjusting=true;});
  window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);
  slider.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))adjusting=true;});
  slider.addEventListener('keyup',release);slider.addEventListener('blur',release);
  slider.addEventListener('input',()=>{input.value=slider.value;input.dispatchEvent(new Event('input',{bubbles:true}));onInput?.(input);});
  slider.addEventListener('change',()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  input.addEventListener('input',sync);input.addEventListener('change',sync);
  controls.set(id,{sync,input,slider});sync();return controls.get(id);
 }
 function sample(input,label){
  const box=document.createElement('div');box.className='stroke-sample';box.setAttribute('role','img');
  box.innerHTML='<svg viewBox="0 0 160 28" aria-hidden="true"><path d="M8 19 C32 0 42 27 65 14 S105 2 122 15 S144 22 152 9" fill="none" stroke="currentColor" stroke-linecap="round"/></svg><span></span>';
  input.closest('label').after(box);
  const sync=()=>{const width=Number(input.value);box.querySelector('path').setAttribute('stroke-width',Math.max(.1,Math.min(24,width*5)));box.querySelector('span').textContent=input.value+' mm';box.setAttribute('aria-label',label+' '+input.value+' 毫米，放大示意');};
  input.addEventListener('input',sync);input.addEventListener('change',sync);sync();return sync;
 }
 window.PenParameterControls={attach,sample,sync:()=>{for(const c of controls.values())c.sync();}};
})();
