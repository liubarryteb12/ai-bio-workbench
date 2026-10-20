# 出图格式框定与美化 · 五步推进计划（主 Agent 框架）

> 制定：2026-10-19（主 Agent）。角色分工：**主 Agent 定框架/拆切片/定验收/复核结论**；
> **子 Agent 按派发单执行机械活**（派发契约见 `con_hf/dispatch/SUBAGENT_CONTRACT.md`）。
> 每步结束必须跑通"机器验收三件套"：源码扫描 + 几何审计 + 五维打分，且打分的 PASS 必须由
> 外部判决导入获得（不得默认满分，FE-012 已修）。

## 0. 现状基线（实测，非推测）

**已经框住的（不必重做）**：PNG 300dpi 落 `<line>/figures/`、命名 `l<n>_<序号>_<语义>.png`、
图内 ≥8pt、图内无中文、二分类标准色 `#3B4992`(ctrl)/`#EE0000`(case)、连续量 viridis、
图注一条一行置轴框外、图例外置、colorbar 带 label、三套 SCI 模板
（`template_1_nature_side` / `template_2_cell_wide` / `template_3_clinical_note`，
经 `ops/layout_autoload/{sitecustomize.py,Rprofile}` 在落盘前自动套用）、
layout guard（`caption`/`wrap_label`/`fit_text_edges`/`legend_out`/`layout_fix`）。
机器验收三件套：`cn_debug/figure_code_audit.py`、`ops/audit_figure_layout.py`、`cn_debug/figure_score.py`。

**本轮（Step 1）已落地并验证**：

| 项 | 内容 | 证据 |
|---|---|---|
| C7 | R `png()` 未声明 `res=` → 判违规（R 默认 72dpi） | 负样本 1 处命中 |
| C8 | Python `savefig` 无 `dpi=` 且无 `savefig.dpi` rcParams → 判违规 | 负样本 1 处命中 |
| 三态判决 | 打分系统新增 UNVERIFIED：外部判决缺失时**不许 PASS**（FE-012 关闭） | 不喂 CSV → 33 图全 UNVERIFIED、exit 1 |
| 判决导入 | `figure_score.py --audit-csv/--code-csv/--ledger-dir`；B1–B4 来自几何审计、D2/D3 来自源码扫描+台账反查 | 喂 CSV → 4 图 PASS、其余 UNVERIFIED |
| 审计 CSV | `ops/audit_figure_layout.py --csv` 逐图判决落盘；远端已同步（md5 613873da…） | 远端 4 图 PASS 导入成功 |

**实测缺口（Step 2 的主攻方向）**：

1. **R 出图不受几何审计覆盖**：`wgcna_modules` 跑审计 `figs=0 fail=0`（审计靠 patch
   `matplotlib.Figure.savefig`，R 走 `png()` 设备拦不住）；`enrichment_figures` 同命令
   `figs=4 fail=0`。→ line1 的 `l1_02_pca_step3`/`l1_03_volcano_limma`/`l1_28`~`l1_31`
   共 6 张 R 图目前**没有机器判决**，只能目视 + 登记，或补 R 侧审计。
2. **美化包装了没人用**：远端 R 已有 patchwork 1.2.0 / cowplot 1.1.3 / aplot 0.3.2 /
   ggrepel 0.9.5 / ggsignif 0.6.4 / ComplexHeatmap 2.18 / viridis 0.6.5 / enrichplot 1.22；
   Python 已有 adjustText 1.4.0 / seaborn 0.13.2。母版脚本全部手搓，未用这些包。
3. **没有任何组图**：三线图件全是单图，无面板拼合、无 A/B/C 面板编号、无共享图例。
4. 本地存档有 1 张陈旧图（`l1_27_wgcna_mm_gs.png`，远端已无此图，FE-017 未修）。

## Step 1 — 出图格式框定（本步已完成）

- 交付：`figure_code_audit.py` 增 C7/C8 且三项对照全过（负样本 C4/C7/C8 齐响、正样本归零、
  真源码三线零误报）；`figure_score.py` 三态判决 + 外部判决导入；
  `audit_figure_layout.py --csv`。下一步把这些写回 `docs/figure_spec.md` §一/§七。

## Step 2 — 按规范逐条落地（存量脚本与图件）

- 输入：本地 `outputs/<项目>/<线>/figures` + `outputs/system_logs` + 远端 `bin/<line>/`。
- 动作：① Python 图件逐个脚本跑几何审计收 CSV；② R 图件按"人工审查 + 登记"或补 R 审计；
  ③ 源码扫描三线保持 no issue；④ 打分全量 PASS（禁止 UNVERIFIED 进交付）。
- 验收：`figure_score.py --audit-csv … --code-csv …` 输出 `PASS=目标数 FAIL=0 UNVERIFIED=0`；
  负对照：回退任一 helper 后必须复现 FAIL。
- **阻断项**：R 图件的机器判决方案需主 Agent 决策（见 §待决策）。

## Step 3 — 布局与要素统一（SCI 主题层）

- 产出共享主题（R：`theme_bioanalys()` + base R 的 `fig_par()`；Python：统一 rcParams 主题），
  经 `layout_autoload` 自动挂载，脚本零改动生效。
- 验收：主题生效前后同一脚本产物**数值不变**（md5 对比仅限于纯样式变更；样式变更须逐张
  机器审计 + 目视登记），且 `figure_code_audit.py` 仍 no issue。

## Step 4 — 套美化包（替换手搓实现）

- 候选（远端已装，零安装）：R `ggrepel`（标签避让）/ `ggsignif`（显著性括号）/
  `patchwork`（组图）/ `viridis`（连续色）/ `ComplexHeatmap`（热图）/ `enrichplot`（富集）；
  Python `seaborn`（箱线/小提琴/条形主题）/ `adjustText`（已在用）。
- 纪律：每处替换先有 before/after 产物对比 + 数值一致性证明；一次只改一类。

## Step 5 — 高级组图

- 候选：line1 总览四联图（火山+MA+PCA+topvar）、line2 UMAP 网格（共享图例）、
  line3 逐样本空间组合图（域+目标基因+DR）。
- 需先在 `docs/figure_spec.md` 增补「组图契约」：面板编号 A/B/C、共享图例规则、
  对齐与间距、组合图命名与登记。**该节需用户确认后再实施。**

## 切片与派发表

| 切片 | 内容 | 归属 | 状态 |
|---|---|---|---|
| S1 | 格式框定（C8/C9 + 三态判决 + 判决导入 + 审计 CSV） | 主 Agent | 已完成 |
| S2 | Python 图件几何审计补齐（bulk_figures/pca_matrix/deg_limma/key_genes） | 子 Agent | 已完成（13 图 PASS） |
| S3 | Python 图件几何审计补齐（ml_hub/ml_model/external_validation，带真种子） | 子 Agent | 已完成（13 图 PASS） |
| S4 | SCI 主题层 | 主 Agent 设计 + 子 Agent 实施 | R 侧返工后收口（#192）；Python 侧 flag 门控已部署待验证 |
| S5 | 美化包替换（逐类，带 before/after） | 主 Agent 定清单 → 子 Agent 实施 | 侦察中（S5-scout） |
| S6 | 组图契约与三张组合图 | 需用户确认契约 | 未开始 |
| S7 | line2/line3 出图合规与补跑前置 | 子 Agent 侦察 | 侦察中（S6-scout） |

## 子 Agent 派发规程（2026-10-19 起，用户拍板）

**固定命令**（模型 + profile 都钉死，不再吃默认配置）：

```bash
cd <项目根> && HERMES_PROFILE=sw-engineer \
  "/c/Users/18765/AppData/Local/hermes/hermes-agent/.hermes/bin/hermes" \
  chat -m deepseek-v4.1-flash --provider a12 \
  --query-file <派发单绝对路径.md> --oneshot --in <项目根绝对路径>
```

- 为什么钉 `HERMES_PROFILE=sw-engineer`：子 Agent 因此能读到主 Agent 的 SOUL.md（含第八章
  派发契约）与 skills， persona 一致；不钉则落到默认 profile（根 config 的 `glm-5.3-flash`），
  契约全靠派发单文字撑着——S2/S3 就是这样跑的（结论已由主 Agent 逐条复核，见 #191）
- 为什么显式 `-m`：profile 的 config default 会被会话内切模覆盖，显式钉住可复现
- 后台跑 + `< /dev/null`： Windows 后台进程 stdin 不是 /dev/null 时会报
  "stdin is not a tty" 直接退出（2026-10-19 实测，V9 harness 同款坑）
- 派发单一律写文件（`--query-file`），不要内联长字符串：bash 引号 + 中文路径易错

【待主 Agent / 用户决策】

1. R 图件的机器判决怎么做（人工登记 / R 侧几何审计 / 两者并存）。
   **已实证范围**：`pca_matrix`、`deg_limma`、`wgcna_modules` 三个脚本是 R 出图，
   几何审计 `figs=0`；line1 共 6 张 R 图（`l1_02_pca_step3`、`l1_03_volcano_limma`、
   `l1_28`~`l1_31`）目前无机器判决，只能目视 + 登记。
2. Step 5 组图契约的具体条款（面板编号、共享图例、命名）。
3. `MAX_DATA_BYTES` 等门户参数（与出图无关，仍挂在 #189 遗留）。

【已闭环的坑（2026-10-19）】

- **FE-012**：打分系统三态判决 + 外部判决导入，B/D 不再默认满分。
- **#190**：几何审计种子硬编码污染 provenance → 工具加 `--seed`、用真种子修复四份报告、
  同种子复跑验证字节级一致。**教训：bash 通道的审计是真跑，副作用含重写报告与图件。**
- **#191**：D2/D3 归因依赖台账 outputs 声明 → 改源码静态映射（含动态名前缀模板）。
- **#192/#193**：R/Python 主题层两轮设计返工——模板层已实现同套规则、rcParams 被显式参数绕过。
  **教训：动手前先读现有挂载点做了什么，并用真实脚本做开关前后 md5 空转验证。**
- **#194**：C1 轴内图例判据加强（括号配平 + 裸调用识别），真源码 10 处违规现形。
- **#195**：交付报告引擎 STEP_CATALOG 键无 line 维度 + 15 处产物名不符 → 派 S7 修。

## 用户决策记录（2026-10-19，本计划范围内）

| # | 事项 | 决策 |
|---|---|---|
| 1 | S5-05 火山图加 top10 基因标签 | **不做** |
| 2 | S5-17 把已有 `perm_p` 标到 line2 组成箱线 | **做**（数据已在 `uns["composition"]["group_tests_json"]`） |
| 3 | F2/F3：二分类色值不统一 / `bulk_figures` 硬编码组名 | **修复** |
| 4 | Step 5 组图契约 | 面板编号 **A/B/C**；**共享图例**（规则待主 Agent 定义）；拼图**命名新号段** |
| 5 | 客户端出图排版选项 | **只保留 4:3 与 16:9 两档**，服务端出图代码同步适配（派 S8） |

### #5 的映射规则（主 Agent 定，S8 执行）

| 新 template_id | aspect | legend | axis_style | x 旋转 | 脚注栏 |
|---|---|---|---|---|---|
| `template_4x3` | 4:3 | outside_right / vertical | classic_L | auto_45 | False |
| `template_16x9` | 16:9 | bottom_center / horizontal | boxed | auto_45 | True |

- `template_4x3` ≡ 原 `template_1_nature_side`；`template_16x9` ≡ 原 `template_2_cell_wide`（逐字段相同）
- 旧 id 必须映射兼容：nature_side→4x3、cell_wide→16x9、clinical_note→4x3；
  现有项目 `PRJ_E2E_GSE277173` 用 `template_2_cell_wide` → 映射后**零视觉变化**
  （验收锚点：`l1_02_pca_step3.png` md5 仍 = `b9db6bd4cedd0d147ff246838fa487af`）

### 排队关系（文件冲突，不能并行）

- S5-00 正在改 `src/line*/scripts/*` 的图例调用；
- #2（S5-17）与 #3（F2/F3）也要改 `scrna_figures` / `bulk_figures` → **必须等 S5-00 交付并复核后**再派；
- S7（改 `ops/build_client_report.py`）与 S8（改模板四件套 + portal）与 S5-00 文件不重叠 → 可并行。

## Step 5 组图契约（用户决策 #4 落地：面板编号 A/B/C + 共享图例 + 新号段）

> 主 Agent 定义，2026-10-19。**实施切片未启动前，本节即为契约**；
> 任何组图实现必须逐条满足，缺一条即返工。

### G1 面板编号

- 编号用 **A/B/C…**（大写字母，一位起，超过 26 个面板才用 AA/AB）。
- 位置：面板**左上角外侧**，与面板顶边齐平；粗细 bold；字号 ≥10pt（大于图内正文 9pt）。
- 只标**有数据的面板**；装饰性色条/图例面板不编号。
- 编号文字用英文（图内中文禁用，§三）。

### G2 共享图例

- **同一色码语义只在图组出现一次**：若两个面板用同一组分类着色，只在**第一个面板**画图例，
  其余面板不画；后续面板靠编号与首面板的色彩对应。
- 共享图例位置：图组**下方居中**，横排（`legend_position=bottom_center`，横向），
  `frameon=False`；条目 >12 按列分组（沿用 `legend_out` 规则）。
- **分面/多子图例外**：seaborn/matplotlib 分面各自生成的图例**不合并、不搬迁**
  （§三之二既有规则，避免把分面挤扁）。
- 共享图例的**标题**：写清色码语义（如 `cell type` / `module`），不得只有色块。
- 图例与面板间距 ≥0.15in，且不得压任何面板（几何审计 B 项判据）。

### G3 命名与号段

- 组合图用**新号段**：`l<n>_<两位序号>_<语义>.png`，序号从该线当前最大号**顺延**
  （line1 现到 31 → 组合图从 `l1_32_*` 起；line2/line3 同理）。
- 语义必须点明"组合/总览"：词表限定 `overview` / `panel` / `summary`，
  例：`l1_32_deg_overview.png`、`l2_20_composition_panel.png`。
- **禁止**复用或挤占既有单图号段；单图仍是单图，组合图独立编号。
- 组合图必须在同步骤 report 里登记：由哪几张单图组成、各自的号、生成口径（§一元数据要求）。

### G4 组合方式（Python 侧）

- 用 `plt.subplot_mosaic` 或 `GridSpec`，**不引入 patchwork**（S5-scout §11：patchwork 是 R 包，
  Python 侧用原生网格即可，少一个依赖）。
- 面板间距用 `fig.subplots_adjust` 或 `constrained_layout`，横竖版分别满足 §一 的
  12x8 英寸基准与 300dpi；组合图按内容量定 figsize，模板只放大不缩小（#192 纪律）。
- 各面板的图注/说明统一由图组级 caption 承载（§三之二 caption 规则），
  不在每个子面板重复写。

### G5 验收（组合图的机器判据）

1. `figure_audit_scan.py`：DPI 300、最短边 ≥1200px、非空白、边缘无裁切。
2. `audit_figure_layout.py --runner bash`：A–E 全 PASS（组合图属多轴图，
   按既有规则**不搬图例**，只判文本收边与重叠）。
3. `figure_score.py`：C1（caption 登记）与 C2（命名）必须命中——组合图登记进
   `BioanalysDesktop/server/figures.js` 的 FIGURE_CAPTIONS 才算完。
4. 组成成分可追溯：report 里列出成员单图号。

```bash
python cn_debug/figure_code_audit.py --root src --csv cn_debug/code_audit.csv
python cn_debug/figure_audit_scan.py --dir outputs/<项目>/<线>/figures
python cn_debug/figure_score.py --dir outputs/<项目>/<线>/figures \
  --audit-csv cn_debug/figure_audit_line1.csv --code-csv cn_debug/code_audit.csv \
  --ledger-dir outputs/system_logs
# 远端几何审计（脚本必须用绝对路径）
ssh k40-ubuntu 'cd /mnt/ssd/bio_data && python3 ops/audit_figure_layout.py \
  --script /mnt/ssd/bio_data/bin/<line>/<step> --cwd projects/<项目>/<线>/processed \
  --runner bash --csv /tmp/audit_<step>.csv'
```
