/* Workspace organization, shared machine status, and a single object editor. */
(function(){'use strict';
 const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
 const refreshButtons=[],messages=[];let refreshing=false,refreshError='',lastRead=0;
 function refreshControl(parent,id){const wrap=make('div','machine-refresh'),button=make('button','status-refresh','刷新状态');button.id=id;button.type='button';button.prepend(PenIcons.svg('refresh'));button.title='向打印机重新读取状态，不移动机器';const text=make('span','refresh-result');text.setAttribute('role','status');wrap.append(button,text);parent.append(wrap);refreshButtons.push(button);messages.push(text);button.onclick=()=>refresh(true);}
 refreshControl(document.querySelector('.cal-page-actions'),'calRefreshStatus');
 refreshControl($('deviceHeaderActions'),'deviceRefreshStatus');
 refreshControl(document.querySelector('.app-status'),'workspaceRefreshStatus');
 function display(message){for(const b of refreshButtons){b.disabled=refreshing;b.setAttribute('aria-busy',String(refreshing));}for(const n of messages){n.textContent=message;n.classList.toggle('error',!!refreshError);}}
 async function refresh(force){if(refreshing)return;refreshing=true;refreshError='';display('正在读取…');try{const s=await PenConnection.refreshStatus({force});lastRead=Date.now();display(s.printer?.connected?'已更新 '+new Date(lastRead).toLocaleTimeString('zh-CN',{hour12:false}):'未连接打印机');}catch(e){refreshError=e.message;display('刷新失败：'+e.message);}finally{refreshing=false;for(const b of refreshButtons){b.disabled=false;b.setAttribute('aria-busy','false');}}}
 window.addEventListener('penconnection',e=>{if(!refreshing&&!refreshError){const p=e.detail.printer;display(p?.connected?(p.ageMs>10000?'机器回报较早，请刷新':'状态自动更新中'):'未连接打印机');}});
 window.addEventListener('focus',()=>refresh(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
 window.addEventListener('penpagechange',e=>{if(['calibration','devices'].includes(e.detail))refresh(true);});
 // Reuse the existing controls and listeners: no second copy of object state.
 const fold=$('selectionFold'),section=$('objectInspector').closest('section'),dialog=make('dialog','object-editor');dialog.id='objectEditDialog';dialog.setAttribute('aria-labelledby','objectEditTitle');
 const header=make('div','dialog-header'),title=make('h2','', '编辑元素');title.id='objectEditTitle';const close=make('button','','完成');close.id='closeObjectEditor';close.type='button';header.append(title,close);
 const note=make('p','hint','修改会自动应用到画布；关闭后可用撤销恢复。');dialog.append(header,section,note);document.body.append(dialog);fold.hidden=true;
 let returnFocus=null;close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(returnFocus?.isConnected&&!document.querySelector('dialog:modal'))returnFocus.focus({preventScroll:true});});
 for(const id of ['editImageConversion','editFrame'])$(id)?.addEventListener('click',()=>{if(dialog.open)dialog.close();},{capture:true});
 window.addEventListener('peneditobject',e=>{const obj=PenStudio.getObjectInfo(e.detail.id);if(!obj)return;returnFocus=document.activeElement;title.textContent=obj.type==='text'?'编辑文字':obj.type==='image'?'编辑图片':'编辑图案';if(!dialog.open)dialog.showModal();const focus=obj.type==='text'?$('textContent'):$('objW');focus.focus({preventScroll:true});});
 const edit=make('button','labelled-action','编辑所选');edit.id='editSelectedObject';edit.type='button';edit.prepend(PenIcons.svg('edit'));$('layers').after(edit);edit.onclick=()=>PenStudio.editElement(PenStudio.getSelected());
 const sync=()=>{edit.disabled=!PenStudio.getObjectInfo(PenStudio.getSelected());};window.addEventListener('penstudiochange',sync);$('layers').addEventListener('click',sync);$('canvas').addEventListener('pointerup',sync);sync();
 // Navigation separates artwork tools from physical-machine setup.
 const rail=document.querySelector('.rail-pages');for(const[name,ids]of [['创作',['stepDesign','stepAlignment']],['设备',['stepPrinter','stepCalibration']]]){const group=make('div','rail-tool-group');group.append(make('span','rail-group-label',name));for(const id of ids)group.append($(id));rail.append(group);}
 const add=$('addText').closest('section');add.querySelector('h2').textContent='绘图工具';
 const toolsHint=make('p','hint','右键画布元素或图层，打开编辑窗口。');$('layers').before(toolsHint);
 const scroll=$('workspaceSettings');function group(name,ids){const block=make('div','settings-category');block.append(make('h2','settings-category-title',name));for(const id of ids){const node=$(id);if(node)block.append(node);}return block;}
 // Keep the speed section's complete wrapper so its live-task controls stay intact.
 const speed=$('speedSettings').closest('section');if(speed)speed.id='drawingSpeedSection';
 scroll.prepend(group('画纸与定位',['paperFold']),group('绘画参数',['drawingSpeedSection']),group('设备配置',['penLibraryFold','mountPositionFold']));
 document.querySelector('#paperFold summary span').textContent='纸张、画板与对齐';
 const quick=$('openMountPosition');if(quick)quick.hidden=true;
 document.querySelector('.stage-guide').textContent='拖动定位 · 角点缩放 · 顶点旋转 · 右键编辑';
 window.PenWorkspaceTools={refresh};
})();
