/* Shared error guidance and bounded, public feedback payloads. */
(function(root){'use strict';
 const REPO='Shangyuwang11/bambu-pen-studio',MAX_BYTES=16384;
 const rules=[
 ['model','settings',/机型.*不一致|机型.*不匹配|仅核对了|尚未适配|请选择.*A1|未返回完整机型/i,'检查打印机型号','Check the printer model','在打印机页选择实际机型，使用对应的画布与校准配置。','Select the actual model on the Printer page and use a matching canvas and calibration profile.','devices'],
 ['credentials','settings',/访问码|序列号|IPv4|login rejected|not authorized|authentication/i,'检查连接资料','Check connection details','在打印机页核对 IP、序列号、访问码，并确认打印机已开启所需的局域网访问。','Check IP, serial and access code on the Printer page, and enable the required LAN access.','devices'],
 ['calibration','settings',/请先.*校准|请先.*归零|坐标.*恢复|归零状态|请.*纸.*笔|请.*装.*笔|抬笔.*高度|笔高.*变化|请先选择.*配置|路线.*核对/i,'检查校准配置','Check calibration','打开校准页查看缺少的步骤或选择对应配置；软件不会自动归零或移动。','Open Calibrate to check the missing step or choose the matching profile. No homing or movement is triggered automatically.','calibration'],
 ['layout','settings',/超出.*行程|超出.*范围|范围.*无效|超出.*留白|超出.*可写|速度.*超过|速度.*范围|请输入|请填写|参数.*无效|缺少.*参数|文件.*请小于|作品超过|路径.*为空|重新生成路径|转换参数已改变/i,'调整当前设置','Adjust settings','检查提示涉及的纸张、图案、速度或数值范围，修改后再试。','Check the paper, artwork, speed or numeric range mentioned in the message, then retry.','design'],
 ['busy','printer',/当前动作.*完成|任务.*尚未结束|正在执行|当前.*任务.*进行|机器忙|Printer.*busy/i,'打印机还在处理任务','Printer is still busy','先刷新机器状态；若任务仍在运行，等待结束或使用现有停止按钮。','Refresh printer status. If a task is still running, wait or use the existing Stop button.','refresh'],
 ['network','connection',/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ENOTFOUND|连接.*中断|连接.*超时|连接.*失败|请先连接|network|offline|disconnected/i,'检查网络连接','Check the network','确认电脑与打印机在同一局域网，再到打印机页刷新状态或重连。','Check that the computer and printer share a LAN, then refresh or reconnect on the Printer page.','devices'],
 ['storage','unknown',/0500.C010|50348044|存储卡|文件任务.*失败|文件.*读回.*失败/i,'任务文件或存储异常','Task file or storage problem','先到打印机页查看存储状态；这不一定是卡损坏。若重复出现，可提交报告。','Check storage status on the Printer page. This does not necessarily mean a damaged card. Report it if it recurs.','devices'],
 ['hardware','printer',/喷嘴.*温度|热床.*温度|温度.*高|冷却|HMS|打印机.*故障|速度倍率|保持.*倍率/i,'检查机器状态','Check printer status','查看打印机屏幕上的具体提示，并在软件中刷新状态。','Check the printer screen for details, then refresh status in the app.','refresh']
 ];
 function cleanError(value){return String(value?.message??value??'').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'').slice(0,6000);}
 function classify(value,{source='',code=''}={}){
  const message=cleanError(value),runtime=/TypeError|ReferenceError|SyntaxError|RangeError|Cannot read propert|is not a function|is not defined|ERR_ASSERTION|Unhandled/i.test(message)||source==='runtime',r=runtime?null:rules.find(r=>r[2].test(message));
  if(r)return{id:r[0],kind:r[1],title:{zh:r[3],en:r[4]},advice:{zh:r[5],en:r[6]},action:r[7],reportable:r[1]==='unknown',code:code||r[0]};
  return{id:runtime?'software':'unknown',kind:runtime?'software':'unknown',title:{zh:runtime?'程序发生异常':'这个问题需要进一步检查',en:runtime?'Application error':'This needs a closer look'},advice:{zh:'可以生成问题报告，查看内容后提交给开发者。当前作品不会附在报告里。',en:'Create a report and review it before submitting. Your artwork is not attached.'},action:null,reportable:true,code:code||(runtime?'runtime':'unknown')};
 }
 function redact(value,secrets=[]){
  let s=String(value??'').slice(0,12000);
  s=s.replace(/data:[^,\s]{0,120},[A-Za-z0-9+/=._%-]+/gi,'[image data removed]')
   .replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g,'[token removed]')
   .replace(/\b(?:Bearer|Basic)\s+\S+/gi,'[credential removed]')
   .replace(/((?:access[_ -]?code|password|token|secret|serial(?:[_ -]?number)?|sn|api[_ -]?key|authorization|访问码|密码|序列号)\s*["']?\s*[:=：]\s*)["']?[^\s,;"'}]+/gi,'$1[redacted]')
   .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g,'[IP removed]')
   .replace(/\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:]{0,39}\b/gi,'[IP removed]')
   .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email removed]')
   .replace(/https?:\/\/[^\s)>\]]+/gi,'[URL removed]')
   .replace(/\b[A-Z]:[\\/][^\r\n<>"]+/gi,'[local path removed]')
   .replace(/\/(?:Users|home|tmp|var|mnt)\/[^\r\n<>"]+/g,'[local path removed]')
   .replace(/\b\d{8,}\b/g,'[number removed]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
   .trim();
  for(const secret of secrets.filter(v=>typeof v==='string'&&v.length>=3).sort((a,b)=>b.length-a.length))s=s.split(secret).join('[redacted]');
  return s.replace(/@/g,'＠').replace(/\x60/g,"'");
 }
 // Budget escaped JSON bytes, including non-ASCII text, before crossing IPC.
 function bounded(text,budget){let out='',size=0;const encoder=new TextEncoder();for(const c of text){const bytes=encoder.encode(JSON.stringify(c)).length-2;if(size+bytes>budget)break;out+=c;size+=bytes;}return out;}
 function normalize(v,secrets=[]){
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_REPORT');
  const short=(text,n)=>bounded(redact(text,secrets),n),kind=['software','unknown','settings','connection','printer'].includes(v.category)?v.category:'unknown',token=(v,n)=>typeof v==='string'&&redact(v,secrets)===v&&new RegExp('^[A-Za-z0-9_. -]{1,'+n+'}$').test(v)?v:'unknown';
  return{schema:1,version:typeof v.version==='string'&&v.version.length<=64&&/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(v.version)?v.version:'unknown',platform:token(v.platform,50),locale:v.locale==='en'?'en':'zh-CN',model:['a1-mini','a1','p1s','custom'].includes(v.model)?v.model:'unknown',category:kind,code:token(v.code,64),message:short(v.message,4096),steps:short(v.steps,6144),...(v.diagnostics===true?{diagnostics:true,stack:short(v.stack,3072),printerState:['IDLE','FINISH','FAILED','RUNNING','PREPARE','PAUSE','SLICING'].includes(v.printerState)?v.printerState:'unknown'}:{diagnostics:false})};
 }
 function markdown(r){const block=s=>'~~~text\n'+String(s||'—').replace(/~/g,'-')+'\n~~~';return 'Bambu Pen problem report\n\nVersion: '+r.version+'\nPlatform: '+r.platform+'\nPrinter model: '+r.model+'\nCategory: '+r.category+'\nCode: '+r.code+'\n\nError\n'+block(r.message)+'\n\nWhat happened\n'+block(r.steps)+(r.diagnostics?'\n\nApplication stack\n'+block(r.stack)+'\nPrinter state: '+r.printerState:'')+'\n\nSubmitted after user review. No artwork, printer credentials, IP or serial is intentionally collected.\n';}
 const api={REPO,MAX_BYTES,classify,cleanError,redact,normalize,markdown};root.PenFeedbackPolicy=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

