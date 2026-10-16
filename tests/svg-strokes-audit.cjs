'use strict';
const assert=require('node:assert/strict'),{chromium}=require(process.env.A1_PEN_PLAYWRIGHT||'playwright');
const {createBridge}=require('../bridge/server.cjs');
const svg=body=>'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">'+body+'</svg>';
const d='M 10 10 C 40 10 40 60 10 60';
(async()=>{
 const bridge=createBridge({printerFactory:()=>{throw Error('SVG tests must not connect to hardware');}});await bridge.listen(0);
 const browser=await chromium.launch({headless:true,...(process.env.A1_PEN_BROWSER?{executablePath:process.env.A1_PEN_BROWSER}:{})});const page=await browser.newPage(),errors=[],requests=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(bridge.origin))requests.push(r.url());});await page.goto(bridge.origin);await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');
  const read=text=>page.evaluate(text=>PenImport.svg(text),text);
  const base=await read(svg('<path fill="none" stroke="black" d="'+d+'"/>'));assert.equal(base.paths.length,1);assert(base.paths[0].length>2);assert.notDeepEqual(base.paths[0][0],base.paths[0].at(-1));
  console.log('PASS attribute-only stroke imports as one open centerline');
  const inline=await read(svg('<path style="fill:none;stroke:#000;stroke-width:0.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none" d="'+d+'"/>'));assert.deepEqual(inline.paths,base.paths);
  console.log('PASS inline stroke style matches presentation attributes, without closing or duplicating strokes');
  const css=await read(svg('<defs><style>.line { fill:none; stroke:currentColor; stroke-width:2; } #drawing { color:rgb(0,0,0); }</style></defs><g id="drawing"><path class="line" d="'+d+'"/></g>'));assert.deepEqual(css.paths,base.paths);
  console.log('PASS stylesheet classes in defs and inherited currentColor preserve the same centerline');
  for(const style of ['stroke:none','stroke-width:0','stroke-opacity:0%','opacity:0','display:none','visibility:hidden','stroke:rgba(0,0,0,0)','stroke:#0000','stroke:#00000000','color:transparent;stroke:currentColor']){
   const result=await read(svg('<path fill="none" stroke="black" d="'+d+'"/><path fill="none" stroke="red" style="'+style+'" d="M500 500L600 600"/>'));assert.deepEqual(result.paths,base.paths,style);assert.deepEqual(result.sourceBounds,base.sourceBounds,style);
  }
  const unpainted=await read(svg('<line x1="300" y1="300" x2="900" y2="900"/><path fill="none" stroke="black" d="'+d+'"/>'));assert.deepEqual(unpainted.paths,base.paths);
  console.log('PASS 10 invisible-paint cases and unpainted line elements do not create phantom strokes or change bounds');
  const cascade=await read(svg('<style>path{fill:none;stroke:none} .ink {stroke:red!important} #keep {stroke:none} g > path.ink {stroke:blue!important} .gone {stroke:none!important}</style><g><path id="keep" class="ink" style="stroke:none" d="'+d+'"/><path class="gone" stroke="black" style="stroke:black" d="M500 500L600 600"/></g>'));assert.deepEqual(cascade.paths,base.paths);
  const inlineWins=await read(svg('<style>#keep{fill:none;stroke:none!important}</style><path id="keep" style="stroke:black!important" d="'+d+'"/>'));assert.deepEqual(inlineWins.paths,base.paths);
  const specificity=await read(svg('<style>:root{fill:none} g .line{stroke:black} .line{stroke:none}</style><g><path class="line" d="'+d+'"/></g>'));assert.deepEqual(specificity.paths,base.paths);
  console.log('PASS CSS cascade: presentation attributes, classes, IDs, descendant/child selectors, root, inline styles and important');
  const inherited=await read(svg('<g style="fill:none;stroke:black;visibility:hidden"><path style="visibility:visible;stroke:inherit" d="'+d+'"/></g><g style="display:none"><path style="display:inline" stroke="black" d="M500 500L600 600"/></g>'));assert.deepEqual(inherited.paths,base.paths);
  const faded=await read(svg('<g style="fill:none;stroke:black;opacity:50%"><path style="opacity:inherit;stroke-opacity:50%" d="'+d+'"/></g>'));assert.deepEqual(faded.paths,base.paths);assert.equal(faded.preserveStrokes,true);
  console.log('PASS inherited paint and visibility overrides, group display and percentage opacity');
  const shapes='<line x1="1" y1="2" x2="20" y2="30"/><polyline points="3,5 18,10 20,2"/><polygon points="30,10 45,10 40,20"/><rect x="2" y="40" width="12" height="10" rx="2"/><circle cx="50" cy="40" r="6"/><ellipse cx="70" cy="50" rx="9" ry="4"/>';
  const geometry=await read(svg('<g fill="none" stroke="black" transform="translate(7 9) rotate(15)">'+shapes+'</g>'));
  const styledGeometry=await read(svg('<style>.drawing{fill:none;stroke:black;stroke-width:0.5mm}</style><g class="drawing" transform="translate(7 9) rotate(15)">'+shapes+'</g>'));assert.deepEqual(styledGeometry.paths,geometry.paths);assert.equal(styledGeometry.paths.length,6);
  const filledAndStroked=await read(svg('<path style="fill:black;stroke:black" d="M0 0L20 0L20 20Z"/>'));assert.equal(filledAndStroked.paths.length,1);
  console.log('PASS six transformed basic shapes, units on stroke width, and fill plus stroke without duplicate outlines');
  for(const [shape,bounds] of [
   ['<circle cx="50" cy="40" r="6"/>',{x:44,y:34,w:12,h:12}],
   ['<ellipse cx="70" cy="50" rx="9" ry="4"/>',{x:61,y:46,w:18,h:8}],
   ['<rect x="2" y="40" width="12" height="10"/>',{x:2,y:40,w:12,h:10}],
   ['<rect x="2" y="40" width="12" height="10" ry="2"/>',{x:2,y:40,w:12,h:10}],
   ['<rect x="2" y="40" width="12" height="10" rx="90" ry="90"/>',{x:2,y:40,w:12,h:10}]
  ]){const result=await read(svg('<g fill="none" stroke="black">'+shape+'</g>'));assert.equal(result.paths.length,1);for(const key of Object.keys(bounds))assert(Math.abs(result.sourceBounds[key]-bounds[key])<.005,shape+' '+key);assert.deepEqual(result.paths[0][0],result.paths[0].at(-1));}
  const rectangle=await read(svg('<rect x="2" y="40" width="12" height="10" fill="none" stroke="black"/>'));assert.deepEqual(rectangle.paths,[[[0,0],[1,0],[1,1],[0,1],[0,0]]]);
  const moved=await read(svg('<g transform="translate(7 9) scale(2 3)" fill="none" stroke="black"><line x1="1" y1="2" x2="20" y2="30"/></g>'));assert.deepEqual(moved.sourceBounds,{x:9,y:15,w:38,h:84});
  const degenerate=await read(svg('<path fill="none" stroke="black" d="'+d+'"/><circle cx="500" cy="500" r="0"/><rect x="500" y="500" width="0" height="20"/>'));assert.deepEqual(degenerate.paths,base.paths);
  console.log('PASS independent bounds, sharp corners, closed circles/ellipses, radius defaults/clamping, composed transforms and zero-size shapes');
  const pageDisplay=await page.evaluate(()=>getComputedStyle(document.body).display);
  assert.deepEqual((await read(svg('<style>body{display:none}.line{fill:none;stroke:black}</style><path class="line" d="'+d+'"/>'))).paths,base.paths);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).display),pageDisplay);
  const invalid=[
   '<path onload="window.__svgExecuted=true" stroke="black" d="'+d+'"/>',
   '<script>window.__svgExecuted=true</script><path d="'+d+'"/>',
   '<path style="fill:url(https://invalid.example/a.svg#x)" d="'+d+'"/>',
   '<path style="fill:u\\72l(https://invalid.example/a.svg#x)" d="'+d+'"/>',
   '<style>@import "https://invalid.example/a.css";path{stroke:black}</style><path d="'+d+'"/>',
   '<style>path:hover{stroke:black}</style><path d="'+d+'"/>',
   '<use href="https://invalid.example/a.svg#x"/>',
   '<path style="filter:blur(2px);fill:none;stroke:black" d="'+d+'"/>',
   '<path style="fill:none;stroke:black;stroke-dasharray:5 5" d="'+d+'"/>',
   '<path style="fill:none;stroke:black;transform:translate(5px)" d="'+d+'"/>',
   '<path style="fill:none;stroke:black;stroke-width:var(--width)" d="'+d+'"/>'
  ];
  for(const content of invalid)await assert.rejects(read(svg(content)),/SVG/);
  await assert.rejects(read(svg('<g>'.repeat(130)+'<path stroke="black" d="'+d+'"/>'+'</g>'.repeat(130))),/嵌套/);
  assert.equal(await page.evaluate(()=>window.__svgExecuted),undefined);
  console.log('PASS imported styles cannot alter the app or fetch resources; unsupported effects, scripts, references and excessive nesting fail explicitly');
  await page.evaluate(()=>{const s=PenCore.initial();s.objects=[];PenStudio.replaceProject(s);PenNativeShell.go('design');PenStudio.setPenSettings({width:.7});});
  const source=svg('<style>.line{fill:none;stroke:black;stroke-width:8}</style><path class="line" d="'+d+'"/>');
  await page.locator('#imageFile').setInputFiles({name:'stroke-only.svg',mimeType:'image/svg+xml',buffer:Buffer.from(source)});
  await page.waitForFunction(()=>!document.body.classList.contains('busy')&&PenStudio.getState().objects.length===1);
  const imported=await page.evaluate(()=>PenStudio.getState().objects[0]);assert.equal(imported.type,'svg');assert.equal(imported.paths.length,1);assert.deepEqual(imported.paths,base.paths);
  const output=await page.evaluate(()=>{const s=PenStudio.getState(),plan=PenCore.plan(s);return{svg:PenCore.toSVG(s),paths:plan.paths};});assert.equal(output.paths.length,1);assert.equal(output.paths[0].render.width,.7);assert.equal(output.paths[0].render.opacity,1);assert.equal((await read(output.svg)).paths.length,1);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('a1-pen-studio-v1')).objects.length===1);await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.uiBoot==='ready');assert.deepEqual(await page.evaluate(()=>PenStudio.getState().objects[0].paths),imported.paths);
  console.log('PASS real file input -> editable layer -> one plot stroke -> physical nib width -> SVG export -> reload');
  await page.locator('#imageFile').setInputFiles({name:'unsupported.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg(invalid[8]))});await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.equal(await page.evaluate(()=>PenStudio.getState().objects.length),1);
  await page.locator('#imageFile').setInputFiles({name:'next.svg',mimeType:'image/svg+xml',buffer:Buffer.from(source)});await page.waitForFunction(()=>!document.body.classList.contains('busy')&&PenStudio.getState().objects.length===2);
  console.log('PASS rejected SVG retains the current artwork and releases import for the next file');
  const translated=await page.evaluate(async()=>{await PenI18n.setLanguage('en');return ['SVG 样式暂不支持：stroke-dasharray；请转换为普通路径','SVG 样式暂不支持：选择器 path:hover；请转换为普通路径','SVG 样式暂不支持：外部引用或样式规则；请转换为普通路径','SVG 样式暂不支持：颜色；请转换为普通路径','SVG 嵌套过深，请简化分组','SVG 尺寸不能是负数'].map(PenI18n.t);});for(const message of translated)assert(!/[\u3400-\u9fff]/.test(message),message);
  console.log('PASS new import errors are translated in English mode');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);assert.equal(bridge.snapshot().printer,null);
 }finally{await browser.close();await bridge.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
