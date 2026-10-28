# T-FT-01 箱线图纯水平横线重验

日期：2026-10-28  
状态：PASS

## 变更

- `reference/05.可参考出图代码/L1_基础统计图/L1_boxplot_code.R`
- `reference/05.可参考出图代码/_meta/R453_compat/L1_boxplot_code.R`
- `reference/05.可参考出图代码/L1_基础统计图/L1_boxplot_README.md`

两处 `stat_pvalue_manual()` 的 `tip.length` 均为 `0`，不存在 `0.01`。

主版与兼容版现在字节一致：

```text
source_sha256=dfc6a22b7585849c1c4d11bec312d654b9af63bf20dd2e42876c28834f8b0b0d
```

## K40 实跑

远端目录：

```text
/mnt/ssd/bio_data/validation/aims_v31_boxplot_20261028_0025
```

命令：

```bash
cd /mnt/ssd/bio_data/validation/aims_v31_boxplot_20261028_0025/run
env R453_OUT_DIR=/mnt/ssd/bio_data/validation/aims_v31_boxplot_20261028_0025/out \
  BIOANALYS_SEED=20261013 \
  /mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript \
  --vanilla L1_boxplot_code.R
```

结果：

```text
exit_code=0
stdout=RENDER_OK
```

## 产物

```text
L1_boxplot_verified.png
size=30380
sha256=ce3d2cb08118011f727b4c901fe4921d81129433a9e0507e43edad5b22bf8a82
width=1051
height=708
Pillow verify+load=PASS

L1_boxplot_verified.pdf
size=5477
sha256=90e519371d41eb7ac0b61ed6c82c2f9334fcf5e3fb6f5083bd02206da4848439
PDF header=PASS
```

产物校验报告：

`con_hf/runs/2026-10-28_aims_v31/boxplot_k40/artifact_validation.tsv`

## 注册表

`src/figure_templates.json` 已由生成器刷新：

```text
source_sha256=dfc6a22b7585849c1c4d11bec312d654b9af63bf20dd2e42876c28834f8b0b0d
preview_sha256=ce3d2cb08118011f727b4c901fe4921d81129433a9e0507e43edad5b22bf8a82
```

## 验证

```text
node ops/build_figure_templates.cjs --check
figure_templates.check=ok

node --test BioanalysDesktop/tests/figure_templates_parity.test.js
9 passed
```

人工查看新 PNG 后确认所有显著性标注均为纯水平横线，没有两端下折竖线。
