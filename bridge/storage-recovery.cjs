'use strict';
const Policy=require('./printer-policy.cjs'),{Ftps}=require('./ftps.cjs');
const FIELDS=['gcode_state','print_error','hms','sdcard','nozzle_temper','nozzle_target_temper','bed_temper','bed_target_temper'];
async function recheckStorage({printer,access,ftpFactory=options=>new Ftps(options)}){
 if(!printer?.connected)throw Error('请先连接打印机');
 const ready=async()=>{await printer.fresh({force:true,fields:FIELDS});printer.idle({operation:'motion'});if(printer.state.sdcard!==true)throw Error('打印机尚未检测到存储卡');if(!Array.isArray(printer.state.hms)||printer.state.hms.length)throw Error('请先在机器上处理故障');if(![0,Policy.STORAGE_FAULT].includes(printer.state.print_error))throw Error('当前错误不能通过存储检查解除');};
 await ready();const ftp=ftpFactory(printer.options);let storage;
 try{await ftp.connect();await ftp.login(access);storage=await ftp.probeStorage();if(ftp.finish)await ftp.finish();}finally{ftp.close();}
 await ready();const errorCleared=Policy.storageFault(printer.state);
 if(errorCleared){await printer.acknowledgeStorageError();await ready();if(printer.state.print_error!==0)throw Error('存储卡读写正常，但打印机错误仍未解除');}
 return{...storage,errorCleared,checkedAt:Date.now()};
}
module.exports={recheckStorage,FIELDS};
