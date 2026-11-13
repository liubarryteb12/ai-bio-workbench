# 空间转录组 H&E 叠加出图脚本

这组脚本把 Visium spot 表达叠到每个样本自己的 H&E 低倍图上，输出单切片、
多样本横排、零值诊断与展示层平滑四类产物。

主入口：

```powershell
python tools/reporting/render_spatial_panel.py `
  --project-dir workspace/projects/<项目> `
  --shared-dir workspace/projects/_shared/GSE233814 `
  --genes GeneA,GeneB
```

完整口径、踩坑与验收方法见
`docs/SPATIAL_HE_OVERLAY_PIPELINE.md`。

脚本分工：

| 脚本 | 作用 |
|---|---|
| `render_spatial_panel.py` | 一键流水线 |
| `render_visium_feature_plot_v2.py` | 真正渲染入口 |
| `smooth_spot_master.py` | 一阶邻域平滑，仅展示 |
| `spatial_zero_diagnostics.py` | 零值率与检测图 |
| `build_visium_positions.py` | 从 JSON 重建每样本坐标，供审计 |
