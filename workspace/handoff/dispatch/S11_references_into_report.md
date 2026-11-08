[派发单 · 切片 S11] 子 Agent 任务：把 reference/生信分析可用参考文献 接入交付报告的方法学引用与软件版本登记

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\aims\aims.txt §3（主语言/包版本/seed 契约）、§3.2（报告结构）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\reference\生信分析可用参考文献\文献下载清单.md
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\reference\生信分析可用参考文献\ 下的 01/02/03/04 四个子目录
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\build_client_report.py
     （重点 L1000-1060 的版本段与第七章结构）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】需要时先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】用户新增 `reference/生信分析可用参考文献/`（约 50 篇 PDF，四大类：
① GEO 挖掘+ML+体外验证 13 篇；② 单细胞 6 篇；③ 单细胞+空间 8 篇；
④ 工具包原始论文约 20 篇：WGCNA/limma/Scanpy/harmony/CellChat/SPOTlight/
Slingshot/xCell/Squidpy/DoubletFinder/PyWGCNA 等）。
项目里已有一个**空转契约**：aims §3 要求登记包版本，`build_client_report.py` L1024 也有
"任务台账未记录软件版本…"的分支，但**没有任何地方真正写入方法学引用**。
本切片把这个缺口补上：报告的方法学章节自动带出软硬件版本 + 对应的原始论文引用。

【任务项】
1. **取真实版本（远端实跑，不许照抄文档）**：
   `ssh k40-ubuntu 'Rscript -e "…"'` 与 `python3 -c "…"` 采集本项目三线实际在用的包版本：
   R 侧至少 `WGCNA / limma / ggplot2 / clusterProfiler / Seurat / pheatmap / WGCNA 版本号`；
   Python 侧至少 `scanpy / anndata / pandas / numpy / scipy / scikit-learn / matplotlib /
   seaborn / networkx / statsmodels`；再取 `R --version` 与 `python3 --version` 主版本。
   输出一个机器可读的版本清单文件 `docs/software_versions.yaml`（或 .json，你定，说明理由），
   每条含 `name / version / language / role(步骤用途) / source(实测命令)`。
   **seed 也登记**：`20261013`（aims §3 已定）。
2. **建立文献索引**：新建 `reference/生信分析可用参考文献/INDEX.md`（或 docs/ 下，你定并说明），
   按"包/方法 → PDF 文件名 → 可引用信息"组织，覆盖 04 类工具包全部 PDF；
   每个条目给出：包名、版本范围（若 PDF 内有）、论文标题、作者/年份（从 PDF 元数据或清单取）、
   本地相对路径。**不许编造 DOI 或页码**；取不到就写"未获取"。
3. **报告引擎接入**（改 `ops/build_client_report.py`）：
   - 在读project.json/台账的同一处，读取第 1 步的版本清单；
   - 方法学章节（或第七章的自检段，按现有结构选合适位置）输出：
     ① 软件与版本表（语言/包/版本/用途）；② 随机种子；③ 方法学引用列表
        （按该线实际用到的包，从 INDEX.md 取对应论文，**只用得上的，不堆全部 50 篇**）。
   - 保持现有报告章节结构、字段名、`Analysis_Report.md/html` 的既有样式不变（S7 刚重写过
     STEP_CATALOG，**不要动 STEP_CATALOG**）。
   - 版本清单读取失败时：明确写"版本清单缺失，方法学引用不完整"，**不许静默跳过**。
4. 自测（本地 + 远端，全部真跑）：
   - 远端对 `PRJ_E2E_GSE277173` 重跑一次报告生成（命令用仓库现成的那个，先 `grep -rn
     "build_client_report" ops/ docs/ cn_debug/` 找现成入口，别自造），
     贴出生成的 `Analysis_Report.md` 中"软件版本/方法学引用"段落原文；
   - 断言：版本表里至少含 WGCNA 与 limma（line1 实际在用）；引用列表条数 ≤ 该线实际用到的包数；
     缺版本清单时的降级文案能出现（用临时改名清单文件的方式验证，**测完立刻改回**）。
5. **每完成一步就写一次 `con_hf/dispatch/S11_report.md`**（硬要求，前车之鉴）。

【硬性禁止】
- 禁止改 `src/` 下任何脚本、`STEP_CATALOG`、模板四件套、portal、
   `BioanalysDesktop/server/figures.js` 的 caption（除非确有必要，那要走变更建议）。
- 禁止编造 DOI/页码/作者/年份；PDF 里取不到的写"未获取"。
- 禁止改报告既有章节顺序与既有字段名；只做"新增版本与引用段"。
- 禁止在没备份的情况下改动远端任何文件。
- 禁止把"文献很多"写成"已引用"；引用必须来自 INDEX.md 且对应该线实际用到的包。

【验收标准】
A1 版本清单是远端实采（每条带 source 命令），含 R 与 Python 两侧主语言与至少 10 个包。
A2 INDEX.md 覆盖 04 类全部工具包 PDF，条目字段齐全，无编造。
A3 报告生成结果里能看到：版本表 + seed + 方法学引用三段，且引用与 line1 实际用到的包对应。
A4 降级路径可复现（清单缺失 → 明确文案，不静默）。
A5 报告既有章节/字段未被破坏（贴 diff 或结构对比）。
A6 `ops/build_client_report.py` 语法检查通过；远端报告生成 exit 0。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
