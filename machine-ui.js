(function(){
 'use strict';
 const M=PenMachine,$=id=>document.getElementById(id),KEY='a1-pen-machine-profile-v1';
 const fields=['name','material','refX','refY','machineX','machineY','xSign','ySign','downZ','upZ','zSpeed','liftSpeed'];
 let recoveryPending=false;
 let profile=M.defaults(PenStudio.getSettings()),notice='参数单独保存在本机，不会随作品导入自动覆盖。';
 try{const raw=localStorage.getItem(KEY);if(raw)profile=M.validateProfile(JSON.parse(raw));}catch{recoveryPending=true;notice='旧笔架参数无法恢复，原数据已保留。请重新填写或导入备份。';}
 const get=()=>PenStudio.getState();
 function fill(){const spec=PenPrinterModels.specs[profile.machine.model];for(const k of ['downZ','upZ'])$('mc_'+k).max=spec?.z||256;$('mc_liftSpeed').max=spec?.lift||30;for(const k of fields)$('mc_'+k).value=profile[k]??'';$('mc_confirmed').checked=profile.confirmed;$('xyReferenceMeasured').checked=profile.xyReference==='measured';if(profile.xyReference==='measured'&&profile.xSign===1&&profile.ySign===-1){$('frontPenDistance').value=PenCore.round(profile.machineY+profile.refY-profile.machine.h);$('lateralPenDistance').value=PenCore.round(profile.refX-profile.machineX);}}
 function read(){const p={...profile};for(const k of fields){const v=$('mc_'+k).value;p[k]=['name','material'].includes(k)?v:v.trim()===''?null:Number(v);}p.confirmed=$('mc_confirmed').checked;return p;}
 function status(text){$('machineNotice').textContent=text;}
 function refresh(){
  if(!$('machineDialog').open)return;
  profile=read();const s=get(),r=M.projectDesign(s,profile,PenStudio.getPlan());
  $('machinePaperSummary').textContent=`当前纸张 ${s.paper.w} × ${s.paper.h} mm · 距画板左侧 ${s.paper.x} mm / 顶部 ${s.paper.y} mm · 留白 ${s.paper.margin} mm`;
  $('machineBinding').textContent=`参数对应 ${PenCore.profiles[profile.machine.model].name} · ${profile.machine.w} × ${profile.machine.h} mm · 板面 ${ {smooth:'光面',textured:'纹理',custom:'自定义'}[profile.machine.plate] }`;
  $('machineErrors').textContent=r.errors.length?r.errors.join('；'):profile.confirmed?'坐标与数值检查通过。连接发送前，还需核对本次已知的喷嘴位置与抬笔路线。':'可以预览坐标；请完成实测后再确认参数。';
  $('machineErrors').classList.toggle('error',r.errors.length>0);
  $('machineStart').textContent=r.start?`绘图段要求的起始喷嘴位置：X ${r.start.x} / Y ${r.start.y} / Z ${r.start.z} mm。执行前须已归零并定位到此处。`:'填写参考点和 Z 高度后，将显示绘图段起点。';
  $('machineRange').textContent=r.bounds?`喷嘴路径范围 X ${PenCore.round(r.bounds.x)}–${PenCore.round(r.bounds.x+r.bounds.w)} / Y ${PenCore.round(r.bounds.y)}–${PenCore.round(r.bounds.y+r.bounds.h)} mm；有效位置补偿 X ${r.offset.x} / Y ${r.offset.y} mm。`:'';
  const localTest=profile.xyReference==='local-test';$('xyReferenceStatus').textContent=localTest?'XY未对位：旧Hello World局部试写基准不能当作夹具偏移。高度校准不会修正这个位置。':profile.xyReference==='measured'?'XY来源：已记录实际对位参数。当前画板到喷嘴补偿 X '+PenCore.round(profile.machineX-profile.xSign*profile.refX)+' / Y '+PenCore.round(profile.machineY-profile.ySign*profile.refY)+' mm。':'XY来源：参考点参数，请核对后记录实际对位。';if(localTest)$('machineErrors').textContent='请先建立真实XY参考，当前只能查看局部试写预览。';$('downloadGcode').disabled=r.errors.length>0||!profile.confirmed||localTest;
  $('gcodeText').value=localTest?'旧局部试写参考不可导出为整页对位任务。':r.errors.length?'待填写参数或修复范围问题。':M.toGcode(s,{...profile,confirmed:true}).split('\n').slice(0,100).join('\n')+'\n; Preview limited to 100 lines; download contains all strokes.';
  $('machinePreviewBadge').textContent=profile.confirmed?'绘图段预览 · 无自动发送':'未实测参数预览 · 禁止作为已校准任务执行';
  draw(r,s);window.dispatchEvent(new Event('penmachinechange'));
 }
 function draw(r,s){const c=$('machineCanvas'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);const pad=27,k=Math.min((c.width-2*pad)/s.machine.w,(c.height-2*pad)/s.machine.h),P=v=>[pad+v[0]*k,c.height-pad-v[1]*k];
  x.fillStyle='#edf1e9';x.fillRect(pad,c.height-pad-s.machine.h*k,s.machine.w*k,s.machine.h*k);x.strokeStyle='#c5d0c6';x.strokeRect(pad,c.height-pad-s.machine.h*k,s.machine.w*k,s.machine.h*k);
  x.fillStyle='#60786a';x.font='12px sans-serif';x.fillText(window.PenI18n?.t('喷嘴机器坐标 · X → / Y ↑')||'喷嘴机器坐标 · X → / Y ↑',pad,16);
  let previous=null;x.lineWidth=1;
  for(const path of r.paths){const first=P(path.points[0]);if(previous){x.beginPath();x.setLineDash([3,4]);x.strokeStyle='#c2a363';x.moveTo(...previous);x.lineTo(...first);x.stroke();}x.setLineDash([]);x.strokeStyle=r.errors.length?'#b34b40':'#17684e';x.beginPath();path.points.forEach((v,i)=>{const q=P(v);i?x.lineTo(...q):x.moveTo(...q)});x.stroke();previous=P(path.points.at(-1));}
  if(r.start){const q=P([r.start.x,r.start.y]);x.beginPath();x.fillStyle='#d09832';x.arc(...q,4,0,Math.PI*2);x.fill();}x.setLineDash([]);
 }
 function open(){if($('exportDialog').open)$('exportDialog').close();fill();status(notice);$('machineDialog').showModal();refresh();}
 function download(name,data,type){const u=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
 $('machineSetup').onclick=open;$('machineFromDialog').onclick=open;$('closeMachine').onclick=()=>$('machineDialog').close();
 for(const k of fields)$('mc_'+k).addEventListener('input',()=>{if(!['name','material','zSpeed','liftSpeed'].includes(k))$('mc_confirmed').checked=false;refresh();});
 $('mc_confirmed').onchange=refresh;
 $('xyReferenceMeasured').onchange=()=>{profile.xyReference=$('xyReferenceMeasured').checked?'measured':'local-test';$('mc_confirmed').checked=false;refresh();};
 $('applyFrontMount').onclick=()=>{try{const previous=read(),next=M.fromFrontMount(previous,Number($('frontPenDistance').value),Number($('lateralPenDistance').value));setProfile(next,previous.confirmed);status('笔架偏移已应用，原笔高与确认状态保留；保存到校准配置后可重复使用。');}catch(e){status(e.message)}};
 $('usePaperReference').onclick=()=>{const s=get();$('mc_refX').value=s.paper.x;$('mc_refY').value=s.paper.y;$('mc_confirmed').checked=false;refresh();status('已填写画板参考点；对应喷嘴 X/Y 仍需实测。移动纸张不会自动改变这个固定参考点。');};
 $('bindMachine').onclick=()=>{profile=M.defaults(get());fill();refresh();status('已按当前机型新建空白参数，原实测值已清空；保存前不会覆盖本机旧参数。');};
 $('saveMachineProfile').onclick=async()=>{try{profile=M.validateProfile(read());if(window.PenProfilesUI){$('machineDialog').close();await PenProfilesUI.saveReference(profile);}else localStorage.setItem(KEY,JSON.stringify(profile));recoveryPending=false;status('请在保存窗口确认这套校准配置。');}catch(e){status('保存失败：'+e.message)}};
 $('exportMachineProfile').onclick=()=>{try{download('校准配置.penprofile.json',JSON.stringify(M.validateProfile(read()),null,2),'application/json');status('已导出笔架参数备份，里面没有访问码。');}catch(e){status(e.message)}};
 $('importMachineProfile').onclick=()=>$('machineProfileFile').click();
 $('machineProfileFile').onchange=async()=>{const f=$('machineProfileFile').files[0];$('machineProfileFile').value='';if(!f)return;try{if(f.size>20000)throw Error('笔架参数文件过大');const next=M.validateProfile(JSON.parse(await f.text()));next.confirmed=false;profile=next;fill();refresh();window.dispatchEvent(new Event('penmachinechange'));status('参数已导入；请核对当前机型、笔架和纸张后重新确认实测状态。');}catch(e){status('导入失败：'+e.message)}};
 $('downloadGcode').onclick=async()=>{try{await PenStudio.ensureImagePaths();const code=M.toGcode(get(),read());download('纸上绘图段.gcode',code,'text/plain');status('已导出绘图段。没有发送到打印机，也没有生成独立的 Bambu 任务包。');}catch(e){status('导出被阻止：'+e.message);refresh();}};
 window.addEventListener('penstudiochange',refresh);
 fill();
 function setProfile(value,confirmed=false,options={}){profile=M.validateProfile({...value,confirmed});fill();refresh();if(!recoveryPending&&options.persist!==false)localStorage.setItem(KEY,JSON.stringify(window.PenProfilesUI?.persistentProfile()||profile));window.dispatchEvent(new Event('penmachinechange'));return profile;}
 function mountSummary(){try{const p=M.validateProfile(read()),r=M.projectDesign(get(),p,PenStudio.getPlan());$('mountSummary').textContent=p.xyReference==='local-test'?'XY仍为旧局部试写基准，请设置真实笔尖偏移。':p.xyReference==='measured'&&p.xSign===1&&p.ySign===-1?'笔尖前向 '+PenCore.round(p.machineY+p.refY-p.machine.h)+' mm · 横向 '+PenCore.round(p.refX-p.machineX)+' mm'+(r.errors.length?'；'+r.errors.join('；'):''):'';}catch{}}window.addEventListener('penmachinechange',mountSummary);window.addEventListener('penstudiochange',mountSummary);mountSummary();
 window.PenMachineUI={isRecoveryPending:()=>recoveryPending,resolveRecovery:()=>{recoveryPending=false;},getProfile:()=>M.validateProfile(read()),setProfile,markChanged:()=>setProfile(read(),false)};window.dispatchEvent(new Event('penmachinechange'));
})();
