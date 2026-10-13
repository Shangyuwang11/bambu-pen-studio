'use strict';
const M=require('../machine.js'),cal=require('./calibration.cjs'),Policy=require('./printer-policy.cjs');
function signature(p){const q=M.validateProfile(p);return JSON.stringify([q.machine,q.refX,q.refY,q.machineX,q.machineY,q.xSign,q.ySign,q.downZ,q.upZ]);}
function validate(r){if(!r||r.version!==1||!/^[A-Za-z0-9]{10,30}$/.test(r.serial)||!Number.isInteger(r.homeFlag)||(r.homeFlag&7)!==7||typeof r.signature!=='string')throw Error('上次位置记录无效');return {...r,position:cal.position(r.position,r.model)};}
function allowed(r,serial,state,profile){try{validate(r);return r.serial===serial&&Number.isInteger(state.home_flag)&&(state.home_flag&7)===7&&Policy.taskIdle(state)&&Array.isArray(state.hms)&&!Policy.motionFaulted(state)&&(state.gcode_file||'')===r.file&&(state.subtask_name||'')===r.task&&signature(profile)===r.signature&&r.position.z>=profile.upZ;}catch{return false;}}
function create({load=()=>null,save=()=>{}}={}){let value=null,key='';try{const v=load();if(v){value=validate(v);key=JSON.stringify(value);}}catch{}
 return {get:()=>value&&structuredClone(value),clear(){value=null;key='';save(null);},record(serial,state,position,profile){if(!position||!profile||!Number.isInteger(state.home_flag)||(state.home_flag&7)!==7||!Policy.taskIdle(state)||!Array.isArray(state.hms)||Policy.motionFaulted(state)||position.z<profile.upZ)return;const next=validate({version:1,serial,model:profile.machine.model,position,homeFlag:state.home_flag,file:state.gcode_file||'',task:state.subtask_name||'',signature:signature(profile)}),encoded=JSON.stringify(next);if(encoded!==key){save(next);value=next;key=encoded;}}};
}
module.exports={create,allowed,signature,validate};
