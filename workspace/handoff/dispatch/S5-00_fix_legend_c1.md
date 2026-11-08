[派发单 · 切片 S5-00] 子 Agent 任务：修复 10 处源级轴内图例（C1 合规，图件应零变化）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#192、#193、#194
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\docs\figure_spec.md §三之二（图例外置）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。
本机 shell 是 git-bash；原生 Windows 工具用 D:/... 正斜杠路径。

【背景】主 Agent 刚修复 `cn_debug/figure_code_audit.py` 的 C1 漏检（#194），
现在能抓到源级轴内图例。真源码三线共 **10 处**：

| 文件 | 行 | 现状 |
|---|---|---|
| src/line1_bulk/scripts/bulk_figures | 316 | `ax.legend(title="group")` |
| src/line1_bulk/scripts/enrichment_figures | 280 | `ax.legend(handles=[Patch(...)], title=...)`（loc 跨行在后面） |
| src/line1_bulk/scripts/external_validation | 281 | `ax.legend()` |
| src/line1_bulk/scripts/ml_hub_analysis | 545 / 629 / 667 | 三处跨行 loc= 或无 loc |
| src/line1_bulk/scripts/ml_model | 298 / 325 | `ax.legend()` |
| src/line2_scrna/scripts/scrna_figures | 480 | `ax.legend(title="diagnosis")` |
| src/line3_spatial/scripts/spatial_figures | 387 | `ax.legend(markerscale=3, fontsize=8, ncol=2, frameon=False)` |

规范 §三之二要求"源级也不得写轴内 loc"。**注意**：这 10 处的交付图件目前几何上是合规的
（layout guard 在 savefig 前会把图例搬到轴框外，17 个脚本都装了 guard）。
所以本切片是**源级合规修复，预期图件 md5 不变**；若变了你必须解释并逐张核对。

【任务项】
1. 链路自检：adb forward 两条；`ssh k40-ubuntu 'echo OK'`。
2. 建基线（远端）：`processed/` 与 `figures/` 全量 md5 → /tmp/s50_before.md5 与 /tmp/s50_before_fig.md5。
3. 逐文件修这 10 处：把图例调用改成**显式轴框外**，与本脚本 `legend_out()` 的定位规则一致：
   - 横版图（宽≥高）：`bbox_to_anchor=(0.5, -0.10)`，`loc="upper center"`
   - 竖版图（宽<高）：`bbox_to_anchor=(1.02, 1.0)`，`loc="upper left"`
   - `frameon=False`（去边框）；保留原有 title/handles/labels/fontsize/ncol 等参数
   - 判据：改完 `python cn_debug/figure_code_audit.py --root src` 必须 **0 条 C1**
4. 部署受影响线：`pwsh -NoProfile -File ops/06_deploy_scripts.ps1 -Line <line> -Force`（line1 必部，
   line2/line3 若改了 scrna_figures/spatial_figures 也要部）。
5. 重跑受影响步骤（**用 /api/tasks/submit，seed=20261013**，outputs 按实际产物声明），
   步骤清单：bulk_figures / enrichment_figures / external_validation / ml_hub_analysis /
   ml_model（line1）；line2/line3 的 scrna_figures、spatial_figures **本项目无数据，不要跑**
   （只改源码 + 部署 + 源码扫描，图件零变化由" guard 会搬图例"的机制说明，并在回报里标注未验证）。
6. 跑机器验收三件套并贴原文：
   - `python cn_debug/figure_code_audit.py --root src --csv cn_debug/code_audit.csv`
   - `python cn_debug/figure_audit_scan.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures`
   - `python cn_debug/figure_score.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures --audit-csv cn_debug/figure_audit_line1.csv --code-csv cn_debug/code_audit.csv --ledger-dir outputs/system_logs`
7. 产出 `con_hf/dispatch/S5-00_report.md`。

【硬性禁止】
- 禁止改任何统计口径、数据处理、阈值、随机种子；只许改图例调用的定位参数。
- 禁止用 `audit_figure_layout.py` 的 `--runner bash` 跑会被它真跑的脚本做验收（#190：会重写报告）；
  验收一律走 /api/tasks/submit + 上面三件套。
- 禁止删除文件、禁止动远端 raw_data 与 projects 数据、禁止装包、禁止连外网。
- 禁止在回报里写"应该不变"；每张图的 md5 对比结果必须逐张列出。

【验收标准】
A1 10 处全部修改，`figure_code_audit.py --root src` 的 C1 计数为 0。
A2 负/正对照仍成立：`python cn_debug/figure_code_audit.py --root cn_debug/figure_negctrl`
   → C1×2 + C4/C8/C9 各 1；`--root cn_debug/figure_negctrl/src/line1_bulk/scripts/good_fig` → no issue。
A3 重跑的后台账：每个步骤 status/exit_code/checkpoint_status/error_log/io_files.output 长度。
A4 figures/ 前后 md5 对比表：每张图标"未变/已变"，已变的必须附原因（如重跑导致
   report elapsed 变化不算图件变化）。
A5 三件套输出尾行原文。
A6 line2/line3 两个脚本的"改了源码但未渲染验证"必须显式标注为未验证，不得混入 PASS。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
