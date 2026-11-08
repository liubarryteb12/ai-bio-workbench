[派发单 · 切片 S9] 子 Agent 任务：bulk_figures 的 F2 色值统一 + F3 硬编码组名修复

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S5_scout_report.md
     （§7-F2 色值不统一、§7-F3 硬编码组名——本切片的输入）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\docs\figure_spec.md §三（配色基线）与 §八.2（禁止硬编码组名）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#194
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】用户 2026-10-19 决策 #3：修复 F2/F3。本切片只做 **line1 的 `src/line1_bulk/scripts/bulk_figures`**
（有真实数据 `projects/PRJ_E2E_GSE277173`，可端到端验证）。
line2 的 `scrna_figures`（S5-17 标 p 值 + F2 色值）留给下一切片，**你绝对不要碰 scrna_figures**。

【要修的两处（scout 已定位）】
- **F2**：`bulk_figures:256` `GCOLOR = {"LS": "#C44E52", "NLS": "#4C72B0"}`。
  规范 §三 / §八.5 的二分类标准色是 case=`#EE0000`、ctrl=`#3B4992`（R 侧 pca_matrix/deg_limma 已合规）。
- **F3**：同行的组名 `"LS"`/`"NLS"` 硬编码；`365`、`393` 轴标签 `"log2FC (LS vs NLS)"` 硬编码。
  规范 §八.2 要求组名从 `group_map.tsv` 与 `project.json` 读。**实害**：换项目后
  `GCOLOR.get(g, "gray")`（302 行）把所有组画成灰色且不报错——静默降级。

【主 Agent 已定死的修法（不许自行更改）】
1. **case/ctrl 方向来源**：按 §八.1，case/ctrl 优先取 `project.json` 的
   `grouping_design.contrasts`（`is_primary` 或第一条），读不到再按
   `grouping_design.groups[].is_reference`，再读不到按 group_map 两组的字典序派生
   （后者为 case），并在 stdout 打印派生了什么。**拒绝猜测**：组数不是 2 且无 contrasts 契约时要
   像 wgcna_modules 那样直接失败并说明（ exit 非 0 ），不许静默用第一组。
2. **配色**：case=`#EE0000`、ctrl=`#3B4992`；多于 2 组时多余组用 seaborn 定性色板
   （colorblind 友好，取 `tab20` 起的子集，跳过已用的两个标准色）。
   `GCOLOR` 改为运行时按实际组名构建（不得保留写死的组名键）。
3. **轴标签**：`"log2FC (%s vs %s)"` 用运行期拿到的 case/ctrl 名格式化。
4. **静默降级必须消除**：任何组名拿不到颜色时要 `raise`/明确报错，不许 `.get(g, "gray")`。
5. 只许改 bulk_figures 的"取色与标签"相关代码，**禁止改统计口径、阈值、种子、图件命名、
   出图数量、任何计算逻辑**。

【任务项】
1. 链路自检 + 建基线：远端 `processed/` 与 `figures/` 全量 md5（/tmp/s9_before*.md5）。
2. 改 `src/line1_bulk/scripts/bulk_figures`（按上面 5 条）。
3. 本地 `python cn_debug/figure_code_audit.py --root src` → 必须 `no issue found`
   （#194 后 C1 判据更严，别引入新的违规）。
4. 部署：`pwsh -NoProfile -File ops/06_deploy_scripts.ps1 -Line line1_bulk -Force`，
   并核对远端 `bin/line1_bulk/bulk_figures` md5 与本地一致。
5. 重跑 `bulk_figures`（走 `/api/tasks/submit`，seed=20261013，outputs 按实际产物声明），
   贴台账 status/exit_code/checkpoint_status/error_log/io_files.output 长度。
6. 回搬 + 三件套（贴尾行原文）：
   - `python cn_debug/figure_audit_scan.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures`
   - `python cn_debug/figure_score.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures --audit-csv cn_debug/figure_audit_line1.csv --code-csv cn_debug/code_audit.csv --ledger-dir outputs/system_logs`
7. **颜色正确性验证（必须做）**：从重渲染后的 `l1_02_pca.png` 里取两个分组的散点颜色，
   断言 case 组 = `#EE0000`(238,0,0)、ctrl 组 = `#3B4992`(59,73,146)。
   写法自定（PIL 取样 + 阈值匹配即可），探针脚本可留在 `cn_debug/`。
   若取不到就明确写"未验证"，**不许推断**。
8. 产出 `con_hf/dispatch/S9_report.md`（**每完成一步就写一次，不要等最后一次性写**——
   前三个切片都在临门一脚被宿主掐断导致报告全丢）。

【硬性禁止】
- 禁止改 `src/line2_scrna/scripts/*`（下一切片）与 `ops/build_client_report.py`、模板四件套。
- 禁止改统计/阈值/种子/图件命名/出图数量。
- 禁止把"应该对上"写成已验证；每个 md5、每个台账字段都要实际输出。
- 禁止在上一条没完成时就往下跑；失败就停下报阻断。

【验收标准】
A1 F2：`grep -n '#C44E52\|#4C72B0' src/line1_bulk/scripts/bulk_figures` 在 GCOLOR/取色处 0 命中
   （run 时构建的字典不再出现写死的旧色值）。
A2 F3：`grep -n '"LS"\|"NLS"' src/line1_bulk/scripts/bulk_figures` 0 命中。
A3 组名/方向来自 project.json 或派生，且有 stdout 证据（贴原文）。
A4 台账 completed/exit 0/passed，figures 数量不变（bulk_figures 仍是 9 张）。
A5 颜色断言通过（或明确未验证 + 原因）。
A6 三件套尾行原文；`code_audit` no issue。
A7 figures/ 前后 md5 表：必变（色值变了），列出每张图"已变"；processed/ 数据表必须不变。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
