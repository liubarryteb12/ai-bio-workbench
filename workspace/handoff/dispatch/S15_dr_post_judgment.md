[派发单 · 切片 S15] 子 Agent 任务：dr_post_analysis 7 图的几何判决（传 20261018，不重算）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S14_baudit_remaining.md
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S14_report.md（§5.3 的 /tmp 探针）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#197、#198、#199
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】line2/line3 三线打分还剩 7 张 UNVERIFIED，全部来自两个 `dr_post_analysis`
（l2 3 图 + l3 4 图）。S14 已用 /tmp 探针证明：
- 磁盘 `dr_enrichment.tsv` = `2b5f4863…`，用 **seed 20261018 重算逐字节复现磁盘**，
  用 20261013 重算则 1975/1975 行 NES 全变（#199）。
- 主 Agent 裁决（自主推进，用户未否决）：**本轮只拿几何判决，不重算交付数值**。
  因此本切片的审计**必须传 `--seed 20261018`**（不是 20261013），
  目的是"用与磁盘版本相同的种子重跑 → 产物逐字节不变 → 只拿 A–E 几何判决"。
  数值 seed 合规问题单独挂账（#199），不在本切片处理。

【任务项】
1. 链路自检；核对本地 `src/line2_scrna/scripts/dr_post_analysis`、
   `src/line3_spatial/scripts/dr_post_analysis` 与远端 `bin/` 同名文件 md5 一致。
2. 对 `projects/default/line2_scrna`、`projects/default/line3_spatial` 的
   `processed/` 与 `figures/` 建全量 md5 基线（含 h5ad；S14 的基线文件
   `/tmp/s14_before_*.md5` 若仍在可复用以省时间，但**必须复验清单与当前磁盘一致**，
   不一致就重建）。
3. 逐个审计（**`--seed 20261018`**，CSV 落 /tmp 后拉回本地
   `cn_debug/figure_audit_sweep/s15_<line>_dr_post_analysis.csv`）：
   ```
   ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
     --script /mnt/ssd/bio_data/bin/<line>/dr_post_analysis \
     --cwd projects/default/<line>/processed \
     --runner bash --seed 20261018 --csv /tmp/s15_<line>_dr_post_analysis.csv'
   ```
4. 每个脚本跑后立刻比对基线：
   - `dr_enrichment*.tsv` / `dr_overlap*.tsv` / `dr_regulatory_network.tsv` 等**数值表必须
     逐字节一致**（探针已证明 20261018 可复现，若不一致说明环境漂移，立即停并上报）；
   - `dr_post_report.txt` 只允许 `seed=`（应仍为 20261018，即**不变**）与 `elapsed_seconds`
     计时行变化；
   - `figures/` 下 DR 图件**允许 md5 变化**（审计不带 `--write`，按 #190 结论不会写盘，
     但若变了要如实记录并解释）；
   - `.h5ad`（如有）必须逐字节一致。
   出现任何不符合上述归因的差异 → 立即停止后续审计，上报 P0 并附差异。
5. 合并全部 CSV 更新 `cn_debug/figure_audit_all.csv`（先备份当前版到
   `cn_debug/figure_audit_sweep/figure_audit_all.before_S15.csv`），贴出总判决数与
   PASS/FAIL 计数。
6. 三线打分复跑（贴尾行原文，命令用 S14 报告里那套）。
7. 在报告里明确写一段「**seed 合规挂账说明**」：这 7 张图的判决是用 20261018 拿到的，
   磁盘 DR 富集数值由 20261018 算出（#199），契约种子 20261013 的重算决策待用户拍板；
   本切片**没有修改任何交付数值**。
8. **每完成一个脚本就更新一次 `con_hf/dispatch/S15_report.md`**（硬要求）。

【硬性禁止】
- 禁止传 `--seed 20261013`（会改交付数值，#199 已裁本轮不重算）。
- 禁止修改仓库任何文件（除 CSV 合并、备份与报告）。
- 禁止改 `--runner`、加 `--write`；禁止审其他脚本。
- 禁止把"应该能复现"写成已验证；探针结论是 S14 跑出来的，你必须自己复跑基线对比。
- 禁止在未建/复验基线前跑审计。

【验收标准】
A1 2 个脚本全部有命令原文（含 `--seed 20261018`）+ `audit: figs=N fail=M` 尾行 + CSV 落本地。
A2 每个脚本的基线对比表，差异归因到"计时行 / 无差异"两类之一。
A3 `dr_enrichment*.tsv` 等数值表 md5 与磁盘当前值逐字相同的证据。
A4 合并后 `figure_audit_all.csv` 总判决数与 PASS/FAIL。
A5 三线打分尾行原文；预期 line2/line3 的 UNVERIFIED 中 B1?~B4? 清零。
A6 「seed 合规挂账说明」段落存在且措辞准确。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
