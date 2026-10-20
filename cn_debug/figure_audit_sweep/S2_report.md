# S2 回报：line1_bulk Python 图件几何审计补齐

- 执行时间：2026-10-19 17:39–17:52（本地 CST）/ 09:39–09:52 UTC（远端）
- 执行者：子 Agent（切片 S2）
- 依据：`con_hf/dispatch/SUBAGENT_CONTRACT.md`、`con_hf/2026-10-19_figure_polish_plan.md`、本派发单
- 结论一句话：4 个脚本的审计命令全部跑通、CSV 全部回收；**其中 2 个（pca_matrix / deg_limma）实为 R 脚本，几何审计 figs=0，属派发单前提错误 + 已知 R 覆盖缺口，非代码故障**；另发现 1 个 P0 级副作用（见 §5.6、§6），必须由主 Agent 裁决处理。

---

## 1. 任务理解

对 `line1_bulk` 的 4 个出图脚本逐个在远端跑 `ops/audit_figure_layout.py` 几何审计，把逐图判决 CSV 回收到
`cn_debug/figure_audit_sweep/`，并证明审计过程未改写远端 `figures/` 下任何 PNG。

执行边界（已遵守）：
- 只读 `bin/line1_bulk/`、`projects/PRJ_E2E_GSE277173/line1_bulk/`；未 scp 覆盖任何 `bin/` 文件；未装包；未联网。
- 未跑 `ppi_string` / `ml_model` / `external_validation` / `ml_hub_analysis`（主 Agent 保留项）。
- 审计未传 `--write`（输出行均为 `write=False`），图件未被重渲染落盘（md5 佐证见 §5.3）。
- 本地只写 `cn_debug/figure_audit_sweep/` 下 4 个 CSV + 本 md；未改 `src/` `ops/` `docs/` `con_hf/`。

## 2. 实现摘要

| 脚本 | 语言（实测） | figs | fail | 判决 | CSV |
|---|---|---|---|---|---|
| `bin/line1_bulk/bulk_figures` | Python（`python3 - <<'PYSCRIPT'`，L49） | 9 | 0 | 9 图全 PASS | `audit_bulk_figures.csv`（291 B，9 行） |
| `bin/line1_bulk/key_genes` | Python（`python3 - <<'PYSCRIPT'`，L59） | 1 | 0 | 1 图 PASS | `audit_key_genes.csv`（54 B，1 行） |
| `bin/line1_bulk/pca_matrix` | **R**（`Rscript --vanilla - <<'RSCRIPT'`，L57） | 0 | 0 | 无判决 | `audit_pca_matrix.csv`（27 B，仅表头） |
| `bin/line1_bulk/deg_limma` | **R**（`Rscript --vanilla - <<'RSCRIPT'`，L62） | 0 | 0 | 无判决 | `audit_deg_limma.csv`（27 B，仅表头） |

合计：**10 张图获得机器几何判决，全部 PASS，fail=0**。

## 3. 文件变更清单

本地（唯一允许写入区）：
- 新建 `cn_debug/figure_audit_sweep/audit_bulk_figures.csv`（9 行，全 PASS）
- 新建 `cn_debug/figure_audit_sweep/audit_key_genes.csv`（1 行，PASS）
- 新建 `cn_debug/figure_audit_sweep/audit_pca_matrix.csv`（仅表头，0 图）
- 新建 `cn_debug/figure_audit_sweep/audit_deg_limma.csv`（仅表头，0 图）
- 新建 `cn_debug/figure_audit_sweep/S2_report.md`（本文件）
- 未改仓库其他任何文件（`git status` 未执行，因禁止 git 提交类动作；文件级证据：本轮只做上述 5 次新建）

远端（临时文件，非仓库）：
- `/tmp/figs_l1_baseline.md5`（32 条 PNG 基线）、`/tmp/audit_{bulk_figures,key_genes,pca_matrix,deg_limma}.csv`
- `/tmp/figaudit_root_*`（审计脚本自建的 staging 目录，残留未清理，非仓库路径）

**远端 `projects/` 出现非预期写入（我造成的，需裁决，详见 §5.6）**：
`projects/PRJ_E2E_GSE277173/line1_bulk/processed/` 下 7 个文件 mtime 被更新为 09:41，
其中 3 个报告文件内容发生元数据漂移（`seed=` 行由 `20261013` 变 `20261018`）：

| 文件 | 审计前 md5（本地 outputs/ 快照） | 审计后 md5（远端现值） | 差异 |
|---|---|---|---|
| deg_all.tsv | 1e9491a414bd09855a64abfbdb77e0f1 | 1e9491a414bd09855a64abfbdb77e0f1 | 无（字节相同） |
| deg_sig.tsv | 9f6d69d600f5cdd9e36e21afc097289b | 9f6d69d600f5cdd9e36e21afc097289b | 无 |
| pca_scores.tsv | 57a587a9eea31b01f989e7628f9c57ea | 57a587a9eea31b01f989e7628f9c57ea | 无 |
| key_genes.tsv | beeba037305e8d6f84a9a3456c66faf4 | beeba037305e8d6f84a9a3456c66faf4 | 无 |
| deg_report.txt | 501f1096e6f6a634891e74a82e004372 | caad99c4cad74b0bbd9b0b3a8d31aca3 | 仅 `seed=` 行 |
| pca_report.txt | 889f4f3834cbf79e054c1eb6c8cdf4cd | 014e325ee01a03b48721343745407ad7 | 仅 `seed=` 行 |
| key_genes_report.txt | fdd8c8706aa7cea88cd52ead6c34fe4d | 94e477c4359b3604408290659615b52c | `seed=` 行 + `elapsed_seconds=0.5→0.3` |

数据载荷（deg_all / deg_sig / pca_scores / key_genes）**字节未变**；漂移只在这 3 份人读报告里。

## 4. 接口与交互实现说明

- 审计 CLI 契约（未改动）：`--script <绝对路径>` 与 `--cwd <相对/绝对>` 成对、`--runner bash`、`--csv <路径>`；退出码 0=全 PASS、1=有 FAIL、2=调用/环境错误。本轮 4 次均 `AUDIT_EXIT=0`。
- CSV schema 与既有 `cn_debug/figure_audit_line1.csv` 一致：`figure,verdict,violations`，可直接喂 `cn_debug/figure_score.py --audit-csv`。
- `--runner bash` 走真脚本：审计脚本建 staging 目录（`/tmp/figaudit_root_*`），把 `--cwd` 下文件软链进去、`figures/` 用空目录顶替，再跑 `bash <script> --seed 20261018 --output ../figures`，`sitecustomize.py` 拦截 `Figure.savefig` 做几何判定、不落盘。
- 名字对齐已核：4 个 CSV 的 10 个图名全部存在于远端 `figures/`（`comm -23` 无输出）；远端 32 张 PNG 中 22 张不在这 4 个 CSV 里，构成为 4 张 enrichment（已在 `figure_audit_line1.csv`）+ 6 张 R 图 + 12 张保留项（`l1_07/l1_08` ppi_string、`l1_16..l1_26` 的 10 张 ml_*）。

## 5. 测试与验证记录

### 5.1 A1 链路（PASS）

```
$ adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022 && adb forward --list
3a3e1f52 tcp:8022 tcp:8022
3a3e1f52 tcp:10022 tcp:10022

$ ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu 'echo OK; hostname; python3 -V'
OK
localhost
Python 3.12.3
```

### 5.2 A3 基线：远端 32 张 PNG 的 md5 清单

```
$ ssh k40-ubuntu 'cd .../line1_bulk/figures && md5sum *.png > /tmp/figs_l1_baseline.md5 && wc -l ...'
32 /tmp/figs_l1_baseline.md5
```
每次审计前后各跑一次 `md5sum -c /tmp/figs_l1_baseline.md5`，统计行形如 `md5_before: OK=32 FAILED=`（`FAILED=` 为空即 0 条失败）。

### 5.3 A2 + A3 逐脚本（4/4 命令均 exit 0）

审计脚本本体未变：`md5sum /mnt/ssd/bio_data/ops/audit_figure_layout.py` = `613873daf4bf6237e8cf361c1bd24349`，与计划书记录的 `613873da…` 一致。

**① bulk_figures**

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/line1_bulk/bulk_figures \
  --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
  --runner bash --csv /tmp/audit_bulk_figures.csv'
```
输出尾 3 行：
```
audit: figs=9 fail=0 write=False
audit-csv: /tmp/audit_bulk_figures.csv (9 图)
AUDIT_EXIT=0
```
md5 前后：`md5_before: OK=32 FAILED=` / `md5_after: OK=32 FAILED=`
脚本自报 `figures_done count=9 ... elapsed=3.6s`（9 张图与落盘文件一一对应）。

**② key_genes**

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/line1_bulk/key_genes \
  --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
  --runner bash --csv /tmp/audit_key_genes.csv'
```
输出尾 3 行：
```
audit: figs=1 fail=0 write=False
audit-csv: /tmp/audit_key_genes.csv (1 图)
AUDIT_EXIT=0
```
md5 前后：`md5_before: OK=32 FAILED=` / `md5_after: OK=32 FAILED=`

**③ pca_matrix（R，figs=0）**

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/line1_bulk/pca_matrix \
  --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
  --runner bash --csv /tmp/audit_pca_matrix.csv'
```
输出尾 3 行：
```
audit: figs=0 fail=0 write=False
audit-csv: /tmp/audit_pca_matrix.csv (0 图)
AUDIT_EXIT=0
```
md5 前后：`md5_before: OK=32 FAILED=` / `md5_after: OK=32 FAILED=`
R 步骤本身跑通（`variance_explained=PC1:26.6% PC2:20.3% …`，产物写入 staging），但 PNG 走 `png()` 设备，未被 `Figure.savefig` 拦截 → 0 判决。

**④ deg_limma（R，figs=0）**

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/line1_bulk/deg_limma \
  --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
  --runner bash --csv /tmp/audit_deg_limma.csv'
```
输出尾 3 行：
```
audit: figs=0 fail=0 write=False
audit-csv: /tmp/audit_deg_limma.csv (0 图)
AUDIT_EXIT=0
```
md5 前后：`md5_before: OK=32 FAILED=` / `md5_after: OK=32 FAILED=`
R 步骤本身跑通（`genes_tested=20019 sig_genes=0 min_adj_P_Val=0.4524`），同样 figs=0。

### 5.4 A4 汇总表

| 脚本 | figs | fail | CSV（本地绝对路径） | 图文件名清单 |
|---|---|---|---|---|
| bulk_figures | 9 | 0 | `D:\00.AIagent\codespace\AI辅助生信分析流程工作台\cn_debug\figure_audit_sweep\audit_bulk_figures.csv` | `l1_01_correlation.png` / `l1_02_pca.png` / `l1_03_volcano_fdr.png` / `l1_03_volcano_nominal.png` / `l1_04_topvar_heatmap.png` / `l1_05a_genes_detected.png` / `l1_05b_within_group_cor.png` / `l1_06_ma_fdr.png` / `l1_06_ma_nominal.png`（全 PASS） |
| key_genes | 1 | 0 | `…\figure_audit_sweep\audit_key_genes.csv` | `l1_09_key_genes.png`（PASS） |
| pca_matrix | 0 | 0 | `…\figure_audit_sweep\audit_pca_matrix.csv` | 无（`l1_02_pca_step3.png` 未获判决） |
| deg_limma | 0 | 0 | `…\figure_audit_sweep\audit_deg_limma.csv` | 无（`l1_03_volcano_limma.png` 未获判决） |

CSV 原文（bulk_figures）：
```
figure,verdict,violations
l1_01_correlation.png,PASS,
l1_04_topvar_heatmap.png,PASS,
l1_02_pca.png,PASS,
l1_03_volcano_fdr.png,PASS,
l1_03_volcano_nominal.png,PASS,
l1_06_ma_fdr.png,PASS,
l1_06_ma_nominal.png,PASS,
l1_05a_genes_detected.png,PASS,
l1_05b_within_group_cor.png,PASS,
```
INFO 提示（不计 FAIL）：`l1_02_pca`/`l1_05a`/`l1_05b`/`l1_09` 各有 1–3 条 `tick 标签越出画布 …（tight 裁切可容纳）`。

### 5.5 A5 跳过/失败清单

| 脚本 | 状态 | 错误原文 | 判断 |
|---|---|---|---|
| pca_matrix | 未获判决（figs=0），未重试 | 无 stderr 错误；`audit: figs=0 fail=0 write=False` | **代码/口径问题，非环境**：该脚本是 `Rscript --vanilla - <<'RSCRIPT'`（L57），`grep -c python3` = 0；R `png()` 设备拦不住 `Figure.savefig` |
| deg_limma | 未获判决（figs=0），未重试 | 无 stderr 错误；`audit: figs=0 fail=0 write=False` | 同上：`Rscript`（L62），`grep -c python3` = 0 |
| ppi_string / ml_model / external_validation / ml_hub_analysis | 按派发单跳过 | — | 主 Agent 保留项 |

**派发单前提与实测冲突**：派发单称这 4 个都是「Python 出图脚本」，实测 pca_matrix、deg_limma 无任何 python3 块，是纯 R 脚本；
`con_hf/2026-10-19_figure_polish_plan.md` §0 缺口 1 也已把 `l1_02_pca_step3` / `l1_03_volcano_limma` 归为「6 张 R 图无机器判决」。
两者矛盾，按契约不擅自选边：本切片照跑留证（figs=0 即证据），判决方案交主 Agent（S3）。

### 5.6 A3 补充：图件未被改写 + 意外副作用

- 图件：4 次审计前后 `md5sum -c` 均 `OK=32 FAILED=0`；`figures/` 最新 mtime 仍是 `2026-10-19_08:15`（审计时段 09:40–09:52 UTC 内无写入）。
- **副作用（P0，需裁决）**：`processed/` 有 7 个文件 mtime 变成 `09:41`。根因已定位到 `ops/audit_figure_layout.py::_stage_dir()`：
  它把 `--cwd` 下**所有文件软链**进 staging（实测 `deg_all.tsv -> /mnt/ssd/bio_data/projects/.../processed/deg_all.tsv`），
  而步骤脚本按同名写产物（`write.table("deg_all.tsv")` / `open("key_genes.tsv","w")`）→ **写穿软链，落回真实 processed 目录**，
  与 `_stage_dir` docstring 声称的「真 processed 目录零改动」相反。
- 影响评估（已核）：4 个数据文件字节相同（与本地 `outputs/PRJ_E2E_GSE277173/line1_bulk/processed/` 快照、
  以及 `deliverables/.../tables/line1_bulk/` 02:30 副本三方 md5 对齐）；3 份报告仅 `seed=20261013→20261018`
  与 `elapsed_seconds` 漂移。原因：审计默认 `--seed 20261018`，而项目正本运行用 `20261013`。
- 我**没有**回写 `projects/`（派发单明令禁止），恢复命令留给主 Agent（§8 第 1 条）。

## 6. 假设与风险

1. 「审计默认 seed 20261018」与「项目正本 seed 20261013」不一致，是上述报告漂移的直接原因；本数据集里 seed 不影响数值（deg_all/key_genes 字节相同），但换成有随机性的步骤（WGCNA/置换检验）就会真改数据。
2. `_stage_dir` 的写穿风险对所有后续审计（含 line2/line3、`--write` 模式）都存在；本次仅因输出确定性而未造成数据损坏，属运气而非设计保证。
3. 0 行的 `audit_pca_matrix.csv` / `audit_deg_limma.csv` 若被主 Agent 一并导入 `figure_score.py`，对应 2 图会停在 UNVERIFIED（这是三态判决的正确行为，不是故障）。
4. 我未执行 `git status`/`git diff`（派发单禁止 git 提交类动作，且本机工作区非 git 只读证明），故「未改仓库其他文件」的依据是本轮只新建了 §3 列出的 5 个文件。
5. 未验证：R 侧几何判决（本切片不涉及）；未目视审图（几何审计是机器判定，不代表美观合格）。

## 7. 架构/接口变更建议（交主 Agent，我不改 ops/）

1. `_stage_dir()` 改为**复制**小文件（如 <32 MB）而非软链，大文件（h5ad/loom）保留软链并在 docstring 标注残余风险；
   或对 staging 内文件设只读 + 预置同名空文件占位，让写穿变成显式报错。
2. 给 `run_bash()` 加**污染守卫**：跑前对 `--cwd` 做 md5 快照，跑后比对，有变化则打印被改文件清单并以退出码 2 失败。
3. `--seed` 增加默认值校验：审计 seed 应可显式传入（如 `--seed`），默认值与项目正本 seed 对齐，避免报告元数据漂移。

## 8. 待主 Agent 决策事项

1. **是否恢复 3 份漂移报告**（我只给命令，未执行）。本地快照即审计前字节：
   ```
   scp "D:/00.AIagent/codespace/AI辅助生信分析流程工作台/outputs/PRJ_E2E_GSE277173/line1_bulk/processed/deg_report.txt" \
       "…/pca_report.txt" "…/key_genes_report.txt" k40-ubuntu:/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/processed/
   ```
   期望恢复后 md5：`deg_report.txt=501f1096…`、`pca_report.txt=889f4f38…`、`key_genes_report.txt=fdd8c870…`（与 `deliverables` 副本一致）。
   替代方案：用正本 seed `20261013` 重跑 deg_limma/pca_matrix/key_genes 三步（会重写同样 7 个文件，结果应字节一致）。
2. **S3 方案**：pca_matrix / deg_limma / wgcna_modules 三处 R 出图是否补 R 侧几何审计（`png()` 前后用 `par("usr")` + `strwidth` 判越界），或走人工登记。
3. 是否把 `audit_pca_matrix.csv` / `audit_deg_limma.csv`（0 行）纳入打分导入清单（建议纳入，让对应图保持 UNVERIFIED 而非默认 PASS）。
4. 是否先修 `_stage_dir` 写穿缺陷，再继续 S3/S4 的批量审计（建议先修，否则每次审计都在动 `processed/`）。

## 9. 建议下一步

1. 主 Agent 先裁决 §8 第 1、4 条（恢复报告 + 修写穿），再让我继续批量审计，避免污染面扩大。
2. 修完后用同一 4 条命令复跑，预期 `bulk_figures=9 PASS`、`key_genes=1 PASS`、两份 R 仍 `figs=0`，且 `processed/` mtime 不变（新守卫应打印 `unchanged`）。
3. R 侧判决方案定了之后，再由我按同模板补 `l1_02_pca_step3` / `l1_03_volcano_limma` / `l1_28..l1_31`。
