'use strict';
importScripts('path-tools.js','sketch.js','scan-hatch.js','natural-sketch-options.js','natural-sketch.js','sketch-refinement-core.js','sketch-refinement-input.js','sketch-refinement.js','raster.js','raster-process.js');
self.onmessage=event=>{try{const {gray,w,h,rgba,options}=event.data;self.postMessage({result:PenRaster.render(gray,w,h,{...options,rgba})});}catch(e){self.postMessage({error:e.message});}};
