[派发单 · 切片 S18R] 子 Agent 任务：line3 首张组合图 `l3_{sp}_16_domain_panel.png`（S18 重派，主 Agent 已裁决）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
     的「Step 5 组图契约」G1-G5
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S18_composite_line3_panel.md
     （**本派发单取代它；S18 原单的 4 条假设已被实测证伪，不要参考其中的面板映射**）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S18_report.md
     （上一轮拒绝的理由，理解为何改规格）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S17_composite_line2_panel.md
     与 S16 报告（line1/line2 组图的写法范本 + G1/G2 探针复用）
  6) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line3_spatial\scripts\spatial_figures
     （你只改这一个文件）
  7) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#196、#199、#200
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【主 Agent 已裁决的事实（取代 S18 原单，全部来自实测）】
1. line3 图号形如 `l3_{mouse,human}_{01..15}_*`，**物种前缀是命名的一部分**
   （`src/line3_spatial/scripts/spatial_figures:241-250` 的 `pre = "l3_%s" % species`）。
   最大号段是 15（`l3_{sp}_15_deconv_composition`，出自 `celltype_annotation` 脚本），
   `spatial_figures` 自己的号段到 09。**新号从 16 起，逐物种各一张**。
2. **line3 不存在 H&E 形态图，也不存在"乳酸化评分"这个量**
   （`grep lr_score|lactyl|score` 在 spatial_figures 里 0 命中）。
   原单的 B/C 面板假设证伪，**不补新单图、不定义新口径**。
3. line3 磁盘产物种子证据指向 **20261013**（`processed/*_report.txt` 的 `seed=` 行）。
   派发纪律改为：**审计传 `--seed 20261013`**（与磁盘同源，属 provenance 一致）；
   重跑任务同样传 20261013。**这不是 #199 的 seed-sensitive 场景**:
   `spatial_figures` 是纯渲染步骤，种子只进 stdout 不进数值
   （S18 报告 §3.8-5 的结论），但仍须建 md5 基线验证这一点。

【主 Agent 已定死的图规格（方案甲，不许自行更改）】

- 图名：`l3_{species}_16_domain_panel.png`（mouse 与 human 各一张，共 2 张）
- 三个面板（G1 编号 A/B/C），**全部出自 `spatial_figures` 已有单图，零重算**：
  - **A** = `{sp}_01_domains_{sample}`（空间域图）: **样本选取规则见下**
  - **B** = `{sp}_07_domain_composition`（域组成）
  - **C** = `{sp}_08_target_gene_by_domain`（target gene 按域分布）
  - 面板图名与复用数组的对应关系，你必须先从脚本里读出来并在回报里贴依据；
    若某面板在脚本里找不到对应绘图代码，**停下来上报，不要造等价物**。
- **A 面板样本选取规则（主 Agent 定）**：mouse 取 `BH001`（mouse 图清单里
  domains 图共 11 个样本，按样本 ID 升序取第一个），human 取 `JBO014`
  （human domains 图 5 个样本，升序第一个）。这个规则只用于组图选样，
  不改任何单图。
- 布局：横版（宽≥高），`GridSpec` 或 `subplot_mosaic`（**不引 patchwork**，G4），
  figsize 不小于成员单图的较大者。
- G2 共享图例：空间域色码（A 与 C 共用）在图组**下方居中**只画一次（横排、
  `frameon=False`、带语义标题如 `spatial domain`）；A/C 面板内**不得**重复画同一组图例。
  域数量 >12 时按列分组（每列 ≤12 行，沿用脚本既有 `legend_out` 规则）。
  注意脚本里已有注释：mouse 域数可达 57，色板是 tab20+tab20b+tab20c 拼的 60 色:
  **共享图例必须沿用同一套色板与同一套域标签**，不许另建色板。
- 图注：图组级 caption 一条一行（§三之二），至少含：图名语义、三个面板各是什么、
  物种、输入产物、A 面板样本 ID 与选取规则。
- **单图必须继续出**：上面三张成员单图一张不能少（组合图是新增不是替换）。
- caption 登记：`BioanalysDesktop/server/figures.js` 加一条
  `l3_.*_16_domain_panel` 的 match（**只加这一条**；match 写法照既有物种变体条目的先例，
  先读文件确认有没有类似 `l3_{sp}_xx` 的写法，没有就用等价正则）。

【任务项】
1. 读 `spatial_figures`，贴出三个面板对应的绘图代码行号与可复用数组（模块级作用域），
   确认零重算可行。
2. 实现组合图（按上面规格），复用脚本内 `caption`/`save`/`layout_fix`/guard 收口；
   组合图落盘前显式走脚本里已有的等价收口逻辑，并在回报里说明调用了什么。
3. `figures.js` 加 caption 条目（只加一条）。
4. 本地自检：`python cn_debug/figure_code_audit.py --root src` → `no issue found`。
5. 部署：`pwsh -NoProfile -Command "ops/06_deploy_scripts.ps1 -Line line3_spatial -Force"`
   （用 `-Command` 形式，`-File` 会被运行时拦），核对远端 md5 与本地一致。
6. **建 md5 基线**（#190 纪律）：`projects/default/line3_spatial/` 下 `processed/`
   与 `figures/` 全量 md5，存 `/tmp/s18r_before.md5`，贴文件数。
7. 重跑：`/api/tasks/submit`，`projectId=default`、`lineId=line3_spatial`、
   `step=spatial_figures`、`seed=20261013`、`inputs` 与 `outputs` 从远端
   `projects/default/line3_spatial/processed` 的实际文件与该步骤既有 spec 确认
   （**不要猜**；可参考 `cn_debug/` 下 line3 的既有 submit JSON，若没有就照台账里
   该步骤的 io_files 反推），`outputs` 必须含新增的 2 张组合图。
   贴台账 status/exit_code/checkpoint_status/error_log/io_files.output 长度。
8. 跑后立刻比对基线：数据表必须逐字节一致；`*_report.txt` 只许 `elapsed_seconds`
   计时行变化（seed 行应仍为 20261013，即不变）；`figures/` 下**只允许新增 2 张组合图**，
   其余 69 张 md5 一个不许变。出现不符合上述归因的差异 → 立即停，上报 P0 并附差异。
9. 回搬：`pwsh -NoProfile -Command "ops/07_pull_outputs.ps1 -Project default -Line line3_spatial"`。
10. 验证（全部真跑，贴原文）：
    - `python cn_debug/figure_audit_scan.py --dir outputs/default/line3_spatial/figures`
      → 2 张新图必须 PASS，且总 figs 应为 71
    - 几何审计（真渲染判决，`--seed 20261013`）：
      ```
      ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
        --script /mnt/ssd/bio_data/bin/line3_spatial/spatial_figures \
        --cwd projects/default/line3_spatial/processed \
        --runner bash --seed 20261013 --csv /tmp/s18r_audit.csv'
      ```
      → 2 张新图的 A-E 必须全 PASS；**跑前再建一次基线**，跑后同样逐项比对
      （审计不带 `--write`，数据表仍须逐字节一致）。
    - `python cn_debug/figure_score.py --dir outputs/default/line3_spatial/figures \
        --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
        --src-root src --ledger-dir outputs/system_logs`
      → 2 张新图必须 PASS 且 C1/C2 命中；判决合并进 `figure_audit_all.csv`（先备份）。
    - **G1/G2 探针**：复用 S16/S17 的探针模式适配到本图（三面板 A/B/C、
      前缀 `l3_{sp}_16_`），**必须含负对照**：① A/B/C 编号存在且在各面板左上角外侧；
      ② 共享图例只出现一次（图组下方居中），其余面板区域无重复图例；
      ③ 负对照：故意重复画一次图例/去掉编号，探针必须变红。
      取不到就写「未验证」，**不许推断**。mouse 域多（可能 57），探针要能处理多色图例。
    - 单图回归：`{sp}_01_domains_{sample}` / `{sp}_07_domain_composition` /
      `{sp}_08_target_gene_by_domain` 三张单图（mouse+human 共 6 张）必须仍在且 PASS。
11. **每完成一步就更新一次 `con_hf/dispatch/S18R_report.md`**（硬要求）。

【硬性禁止】
- 禁止改 `src/` 下其他文件、`ops/`、`build_client_report.py`、模板四件套、portal。
- 禁止删或弱化任何既有单图；禁止改统计口径、阈值、色板、域标签。
- **禁止新造 H&E 图或"乳酸化评分"图**（这两个量在 line3 不存在，#199 同族的造口径禁止）。
- 禁止引入 patchwork / 新依赖；禁止 `--write`；禁止改 `--runner`。
- 禁止在未建 md5 基线前跑 `--runner bash` 审计或提交任务。
- 禁止把"应该合规"写成已验证；G1/G2 判据必须实际测。
- 禁止把低风险假设当事实；面板映射、样本选取、inputs/outputs 都必须有脚本或台账依据。

【验收标准】
A1 2 张 `l3_{sp}_16_domain_panel.png` 生成，三面板 A/B/C 与规格一致，面板映射有脚本依据。
A2 A 面板样本为 mouse=BH001 / human=JBO014，回报里贴选取规则的执行证据。
A3 G1/G2 探针通过（含负对照变红证据），或明确未验证 + 原因。
A4 单图 6 张仍在且 PASS；`figure_audit_scan` 全 PASS 且总 figs=71。
A5 几何审计 2 张新图 A-E 全 PASS；两次基线对比都证明数据表零变化、69 张旧图零变化。
A6 `figure_score` 里 2 张新图 PASS 且 C1/C2 命中；已合并进 `figure_audit_all.csv`。
A7 台账 completed/exit 0/passed；`code_audit` no issue。
A8 `figures.js` 只新增一条 caption，既有条目未动。
A9 `seed=20261013` 的证据（台账或报告行）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
