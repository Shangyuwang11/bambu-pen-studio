'use strict';
const M=require('../machine.js'),cal=require('./calibration.cjs');
function validate(v){
 if(v?.version!==1||!/^[A-Za-z0-9]{10,30}$/.test(v.serial))throw Error('笔高参考无效');
 const profile=M.validateProfile(v.profile),calibrationPoint=cal.position(v.calibrationPoint);
 if(profile.machine.model!=='a1-mini'||!profile.confirmed||!Number.isFinite(profile.downZ)||!Number.isFinite(profile.upZ)||profile.downZ<0||profile.upZ>180||profile.upZ-profile.downZ<.5||Math.abs(calibrationPoint.z-profile.downZ)>.001)throw Error('笔高参考不完整');
 return{version:1,serial:v.serial,profile,calibrationPoint,...(v.returnTo?{returnTo:cal.position(v.returnTo)}:{})};
}
// A saved contact plane is a reference, never proof of the machine's current XYZ.
function createMemory({load=()=>null,save=()=>{}}={}){
 let reference=null,error='';try{const v=load();if(v)reference=validate(v);}catch{error='上次笔高参考无法恢复';}
 function remember(wizard,serial){if(wizard?.phase!=='complete'||!wizard.contact)return;try{reference=validate({version:1,serial,profile:wizard.profile,calibrationPoint:wizard.calibrationPoint,returnTo:wizard.returnTo});save(reference);error='';}catch{error='笔高参考未能备份到本机';}}
 function forDevice(serial){return reference?.serial===serial?structuredClone(reference):null;}
 function clear(){reference=null;error='';try{save(null);}catch{error='旧的未保存的校准参考参考未能从本机移除';}}
 return{remember,forDevice,clear,error:()=>error};
}
module.exports={createMemory,validate};
