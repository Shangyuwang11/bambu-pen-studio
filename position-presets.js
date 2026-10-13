(function(root){'use strict';
 const M=root.PenMachine||(typeof require==='function'?require('./machine.js'):null),icons=['pen','pencil','marker','brush'],Models=root.PenPrinterModels||(typeof require==='function'?require('./printer-models.js'):null),point=(p,model)=>Models.point(p,model);
 function name(v){const n=String(v??'').trim();if(!n||n.length>48)throw Error('请填写 1–48 个字的校准配置名称');return n;}
 function penSettings(v){
  if(v==null)return null;if(typeof v!=='object'||Array.isArray(v))throw Error('配置中的绘画参数无效');
  const Policy=root.PenSpeedPolicy||(typeof require==='function'?require('./speed-policy.js'):null),cap=Policy.limits(v),settings={speedMode:Policy.mode(v)},ranges={width:[.1,Infinity],drawSpeed:[1,cap.draw],travelSpeed:[1,cap.travel],lift:[.5,10]};
  for(const[k,[lo,hi]]of Object.entries(ranges)){if(!Number.isFinite(v[k])||v[k]<lo||v[k]>hi)throw Error('配置中的绘画参数 '+k+' 超出范围');settings[k]=v[k];}
  if(!['off','quality','balanced'].includes(v.optimization))throw Error('配置中的路径优化参数无效');settings.optimization=v.optimization;return settings;
 }
 function validate(v){
  if(!v||typeof v.id!=='string'||!/^preset_[a-z0-9_-]{1,60}$/.test(v.id))throw Error('预设标识无效');
  const profile=M.validateProfile(v.profile),modern=v.version===2;
  if(!Number.isFinite(profile.downZ)||!Number.isFinite(profile.upZ)||profile.downZ<0||profile.upZ>Models.get(profile.machine.model).z||profile.upZ-profile.downZ<.5-1e-7)throw Error('请先校准笔的接触高度');
  const calibrationPoint=modern&&v.calibrationPoint==null?null:point(v.calibrationPoint,profile.machine.model),returnTo=modern&&v.returnTo==null?null:point(v.returnTo,profile.machine.model),position=modern&&v.position==null?null:point(v.position,profile.machine.model);
  if(calibrationPoint&&Math.abs(calibrationPoint.z-profile.downZ)>.001||returnTo&&returnTo.z<profile.upZ)throw Error('预设高度与校准点不一致');
  if(v.serial!=null&&!/^[A-Za-z0-9]{10,30}$/.test(v.serial))throw Error('校准配置的打印机身份无效');
  return{version:2,id:v.id,name:name(v.name||'校准配置'),icon:icons.includes(v.icon)?v.icon:'pen',serial:v.serial||null,profile:{...profile,name:name(v.name||'校准配置'),confirmed:false},penSettings:penSettings(v.penSettings),position,calibrationPoint,returnTo,savedAt:Number.isFinite(v.savedAt)?v.savedAt:0};
 }
 function id(){return'preset_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
 function capture(s,label,options={}){if(s.busy||s.wizard?.phase!=='complete')throw Error('请先校准这支笔并等待机器停稳');const w=s.wizard,p=options.profile||w.profile;if(p.downZ!==w.profile.downZ||p.upZ!==w.profile.upZ||!M.machineMatch(p.machine,w.profile.machine))throw Error('当前配置与已测笔高不一致');return validate({version:2,id:options.id||id(),name:label,icon:options.icon,serial:s.device?.serial||null,profile:p,penSettings:options.penSettings,position:s.position||null,calibrationPoint:w.calibrationPoint,returnTo:w.returnTo,savedAt:Date.now()});}
 function legacy(profile){return validate({version:2,id:id(),name:profile.name||'原有笔架',profile,calibrationPoint:null,returnTo:null,position:null,savedAt:Date.now()});}
 root.PenPositionPresets={validate,capture,point,legacy,name,icons,penSettings};if(typeof module!=='undefined')module.exports=root.PenPositionPresets;
})(typeof window!=='undefined'?window:globalThis);
