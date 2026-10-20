[派发单 · 切片 S13] 子 Agent 任务：line2/line3 全量几何审计（106 图，两档策略）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S12_scout_line23_audit.md
     与 `con_hf/dispatch/S12_scout_report.md`（§5.2 脚本清单、§5.3 探针、§5.5 耗时与风险）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#197
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】S12 已证实：line2/line3 共 106 张图全部是 Python 出图，**可全量机器几何审计**
（#197：我此前"这两线审不了"是错误推断）。当前这 106 张在打分系统里全是 `B1?~B4?`
UNVERIFIED。本切片把它们变成真判决。

【两档策略（S12 结论，不许混为一谈）】

- **A 档 · 纯渲染（93 张，安全）**：`enrichment_figures`(l2 2 / l3 4)、`scenic_figures`(2)、
  `scrna_figures`(28)、`spatial_figures`(57)。实测审计不改任何文件。
- **B 档 · 重算类（13 张，有 P0 风险）**：`target_gene_localization`(1)、`gsva_pathways`(1)、
  `dr_post_analysis`(l2 3 / l3 4)、`celltype_annotation`(4)。
  `_stage_dir()` 用 `os.symlink` 软链穿透，bash 审计会**原地改写真 processed/**
  （#197 附表列了具体文件）。B 档必须先建 md5 基线、跑后逐项比对。

【任务项】
1. 链路自检；核对本地 `src/line{2,3}*/scripts/*` 与远端 `bin/line{2,3}*/` md5 一致
   （S12 实测 10/10，你复验并贴结果）。
2. **B 档前置**：对 `projects/default/line2_scrna` 与 `projects/default/line3_spatial`
   的 `processed/` 与 `figures/` 建全量 md5 基线（含 h5ad！S12 说 1.5GB h5ad 约 3.5s），
   存 /tmp/s13_before_<line>_{figs,proc}.md5。
3. 逐脚本跑审计，**一律 `--seed 20261013`**（#190），CSV 落 `/tmp/s13_<line>_<step>.csv`：
   ```
   ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
     --script /mnt/ssd/bio_data/bin/<line>/<step> \
     --cwd projects/default/<line>/processed \
     --runner bash --seed 20261013 --csv /tmp/s13_<line>_<step>.csv'
   ```
   跑完立刻把 CSV 拉回本地 `cn_debug/figure_audit_sweep/`。
4. 每个脚本跑后立即对比该档基线：列出 FAILED 文件与差异行。
   **判定**：数据表（.tsv/.h5ad）md5 必须逐项一致；`*_report.txt` 只允许
   `elapsed_seconds`（及同类计时行）变化；若出现**任何其他差异，立即停止后续审计**，
   在回报里标 P0 阻断并附差异内容，等主 Agent 裁决。
5. A 档 93 张全部跑完后，合并所有 CSV（含 line1 既有的
   `cn_debug/figure_audit_line1.csv`）为 `cn_debug/figure_audit_all.csv`
   （列：figure,verdict,violations；同名图后者覆盖前者并注明来源）。
6. 打分复跑（贴尾行原文）：
   ```
   python cn_debug/figure_score.py --dir outputs/default/line2_scrna/figures \
     --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
     --src-root src --ledger-dir outputs/system_logs
   ```
   line3 同理。注意：ledger-dir 里可能没有 default 项目 line2/line3 的台账，
   若 D2/D3 仍 UNVERIFIED 要如实说明原因（源码静态映射应能覆盖大部分）。
7. **每完成一个脚本就更新一次 `con_hf/dispatch/S13_report.md`**（硬要求，前车之鉴）。

【硬性禁止】
- 禁止修改仓库任何文件（除上述 CSV 合并与报告）。
- 禁止跳过 B 档的 md5 基线直接审。
- 禁止改种子、改 `--runner`、加 `--write`。
- 禁止把"应该没变"写成已验证；每个脚本的基线对比表都要实际输出。
- 禁止审 line1（line1 已有判决，不要重复劳动）。

【验收标准】
A1 10 个脚本全部有：命令原文 + `audit: figs=N fail=M` 尾行 + CSV 落本地。
A2 每个脚本的基线对比表（对象/文件数/差异文件/差异行内容）。
A3 数据表零差异的证据（或差异已被你停下并上报）。
A4 合并后 `figure_audit_all.csv` 的总判决数、PASS/FAIL 计数。
A5 两线打分的尾行原文，UNVERIFIED 数量与原因。
A6 明确列出仍未拿到判决的图（若有）与原因。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
