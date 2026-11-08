# S3 回报：line1_bulk 剩余 Python 图件几何审计补齐（ml_hub_analysis / ml_model / external_validation）

- 执行时间：2026-10-19 18:25–18:40（本地 CST）/ 10:25–10:35 UTC（远端）
- 执行者：子 Agent（切片 S3）
- 依据：`workspace/handoff/dispatch/SUBAGENT_CONTRACT.md`、`workspace/handoff/archive/2026-10-19_figure_polish_plan.md`、`ledger/踩坑台账.md` #190、本派发单
- 结论一句话：3 个脚本审计全部跑通、exit 0，**13 张图全 PASS、fail=0**，`figures/` 32/32 字节未变；`processed/` 仅 `ml_hub_report.txt` 的 `elapsed_seconds` 一行漂移（`seed=20261013` 未被污染），无数据表字节变化、无新增/消失文件；合并后 `figure_audit_line1.csv` 27 行全 PASS，打分 `PASS=11 FAIL=0 UNVERIFIED=22 avg=89.6`（UNVERIFIED 全部来自台账归因缺口 + R 图 + 禁跑的 ppi_string，非本轮审计失败）。

---

## 1. 任务理解

对 `line1_bulk` 剩余 3 个出图脚本（`ml_hub_analysis` / `ml_model` / `external_validation`）在远端逐个跑
`ops/audit_figure_layout.py` 几何审计（**必须传 `--seed 20261013`**，否则重演 #190 的 provenance 污染），
回收逐图判决 CSV，并对每次审计做 `figures/` 与 `processed/` 的前后 md5 对照；最后把全部审计 CSV
（含 S2 的 4 个）与既有 `cn_debug/figure_audit_line1.csv` 合并成一份，喂 `cn_debug/figure_score.py` 取尾部结论。

执行边界（已遵守）：
- 未跑 `ppi_string`；未 scp 覆盖 `bin/`；未装/升级包；未联网；未改 `src/ ops/ docs/ workspace/handoff/archive/` 下任何文件。
- 审计一律不带 `--write`（输出行均 `write=False`），不落图。
- 每次审计后立即做双 md5 对照；`processed/` 侧用审计前快照 `/tmp/s3_proc_snapshot_19342/` 做逐行 diff。
- 本地只写 `cn_debug/figure_audit_sweep/`（CSV + 本 md + 1 个打分日志）与派发单第 5 项明确要求的 `cn_debug/figure_audit_line1.csv`（已先备份，见 §3 与 §9 第 1 条）。

## 2. 实现摘要

| 脚本 | 语言（实测） | figs | fail | 判决 | CSV（本地，B） |
|---|---|---|---|---|---|
| `bin/line1_bulk/ml_hub_analysis` | bash + 2×`python3` heredoc + 1×`Rscript`（glmnet LASSO） | 10 | 0 | 10 图全 PASS | `audit_ml_hub_analysis.csv`（310） |
| `bin/line1_bulk/ml_model` | bash + `python3` heredoc | 2 | 0 | 2 图全 PASS | `audit_ml_model.csv`（82） |
| `bin/line1_bulk/external_validation` | bash + `python3` heredoc | 1 | 0 | 1 图 PASS | `audit_external_validation.csv`（57） |

合计 **13 张图获得机器几何判决，全 PASS，fail=0**；三次 `AUDIT_EXIT=0`。

审计脚本本体未变：`md5sum /mnt/ssd/bio_data/ops/audit_figure_layout.py` = `4e0a6647efe8d02f605fdb75ad4b57f8`，
与台账 #190 修法记录的 `4e0a6647…` 一致；`--help` 确认 `--seed` 存在且 help 写明「必须与被审计项目的种子一致」。

## 3. 文件变更清单

本地（写入）：
- 新建 `cn_debug/figure_audit_sweep/audit_ml_hub_analysis.csv`（10 行，全 PASS；md5 `d06d37a8e557cf0771cb33be17b1652d`）
- 新建 `cn_debug/figure_audit_sweep/audit_ml_model.csv`（2 行，全 PASS；md5 `508ce6d5aaa7e999b05913896f96537c`）
- 新建 `cn_debug/figure_audit_sweep/audit_external_validation.csv`（1 行，PASS；md5 `098adffcdf785db0f2a85cfeeecffdbc`）
- 新建 `cn_debug/figure_audit_sweep/figure_audit_line1.before_S3.csv`（合并前备份，433 B，md5 `b88d85c3e013e1212cda4cb04eb388ce`）
- 新建 `cn_debug/figure_audit_sweep/s3_figure_score.log`（`figure_score.py` 完整输出留证）
- 新建 `cn_debug/figure_audit_sweep/S3_report.md`（本文件）
- **修改** `cn_debug/figure_audit_line1.csv`：14 行 → 27 行（追加 13 行，全部 PASS；CRLF 保持）

本地（未触碰）：`src/`、`ops/`、`docs/`、`workspace/handoff/archive/`、`cn_debug/figure_score.py`、`cn_debug/figure_code_audit.py`、`cn_debug/code_audit.csv`、`outputs/` 下所有图件与台账。

远端（仅 `/tmp` 临时文件，非仓库路径）：
- `/tmp/s3_figs_before.md5`（32 条）、`/tmp/s3_proc_before.md5`（45 条）、`/tmp/s3_proc_snapshot_19342/`（45 文件 6.2 MB 快照，供 diff）
- `/tmp/audit_{ml_hub_analysis,ml_model,external_validation}.csv`、`/tmp/s3_{ml_hub_analysis,ml_model,external_validation}.log`、`/tmp/s3_{figs,proc}_check.log`
- 审计自建 staging 残留：`/tmp/figaudit_root_*` 38 个、`/tmp/figaudit_shim_*` 115 个（含往轮遗留，未清理）

**远端 `projects/` 的副作用（唯一一处，报告类）**：`processed/ml_hub_report.txt` 第 36 行 `elapsed_seconds=7.3 → 4.8`；
其余 44 个文件 md5 全部未变，无新增/消失文件（`comm` 双向无输出）。

## 4. 接口与交互实现说明

- 审计 CLI 契约未变：`--script <绝对路径> --cwd <相对> --runner bash --seed 20261013 --csv /tmp/audit_<step>.csv`；
  退出码 0=全 PASS。
- `--runner bash` 走真脚本：`run_bash()` 把 `cmd` 拼成 `bash <script> --seed <seed> --output ../figures` + `derive_inputs()` 反推的 `--input`，
  在 `_stage_dir(cwd)` 建的临时树里执行；`figures/`、`results/` 用空目录顶替，`references/`、`raw_data/` 软链。
- `derive_inputs()` 对三个脚本均命中：`expr_genes.tsv` / `group_map.tsv` / `key_genes.tsv` / `deg_all.tsv`，
  因此 3 个步骤都在 staging 里真跑通（日志可见 `samples=16 features=10`、`AUC=0.703`、`holdout AUC=1.000` 等）。
- **写穿软链仍存在**（S2 §7 未修）：`ml_hub_analysis` 的 13 个 `ml_*.tsv` 与 `ml_hub_report.txt` mtime 被更新为 10:26–10:27，
  证明产物写回真实 `processed/`；本轮因 `--seed 20261013` 与正本一致，除 `elapsed_seconds` 外字节全同。
- CSV schema 与既有 `figure_audit_line1.csv` 一致（`figure,verdict,violations`），可直接喂 `figure_score.py --audit-csv`。

## 5. 测试与验证记录

### 5.1 A1 链路自检（PASS）

```
$ adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022
forward_exit=0
$ ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu 'echo OK; hostname; date -u'
OK
localhost
Mon Oct 19 10:25:35 UTC 2026
```

### 5.2 A3 基线（审计前一次建立）

```
$ cd .../line1_bulk/figures   && find . -type f -exec md5sum {} + | sort -k2 > /tmp/s3_figs_before.md5   → 32 行
$ cd .../line1_bulk/processed && find . -type f -exec md5sum {} + | sort -k2 > /tmp/s3_proc_before.md5   → 45 行
$ cp -a processed/. /tmp/s3_proc_snapshot_19342/                                                        → 45 文件 6.2M
$ grep -H "^seed=" processed/*_report.txt
deg_report.txt:seed=20261013 / enrichment_report.txt:seed=20261013 / key_genes_report.txt:seed=20261013
ml_hub_report.txt:seed=20261013 / pca_report.txt:seed=20261013 / ppi_report.txt:seed=20261013
prep_report.txt:seed=20261013 / qc_report.txt:seed=20261013 / wgcna_report.txt:seed=20261013
```

### 5.3 A2 + A3 逐脚本（3/3 exit 0）

**① ml_hub_analysis**

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/line1_bulk/ml_hub_analysis \
  --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
  --runner bash --seed 20261013 --csv /tmp/audit_ml_hub_analysis.csv'
```
输出尾 3 行（`AUDIT_EXIT=0`）：
```
PASS l1_24_corr_network.png
audit: figs=10 fail=0 write=False
audit-csv: /tmp/audit_ml_hub_analysis.csv (10 图)
```
md5 前后：`FIG_OK=32 FIG_FAILED=0` / `PROC_OK=44 PROC_FAILED=1`
FAILED 明细（1 个，报告类）：
```
=== ml_hub_report.txt ===
36c36
< elapsed_seconds=7.3
---
> elapsed_seconds=4.8
```
新增/消失文件：`comm -13` 与 `comm -23` 均无输出（`processed/` 45 个文件集合不变；`figures/` 仍 32 张）。

**② ml_model**

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/line1_bulk/ml_model \
  --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
  --runner bash --seed 20261013 --csv /tmp/audit_ml_model.csv'
```
输出尾 3 行（`AUDIT_EXIT=0`）：
```
PASS l1_11_ml_importance.png
audit: figs=2 fail=0 write=False
audit-csv: /tmp/audit_ml_model.csv (2 图)
```
md5 前后：`FIG_OK=32 FIG_FAILED=0` / `PROC_OK=44 PROC_FAILED=1`
FAILED 明细：仍是 ① 的 `ml_hub_report.txt`（diff 与 ① 逐字相同），**本步自身零字节变化**（该步产物 `ml_feature_importance.tsv` / `ml_report.txt` 是新建文件，落在 staging，未写穿真目录）。

**③ external_validation**

```
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/line1_bulk/external_validation \
  --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
  --runner bash --seed 20261013 --csv /tmp/audit_external_validation.csv'
```
输出尾 3 行（`AUDIT_EXIT=0`）：
```
      INFO tick 标签越出画布 axes0 '1.2'（tight 裁切可容纳）
audit: figs=1 fail=0 write=False
audit-csv: /tmp/audit_external_validation.csv (1 图)
```
md5 前后：`FIG_OK=32 FIG_FAILED=0` / `PROC_OK=44 PROC_FAILED=1`（仍只有 ① 那一行）
审计后复核 `seed=` 行：9 份报告全部 `seed=20261013`（**#190 未复发**）。

### 5.4 A4 合并后 `figure_audit_line1.csv`

- 合并来源：既有 14 行 + `audit_bulk_figures`(9) + `audit_key_genes`(1) + `audit_ml_hub_analysis`(10) + `audit_ml_model`(2) + `audit_external_validation`(1) + `audit_pca_matrix`(0) + `audit_deg_limma`(0)
- 同名覆盖方向：审计 CSV 覆盖既有行（10 个重名项两处均为 `PASS`，覆盖为无差异操作）
- **结果：27 行数据（+1 表头 = 28 行），PASS=27，FAIL=0**（`grep -c ",PASS," = 27`、`grep -c ",FAIL," = 0`）

### 5.5 A5 `figure_score.py` 尾部 3 行（原文）

```
$ python cn_debug/figure_score.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures \
    --audit-csv cn_debug/figure_audit_line1.csv --code-csv cn_debug/code_audit.csv \
    --ledger-dir outputs/system_logs
UNVERIFIED  80.0 l1_30_wgcna_sample_tree.png          B1?,B2?,B3?,B4?
UNVERIFIED  80.0 l1_31_wgcna_mm_gs.png                B1?,B2?,B3?,B4?
score: figs=33 PASS=11 FIX=0 FAIL=0 UNVERIFIED=22 avg=89.6 threshold=75
```
`SCORE_EXIT=1`（因 `UNVERIFIED=22`，非 FAIL）。完整输出留证：`cn_debug/figure_audit_sweep/s3_figure_score.log`。

### 5.6 A6 跳过清单与异常

**跳过的脚本（及理由）**

| 脚本 | 理由 |
|---|---|
| `ppi_string`（`l1_07`/`l1_08`） | 派发单硬性禁止：每次重取 STRING API，不可复现，且会改写 `ppi_edges.tsv`/`ppi_hubs.tsv` 交付表 |
| `enrichment_figures`（`l1_13/14/15/25`） | 判决已在既有 `figure_audit_line1.csv`（S2 前完成），本轮按派发单直接沿用 |
| `pca_matrix` / `deg_limma` / `wgcna_modules` | R 出图，几何审计 `figs=0`（S2 已实证、计划书 §0 缺口 1 已登记），R 侧判决方案待主 Agent 决策 |
| `cox_analysis` / `prep_matrix` / `qc_matrix` / `enrichment_bulk` / `probe_env` | 本切片未派发；`cox_analysis` 在 `figures/` 下无对应 PNG（源码扫描有 `C4_TINY_CEX` 记录但无交付图件），不属本轮范围 |

**异常/发现（须主 Agent 知悉）**

1. **`l1_10_ml_roc.png` / `l1_11_ml_importance.png` / `l1_12_external_roc.png` 在远端与本地 `figures/` 均不存在**
   （远端 32 张、本地 33 张，`grep -c "l1_1[012]"` = 0；`processed/` 也无 `ml_report.txt` / `external_*`）。
   → `ml_model` / `external_validation` 这两个步骤在本项目运行中**没有产出交付图件**；本轮 3 行 PASS 是
   「脚本能出合规图」的证据，**不是**「交付图件合规」的证据。对打分无影响（`figure_score.py` 只遍历 `--dir` 里的实际文件）。
2. **台账归因缺口（22 个 UNVERIFIED 的真实构成）**：
   - `ml_hub_analysis` 台账 `io_files.output = []` → 10 张 ml 图 `D2?/D3?` 无归因；
   - `bulk_figures` 台账 `io_files.output` 只登记 6/9 张（缺 `l1_03_volcano_fdr` / `l1_05b_within_group_cor` / `l1_06_ma_fdr`）→ 3 张 `D2?/D3?`；
   - R 图 6 张（`l1_02_pca_step3`、`l1_03_volcano_limma`、`l1_28~l1_31`）`B1?~B4?`；
   - 陈旧图 `l1_27_wgcna_mm_gs.png` 1 张（远端已无，本地残留，FE-017 未修）；
   - 禁跑的 `l1_07`/`l1_08` 2 张。
   合计 10+3+6+1+2 = 22，与 `UNVERIFIED=22` 对齐。
3. `ml_hub_analysis` 审计触发了 `_stage_dir` 写穿：13 个 `ml_*.tsv` mtime 变 10:26–10:27，但 md5 全同（`PROC_OK=44` 覆盖），
   即真种子下产物确定性成立；唯一字节变化是报告里的 `elapsed_seconds`。

## 6. 视觉审查

**不适用 / 未做**：本轮是机器几何审计（`B1~B4` 判定轴内标注、图例、图注、重叠），未打开任何 PNG 目视，
因此不对美观性、配色、信息层级下任何结论；`l1_10/11/12` 因图件不存在更是无法审图。

## 7. 假设与风险

1. 「`elapsed_seconds` 漂移可接受」依据派发单与 #190 备注（报告类、seed 行不变、数据表字节不变）；若主 Agent 要求报告字节级可复现，需另行回写快照。
2. 写穿软链缺陷未修（S2 §7.1 建议仍在队列）。本轮安全**只因**种子与正本一致且脚本确定性；若换成含随机性步骤（置换检验类），同样操作会真改数据。
3. `l1_10/11/12` 缺图说明这两个步骤在项目里没跑成/未登记；本轮无法判断是流水线未调度还是产物被清理（未验证）。
4. 打分 `PASS=11` 未达计划书 Step 2 目标（`FAIL=0 UNVERIFIED=0`），缺口全在台账归因与 R 判决方案，不在本轮审计覆盖的 13 张图上。
5. 未执行 `git status`/`git diff`（本机工作区非 git 仓库/派发单禁止 git 动作），「未改其他文件」的依据是本轮写入清单可枚举。

## 8. 架构/接口变更建议（我不改 ops/，交主 Agent）

1. **台账补登记**（不改代码即可解掉 13 个 UNVERIFIED）：让 `ml_hub_analysis` 与 `bulk_figures` 的 `io_files.output` 登记全部图件路径；
   或让 `figure_score.load_code_findings()` 在「台账无记录」时按图名前缀回退匹配 step。
2. `_stage_dir()` 改「小文件复制 + 大文件软链」或「staging 内只读 + 空文件占位」，让写穿变显式报错（S2 §7.1 原建议，仍未落地）。
3. `run_bash()` 加污染守卫：跑前后对 `--cwd` 做 md5 快照，有变化打印清单并以退出码 2 失败（S2 §7.2）。

## 9. 待主 Agent 决策事项

1. **派发单内部冲突（已按第 5 项执行并留退路）**：硬性禁止条写「唯一允许写入 `cn_debug/figure_audit_sweep/` 下的 CSV 与一份 S3_report.md」，
   而任务项 5 要求「合并为一份 `cn_debug/figure_audit_line1.csv`」。我按任务项 5 写了该文件（14→27 行），
   并在写入前备份为 `cn_debug/figure_audit_sweep/figure_audit_line1.before_S3.csv`（md5 `b88d85c3…` 与原文件一致）。
   若裁决为「不该动」，回滚命令：`cp cn_debug/figure_audit_sweep/figure_audit_line1.before_S3.csv cn_debug/figure_audit_line1.csv`。
   另：`s3_figure_score.log` 也落在该目录，超出「CSV + 一份 md」的字面许可，属证据留档，请裁决保留或删除。
2. **`ml_hub_report.txt` 的 `elapsed_seconds=7.3→4.8` 是否回写**：不回写则报告与 `deliverables` 副本不一致（数据表一致）。
   回写命令（本地快照即审计前字节）：`scp outputs/PRJ_E2E_GSE277173/line1_bulk/processed/ml_hub_report.txt k40-ubuntu:/mnt/ssd/bio_data/projects/PRJ_E2E_GSE277173/line1_bulk/processed/`
3. **`l1_10/11/12` 三张图缺失**：是否要重跑 `ml_model` / `external_validation` 补齐交付图件（会新建 `ml_report.txt`、`external_validation_report.txt`、`external_*tsv`），还是登记为「本项目未启用」。
4. 是否把台账归因缺口（§5.6 第 2 条）另立切片修，因为它是 `PASS=11/UNVERIFIED=22` 的最大单一原因（13/22）。

## 10. 建议下一步

1. 主 Agent 先裁决 §9 第 1、2 条（文件落点与报告回写），再决定是否把本轮 3 个 CSV 长期纳入打分导入清单。
2. 修台账 `io_files.output`（S2/S3 共同缺口）→ 预期 UNVERIFIED 从 22 降到 9（剩 R 6 张 + 陈旧图 1 张 + ppi 2 张）。
3. R 侧判决方案（计划书 §待决策 1）定案后，补 `l1_02_pca_step3` / `l1_03_volcano_limma` / `l1_28~l1_31` 共 6 张。
4. 清理 `l1_27_wgcna_mm_gs.png` 本地陈旧图（FE-017），使本地/远端图件集合一致（33→32）。
