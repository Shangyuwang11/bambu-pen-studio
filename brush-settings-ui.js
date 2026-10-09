(function(){'use strict';
 const $=id=>document.getElementById(id),C=PenParameterControls;
 const fold=document.createElement('details');fold.id='strokeSettings';fold.className='workspace-fold';fold.name='workspace-section';
 const summary=document.createElement('summary');summary.append(PenIcons.svg('pen'));const title=document.createElement('span');title.textContent='笔芯 / 实际线宽';summary.append(title);fold.append(summary);
 const panel=document.createElement('div');panel.className='workspace-stroke-settings';fold.append(panel);panel.append($('penWidth').closest('label'));
 fold.removeAttribute('name');fold.open=true;$('penParameterSummary').before(fold);
 const sizes=document.createElement('div');sizes.className='nib-sizes';sizes.setAttribute('role','group');sizes.setAttribute('aria-label','笔芯规格');panel.prepend(sizes);
 for(const width of [.3,.5,.7,1]){const button=document.createElement('button');button.type='button';button.dataset.nibWidth=width;button.textContent=width+' mm';sizes.append(button);}
 C.attach('penWidth',{label:'实际笔触 · mm',min:.1,quickMax:2,step:.05,onInput:input=>input.dispatchEvent(new Event('change',{bubbles:true}))});
 const syncSample=C.sample($('penWidth'),'画布笔触粗细');
 const note=document.createElement('p');note.textContent='像喷嘴规格一样，整套配置使用同一线宽。所有生成的线条、素描排线、预览和 SVG 都按此值计算，水性笔为 100% 实色。';panel.append(note);
 const saved=document.createElement('p');saved.id='nibSaveStatus';saved.setAttribute('role','status');panel.append(saved);let saving=false,busy=false;
 async function applyWidth(value){if(saving||busy)return;saving=true;sync();try{const stored=await PenProfilesUI.saveWidth(value);saved.textContent=stored?'已保存到 '+PenProfilesUI.selected().name:'当前线宽已设置；完成校准后随配置一起保存';}catch(e){saved.textContent='线宽未保存：'+e.message;}finally{saving=false;sync();}}
 for(const button of sizes.children)button.onclick=()=>applyWidth(Number(button.dataset.nibWidth));
 $('penWidth').addEventListener('change',()=>{const v=Number($('penWidth').value);if($('penWidth').value.trim()&&Number.isFinite(v)&&v>=.1)applyWidth(v);});
 C.attach('hatchGap',{label:'排线间距 · mm',min:.3,quickMax:4,step:.1});
 const threshold=$('threshold'),number=document.createElement('input');number.type='number';number.id='thresholdNumber';number.value=threshold.value;threshold.before(number);threshold.remove();
 const c=C.attach('thresholdNumber',{label:'黑白阈值',min:0,max:255,quickMax:255,step:1,sliderId:'threshold'});
 c.slider.value=threshold.value;c.slider.oninput=threshold.oninput;c.slider.onchange=threshold.onchange;
 number.addEventListener('input',()=>{if(number.value!==''&&number.checkValidity()){c.slider.value=number.value;c.slider.oninput?.(new Event('input'));}});
 number.addEventListener('change',()=>{if(number.value!==''&&number.checkValidity()){$('threshold').value=number.value;$('threshold').onchange?.(new Event('change'));}});
 function sync(){number.value=$('threshold').value;const width=PenStudio.getSettings().pen.width;title.textContent='笔芯 / 实际线宽 · '+width+' mm';$('penWidth').disabled=saving||busy;for(const button of sizes.children){button.disabled=saving||busy;button.setAttribute('aria-pressed',String(Number(button.dataset.nibWidth)===width));}C.sync();syncSample();}
 window.addEventListener('penstudiochange',()=>queueMicrotask(sync));window.addEventListener('penconnection',e=>{busy=!!e.detail.busy;sync();});window.addEventListener('penpresetchange',()=>{saved.textContent='';sync();});sync();
})();
