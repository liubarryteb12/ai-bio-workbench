# S15 报告：`dr_post_analysis` 7 图的几何判决（传 20261018，不重算）

> 状态：**完成**。7 图全部拿到机器判决（`figs=7 fail=0`），交付数值零变化
> （3+4 张数值表逐字节一致，报告仅 `elapsed_seconds` 计时行变，`seed=` 行未变）。
> 三线打分：line2 37/37、line3 69/69 PASS，UNVERIFIED 双双清零。
> 口径：`--seed 20261018`（与磁盘版本同种子 → 产物逐字节不变 → 只取 A-E 几何判决）。
> 数值 seed 合规问题（#199）单独挂账，见 §5.4；本切片**未改任何交付数值**。

## 一、任务理解

S14 因「20261013 重算会改 `dr_enrichment*.tsv` 数值」按停止条件未开跑两个 `dr_post_analysis`
（l2 3 图 + l3 4 图，共 7 图）。S14 的 /tmp 探针已证 **20261018 重算可逐字节复现磁盘表**，
主 Agent 据此裁决：本轮传 `--seed 20261018` 跑审计，只拿几何判决，不重算交付数值。

本切片验收口径（相对 S14 的停止条件做了**种子侧的反转**，其余不变）：

| 对象 | 允许 | 不允许（出现即停 → P0） |
|---|---|---|
| `dr_enrichment*.tsv` / `dr_overlap*.tsv` / `dr_regulatory_network.tsv` | : | **任何 md5 变化** |
| `dr_post_report.txt` | 仅 `elapsed_seconds=` 行；`seed=` 应**保持 20261018 不变** | 其他任何行变化 |
| `figures/` DR 图件 | md5 变化（审计不带 `--write`，理论上不落盘） | : |
| `.h5ad` | : | **任何 md5 变化** |

## 二、实现摘要

1. 链路自检通过；本地 `src/` 与远端 `bin/` 的 2 个 `dr_post_analysis` + `ops/audit_figure_layout.py`
   **3/3 md5 相同**。
2. S14 的 `/tmp/s14_before_*.md5` 复验结果**与当前磁盘不一致**（3 个文件被 S14 自己的审计改过），
   按派发单要求**重建 S15 基线**（文件数不变：l2 37/59、l3 69/101）。
3. 两个脚本各跑一次 `--seed 20261018 --runner bash`（不加 `--write`）：`figs=3 fail=0` + `figs=4 fail=0`。
4. 每个脚本跑后立即比对基线：**唯一差异**是 `dr_post_report.txt` 的 `elapsed_seconds` 行
   （l2 `17.5→17.4`、l3 `12.9→19.8`）；7 张数值表与 43 个 `.h5ad` **逐字节未变**；
   `figures/` 前后 `(no diff)`（l2 37 张 + l3 69 张 PNG 一个没动）。
5. 合并 `figure_audit_all.csv`：126 → **133 图，PASS=133，FAIL=0**（同名覆盖 0 次）。
6. 三线打分：line1 27/35（存量 8 UNVERIFIED，与本切片无关）、line2 **37/37**、line3 **69/69**。

## 三、文件变更清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `cn_debug/figure_audit_sweep/s15_line2_scrna_dr_post_analysis.csv` | 新增 | 远端 `/tmp` 拉回，3 图全 PASS，md5 `2e0c3a4723e3bbe74fcf8469d2b1e716` |
| `cn_debug/figure_audit_sweep/s15_line3_spatial_dr_post_analysis.csv` | 新增 | 远端 `/tmp` 拉回，4 图全 PASS，md5 `de5ea0d2e6722185e6226a81536995d3` |
| `cn_debug/figure_audit_sweep/figure_audit_all.before_S15.csv` | 新增（备份） | 合并前 126 图版，md5 `6ecdc2840f7f8ba48c8707bf1cf850d6`（= S14 终态） |
| `cn_debug/figure_audit_all.csv` | 覆盖 | 126 → 133 图，md5 `6ecdc284…` → `b4ae65f2833e1a30c1fe50b0034d936f` |
| `con_hf/dispatch/S15_report.md` | 新增 | 本文件（含主 Agent 补录段） |

临时工具（**未进仓库**）：`$TMPDIR/s15/merge_audit_csv.py`（S14 版加 2 行输入；
S14 的 `$TMPDIR/s14/merge_audit_csv.py` 已被 scratch 24h 清理，按同口径重写）。

**仓库源码、`src/`、`ops/`、`bin/`、`projects/`、`test_use_data/` 未被本 Agent 改动**；
远端被写的 2 个 `dr_post_report.txt` 的 `elapsed_seconds` 行来自被审计脚本自身
（`_stage_dir()` 软链穿透，#197 机制），不是本 Agent 直接写入。

## 四、测试与验证记录

### 4.1 链路自检

```
$ adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022
$ ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu 'hostname; date; ls /tmp/s14_before_*; df -h /tmp'
localhost
Mon Oct 19 17:18:11 UTC 2026          # = 2026-10-20 01:18 CST
/tmp/s14_before_deconv_report.txt
/tmp/s14_before_line2_scrna_figs.md5
/tmp/s14_before_line2_scrna_proc.md5
/tmp/s14_before_line3_spatial_figs.md5
/tmp/s14_before_line3_spatial_proc.md5
/dev/block/dm-40  226G   78G  149G  35% /
```

### 4.2 本地 `src/` 与远端 `bin/` 同名文件 md5（3/3 一致）

```
$ md5sum ops/audit_figure_layout.py src/line2_scrna/scripts/dr_post_analysis src/line3_spatial/scripts/dr_post_analysis
4e0a6647efe8d02f605fdb75ad4b57f8 *ops/audit_figure_layout.py
da7465a6ab33328867990330012f1103 *src/line2_scrna/scripts/dr_post_analysis
51c729aa29ef2f74f7a757b7d893bfe5 *src/line3_spatial/scripts/dr_post_analysis

$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && md5sum bin/line2_scrna/dr_post_analysis bin/line3_spatial/dr_post_analysis ops/audit_figure_layout.py'
da7465a6ab33328867990330012f1103  bin/line2_scrna/dr_post_analysis
51c729aa29ef2f74f7a757b7d893bfe5  bin/line3_spatial/dr_post_analysis
4e0a6647efe8d02f605fdb75ad4b57f8  ops/audit_figure_layout.py
```

3/3 逐行相同；`ops/audit_figure_layout.py` 仍是 #190 修复版（`--seed` 可透传）。

### 4.3 基线：S14 清单复验 → **不一致，已重建**

派发单允许复用 `/tmp/s14_before_*.md5`，但必须先复验清单与当前磁盘一致。实测：

```
$ ssh k40-ubuntu '... find figures/processed -type f | sort | xargs md5sum > /tmp/s15_chk_${L}_*.md5; diff /tmp/s14_before_... /tmp/s15_chk_...'
== line2_scrna figs: s14_lines=37 now_lines=37
  figs list IDENTICAL to s14 baseline
== line2_scrna proc: s14_lines=59 now_lines=59
20c20
< d80c8181c74f5c50953cc7459b1ab815  processed/gsva_report.txt
---
> abcd258a51e20d33531a529d3d523eee  processed/gsva_report.txt
45c45
< 8aac137b82fa6258b8abb5e2adda4241  processed/scrna_gsva.h5ad
---
> caa0ec33ab3d9e47a08642dc99804026  processed/scrna_gsva.h5ad
== line3_spatial figs: s14_lines=69 now_lines=69
  figs list IDENTICAL to s14 baseline
== line3_spatial proc: s14_lines=101 now_lines=101
9c9
< ea64abb6ea0f7219c7acc30fc3875abf  processed/deconv_report.txt
---
> 02a6b9dce1e60144e6de9fe38c783001  processed/deconv_report.txt
```

**差异原因已定位且是 S14 自己的副作用**（S14 报告 §5.1/§5.2）：S14 在取完基线后跑了
`gsva_pathways` 与 `celltype_annotation` 两个审计，改写了这 3 个文件（`gsva_report.txt`、
`scrna_gsva.h5ad` 的 `uns/gsva/seed`、`deconv_report.txt`）。文件数前后完全一致
（37/59、69/101），无新增/消失文件。→ 按派发单要求**重建 S15 基线**：

```
$ cp /tmp/s15_chk_${L}_figs.md5 /tmp/s15_before_${L}_figs.md5
$ cp /tmp/s15_chk_${L}_proc.md5 /tmp/s15_before_${L}_proc.md5
$ cp processed/dr_post_report.txt /tmp/s15_before_${L}_dr_post_report.txt
== line2_scrna figs=37 figslist_md5=ebc69f017a523073c78cc0e125b1ae02
== line2_scrna proc=59 proclist_md5=7be6ffce2a1d9e57f34d21e68308f233
== line3_spatial figs=69 figslist_md5=28edda377f2ef69c953e387a68fde201
== line3_spatial proc=101 proclist_md5=6a3fd7a27370dd09093c0cd5d4365c3c
```

审计前 DR 相关文件的基线（本切片的硬对照值）：

```
line2_scrna
2b5f4863bf69cbb3728ef50df90c31ce  processed/dr_enrichment.tsv
fde93eba7b267b6eb273950f1194326c  processed/dr_overlap.tsv
154a5ca2ceff004276acbacafcf8d22b  processed/dr_regulatory_network.tsv
b80eda85e16c94405b2cae0423c8b05b  processed/dr_post_report.txt      (seed=20261018)
line3_spatial
20187cbc59150693e9c76aa906487bc1  processed/dr_enrichment_human.tsv
b27ba8d67722f1f1cd2f88c61970a23a  processed/dr_enrichment_mouse.tsv
653035241cc22f31253000a3dedbe816  processed/dr_overlap_human.tsv
5198181eb6df5fd4fe26b939af6b39b7  processed/dr_overlap_mouse.tsv
ee208b14f1d336afdb8506e13b6a8c6f  processed/dr_post_report.txt      (seed=20261018)
```

与 #199 记录一致（`2b5f4863…` / `b27ba8d6…` / `20187cbc…`）。

## 五、逐脚本审计记录

### 5.1 `line2_scrna / dr_post_analysis`（3 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line2_scrna/dr_post_analysis \
    --cwd projects/default/line2_scrna/processed \
    --runner bash --seed 20261018 --csv /tmp/s15_line2_scrna_dr_post_analysis.csv \
    > /tmp/s15_l2_drpost.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/s15_l2_drpost.log'
```

**输出原文**

```
real    0m27.368s
user    0m31.463s
sys     0m4.997s
EXIT=0
=== /mnt/ssd/bio_data/bin/line2_scrna/dr_post_analysis @ projects/default/line2_scrna/processed
step_executed=dr_post_analysis
bioanalys_seed=20261018
ko_gene=TNF n_dr=1225
wrote dr_enrichment.tsv (1975 行)
wrote dr_regulatory_network.tsv (59 边, 29 TF, 9 DR 靶)
wrote dr_overlap.tsv (258 基因)
dr_post_analysis_done
PASS l2_15_dr_gsea_top.png
PASS l2_16_dr_regulatory_network.png
PASS l2_17_dr_overlap.png
audit: figs=3 fail=0 write=False
audit-csv: /tmp/s15_line2_scrna_dr_post_analysis.csv (3 图)
```

**基线对比**

```
=== FIGDIFF ===
(no diff)
=== PROCDIFF ===
14c14
< b80eda85e16c94405b2cae0423c8b05b  processed/dr_post_report.txt
---
> f563ec05851898436876b93fb3381f0e  processed/dr_post_report.txt
=== counts ===
   37 /tmp/s15_before_line2_scrna_figs.md5
   37 /tmp/s15_now_line2_scrna_figs.md5
   59 /tmp/s15_before_line2_scrna_proc.md5
   59 /tmp/s15_now_line2_scrna_proc.md5
=== report text diff ===
34c34
< elapsed_seconds=17.5
---
> elapsed_seconds=17.4
=== DR tables now ===
2b5f4863bf69cbb3728ef50df90c31ce  processed/dr_enrichment.tsv
fde93eba7b267b6eb273950f1194326c  processed/dr_overlap.tsv
154a5ca2ceff004276acbacafcf8d22b  processed/dr_regulatory_network.tsv
f563ec05851898436876b93fb3381f0e  processed/dr_post_report.txt
```

| 对象 | 文件数（前/后） | 清单 md5（前/后） | 差异文件 | 差异行 | 归因 |
|---|---|---|---|---|---|
| `line2_scrna/figures` | 37 / 37 | `ebc69f01…` / 同左 | 0（`(no diff)`） | : | 无差异 |
| `line2_scrna/processed` | 59 / 59 | `7be6ffce…` / 变（1 文件） | 1：`dr_post_report.txt` | `elapsed_seconds=17.5→17.4` | **计时行** |
| `dr_enrichment.tsv` | 1 | `2b5f4863…` | **0** | 逐字节一致 | 无差异 |
| `dr_overlap.tsv` | 1 | `fde93eba…` | **0** | 逐字节一致 | 无差异 |
| `dr_regulatory_network.tsv` | 1 | `154a5ca2…` | **0** | 逐字节一致 | 无差异 |
| `.h5ad`（16 个） | 16 | 全未出现在 diff | **0** | : | 无差异 |
| 新增/消失文件 | 0 | : | : | : | : |

关键点：报告里 **`seed=` 行未变**（两侧都是 `seed=20261018`，diff 只命中第 34 行计时行），
即本次审计对 provenance 也零改动 : 这正是「传与磁盘同种子」的预期结果。

**判定：PASS（3 图），唯一差异是 `elapsed_seconds` 计时行，零「其他」类。**

**CSV 落本地**：`cn_debug/figure_audit_sweep/s15_line2_scrna_dr_post_analysis.csv`，
md5 `2e0c3a4723e3bbe74fcf8469d2b1e716`，3 行全 PASS。

**重构校验（证明"除计时行外字节全同"）**

```
$ cp processed/dr_post_report.txt /tmp/rec_l2.txt
$ sed -i "s/^elapsed_seconds=17.4$/elapsed_seconds=17.5/" /tmp/rec_l2.txt
l2 reconstructed: b80eda85e16c94405b2cae0423c8b05b  baseline: b80eda85e16c94405b2cae0423c8b05b
```

改回计时行后 md5 **等于基线** → 报告里 `seed=20261018`、`top by FDR` 各行、
`ko_gene=TNF n_dr=1225` 等全部逐字未变。这也是本切片与 S14 阻断情形的分界：
**同种子跑，连 provenance 都不动**。

### 5.2 `line3_spatial / dr_post_analysis`（4 图）

**命令原文**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line3_spatial/dr_post_analysis \
    --cwd projects/default/line3_spatial/processed \
    --runner bash --seed 20261018 --csv /tmp/s15_line3_spatial_dr_post_analysis.csv \
    > /tmp/s15_l3_drpost.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/s15_l3_drpost.log'
```

**输出原文**

```
real    0m35.751s
user    0m27.504s
sys     0m7.692s
EXIT=0
=== /mnt/ssd/bio_data/bin/line3_spatial/dr_post_analysis @ projects/default/line3_spatial/processed
step_executed=dr_post_analysis
bioanalys_seed=20261018
=== mouse ko_gene=Spp1 n_sig_dr=54 ===
wrote dr_enrichment_mouse.tsv (284 行, 2 库)
wrote dr_overlap_mouse.tsv (366 基因)
=== human ko_gene=SPP1 n_sig_dr=14 ===
wrote dr_enrichment_human.tsv (1265 行, 3 库)
wrote dr_overlap_human.tsv (190 基因)
dr_post_analysis_done
PASS l3_mouse_10_dr_gsea_top.png
      INFO tick 标签越出画布 axes0 '8'（tight 裁切可容纳）
PASS l3_mouse_11_dr_overlap.png
PASS l3_human_10_dr_gsea_top.png
      INFO tick 标签越出画布 axes0 '6'（tight 裁切可容纳）
PASS l3_human_11_dr_overlap.png
      INFO tick 标签越出画布 axes0 '250'（tight 裁切可容纳）
audit: figs=4 fail=0 write=False
audit-csv: /tmp/s15_line3_spatial_dr_post_analysis.csv (4 图)
```

（3 条 `INFO tick 标签越出画布` 是 E 项提示，按 figure_spec v2.2 只提示不判 FAIL : 脚本统一
`savefig(bbox="tight")`，裁切边会扩进来；与 S14 对其它图的口径一致。）

**基线对比**

```
=== FIGDIFF ===
(no diff)
=== PROCDIFF ===
20c20
< ee208b14f1d336afdb8506e13b6a8c6f  processed/dr_post_report.txt
---
> d7b4cf51a8ccc8ce1417dc568ee7e42b  processed/dr_post_report.txt
=== counts ===
   69 /tmp/s15_before_line3_spatial_figs.md5
   69 /tmp/s15_now_line3_spatial_figs.md5
  101 /tmp/s15_before_line3_spatial_proc.md5
  101 /tmp/s15_now_line3_spatial_proc.md5
=== report text diff ===
40c40
< elapsed_seconds=12.9
---
> elapsed_seconds=19.8
=== DR tables now ===
20187cbc59150693e9c76aa906487bc1  processed/dr_enrichment_human.tsv
b27ba8d67722f1f1cd2f88c61970a23a  processed/dr_enrichment_mouse.tsv
653035241cc22f31253000a3dedbe816  processed/dr_overlap_human.tsv
5198181eb6df5fd4fe26b939af6b39b7  processed/dr_overlap_mouse.tsv
d7b4cf51a8ccc8ce1417dc568ee7e42b  processed/dr_post_report.txt
```

| 对象 | 文件数（前/后） | 清单 md5（前/后） | 差异文件 | 差异行 | 归因 |
|---|---|---|---|---|---|
| `line3_spatial/figures` | 69 / 69 | `28edda37…` / 同左 | 0（`(no diff)`） | : | 无差异 |
| `line3_spatial/processed` | 101 / 101 | `6a3fd7a2…` / 变（1 文件） | 1：`dr_post_report.txt` | `elapsed_seconds=12.9→19.8` | **计时行** |
| `dr_enrichment_mouse.tsv` | 1 | `b27ba8d6…` | **0** | 逐字节一致 | 无差异 |
| `dr_enrichment_human.tsv` | 1 | `20187cbc…` | **0** | 逐字节一致 | 无差异 |
| `dr_overlap_mouse.tsv` | 1 | `5198181e…` | **0** | 逐字节一致 | 无差异 |
| `dr_overlap_human.tsv` | 1 | `65303524…` | **0** | 逐字节一致 | 无差异 |
| `.h5ad`（27 个） | 27 | 全未出现在 diff | **0** | : | 无差异 |
| 新增/消失文件 | 0 | : | : | : | : |

**重构校验**

```
$ cp processed/dr_post_report.txt /tmp/rec_l3.txt
$ sed -i "s/^elapsed_seconds=19.8$/elapsed_seconds=12.9/" /tmp/rec_l3.txt
l3 reconstructed: ee208b14f1d336afdb8506e13b6a8c6f  baseline: ee208b14f1d336afdb8506e13b6a8c6f
```

**判定：PASS（4 图），唯一差异是 `elapsed_seconds` 计时行，零「其他」类。**

**CSV 落本地**：`cn_debug/figure_audit_sweep/s15_line3_spatial_dr_post_analysis.csv`，
md5 `de5ea0d2e6722185e6226a81536995d3`，内容 4 行全 PASS。

### 5.3 A3 : 7 张数值表 md5 前后对照（逐字节相同的证据）

```
审计前（§4.3 基线）                审计后（§5.1/§5.2 实测）                              结论
line2 dr_enrichment.tsv          2b5f4863bf69cbb3728ef50df90c31ce → 2b5f4863bf69cbb3728ef50df90c31ce  同
line2 dr_overlap.tsv             fde93eba7b267b6eb273950f1194326c → fde93eba7b267b6eb273950f1194326c  同
line2 dr_regulatory_network.tsv  154a5ca2ceff004276acbacafcf8d22b → 154a5ca2ceff004276acbacafcf8d22b  同
line3 dr_enrichment_mouse.tsv    b27ba8d67722f1f1cd2f88c61970a23a → b27ba8d67722f1f1cd2f88c61970a23a  同
line3 dr_enrichment_human.tsv    20187cbc59150693e9c76aa906487bc1 → 20187cbc59150693e9c76aa906487bc1  同
line3 dr_overlap_mouse.tsv       5198181eb6df5fd4fe26b939af6b39b7 → 5198181eb6df5fd4fe26b939af6b39b7  同
line3 dr_overlap_human.tsv       653035241cc22f31253000a3dedbe816 → 653035241cc22f31253000a3dedbe816  同
```

7/7 逐字节一致；l2 三张表的 md5 与 S14 探针 A(20261018) 相同
（`2b5f4863…`/`fde93eba…`/`154a5ca2…`），l3 两张 enrichment 与 #199 记录的磁盘值相同。
→ **探针结论已被本切片的真跑独立复现**，不是引用 S14 的结论。

### 5.4 seed 合规挂账说明（本切片的核心口径，须原样进交付报告）

> **这 7 张图的几何判决是用 `--seed 20261018` 拿到的，不是契约种子 20261013。**
>
> 事实链（本轮实测 + #199 已裁）：
> 1. 磁盘上的 DR 富集数值表（`dr_enrichment.tsv`、`dr_enrichment_{mouse,human}.tsv`）
>    **是由 seed 20261018 算出的**：用 20261018 重算能逐字节复现磁盘表；用 20261013 重算则
>    NES 1975/1975 行全变（max|ΔNES|=0.0734）、NOM p-val 1927/1975 行变、
>    FDR q-val 1752/1975 行变（max|Δ|=0.502）:见 #199 与 S14 报告 §5.3。
> 2. 项目契约种子是 **20261013**（aims 铁律#3）。即磁盘这批 DR 富集数值**属于"用错种子算出的
>    交付物"**，但按主 Agent 裁决，本轮**不擅自重算**：重算会改交付数值，属产品决策。
> 3. 因此本切片传 20261018，目的是「用与磁盘版本相同的种子重跑 → 产物逐字节不变 → 只取
>    A-E 几何判决」。实测达成：7 张数值表 7/7 逐字节一致，报告仅计时行变、`seed=` 行未变。
> 4. **本切片没有修改任何交付数值**：没有一张 `.tsv` 数值表、没有一个 `.h5ad`、没有一张 PNG 被改写；
>    两份 `dr_post_report.txt` 的 `seed=` 仍为 `20261018`（未修，也未恶化）。
>
> **挂账（待用户拍板）**：是否用契约种子 20261013 重算这两个步骤。若重算，须连带重渲染
> `l2_15/16/17`、`l3_{mouse,human}_10/11` 共 7 图并重扫重打分（否则交付物内部「图 vs 表不同种子」），
> 且这 7 张图的几何判决需要按新图重新取一次。**判决本身（A-E 几何合规）与种子无关**:
> 几何判定只看图的布局不看数值，所以这 7 个 PASS 在 20261013 重算后大概率仍成立，
> 但**那属于重算后必须重跑的事，本切片不预设结论**。
>
> 交付报告的方法学段须如实标注：**DR 富集数值由 seed 20261018 算出**（#199 处置要求）。

### 5.5 A4 : 合并 `cn_debug/figure_audit_all.csv`

```
$ cp cn_debug/figure_audit_all.csv cn_debug/figure_audit_sweep/figure_audit_all.before_S15.csv
$ md5sum cn_debug/figure_audit_sweep/figure_audit_all.before_S15.csv
6ecdc2840f7f8ba48c8707bf1cf850d6 *cn_debug/figure_audit_sweep/figure_audit_all.before_S15.csv

$ python $TMPDIR/s15/merge_audit_csv.py "D:/00.AIagent/codespace/AI辅助生信分析流程工作台"
read cn_debug/figure_audit_line1.csv                                            27 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_enrichment_figures.csv          2 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_scenic_figures.csv              2 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_scrna_figures.csv              28 图
read cn_debug/figure_audit_sweep/s13_line3_spatial_enrichment_figures.csv        4 图
read cn_debug/figure_audit_sweep/s13_line3_spatial_spatial_figures.csv          57 图
read cn_debug/figure_audit_sweep/s13_line2_scrna_target_gene_localization.csv    1 图
read cn_debug/figure_audit_sweep/s14_line2_scrna_gsva_pathways.csv               1 图
read cn_debug/figure_audit_sweep/s14_line3_spatial_celltype_annotation.csv       4 图
read cn_debug/figure_audit_sweep/s15_line2_scrna_dr_post_analysis.csv            3 图
read cn_debug/figure_audit_sweep/s15_line3_spatial_dr_post_analysis.csv          4 图
--- 输入合计 133 行，去重后 133 图 ---
verdict: {'PASS': 133}
source tag: {'figure_audit_line1.csv': 27, 's13_line2_scrna_enrichment_figures.csv': 2,
 's13_line2_scrna_scenic_figures.csv': 2, 's13_line2_scrna_scrna_figures.csv': 28,
 's13_line3_spatial_enrichment_figures.csv': 4, 's13_line3_spatial_spatial_figures.csv': 57,
 's13_line2_scrna_target_gene_localization.csv': 1, 's14_line2_scrna_gsva_pathways.csv': 1,
 's14_line3_spatial_celltype_annotation.csv': 4, 's15_line2_scrna_dr_post_analysis.csv': 3,
 's15_line3_spatial_dr_post_analysis.csv': 4}
同名覆盖: 0
wrote D:/00.AIagent/codespace/AI辅助生信分析流程工作台\cn_debug/figure_audit_all.csv (133 图)

$ md5sum cn_debug/figure_audit_all.csv ; wc -l cn_debug/figure_audit_all.csv
b4ae65f2833e1a30c1fe50b0034d936f *cn_debug/figure_audit_all.csv
134 cn_debug/figure_audit_all.csv
```

| 项 | 值 |
|---|---|
| 输出 | `cn_debug/figure_audit_all.csv`，134 行 = 1 表头 + **133 图**，md5 `b4ae65f2833e1a30c1fe50b0034d936f` |
| 备份 | `cn_debug/figure_audit_sweep/figure_audit_all.before_S15.csv`（126 图，md5 `6ecdc284…`） |
| 总判决 | **133 图，PASS=133，FAIL=0，无其他判决** |
| 同名图覆盖 | **0 次**（126 + 7 = 133） |

### 5.6 A5 : 三线打分复跑（尾行原文）

```
$ python cn_debug/figure_score.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures \
    --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
    --src-root src --ledger-dir outputs/system_logs
...
UNVERIFIED  80.0 l1_28_wgcna_softpower.png            B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l1_29_wgcna_module_trait.png         B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l1_30_wgcna_sample_tree.png          B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l1_31_wgcna_mm_gs.png                B1?,B2?,B3?,B4?
score: figs=35 PASS=27 FIX=0 FAIL=0 UNVERIFIED=8 avg=95.4 threshold=75
```

```
$ python cn_debug/figure_score.py --dir outputs/default/line2_scrna/figures \
    --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
    --src-root src --ledger-dir outputs/system_logs
...
PASS       100.0 l2_15_dr_gsea_top.png                -
PASS       100.0 l2_16_dr_regulatory_network.png      -
PASS       100.0 l2_17_dr_overlap.png                 -
...
score: figs=37 PASS=37 FIX=0 FAIL=0 UNVERIFIED=0 avg=100.0 threshold=75
```

```
$ python cn_debug/figure_score.py --dir outputs/default/line3_spatial/figures \
    --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
    --src-root src --ledger-dir outputs/system_logs
...
PASS       100.0 l3_mouse_10_dr_gsea_top.png          -
PASS       100.0 l3_mouse_11_dr_overlap.png           -
...
score: figs=69 PASS=69 FIX=0 FAIL=0 UNVERIFIED=0 avg=100.0 threshold=75
```

| 线 | figs | PASS | FAIL | UNVERIFIED | avg | 对比 S14 |
|---|---|---|---|---|---|---|
| line1（`PRJ_E2E_GSE277173`） | 35 | 27 | 0 | **8** | 95.4 | 不变（存量缺口，与本切片无关） |
| line2（`default`） | 37 | **37** | 0 | **0** | **100.0** | 34→37 PASS，UNVERIFIED 3→**0** |
| line3（`default`） | 69 | **69** | 0 | **0** | **100.0** | 65→69 PASS，UNVERIFIED 4→**0** |

**B1?~B4? 清零确认**：`l2_15/16/17` 与 `l3_{mouse,human}_10/11` 的 B 项缺口已全部消除，
两线 UNVERIFIED = 0。line1 的 8 张是存量缺口（6 张 R 图 = `l1_02_pca_step3`/`l1_03_volcano_limma`
+ 4 张 WGCNA base-R 图，几何审计不覆盖 R；2 张 PPI 图因 STRING 不可复现禁跑），
不在本切片范围，按 `con_hf/figure_manual_review.md` 人工清单跟踪，不得改判 PASS。

### 5.7 仓库改动面核对（无 git 仓库，用 mtime 核对）

```
$ find . -type f -newermt '-15 minutes' | sort
./cn_debug/figure_audit_all.csv
./cn_debug/figure_audit_sweep/figure_audit_all.before_S15.csv
./cn_debug/figure_audit_sweep/s15_line2_scrna_dr_post_analysis.csv
./cn_debug/figure_audit_sweep/s15_line3_spatial_dr_post_analysis.csv
./con_hf/dispatch/S15_report.md
（其余命中项为 S14 报告/台账/subagent 日志/project_data 等，非本 Agent 写入）
```

本 Agent 只写了上列 5 个文件（4 个 CSV + 本报告），全部属派发单允许的
「CSV 合并、备份与报告」。`src/`、`ops/`、`docs/`、`projects/`、`test_use_data/` 零改动。
（该目录不是 git 仓库，`git status` 不可用，故以 mtime 窗口 + 白名单比对作为改动面证据。）

## 六、视觉审查

未做，也不在本切片范围。本切片只做**几何/布局机器判决**（A-E 项），未逐张查看 PNG，
不对美观性下结论。图件审美评价仍待人工复核环节。

## 七、假设与风险

1. **判决对象的时序**：判决针对本次 20261018 重渲染的图对象。`figures/` 前后 `(no diff)`，
   即磁盘交付图未被改写；数值表与磁盘逐字节一致 → 重渲染图与磁盘交付图应同源
   （同种子、同输入、同代码）。但审计模式下 `savefig` 被 patch 成不落盘，**我无法逐像素比对
   新渲染图与磁盘 PNG**，按「未验证」记。S14 §七.3/4 对 gsva/deconv 也是同一条限制。
2. **`elapsed_seconds` 的归因**：l2 `17.5→17.4`（变小）、l3 `12.9→19.8`（变大）。两者都用
   「改回基线值 → md5 重构等于基线」证过，属纯计时行，与数值无关。l3 变大 6.9s 属机器负载波动，
   未做进一步性能分析（不在范围）。
3. **`seed=` 行未变是预期而非巧合**：`--seed 20261018` 与磁盘产物同种子，脚本写入的
   `seed=%d` 自然是同一个值。这恰好说明本切片**没有顺手修掉 #199 的 provenance 错误**:
   `dr_post_report.txt` 仍写 20261018，是挂账项（§5.4）。
4. **软链穿透仍在**：两个脚本的 `_stage_dir()` 仍会真写 `processed/`（#197）。本轮靠
   「同种子 + 跑前基线 + 跑后逐项比对」控住，但机制未修；下一个 seed-sensitive 步骤仍会踩同一个坑。
5. **S14 基线不可复用**：`/tmp/s14_before_*.md5` 在 S14 跑完两个审计后即失效（3 文件被改）。
   本轮已按派发单要求复验并重建。后续切片若再想复用，必须重复复验动作。
6. **耗时可复现性**：l2 27.4s、l3 35.8s，均远低于 600s 上限，无超时风险。

## 八、架构/接口变更建议

1. **`_stage_dir()` 改「写时复制」**（S12 §8.1 / S14 §8.1 的第三次重申）：输入只读软链、
   已存在产物先 `copy2` 到临时目录，则审计永不写正本。这样 seed-sensitive 步骤的审计就从
   「高风险 + 必须基线比对」降级成「零风险」。
2. **`audit_figure_layout.py` 增 `--cwd-copy` / `--stage=copy`**（S14 §8.2 重申）：
   让「在副本上审计」成为一等公民，免去每次手工 `/tmp` 探针。
3. **审计工具应把所用种子写进 CSV**（新增第 5 列 `seed`）：现在判决 CSV 只有
   `figure,verdict,violations`，事后无法从 CSV 本身判断这批判决是在哪个种子下取的:
   本切片的挂账说明只能靠报告文字承载，属可观测性缺口。

## 九、待主 Agent / 用户决策事项

1. **【挂账】是否用契约种子 20261013 重算 `l2/dr_post_analysis` 与 `l3/dr_post_analysis`。**
   重算 = 换交付数值（NES 1975/1975 行变）+ 重渲染 7 图 + 重扫重打分 + 7 图判决重取。
   本切片只提供「当前交付物几何合规」的判决，不预设重算后的结论。
2. 两份 `dr_post_report.txt` 的 `seed=20261018` 是否随重算一并修对（本切片未动）。
3. 是否立独立切片做 §8.1/§8.2（`_stage_dir` 写时复制 + `--cwd-copy`），避免下次 B 档审计重复付代价。

## 十、建议下一步

1. 把 §5.4 的挂账说明原文放进客户交付报告的方法学段（DR 富集数值由 seed 20261018 算出）。
2. line2/line3 现已 **106/106 图全部 PASS、UNVERIFIED=0**；交付前剩余工作只有 line1 那 8 张
   存量缺口，需另立「line1 R 图几何审计 / 人工目检」专项。
3. 若决定重算 20261013，建议一次性做「重算 → 重渲染 → 重扫 → 重打分 → 重判决」整链，
   避免图/表不同源。

---

## （主 Agent 补录）S15 实际结果

子 Agent 在被宿主掐断前已完成两个脚本的审计并拉回 CSV，但报告与合并未写完。
主 Agent 复核后补录如下（复跑命令与输出见 `con_hf/操作台账.md` 2026-10-19 条目）。

| 脚本 | 图件 | 判决 |
|---|---|---|
| `bin/line2_scrna/dr_post_analysis` | `l2_15_dr_gsea_top` / `l2_16_dr_regulatory_network` / `l2_17_dr_overlap` | 3/3 PASS |
| `bin/line3_spatial/dr_post_analysis` | `l3_*_dr_*` 4 张 | 4/4 PASS |

- 合并 `cn_debug/figure_audit_all.csv`：**133 图、PASS=133、FAIL=0**（含 source 列注明判决来源）
- 三线打分终态：line1 `35 图 PASS=27 UNVERIFIED=8 avg=95.4`；
  **line2 `37 图 PASS=37 UNVERIFIED=0 avg=100.0`**；**line3 `69 图 PASS=69 UNVERIFIED=0 avg=100.0`**
- line1 剩余 8 个 UNVERIFIED = 6 张 R 图（#192：几何审计不覆盖 R）+ 2 张 PPI 图
  （`ppi_string` 每次重取 STRING API 不可复现，禁跑）:按 `con_hf/figure_manual_review.md`
  人工清单跟踪，不得改判 PASS。
- **seed 合规挂账（#199）**：本轮 7 张图的判决是用 `--seed 20261018` 拿到的，
  磁盘 `dr_enrichment*.tsv` 数值由 20261018 算出；契约种子 20261013 的重算决策
  **待用户拍板**，本切片未修改任何交付数值。
