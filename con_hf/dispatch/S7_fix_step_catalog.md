[派发单 · 切片 S7] 子 Agent 任务：修 `build_client_report.py` 的 STEP_CATALOG 结构缺陷与图名不符

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S6_scout_line23_compliance.md
     （重点是 §2.5：STEP_CATALOG 声明 vs 实际产物，那是本切片的输入）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【环境】本任务**只改 `ops/build_client_report.py`**，不连远端、不跑分析、不动 src/ 与 portal/。
（S5-00 正在改 src/ 下的图例，你绝对不要碰 src/，避免撞车。）

【背景】S6-scout 实测出 `ops/build_client_report.py`（交付报告引擎）两处结构缺陷：
① **键没有 line 维度**：`enrichment` 在 L225（line2）与 L395（line3）各定义一次，
   Python dict 字面量后者覆盖前者 → line2 的 enrichment 条目运行时丢失；
   同类：`dr_post_analysis` 只有 line2 一条、`enrichment_figures` 只有 line1 一条、
   `scenic_figures` 完全无条目。
② **15 处图名/产物名声明与实际不符**（§2.5 表逐条列了），报告按声明名找不到文件。
   另：line2 `cluster_umap`/`scrna_figures` 声明 `l2_01_umap_clusters.png` 但该步骤不出图；
   line2 `cell_communication` 声明 `l2_10_cellchat.png` 不存在且 `l2_10` 序号已被
   `l2_10_pca_diagnosis.png` 占用（序号冲突）。

【任务项】
1. 读 `ops/build_client_report.py` 的 STEP_CATALOG（L66-402）与 S6 报告 §2.5 全表。
2. 修 ①：把 STEP_CATALOG 改成 **line 维度**（如 `STEP_CATALOG[line_id][step_id]`），
   保持所有现有查询点的行为不变（先 `grep -n "STEP_CATALOG" ops/build_client_report.py`
   找全部读取处，逐个适配；查询 API 的形状由你定，但必须能按 (line, step) 唯一取到条目）。
3. 修 ②：逐条对齐 §2.5 表:
   - 声明名改成**脚本实际写出的名字**（含物种段 `<sp>`、样本段 `<sample>`、celltype 后缀等）；
   - 声明产物不存在的（`l2_01_umap_clusters`、`l2_10_cellchat`）→ 从对应步骤条目里删掉，
     并保证该图若真由别的步骤产（如 `l2_01_umap_celltype` 由 scrna_figures 产）就在那个步骤里声明；
   - 漏登记的补上（line2 `dr_post_analysis` 3 张、line2/line3 `scenic_figures`、
     line3 `enrichment_figures`、line3 `dr_post_analysis` 的图与 tsle）；
   - 序号冲突（`l2_10`）如实记录到回报，**不要改脚本的图件命名**（那会动 src/，超出本切片）。
4. 保持 `label` / `legend` / 其他字段不丢（S6 指出 line2 enrichment 的 label 正是被覆盖丢失的）。
5. 自测（本地可跑，不需要远端）：
   - `python -c "import ast,sys; ast.parse(open('ops/build_client_report.py',encoding='utf-8').read())"` → 无异常
   - 写一个**最小验证脚本**放到 `cn_debug/` 下（如 `2026-10-19_verify_step_catalog.py`）：
     ① 断言 (line2, enrichment) 与 (line3, enrichment) 是两条不同条目且 line2 的
     `results/enrichment_ora.tsv` 声明仍在；② 断言 §2.5 表里每一行的"实际写出"图名
     都能在对应步骤条目里找到；③ 断言 `scenic_figures` 在 line2 有条目。
     验证脚本要能独立运行并打印 PASS/FAIL。
   - 若 `ops/build_client_report.py` 有 `--help` 或可 dry-run 的入口，跑一次确认不炸。
6. 产出 `con_hf/dispatch/S7_report.md`。

【硬性禁止】
- 禁止修改 `src/` 下任何文件（S5-00 正在并行修改，撞车即事故）。
- 禁止改任何图件命名、统计口径、报告章节结构、研究方法学文字。
- 禁止连远端、禁止跑分析脚本、禁止装包。
- 禁止把"应该对得上"写成"已核对"；每条对齐都要给出你实际读到的源码行号。

【验收标准】
A1 STEP_CATALOG 具备 line 维度，(line2,enrichment) 与 (line3,enrichment) 同时存在且内容各自正确。
A2 §2.5 表 15 条逐条给出"改成了什么"（文件:行号 + 改后值）。
A3 `scenic_figures`（line2）、line3 `enrichment_figures`、line2/line3 `dr_post_analysis` 图件补齐。
A4 序号冲突 `l2_10` 有明确记录与建议（不改 src/）。
A5 验证脚本实跑通过，输出贴进回报；`ast.parse` 通过。
A6 明确列出"未验证项"（如本地无 line2/line3 数据，无法端到端跑报告引擎）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
