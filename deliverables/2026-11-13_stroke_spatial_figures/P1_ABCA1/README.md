# P1 空间 H&E 叠加图

项目：`PRJ_STROKE_P1_SPATIAL_ABCA1`
数据：GSE233814，5 个样本 sham / D1 / D3 / D7 / D7b

## 产物

| 目录 | 内容 |
|---|---|
| `raw/` | 50 张单切片图，10 基因 x 5 切片 |
| `raw/spatial_panel_5sections_<gene>_styleD.png` | 10 张五联图 |
| `smoothed/` | 50 张一阶邻域平滑图，仅展示 |
| `diagnostics/` | D3 零值率条形图与 Egr1 检测图 |
| `smoothed_spot_master.tsv` | 平滑表，不用于统计 |
| `raw/figure_manifest.tsv` | 原始图清单 |
| `smoothed/figure_manifest.tsv` | 平滑图清单 |

基因：`Myh9, Egr1, Gstp1, Epha4, Tjp1, Abca1, Akt1, Sox9, Adipor2, Dpm1`

## 关键口径

- 12,097 个组织内 spot，全部保留，渲染丢点 0。
- D3 Egr1：1,163 阳性，1,409 零计数，零值率 54.8%。
- D3 Egr1 一阶平滑后零值率 30.7%，均值不变。
- 零值层：组织内零计数 spot 用浅灰点显示，表达值不改。

## 重跑

```powershell
python tools/reporting/render_spatial_panel.py `
  --project-dir workspace/projects/PRJ_STROKE_P1_SPATIAL_ABCA1 `
  --shared-dir workspace/projects/_shared/GSE233814 `
  --genes Myh9,Egr1,Gstp1,Epha4,Tjp1,Abca1,Akt1,Sox9,Adipor2,Dpm1 `
  --cmap Spectral_r --alpha 0.75 --spot-size 8 `
  --zero-color "#D9D9D9" --zero-alpha 0.55 --self-weight 0.8
```

完整规范见 `docs/SPATIAL_HE_OVERLAY_PIPELINE.md`。
