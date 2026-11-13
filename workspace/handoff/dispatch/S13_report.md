# S13 报告：line2 / line3 全量几何审计（106 图，两档策略）

> 执行：项目实现型子 Agent。派发单 `con_hf/dispatch/S13_line23_full_audit.md`。
> 日期：2026-10-20（本地 CST）；远端 UTC 2026-10-19 16:35 起。
> 项目根：`D:\00.AIagent\codespace\AI辅助生信分析流程工作台`；远端 `/mnt/ssd/bio_data`。
> 通道：`adb forward tcp:8022/10022` → `ssh k40-ubuntu`。
> 本文件**边做边写**，每个脚本跑完立即追加。

---

## 一、任务理解

把 line2/line3 共 106 张图的 `B1?~B4?` UNVERIFIED 变成机器几何判决，按 S12 侦察结论分两档：

- **A 档 · 纯渲染（93 张 / 5 脚本）**：`l2 enrichment_figures(2)`、`l2 scenic_figures(2)`、
  `l2 scrna_figures(28)`、`l3 spatial_figures(57)`、`l3 enrichment_figures(4)`。
- **B 档 · 重算类（13 张 / 5 脚本）**：`l2 target_gene_localization(1)`、`l2 gsva_pathways(1)`、
  `l2 dr_post_analysis(3)`、`l3 celltype_annotation(4)`、`l3 dr_post_analysis(4)`。

纪律：一律 `--seed 20261013`（#190）；不 `--write`；不改 `--runner`；每个脚本前后做 md5 基线比对；
数据表必须逐项一致，`*_report.txt` 只允许 `elapsed_seconds` 类计时行变化，其他差异立即停并上报 P0。

执行边界：除 `cn_debug/figure_audit_sweep/*.csv`、`cn_debug/figure_audit_all.csv` 与本报告外，
不改仓库任何文件；不审 line1。

---

## 二、实现摘要

1. **链路与源码一致性通过**：`ssh k40-ubuntu` OK（Python 3.12.3）；本地 `src/` 与远端 `bin/` 的
   10 个出图脚本 **md5 10/10 一致**；审计工具 `ops/audit_figure_layout.py` = `4e0a6647…`（#190 修复版）。
2. **A 档 93 张全部拿到机器判决**：5 个脚本、5 次审计，全部 `audit: figs=N fail=0 write=False`，
   合计 **93 图 93 PASS、0 FAIL**；两条线 `figures/`（37/69 文件）与 `processed/`（59/101 文件）
   在每个脚本跑后均 **0 差异**（清单 md5 逐次相同）。
3. **B 档第 1 个脚本即命中 P0 停止条件**：`l2/target_gene_localization` 的 bash 审计把
   `localization_report.txt`（`seed` 行 20261018→20261013）与 `scrna_localization.h5ad`
   （`uns.localization.seed` 字段）原地改写，按派发单「`.h5ad` md5 必须逐项一致」的硬口径判定为
   P0。**已按要求停止后续 4 个 B 档脚本（12 图）**，附差异内容与字段级定位，等裁决。
   数值表 `target_gene_localization*.tsv` 未变，差异可完全归因到种子 provenance 修复。
4. **合并表落地**：`cn_debug/figure_audit_all.csv` = 121 图（line1 27 + S13 A 档 93 + S13 B 档 1），
   `PASS=121 / FAIL=0`，无同名覆盖。
5. **两线打分**：line2 `figs=37 PASS=33 FAIL=0 UNVERIFIED=4`；line3 `figs=69 PASS=61 FAIL=0
   UNVERIFIED=8`。UNVERIFIED 只剩 B 档未审的 12 张，成因是缺几何审计条目（`B1?~B4?`）；
   `D2/D3` 已由 `--src-root` 静态映射全覆盖，台账缺失未造成额外缺口。
6. 净效果：line2/line3 的 `B1?~B4?` UNVERIFIED 从 **106 → 12**（-88.7%），剩余 12 张全部卡在
   B 档 P0 裁决上。

## 三、文件变更清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `con_hf/dispatch/S13_report.md` | 新建 | 本报告 |
| `cn_debug/figure_audit_sweep/s13_line2_scrna_enrichment_figures.csv` | 新建 | 2 图，md5 `08bc9a611720d62bd0482a4d15353e9e` |
| `cn_debug/figure_audit_sweep/s13_line2_scrna_scenic_figures.csv` | 新建 | 2 图，md5 `4fd1c894cfc7dca6c75d879cf7606276` |
| `cn_debug/figure_audit_sweep/s13_line2_scrna_scrna_figures.csv` | 新建 | 28 图，md5 `41ac1c5f4e7160ec5e9aed69cec44ddc` |
| `cn_debug/figure_audit_sweep/s13_line3_spatial_enrichment_figures.csv` | 新建 | 4 图，md5 `a183dd9e9ed846e3b204fc054414fc41` |
| `cn_debug/figure_audit_sweep/s13_line3_spatial_spatial_figures.csv` | 新建 | 57 图，md5 `0d41ecb08aebe8e701fd99a537068791` |
| `cn_debug/figure_audit_sweep/s13_line2_scrna_target_gene_localization.csv` | 新建 | 1 图，md5 `183a2e8d84f57ebdbff53ca82c851a82` |
| `cn_debug/figure_audit_all.csv` | 新建 | 121 图合并表，md5 `20c2deb5c2ae43493040891b0a53b47e` |

未改任何 `src/`、`ops/`、`docs/`、`cn_debug/*.py`；未写远端 `bin/`、`figures/`。
**远端 `processed/` 有 2 个文件被审计过程原地改写**（见 §5.6，P0 事实，非我主动写入）：
`projects/default/line2_scrna/processed/localization_report.txt`、`scrna_localization.h5ad`。

改动范围佐证的限制：工作区**不是 git 仓库**，无法用 `git diff` 界定改动。用
`find . -type f -newermt '-45 minutes'` 核查时发现同期**有并行活动**（`cn_debug/2026-10-20_k40_bench/*`、
`cn_debug/subagent_s13.log`、`con_hf/handoff.md`、`con_hf/踩坑台账.md`、`con_hf/操作台账.md`、
`docs/k40_cpu_affinity.md`、`project_data/Ischemic Stroke/*` 等的 mtime 落在同一窗口），
这些**不是本切片写的**；本切片落盘仅上表 8 个文件。

---

## 四、测试与验证记录

### 4.1 链路自检

```
$ adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022
$ ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu 'echo OK; hostname; python3 -V; date'
OK
localhost
Python 3.12.3
Mon Oct 19 16:35:44 UTC 2026
```

审计工具版本核对（#190 修复版）：

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && md5sum ops/audit_figure_layout.py'
4e0a6647efe8d02f605fdb75ad4b57f8  ops/audit_figure_layout.py
```

### 4.2 本地 `src/` 与远端 `bin/` 源码一致性（10/10）

| 脚本 | 本地 md5 | 远端 md5 | 一致 |
|---|---|---|---|
| `l2/enrichment_figures` | `80067ffe541f1a81dcdc25d4abe70a49` | `80067ffe541f1a81dcdc25d4abe70a49` | ✔ |
| `l2/scenic_figures` | `2934b357e2289627c3c7e332b0b732dd` | `2934b357e2289627c3c7e332b0b732dd` | ✔ |
| `l2/scrna_figures` | `148dfb08eca39092c32906661a53be24` | `148dfb08eca39092c32906661a53be24` | ✔ |
| `l2/target_gene_localization` | `ebd67592c21a568a3759a452cfae07da` | `ebd67592c21a568a3759a452cfae07da` | ✔ |
| `l2/gsva_pathways` | `b5ae10277903b0c83eaacf6657407f4f` | `b5ae10277903b0c83eaacf6657407f4f` | ✔ |
| `l2/dr_post_analysis` | `da7465a6ab33328867990330012f1103` | `da7465a6ab33328867990330012f1103` | ✔ |
| `l3/spatial_figures` | `1fd7ab9107603775bae9c31f669e4019` | `1fd7ab9107603775bae9c31f669e4019` | ✔ |
| `l3/enrichment_figures` | `ead967ba4cb3926ef0de770db9cc2750` | `ead967ba4cb3926ef0de770db9cc2750` | ✔ |
| `l3/celltype_annotation` | `c8d9d093b8c1f76819ef21fc2070fc48` | `c8d9d093b8c1f76819ef21fc2070fc48` | ✔ |
| `l3/dr_post_analysis` | `51c729aa29ef2f74f7a757b7d893bfe5` | `51c729aa29ef2f74f7a757b7d893bfe5` | ✔ |

复验结论：**10/10 一致**，与 S12 实测相同。审的是本地同版源码。

### 4.3 B 档前置：全量 md5 基线

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data/projects/default && for line in line2_scrna line3_spatial; do
    time find $line/figures -type f | sort | xargs md5sum > /tmp/s13_before_${line}_figs.md5
    time find $line/processed -type f | sort | xargs md5sum > /tmp/s13_before_${line}_proc.md5
  done'
```

| 基线 | 文件数 | 耗时 | 清单 md5 |
|---|---|---|---|
| `/tmp/s13_before_line2_scrna_figs.md5` | 37 | 0.15s | `926153fad89acfa1fa0e19e55c98fe87` |
| `/tmp/s13_before_line2_scrna_proc.md5` | 59 | 3.82s | `e03e56aef9644eb8cdfca56bad1f1fca` |
| `/tmp/s13_before_line3_spatial_figs.md5` | 69 | 0.27s | `71c660a41f443e4ba661ae7a3d905201` |
| `/tmp/s13_before_line3_spatial_proc.md5` | 101 | 53.93s | `f56ac8f85077c1c4f122e8edfacee5c7` |

（line3 processed 含多份 GB 级 h5ad，md5 全程 53.9s，比 S12 对 line2 的 3.5s 高一个量级——
这是本切片最贵的一次 IO，后续每个 B 档脚本后只重算该线，不重算另一线。）

---

## 五、逐脚本审计记录

### 5.1 `line2_scrna / enrichment_figures`（A 档，2 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line2_scrna/enrichment_figures \
    --cwd projects/default/line2_scrna/processed \
    --runner bash --seed 20261013 --csv /tmp/s13_line2_scrna_enrichment_figures.csv; echo "EXIT=$?"'
```

**输出尾行原文**

```
=== /mnt/ssd/bio_data/bin/line2_scrna/enrichment_figures @ projects/default/line2_scrna/processed
step_executed=enrichment_figures
bioanalys_seed=20261013
workdir=/tmp/figaudit_root_888w3p4e/processed
wrote l2_11_ora_top.png
wrote l2_12_gsea_top.png
figures_done count=2 out=/tmp/figaudit_root_888w3p4e/processed/../figures elapsed=1.5s
PASS l2_11_ora_top.png
      INFO tick 标签越出画布 axes0 '16'（tight 裁切可容纳）
PASS l2_12_gsea_top.png
      INFO tick 标签越出画布 axes0 '6'（tight 裁切可容纳）
audit: figs=2 fail=0 write=False
audit-csv: /tmp/s13_line2_scrna_enrichment_figures.csv (2 图)
EXIT=0
real    0m7.729s
```

**基线对比**

| 对象 | 文件数 | 基线清单 md5 | 跑后清单 md5 | 差异文件 | 差异行 |
|---|---|---|---|---|---|
| `line2_scrna/figures` | 37 | `926153fad89acfa1fa0e19e55c98fe87` | `926153fad89acfa1fa0e19e55c98fe87` | 0 | 0（`diff` 无输出） |
| `line2_scrna/processed` | 59 | `e03e56aef9644eb8cdfca56bad1f1fca` | `e03e56aef9644eb8cdfca56bad1f1fca` | 0 | 0（`diff` 无输出） |

**CSV 落本地**：`cn_debug/figure_audit_sweep/s13_line2_scrna_enrichment_figures.csv`，
md5 `08bc9a611720d62bd0482a4d15353e9e`（与 S12 试点 CSV 字节一致，说明该步审计可复现）。
内容：`l2_11_ora_top.png,PASS` / `l2_12_gsea_top.png,PASS`。

### 5.2 `line2_scrna / scenic_figures`（A 档，2 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line2_scrna/scenic_figures \
    --cwd projects/default/line2_scrna/processed \
    --runner bash --seed 20261013 --csv /tmp/s13_line2_scrna_scenic_figures.csv; echo "EXIT=$?"'
```

**输出尾行原文**

```
=== /mnt/ssd/bio_data/bin/line2_scrna/scenic_figures @ projects/default/line2_scrna/processed
step_executed=scenic_figures
bioanalys_seed=20261013
by_celltype=(13, 129) summary=129
wrote l2_scenic_01_regulon_heatmap.png
wrote l2_scenic_02_top_regulons.png
scenic_figures_done count=2 elapsed=1.1s
PASS l2_scenic_01_regulon_heatmap.png
PASS l2_scenic_02_top_regulons.png
      INFO tick 标签越出画布 axes0 '4.0'（tight 裁切可容纳）
audit: figs=2 fail=0 write=False
audit-csv: /tmp/s13_line2_scrna_scenic_figures.csv (2 图)
EXIT=0
real    0m3.452s
```

**基线对比**

| 对象 | 文件数 | 基线清单 md5 | 跑后清单 md5 | 差异文件 | 差异行 |
|---|---|---|---|---|---|
| `line2_scrna/figures` | 37 | `926153fad89acfa1fa0e19e55c98fe87` | `926153fad89acfa1fa0e19e55c98fe87` | 0 | 0（`diff` 无输出） |
| `line2_scrna/processed` | 59 | `e03e56aef9644eb8cdfca56bad1f1fca` | `e03e56aef9644eb8cdfca56bad1f1fca` | 0 | 0（`diff` 无输出） |

**CSV 落本地**：`cn_debug/figure_audit_sweep/s13_line2_scrna_scenic_figures.csv`，
md5 `4fd1c894cfc7dca6c75d879cf7606276`。内容：`l2_scenic_01_regulon_heatmap.png,PASS` / `l2_scenic_02_top_regulons.png,PASS`。

### 5.3 `line2_scrna / scrna_figures`（A 档，28 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line2_scrna/scrna_figures \
    --cwd projects/default/line2_scrna/processed \
    --runner bash --seed 20261013 --csv /tmp/s13_line2_scrna_scrna_figures.csv; echo "EXIT=$?"'
```

**输出（原文，逐图 PASS 明细已折叠为计数，关键行全留）**

```
=== /mnt/ssd/bio_data/bin/line2_scrna/scrna_figures @ projects/default/line2_scrna/processed
step_executed=scrna_figures
bioanalys_seed=20261013
input=/mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_deg.h5ad
loaded cells=4587 genes=2000
contrast=Psoriasis_vs_Healthy | case=Psoriasis | ctrl=Healthy | source=obs 字典序派生
group_colors=Healthy=#3B4992 Psoriasis=#EE0000
loaded deg_all rows=14000
wrote l2_01_umap_celltype.png
... （共 28 行 wrote）
wrote l2_10_pca_diagnosis.png
figures_done count=28 out=../figures elapsed=5.4s
PASS l2_01_umap_celltype.png
... （28 行 PASS，0 行 FAIL；13 条 INFO tick 标签越出画布，均标「tight 裁切可容纳」）
PASS l2_10_pca_diagnosis.png
audit: figs=28 fail=0 write=False
audit-csv: /tmp/s13_line2_scrna_scrna_figures.csv (28 图)
EXIT=0
real    0m13.808s
```

**基线对比**

| 对象 | 文件数 | 基线清单 md5 | 跑后清单 md5 | 差异文件 | 差异行 |
|---|---|---|---|---|---|
| `line2_scrna/figures` | 37 | `926153fad89acfa1fa0e19e55c98fe87` | `926153fad89acfa1fa0e19e55c98fe87` | 0 | 0（`diff` 无输出） |
| `line2_scrna/processed` | 59 | `e03e56aef9644eb8cdfca56bad1f1fca` | `e03e56aef9644eb8cdfca56bad1f1fca` | 0 | 0（`diff` 无输出） |

**CSV 落本地**：`cn_debug/figure_audit_sweep/s13_line2_scrna_scrna_figures.csv`，
29 行（1 表头 + 28 图），`grep -c PASS` = 28，md5 `41ac1c5f4e7160ec5e9aed69cec44ddc`。

### 5.4 `line3_spatial / enrichment_figures`（A 档，4 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line3_spatial/enrichment_figures \
    --cwd projects/default/line3_spatial/processed \
    --runner bash --seed 20261013 --csv /tmp/s13_line3_spatial_enrichment_figures.csv; echo "EXIT=$?"'
```

**输出尾行原文**

```
=== /mnt/ssd/bio_data/bin/line3_spatial/enrichment_figures @ projects/default/line3_spatial/processed
step_executed=enrichment_figures
bioanalys_seed=20261013
workdir=/tmp/figaudit_root_s7wa4pil/processed
wrote l3_mouse_12_ora_top.png
wrote l3_mouse_13_gsea_top.png
wrote l3_human_12_ora_top.png
wrote l3_human_13_gsea_top.png
figures_done count=4 out=/tmp/figaudit_root_s7wa4pil/processed/../figures elapsed=2.7s
PASS l3_mouse_12_ora_top.png
PASS l3_mouse_13_gsea_top.png
      INFO tick 标签越出画布 axes0 '15'（tight 裁切可容纳）
PASS l3_human_12_ora_top.png
      INFO tick 标签越出画布 axes0 '160'（tight 裁切可容纳）
PASS l3_human_13_gsea_top.png
      INFO tick 标签越出画布 axes0 '15'（tight 裁切可容纳）
audit: figs=4 fail=0 write=False
audit-csv: /tmp/s13_line3_spatial_enrichment_figures.csv (4 图)
EXIT=0
real    0m5.551s
```

**基线对比**

| 对象 | 文件数 | 基线清单 md5 | 跑后清单 md5 | 差异文件 | 差异行 |
|---|---|---|---|---|---|
| `line3_spatial/figures` | 69 | `71c660a41f443e4ba661ae7a3d905201` | `71c660a41f443e4ba661ae7a3d905201` | 0 | 0（`diff` 无输出） |
| `line3_spatial/processed` | 101 | `f56ac8f85077c1c4f122e8edfacee5c7` | `f56ac8f85077c1c4f122e8edfacee5c7` | 0 | 0（`diff` 无输出） |

**CSV 落本地**：`cn_debug/figure_audit_sweep/s13_line3_spatial_enrichment_figures.csv`，
md5 `a183dd9e9ed846e3b204fc054414fc41`，4 图全 PASS。

### 5.5 `line3_spatial / spatial_figures`（A 档，57 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line3_spatial/spatial_figures \
    --cwd projects/default/line3_spatial/processed \
    --runner bash --seed 20261013 --csv /tmp/s13_line3_spatial_spatial_figures.csv \
    > /tmp/s13_l3_spatial_figures.log 2>&1; echo "EXIT=$?"'
```

（首次跑未落 log、被 `tail -80` 截掉首部 3 行；为留 `bioanalys_seed` 原文原样重跑一次，
两次判决一致，见下。）

**输出原文（首部 + 尾行）**

```
=== /mnt/ssd/bio_data/bin/line3_spatial/spatial_figures @ projects/default/line3_spatial/processed
step_executed=spatial_figures
bioanalys_seed=20261013
input_mouse=/mnt/ssd/bio_data/projects/default/line3_spatial/processed/spatial_knockout_mouse.h5ad
input_human=/mnt/ssd/bio_data/projects/default/line3_spatial/processed/spatial_knockout_human.h5ad
...
figures_done count=57 elapsed=15.1s
audit: figs=57 fail=0 write=False
EXIT=0
real    0m29.662s
```

`grep -c '^PASS'` = 57，`grep -c '^FAIL'` = 0，`grep -c '^wrote'` = 57，
`grep -c 'INFO tick'` = 8（全部标「tight 裁切可容纳」）。
`input_mouse/input_human` 指向 `spatial_knockout_*.h5ad`，与 S12 §5.5 P2 记录的 `emulate_env` 错配无关
（本切片一律 `--runner bash`，走 `derive_inputs()`）。

**两次运行对比（确定性）**

| 运行 | `figures_done elapsed` | 墙钟 | figs | fail |
|---|---|---|---|---|
| 第 1 次 | 29.9s | 37.7s | 57 | 0 |
| 第 2 次（留 log） | 15.1s | 29.7s | 57 | 0 |

渲染耗时差异来自 page cache 预热，判决数一致。

**基线对比**

| 对象 | 文件数 | 基线清单 md5 | 跑后清单 md5 | 差异文件 | 差异行 |
|---|---|---|---|---|---|
| `line3_spatial/figures` | 69 | `71c660a41f443e4ba661ae7a3d905201` | `71c660a41f443e4ba661ae7a3d905201` | 0 | 0（`diff` 无输出） |
| `line3_spatial/processed` | 101 | `f56ac8f85077c1c4f122e8edfacee5c7` | `f56ac8f85077c1c4f122e8edfacee5c7` | 0 | 0（`diff` 无输出） |

**CSV 落本地**：`cn_debug/figure_audit_sweep/s13_line3_spatial_spatial_figures.csv`，
58 行（1 表头 + 57 图），`grep -c PASS` = 57，md5 `0d41ecb08aebe8e701fd99a537068791`。

**A 档小结（5 脚本 / 93 图）**：`figs=93 fail=0`，两条线 `figures/` + `processed/` 全部 0 差异。

### 5.6 `line2_scrna / target_gene_localization`（B 档，1 图）——**触发 P0 判定条件，已停止后续审计**

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line2_scrna/target_gene_localization \
    --cwd projects/default/line2_scrna/processed \
    --runner bash --seed 20261013 --csv /tmp/s13_line2_scrna_target_gene_localization.csv \
    > /tmp/s13_l2_tgl.log 2>&1; echo "EXIT=$?"'
```

**输出原文**

```
=== /mnt/ssd/bio_data/bin/line2_scrna/target_gene_localization @ projects/default/line2_scrna/processed
step_executed=target_gene_localization
bioanalys_seed=20261013
loaded cells=4587 genes=2000
target genes=11 (ko=['TNF'], top5 per celltype)
wrote target_gene_localization.tsv (143 行 = 11 基因 x 13 细胞类型)
wrote scrna_localization.h5ad (obs.target_gene_expr = TNF)
target_gene_localization_done
PASS l2_13_target_gene_dotplot.png
audit: figs=1 fail=0 write=False
audit-csv: /tmp/s13_line2_scrna_target_gene_localization.csv (1 图)
EXIT=0
real    0m20.280s
```

`wrote ... .tsv` / `wrote ... .h5ad` 两行证明软链穿透真实发生（S12 §5.3 预言的 P0 机制）。

**基线对比（`diff` 原文）**

```
=== FIGDIFF ===
(no diff)
=== PROCDIFF ===
27c27
< c029a3e0ffa50cb2d290280429b848ab  line2_scrna/processed/localization_report.txt
---
> 3d3f940f0e003d848bdff485b5fa2584  line2_scrna/processed/localization_report.txt
48c48
< 6aa4f8ce1a30bff97552c78a08a1cee1  line2_scrna/processed/scrna_localization.h5ad
---
> d73a30b4d8a99af3408fb79d6aa0a3bc  line2_scrna/processed/scrna_localization.h5ad
```

| 对象 | 文件数 | 基线清单 md5 | 跑后清单 md5 | 差异文件 | 差异性质 |
|---|---|---|---|---|---|
| `line2_scrna/figures` | 37 | `926153fad89acfa1fa0e19e55c98fe87` | `926153fad89acfa1fa0e19e55c98fe87` | 0 | 无 |
| `line2_scrna/processed` | 59 | `e03e56aef9644eb8cdfca56bad1f1fca` | `8dcfee9cedcc33f5c535ca20462a9cce` | **2** | `localization_report.txt`、`scrna_localization.h5ad` |

**差异诊断（已定位到具体字段，附证据）**

1. `target_gene_localization.tsv` / `target_gene_localization_wide.tsv` **未变**（不在 diff 里）——
   即该步的**数值结果字节级一致**。
2. `localization_report.txt` 现文（原文节选）：

```
step=target_gene_localization
seed=20261013
...
elapsed_seconds=6.4
```

   S12 §5.5 P1 已记录：这 5 份重算报告此前是 `seed=20261018`。故报告差异 = `seed` 行
   `20261018 → 20261013`（真种子修复）+ `elapsed_seconds=6.3 → 6.4`。**seed 行不属于
   「计时行」**，按派发单判定口径属「其他差异」。
3. `scrna_localization.h5ad` 现内容（`h5py` 实读，原文）：

```
uns/localization:
  expression_note = "从 layers['counts'] 重算 normalize_total(1e4)+log1p；specificity = celltype 均值 / 全局均值"
  ko_genes = ['TNF']
  lead_gene = 'TNF'
  method = 'celltype_mean_and_pct_from_counts_lognorm'
  n_targets = 11
  seed = 20261013          ← 原为 20261018
  targets = ['TNF','ZWINT','A2M','ZSCAN26','A2ML1','ZNF883','ABCA6','ABCB1','ABCC9','ZNF84','ZNF835']
  top_per_celltype = 5
obs/target_gene_expr: (4587,) min=0.0 max=6.979212760925293 mean=0.309396
X checksum 148992fbee91d408c2db0ae9a97c5b8c / counts.data checksum a069f71d9423b6fef7212c581e532355
```

   源码 `src/line2_scrna/scripts/target_gene_localization:314-325` 把 `SEED` 写进
   `adata.uns["localization"]["seed"]`，全脚本 `SEED` 只出现在 L63（解析）、L323（uns）、
   L365（报告）三处，**不参与任何数据计算**。所以 h5ad 的字节差异来源是
   `uns.localization.seed` 字段改写 + HDF5 容器重写，`X` / `layers` / `obs` 数值未参与随机过程。

**结论**：本次差异属 S12 §9.1 预判的 P1「种子 provenance 修复」的必然副作用
（真种子 20261013 覆盖被污染的 20261018），**不是数据损坏**；但按本派发单的硬口径
（`.h5ad` md5 必须逐项一致、报告只许计时行变）**命中 P0 停止条件**，因此：
**已停止后续 4 个 B 档脚本，等主 Agent 裁决。**

**CSV 落本地**：`cn_debug/figure_audit_sweep/s13_line2_scrna_target_gene_localization.csv`，
md5 `183a2e8d84f57ebdbff53ca82c851a82`，内容 `l2_13_target_gene_dotplot.png,PASS`。

### 5.7 A4 — 合并 `cn_debug/figure_audit_all.csv`

合并脚本（临时工具，**未进仓库**，落在
`<USER_HOME>\AppData\Local\hermes\profiles\sw-engineer\cache\scratch\s13\merge_audit_csv.py`）：

```
$ python <scratch>/s13/merge_audit_csv.py "D:/00.AIagent/codespace/AI辅助生信分析流程工作台"
read cn_debug/figure_audit_line1.csv                                           27 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_enrichment_figures.csv         2 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_scenic_figures.csv             2 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_scrna_figures.csv             28 图
read cn_debug/figure_audit_sweep/s13_line3_spatial_enrichment_figures.csv       4 图
read cn_debug/figure_audit_sweep/s13_line3_spatial_spatial_figures.csv         57 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_target_gene_localization.csv   1 图
--- 输入合计 121 行，去重后 121 图 ---
verdict: {'PASS': 121}
source tag: {'line1_bulk': 27, 's13_A': 93, 's13_B': 1}
```

| 项 | 值 |
|---|---|
| 输出 | `cn_debug/figure_audit_all.csv`（122 行 = 1 表头 + 121 图），md5 `20c2deb5c2ae43493040891b0a53b47e` |
| 列 | `figure,verdict,violations,source`（前三列是派发单指定列，`source` 列即「注明来源」；`figure_score.load_audit_csv` 用 `DictReader` 按名取列，多一列不影响打分） |
| 同名图覆盖 | **0 次**（三线图名前缀 `l1_`/`l2_`/`l3_` 天然不撞，去重后行数 = 输入行数） |
| 总判决 | 121 图，**PASS=121，FAIL=0，无其他判决** |

来源分布：`figure_audit_line1.csv` 27（line1，本轮未重跑）、`s13_A` 93、`s13_B` 1。

### 5.8 A5 — 两线打分复跑（尾行原文）

**line2**

```
$ python cn_debug/figure_score.py --dir outputs/default/line2_scrna/figures \
    --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
    --src-root src --ledger-dir outputs/system_logs
...
UNVERIFIED  80.0 l2_14_gsva_heatmap.png               B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l2_15_dr_gsea_top.png                B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l2_16_dr_regulatory_network.png      B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l2_17_dr_overlap.png                 B1?,B2?,B3?,B4?
score: figs=37 PASS=33 FIX=0 FAIL=0 UNVERIFIED=4 avg=97.8 threshold=75
```

**line3**

```
$ python cn_debug/figure_score.py --dir outputs/default/line3_spatial/figures \
    --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
    --src-root src --ledger-dir outputs/system_logs
...
UNVERIFIED  80.0 l3_human_10_dr_gsea_top.png          B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_human_11_dr_overlap.png           B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_human_14_deconv_umap.png          B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_human_15_deconv_composition.png   B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_mouse_10_dr_gsea_top.png          B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_mouse_11_dr_overlap.png           B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_mouse_14_deconv_umap.png          B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_mouse_15_deconv_composition.png   B1?,B2?,B3?,B4?
score: figs=69 PASS=61 FIX=0 FAIL=0 UNVERIFIED=8 avg=97.7 threshold=75
```

**UNVERIFIED 的成因（逐条）**：全部只缺 `B1?~B4?`，即「没有几何审计 CSV 条目」。
`D2/D3` 全部命中——`--src-root src` 的源码静态映射把 94 张已审图全部归因到出图脚本，
`ledger-dir` 里确实**没有** default 项目 line2/line3 的台账，但静态映射已覆盖，D2/D3 无缺口
（S12 §5.5 P2 记的 D2/D3 UNVERIFIED 风险未发生）。
这 12 张正是 B 档未审的 13 张减去已完成 1 张（`l2_13_target_gene_dotplot.png` 已 PASS）。

### 5.9 A6 — 仍未拿到判决的图（12 张，全部因 P0 停止）

| 图 | 所属脚本（档） | 原因 |
|---|---|---|
| `l2_14_gsva_heatmap.png` | `l2/gsva_pathways`（B） | 未审：P0 停止 |
| `l2_15_dr_gsea_top.png` | `l2/dr_post_analysis`（B） | 未审：P0 停止 |
| `l2_16_dr_regulatory_network.png` | `l2/dr_post_analysis`（B） | 未审：P0 停止 |
| `l2_17_dr_overlap.png` | `l2/dr_post_analysis`（B） | 未审：P0 停止 |
| `l3_human_10_dr_gsea_top.png` | `l3/dr_post_analysis`（B） | 未审：P0 停止 |
| `l3_human_11_dr_overlap.png` | `l3/dr_post_analysis`（B） | 未审：P0 停止 |
| `l3_mouse_10_dr_gsea_top.png` | `l3/dr_post_analysis`（B） | 未审：P0 停止 |
| `l3_mouse_11_dr_overlap.png` | `l3/dr_post_analysis`（B） | 未审：P0 停止 |
| `l3_human_14_deconv_umap.png` | `l3/celltype_annotation`（B） | 未审：P0 停止 |
| `l3_human_15_deconv_composition.png` | `l3/celltype_annotation`（B） | 未审：P0 停止 |
| `l3_mouse_14_deconv_umap.png` | `l3/celltype_annotation`（B） | 未审：P0 停止 |
| `l3_mouse_15_deconv_composition.png` | `l3/celltype_annotation`（B） | 未审：P0 停止 |

（无「不可审」图：两线无 R 出图脚本，#197 结论成立。）

---

## 六、视觉审查

未做。本切片只做几何/布局机器判决，未逐张查看 PNG，不对美观性下结论。

---

## 七、假设与风险

1. **P0 的定性有分歧**（需裁决）：按派发单硬口径（`.h5ad` md5 必须逐项一致）已判 P0；
   但差异已定位到 `uns.localization.seed` 一个字段，数值表字节不变，属 S12 §9.1 预判的
   种子 provenance 修复副作用，**不是数据损坏**。两种口径我都不擅自选。
2. **B 档剩余 4 个脚本大概率会真的改数据表**（这是没继续跑的关键理由，属推断但依据明确）：
   - `l2/gsva_pathways`：`gsva_scores.tsv` 由 R `GSVA::gsva()` 重算后写回（S12 记 L98/L142）；
   - `l2/dr_post_analysis` / `l3/dr_post_analysis`：GSEA `permutation_num=1000` 用 `seed=SEED`，
     `dr_enrichment.tsv` 会随种子重算（S12 记 L270/L303）；
   - `l3/celltype_annotation`：NNLS 反卷积重算并写 `celltype_annotation_*.tsv` /
     `spatial_deconv_*.h5ad`（S12 记 L356/366/373）。
   也就是说，继续跑不只是「报告 seed 行变化」，而是**会把交付级数据表换成 20261013 版本**，
   交付图与数据的一致性需要整链重跑（重算→重扫→重打分），这必须由主 Agent 决策后执行。
3. **基线已过期**：`/tmp/s13_before_line2_scrna_proc.md5` 是 B1 之前的原始状态；
   B1 跑后 line2 processed 清单变成 `8dcfee9cedcc33f5c535ca20462a9cce`
   （已存 `/tmp/s13_now_line2_scrna_proc.md5`）。若裁决后继续跑，应以此为新基线，
   否则 B2 的 diff 会把 B1 的改动一起算进去。
4. **line3 基线仍然干净**：`f56ac8f85077c1c4f122e8edfacee5c7` 自始至终未变（本轮只跑过 A 档两个脚本）。
5. **判决对象是「重渲染结果」**：审计在 stage 目录重渲染，判决针对新渲染的图；
   交付 PNG 本身未变（figures/ md5 全程一致）。A 档已证重渲染与交付图同源同参数
   （`enrichment_figures` CSV 与 S12 试点字节一致）。B 档的 `l2_13` 判决针对
   20261013 重算后的渲染，与磁盘上那份用 20261018 算的 PNG 的差异未逐像素核对。
6. **耗时与 S12 估算的偏差**：A 档实测总墙钟 ≈ 8+3.5+14+5.5+30 ≈ 61s（S12 估 2.5–5.5min，偏保守）；
   line3 `processed/` 一次全量 md5 实测 **53.9s**（S12 只测过 line2 的 3.5s），
   这是 B 档每步核对的主要成本。

## 八、待主 Agent 决策事项

1. **【阻断项】B 档是否继续，以及按哪种口径继续。** 三个可选项：
   - **(a) 接受 P0 为「已知的种子修复」继续跑**：用现有基线继续 B2–B5，判据改为
     「数值表允许变化，但必须与 `--seed 20261013` 重算结果自洽；报告只允许 seed/elapsed 变」。
     代价：会真改 3–5 个数据表 + 2 个 h5ad，之后必须重扫重打分。
   - **(b) 先在副本上跑（不改真数据）**：把 `projects/default/<line>/processed` 复制到
     `/tmp/s13_stage/<line>/processed`，`--cwd` 指向副本。软链穿透只会写副本，
     真 `processed/` 零风险，能拿到 12 张图的判决。**代价：`--cwd` 偏离派发单模板**
     （属「变更建议」，需你批准）；且 `l2_13` 已完成，这一项不重复。
     风险：line3 `processed/` 含 GB 级 h5ad，`cp -a` 需额外磁盘（约 2–3GB）与 1–2min。
   - **(c) 维持停止**，B 档 12 张继续 UNVERIFIED，等「重算→重扫→重打分」整链立项。
2. **种子处置的最终口径**：`l2_13` 的报告/h5ad 现已是 `20261013`（provenance 变正确），
   但磁盘上交付 PNG 仍是 20261018 那批算的。要不要一并把这条线的交付图按真种子重出？
3. **`figure_audit_all.csv` 的 `source` 列**：我加了第 4 列以满足「注明来源」。
   若下游要求严格三列，我可以去掉（不影响 `figure_score`）。

## 九、建议下一步

1. 先裁决 §8.1。若选 **(b) 副本方案**，我可以在 3–5 min 内把剩余 12 张图判完，
   且真 `processed/` 零风险；跑完只需在合并表里追加 4 个 CSV 再复跑两次打分。
2. 若选 (c)，建议把「line2/line3 重算 5 步按真种子重跑 + 整链重扫重打分」立为独立切片，
   并把 `_stage_dir()` 的软链改复制（S12 §8.1 建议 1）一起做掉——否则每次审计都在改真数据。
3. **line1 侧的遗留（不在本切片范围，只做事实核对）**：磁盘 29 张图 vs `figure_audit_line1.csv` 27 条，
   差 `l1_07_ppi_network.png` / `l1_08_ppi_hubs.png`（#191 记的「STRING 不可复现禁跑」）。
   `l1_28~31` 那 4 张 R 图**已不在磁盘上**（`outputs/default/line1_bulk/figures` 无此文件），
   所以「6 张 R 图缺口」在本轮交付目录里实际是 0 张缺失；合并表 121 行与三线磁盘图数
   （29+37+69=135）相差 14，差额即 line1 的 2 张 PPI + line2/line3 的 12 张 B 档未审。
   line1 是否需要补这 2 张的判决，请另定。
