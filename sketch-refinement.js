/* Physical millimetre adapter for refined continuous sketches. Opaque ink uses
 * fixed-width paths; tone is made by density and placement, never transparency.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./natural-sketch-options.js'),require('./sketch-refinement-input.js'),require('./sketch-refinement-core.js'));
  else root.PenRefinedSketch=factory(root.PenNaturalOptions,root.PenSketchRefinementInput,root.PenSketchRefinementCore);
})(typeof globalThis!=='undefined'?globalThis:this,function(Options,Input,Engine){
  'use strict';
  if(!Options||!Input||!Engine)throw Error('请先加载素描参数和细化引擎');
  function render(gray,w,h,options={},control={}){
    const clock=typeof control.now==='function'?control.now:()=>Date.now();
    const now=()=>{const value=clock();if(!Number.isFinite(value))throw Error('素描时钟无效');return value;},started=now();
    const width=options.width===undefined?130:options.width,height=options.height===undefined?width*h/w:options.height;
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>500||height>500)throw Error('素描图案宽高需为1–500 mm');
    const inputBrush={...(options.brush||{})};
    if(options.detail!==undefined){if(inputBrush.detail!==undefined&&inputBrush.detail!==options.detail)for(const k of ['maxStrokes','maxPoints','budgetMs'])delete inputBrush[k];inputBrush.detail=options.detail;}
    const brush=Options.normalize({...inputBrush,penDarkness:1},{detail:options.detail});
    if(!['refined','grouped','tonalLoops'].includes(brush.style))throw Error('此引擎需使用自然细化、成组扫线或圈线叠画方式');
    const prepared=Input.prepare(gray,w,h,{brush,rgba:options.rgba,width});
    prepared.heightMm=height;
    const mode=brush.style==='grouped'?'grouped':brush.style==='tonalLoops'?'loops':'natural';
    const result=Engine.generate(prepared,{mode,density:brush.density,detail:brush.detail/640,nibWidthMm:brush.strokeWidth,
      randomness:1-Math.exp(-brush.randomness),freedom:1-Math.exp(-brush.freedom),curvature:Math.sqrt(1-Math.exp(-brush.curvature*3)),length:brush.length,
      directionFit:brush.directionFit,highlightTexture:brush.density===0?0:brush.highlightTexture,shadowCross:brush.shadowCross,
      seed:brush.seed,maxStrokes:brush.maxStrokes,maxPoints:brush.maxPoints,budgetMs:Math.max(1,brush.budgetMs-(now()-started)),workBudget:brush.workBudget,
      now,cancelled:typeof control.shouldCancel==='function'?control.shouldCancel:typeof control.cancelled==='function'?control.cancelled:undefined});
    const paths=result.paths.map(p=>p.points.map(q=>[q[0]*width/prepared.width,q[1]*height/prepared.height]));
    const stats={...prepared.stats,...result.stats,algorithm:result.stats.algorithm,version:'1.0.0',style:brush.style,
      inputWidth:w,inputHeight:h,elapsedMs:now()-started,strokeWidthMm:brush.strokeWidth,penDarkness:1,
      stageCounts:result.stageCounts,partial:!result.stats.complete,converged:result.stats.complete,acceptedStrokes:result.paths.length,workUnits:result.stats.attempts,workBudget:brush.workBudget,process:'生成顺序：结构、亮部细节、明暗排线、暗部交叉、局部细节；不是原作者的实际笔顺。'};
    const warnings=[...prepared.warnings];
    const stopLabels={strokes:'笔画上限',points:'路径点上限',time:'计算时间', 'work-budget':'计算预算','coverage-budget':'计算预算',cancelled:'取消'};
    if(!stats.complete)warnings.push(stats.termination==='support-exhausted'?'当前笔宽或选区限制了剩余细节，已保留可绘制笔迹。':'素描达到'+(stopLabels[stats.termination]||'计算预算')+'，已保留当前笔迹；可调低精细度或增加允许的笔画数。');
    if(prepared.stats.foregroundPixels===0)warnings.push('当前背景选区没有可绘制像素，请更换背景方式。');
    if(typeof control.onProgress==='function')control.onProgress({phase:'done',fraction:1,strokes:paths.length,points:stats.pointCount,workUnits:stats.workUnits,workBudget:brush.workBudget});
    return {paths,pathsMM:paths,brush,warnings,stats,stages:result.paths.map(p=>p.stage),settings:{width,height,gap:options.gap||.8,brush},
      budget:{termination:stats.termination,workUnits:stats.workUnits,maxStrokes:brush.maxStrokes,maxPoints:brush.maxPoints,budgetMs:brush.budgetMs,workBudget:brush.workBudget,maxSide:Math.max(prepared.width,prepared.height)}};
  }
  return Object.freeze({VERSION:'1.0.0',render});
});
