'use strict';
const {contextBridge,ipcRenderer}=require('electron');
if(location.hostname==='127.0.0.1'){
 const boot=ipcRenderer.sendSync('pen:bootstrap');
 for(const [key,value]of [['bambu-language',boot?.language],['bambu-fixed-backings-v1',boot?.backings],['bambu-active-pen',boot?.activePreset],['bambu-pen-library-version',boot?.penLibraryVersion===2?'2':undefined],['a1-pen-studio-v1',boot?.state],['a1-pen-machine-profile-v1',boot?.profile],['a1-pen-library-v1',boot?.library],['a1-pen-position-presets-v1',boot?.presets]]){if(value!==undefined)try{localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value));}catch{}}
 try{
  const raw=localStorage.getItem('a1-pen-machine-profile-v1');if(raw){const p=JSON.parse(raw);p.confirmed=false;localStorage.setItem('a1-pen-machine-profile-v1',JSON.stringify(p));}
 }catch{}
 contextBridge.exposeInMainWorld('PenDesktopAPI',{version:'0.20.0',setLanguage:value=>ipcRenderer.invoke('pen:language',value),initialState:boot?.state||null,save:value=>ipcRenderer.invoke('pen:save',value),meta:()=>ipcRenderer.invoke('pen:meta'),forget:()=>ipcRenderer.invoke('pen:forget'),reconnect:()=>ipcRenderer.invoke('pen:reconnect'),pair:value=>ipcRenderer.invoke('pen:pair',value),disconnect:()=>ipcRenderer.invoke('pen:disconnect'),setAutoConnect:enabled=>ipcRenderer.invoke('pen:auto-connect',enabled),networkOnline:()=>ipcRenderer.invoke('pen:network-online')});
}
