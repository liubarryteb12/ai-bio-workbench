[派发单 · 切片 S6-scout] 子 Agent 任务：line2/line3 出图源码合规侦察（只读，不改代码）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\docs\figure_spec.md
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【环境】**本任务不连远端**，只读本地代码。禁止连 8787/8080/ssh，禁止跑任何分析脚本。

【背景】line1 的出图合规已用机器判决打到 `PASS=24 / FAIL=0`（见计划 §0），
但 line2_scrna / line3_spatial 只有源码级扫描跑过（C1-C9），且没有任何真实数据渲染验证
（本项目 PRJ_E2E_GSE277173 只有 line1 数据）。主 Agent 要一份 line2/line3 的
"源码级合规 + 与工作台登记的差距"清单，作为后续补跑的前置输入。

【任务项】
1. 跑并记录：`python cn_debug/figure_code_audit.py --root src --csv cn_debug/code_audit.csv`
   （若报 issue，逐条记录文件:行号:类别:片段）。
2. 逐个通读 `src/line2_scrna/scripts/` 与 `src/line3_spatial/scripts/` 下所有出图脚本，
   列"脚本 → 图件清单"表：图件名（源码里的字面量或动态模板）、图类型、落盘目录、
   是否走 ggsave / png() / savefig、是否内嵌 layout guard（`def caption(`）。
3. 逐条对照 `docs/figure_spec.md` 的 §一（落点/命名/DPI/字号）、§二（分类必备元素）、
   §三之二（图注/图例位置）、§三之三（阈值标注/tick 不换行/网络标签避让），
   输出"符合 / 不符合 / 无法从源码判断"三态清单，不符合的给文件:行号与片段。
4. 对照 `BioanalysDesktop/server/figures.js` 的 FIGURE_CAPTIONS 登记：
   列出 line2/line3 已登记 caption 的图件名、未登记的图件名（未登记 = 交付时 C1 项会丢分）。
5. 对齐 `ops/build_client_report.py` 的 STEP_CATALOG：标出 line2/line3 各步骤声明的
   outputs 与实际脚本写出的文件名是否一致（不一致的一律列出）。
6. 产出 `con_hf/dispatch/S6_scout_report.md`，末尾给"补跑前置清单"：
   哪些步骤需要哪些输入数据、哪些依赖外网（如 STRING/liana/pyscenic）、
   哪些可以在无数据情况下用现有 processed/ 产物渲染。

【硬性禁止】
- 禁止修改/新建/删除仓库任何文件；唯一允许写 `cn_debug/code_audit.csv`（若扫描有输出）
  与 `con_hf/dispatch/S6_scout_report.md`。
- 禁止连远端、禁止跑分析脚本、禁止改 src/ 与 ops/。
- 禁止把"看着像"写成"是"；读不到的给"无法从源码判断"。

【验收标准】
A1 两线全部出图脚本清单（脚本/图件数/落盘入口/有无 guard）。
A2 规范符合性三态清单，不符合项有文件:行号:片段。
A3 caption 登记差距表（已登记/未登记）。
A4 STEP_CATALOG 与实际产物名一致性表。
A5 补跑前置清单（数据依赖/外网依赖/可立即渲染项）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
