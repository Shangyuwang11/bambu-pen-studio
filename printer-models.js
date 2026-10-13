/* Shared machine identity and motion envelope. Keep legacy profiles model-specific. */
(function(root){'use strict';
 const specs=Object.freeze({
  'a1-mini':Object.freeze({id:'a1-mini',name:'A1 mini',project:'N1',hardware:'AP05',w:180,h:180,z:180,minDrawX:0,lift:30,structure:'i3',tested:true,park:Object.freeze({x:100,y:90,z:60})}),
  a1:Object.freeze({id:'a1',name:'A1',project:'N2S',hardware:'AP05',w:256,h:256,z:256,minDrawX:0,lift:30,structure:'i3',tested:false,park:Object.freeze({x:128,y:128,z:60})}),
  // Stock P1S profile keeps Z at 250 and excludes the front-left cutter area.
  // A conservative X >= 18 drawing corridor also keeps straight pen-up trips
  // out of that corner; homing itself remains the firmware's responsibility.
  p1s:Object.freeze({id:'p1s',name:'P1S',project:'C12',hardware:'AP04',w:256,h:256,z:250,minDrawX:18,lift:20,structure:'corexy',tested:false,park:Object.freeze({x:128,y:128,z:60})})
 });
 const supported=model=>Object.hasOwn(specs,model);
 function get(model='a1-mini'){if(!supported(model))throw Error('此机型尚未适配连接与运动：'+String(model));return specs[model];}
 function point(p,model='a1-mini'){const m=get(model),out={};for(const[k,max]of [['x',m.w],['y',m.h],['z',m.z]]){if(!Number.isFinite(p?.[k])||p[k]<0||p[k]>max)throw Error(m.name+' '+k.toUpperCase()+' 坐标超出 0–'+max+' mm');out[k]=p[k];}return out;}
 function detect(modules,selected='auto'){
  if(selected!=='auto'&&!supported(selected))throw Error('请选择 A1 mini、A1 或 P1S');
  const rows=(Array.isArray(modules)?modules:[]).filter(m=>m&&typeof m==='object'),controllers=rows.filter(m=>['esp32','ota'].includes(m.name));
  const projects=[...new Set(controllers.map(m=>String(m.project_name||'').trim().toUpperCase()).filter(Boolean))];
  const known=projects.map(id=>Object.values(specs).find(m=>m.project===id)).filter(Boolean);
  if(new Set(known.map(m=>m.id)).size>1)throw Error('打印机返回的机型信息不一致，请刷新后重连');
  if(known.length){const m=known[0];if(selected!=='auto'&&selected!==m.id)throw Error('实际连接的是 '+m.name+'，与选择的机型不一致');return{model:m.id,source:'reported',name:m.name,tested:m.tested};}
  if(projects.length)throw Error('当前不支持打印机型号 '+projects.join('/')+'；已适配 A1 mini、A1、P1S');
  // AP05 is shared by A1 and A1 mini: hardware alone must never choose the bed.
  const esp=rows.find(m=>m.name==='esp32');
  if(selected!=='auto'&&esp?.hw_ver===get(selected).hardware){const m=get(selected);return{model:m.id,source:'selected',name:m.name,tested:m.tested};}
  const choices=Object.values(specs).filter(m=>m.hardware===esp?.hw_ver).map(m=>m.id);
  if(choices.length){const error=Error('[MODEL_SELECTION_REQUIRED:'+choices.join(',')+'] 打印机未返回完整机型，请选择实际型号继续连接');error.code='MODEL_SELECTION_REQUIRED';error.modelOptions=choices;throw error;}
  throw Error('无法识别此打印机；目前支持 A1 mini、A1、P1S');
 }
 // Electron keeps an IPC error's message but not its custom properties.
 function selectionOptions(error){const match=/\[MODEL_SELECTION_REQUIRED:([a-z0-9,-]+)\]/.exec(String(error?.message||error||''));return match?match[1].split(',').filter(supported):[];}
 root.PenPrinterModels={specs,supported,get,point,detect,selectionOptions};if(typeof module!=='undefined')module.exports=root.PenPrinterModels;
})(typeof window!=='undefined'?window:globalThis);
