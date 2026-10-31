[派发单 · 切片 S16] 子 Agent 任务：line1 首张组合图 `l1_32_deg_overview.png`（Step 5 第一单）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
     的「Step 5 组图契约」G1-G5（**逐条遵守，这是本切片的验收主体**）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\docs\figure_spec.md §一/§三/§三之二
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\src\line1_bulk\scripts\bulk_figures
     （你只改这一个文件）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#192、#193、#196、#199
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】Step 5 组图契约已由主 Agent 定稿（G1 A/B/C 面板编号、G2 共享图例、G3 新号段、
G4 Python 用 subplot_mosaic/GridSpec 不引 patchwork、G5 验收三条）。
本切片做 line1 第一张组合图，**只改 `src/line1_bulk/scripts/bulk_figures`**，
跑场用 `PRJ_E2E_GSE277173`（有真实数据）。

【主 Agent 已定死的图规格（不许自行更改）】

- 图名：`l1_32_deg_overview.png`（G3：line1 现到 31，从 32 起；语义用 `overview`）
- 四个面板（G1 编号 A/B/C/D）：
  - **A** = `l1_03_volcano_fdr`（FDR 口径火山图）
  - **B** = `l1_06_ma_fdr`（FDR 口径 MA 图）
  - **C** = `l1_02_pca`（PCA 散点）
  - **D** = `l1_04_topvar_heatmap`（top 方差基因热图）
- 布局：2×2 `GridSpec`（或 `subplot_mosaic`），横版（宽≥高），figsize 按内容量定
  （**不小于**现有单图 figsize 的较大者；模板只放大不缩小，#193 纪律）
- G2 共享图例：PCA 面板的 case/ctrl 色码在图组**下方居中**画一次（横排、`frameon=False`、
  带语义标题如 `group`）；其余面板**不得**重复画同一组图例。分面图例不搬（本图无分面）。
- 图注：图组级 caption 一条一行（§三之二），内容至少含：图名语义、四个面板各是什么、
  输入产物、阈值口径（adj p<0.05 / |log2FC|>1）、样本数。
- **单图必须继续出**：`l1_02_pca.png`、`l1_03_volcano_fdr.png`、`l1_04_topvar_heatmap.png`、
  `l1_06_ma_fdr.png` 一张不能少（组合图是新增，不是替换）。新增的 `l1_32` 由
  `bulk_figures` 在渲染完这四个面板的数据后拼合输出。
- caption 登记：`BioanalysDesktop/server/figures.js` 的 FIGURE_CAPTIONS 加一条
  `l1_32_deg_overview` 的 match（C1 验收要用）。**只加这一条，不动既有条目。**

【任务项】
1. 读 `bulk_figures`，确认四个面板的数据与绘制函数可复用（不要重算统计量）。
2. 实现组合图（按上面规格），复用脚本内已有的 `caption`/`save`/guard；
   组合图落盘前同样要走 `layout_fix`/`_install_layout_guard` 的收口
   （若 guard 只接管单轴图，组合图要显式调用你脚本里已有的等价收口逻辑，
   并在回报里说明你调用了什么）。
3. `figures.js` 加 `l1_32_deg_overview` caption 条目。
4. 本地自检：`python cn_debug/figure_code_audit.py --root src` → `no issue found`
   （#196 后 C1/C2 判据更严，别引入轴内图例或不合规命名）。
5. 部署：`pwsh -NoProfile -Command "ops/06_deploy_scripts.ps1 -Line line1_bulk -Force"`
   （注意：S9/S10 实测 `-File` 形式会被运行时拦，用 `-Command` 形式），
   核对远端 `bin/line1_bulk/bulk_figures` 与本地 md5 一致。
6. 重跑：`/api/tasks/submit`，`projectId=PRJ_E2E_GSE277173`、`lineId=line1_bulk`、
   `step=bulk_figures`、`seed=20261013`、`inputs` 用该步骤既有输入（
   照 `cn_debug/2026-10-19_e2e_run_pipeline.mjs` 里 bulk_figures 的 spec，
   不要自己猜），`outputs` 声明本步全部产物（含新增 `l1_32`）。
   贴台账 status/exit_code/checkpoint_status/error_log/io_files.output 长度。
7. 回搬：`pwsh -NoProfile -Command "ops/07_pull_outputs.ps1 -Project PRJ_E2E_GSE277173 -Line line1_bulk"`。
8. 验证（全部真跑，贴原文）：
   - `python cn_debug/figure_audit_scan.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures`
     → `l1_32` 必须 PASS（DPI 300 / 最短边≥1200 / 非空白 / 边缘无裁切）
   - 几何审计（真渲染判决）：
     ```
     ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
       --script /mnt/ssd/bio_data/bin/line1_bulk/bulk_figures \
       --cwd projects/PRJ_E2E_GSE277173/line1_bulk/processed \
       --runner bash --seed 20261013 --csv /tmp/s16_audit_bulk.csv'
     ```
     → `l1_32` 的 A-E 必须全 PASS；**注意 #190：这会真跑脚本并重写报告，
     跑前先对 `processed/` 与 `figures/` 建 md5 基线，跑后逐项比对，
     数据表必须逐字节一致、报告只许 elapsed 行变**。
   - `python cn_debug/figure_score.py --dir outputs/PRJ_E2E_GSE277173/line1_bulk/figures \
       --audit-csv cn_debug/figure_audit_all.csv --code-csv cn_debug/code_audit.csv \
       --src-root src --ledger-dir outputs/system_logs`
     → `l1_32` 必须 PASS 且 C1/C2 命中（caption 已登记 + 命名合规）；
     把 `l1_32` 的判决合并进 `cn_debug/figure_audit_all.csv`（先备份）。
   - **G1/G2 的机器判据**：用一次性探针（可留在 `cn_debug/`）从 `l1_32` 的 PNG 里验证：
     ① 四个面板编号 A/B/C/D 存在且位置在各自面板左上角外侧（用模板匹配或像素定位，
     做法自定，但必须在回报里写清判据）；② 共享图例只出现一次（图组下方），
     且其余面板区域无重复图例（可用"图例色块特征在图中出现次数"近似，写清判据）。
     取不到就写「未验证」，**不许推断**。
   - 单图回归：`l1_02_pca`/`l1_03_volcano_fdr`/`l1_04_topvar_heatmap`/`l1_06_ma_fdr`
     四张必须仍在且 PASS（不能因加组合图而丢或坏）。
9. **每完成一步就更新一次 `con_hf/dispatch/S16_report.md`**（硬要求，前车之鉴）。

【硬性禁止】
- 禁止改 `src/` 下其他文件、`ops/`、`build_client_report.py`、模板四件套、portal。
- 禁止删或弱化任何既有单图；禁止改统计口径、阈值、种子。
- 禁止引入 patchwork / 新依赖；禁止用 `--write` 跑审计；禁止改 `--runner`。
- 禁止在未建 md5 基线前跑 `--runner bash` 审计（#190）。
- 禁止把"应该合规"写成已验证；G1/G2 的判据必须实际测。

【验收标准】
A1 `l1_32_deg_overview.png` 生成，四面板 A/B/C/D 与规格一致。
A2 G1/G2 探针通过（或明确未验证 + 原因）。
A3 单图 4 张仍在且 PASS；`figure_audit_scan` 全 PASS 含 `l1_32`。
A4 几何审计 `l1_32` A-E 全 PASS；基线对比表证明数据表零变化。
A5 `figure_score` 里 `l1_32` PASS 且 C1/C2 命中；已合并进 `figure_audit_all.csv`。
A6 台账 completed/exit 0/passed；`code_audit` no issue。
A7 `figures.js` 只新增一条 caption，既有条目未动（贴 diff 或计数对比）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
