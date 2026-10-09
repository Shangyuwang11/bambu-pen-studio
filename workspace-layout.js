/* A single drawing workspace. Components retain their actions and state;
   layout and routing do not duplicate controls or create a second project. */
(function(){'use strict';
 const $=id=>document.getElementById(id),right=document.querySelector('.right-panel');
 let snapshot=null,wasDrawing=false,lastMultiplier=100,lastSelection=PenStudio.getSelected();
 const make=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n;};
 function fold(id,label,icon,node,open=false){const d=make('details','workspace-fold');d.id=id;d.name='workspace-section';d.open=open;const s=make('summary','');s.append(PenIcons.svg(icon));const title=make('span','');title.textContent=label;s.append(title);d.append(s,node);return d;}
 function reveal(id){PenNativeShell.go('design');const n=$(id);if(!n)return;for(let p=n;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;n.scrollIntoView({block:'nearest'});}
 const scroll=make('div','workspace-settings');scroll.id='workspaceSettings';right.prepend(scroll);
 const inspector=$('objectInspector').closest('section');
 scroll.append(fold('selectionFold','选中内容','edit',inspector,true));
 const paper=$('paperPreset').closest('section'),paperFold=fold('paperFold','纸张与画板','paper',paper);
 paperFold.append(document.querySelector('.model-card'),$('safeX').closest('section'));
 scroll.append(paperFold);
 const library=document.querySelector('.pen-library'),speed=$('drawSpeed').closest('section');
 scroll.append(fold('penLibraryFold','校准配置','pen',library));
 // Show the existing editor at the workspace level, not inside the library.
 const mount=document.querySelector('.mount-card'),oldMountFold=mount.parentElement;
 const mountFold=fold('mountPositionFold','笔架位置','pen',mount);
 scroll.append(mountFold);oldMountFold.remove();
 const mountReadout=make('span','mount-offset-readout');mountReadout.id='mountOffsetReadout';mountFold.querySelector('summary').append(mountReadout);
 const mountQuick=make('button','mount-quick');mountQuick.id='openMountPosition';mountQuick.type='button';mountQuick.append(PenIcons.svg('pen'));
 const quickLabel=make('span','');quickLabel.textContent='笔架位置';mountQuick.append(quickLabel);document.querySelector('.workspace-config').append(mountQuick);
 mountQuick.onclick=()=>reveal('mountPositionFold');
 speed.classList.add('workspace-speed');scroll.append(speed);
 const task=$('taskPanel'),card=document.querySelector('.task-card');
 task.classList.add('workspace-task');task.prepend(card);
 const live=document.querySelector('.live-card'),levels=live.querySelector('.speed-levels');
 const liveSpeed=make('div','workspace-live-speed');liveSpeed.id='workspaceLiveSpeed';
 const liveTitle=make('strong','');liveTitle.textContent='当前任务倍率';
 const speedReadout=make('p','workspace-speed-readout');speedReadout.id='liveSpeedReadout';speedReadout.setAttribute('role','status');
 liveSpeed.append(liveTitle,levels,speedReadout,$('liveSpeedNote'));
 const speedDetails=$('speedSettings'),base=make('div','workspace-base-speed');base.id='workspaceBaseSpeed';
 const speedCard=speedDetails.querySelector('.speed-card');
 const baseTitle=make('p','workspace-speed-context');baseTitle.id='speedContext';
 speedDetails.querySelector('summary').textContent='速度';speedDetails.name='workspace-section';
 speedDetails.insertBefore(baseTitle,speedCard);speedDetails.insertBefore($('extremeQuick'),speedCard);speedDetails.insertBefore(liveSpeed,speedCard);
 base.append(speedCard);speedDetails.append(base);
 const heightTitle=live.querySelector('h2');heightTitle.textContent='笔高微调';
 live.classList.add('workspace-live-height');card.append(live);
 // One reset control. A second firmware-speed card in the send area used to
 // suggest there were two different speed settings.
 $('taskFirmware').classList.add('retired-control');
 const advanced=make('details','workspace-fold workspace-extras');advanced.innerHTML='<summary>导出与诊断</summary>';
 for(const n of [...task.children])if(n!==card&&n.id!=='taskModelSupport')advanced.append(n);
 scroll.append(advanced);if($('taskModelSupport'))card.prepend($('taskModelSupport'));
 // setupPanel remains an empty compatibility route container; it has no page.
 $('setupPanel').classList.add('retired-control');
 // Keep legacy status targets mounted for the existing connection controller.
 const retained=make('div','retired-control');for(const n of [...right.children])if(n!==scroll)retained.append(n);
 right.replaceChildren(scroll,task,retained);
 scroll.insertBefore(paperFold,$('selectionFold'));scroll.insertBefore($('penLibraryFold'),$('selectionFold'));scroll.insertBefore(mountFold,$('selectionFold'));scroll.insertBefore(speed,$('selectionFold'));
 for(const id of ['stepPreview','stepSend'])$(id).hidden=true;
 // Key corrective actions need a visible caption, not just a hover-only icon.
 for(const id of ['retrace','editImageConversion','lanStop']){
  const n=$(id);n.classList.add('labelled-action');
  if(!n.querySelector('.button-caption')){const s=make('span','button-caption');s.textContent=n.getAttribute('aria-label');n.append(s);}
 }
 const rate=$('playSpeed');rate.setAttribute('aria-label','仅预演播放速度，不影响打印机');
 PenNativeShell.tip(rate,'仅加快屏幕上的预演，不改变打印机速度');
 const playbackLabel=make('span','playback-label');playbackLabel.textContent='预演';rate.before(playbackLabel);
 const sendTitle=card.querySelector('h2');sendTitle.textContent='绘画任务';
 $('taskMode').options[0].textContent='连续绘画 · 整图上传';
 $('taskMode').options[1].textContent='在线微调 · 分段发送';
 const modeHelp=make('p','workspace-mode-help');modeHelp.id='workspaceModeHelp';
 $('modeCaption').after(modeHelp);
 function refresh(){
  const p=PenMachineUI.getProfile(),same=PenMachine.machineMatch(p.machine,PenStudio.getSettings().machine),front=same&&p.xSign===1&&p.ySign===-1&&Number.isFinite(p.machineY)?PenCore.round((p.machineY+p.refY-p.machine.h)/10):null;
  mountReadout.textContent=front===null?'待设置':'前方 '+front+' cm';mountQuick.title='笔尖相对喷嘴的位置 · '+mountReadout.textContent;mountQuick.setAttribute('aria-label',mountQuick.title);
  const drawing=!!snapshot?.busy&&(snapshot?.localBusy||snapshot?.fileTask||snapshot?.tuning),active=!!drawing;
  liveSpeed.hidden=!active;live.hidden=!active;
  base.hidden=active;
  baseTitle.textContent=active?'绘画中：下方倍率只作用于当前任务。':'基础速度 · 下次发送时使用';
  const rates={1:50,2:100,3:124,4:166},fileTask=snapshot?.fileTask,tune=snapshot?.tuning,applied=fileTask?fileTask.observedSpeed:tune?.appliedLevel,requested=fileTask?fileTask.requestedSpeed:tune?.level;
  speedReadout.textContent=(rates[applied]?'已应用 '+rates[applied]+'%':'等待打印机回报倍率')+(rates[requested]&&requested!==applied?' → '+rates[requested]+'% 待生效':'');
  const file=!!snapshot?.fileTask||(!snapshot?.busy&&$('taskMode').value==='file');
  modeHelp.textContent=file?'确认位置未变即可发送；打印机确认开始后，电脑可断开。':'需要边画边调笔高时使用；数据分段确认，会有通信停顿。';
  $('modeCaption').hidden=true;
  if(active&&!wasDrawing)speedDetails.open=true;
  const multiplier=snapshot?.printer?.state?.spd_mag;
  if(snapshot?.printer?.connected&&!snapshot.busy&&multiplier!==100&&multiplier!==lastMultiplier)speedDetails.open=true;
  lastMultiplier=multiplier;
  wasDrawing=active;
  // The preset summary is read-only; all editable speed controls live here.
  $('editDrawingStyle').setAttribute('aria-label',active?'调整当前任务速度':'设置绘画速度');
  $('workspacePen').closest('.config-item').classList.toggle('is-busy',active);
 }
 for(const event of ['penstudiochange','penmachinechange'])window.addEventListener(event,refresh);
 window.addEventListener('penstudiochange',()=>{const selected=PenStudio.getSelected();if(selected!==lastSelection){lastSelection=selected;if(selected==='paper')$('paperFold').open=true;}});
 window.addEventListener('penconnection',e=>{snapshot=e.detail;refresh();});
 $('taskMode').addEventListener('change',refresh);
 window.PenWorkspaceUI={reveal};refresh();
 PenSimpleUI.page(document.body.dataset.page||'design');
})();
