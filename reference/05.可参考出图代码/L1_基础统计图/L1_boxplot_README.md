# 箱线图（R）

## 这个图干什么用

比较多组连续变量的中位数、四分位与离群点；QC 指标（nFeature/percent.mt）分组比较、基因表达分组差异的首选图。

## 要素表

| 字段 | 内容 |
| --- | --- |
| E1 图型 | 箱线图 |
| E2 关键函数 | `geom_boxplot()` + `stat_pvalue_manual()` + `wilcox_test()` + `add_xy_position()` |
| E3 输入数据 | 三列：`variety`（分组）、`treatment`（亚组）、`note`（连续值）；行数 = 各分组样本数 |
| E4 验收点 | 五条线齐全、离群点单独绘出、组间显著性只使用纯水平横线且 `tip.length = 0`、无红绿配色、单栏 89 mm |

## 文件角色

- 代码原件：`L1_boxplot_code.R`（K40 端验证过）
- 数据契约：`input_data.csv`
- 风格参考：`L1_boxplot_verified.png`（K40 端渲染）
- 矢量母版：`L1_boxplot_verified.pdf`
- 依赖清单：`install_dependencies.txt`
- 验证记录：见 `../_meta/verify.md`

## 出处

Bizard 教程（openbiox/Bizard）对应分类页，代码经其 GitHub Actions 全量执行
后才算通过构建；本库版本已把红绿配色改为 Okabe-Ito 色盲友好配色，并对齐
工作台 `reference/03出图规范` 的字号线宽。
