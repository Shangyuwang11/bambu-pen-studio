/* Strict geometry-only SVG reader. Curves use scale-independent adaptive
   sampling and line-command endpoints are always retained. No source markup is
   attached to the DOM. Copyright 2026 A1 Pen Studio contributors. */
(function () {
  'use strict';
  const C = PenCore, NS = 'http://www.w3.org/2000/svg';
  const I = [1, 0, 0, 1, 0, 0], numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
  const map = (m, p) => [m[0]*p[0]+m[2]*p[1]+m[4], m[1]*p[0]+m[3]*p[1]+m[5]];
  function numbers(text) {
    if (text.replace(numberPattern, '').replace(/[\s,]/g, '')) throw Error('SVG 中有无效的数字内容');
    const a = (text.match(numberPattern) || []).map(Number);
    if (a.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) throw Error('SVG 坐标超出支持范围');
    return a;
  }
  function transform(text = '') {
    const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g; let match, matrix = I.slice(), end = 0;
    while ((match = re.exec(text))) {
      if (text.slice(end, match.index).replace(/[\s,]/g, '')) throw Error('SVG 变换语法不完整'); end = re.lastIndex;
      const a = numbers(match[2]); let m;
      const requireCount = counts => { if (!counts.includes(a.length)) throw Error('SVG 变换参数数量不正确'); };
      switch (match[1]) {
        case 'matrix': requireCount([6]); m = a; break;
        case 'translate': requireCount([1, 2]); m = [1, 0, 0, 1, a[0], a[1] ?? 0]; break;
        case 'scale': requireCount([1, 2]); m = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
        case 'rotate': { requireCount([1, 3]); const r = a[0]*Math.PI/180, c = Math.cos(r), s = Math.sin(r), x = a[1] || 0, y = a[2] || 0; m = [c, s, -s, c, x-c*x+s*y, y-s*x-c*y]; break; }
        case 'skewX': requireCount([1]); m = [1, 0, Math.tan(a[0]*Math.PI/180), 1, 0, 0]; break;
        case 'skewY': requireCount([1]); m = [1, Math.tan(a[0]*Math.PI/180), 0, 1, 0, 0]; break;
        default: throw Error('暂不支持 SVG 变换：' + match[1]);
      }
      matrix = multiply(matrix, m);
      if (matrix.some(n => !Number.isFinite(n) || Math.abs(n) > 1e12)) throw Error('SVG 变换超出支持范围');
    }
    if (text.slice(end).replace(/[\s,]/g, '')) throw Error('SVG 变换语法不完整');
    return matrix;
  }
  function pathGroups(data) {
    const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
    if (data.replace(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g, '').replace(/[\s,]/g, '')) throw Error('SVG 路径含无效字符');
    const counts = { M:2, L:2, H:1, V:1, C:6, S:4, Q:4, T:2, A:7, Z:0 };
    let i=0, cmd='', p=[0,0], origin=[0,0], group=null, prev='', cubic=null, quad=null;
    const groups=[];
    while (i<tokens.length) {
      if (/^[a-z]$/i.test(tokens[i])) cmd=tokens[i++];
      const up=cmd.toUpperCase(), rel=cmd!==up, count=counts[up];
      if (!cmd || count===undefined) throw Error('SVG 路径命令无效');
      if (up==='Z') { if (!group) throw Error('SVG 路径须以 M 开始'); group.push({from:p, to:origin, command:'L'+origin.join(' '), linear:true}); p=origin.slice(); cubic=quad=null;prev='Z';cmd='';continue; }
      const v=tokens.slice(i,i+count).map(Number);i+=count;
      if (v.length!==count || v.some(n=>!Number.isFinite(n)||Math.abs(n)>1e9)) throw Error('SVG 路径参数不完整');
      const xy=(x,y)=>[x+(rel?p[0]:0),y+(rel?p[1]:0)];
      let to, command, linear=false, nc=null, nq=null;
      if (up==='M') { p=xy(v[0],v[1]);origin=p.slice();group=[];groups.push(group);if(groups.length>50000)throw Error('SVG 超过 5 万条路径，请拆分');prev='M';cubic=quad=null;cmd=rel?'l':'L';continue; }
      if (!group) throw Error('SVG 路径须以 M 开始');
      if (up==='L') { to=xy(v[0],v[1]);command='L'+to.join(' ');linear=true; }
      if (up==='H') { to=[v[0]+(rel?p[0]:0),p[1]];command='L'+to.join(' ');linear=true; }
      if (up==='V') { to=[p[0],v[0]+(rel?p[1]:0)];command='L'+to.join(' ');linear=true; }
      if (up==='C') { const a=xy(v[0],v[1]),b=xy(v[2],v[3]);to=xy(v[4],v[5]);nc=b;command='C'+[...a,...b,...to].join(' '); }
      if (up==='S') { const a=['C','S'].includes(prev)?[2*p[0]-cubic[0],2*p[1]-cubic[1]]:p;const b=xy(v[0],v[1]);to=xy(v[2],v[3]);nc=b;command='C'+[...a,...b,...to].join(' '); }
      if (up==='Q') { const a=xy(v[0],v[1]);to=xy(v[2],v[3]);nq=a;command='Q'+[...a,...to].join(' '); }
      if (up==='T') { const a=['Q','T'].includes(prev)?[2*p[0]-quad[0],2*p[1]-quad[1]]:p;to=xy(v[0],v[1]);nq=a;command='Q'+[...a,...to].join(' '); }
      if (up==='A') { if (v[0]<0||v[1]<0||![0,1].includes(v[3])||![0,1].includes(v[4])) throw Error('SVG 圆弧半径或标志无效');to=xy(v[5],v[6]);command='A'+[...v.slice(0,5),...to].join(' '); }
      group.push({from:p,to,command,linear});p=to;prev=up;cubic=nc;quad=nq;
      if (i>1500000) throw Error('SVG 路径过于复杂，请拆分或简化');
    }
    return groups;
  }
  // Read paint styles without inserting SVG or its stylesheet into the page.
  // Drawing follows the original geometry; stroke width never becomes a pair
  // of outlines. The physical line width belongs to the calibration profile.
  const paintDefaults={fill:'black',stroke:'none',color:'black',opacity:'1','fill-opacity':'1','stroke-opacity':'1','stroke-width':'1',visibility:'visible',display:'inline'};
  const paintKeys=Object.keys(paintDefaults),inheritedPaint=new Set(paintKeys.filter(k=>!['opacity','display'].includes(k)));
  function paintReader(doc) {
    const declarations=document.createElement('span').style,colors=document.createElement('canvas').getContext('2d'),rules=new WeakMap();let applications=0;
    const unsupported=key=>{throw Error('SVG 样式暂不支持：'+key+'；请转换为普通路径');};
    function parseStyle(text) {
      if(text.length>250000||/@|url\s*\(/i.test(text))unsupported('外部引用或样式规则');
      declarations.cssText=text;const result=[];
      for(const key of declarations){
        const value=declarations.getPropertyValue(key).trim();
        if(/url\s*\(|var\s*\(|env\s*\(/i.test(value))unsupported(key);
        if(paintKeys.includes(key))result.push({key,value,important:declarations.getPropertyPriority(key)==='important'});
        else if(['stroke-linecap','stroke-linejoin','stroke-miterlimit','fill-rule','paint-order','shape-rendering','color-interpolation'].includes(key))continue;
        else if(['stroke-dasharray','stroke-dashoffset','clip-path','mask','filter','marker-start','marker-mid','marker-end'].includes(key)&&['none','0','0px','initial'].includes(value))continue;
        else if(key==='vector-effect'&&['none','non-scaling-stroke'].includes(value))continue;
        else unsupported(key);
      }
      return result;
    }
    const outranks=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i];return true;};
    function apply(map,items,rank){for(const item of items){const priority=[Number(item.important),...rank],old=map.get(item.key);if(!old||outranks(priority,old.priority))map.set(item.key,{value:item.value,priority});}}
    let order=0;
    for(const node of doc.querySelectorAll('style')){
      const text=node.textContent;if(text.length>250000||/@|url\s*\(/i.test(text))unsupported('外部引用或样式规则');
      const sheet=new CSSStyleSheet();sheet.replaceSync(text);
      for(const rule of sheet.cssRules){
        if(rule.type!==CSSRule.STYLE_RULE||++order>1000)unsupported('样式规则');
        const items=parseStyle(rule.style.cssText);
        for(const selector of rule.selectorText.split(',')){
          const s=selector.trim(),parts=s.split(/\s*>\s*|\s+/),simple=/^(?:[A-Za-z_][\w-]*|\*|:root)?(?:[.#][A-Za-z_][\w-]*)*$/;
          // No dynamic selectors, attribute selectors or selector functions.
          if(!s||parts.some(p=>!p||!simple.test(p)))unsupported('选择器 '+s);
          const ids=(s.match(/#/g)||[]).length,classes=(s.match(/\.|:root\b/g)||[]).length,tags=parts.filter(p=>/^[A-Za-z_]/.test(p)).length;
          let matches;try{matches=doc.querySelectorAll(s);}catch{unsupported('选择器 '+s);}
          for(const target of matches){if(++applications>500000)unsupported('样式过于复杂');let values=rules.get(target);if(!values){values=new Map();rules.set(target,values);}apply(values,items,[0,ids,classes,tags,order]);}
        }
      }
    }
    function resolve(node,parent){
      const values=new Map();
      for(const key of paintKeys)if(node.hasAttribute(key))values.set(key,{value:node.getAttribute(key).trim(),priority:[0,0,0,0,0,-1]});
      for(const [key,item] of rules.get(node)||[])if(!values.has(key)||outranks(item.priority,values.get(key).priority))values.set(key,item);
      if(node.hasAttribute('style'))apply(values,parseStyle(node.getAttribute('style')),[1,0,0,0,0]);
      const style={};for(const key of paintKeys){let value=values.get(key)?.value,keyword=value?.toLowerCase();if(!value||keyword==='unset')value=inheritedPaint.has(key)?parent?.[key]??paintDefaults[key]:paintDefaults[key];else if(keyword==='inherit')value=parent?.[key]??paintDefaults[key];else if(keyword==='initial')value=paintDefaults[key];else if(['revert','revert-layer'].includes(keyword))unsupported(key);style[key]=value;}
      if(style.color.toLowerCase()==='currentcolor')style.color=parent?.color??'black';
      const opacity=key=>{const value=style[key];if(!/^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?%?$/i.test(value))unsupported(key);const n=parseFloat(value)/(value.endsWith('%')?100:1);if(!Number.isFinite(n))unsupported(key);return C.clamp(n,0,1);};
      const alpha=value=>{value=value.trim().toLowerCase();if(value==='none')return 0;if(value==='currentcolor')value=style.color;if(!CSS.supports('color',value)||/var\s*\(|env\s*\(/i.test(value))unsupported('颜色');colors.fillStyle='#000';colors.fillStyle=value;const normalized=colors.fillStyle;if(normalized==='transparent')return 0;const m=normalized.match(/(?:,|\/)\s*([\d.e+-]+)(%)?\s*\)$/i);return m?Number(m[1])/(m[2]?100:1):1;};
      const width=style['stroke-width'];if(!/^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?(?:px|pt|pc|mm|cm|in|q|%)?$/i.test(width)||parseFloat(width)<0||!Number.isFinite(parseFloat(width)))unsupported('stroke-width');
      style.effectiveOpacity=(parent?.effectiveOpacity??1)*opacity('opacity');
      style.fillVisible=alpha(style.fill)*opacity('fill-opacity')>0;
      style.strokeAlpha=alpha(style.stroke)*opacity('stroke-opacity');style.strokeVisible=style.strokeAlpha>0&&parseFloat(width)>0;
      return style;
    }
    return resolve;
  }
  function read(text) {
    if (text.length>10000000) throw Error('SVG 请控制在 10 MB 以内');
    if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)||/<\?(?!xml(?:\s|\?>))/i.test(text))throw Error('SVG 含外部声明或处理指令，请转为普通几何路径');
    const doc=new DOMParser().parseFromString(text,'image/svg+xml');
    if (doc.querySelector('parsererror')||doc.documentElement.localName!=='svg') throw Error('SVG 文件解析失败');
    const forbidden=doc.querySelector('script,foreignObject,image,text,use,clipPath,mask,filter,linearGradient,radialGradient,pattern,animate,animateTransform,set');
    if (forbidden) throw Error('SVG 含不支持的 '+forbidden.localName+'；请转普通路径或使用 PNG');
    const groups=[],resolvePaint=paintReader(doc);let segments=0,preserveStrokes=false;
    function walk(node, parent, inherited,depth=0) {
      if(depth>128)throw Error('SVG 嵌套过深，请简化分组');
      const tag=node.localName;if (['defs','metadata','title','desc','style'].includes(tag)) return;
      if (tag==='svg'&&node!==doc.documentElement) throw Error('请先展开嵌套 SVG');
      for (const a of node.attributes) if (/^on/i.test(a.name)||/href/i.test(a.name)||/url\s*\(/i.test(a.value)||['clip-path','mask','filter'].includes(a.name)||a.name==='stroke-dasharray'&&!['none','0'].includes(a.value)||a.name==='vector-effect'&&!['none','non-scaling-stroke'].includes(a.value)) throw Error('SVG 包含脚本、引用或不支持的样式：'+a.name);
      const m=multiply(parent,transform(node.getAttribute('transform')||''));
      const n=(key,fallback=0)=>{const v=node.getAttribute(key);if(v===null)return fallback;const a=numbers(v);if(a.length!==1)throw Error('SVG 几何属性必须是单个数字');return a[0];};
      const style=resolvePaint(node,inherited);
      if(style.effectiveOpacity<=0||style.display==='none') return;
      if(style.strokeVisible&&style.effectiveOpacity*style.strokeAlpha<1)preserveStrokes=true;
      const invisible=['hidden','collapse'].includes(style.visibility)||(!style.fillVisible||tag==='line')&&!style.strokeVisible;
      const native=(shape,from,to)=>{const length=shape.getTotalLength();if(!Number.isFinite(length))throw Error('SVG 曲线无效');return {point:t=>{if(t===0)return map(m,from);if(t===1)return map(m,to);const p=shape.getPointAtLength(length*t);return map(m,[p.x,p.y]);},linear:false,length};};
      const addGroup=items=>{if(items.length){groups.push(items);segments+=items.length;if(groups.length>50000||segments>500000)throw Error('SVG 超过 5 万条路径或 50 万段，请简化');}};
      const addPath=data=>{
        for (const group of pathGroups(data)) addGroup(group.map(s=>{
          if(s.linear)return {point:t=>map(m,[s.from[0]+t*(s.to[0]-s.from[0]),s.from[1]+t*(s.to[1]-s.from[1])]),linear:true,length:C.distance(s.from,s.to)};
          const shape=document.createElementNS(NS,'path');shape.setAttribute('d','M'+s.from.join(' ')+' '+s.command);return native(shape,s.from,s.to);
        }));
      };
      if(!invisible&&tag==='path') {
        addPath(node.getAttribute('d')||'');
      } else if(!invisible&&['line','polyline','polygon'].includes(tag)) {
        let p;if(tag==='line')p=[[n('x1'),n('y1')],[n('x2'),n('y2')]];
        else{const a=numbers(node.getAttribute('points')||'');if(a.length%2)throw Error('SVG 顶点坐标不完整');p=[];for(let j=0;j<a.length;j+=2)p.push([a[j],a[j+1]]);if(tag==='polygon'&&p.length)p.push(p[0]);}
        addGroup(p.slice(1).map((b,j)=>({linear:true,length:C.distance(p[j],b),point:t=>map(m,[p[j][0]+t*(b[0]-p[j][0]),p[j][1]+t*(b[1]-p[j][1])])})));
      } else if(!invisible&&['rect','circle','ellipse'].includes(tag)) {
        for(const key of ['width','height','rx','ry','r'])if(node.hasAttribute(key)&&n(key)<0)throw Error('SVG 尺寸不能是负数');
        // Detached basic-shape getTotalLength() can require a rendered viewport.
        // Convert only validated numbers to absolute paths, keeping all source
        // markup detached and retaining straight endpoints and rounded corners.
        if(tag==='rect'){
          const x=n('x'),y=n('y'),w=n('width'),h=n('height'),rx=Math.min(w/2,n('rx',n('ry'))),ry=Math.min(h/2,n('ry',n('rx')));
          if(w>0&&h>0){if(!rx||!ry)addPath(`M${x} ${y}H${x+w}V${y+h}H${x}Z`);
            else addPath(`M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`);}
        }else{
          const cx=n('cx'),cy=n('cy'),rx=tag==='circle'?n('r'):n('rx'),ry=tag==='circle'?rx:n('ry');
          if(rx>0&&ry>0)addPath(`M${cx+rx} ${cy}A${rx} ${ry} 0 0 1 ${cx-rx} ${cy}A${rx} ${ry} 0 0 1 ${cx+rx} ${cy}Z`);
        }
      } else if(!['svg','g','path','line','polyline','polygon','rect','circle','ellipse'].includes(tag)) throw Error('不支持 SVG 元素：'+tag);
      for(const child of node.children)walk(child,m,style,depth+1);
    }
    walk(doc.documentElement,I);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,count=0;for(const g of groups)for(const s of g)if(s.length>0){const n=s.linear?1:8;for(let k=0;k<=n;k++){const p=s.point(k/n);if(p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e12))throw Error('SVG 变换后的坐标无效');minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);count++;}}
    if(!count)throw Error('SVG 没有可见路径');
    const span=Math.max(maxX-minX,maxY-minY);if(span<1e-12)throw Error('SVG 图案尺寸为零');
    const tolerance=span*0.0001, paths=[];let total=0;
    const pointDistance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?C.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l,0,1):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
    for(const group of groups) {
      const path=[];
      const append=p=>{if(!path.length||C.distance(p,path.at(-1))>span*1e-12){path.push(p);if(++total>500000)throw Error('SVG 超过 50 万采样点，请简化');}};
      for(const s of group) {
        if(!s.length)continue;const start=s.point(0),end=s.point(1);append(start);
        if(s.linear){append(end);continue;}
        function subdivide(a,b,pa,pb,depth) {
          const ts=[a+(b-a)*.25,(a+b)/2,a+(b-a)*.75], ps=ts.map(s.point);
          const length=C.distance(pa,ps[0])+C.distance(ps[0],ps[1])+C.distance(ps[1],ps[2])+C.distance(ps[2],pb);
          if(ps.every(p=>pointDistance(p,pa,pb)<=tolerance)&&length-C.distance(pa,pb)<=tolerance){append(pb);return;}
          if(depth>=18)throw Error('SVG 曲率过高或尺寸过小，请简化');
          subdivide(a,ts[1],pa,ps[1],depth+1);subdivide(ts[1],b,ps[1],pb,depth+1);
        }
        subdivide(0,1,start,end,0);
      }
      if(path.length>1)paths.push(path);
    }
    if(!paths.length)throw Error('SVG 没有非零长度的可见笔迹');
    return { ...C.normalize(paths), sourceBounds: C.bounds(paths), ...(preserveStrokes?{preserveStrokes:true}:{}) };
  }
  window.PenSVG={read,pathGroups,transform};
})();
