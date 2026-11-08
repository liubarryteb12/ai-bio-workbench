[派发单 · 切片 S5-scout] 子 Agent 任务：Step 4「美化包替换点」侦察（只读，不改代码）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\docs\figure_spec.md
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#192
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【环境远端】**本任务不需要连远端**，只读本地代码。禁止连 8787/8080/ssh。

【背景】远端 R/Python 环境已装好但脚本全部手搓：R 侧 patchwork 1.2.0 / cowplot 1.1.3 /
aplot 0.3.2 / ggrepel 0.9.5 / ggsignif 0.6.4 / ComplexHeatmap 2.18 / viridis 0.6.5 /
enrichplot 1.22；Python 侧 seaborn 0.13.2 / adjustText 1.4.0。主 Agent 要一份"哪些手搓实现
可以换成包、换了有什么收益、有什么风险"的清单，用来派发实施切片。**你只侦察，不改任何代码。**

【任务项】
1. 通读 `src/line1_bulk/scripts/` 与 `src/line2_scrna/scripts/`、`src/line3_spatial/scripts/`
   下所有出图脚本（无扩展名 bash，内含 python3/Rscript heredoc），
   结合 `docs/figure_spec.md` 与 `con_hf/figure_manual_review.md`。
2. 逐脚本列出**可替换点**，每条必须包含：
   - 文件:行号、现状手搓代码片段（≤3 行）
   - 可替换成的包调用（写全函数名，如 `ggrepel::geom_text_repel()`）
   - 替换理由（对齐规范哪一条 / 解决什么已记录问题）
   - 风险与回归面（是否改数值/是否改图幅/是否引入新依赖/是否影响确定性）
   - 预期工作量（小=≤10 行 / 中 / 大=需重写该图）
3. 重点侦察这几类（已知高价值）：
   - 标签压字 → ggrepel / adjustText（规范 §三之二要求自动避让）
   - 组间显著性标注 → ggsignif（箱线/组成比较图）
   - 多面板拼图 → patchwork / cowplot（当前全是单图）
   - 连续色 → viridis（空间表达图）
   - 热图 → ComplexHeatmap / pheatmap（已装的；只标"值不值得换"，多数不建议动）
   - 箱线/小提琴/条形主题 → seaborn（line2/line3 组成图）
4. 产出 `con_hf/dispatch/S5_scout_report.md`：按"脚本 → 替换点"组织，
   末尾给一张**优先级表**（P0 收益高风险低 / P1 / P2 不建议），每条注明验证方式。

【硬性禁止】
- 禁止修改/新建/删除仓库里任何文件；唯一允许写入 `con_hf/dispatch/S5_scout_report.md`。
- 禁止连接远端、禁止跑分析脚本、禁止改 ops/ 与 src/。
- 禁止把"建议"写成"已做"；没读到的代码不要臆测行号。

【验收标准】
A1 覆盖三个线的全部出图脚本（列清单，注明每个脚本出几张图、什么类型）。
A2 每条替换点六要素齐全（位置/现状/目标/理由/风险/工作量）。
A3 优先级表可执行：P0 每条都带"改完怎么验证"的具体命令或判据。
A4 明确列出"不建议替换"的及理由（避免为转而转）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
