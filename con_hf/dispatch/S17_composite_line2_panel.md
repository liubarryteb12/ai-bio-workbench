[派发单 · 切片 S17] 子 Agent 任务：line2 首张组合图 `l2_20_composition_panel.png`（Step 5 第二单）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
     的「Step 5 组图契约」G1–G5
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S16_composite_deg_overview.md
     与 `con_hf/dispatch/S16_report.md`（**line1 同题已完成，是你的写法范本**，
     特别是 G1/G2 探针 `cn_debug/2026-10-20_verification_s16_g1g2.py` 的复用方式）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line2_scrna\scripts\scrna_figures
     （你只改这一个文件）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#196、#198、#199
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】Step 5 组图契约已定稿，S16 已完成 line1 首张组合图
（`l1_32_deg_overview.png`，四面板，G1/G2 探针全过）。本切片做 line2 首张组合图，
**只改 `src/line2_scrna/scripts/scrna_figures`**，跑场用 **`default` 项目**
（`projects/default/line2_scrna/processed` 有真实数据；PRJ_E2E 没有 line2 数据）。

【主 Agent 已定死的图规格（不许自行更改）】

- 图名：`l2_20_composition_panel.png`（G3：line2 现到 19，从 20 起；语义用 `panel`）
- 三个面板（G1 编号 A/B/C）：
  - **A** = `l2_05_composition_stack`（细胞组成堆叠条形）
  - **B** = `l2_06_composition_box_basal_keratinocyte`（代表性细胞类型的组成箱线，
    带 `perm_p` 括号——S10 已实现的标注）
  - **C** = `l2_01_umap_celltype`（细胞类型 UMAP）
- 布局：横版（宽≥高），`GridSpec` 或 `subplot_mosaic`（**不引 patchwork**，G4），
  figsize 按内容量定且不小于成员单图的较大者。
- G2 共享图例：
  - 细胞类型色码（UMAP 与堆叠图共用）在图组**下方居中**只画一次（横排、
    `frameon=False`、带语义标题如 `cell type`）；A/C 面板内**不得**重复画同一组图例。
  - **分面例外（G2 明文）**：箱线面板 B 是单轴图，其组别图例（Healthy/Psoriasis）
    若需保留，按单图规则处理，但**不得与共享图例混排**。
  - 细胞类型 >12 时按列分组（每列 ≤12 行，沿用脚本既有 `legend_out` 规则）。
- 图注：图组级 caption 一条一行（§三之二），至少含：图名语义、三个面板各是什么、
  输入产物（`scrna_deg.h5ad` / `celltype_composition.tsv` / `composition_report.txt`）、
  样本/供体数、`perm_p` 口径说明（来自 `uns["composition"]["group_tests_json"]`）。
- **单图必须继续出**：`l2_05_composition_stack.png`、
  `l2_06_composition_box_basal_keratinocyte.png`、`l2_01_umap_celltype.png` 一张不能少。
- caption 登记：`BioanalysDesktop/server/figures.js` 加一条 `l2_20_composition_panel`
  的 match（**只加这一条**）。

【任务项】
1. 读 `scrna_figures`，确认三个面板的数据与绘制函数可复用（**不重算统计量**；
   `perm_p` 必须来自既有 `uns` 字段，S10 已实现）。
2. 实现组合图（按上面规格），复用脚本内 `caption`/`save`/guard 收口；
   组合图落盘前显式走脚本里已有的等价收口逻辑，并在回报里说明调用了什么。
3. `figures.js` 加 `l2_20_composition_panel` caption 条目（只加一条）。
4. 本地自检：`python cn_debug/figure_code_audit.py --root src` → `no issue found`
   （#196 后 C2 命名判据允许大写与点号，但别引入轴内图例）。
5. 部署：`pwsh -NoProfile -Command "ops/06_deploy_scripts.ps1 -Line line2_scrna -Force"`
   （用 `-Command` 形式，`-File` 会被运行时拦），核对远端 md5 与本地一致。
6. 重跑：`/api/tasks/submit`，`projectId=default`、`lineId=line2_scrna`、
   `step=scrna_figures`、`seed=20261018`（**注意：与磁盘版本同种子，见 #199 的同类逻辑——
   default 项目 line2 产物是 20261018 算的，传 20261013 会改数**）、
   `inputs` 用 `projects/default/line2_scrna/processed/scrna_deg.h5ad`
   （照 `cn_debug/s10_submit.json` 的 inputs，不要自己猜），`outputs` 声明本步全部产物
   （含新增 `l2_20`）。贴台账 status/exit_code/checkpoint_status/error_log/io_files.output 长度。
7. 回搬：`pwsh -NoProfile -Command "ops/07_pull_outputs.ps1 -Project default -Line line2_scrna"`。
8. 验证（全部真跑，贴原文）：
   - `python cn_debug/figure_audit_scan.py --dir outputs/default/line2_scrna/figures`
     → `l2_20` 必须 PASS
   - 几何审计（真渲染判决）：
     ```
     ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
       --script /mnt/ssd/bio_data/bin/line2_scrna/scrna_figures \
       --cwd projects/default/line2_scrna/processed \
       --runner bash --seed 20261018 --csv /tmp/s17_audit.csv'
     ```
     → `l2_20` 的 A–E 必须全 PASS。**#190 纪律**：跑前对 `processed/` 与 `figures/`
     建 md5 基线，跑后逐项比对；数据表必须逐字节一致，报告只许 `elapsed_seconds` 变化。
   - `python cn_debug/figure_score.py --dir outputs/default/line2_scrna/figures \
       --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
       --src-root src --ledger-dir outputs/system_logs`
     → `l2_20` 必须 PASS 且 C1/C2 命中；判决合并进 `figure_audit_all.csv`（先备份）。
   - **G1/G2 探针**：把 S16 的 `cn_debug/2026-10-20_verification_s16_g1g2.py`
     适配到本图（三面板 A/B/C；line2 图名前缀 `l2_20_`），或另写探针但**必须含负对照**：
     ① A/B/C 编号存在且在各面板左上角外侧；② 共享图例只出现一次（图组下方居中），
     其余面板区域无重复图例；③ 负对照：故意重复画一次图例/去掉编号，探针必须变红。
     探针取不到就写「未验证」，**不许推断**。
   - 单图回归：`l2_05_composition_stack` / `l2_06_composition_box_basal_keratinocyte` /
     `l2_01_umap_celltype` 三张必须仍在且 PASS。
9. **每完成一步就更新一次 `con_hf/dispatch/S17_report.md`**（硬要求，前车之鉴）。

【硬性禁止】
- 禁止改 `src/` 下其他文件、`ops/`、`build_client_report.py`、模板四件套、portal。
- 禁止删或弱化任何既有单图；禁止改统计口径、阈值、`perm_p` 数据来源。
- **禁止传 `--seed 20261013`**（会改 default 项目 line2 的交付数值，#199 同族）。
- 禁止引入 patchwork / 新依赖；禁止 `--write`；禁止改 `--runner`。
- 禁止在未建 md5 基线前跑 `--runner bash` 审计。
- 禁止把"应该合规"写成已验证；G1/G2 判据必须实际测。

【验收标准】
A1 `l2_20_composition_panel.png` 生成，三面板 A/B/C 与规格一致。
A2 G1/G2 探针通过（含负对照变红证据），或明确未验证 + 原因。
A3 单图 3 张仍在且 PASS；`figure_audit_scan` 全 PASS 含 `l2_20`。
A4 几何审计 `l2_20` A–E 全 PASS；基线对比表证明数据表零变化。
A5 `figure_score` 里 `l2_20` PASS 且 C1/C2 命中；已合并进 `figure_audit_all.csv`。
A6 台账 completed/exit 0/passed；`code_audit` no issue。
A7 `figures.js` 只新增一条 caption，既有条目未动。
A8 `seed=20261018` 的证据（台账或报告行），且未改任何交付数值。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
