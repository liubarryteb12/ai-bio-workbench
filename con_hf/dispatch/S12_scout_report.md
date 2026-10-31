# S12-scout 报告：line2 / line3 图件几何审计可行性侦察

> 执行：项目实现型子 Agent（只读侦察，未改任何源码）。
> 日期：2026-10-19。派发单：`con_hf/dispatch/` S12-scout。
> 通道：`adb forward tcp:8022/10022` → `ssh k40-ubuntu`（`echo OK` 通过，Python 3.12.3）。
> 项目根：`D:\00.AIagent\codespace\AI辅助生信分析流程工作台`；远端 `/mnt/ssd/bio_data`。

---

## 一、任务理解

回答三个问题，供主 Agent 决定是否派实施切片：

1. line2/line3 的 37 + 69 张图，分别由哪些脚本出、哪些能被 `ops/audit_figure_layout.py` 机器判决；
2. 跑一次真审计要付出什么代价（是否重算、是否改数据、耗时多少、种子风险）；
3. 现存状态里有哪些「必须先处置才能审」的坑。

执行边界：只侦察 + **最多跑 1 个脚本的试点审计**；不改仓库代码；不跑任何上游分析 step。

---

## 二、实现摘要（结论先行）

1. **两线共 10 个出图脚本、106 张图**（line2 6 脚本/37 图，line3 4 脚本/69 图）。
   10 个脚本**全部**有 `def caption(`，即全部具备被几何审计的资格。
2. **93 张（87.7%）是纯渲染、零重算、零副作用**：5 个脚本
   （line2 `scrna_figures`/`enrichment_figures`/`scenic_figures`，line3 `spatial_figures`/`enrichment_figures`）。
   这类可以直接审，代价只有渲染时间。
3. **13 张（12.3%）能审但会重算**：5 个脚本
   （line2 `dr_post_analysis`/`gsva_pathways`/`target_gene_localization`，
   line3 `celltype_annotation`/`dr_post_analysis`）。它们在出图前先跑 GSEA/NNLS/GSVA 并写回 `processed/`。
4. **不可审：0 张。** 两线**没有任何 R 出图脚本**，`#192` 的 R 侧缺口不适用于 line2/line3。
   唯一的 R 代码块在 `line2_scrna/gsva_pathways:98`，只做 GSVA 计算、写 `gsva_scores.tsv`，不画图。
5. **试点审计已跑通**：`line2_scrna/enrichment_figures` → `audit: figs=2 fail=0 write=False`，
   2 张图全 PASS；审计前后 `figures/`(37) 与 `processed/`(59) **全部文件 md5 字节一致**。
6. **发现一个必须先处置的存量问题（P1）**：line2/line3 的 5 个重算脚本，其报告里的
   `seed=` 行**当前是 20261018**，而项目真种子是 20261013（其余 15+ 份报告均为 20261013）。
   时间戳 07:13→07:16 连续，说明这 5 步在 2026-10-18 早上被一批跑过。
   **"line2/line3 图件从未跑过 audit_figure_layout.py" 这个前提对纯渲染 5 个脚本成立，对重算 5 个脚本不成立。**

---

## 三、文件变更清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `con_hf/dispatch/S12_scout_report.md` | 新建 | 本报告 |
| `cn_debug/figure_audit_sweep/s12_probe_line2_enrichment_figures.csv` | 新建（留档） | 试点审计 CSV，md5 `08bc9a611720d62bd0482a4d15353e9e`，内容 `l2_11_ora_top.png,PASS` / `l2_12_gsea_top.png,PASS` |

未改任何 `src/`、`ops/`、`docs/`、`cn_debug/*.py`；未写远端 `bin/`、`processed/`、`figures/`。
侦察用的脚本副本只落在本地 scratch（`.../profiles/sw-engineer/cache/scratch/s12/`），未进仓库。

改动范围佐证的限制：**工作区不是 git 仓库**（`git status` 报 `fatal: not a git repository`），
且同期有并行子 Agent（S11）在写 `cn_debug/2026-10-19_s11_*` 与 `con_hf/dispatch/S11_*`，
因此无法用 `git diff` 界定改动。本切片的落盘动作仅上述 2 个文件，其余均为只读。
（`cn_debug/figure_score.py` 的 mtime 为 23:38，早于本切片的读取时刻，本报告引用的
`VETO`/`NAME_RE`/`WEIGHTS` 行号与内容为该时刻的实况。）

---

## 四、接口与交互实现说明（审计通道的实际行为）

读 `ops/audit_figure_layout.py`（远端 md5 `4e0a6647efe8d02f605fdb75ad4b57f8`，与 `#190` 修复版一致）后确认：

1. `--runner bash` 是**真跑脚本**（L342：`cmd = ["bash", script, "--seed", seed, "--output", "../figures"]`，
   并 L343-344 用 `derive_inputs()` 反推 `--input`）。
2. **`write=False`（默认）时不在真 `processed/` 里跑**：L341 `run_cwd = cwd if write else _stage_dir(cwd)`，
   `_stage_dir()`（L291-325）建临时目录，把 `processed/` 每个文件**软链**进去，
   `figures/`/`results/` 用空目录顶替。所以出图落在临时目录，真 `figures/` 不被写。
3. **但软链会穿透写回真文件**：脚本若在 cwd 原地重写已有产物（`open(...,"w")` / `to_csv`），
   写的是软链目标 = 真 `processed/` 里的文件。已用 /tmp 探针实证（见 §5.3）。
4. 审计判据 A/B/C/D 由 shim 在 `Figure.savefig` 外层拦截（L262-288），
   脚本自带的 `_install_layout_guard()` 先做 `layout_fix()`，所以审到的是**最终版式**。
5. `--seed` 默认仍是 `20261018`（L415），**必须显式传项目真种子**，否则重算类脚本的报告会被改写（`#190`）。

---

## 五、测试与验证记录

### 5.1 链路自检

```
$ adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022
$ ssh -o BatchMode=yes k40-ubuntu 'echo OK; hostname; python3 -V'
OK
localhost
Python 3.12.3
```

### 5.2 A1 : 两线出图脚本清单（判据含行号）

「出图脚本」判据：bash 包装内嵌 Python heredoc 且含 `def caption(` + 有 `savefig`。
line2 22 个脚本中 6 个符合，line3 18 个脚本中 4 个符合，其余 30 个 `savefig=0`（纯计算步骤，不出图）。

| 线 | 脚本 | 交付图数 | `def caption(` | 出图调用行 | 输入（cwd=processed） | 纯渲染？ |
|---|---|---|---|---|---|---|
| line2 | `scrna_figures` | 28 | L97 | L477/512/548/583/628/642/665 | `scrna_deg.h5ad`（L43 强制要求，L431 读取）、`deg_all_by_celltype.tsv`（L461，可选） | **是** |
| line2 | `enrichment_figures` | 2 | L85 | L79（`save()`） | `enrichment_ora.tsv`（L255）、`enrichment_gsea.tsv`（L291） | **是** |
| line2 | `scenic_figures` | 2 | L69 | L229/244 | `scenic_regulon_by_celltype.tsv`+`scenic_tf_summary.tsv`（L28-30 强校验，L212-213 读） | **是** |
| line2 | `target_gene_localization` | 1 | L84 | L359 | `scrna_deg.h5ad`、`deg_all_by_celltype.tsv`、`ko_dr_genes.tsv`（L64-66） | 否：L303/308 `to_csv`、L325 `write_h5ad` |
| line2 | `gsva_pathways` | 1 | L179 | L354 | `scrna_norm.h5ad`+`scrna_deg.h5ad`（L50-51/64-65）、`../references/gmt_cache/*.gmt` | 否：L98 `Rscript` GSVA、L142 写 `gsva_scores.tsv`、L371 `write_h5ad` |
| line2 | `dr_post_analysis` | 3 | L81 | L326/392/454 | `scrna_knockout.h5ad`、`ko_dr_genes.tsv`、`scenic_regulons.csv`、`deg_all_by_celltype.tsv`、`scrna_deg.h5ad`、gmt_cache（L222-223 强校验） | 否：L270 GSEA（permutation 1000，seed=SEED）、L292/347/424 `to_csv`、L494 报告 |
| line3 | `spatial_figures` | 57 | L92 | L272/291/307/324/338/351/376/395/422 | `spatial_knockout_mouse.h5ad`+`spatial_knockout_human.h5ad`（L41 强校验，L243 读） | **是** |
| line3 | `enrichment_figures` | 4 | L87 | L81（`save()`） | `enrichment_ora_{mouse,human}.tsv`（L258）、`enrichment_gsea_{...}.tsv`（L303） | **是** |
| line3 | `celltype_annotation` | 4 | L88 | L404/448 | `spatial_marker_{mouse,human}.h5ad`、`domain_markers_{...}.tsv`（L250-251） | 否：L356/366 `to_csv`、L373 `write_h5ad` |
| line3 | `dr_post_analysis` | 4 | L86 | L359/409 | `spatial_knockout_{...}.h5ad`、`ko_dr_genes_{...}.tsv`、`domain_markers_{...}.tsv`（L254-256）、gmt_cache | 否：L303 GSEA、L325/386 `to_csv`、L439 报告 |

图数核对（与本地 `outputs/default/.../figures` 实际文件逐一对齐）：

- line2 = 4 UMAP + 1 stack + 13 box + 1 marker + 7 volcano + 1 sig bar + 1 pca = **28**（scrna_figures）
  + 2（enrichment）+ 2（scenic）+ 1 + 1 + 3 = **37** ✔
- line3 = 15 domains + 15 target_gene + 15 ko_dr（= 5 human + 10 mouse 逐样本，L253/278/313 三个 `for s in samples`）
  + 6 组图 × 2 物种（04-09）= **57**（spatial_figures）+ 4 + 4 + 4 = **69** ✔

输入齐备性：两线 `processed/` 里 10 个脚本需要的输入**全部存在**。
两种核法：① 有 `case "$path" in` 分流的脚本用 `derive_inputs()` 反推并 `os.path.exists` 校验
（`scrna_figures` 1/1 命中 `scrna_deg.h5ad`；`spatial_figures` 2/2 命中 `spatial_knockout_{mouse,human}.h5ad`）；
② 无分流的脚本按脚本头部声明的输入名逐个比对 `ls processed/`（如 `enrichment_ora.tsv` 518KB、
`enrichment_gsea.tsv` 3.4MB、`scenic_regulon_by_celltype.tsv`、`ko_dr_genes.tsv`、`domain_markers_*.tsv` 均在）。
`references/gmt_cache` 两线各 7 个 gmt 存在。故没有「需数据（输入缺失）」状态的脚本。

源码一致性（防止审的是远端旧版）：本地 `src/line{2,3}_*/scripts/*` 与远端 `bin/line{2,3}*/` **10/10 md5 相同**。

### 5.3 A2 : 三态表

| 态 | 脚本 | 图数 | 判据 |
|---|---|---|---|
| **可审（纯渲染，零重算）** | line2 `enrichment_figures` | 2 | 只 `rd()` 读 tsv（L255/291）；全文无 `to_csv`/`write_h5ad`；图注 L85 |
| | line2 `scenic_figures` | 2 | 只 `pd.read_csv` 两个 tsv（L212-213）；无写操作；图注 L69 |
| | line2 `scrna_figures` | 28 | 只 `ad.read_h5ad`（L431）+ 读 `deg_all_by_celltype.tsv`（L461）；无写操作；图注 L97 |
| | line3 `enrichment_figures` | 4 | 只 `rd()` 读 tsv（L258/303）；无写操作；图注 L87 |
| | line3 `spatial_figures` | 57 | 只 `ad.read_h5ad`（L243）取 `obsm['spatial']`/`obs['sample_id']`/`obs['domain']`；无写操作；图注 L92 |
| **可审但会重算（写回 processed）** | line2 `target_gene_localization` | 1 | L303/308 `to_csv`、L325 `write_h5ad`、L392 报告 |
| | line2 `gsva_pathways` | 1 | L98 R GSVA 重算、L142 写 tsv、L371 `write_h5ad`、L397 报告 |
| | line2 `dr_post_analysis` | 3 | L270 GSEA(perm 1000, seed)、L292/347/424 写 tsv、L494 报告 |
| | line3 `celltype_annotation` | 4 | L356/366 写 tsv、L373 `write_h5ad`、L475 报告 |
| | line3 `dr_post_analysis` | 4 | L303 GSEA、L325/386 写 tsv、L439 报告 |
| **不可审** | : | 0 | 无 R 出图脚本；10 个出图脚本全部有 caption |

合计：可审 93 图（5 脚本）＋ 可审但重算 13 图（5 脚本）＝ 106 图（10 脚本），与本地 37+69 完全对齐。

### 5.4 A3 : 试点审计（`line2_scrna/enrichment_figures`）

**md5 基线（审计前）**

```
$ cd /mnt/ssd/bio_data/projects/default/line2_scrna
$ find figures -type f | sort | xargs md5sum > /tmp/s12_before_figs.md5      # 37 行
$ find processed -type f | sort | xargs md5sum > /tmp/s12_before_proc.md5    # 59 行
```

**审计命令（原文）**

```
$ ssh k40-ubuntu 'cd /mnt/ssd/bio_data && time python3 ops/audit_figure_layout.py \
    --script /mnt/ssd/bio_data/bin/line2_scrna/enrichment_figures \
    --cwd projects/default/line2_scrna/processed \
    --runner bash --seed 20261013 --csv /tmp/s12_probe.csv; echo "EXIT=$?"'
```

**输出（原文节选）**

```
=== /mnt/ssd/bio_data/bin/line2_scrna/enrichment_figures @ projects/default/line2_scrna/processed
step_executed=enrichment_figures
bioanalys_seed=20261013
workdir=/tmp/figaudit_root_vg52zuui/processed
wrote l2_11_ora_top.png
wrote l2_12_gsea_top.png
figures_done count=2 out=/tmp/figaudit_root_vg52zuui/processed/../figures elapsed=1.4s
PASS l2_11_ora_top.png
      INFO tick 标签越出画布 axes0 '16'（tight 裁切可容纳）
PASS l2_12_gsea_top.png
      INFO tick 标签越出画布 axes0 '6'（tight 裁切可容纳）
audit: figs=2 fail=0 write=False
audit-csv: /tmp/s12_probe.csv (2 图)

real    0m4.094s
EXIT=0
```

要点：`workdir=/tmp/figaudit_root_vg52zuui/processed` 证明 `_stage_dir()` 生效，出图落在临时目录；
`elapsed=1.4s` 是脚本自身渲染耗时，4.09s 是审计全程（含父进程 import 与子进程起停）。

**md5 前后对比表**

| 对象 | 文件数 | 基线清单 md5 | 审计后清单 md5 | 差异行 |
|---|---|---|---|---|
| `line2_scrna/figures` | 37 | `ebc69f017a523073c78cc0e125b1ae02` | `ebc69f017a523073c78cc0e125b1ae02` | 0（`diff` 无输出） |
| `line2_scrna/processed` | 59 | `98867b31c09969f9cef256dc5666137c` | `98867b31c09969f9cef256dc5666137c` | 0（`diff` 无输出） |

被审的两张图逐文件 md5：

| 图 | before | after |
|---|---|---|
| `l2_11_ora_top.png` | `efddeb14951b26f0faee8674154bb056` | `efddeb14951b26f0faee8674154bb056` |
| `l2_12_gsea_top.png` | `ca0c52847d8849003c74855bcc58293f` | `ca0c52847d8849003c74855bcc58293f` |

CSV 已拉回本地：`cn_debug/figure_audit_sweep/s12_probe_line2_enrichment_figures.csv`
（`08bc9a61…`，两行 `PASS`）。远端留档 `/tmp/s12_probe.csv`。

**软链穿透实证（回答「重算类脚本会不会改真数据」）**

```
$ D=$(mktemp -d); ln -s $D/real/report.txt $D/stage/report.txt
$ python3 -c 'open(stage/report.txt,"w").write("REWRITTEN_BY_STAGE")'
stage_is_symlink: True
real_file_after_write: REWRITTEN_BY_STAGE
```

结论：`_stage_dir()` 的软链**只保护新建文件，不保护原地重写**。所以 5 个重算脚本走 bash 审计，
其 `to_csv`/`open(...,"w")` 会直接改写真 `processed/` 里的 tsv 与报告。

### 5.5 A4 : 全量审计耗时估算与风险点

耗时（除标注「实测」外均为估算，依据写在括号里）：

| 脚本 | 图数 | 预计墙钟 | 依据 |
|---|---|---|---|
| line2 `enrichment_figures` | 2 | **4.1s（实测）** | 试点 `real 0m4.094s` |
| line2 `scenic_figures` | 2 | 4-6s | 输入仅 2 个 tsv（36KB/11KB），与试点同量级 |
| line2 `scrna_figures` | 28 | 40-90s | import anndata+scanpy+mpl **实测 14.1s**；`scrna_deg.h5ad` 读取 **实测 0.28s**（4587×2000）；28 张图 |
| line3 `enrichment_figures` | 4 | 6-10s | 输入 tsv 5.3/11.2/1.5/0.9MB，4 张图 |
| line3 `spatial_figures` | 57 | 90-200s | import 14.1s + 两份 h5ad 读取**实测 2.40s/1.07s**（17283×18628 / 6877×19613）+ 57 张图（15 张逐样本点云） |
| **小计（93 图纯渲染）** | 93 | **≈ 2.5-5.5 min** | |
| line2 `target_gene_localization` | 1 | 6.3s + import | 报告自记 `elapsed_seconds=6.3` |
| line2 `gsva_pathways` | 1 | 2.2s + import | 报告自记 `elapsed_seconds=2.2`（含 R GSVA） |
| line2 `dr_post_analysis` | 3 | 17.5s + import | 报告自记 `elapsed_seconds=17.5` |
| line3 `celltype_annotation` | 4 | 43.5s + import | 报告自记 `elapsed_seconds=43.5` |
| line3 `dr_post_analysis` | 4 | 12.9s + import | 报告自记 `elapsed_seconds=12.9` |
| **小计（13 图重算）** | 13 | **≈ 2.5-4 min**（82.4s 计算 + 5×14s import + 审计开销） | |

**全量 106 图：约 5-10 min 墙钟**，另加每条线两次 md5 全量校验（37 图 3.5s / 59 文件含 1.5GB h5ad 约 3.5s）
与人工复核。相比 line1 的 27 图审计，量级可控。

风险点（按严重度）：

| 级别 | 风险 | 证据 |
|---|---|---|
| **P0** | 重算类脚本走 bash 审计会**原地改写真 `processed/`**（软链穿透）：`dr_enrichment.tsv`、`gsva_scores.tsv`、`scrna_gsva.h5ad`、`celltype_annotation_*.tsv`、`spatial_deconv_*.h5ad` 及 5 份报告 | §5.3 探针；`_stage_dir()` L309-316 用 `os.symlink` |
| **P1** | **种子已污染**：5 份重算报告当前 `seed=20261018`，项目真种子 `20261013`（其余 15+ 份报告均为 20261013）。文件 mtime 07:13→07:16 连续，说明这 5 步在 2026-10-18 早上被一批跑过 | `grep -H seed projects/default/line*/processed/*.txt`；`dr_post_report.txt`/`gsva_report.txt`/`localization_report.txt`/`deconv_report.txt`/`dr_post_report.txt`(line3) |
| **P1** | 若按 20261013 审计这 5 个脚本，GSEA/NNLS 会**重算**：tsv 与图件内容可能变化 → 新渲染的图 ≠ 已交付 PNG，审计判决对象错位；必须「重算→重扫→重打分」整链重跑 | L270/L303 GSEA `permutation_num=1000, seed=SEED` |
| **P2** | `spatial_figures` **只能用 `--runner bash`**；`exec` 通道的 `emulate_env()` 会把 `FIG_MOUSE` 指到 `spatial_autocorr_mouse.h5ad`（glob 取 `hits[0]`，无「注释点名优先」逻辑），输入错文件 | 实测 `emulate_env` 返回 `{'FIG_MOUSE': 'spatial_autocorr_mouse.h5ad', ...}`，而 `derive_inputs` 正确返回 `spatial_knockout_*.h5ad`；`_stage_dir` 注释 L238-240 已记同类坑 |
| **P2** | `figure_score` 的 C1（图注登记）缺口 **87/106**：`BioanalysDesktop/server/figures.js` 只有 19 条 l2/l3 登记 | `comm -23` 图件名 vs `FIGURE_CAPTIONS` 键，missing=87 |
| **P2** | C1 缺失不致命：权重 6 分、非一票否决（`VETO = [A1,A2,B1,C2]`），满分 94 仍 > 75 PASS 线；但 D2/D3 缺失会直接 UNVERIFIED | `cn_debug/figure_score.py:67`、`WEIGHTS` L54-61 |
| **P3** | 命名合规无风险：`NAME_RE = ^l[123]_(?:[a-z]+_)?[0-9]{2}[ab]?_[A-Za-z0-9_.]+\.png$` 能匹配 `l2_scenic_01_*`、`l3_human_01_*`、`l2_06_composition_box_T_cell` | `figure_score.py:76` 逐名核对 |

### 5.6 A5 : R 出图脚本

**line2/line3 不存在 R 出图脚本。** 全量扫描 `grep -Hn "Rscript\|png(\|ggsave" bin/line2_scrna/* bin/line3_spatial/*`：

- `ggsave`：0 处；R `png(` 设备：0 处；
- `Rscript`：仅 1 处 : `line2_scrna/gsva_pathways:98`，该块读 `_gsva_pseudobulk.tsv`、
  调 `GSVA::gsva()`、`write.table(out, "gsva_scores.tsv")`（L142），**不产任何图**；
  `gsva_pathways` 的图 `l2_14_gsva_heatmap.png` 由第二个 Python heredoc 的 `savefig`（L354）产出。

因此 `#192` 的「R 走 `png()` 拦不住 → figs=0」在 line2/line3 **不适用**：这两线 106 张图全部经
`matplotlib.Figure.savefig`，几何审计可以全覆盖。line1 那 6 张 R 图（`l1_02`/`l1_03`/`l1_28~31`）仍是独立缺口。

---

## 六、视觉审查

**未做。** 本轮为可行性侦察，未逐张查看 line2/line3 的 PNG，不对其美观性/规范性下任何结论。
试点审计只给出几何判决（A-E 项），不等于目视通过。

---

## 七、假设与风险

1. 「项目真种子 = 20261013」来自 `#190` 与派发单，并用 15+ 份 `seed=20261013` 的报告交叉验证；
   `projects/default/project.json` **不含** seed 字段（`lines`/`grouping_design` 里也没有），
   种子只能从报告与派发单推定 : 这一点建议主 Agent 确认一次权威来源。
2. 耗时估算里除试点 4.1s 与三次 import/read 实测外，其余按图数与输入体量外推，**未逐个实测**。
   最不确定的是 `spatial_figures`（57 图，估 90-200s，误差可能 ±1 倍）。
3. 图数 28/57 是按脚本源码的循环结构 + 实际文件反推，**未实际重渲染验证**；
   若 `uns`/`obs` 缺键，脚本会走 `skip`/`continue` 分支，实际 figs 可能少于交付数。
4. 5 份 `seed=20261018` 报告的成因是**推断**（时间戳连续 + 只影响「出图+重算」这 5 步）；
   不能确定是早前 bash 审计还是有人按 20261018 手动重跑。结论不受成因影响：provenance 现状与真种子不一致。
5. 远端 `bin/` 与本地 `src/` 10/10 md5 相同，但本次只核对了这 10 个出图脚本，未核对其余 30 个计算脚本。

---

## 八、架构/接口变更建议

1. **`_stage_dir()` 应改为「复制」而非「软链」**（或对将被重写的产物用 `copy2`）：
   现状只保护新建文件，原地重写会穿透到真 `processed/`。这是 `#190` 之后仍然存在的结构缺口。
   改动点在 `ops/audit_figure_layout.py:309-316`，属工具层，不碰任何出图脚本。
   （是否要改由主 Agent 裁决，本切片未动。）
2. **`emulate_env()` 应与 `derive_inputs()` 共用「注释点名优先」的候选选择逻辑**
   （`derive_inputs` L252-253 有，`emulate_env` L214-216 没有），否则 `--runner exec`
   对 `spatial_figures` 会拿到错输入。
3. 建议审计产物统一落 `cn_debug/figure_audit_sweep/audit_<line>_<step>.csv`，
   与 line1 的 `audit_bulk_figures.csv` 等命名保持一致（本次试点已按此命名留档）。

---

## 九、待主 Agent 决策事项

1. **种子处置**：5 个重算脚本的报告已被写成 20261018。是
   （a）按真种子 20261013 重跑这 5 步以修复 provenance（会改 tsv/图件，需重扫重打分），
   （b）先只审 93 张纯渲染图，重算 5 步单独立项，
   还是（c）先查清 2026-10-18 07:13-07:16 那批是谁跑的。
2. **是否先修 `_stage_dir` 软链**再审重算类脚本；不修就必须接受「审计会改写真 processed」。
3. **C1 登记缺口 87/106** 是否纳入本批（否则 line2/line3 打分最高 94 分，
   虽仍 PASS，但交付报告里 87 张图没有中文图注）。
4. `spatial_figures` 57 张（含 15 张逐样本空间图）是否全审，还是只审 6 张组图。

---

## 十、建议下一步（实施切片 S12-impl 的最小可行范围）

1. **第一批（零风险，建议立刻做）**：审 5 个纯渲染脚本的 93 张图 :
   `line2 {scrna_figures, enrichment_figures(已完成), scenic_figures}` +
   `line3 {spatial_figures, enrichment_figures}`，全部 `--runner bash --seed 20261013`，
   每条线前后各做一次 md5 基线，CSV 落 `cn_debug/figure_audit_sweep/`。
   预计 3-6 min，副作用为零（试点已证）。
2. **第二批（需先决策 §9.1/§9.2）**：5 个重算脚本的 13 张图。建议先改 `_stage_dir` 再跑，
   跑完按 `#190` 纪律用真种子重跑并核对 tsv/报告 md5，再重扫重打分。
3. 两批完成后跑 `cn_debug/figure_score.py --dir outputs/default/line{2,3}_*/figures
   --audit-csv <新CSV> --code-csv cn_debug/code_audit.csv --ledger-dir outputs/system_logs --src-root src`，
   确认 `FAIL=0`、`UNVERIFIED` 归零；C1 缺口按 §9.3 的决定另行处理。
