'use strict';
const path=require('node:path'),{execFile}=require('node:child_process');
function transform(input,operation){
 if(!Buffer.isBuffer(input)||!input.length||input.length>16384||!['Protect','Unprotect'].includes(operation))return Promise.reject(Error('连接资料加密参数无效'));
 const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $taskBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $taskSalt=[Text.Encoding]::UTF8.GetBytes('A1PenStudio.Printer.v1'); $taskOutput=[Security.Cryptography.ProtectedData]::"+operation+"($taskBytes,$taskSalt,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($taskOutput))";
 return new Promise((resolve,reject)=>{const child=execFile(path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:65536},(error,stdout)=>{if(error)return reject(Error('内置连接资料仅能由原 Windows 用户恢复'));try{const text=stdout.trim();if(!/^[A-Za-z0-9+/=]+$/.test(text))throw Error();resolve(Buffer.from(text,'base64'));}catch{reject(Error('连接资料解密结果无效'));}});child.stdin.on('error',()=>{});child.stdin.end(input.toString('base64'));});
}
module.exports={protect:data=>transform(data,'Protect'),unprotect:data=>transform(data,'Unprotect')};
