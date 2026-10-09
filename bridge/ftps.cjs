'use strict';
// Implicit FTPS, verified printer certificate; no print-start commands.
const tls=require('node:tls'),crypto=require('node:crypto');
class Ftps {
 constructor(options){this.options=options;this.queue=[];this.waiters=[];this.text='';this.multi=null;this.failure=null;}
 async connect(){
  this.socket=tls.connect({...this.options,port:990,maxVersion:'TLSv1.2',rejectUnauthorized:true});
  this.socket.setTimeout(20000,()=>this.socket.destroy(Error('FTPS connection timed out')));
  this.socket.on('error',e=>this.fail(e));this.socket.on('close',()=>this.fail(Error('FTPS connection closed')));
  this.socket.on('data',b=>{this.text+=b.toString();if(this.text.length>65536){this.socket.destroy(Error('FTPS reply too large'));return;}let n;while((n=this.text.indexOf('\r\n'))>=0){const l=this.text.slice(0,n);this.text=this.text.slice(n+2);this.line(l);}});
  this.expect(await this.next(),[220]);return this;
 }
 fail(e){this.failure=e;for(const w of this.waiters.splice(0)){clearTimeout(w.timer);w.reject(e);}}
 line(line){const m=/^(\d{3})([ -])(.*)$/.exec(line);if(this.multi){if(m&&m[1]===this.multi&&m[2]===' '){this.multi=null;this.push({code:+m[1],text:line});}return;}if(!m)return;if(m[2]==='-'){this.multi=m[1];return;}this.push({code:+m[1],text:line});}
 push(r){const w=this.waiters.shift();if(w){clearTimeout(w.timer);w.resolve(r);}else this.queue.push(r);}
 next(){if(this.queue.length)return Promise.resolve(this.queue.shift());if(this.failure)return Promise.reject(this.failure);return new Promise((resolve,reject)=>{const w={resolve,reject,timer:setTimeout(()=>{this.waiters=this.waiters.filter(v=>v!==w);reject(Error('FTPS reply timed out'));},20000)};this.waiters.push(w);});}
 expect(r,codes){if(!codes.includes(r.code))throw Error('FTPS response '+r.text+' (expected '+codes.join('/')+')');return r;}
 async command(line,codes){if(/[\r\n]/.test(line))throw Error('Invalid FTP command');this.socket.write(line+'\r\n');return this.expect(await this.next(),codes);}
 async login(code){if(!/^[A-Za-z0-9]{8}$/.test(code))throw Error('Eight-character access code required');const r=await this.command('USER bblp',[230,331]);if(r.code===331)await this.command('PASS '+code,[230]);await this.command('PBSZ 0',[200]);await this.command('PROT P',[200]);await this.command('TYPE I',[200]);}
 async transfer(command,upload){
  const epsv=await this.command('EPSV',[229,500,502,504]);let port;
  if(epsv.code===229){const m=/\(\|\|\|(\d+)\|\)/.exec(epsv.text);if(!m)throw Error('Invalid EPSV reply');port=+m[1];}
  else{const r=await this.command('PASV',[227]),m=/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(r.text);if(!m)throw Error('Invalid PASV reply');port=+m[5]*256+(+m[6]);}
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid FTPS data port');
  const data=tls.connect({...this.options,port,maxVersion:'TLSv1.2',rejectUnauthorized:true,session:this.socket.getSession()});
  let bytes=0;const chunks=[];
  const ended=new Promise((resolve,reject)=>{data.on('error',reject);data.on('data',b=>{bytes+=b.length;if(bytes>16*1024*1024){data.destroy(Error('FTPS download exceeds 16 MB'));return;}chunks.push(b);});data.on('end',resolve);data.on('close',hadError=>{if(!hadError)resolve();});});
  // Prevent early handshake errors becoming unhandled while awaiting the control reply.
  ended.catch(()=>{});
  const secure=new Promise((resolve,reject)=>{data.once('secureConnect',resolve);data.once('error',reject);});secure.catch(()=>{});
  data.setTimeout(20000,()=>data.destroy(Error('FTPS data timed out')));
  try{await this.command(command,[125,150]);await secure;if(upload)data.end(upload);await ended;this.expect(await this.next(),[226,250]);return Buffer.concat(chunks);}catch(e){throw Error(command.split(' ')[0]+': '+e.message);}finally{data.destroy();}
 }
 static filename(name){if(typeof name!=='string'||!/^a1pen_[a-z0-9_-]{1,70}\.(gcode|txt|gcode\.3mf)$/.test(name))throw Error('Only generated a1pen_ files are allowed');return name;}
 async uploadVerified(name,buffer){Ftps.filename(name);if(!Buffer.isBuffer(buffer)||buffer.length>8*1024*1024)throw Error('Upload must be a buffer under 8 MB');const remote='/'+name;await this.transfer('STOR '+remote,buffer);const readback=await this.transfer('RETR '+remote);if(!buffer.equals(readback))throw Error('Uploaded file readback mismatch');return{filename:remote,bytes:buffer.length,sha256:crypto.createHash('sha256').update(readback).digest('hex'),readbackVerified:true};}
 async probeStorage(){
  const name='a1pen_storage_probe_'+crypto.randomBytes(12).toString('hex')+'.txt',remote='/'+name,buffer=Buffer.from('A1 Pen Studio storage check '+crypto.randomBytes(16).toString('hex')+'\n');let verified=false;
  try{const result=await this.uploadVerified(name,buffer);verified=true;return{bytes:result.bytes,readable:true,writable:true};}
  finally{try{await this.command('DELE '+remote,[250]);}catch(e){if(verified)throw Error('存储读写成功，但测试文件清理失败：'+e.message);}}
 }
 async finish(){
  // Close the verified upload before the printer opens the same card as a task.
  // A successful RETR is not a successful FTP logout.
  await this.command('QUIT',[221]);const socket=this.socket;this.socket=null;
  if(socket)await new Promise(resolve=>{const timer=setTimeout(()=>{socket.destroy();resolve();},2000);socket.once('close',()=>{clearTimeout(timer);resolve();});socket.end();});
 }
 close(){if(this.socket){this.socket.end('QUIT\r\n');const socket=this.socket;this.socket=null;setTimeout(()=>socket.destroy(),300).unref();}}
}
module.exports={Ftps};
