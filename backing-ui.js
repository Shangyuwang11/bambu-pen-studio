(function(){'use strict';
 const $=id=>document.getElementById(id),B=PenBacking,A=PenAlignment;let busy=false,pending=false;
 const box=document.createElement('section');box.className='backing-save';box.innerHTML='<h2>固定底板背景</h2><label>底板名称<input id="backingName" maxlength="48" placeholder="例如：绿色定位底纸"></label><button id="backingSave" class="primary">已画好，保存为固定底板</button><p id="backingStatus" role="status"></p><p>保存图案、编号和颜色；底板固定在最底层，不参与选择、拖动、删除或发送。纸张半透明显示，方便对格。</p>';
 $('alignmentPlacePane').after(box);
 const status=document.createElement('p');status.id='backingWorkspaceStatus';status.className='alignment-note';$('paperFold').append(status);
 function render(){const s=PenStudio.getState(),b=B.resolve(s);$('backingSave').disabled=busy||pending;$('backingName').disabled=busy||pending;status.textContent=b?'固定底板 · '+b.name+' · 已锁定':'';if(document.activeElement!==$('backingName')&&!$('backingName').value)$('backingName').value=s.backing?.name||'定位底板';}
 $('backingSave').onclick=async()=>{if(busy||pending)return;const before=PenStudio.getState(),old=localStorage.getItem(B.STORE);pending=true;render();try{
  PenAlignmentUI.readConfig();const reach=PenMachine.reachable(PenMachineUI.getProfile(),before.machine);if(!reach)throw Error('请先设置笔架位置');
  const backing=B.capture(before,reach,$('backingName').value),saved=B.library(JSON.parse(old||'[]')).filter(b=>B.key(b.machine)!==B.key(before.machine));if(saved.length>=12)throw Error('已保存的底板过多');saved.push(backing);
  const next=before.alignmentReturn?A.restore(before):before;next.backing=backing;next.alignment={...A.settings(next),visible:true};
  localStorage.setItem(B.STORE,JSON.stringify(saved));PenStudio.replaceProject(next);await window.PenDesktop?.flush();
  $('backingStatus').textContent='已保存「'+backing.name+'」。下次打开自动恢复；可以摆放纸张继续画。';
  $('alignmentPlaceTab').click();
 }catch(e){if(old===null)localStorage.removeItem(B.STORE);else localStorage.setItem(B.STORE,old);PenStudio.replaceProject(before);$('backingStatus').textContent='保存未完成：'+e.message;}finally{pending=false;render();}};
 window.addEventListener('penconnection',e=>{busy=!!e.detail.busy;$('backingSave').disabled=busy||pending;$('backingName').disabled=busy||pending;});window.addEventListener('penstudiochange',render);window.addEventListener('penpagechange',render);render();
})();
