[派发单 · 切片 S18] 子 Agent 任务：line3 首张组合图 `l3_20_domain_panel.png`（Step 5 第三单）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
     的「Step 5 组图契约」G1–G5
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S16_composite_deg_overview.md
     与 `con_hf/dispatch/S16_report.md`（line1 同题已完成，是你的写法范本；
     G1/G2 探针 `cn_debug/2026-10-20_verification_s16_g1g2.py` 的复用方式）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S17_composite_line2_panel.md
     与 `con_hf/dispatch/S17_report.md`（line2 同题，若已完成可参考其探针适配）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line3_spatial\scripts\spatial_figures
     （你只改这一个文件；若实际出图脚本名不同，先读目录确认再动手，并在回报里说明）
  6) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#196、#198、#199、#200
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】Step 5 组图契约已定稿；S16 完成 line1 首张组合图（`l1_32_deg_overview.png`），
S17 在做 line2（`l2_20_composition_panel.png`）。本切片做 line3 首张组合图，
跑场用 **`default` 项目**（`projects/default/line3_spatial/processed` 有真实数据）。

【主 Agent 已定死的图规格（不许自行更改）】

- 图名：`l3_20_domain_panel.png`（G3：line3 现到 19，从 20 起；语义用 `domain`）
- 三个面板（G1 编号 A/B/C）：
  - **A** = 空间域/聚类散点（现有 `l3_01_*` 或等价的 spatial domain UMAP/散点图）
  - **B** = HE 形态学图（现有 `l3_02_*` 或等价的 H&E 图）
  - **C** = 各空间域的乳酸化评分差异（现有 `l3_03_*` 或等价的 score 箱线/小提琴图）
  - **先读脚本确认这三个面板对应的真实图名**，在回报里列出你选的实际图名与理由；
    若某面板在脚本里不存在，**停下来上报，不要自己造一个等价物**。
- 布局：横版（宽≥高），`GridSpec` 或 `subplot_mosaic`（**不引 patchwork**，G4），
  figsize 按内容量定且不小于成员单图的较大者。
- G2 共享图例：空间域色码（A 与 C 共用）在图组**下方居中**只画一次（横排、
  `frameon=False`、带语义标题如 `domain`）；A/C 面板内**不得**重复画同一组图例。
  分面例外（G2 明文）适用时按单图规则处理，但不得与共享图例混排。
  域数量 >12 时按列分组（每列 ≤12 行，沿用脚本既有 `legend_out` 规则）。
- 图注：图组级 caption 一条一行（§三之二），至少含：图名语义、三个面板各是什么、
  输入产物、样本数、评分算法口径（line3 用了哪套 score，从脚本读出来照写）。
- **单图必须继续出**：上面三个面板对应的三张单图一张不能少（组合图是新增不是替换）。
- caption 登记：`BioanalysDesktop/server/figures.js` 加一条 `l3_20_domain_panel`
  的 match（**只加这一条**）。

【任务项】
1. 读 `src/line3_spatial/scripts/`，确认出图脚本名与三个面板对应的真实图名，
   确认数据与绘制函数可复用（**不重算统计量**）。
2. 实现组合图（按上面规格），复用脚本内 `caption`/`save`/guard 收口；
   组合图落盘前显式走脚本里已有的等价收口逻辑，并在回报里说明调用了什么。
3. `figures.js` 加 `l3_20_domain_panel` caption 条目（只加一条）。
4. 本地自检：`python cn_debug/figure_code_audit.py --root src` → `no issue found`。
5. 部署：`pwsh -NoProfile -Command "ops/06_deploy_scripts.ps1 -Line line3_spatial -Force"`
   （用 `-Command` 形式，`-File` 会被运行时拦），核对远端 md5 与本地一致。
6. 重跑：`/api/tasks/submit`，`projectId=default`、`lineId=line3_spatial`、
   `step=<脚本名>`、`seed=20261018`（**与磁盘版本同种子**：default 项目 line3 产物
   是 20261018 算的，传 20261013 会改数，#199 同族）、`inputs` 用该步骤既有输入
   （从远端 `projects/default/line3_spatial/processed` 的实际文件确认，不要猜），
   `outputs` 声明本步全部产物（含新增 `l3_20`）。贴台账 status/exit_code/
   checkpoint_status/error_log/io_files.output 长度。
7. 回搬：`pwsh -NoProfile -Command "ops/07_pull_outputs.ps1 -Project default -Line line3_spatial"`。
8. 验证（全部真跑，贴原文）：
   - `python cn_debug/figure_audit_scan.py --dir outputs/default/line3_spatial/figures`
     → `l3_20` 必须 PASS
   - 几何审计（真渲染判决）：
     ```
     ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
       --script /mnt/ssd/bio_data/bin/line3_spatial/<脚本名> \
       --cwd projects/default/line3_spatial/processed \
       --runner bash --seed 20261018 --csv /tmp/s18_audit.csv'
     ```
     → `l3_20` 的 A–E 必须全 PASS。**#190 纪律**：跑前对 `processed/` 与 `figures/`
     建 md5 基线，跑后逐项比对；数据表必须逐字节一致，报告只许 `elapsed_seconds` 变化。
   - `python cn_debug/figure_score.py --dir outputs/default/line3_spatial/figures \
       --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
       --src-root src --ledger-dir outputs/system_logs`
     → `l3_20` 必须 PASS 且 C1/C2 命中；判决合并进 `figure_audit_all.csv`（先备份）。
   - **G1/G2 探针**：复用 S16/S17 的探针模式适配到本图（三面板 A/B/C、前缀 `l3_20_`），
     **必须含负对照**：① A/B/C 编号存在且在各面板左上角外侧；② 共享图例只出现一次
     （图组下方居中），其余面板区域无重复图例；③ 负对照：故意重复画一次图例/去掉编号，
     探针必须变红。取不到就写「未验证」，**不许推断**。
   - 单图回归：三个面板对应的三张单图必须仍在且 PASS。
9. **每完成一步就更新一次 `con_hf/dispatch/S18_report.md`**（硬要求，前车之鉴）。

【硬性禁止】
- 禁止改 `src/` 下其他文件、`ops/`、`build_client_report.py`、模板四件套、portal。
- 禁止删或弱化任何既有单图；禁止改统计口径、阈值、评分算法。
- **禁止传 `--seed 20261013`**（会改 default 项目 line3 的交付数值，#199 同族）。
- 禁止引入 patchwork / 新依赖；禁止 `--write`；禁止改 `--runner`。
- 禁止在未建 md5 基线前跑 `--runner bash` 审计。
- 禁止把"应该合规"写成已验证；G1/G2 判据必须实际测。
- 禁止把低风险假设（如"某面板应该是某张图"）当成事实；面板对应关系必须从脚本读出。

【验收标准】
A1 `l3_20_domain_panel.png` 生成，三面板 A/B/C 与规格一致，且面板图名选择有脚本依据。
A2 G1/G2 探针通过（含负对照变红证据），或明确未验证 + 原因。
A3 单图 3 张仍在且 PASS；`figure_audit_scan` 全 PASS 含 `l3_20`。
A4 几何审计 `l3_20` A–E 全 PASS；基线对比表证明数据表零变化。
A5 `figure_score` 里 `l3_20` PASS 且 C1/C2 命中；已合并进 `figure_audit_all.csv`。
A6 台账 completed/exit 0/passed；`code_audit` no issue。
A7 `figures.js` 只新增一条 caption，既有条目未动。
A8 `seed=20261018` 的证据（台账或报告行），且未改任何交付数值。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
