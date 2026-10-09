'use strict';
// This exact storage diagnostic does not describe the motion system. It may
// only be separated from motion faults when the full HMS list is explicitly
// clear. Every other fault keeps the normal movement block.
// Bambu HMS code bits 31..16 encode level: 4 is informational.
// Unknown/malformed levels remain blocking; do not silently ignore faults.
function blockingHms(state){return Array.isArray(state?.hms)?state.hms.filter(h=>!Number.isInteger(h?.code)||((h.code>>>16)&65535)!==4):[];}
const STORAGE_FAULT=0x0500C010;
function storageFault(state){return state?.print_error===STORAGE_FAULT&&Array.isArray(state.hms)&&blockingHms(state).length===0;}
function motionFaulted(state){return state?.print_error!==0&&!storageFault(state)||!!blockingHms(state).length;}
// FAILED is a terminal result in Bambu Studio, not an active print. When the
// printer has also cleared both task names and its stage, no local stop receipt
// is needed to start a new calibration. This establishes availability only;
// it never establishes XYZ coordinates or a cancelled job's return position.
function clearedFailedTask(state){return state?.gcode_state==='FAILED'&&state.print_error===0&&Array.isArray(state.hms)&&blockingHms(state).length===0&&state.gcode_file===''&&state.subtask_name===''&&state.stg_cur===255;}
function taskIdle(state){return ['IDLE','FINISH'].includes(state?.gcode_state)||clearedFailedTask(state);}
function fileBlockedReason(state){return state?.print_error!==0||blockingHms(state).length?storageFault(state)?'storage_fault':'printer_fault':state?.sdcard!==true?'missing_sdcard':null;}
function assertOperation(state,operation='motion'){
 if(!['motion','file'].includes(operation))throw Error('Printer operation is invalid');
 if(operation==='motion'){if(motionFaulted(state))throw Error('Printer reports a fault');return;}
 const reason=fileBlockedReason(state);
 if(reason==='storage_fault')throw Error('存储卡异常影响整图上传，请使用边画边调整或先处理存储卡');
 if(reason==='printer_fault')throw Error('Printer reports a fault');
 if(reason==='missing_sdcard')throw Error('独立绘画需要打印机中有可用的存储卡');
}
module.exports={blockingHms,STORAGE_FAULT,storageFault,motionFaulted,clearedFailedTask,taskIdle,fileBlockedReason,assertOperation};
