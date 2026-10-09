/* Shared natural-pencil settings. Values describe the expected physical pen;
   they do not change the installed nib or control pressure. No device access. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PenNaturalOptions=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const freeze=value=>{for(const v of Object.values(value))if(v&&typeof v==='object')freeze(v);return Object.freeze(value);};
  const RANGES=freeze({density:[0,Infinity],strokeWidth:[.1,Infinity],penDarkness:[.08,1],
    randomness:[0,Infinity],curvature:[0,Infinity],freedom:[0,Infinity],length:[.01,Infinity],contrast:[.01,Infinity],
    directionFit:[0,1],highlightTexture:[0,1],shadowCross:[0,1],
    seed:[0,4294967295],maxStrokes:[1,50000],maxPoints:[2,500000],budgetMs:[500,20000]});
  // These are reference measurements, not selectable limits. All positive
  // integer detail values are handled continuously by deriveBudget below.
  const PROFILES=freeze(Object.fromEntries([[384,'简洁'],[640,'均衡'],[960,'精细']]
    .map(([detail,label])=>[detail,{...deriveBudget(detail),label}])));
  const PRESETS=freeze({
    faithful:{density:1,randomness:.1,curvature:.2,freedom:0,length:1,contrast:1,directionFit:.85,highlightTexture:.5,shadowCross:.35},
    relaxed:{density:.95,randomness:.3,curvature:.45,freedom:.12,length:1.1,contrast:1,directionFit:.72,highlightTexture:.6,shadowCross:.35},
    expressive:{density:.85,randomness:.5,curvature:.65,freedom:.25,length:1.3,contrast:1.08,directionFit:.55,highlightTexture:.6,shadowCross:.5}
  });
  const LABELS=freeze({faithful:'忠实',relaxed:'松弛',expressive:'张力',custom:'自定义'});
  const STYLES=freeze({refined:'形体素描',grouped:'曲线排线',tonalLoops:'明暗圈绘',flow:'方向流线',loops:'游走圈绘'});
  const BACKGROUNDS=freeze({keep:'保留整张图',white:'白底图 · 保护留白',plant:'植物 · 提取绿色主体'});
  const DEFAULTS=freeze({style:'flow',preset:'faithful',...PRESETS.faithful,backgroundMode:'keep',
    strokeWidth:.5,penDarkness:1,seed:42,detail:640,
    maxStrokes:16000,maxPoints:145000,budgetMs:6500});
  const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  function detailFor(value){
    if(value===undefined)return 640;
    if(value==='simple')return 384;
    if(value==='balanced')return 640;
    if(value==='fine')return 960;
    if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1)return value;
    throw Error('素描精细度需为正整数');
  }
  function deriveBudget(detail){
    detail=detailFor(detail);
    const ratio=detail/640;
    // Increasing detail continuously changes both candidate count and field
    // sampling. Worker and downstream geometry ceilings protect one conversion;
    // they do not reject higher detail values or divide the control into tiers.
    return {
      label:'连续 · '+detail,
      maxSide:Math.max(32,Math.min(960,Math.round(480*Math.sqrt(ratio)))),
      workBudget:Math.max(32,Math.min(300000,Math.round(42000*Math.pow(ratio,1.7)))),
      maxStrokes:Math.max(4,Math.min(50000,Math.round(16000*Math.pow(ratio,1.4)))),
      maxPoints:Math.max(16,Math.min(500000,Math.round(145000*Math.pow(ratio,1.3)))),
      budgetMs:Math.max(500,Math.min(20000,Math.round(6500*Math.sqrt(ratio))))
    };
  }
  function numeric(value,key){
    const range=RANGES[key];
    if(typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1]
      ||(['seed','maxStrokes','maxPoints','budgetMs'].includes(key)&&!Number.isInteger(value)))
      throw Error('素描参数 '+key+' 需为'+range[0]+(Number.isFinite(range[1])?'–'+range[1]:'及以上')+(['seed','maxStrokes','maxPoints','budgetMs'].includes(key)?'的整数':'的数字'));
    return value;
  }
  function normalize(input={},context={}){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('素描笔刷参数无效');
    if(has(input,'detail')&&input.detail===undefined)throw Error('素描精细度需为正整数');
    const detail=detailFor(has(input,'detail')?input.detail:context.detail);
    const profile=deriveBudget(detail);
    const preset=has(input,'preset')?input.preset:DEFAULTS.preset;
    if(typeof preset!=='string'||!has(LABELS,preset))throw Error('未知素描预设');
    const style=has(input,'style')?input.style:DEFAULTS.style;
    if(typeof style!=='string'||!has(STYLES,style))throw Error('未知素描笔迹方式');
    const backgroundMode=has(input,'backgroundMode')?input.backgroundMode:DEFAULTS.backgroundMode;
    if(typeof backgroundMode!=='string'||!has(BACKGROUNDS,backgroundMode))throw Error('未知素描背景处理方式');
    const values={...DEFAULTS,...profile,...(PRESETS[preset]||{}),...input};
    const result={style,preset,detail,backgroundMode};
    for(const key of Object.keys(RANGES))result[key]=numeric(values[key],key);
    // An optional artistic limit survives detail changes. Automatic resource
    // budgets still apply; older brushes retain their exact normalized shape.
    if(has(input,'strokeLimit')){
      result.strokeLimit=numeric(input.strokeLimit,'maxStrokes');
      result.maxStrokes=Math.min(result.maxStrokes,result.strokeLimit);
    }
    // Computed fields are always derived again. A saved project cannot increase
    // the worker's internal operation budget by injecting workBudget/maxSide.
    result.maxSide=profile.maxSide;
    result.workBudget=profile.workBudget;
    result.profile=profile.label;
    return result;
  }
  function same(a,b){
    const left=normalize(a),right=normalize(b);
    return [...new Set([...Object.keys(left),...Object.keys(right)])].every(key=>left[key]===right[key]);
  }
  return Object.freeze({DEFAULTS,RANGES,PRESETS,PROFILES,LABELS,STYLES,STYLE_LABELS:STYLES,BACKGROUNDS,normalize,deriveBudget,same});
});
