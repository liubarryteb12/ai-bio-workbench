[派发单 · 切片 S12-scout] 子 Agent 任务：line2/line3 图件几何审计可行性侦察（只读，不改代码）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#194、#196
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\docs\figure_spec.md §三之三（几何审计）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】line1 已有 27 张拿到机器几何判决（`cn_debug/figure_audit_line1.csv`），
line2/line3 的图件**从未跑过** `ops/audit_figure_layout.py`，所以打分里 37+69 张全是
`B1?~B4?` UNVERIFIED。主 Agent 要一份"哪些能审、怎么审、要付出什么代价"的侦察结论，
用来决定是否派实施切片。**你只侦察 + 最多跑一次试点审计，不做任何代码修改。**

【任务项】
1. 链路自检 + `ssh k40-ubuntu 'echo OK'`。
2. 盘点两线出图脚本与产物：
   - 本地 `outputs/default/line2_scrna/figures`、`outputs/default/line3_spatial/figures` 的图件数与命名；
   - 远端 `bin/line2_scrna/`、`bin/line3_spatial/` 下哪些是出图脚本（有 `def caption(` 的
     Python heredoc 才是可审计对象；纯 R 脚本审不了， figs=0，理由见 #192）。
   - 对应 processed/ 目录是否有所需输入（决定能否真渲染）。
3. **试点审计（只跑一个，且必须带 #190 纪律）**：选 `line2_scrna` 的 `enrichment_figures`
   （纯渲染、零重算、输入在 processed/）：
   - 先做 `figures/` 与 `processed/` 全量 md5 基线（/tmp/s12_before*.md5）；
   - `ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py --script /mnt/ssd/bio_data/bin/line2_scrna/enrichment_figures --cwd projects/default/line2_scrna/processed --runner bash --seed 20261013 --csv /tmp/s12_probe.csv'`
   - 跑后立刻 md5 对比，列出 FAILED 文件与差异行；
   - 把 /tmp/s12_probe.csv 拉回本地留档（放 `cn_debug/figure_audit_sweep/`）。
4. 逐脚本给出"可审/不可审/需数据"三态表，每条注明判据（有无 caption/输入是否齐/是否纯渲染）。
5. 估算：两线全部可审图件的数量、按试点耗时推算的总耗时、需要 reseed 的风险点。
6. **边做边写 `con_hf/dispatch/S12_scout_report.md`**（硬要求）。

【硬性禁止】
- 禁止修改仓库任何文件（除上述留档 CSV 与报告）。
- 禁止跑超过 1 个脚本的审计；禁止跑任何分析 step（cell_communication/scenic_tf 等上游步骤）。
- 禁止在没做 md5 基线前跑 `--runner bash`（#190）。
- 禁止把"应该能审"写成已验证；每个脚本的判据都要给出你读到的源码证据（行号）。

【验收标准】
A1 两线出图脚本清单（脚本/图件数/有无 caption/是否纯渲染）。
A2 三态表完整，判据有行号证据。
A3 试点审计：命令原文 + `audit: figs=N fail=M` 尾行 + CSV 落本地 + md5 前后对比表。
A4 全量审计的耗时估算与风险点（含 reseed 风险）。
A5 line2/line3 若存在 R 出图脚本，明确列出并说明为何 figs=0（#192）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
