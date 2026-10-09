# 第三方笔画数据

打印板轮廓使用拓竹 Bambu Studio 官方模型。来源、转换方法、原始文件和许可见 [打印板模型说明](plates/NOTICE.md)。

## 中文

来源：[Make Me a Hanzi](https://github.com/skishore/makemeahanzi)，`graphics.txt`。

当前打包 9,574 个字的 `medians` 字段，保持原始整数坐标与笔顺，在渲染时按其说明转换坐标。未打包字典数据。提取及格式转换日期：2026-09-26。

原始图形数据来源于 Arphic PL KaitiM GB 与 Arphic PL UKai；字体由 Arphic Technology Co., Ltd. 发布。许可为 Arphic Public License。完整说明见本目录 `Make-Me-a-Hanzi-COPYING.txt` 和 `Arphic-ARPHICPL.TXT`。

修改：只保留每个汉字的中线，转换为 JavaScript 数据表；汉字图形本身未修改。由 A1 Pen Studio 项目作此格式提取。数据可独立于应用代码替换和再分发，适用原数据许可。

## 英文

来源：[kamalmostafa/hershey-fonts](https://github.com/kamalmostafa/hershey-fonts) 中的 `futural.jhf` 与 `scripts.jhf` 数据文件。未复制该项目的程序代码。

The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards.

The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt).

字库数据在保留署名并遵守格式限制的条件下可用于各类目的，详情见 `Latin-Hershey-NOTICE.txt`。`Latin-Hershey-COPYING.txt` 是上游完整许可汇总，开头的 GPL 针对上游程序；本应用仅使用其中独立许可的 `.jhf` 字库数据。

修改：将字库数据转为归一化折线及字符前进宽度，用于离线浏览器渲染。未转为 NTIS 格式。

## 研究中查阅但未使用的数据

Chinese Hershey / Source Han Sans 在调研中评估过，但第一版没有打包或使用其字体路径。应用自有几何、界面、导入与导出逻辑独立实现。
