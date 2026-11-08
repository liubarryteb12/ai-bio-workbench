# S14 报告：B 档剩余 4 个脚本的几何审计（12 图，P0 已裁决）

> 状态：**部分完成 + 1 项 P0 阻断**。
> 已判 5 图（`l2/gsva_pathways` 1 + `l3/celltype_annotation` 4），全部 PASS，数值表零变化；
> 剩余 7 图（`l2/dr_post_analysis` 3 + `l3/dr_post_analysis` 4）**在开跑前用 /tmp 探针证明会改数值表**，
> 按派发单停止条件**未开跑**并上报 P0。详见 §5.3 与 §九。

## 一、任务理解

按派发单：对 S13 因 P0 停止而剩下的 4 个 B 档脚本（`l2/gsva_pathways`、`l2/dr_post_analysis`、
`l3/celltype_annotation`、`l3/dr_post_analysis`，共 12 图）逐个做 bash 真跑几何审计，
`--seed 20261013`、不加 `--write`，跑后按**本轮替换后的停止条件**比对 md5 基线：

- 允许：`*_report.txt` 的 `seed=` 行（20261018→20261013）、`.h5ad` 内 `uns.*.seed`、`elapsed_seconds`；
- 不允许（出现即停、上报 P0）：任何 `.tsv` md5 变化、`.h5ad` 的 `X`/`obs`/`var`/`obsm` 内容变化、
  报告里除 seed/计时行以外的行变化、新增或消失的文件。

## 二、实现摘要

1. 链路自检 + 本地/远端源码一致性：**39/39 md5 相同**（S13 报的 10/10 只统计出图脚本，本次全量）。
2. 审计前对两线 `processed/` + `figures/` 建全量 md5 基线（含 h5ad）。
3. 审计 2 个脚本 → 5 图全部 PASS，差异**只有** `*_report.txt` 的 seed 行/计时行与
   `scrna_gsva.h5ad` 的 `uns/gsva/seed`；`gsva_scores.tsv`、`celltype_scores_*.tsv`、
   `celltype_annotation_*.tsv`、`spatial_deconv_*.h5ad` **逐字节未变**。
4. 对剩余 2 个 `dr_post_analysis` 脚本做**开跑前探针**（只写 `/tmp`）：
   20261018 重算能**逐字节复现**磁盘上的 `dr_enrichment*.tsv`，20261013 重算则**必然不同**
   （1975/1975 行 NES 变）。即跑这两个审计会把 3 张交付数值表换成另一组数字，
   按停止条件属「不允许」，**未开跑，上报 P0**。
5. 合并 CSV：126 图判决（PASS=126, FAIL=0）。三线打分复跑：line1 27/35、line2 34/37、
   line3 65/69 PASS，剩余 15 个 UNVERIFIED 全部有明确原因（§5.5）。

## 三、文件变更清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `cn_debug/figure_audit_sweep/s14_line2_scrna_gsva_pathways.csv` | 新增 | 远端 `/tmp` 拉回，1 图 |
| `cn_debug/figure_audit_sweep/s14_line3_spatial_celltype_annotation.csv` | 新增 | 远端 `/tmp` 拉回，4 图 |
| `cn_debug/figure_audit_all.csv` | 覆盖 | 121 → 126 图（S13 版备份在 `$TMPDIR/s14/figure_audit_all.before_S14.csv`） |
| `con_hf/dispatch/S14_report.md` | 新增 | 本文件 |

临时工具（**未进仓库**）：`$TMPDIR/s14/merge_audit_csv.py`（S13 版加 2 行输入）、
远端 `/tmp/s14_h5diff.py`（h5ad dataset 级 checksum 探针）。

仓库源码、`src/`、`ops/`、`bin/`、`projects/` 下的输入数据**未被我改**；
远端被写的 2 个文件（`gsva_report.txt`、`deconv_report.txt`）来自被审计脚本自身的
`_stage_dir()` 软链穿透（#197 机制），不是本 Agent 直接写入。

## 四、测试与验证记录

### 4.1 链路自检

```
$ adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022
$ ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu 'hostname; date'
localhost
Mon Oct 19 16:55:25 UTC 2026        # = 2026-10-20 00:55 CST
```

### 4.2 本地 `src/` 与远端 `bin/` 源码一致性：39/39

```
$ md5sum src/line2_scrna/scripts/* src/line3_spatial/scripts/* | grep -v README | sed 's#src/##; s# \*#  #; s#/scripts/#/#' | sort -k2 > local_md5.txt
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && md5sum bin/line2_scrna/* bin/line3_spatial/* | grep -v README | sed "s#bin/##" | sort -k2' > remote_md5.txt
$ diff local_md5.txt remote_md5.txt && echo OK
OK   # 39 行（line2 22 + line3 17），逐行 md5 相同
```

`ops/audit_figure_layout.py` 本地 md5 = 远端 md5 = `4e0a6647efe8d02f605fdb75ad4b57f8`（即 #190 修复版）。

### 4.3 全量 md5 基线（审计前）

```
$ cd /mnt/ssd/bio_data/projects/default/$L
$ find figures -type f | sort | xargs md5sum > /tmp/s14_before_${L}_figs.md5
$ find processed -type f | sort | xargs md5sum > /tmp/s14_before_${L}_proc.md5
line2_scrna figs=37 proc=59 procsum=49e1b388b65874f249ffd4143f1955b6 figssum=ebc69f017a523073c78cc0e125b1ae02
line3_spatial figs=69 proc=101 procsum=d35832a4e42ff85d4b43c28fd86e5056 figssum=28edda377f2ef69c953e387a68fde201
```

（`procsum`/`figssum` 是清单文件自身的 md5，只用于本切片内自比；S13 的 `8dcfee9c…` 是不同
`find` 起点生成的清单，两者不可比。）

### 4.4 审计前的存量 seed provenance 事实（决定本轮差异归因的基线）

```
$ ssh k40-ubuntu 'grep -n "^seed=" projects/default/line*/processed/{dr_post_report,gsva_report,deconv_report,localization_report}.txt; stat -c "%y %n" ...'
line2_scrna/processed/dr_post_report.txt  2026-10-18 07:13:22  seed=20261018
line2_scrna/processed/gsva_report.txt     2026-10-18 07:14:46  seed=20261018
line2_scrna/processed/localization_report.txt 2026-10-19 16:44:22  seed=20261013   # S13 已修
line3_spatial/processed/deconv_report.txt 2026-10-18 07:16:29  seed=20261018
line3_spatial/processed/dr_post_report.txt 2026-10-18 07:16:55  seed=20261018
```

配套数值表 mtime 与报告同批（07:13–07:16）→ **磁盘上这批数值表是 20261018 那次运行算出来的**。
这条事实是 §5.1 归因的依据，也是 §5.3 阻断的证据基础。

## 五、逐脚本审计记录

### 5.1 `line2_scrna / gsva_pathways`（B 档，1 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line2_scrna/gsva_pathways \
    --cwd projects/default/line2_scrna/processed \
    --runner bash --seed 20261013 --csv /tmp/s14_line2_scrna_gsva_pathways.csv \
    > /tmp/s14_l2_gsva.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/s14_l2_gsva.log'
```

**输出原文**

```
real    1m15.249s
user    0m53.645s
sys     0m7.029s
EXIT=0
=== /mnt/ssd/bio_data/bin/line2_scrna/gsva_pathways @ projects/default/line2_scrna/processed
step_executed=gsva_pathways
bioanalys_seed=20261013
pseudobulk 24969 genes x 13 celltypes
pseudobulk: 24969 genes x 13 celltypes
gene sets kept (>=10 genes present): 7174
GSVA scores: 7174 pathways x 13 celltypes
wrote gsva_scores.tsv
gsva_pathways_done pathways=7174
PASS l2_14_gsva_heatmap.png
audit: figs=1 fail=0 write=False
audit-csv: /tmp/s14_line2_scrna_gsva_pathways.csv (1 图)
```

**基线对比**

```
=== FIGDIFF ===
(no diff)
=== PROCDIFF ===
20c20
< d80c8181c74f5c50953cc7459b1ab815  processed/gsva_report.txt
---
> abcd258a51e20d33531a529d3d523eee  processed/gsva_report.txt
45c45
< 8aac137b82fa6258b8abb5e2adda4241  processed/scrna_gsva.h5ad
---
> caa0ec33ab3d9e47a08642dc99804026  processed/scrna_gsva.h5ad
```

| 对象 | 文件数（前/后） | 清单 md5（前） | 清单 md5（后） | 差异文件 | 归因 |
|---|---|---|---|---|---|
| `line2_scrna/figures` | 37 / 37 | `ebc69f017a523073c78cc0e125b1ae02` | 同左（`(no diff)`） | 0 | — |
| `line2_scrna/processed` | 59 / 59 | `49e1b388b65874f249ffd4143f1955b6` | 2 个文件变 | `gsva_report.txt`、`scrna_gsva.h5ad` | provenance + 计时 |
| `gsva_scores.tsv`（数值表） | 1 | — | — | **0（不在 diff 里）** | 无变化 |

**差异归因（逐项，含证据）**

1. `gsva_report.txt` → **provenance + 计时**，且**只有这两行**。证法：拿跑后文件把这两行改回去，
   md5 必须等于基线；实测相等，即"除这两行外字节全同"：

```
$ cp gsva_report.txt /tmp/rec_gsva.txt
$ sed -i "s/^seed=20261013$/seed=20261018/; s/^elapsed_seconds=1.2$/elapsed_seconds=2.2/" /tmp/rec_gsva.txt
reconstructed md5: d80c8181c74f5c50953cc7459b1ab815
baseline    md5:   d80c8181c74f5c50953cc7459b1ab815      ← 相等
$ diff /tmp/rec_gsva.txt gsva_report.txt
2c2
< seed=20261018
---
> seed=20261013
46c46
< elapsed_seconds=2.2
---
> elapsed_seconds=1.2
```

   报告里 `n_pathways=7174`、`celltypes=13`、`top-30 pathways ... score=` 全部逐字未变
   （否则 md5 不可能重构相等）。

2. `scrna_gsva.h5ad` → **provenance（`uns/gsva/seed`）**。该文件由 `scrna_deg.h5ad`（输入，
   md5 未变）`read_h5ad` 后只写 `uns["gsva"]` 再 `write_h5ad`（`src/.../gsva_pathways:359-371`）。
   用 dataset 级 checksum 与未变输入逐节点对比，实测差异只有新增的 `uns/gsva/*` 组，
   **`X`/`layers`/`obs`/`obsm`/`obsp`/`var`/`varm`/`varp` 全节点 0 差异**：

```
$ python3 /tmp/s14_h5diff.py scrna_gsva.h5ad scrna_deg.h5ad     # A=跑后  B=未变输入
only_in_A: ['uns/gsva/celltypes', 'uns/gsva/input_matrix', 'uns/gsva/method',
            'uns/gsva/n_cells_per_celltype/<13 个细胞类型>', 'uns/gsva/n_celltypes',
            'uns/gsva/n_pathways', 'uns/gsva/score_note', 'uns/gsva/seed']
only_in_B: []
changed datasets (0):
$ python3 -c '...print(f["uns/gsva/seed"][()], f["uns/seed"][()])'
uns/gsva/seed = 20261013
uns/seed = 20261013      # 顶层 uns/seed 继承自未变的 scrna_deg.h5ad，未被动过
```

3. 文件数 59→59，**无新增/消失文件**；`_gsva_pseudobulk.tsv` / `_gsva_ncells.tsv` 两个中间产物
   写在 `_stage_dir()` 的临时目录里并在脚本末尾 `os.remove`（`gsva_pathways:400-404`），
   未落进真 `processed/`。

**判定：PASS（1 图），差异全部归入 provenance + 计时，无「其他」类。**

**CSV 落本地**：`cn_debug/figure_audit_sweep/s14_line2_scrna_gsva_pathways.csv`，
md5 `a0ce621d3fec4553df48adc10438c11e`，内容 `l2_14_gsva_heatmap.png,PASS`。

### 5.2 `line3_spatial / celltype_annotation`（B 档，4 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line3_spatial/celltype_annotation \
    --cwd projects/default/line3_spatial/processed \
    --runner bash --seed 20261013 --csv /tmp/s14_line3_spatial_celltype_annotation.csv \
    > /tmp/s14_l3_deconv.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/s14_l3_deconv.log'
```

**输出原文**

```
real    0m58.571s
user    0m45.998s
sys     0m5.807s
EXIT=0
=== /mnt/ssd/bio_data/bin/line3_spatial/celltype_annotation @ projects/default/line3_spatial/processed
step_executed=celltype_annotation
bioanalys_seed=20261013
=== mouse: 57 domains, 149 signature genes ===
mouse score_genes agreement with NNLS: 6.2%
wrote celltype_scores_mouse.tsv (17283 spots x 57 celltypes)
wrote celltype_annotation_mouse.tsv (17283 spots)
wrote l3_mouse_14_deconv_umap.png
wrote l3_mouse_15_deconv_composition.png
=== human: 18 domains, 65 signature genes ===
human score_genes agreement with NNLS: 66.8%
wrote celltype_scores_human.tsv (6877 spots x 18 celltypes)
wrote celltype_annotation_human.tsv (6877 spots)
wrote l3_human_14_deconv_umap.png
wrote l3_human_15_deconv_composition.png
celltype_annotation_done
PASS l3_mouse_14_deconv_umap.png
PASS l3_mouse_15_deconv_composition.png
PASS l3_human_14_deconv_umap.png
PASS l3_human_15_deconv_composition.png
audit: figs=4 fail=0 write=False
audit-csv: /tmp/s14_line3_spatial_celltype_annotation.csv (4 图)
```

**基线对比**

```
=== FIGDIFF ===
(no diff)
=== PROCDIFF ===
9c9
< ea64abb6ea0f7219c7acc30fc3875abf  processed/deconv_report.txt
---
> 02a6b9dce1e60144e6de9fe38c783001  processed/deconv_report.txt
=== counts ===
  101 /tmp/s14_before_line3_spatial_proc.md5
  101 /tmp/s14_now_line3_spatial_proc.md5
=== report text diff（跑前快照 vs 跑后）===
2c2
< seed=20261018
---
> seed=20261013
28c28
< elapsed_seconds=43.5
---
> elapsed_seconds=44.8
```

| 对象 | 文件数（前/后） | 差异文件 | 差异行 | 归因 |
|---|---|---|---|---|
| `line3_spatial/figures` | 69 / 69 | 0（`(no diff)`） | — | — |
| `line3_spatial/processed` | 101 / 101 | **1：`deconv_report.txt`** | `seed=20261018→20261013`、`elapsed_seconds=43.5→44.8` | provenance + 计时 |
| `celltype_scores_{mouse,human}.tsv`（数值表） | 2 | **0** | 逐字节一致 | 无变化 |
| `celltype_annotation_{mouse,human}.tsv`（数值表） | 2 | **0** | 逐字节一致 | 无变化 |
| `spatial_deconv_{mouse,human}.h5ad` | 2 | **0** | 整个文件 md5 未变 | 无变化 |
| 新增/消失文件 | 0 | — | — | — |

**归因说明（这步为什么天然安全，且有实测支撑）**

`SEED` 在该脚本只出现 3 处：L30-47（bash 参数解析）、L73（`SEED = int(env)`）、
L242（`report_lines` 的 `"seed=%d" % SEED`）。**不进 `uns`、不进任何计算**；
NNLS 解卷积是 `scipy.optimize.nnls` 确定性求解，`score_genes` 无随机过程。
实测与代码一致：`spatial_deconv_*.h5ad` 与两张数值表**整文件 md5 未变**，唯一变化是报告那 2 行。

**判定：PASS（4 图），差异全部归入 provenance + 计时，零「其他」。**

**CSV 落本地**：`cn_debug/figure_audit_sweep/s14_line3_spatial_celltype_annotation.csv`，
md5 `ba44131917d92d279cb49da5e4070f76`，内容 4 行全 PASS。

### 5.3 `line2_scrna / dr_post_analysis`（3 图）与 `line3_spatial / dr_post_analysis`（4 图）——**P0：未开跑**

**为什么不开跑（不是推测，是 /tmp 探针实测）**

这两个脚本的 DR 富集是 `gseapy.prerank(..., permutation_num=1000, seed=SEED)`
（`l2/dr_post_analysis:269-271`、`l3/dr_post_analysis:302-304`），置换 p 值与 NES 归一化
都吃 `SEED`。而 §4.4 已证磁盘上这批表是 **20261018** 算的。
于是先做**只写 `/tmp` 的复现探针**（5 个输入文件软链进探针目录，`../references` 指向真目录，
输出落探针目录），两个种子各跑一次：

```
# line2（输入：scrna_knockout.h5ad / ko_dr_genes.tsv / scenic_regulons.csv /
#        deg_all_by_celltype.tsv / scrna_deg.h5ad）
$ BIOANALYS_SEED=20261018 bash .../bin/line2_scrna/dr_post_analysis --seed 20261018 --output ../figures
wrote dr_enrichment.tsv (1975 行)
A(20261018) 2b5f4863bf69cbb3728ef50df90c31ce
B(20261013) 8e3a53a11d2d0ba912451e08a9acd7ba
on-disk     2b5f4863bf69cbb3728ef50df90c31ce      ← 与 A 逐字节相同

$ python3 <比对 NES / NOM p-val / FDR q-val>
shape A/B: (1975, 7) (1975, 7)
merged rows: 1975
  NES 变化行数 1975 / 1975 ; max|Δ| = 0.0734
  NOM p-val 变化行数 1927 / 1975 ; max|Δ| = 0.113
  FDR q-val 变化行数 1752 / 1975 ; max|Δ| = 0.502
Lead_genes 变化行数: 0
```

```
# line3（输入：spatial_knockout_{mouse,human}.h5ad / ko_dr_genes_{...}.tsv /
#        domain_markers_{...}.tsv；gmt_cache 用副本，避免探针往真 references 写）
[mouse] A=b27ba8d67722f1f1cd2f88c61970a23a B=8ad2bb37060f2329f6d306b352601f55 disk=b27ba8d67722f1f1cd2f88c61970a23a
[human] A=20187cbc59150693e9c76aa906487bc1 B=8a0516cb88bb7db166cd7dbc79c432a5 disk=20187cbc59150693e9c76aa906487bc1
```

结论：**A(20261018) 逐字节复现磁盘表 → 磁盘表就是 20261018 版本；B(20261013) 必然不同。**
也就是说，跑这两个审计**不是**「只改 seed provenance」，而是**把 3 张交付数值表
（`dr_enrichment.tsv`、`dr_enrichment_mouse.tsv`、`dr_enrichment_human.tsv`）换成另一组数字**；
同时报告里 `top by FDR` 那 8 行（`NES=%.2f FDR q=%.2g`，`l2:472-473`）也会变 ——
那既不是 seed 行也不是计时行。

按派发单停止条件（「任何 `.tsv` 数值表 md5 变化」「报告里除 seed=/计时行以外的任何行变化」
出现即停、上报 P0），**这两个脚本未开跑**，7 张图维持 UNVERIFIED。

**这两个脚本会写什么（软链穿透清单，供裁决后执行时对照）**

| 脚本 | 会被真写的文件 | 本轮实测 |
|---|---|---|
| `l2/dr_post_analysis` | `dr_enrichment.tsv`、`dr_regulatory_network.tsv`、`dr_overlap.tsv`、`dr_post_report.txt` | `dr_enrichment.tsv` **数值变**（实测）；`dr_regulatory_network.tsv` / `dr_overlap.tsv` 两种子下 md5 相同（`154a5ca2…` / `fde93eba…`，实测） |
| `l3/dr_post_analysis` | `dr_enrichment_{mouse,human}.tsv`、`dr_overlap_{mouse,human}.tsv`、`dr_post_report.txt` | `dr_enrichment_*` **数值变**（实测）；`dr_overlap_*` 未单独比对 |

### 5.4 A4 — 合并 `cn_debug/figure_audit_all.csv`

```
$ python $TMPDIR/s14/merge_audit_csv.py "D:/00.AIagent/codespace/AI辅助生信分析流程工作台"
read cn_debug/figure_audit_line1.csv                                           27 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_enrichment_figures.csv         2 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_scenic_figures.csv             2 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_scrna_figures.csv             28 图
read cn_debug/figure_audit_sweep/s13_line3_spatial_enrichment_figures.csv       4 图
read cn_debug/figure_audit_sweep/s13_line3_spatial_spatial_figures.csv         57 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_target_gene_localization.csv   1 图
read cn_debug/figure_audit_sweep/s14_line2_scrna_gsva_pathways.csv              1 图
read cn_debug/figure_audit_sweep/s14_line3_spatial_celltype_annotation.csv      4 图
--- 输入合计 126 行，去重后 126 图 ---
verdict: {'PASS': 126}
source tag: {'line1_bulk': 27, 's13_A': 93, 's13_B': 1, 's14_B': 5}
```

| 项 | 值 |
|---|---|
| 输出 | `cn_debug/figure_audit_all.csv`，127 行 = 1 表头 + **126 图**，md5 `6ecdc2840f7f8ba48c8707bf1cf850d6` |
| 列 | `figure,verdict,violations,source`（沿用 S13 的 4 列口径） |
| 同名图覆盖 | **0 次**（`l1_`/`l2_`/`l3_` 前缀天然不撞；126 = 输入 126） |
| 总判决 | **126 图，PASS=126，FAIL=0，无其他判决** |
| 来源分布 | `line1_bulk` 27、`s13_A` 93、`s13_B` 1、`s14_B` 5 |

### 5.5 A5 — 三线打分复跑（尾行原文）

```
$ python cn_debug/figure_score.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures \
    --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
    --src-root src --ledger-dir outputs/system_logs
score: figs=35 PASS=27 FIX=0 FAIL=0 UNVERIFIED=8 avg=95.4 threshold=75
```

```
$ python cn_debug/figure_score.py --dir outputs/default/line2_scrna/figures \
    --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
    --src-root src --ledger-dir outputs/system_logs
UNVERIFIED  80.0 l2_15_dr_gsea_top.png                B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l2_16_dr_regulatory_network.png      B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l2_17_dr_overlap.png                 B1?,B2?,B3?,B4?
score: figs=37 PASS=34 FIX=0 FAIL=0 UNVERIFIED=3 avg=98.4 threshold=75
```

```
$ python cn_debug/figure_score.py --dir outputs/default/line3_spatial/figures \
    --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
    --src-root src --ledger-dir outputs/system_logs
UNVERIFIED  80.0 l3_human_10_dr_gsea_top.png          B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_human_11_dr_overlap.png           B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_mouse_10_dr_gsea_top.png          B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l3_mouse_11_dr_overlap.png           B1?,B2?,B3?,B4?
score: figs=69 PASS=65 FIX=0 FAIL=0 UNVERIFIED=4 avg=98.8 threshold=75
```

| 线 | figs | PASS | FAIL | UNVERIFIED | avg |
|---|---|---|---|---|---|
| line1（`PRJ_E2E_GSE277173`） | 35 | 27 | 0 | **8** | 95.4 |
| line2（`default`） | 37 | 34 | 0 | **3** | 98.4 |
| line3（`default`） | 69 | 65 | 0 | **4** | 98.8 |

**UNVERIFIED 15 个，逐个原因（无一个是「归因失败」）**

| 图 | 缺项 | 原因 |
|---|---|---|
| `l2_15_dr_gsea_top.png`、`l2_16_dr_regulatory_network.png`、`l2_17_dr_overlap.png` | B1?~B4? | **本轮 P0 阻断**：`l2/dr_post_analysis` 未开跑（§5.3） |
| `l3_mouse_10_dr_gsea_top.png`、`l3_mouse_11_dr_overlap.png`、`l3_human_10_dr_gsea_top.png`、`l3_human_11_dr_overlap.png` | B1?~B4? | **本轮 P0 阻断**：`l3/dr_post_analysis` 未开跑（§5.3） |
| `l1_02_pca_step3.png`、`l1_03_volcano_limma.png` | B1?~B4? | line1 R 出图（`png()` 设备），几何审计拦不到（#192），本切片不涉 |
| `l1_07_ppi_network.png`、`l1_08_ppi_hubs.png` | B1?~B4? | STRING 不可复现，禁跑（#191） |
| `l1_28~31_wgcna_*.png`（4 张） | B1?~B4? | line1 base-R `png()` 图，同上无机器判决 |

即 line2 的 B 项缺口从 4 张降到 3 张、line3 从 8 张降到 4 张，**未清零**——
差额 7 张全部是本轮 P0 阻断的 `dr_post_analysis` 图，不是工具缺口。
line1 那 8 张是存量已知缺口，与本切片无关。

### 5.6 A6 — 错种子报告修复清单

| 文件 | 改前 seed | 改后 seed | 数值表是否一致 | 状态 |
|---|---|---|---|---|
| `projects/default/line2_scrna/processed/gsva_report.txt` | 20261018 | **20261013** | `gsva_scores.tsv` **不在 diff 中**（逐字节一致）；`scrna_gsva.h5ad` 仅 `uns/gsva/seed` 变，`X/obs/var/obsm` 全节点 0 差异 | **已修（本轮）** |
| `projects/default/line3_spatial/processed/deconv_report.txt` | 20261018 | **20261013** | `celltype_scores_*.tsv`、`celltype_annotation_*.tsv`、`spatial_deconv_*.h5ad` **整文件 md5 全未变** | **已修（本轮）** |
| `projects/default/line2_scrna/processed/dr_post_report.txt` | 20261018 | 未改（仍 20261018） | 若跑则 `dr_enrichment.tsv` 数值变（实测 max\|ΔNES\|=0.0734） | **阻断未修**（§5.3） |
| `projects/default/line3_spatial/processed/dr_post_report.txt` | 20261018 | 未改（仍 20261018） | 若跑则 `dr_enrichment_{mouse,human}.tsv` 数值变（实测 md5 变） | **阻断未修**（§5.3） |

现网 5 份重算报告 seed 行终态（`grep -H "^seed="`，实测）：

```
line2_scrna/processed/dr_post_report.txt:seed=20261018      ← 待裁决
line2_scrna/processed/gsva_report.txt:seed=20261013         ← 本轮修好
line2_scrna/processed/localization_report.txt:seed=20261013  ← S13 修好
line3_spatial/processed/deconv_report.txt:seed=20261013     ← 本轮修好
line3_spatial/processed/dr_post_report.txt:seed=20261018    ← 待裁决
```

## 六、视觉审查

未做。本切片只做几何/布局机器判决，未逐张查看 PNG，不对美观性下结论。

## 七、假设与风险

1. **本轮的 P0 与 S13 的 P0 性质不同，必须分开看**：
   S13 的 `l2_13` 差异是「只改 provenance，数字零变化」（数值表逐字节一致，主 Agent 已裁决接受）。
   本轮 `dr_post_analysis` 的差异是「**数字本身换一组**」——置换检验的 p 值/NES 随种子重抽，
   1975/1975 行 NES 变、max|ΔFDR q|=0.502。这不是 provenance 修复，是**结果重算**。
   拿 S13 的裁决口径直接套到这两个脚本上会误判，所以我没有套。
2. **磁盘上的交付图与数值表目前同种子同源**（都来自 20261018 那次运行）。
   一旦按 20261013 重算 `dr_enrichment*.tsv`，图（`l2_15/16/17`、`l3_*_10/11`）若不重出，
   交付物内部就会「图 vs 表不同种子」——这是 S12 §5.5 P1 与 S13 §8.2 点过的
   「重算→重扫→重打分」整链问题，不是单步能收口的。
3. **`l2_14_gsva_heatmap.png` 的判决对象**：判决针对本次 20261013 重渲染的图；
   `gsva_scores.tsv` 字节未变 → 重渲染图与磁盘交付图应同源（GSVA 无随机过程）。
   但我**没有逐像素比对**磁盘 PNG 与新渲染 PNG（审计模式下图落临时目录后即丢弃），按「未验证」记。
4. **`l3_*_14/15` 的判决对象**：同上，且该步连 h5ad 都字节未变，风险更低；同样未逐像素比对。
5. **探针不写项目目录**：两个 `dr_post` 探针输入是软链，输出落 `/tmp/s14probe_*`；
   line3 探针把 `gmt_cache` **复制**到探针树里（`load_lib()` 在缺库时会联网下载并写
   `../references/gmt_cache`，直接软链会让探针污染真 references）——已规避。
6. **耗时**：`gsva_pathways` 75.2s（S12 估 2.2s+import，实测含 R GSVA 7174 通路 × 13 类型）；
   `celltype_annotation` 58.6s（S12 估 43.5s+import，接近）。均远低于 600s 上限。
7. **`figure_audit_all.csv` 的 `source` 列**沿用 S13 的 4 列口径（第 4 列即「注明来源」）；
   `figure_score.load_audit_csv` 用 `DictReader` 按名取列，多一列不影响打分。

## 八、架构/接口变更建议

1. **`_stage_dir()` 的软链穿透该改成写时复制**（S12 §8.1 建议 1 的重申，本轮再次付代价）：
   现在每次 bash 审计都在改真 `processed/`。改成「输入只读软链 + 已存在产物先 `copy2` 到临时目录」
   后，审计永不写正本，B 档就不再需要「先基线后比对」这套高风险流程。
2. **`audit_figure_layout.py` 应支持 `--cwd-copy` / `--stage=copy`**：
   让「在副本上审计」变成一等公民，而不是每次靠人手工 `/tmp` 探针。这样即使重算类脚本
   会改数，也能安全拿到图的几何判决。

## 九、待主 Agent 决策事项

**【阻断项】`l2/dr_post_analysis`（3 图）+ `l3/dr_post_analysis`（4 图）是否执行、按哪种口径执行。**
三个选项（我倾向 (b)）：

- **(a) 直接跑，接受数值漂移**：`--seed 20261013` 原样跑，`dr_enrichment*.tsv` 换成 20261013 版本
  （1975/1975 行 NES 变），报告里 `top by FDR` 8 行 + seed 行变。
  之后**必须**把 7 张图按新数重渲染并重扫重打分，否则交付物内部图/表不同源。
  代价：3 张数值表 + 7 张图 + 2 份报告全变，要立「重算→重扫→重打分」整链切片。
- **(b) 在副本上跑审计（不改真数据）**：把 `processed/` 复制到 `/tmp/s14_stage/<line>/processed`
  （line2 ≈1.5GB、line3 ≈2–3GB，磁盘余量 149G 够），`--cwd` 指向副本。
  软链穿透只写副本，真 `processed/` 零风险，**能立刻拿到 7 张图的几何判决**，交付数据一字不动。
  代价：`--cwd` 偏离派发单模板（属变更建议，需你批准）。执行预计 line2 ≈40s + line3 ≈60s + 两次 cp。
- **(c) 维持不跑**：7 张图继续 UNVERIFIED，等「按真种子整链重算」立项时一起做。

**另需裁决**：两份 `dr_post_report.txt` 的错种子（20261018）是否随同处理——
按 (b) 只拿图判决、报告仍留 20261018（provenance 仍错）；按 (a) 则一并修对但要重出图。

## 十、建议下一步

1. 先裁 §9。若选 (b)，我可在 3–5 min 内把 7 张图判完，然后只需在合并表里追加 2 个 CSV
   再复跑两次打分（预期 line2 UNVERIFIED=0、line3 UNVERIFIED=0）。
2. 无论选哪个，建议把 §8.1（`_stage_dir()` 写时复制）与 §8.2（`--cwd-copy`）立为独立切片——
   否则下一次 B 档审计还是同一个坑。
3. **line1 的 8 张 UNVERIFIED 不在本切片范围**（2 张 R 图 + 2 张 PPI 禁跑 + 4 张 WGCNA base-R 图），
   要清零需另立「line1 R 图几何审计」专项。
4. 若最终选 (a)，提醒：`dr_enrichment*.tsv` 换数后，`docs/` 里若有引用具体 NES/FDR 的说明文字
   也要同步核对（本切片未检查）。
