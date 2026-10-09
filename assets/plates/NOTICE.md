# 打印板模型来源

来源：Bambu Lab / Bambu Studio 官方项目。

- A1 mini：[bbl-3dp-A1M.stl](https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/bbl-3dp-A1M.stl)
- A1、P1S：[bbl-3dp-X1.stl](https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/bbl-3dp-X1.stl)，官方对应 machine_model 配置共用该模型。
- 项目许可：[GNU AGPL v3](AGPL-3.0.txt)。原始 STL、来源 SHA-256 和轮廓数据一同提供，无精度担保。

2026-10-02 的转换：从本机 Bambu Studio 自带 STL 提取 Z=0 顶面三角形的边界，保留凹边及孔洞，不使用凸包；保留毫米尺度。将机器 Y 转为画布 Y（180−Y 或 256−Y），不做居中、缩放或轮廓尺寸归一化。`outlines.js` 为转换后的可独立替换数据，适用原始数据许可；`extract-source.cjs` 记录提取方法。

本功能使用的是展示板模型，不是制造图纸。不同品牌和代次的实体板可能有差异；按轮廓裁纸前请核对实物。板外轮廓只参与显示和纸质模板导出，不扩大打印机运动范围。
