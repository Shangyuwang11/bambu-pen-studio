/* Decode locally; conversion is cancellable and runs outside the UI thread. */
(function(){'use strict';
 async function imagePixels(source,maxSide=640){
  if(!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(source)||source.length>15000000)throw Error('图像数据无效或超过10 MB');
  if(!Number.isSafeInteger(maxSide)||maxSide<2||maxSide>1024)throw Error('转换分辨率无效');
  const img=new Image();img.src=source;await img.decode();
  if(img.naturalWidth*img.naturalHeight>50000000)throw Error('图片尺寸过大，请缩小到5000万像素以内');
  const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(2,Math.round(img.naturalWidth*scale)),h=Math.max(2,Math.round(img.naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
  const rgba=ctx.getImageData(0,0,w,h).data,gray=new Float32Array(w*h);for(let i=0;i<gray.length;i++)gray[i]=.2126*rgba[4*i]+.7152*rgba[4*i+1]+.0722*rgba[4*i+2];return {gray,w,h,rgba};
 }
 async function raster(source,mode,threshold,gap,outputW=65,outputH=null,options={}){
  const signal=options.signal,aborted=()=>new DOMException('已取消图片转换','AbortError');if(signal?.aborted)throw aborted();
  const fileMode=location.protocol==='file:',natural=mode==='natural';let detail=options.detail??options.brush?.detail??640;
  if(natural&&(!Number.isSafeInteger(detail)||detail<1))throw Error('自然素描精细度需为正整数');
  // Detail controls stroke sampling, not the white barriers in the source.
  const data=await imagePixels(source,natural?(fileMode?320:1024):fileMode?320:options.detail||640);if(signal?.aborted)throw aborted();
  const settings={mode,threshold,gap,strokeWidth:options.strokeWidth??options.brush?.strokeWidth??window.PenStudio?.getState().pen.width??.5,width:outputW,height:outputH||outputW*data.h/data.w,autoThreshold:options.autoThreshold===true,cleanup:options.cleanup??2};
  if(natural){const b={...(options.brush??{})};if(b.detail!==undefined&&b.detail!==detail)for(const key of ['maxStrokes','maxPoints','budgetMs'])delete b[key];settings.brush=PenNaturalOptions.normalize({...b,detail,strokeWidth:settings.strokeWidth,penDarkness:1});settings.detail=detail;}
  // Browsers disallow file-origin workers. Keep the legacy source-file preview
  // available at bounded resolution; the desktop/local-server path uses workers.
  if(fileMode){await new Promise(r=>setTimeout(r,0));if(signal?.aborted)throw aborted();return PenRaster.render(data.gray,data.w,data.h,{...settings,rgba:data.rgba});}
  return new Promise((resolve,reject)=>{let worker,timer;const end=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker?.terminate();error?reject(error):resolve(result);},cancel=()=>end(aborted());
   try{worker=new Worker(new URL('raster-worker.js',location.href));signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>end(Error('转换超过45秒，请降低细节或换用轮廓/排线')),45000);worker.onmessage=e=>e.data.error?end(Error(e.data.error)):end(null,e.data.result);worker.onerror=()=>end(Error('图像转换后台未能启动，请重新打开桌面应用'));worker.postMessage({...data,options:settings},[data.gray.buffer,data.rgba.buffer]);}catch(e){end(e);}
  });
 }
 window.PenImport={simplify:PenRaster.simplify,outlines:PenRaster.outlines,skeleton:PenRaster.skeleton,imagePixels,raster,svg:text=>PenSVG.read(text)};
})();
