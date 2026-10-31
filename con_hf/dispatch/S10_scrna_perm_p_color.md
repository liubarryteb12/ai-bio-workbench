[派发单 · 切片 S10] 子 Agent 任务：scrna_figures 的 S5-17（箱线标 perm_p）+ F2（标准二分类色）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S5_scout_report.md
     （§3.2 scrna_figures 的 S5-17 与 S5-10、§7-F2/§7-F3）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S9_fix_color_groupname.md
     （line1 同题已完成的实现，是你的写法范本:**沿用它的 resolve_case_ctrl 思路**）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#193、#194
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。
本机 shell 是 git-bash；原生 Windows 工具用 D:/... 正斜杠路径。

【背景】用户 2026-10-19 决策 #2（S5-17 做）与 #3（F2/F3 修复）。S9 已完成 line1 的
`bulk_figures`（F2 色值 + F3 组名）。本切片做 **line2 的 `src/line2_scrna/scripts/scrna_figures`**
对应部分，跑场用 **`default` 项目**（`projects/default/line2_scrna/processed` 有真实历史数据；
`PRJ_E2E_GSE277173` 没有 line2 数据，别用）。

【任务项】（只做这两件，都只在 scrna_figures 内）
1. **F2 色值统一**（scout §7-F2）：
   - 箱线面色（约 L352）：`#4C72B0` / `#C44E52` → 标准色 ctrl `#3B4992` / case `#EE0000`
   - PCA 点色（约 L468）：同样替换
   - 方向（谁是 case/ctrl）必须从 `project.json` 的 `grouping_design.contrasts` 读，
     读不到按 S9 已落地的 `resolve_case_ctrl` 同款规则派生（is_reference → 两组字典序，
     后者为 case → 组数异常直接失败）。**禁止写死组名**。
   - `default` 项目的 grouping_design 主 Agent 已确认只有 groups/contrasts 之外的字段，
     line2 的 contrasts 以 project.json 实际内容为准；读不到就按规则派生并在 stdout 打印。
2. **S5-17 箱线标 perm_p**（scout §3.2 / §5-P2-S5-17）：
   - 数据来源：`uns["composition"]["group_tests_json"]`（`scrna_composition` 写入，n=3 vs 5，
     `perm_p=0.03509` 等已算好）:**不要自己重算统计**。
   - 只对有 `perm_p` 的 celltype 画括号 + 文本；无值时静默不画且不报错。
   - 文本数值必须与 `composition_report.txt` 里的 `perm_p` 逐值一致（写一次性断言比对，不落盘）。
   - 括号文字极易触发 A 项出框（audit 的 A 判据），靠 `fit_text_edges` 兜底，必须实测。
3. 部署：`pwsh -NoProfile -File ops/06_deploy_scripts.ps1 -Line line2_scrna -Force`，核对远端 md5。
4. 重跑：`/api/tasks/submit`，`projectId=default`、`lineId=line2_scrna`、`step=scrna_figures`、
   `seed=20261013`（inputs 用该线 processed 目录），贴台账 status/exit_code/checkpoint/error_log/outputs 长度。
5. 回搬 default 项目 line2 图件到本地（`ops/07_pull_outputs.ps1 -Project default -Line line2_scrna`）。
6. 验证（全部真跑，贴原文）：
   - `python cn_debug/figure_code_audit.py --root src` → `no issue found`
   - `python cn_debug/figure_audit_scan.py --dir outputs/default/line2_scrna/figures`
   - 几何审计（真渲染判决）：`ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py --script /mnt/ssd/bio_data/bin/line2_scrna/scrna_figures --cwd projects/default/line2_scrna/processed --runner bash --seed 20261013 --csv /tmp/audit_scrna.csv'`
     → 13 张 `l2_06_*` 的 CSV 逐行贴出；A-E 全 PASS 才算过
     （注意 #190：这会真跑脚本并重写报告，跑前先做 processed/ 与 figures/ 的 md5 基线，跑后逐项对比，
     数据表 md5 必须不变、`*_report.txt` 只允许 elapsed 行变）
   - 颜色断言：从重渲染的组成图/PCA 图里取像素，断言 ctrl `#3B4992`(59,73,146) 与
     case `#EE0000`(238,0,0) 存在、旧色值 `#4C72B0`/`#C44E52` 为 0
   - 确定性：同 seed 连跑两次，13 张 md5 逐一相同（验证 jitter 种子固定）
7. **每完成一步就写一次 `con_hf/dispatch/S10_report.md`**（前三个切片都在最后一次性写时被宿主掐断，
   报告全丢；本条是硬要求）。

【硬性禁止】
- 禁止改 `src/line1_bulk/`、`src/line3_spatial/`、`ops/build_client_report.py`、模板四件套、portal。
- 禁止自己重算任何统计量、改阈值、改种子、改图件命名。
- 禁止把"应该一致"写成已验证；每个 md5、台账字段、像素计数都要实际输出。
- 禁止在没做 md5 基线前跑 `audit_figure_layout.py --runner bash`（#190）。

【验收标准】
A1 `grep -nE '#4C72B0|#C44E52' src/line2_scrna/scripts/scrna_figures` 0 命中。
A2 组名/方向来自 project.json 或规则派生，有 stdout 证据。
A3 perm_p 括号：只出现在有值的 celltype；文本与 `composition_report.txt` 逐值一致（断言通过）。
A4 台账 completed/exit 0/passed；`figure_audit_scan` 全 PASS；几何审计 13 张 A-E 全 PASS。
A5 颜色像素断言通过。
A6 同 seed 两次渲染 13 张 md5 全同。
A7 processed 数据表 md5 不变（基线对比表）。
A8 `figure_code_audit` no issue。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
