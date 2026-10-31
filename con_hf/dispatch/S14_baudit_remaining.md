[派发单 · 切片 S14] 子 Agent 任务：B 档剩余 4 个脚本的几何审计（12 图，P0 已裁决）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S13_line23_full_audit.md
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S13_report.md（§5.6 P0 事实）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#197
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【P0 裁决（主 Agent 已裁，你不必再判，按此执行）】

S13 在 `l2/target_gene_localization` 上命中停止条件并上报。主 Agent 实测复核后裁决：
**不是数据损坏，是 seed provenance 修复，接受**。证据链：
- 原产物 `localization_report.txt` 的 `seed=20261018`（本地回搬副本实测），
  而项目契约种子是 20261013（aims 铁律#3）:**原产物本身带错种子**；
- 用真种子重跑后仅 `seed=` 行变为 20261013，`scrna_localization.h5ad` 的
  `uns.localization.seed` 字段随之修正；
- 数值表 `target_gene_localization.tsv` / `_wide.tsv` 本地 vs 远端 md5 **逐字节一致**
  （`41552c34…` / `26d95584…`）:数字零变化。
- 存量同类问题还有 4 份报告带错种子：`l2/dr_post_report.txt`、`l2/gsva_report.txt`、
  `l3/deconv_report.txt`、`l3/dr_post_report.txt`（20261018）。它们会在本轮被顺手修对，
  **这属于修复，不是破坏**，不要因此停审。

【因此本切片的停止条件（替换 S13 的硬口径）】
差异**只能归因到 seed provenance** 才算通过：
- 允许：`*_report.txt` 的 `seed=` 行变化（20261018 → 20261013）；
  `.h5ad` 内 `uns.*.seed` 字段变化；`elapsed_seconds` 类计时行变化。
- **不允许（出现即停，上报 P0）**：任何 `.tsv` 数值表 md5 变化；任何 `.h5ad` 的
  `X`/`obs`/`var`/`obsm` 等内容变化；报告里除 `seed=`/计时行以外的任何行变化；
  新增或消失的文件。

【任务项】
1. 链路自检；核对本地 `src/line{2,3}*/scripts/*` 与远端 `bin/line{2,3}*/` md5 一致。
2. 对 `projects/default/line2_scrna`、`projects/default/line3_spatial` 的
   `processed/` 与 `figures/` 建全量 md5 基线（含 h5ad），存 /tmp/s14_before_*.md5。
3. 逐个审计剩余 4 个脚本（**`--seed 20261013`**，CSV 落 /tmp 后拉回本地
   `cn_debug/figure_audit_sweep/s14_<line>_<step>.csv`）：
   - `bin/line2_scrna/gsva_pathways`
   - `bin/line2_scrna/dr_post_analysis`
   - `bin/line3_spatial/celltype_annotation`
   - `bin/line3_spatial/dr_post_analysis`
4. 每个脚本跑后立即按上面的停止条件比对基线，输出对比表（对象/文件数/差异文件/差异行/
   归因分类）。
5. 合并全部 CSV（line1 既有 + S13 的 6 个 + 本轮 4 个）更新
   `cn_debug/figure_audit_all.csv`（同名后者覆盖并注明来源），贴出总判决数与 PASS/FAIL 计数。
6. 三线打分复跑（贴尾行原文）：
   ```
   python cn_debug/figure_score.py --dir outputs/<项目>/<线>/figures \
     --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
     --src-root src --ledger-dir outputs/system_logs
   ```
   （line1 用 PRJ_E2E_GSE277173，line2/line3 用 default。）
7. 把修复掉的 4 份错种子报告列成清单（文件、改前 seed、改后 seed、数值表是否一致）。
8. **每完成一个脚本就更新一次 `con_hf/dispatch/S14_report.md`**（硬要求）。

【硬性禁止】
- 禁止修改仓库任何文件（除 CSV 合并与报告）。
- 禁止改种子、改 `--runner`、加 `--write`；禁止审 A 档已审完的 6 个脚本（重复劳动）。
- 禁止把"应该没变"写成已验证；每个脚本的基线对比表都要实际输出。
- 禁止在未建基线前跑审计。

【验收标准】
A1 4 个脚本全部有命令原文 + `audit: figs=N fail=M` 尾行 + CSV 落本地。
A2 每个脚本的基线对比表，且每个差异都做了归因分类（provenance / 计时 / 其他）。
A3 零「其他」类差异（若有，已停下并上报）。
A4 合并后 `figure_audit_all.csv` 总判决数、PASS/FAIL 计数。
A5 三线打分尾行原文；UNVERIFIED 数量与原因（预期 line2/line3 的 B1?~B4? 清零）。
A6 4 份错种子报告的修复清单。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
