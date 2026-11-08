[派发单 · 切片 S8] 子 Agent 任务：出图排版收敛为 4:3 / 16:9 两档（客户端 + 服务端 + R/Python 双端适配）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\2026-10-19_figure_polish_plan.md
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\踩坑台账.md 的 #190、#192
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【远端通道】需要时先 `adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o ConnectTimeout=15 -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景】用户 2026-10-19 拍板：客户端选择出图排版的方式**只保留 4:3 与 16:9 两档**，
服务端对应出图代码一并修改适配。原三套模板（nature_side / cell_wide / clinical_note）
收敛为按画幅比驱动的两档。

【主 Agent 已定死的映射规则（不许自行更改）】

新模板（两端必须同值，各自持有副本，与现状一致）：

| 新 template_id | aspect_ratio | legend_position | legend_direction | axis_style | x_label_rotation | show_footnote_panel |
|---|---|---|---|---|---|---|
| `template_4x3` | `4:3` | `outside_right` | `vertical` | `classic_L` | `auto_45` | `False` |
| `template_16x9` | `16:9` | `bottom_center` | `horizontal` | `boxed` | `auto_45` | `True` |

- `template_4x3` 的规则 = 原 `template_1_nature_side`（逐字段相同）
- `template_16x9` 的规则 = 原 `template_2_cell_wide`（逐字段相同）
- 默认模板改为 `template_4x3`

**旧 id 兼容（硬要求）**：`normalize_layout_spec` / `normalizePlotLayoutConfig` 必须把旧 id
映射到新 id 后再查表：`template_1_nature_side → template_4x3`、
`template_2_cell_wide → template_16x9`、`template_3_clinical_note → template_4x3`。
目的：现有项目 `PRJ_E2E_GSE277173` 的 project.json 写的是 `template_2_cell_wide`，
映射后规则逐字段相同 → **已交付图件必须零视觉变化（md5 不变）**。

【任务项】
1. 改 `ops/layout_helper.py`：`TEMPLATES` 3→2（用上表）、`DEFAULT_TEMPLATE_ID='template_4x3'`、
   `normalize_layout_spec` 加旧 id 映射；保持 `figsize_for`/`apply_sci_plot_layout` 等其他 API 不变。
2. 改 `bin/layout_helper.R`（R 侧同值副本）：同步 `layout_templates_r`/等价的模板表与默认值，
   加同样的旧 id 映射；`ggsave` 垫片与 `layout_figsize_r` 行为不变。
3. 改 `BioanalysDesktop/server/project.js`：`PLOT_LAYOUT_TEMPLATES` 白名单 3→2、
   `normalizePlotLayoutConfig` 加旧 id 映射；**保持 project.json 里落盘的字段结构不变**。
4. 改 `portal/index.html`：排版选择控件从 3 个选项改成 2 个（"4:3" / "16:9"），
   option 的 value 用新 template_id；选中态与提交payload字段名不变。
5. 自测（本地 + 远端，全部真跑）：
   a. `python -c "import ast; ast.parse(open('ops/build_client_report.py',encoding='utf-8').read())"` 不适用；
      对三个 py 文件做 `ast.parse`，对 R 文件远端 `Rscript -e 'invisible(parse(...))'`；
   b. 单元级：写一次性探针（放 `cn_debug/`，可保留）证明
      `normalize_layout_spec('template_2_cell_wide')` 与 `normalize_layout_spec('template_16x9')`
      返回的规格 dict **完全相等**；`template_1_nature_side` 与 `template_4x3` 相等；
      `template_3_clinical_note` 映射到 `template_4x3`；
   c. 端到端零变化验证：用完整引擎环境重跑 `pca_matrix`（seed=20261013，
      project.json 仍是旧 id `template_2_cell_wide`），
      `l1_02_pca_step3.png` 的 md5 必须仍是 `b9db6bd4cedd0d147ff246838fa487af`；
      `pca_scores.tsv` md5 必须仍是 `57a587a9eea31b01f989e7628f9c57ea`；
   d. 新 id 验证：把同一项目的 project.json **临时**改成 `template_16x9`（改前备份），
      重跑 `pca_matrix`，md5 应与 c 相同；随后**恢复备份**并再跑一次确认回到 `b9db6bd4…`。
      （project.json 的任何临时修改都必须留下备份文件与恢复记录。）
6. 部署：`ops/layout_helper.py`、`bin/layout_helper.R`、`ops/layout_autoload/*`
   按既有约定同步到远端 `/mnt/ssd/bio_data/ops/` 下（scp + md5 核对）；
   `bin/layout_helper.R` 同时经 `ops/06_deploy_scripts.ps1 -Line line1_bulk -Force` 走部署通道。
7. 前端：`npx tsc --noEmit` 0 错 + `npm run build` 通过（在 BioanalysDesktop 目录）。
8. 产出 `con_hf/dispatch/S8_report.md`。

【硬性禁止】
- 禁止改 `src/` 下任何文件（S5-00 正在并行改图例调用，撞车即事故）。
- 禁止改 `ops/build_client_report.py`（S7 正在并行修改）。
- 禁止改出图脚本的统计口径、阈值、种子；禁止改图件命名。
- 禁止把"规则相同"当成"已验证"；c/d 两步的 md5 必须实际跑出来贴进回报。
- 禁止在没备份的情况下改远端 project.json；改完必须恢复并复验。

【验收标准】
A1 三处模板表与映射全部落地，`ast.parse` / R `parse` 通过。
A2 探针证明 4 组映射等价（b）。
A3 端到端零变化：c 的两个 md5 与给定值逐字相同。
A4 新 id 等价：d 的 md5 与 c 相同，且 project.json 已恢复原值（附恢复后的 md5/内容证据）。
A5 远端部署文件 md5 与本地一致（逐个列）。
A6 `tsc --noEmit` 0 错、`npm run build` 通过（贴尾行）。
A7 明确列出未验证项（如 line2/line3 无数据未做端到端）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
