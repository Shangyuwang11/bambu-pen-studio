/* Display names only. Stable mode/style keys preserve saved artwork. */
(function(root){'use strict';
 const modes={
  auto:{name:'自动匹配',use:'按图像选择',description:'线稿采用中线描摹，大面积明暗采用斜向交叉排线；也可手动选择。'},
  skeleton:{group:'线稿提取',name:'中线描摹',use:'黑白线稿',description:'沿已有线条的中心生成单线，适合手绘线稿、简笔画和扫描稿。'},
  outline:{group:'线稿提取',name:'轮廓描边',use:'图标与剪影',description:'沿黑色区域的边界描绘，适合图标、剪影和封闭图形；粗线可能生成内外两道边。'},
  sketch:{group:'线稿提取',name:'边缘提取',use:'照片轮廓',description:'提取图像中明暗变化明显的边缘，适合从照片获得轮廓线。'},
  hatch:{group:'直线排线',name:'水平排线',use:'横向纹理',description:'用平行横线表现明暗，逐段保留细节；细碎原图可能产生较多短笔。'},
  crosshatch:{group:'直线排线',name:'斜向交叉排线',use:'分层阴影',description:'以斜线为主，暗部增加交叉方向，适合需要明显排线纹理的阴影。'},
  'scan-hatch':{group:'直线排线',name:'连续扫描排线',use:'减少碎笔',description:'直线扫描，暗部叠加交叉线。提高去碎线强度可减少短笔，但会省略细纹；增大间距更疏。'},
  wave:{group:'连续绘画',name:'波浪描画',use:'波纹风格',description:'沿波浪线连续绘画，用波形变化表现明暗；浅色区域也会保留基线。'},
  natural:{group:'连续绘画',name:'手绘素描',use:'流线与圈线',description:'选择下方笔触风格，以连续笔迹的疏密表现形体和明暗。'}
 };
 const styles={
  refined:{group:'形体与流线',use:'细节与形体',description:'先表现明暗，再补贴合形体方向的细线，适合需要保留细节的素描。'},
  grouped:{group:'形体与流线',use:'成组弯曲线',description:'将弯曲线条成组排列，用线组疏密表现阴影。'},
  flow:{group:'形体与流线',use:'顺着图像走势',description:'让连续流线跟随图像局部方向，适合舒展的线条和纹理。'},
  tonalLoops:{group:'圈线绘画',use:'明暗与留白',description:'用连续环绕笔迹叠画明暗，并保护亮处留白。'},
  loops:{group:'圈线绘画',use:'环绕涂绘',description:'用游走的小圈组成笔迹，以圈线疏密形成涂绘纹理。'}
 };
 function populate(select,entries,includeAuto=false){
  const selected=select.value,groups=new Map();select.replaceChildren();
  for(const[key,item]of Object.entries(entries)){
   if(key==='auto'&&!includeAuto)continue;
   let parent=select;if(item.group){if(!groups.has(item.group)){const group=document.createElement('optgroup');group.label=item.group;select.append(group);groups.set(item.group,group);}parent=groups.get(item.group);}
   const option=new Option(item.name+' · '+item.use,key);option.title=item.description;parent.append(option);
  }
  if([...select.options].some(o=>o.value===selected))select.value=selected;
 }
 function populateModes(select,includeAuto){populate(select,modes,includeAuto);}
 function populateStyles(select){populate(select,Object.fromEntries(Object.entries(styles).map(([key,item])=>[key,{...item,name:root.PenNaturalOptions.STYLES[key]}])));}
 function describe(mode,style){return mode==='natural'&&styles[style]?styles[style].description:modes[mode]?.description||'';}
 root.PenAlgorithms={modes,styles,populateModes,populateStyles,describe};
})(globalThis);
