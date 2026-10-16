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
 function identity(selected){
  // Connection identity is chosen by the user, never inferred from firmware.
  // Old saved records without a model need one choice before any network I/O.
  if(!supported(selected)){const choices=Object.keys(specs),error=Error('[MODEL_SELECTION_REQUIRED:'+choices.join(',')+'] 请选择打印机型号：A1 mini、A1 或 P1S');error.code='MODEL_SELECTION_REQUIRED';error.modelOptions=choices;throw error;}
  const m=get(selected);return{model:m.id,source:'selected',name:m.name,tested:m.tested};
 }
 // Electron keeps an IPC error's message but not its custom properties.
 function selectionOptions(error){const match=/\[MODEL_SELECTION_REQUIRED:([a-z0-9,-]+)\]/.exec(String(error?.message||error||''));return match?match[1].split(',').filter(supported):[];}
 root.PenPrinterModels={specs,supported,get,point,identity,selectionOptions};if(typeof module!=='undefined')module.exports=root.PenPrinterModels;
})(typeof window!=='undefined'?window:globalThis);
