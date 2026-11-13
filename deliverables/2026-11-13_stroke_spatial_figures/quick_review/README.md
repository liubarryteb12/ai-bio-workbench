# 脑卒中空间图件包（2026-11-13）

数据：GSE233814，小鼠 pMCAO 10x Visium，5 个样本 sham / D1 / D3 / D7 / D7b。

## 包内容

| 目录 | 内容 |
|---|---|
| `P1_ABCA1/old_figures/` | P1 旧版生产图 36 张，含原 manifest |
| `P1_ABCA1/new_raw/` | 新风格单切片 50 张、五联图 10 张、总览 1 张、manifest |
| `P1_ABCA1/new_smoothed/` | 新风格一阶邻域平滑单切片 50 张、总览 1 张、manifest |
| `P1_ABCA1/diagnostics/` | D3 零值率条形图与 Egr1 检测图 |
| `P2_LACTPYRO/old_figures/` | P2 旧版生产图 27 张，含原 manifest |
| `P2_LACTPYRO/new_raw/` | 新风格单切片 25 张、五联图 5 张、总览 1 张、manifest |
| `P2_LACTPYRO/new_smoothed/` | 新风格平滑单切片 25 张、总览 1 张、manifest |
| `P2_LACTPYRO/diagnostics/` | D3 零值率条形图与 Egr1 检测图 |

## 新风格口径

- 底图：每个样本自己的 H&E lowres 图，保留完整捕获视野与 fiducial frame。
- 坐标：Space Ranger JSON 原生 `imageX/imageY`，不用共享载玻片布局的像素坐标。
- 色阶：`Spectral_r`，跨样本同一基因共用 q99 上限。
- 点：`alpha=0.75`，单图点径 8，单图放大 1.3 倍。
- 零值层：组织内零计数 spot 用浅灰 `#D9D9D9` 显示，表达值不改。
- 平滑：一阶六边形邻域，自身权重 0.8，仅用于展示，统计继续用原始稀疏矩阵。

## 阅读顺序

1. 先看各项目 `new_raw/contact_sheet_genes_he.png`，这是新风格总览。
2. 再看 `diagnostics/detection_map_D3_Egr1.png`，区分组织内零计数与阳性 spot。
3. 需要更连续的展示效果时看 `new_smoothed/`，文件明确属于展示层。

完整方法与踩坑说明见 `SPATIAL_HE_OVERLAY_PIPELINE.md`。
