# 空间转录组 H&E 叠加出图流程（GSE233814 实证版）

> 版本：v1.0（2026-11-13）
> 适用：10x Visium 空间转录组，逐样本 H&E 底图加 spot 表达叠加
> 目标风格：真实组织纹理、完整捕获视野、冷暖连续色阶、零值可见

## 一、这套流程解决什么问题

把空间转录组的 spot 表达叠到每个样本自己的 H&E 低倍图上，输出
单切片图和多样本横排图。重点不是把点画出来，而是保证三件事同时成立：

1. spot 与组织解剖位置对齐；
2. 零计数 spot 不被误读成“没有测到”；
3. 跨样本色标可比，且不做无依据的零值填充。

## 二、输入清单

共享输入放在 `workspace/projects/_shared/<GSE>/`：

| 文件 | 作用 |
|---|---|
| `01_spot_master.tsv` | spot 级表达表，含 `sample_id`、`barcode`、`expr_<gene>` |
| `spatial_inputs/<GSM>_tissue_lowres_image.png` | 样本自己的 H&E 低倍图 |
| `spatial_inputs/<GSM>_scalefactors_json.json` | 含 `tissue_lowres_scalef` |
| `spatial_inputs/shared_raw/<GSM>_*.json.gz` | Space Ranger 原始 JSON，含 `oligo.imageX/imageY` |

每个项目的样本清单放在：

`workspace/projects/<项目>/figures_config/visium_sections.json`

字段：

```json
{
  "sample_id": "D1-D3",
  "label": "D3",
  "gsm": "GSM7437223",
  "json": "GSM7437223_V10M09-040-D1.json.gz"
}
```

## 三、坐标口径（最重要）

正确链路：

```text
barcode
  -> 载玻片布局表的 (array_row, array_col)
  -> 本样本 JSON oligo 的 (row, col) 匹配
  -> 取该 spot 的 imageX/imageY（全分辨率像素）
  -> 乘 tissue_lowres_scalef
  -> lowres 图像坐标
```

关键约束：

- 载玻片布局表只用来把 barcode 映射到 `(array_row, array_col)`。
- 像素坐标必须来自本样本 JSON 的 `imageX/imageY`。
- 共享布局表里的 `pxl_row/pxl_col` 属于参考载玻片，直接拿来叠图会整体漂移。
- JSON 的 `oligo` 列表是几何顺序，`barcodes.tsv` 是字母序，两者不能按行号硬对。

实证：GSE233814 旧版借用参考布局的 `pxl_row/pxl_col`，D3 的 spot 质心相对
组织质心偏移约 x -107 px、y +28 px，下半部露空。改用 JSON 原生坐标后，
D3 质心差 2.0 px，96.7% 的 spot 落在组织上。

## 四、渲染口径

| 项 | 设置 |
|---|---|
| 底图 | 样本自己的 `tissue_lowres_image.png`，完整捕获视野，保留 fiducial frame |
| 色阶 | `Spectral_r`，0 冷色，中段黄，高值红 |
| 透明度 | spot `alpha=0.75` |
| 点径 | `spot-size=8`，单图放大 1.3 倍 |
| 色标上限 | 每个基因跨样本共用 q99 |
| 零值层 | 组织内零计数 spot 用浅灰 `#D9D9D9` 底点，alpha 0.55 |
| 标题 | `<section> - <gene>`，居中 |
| 图例 | 右侧窄 colorbar，标题 `Expression` |

零值层只改变可见性，不改变表达值。它的图注固定为：

`gray spots: in-tissue, zero UMI count`

## 五、零值与测序深度的判定

Visium 的零值分三类：

1. 组织外捕获点：4,992 个阵列位置里只有部分在组织内，其余是芯片定位框。
2. 组织内真实零计数：该 spot 对该基因的 UMI 计数就是 0。
3. 归一化后的低值：出图层用 `log1p(CPM per 10k)`，零值仍是零。

实证（D3，Egr1）：

- 组织内 2,572 个 spot，阳性 1,163，零计数 1,409，零值率 54.8%。
- master 与原始 `matrix.mtx` 的零/非零判定逐条一致，零错配。
- 渲染 merge 保留全部 2,572 个 spot，丢点 0。
- filtered matrix 2,573 个 barcode，1 个被 QC 过滤。

跨样本比较时，sham 与损伤样本的深度差会改变零值率。GSE233814 的
每 spot 中位 UMI：sham 25,087，D1 11,640，D3 11,928，D7 13,084，
D7b 13,536。出图值已经做过 `log1p(CPM10k)`，所以颜色不受深度整体抬高，
但零值率仍会受深度影响。按泊松抽样，D1 若测到 sham 深度，Egr1 零值率
会从 54.6% 降到约 29.8%，与 sham 实测 30.1% 接近。

## 六、可视化平滑（只在展示层）

一阶六边形邻域平滑用于展示，不进入统计。Visium v1 的正确邻居偏移：

- 同行：列差 `±2`
- 相邻行：行差 `±2`，列差 `±1`

权重：自身 0.8，六邻居均值 0.2。

D3 Egr1 实测：

| 指标 | raw | 一阶平滑 |
|---|---|---|
| 零值率 | 54.8% | 30.7% |
| 均值 | 0.413 | 0.413 |
| 阳性 spot | 1,163 | 1,783 |

1,409 个零 spot 中，620 个（44.0%）至少有一个阳性直接邻居，平滑能补；
其余 789 个（56.0%）直接邻居全为零，补它等于伪造信号。平滑版文件统一放
`smoothed/`，统计与差异分析继续用原始稀疏矩阵。

## 七、输出结构

每个项目的 `report/spatial_panels/`：

```text
raw/
  slice_<section>_<gene>_styleD.png
  spatial_panel_<n>sections_<gene>_styleD.png
  contact_sheet_genes_he.png
  figure_manifest.tsv
smoothed/
  slice_<section>_<gene>_styleD.png
  contact_sheet_genes_he.png
  figure_manifest.tsv
diagnostics/
  zero_fraction_<section>.png / .tsv
  detection_map_<section>_<gene>.png
smoothed_spot_master.tsv
```

## 八、一条命令重跑

P1（10 个 focus gene）：

```powershell
python tools/reporting/render_spatial_panel.py `
  --project-dir workspace/projects/PRJ_STROKE_P1_SPATIAL_ABCA1 `
  --shared-dir workspace/projects/_shared/GSE233814 `
  --genes Myh9,Egr1,Gstp1,Epha4,Tjp1,Abca1,Akt1,Sox9,Adipor2,Dpm1 `
  --cmap Spectral_r --alpha 0.75 --spot-size 8 `
  --zero-color "#D9D9D9" --zero-alpha 0.55 --self-weight 0.8
```

P2（5 个 focus gene）：

```powershell
python tools/reporting/render_spatial_panel.py `
  --project-dir workspace/projects/PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES `
  --shared-dir workspace/projects/_shared/GSE233814 `
  --genes Myh9,Egr1,Gstp1,Epha4,Tjp1 `
  --cmap Spectral_r --alpha 0.75 --spot-size 8 `
  --zero-color "#D9D9D9" --zero-alpha 0.55 --self-weight 0.8
```

跳过平滑或诊断：

`--no-smooth`、`--no-diagnostics`。

## 九、脚本职责

| 脚本 | 职责 |
|---|---|
| `tools/reporting/render_spatial_panel.py` | 一条命令串起 raw、smoothed、panels、diagnostics |
| `tools/reporting/render_visium_feature_plot_v2.py` | 单图与多联图渲染，读项目样本配置 |
| `tools/reporting/smooth_spot_master.py` | 一阶六边形邻域平滑，仅展示 |
| `tools/reporting/spatial_zero_diagnostics.py` | 零值率条形图与检测图 |
| `tools/reporting/build_spatial_contact_sheet.py` | 基因 x 切片审阅总览 |
| `tools/reporting/build_visium_positions.py` | 从 JSON 几何重建每样本位置表，供审计 |

## 十、踩坑清单

1. 共享布局表的 `pxl_row/pxl_col` 只能当阵列索引，不能当本样本像素坐标。
2. `oligo` 几何顺序与 `barcodes.tsv` 字母序不同，必须用 `(row, col)` 关联。
3. 低倍缩放系数要用全分辨率边长，不能拿 lowres 边长反推。
4. Visium v1 同行邻居列差是 2，写成 1 会让平滑静默失效。
5. 零值层只改可见性，不改数值；统计始终回到原始稀疏矩阵。
6. 平滑版与原始版分目录存放，文件名和 manifest 都标明 `smoothed`。
7. 完整捕获视野和 fiducial frame 属于平台质控信息，出图时保留。
