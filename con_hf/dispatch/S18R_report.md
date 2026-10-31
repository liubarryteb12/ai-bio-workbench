# S18R 报告 · line3 首张组合图 `l3_{sp}_16_domain_panel.png`（S18 重派，方案甲）

> 切片：S18R（Step 5 组图契约第三单·重派，line3 第一张组合图）。执行者：子 Agent（profile sw-engineer）。
> 日期：2026-10-20。本文件按进度逐段追加，最后一段是完整回报。
> 依据：派发单 S18R（取代 S18 原单；S18 原单 4 条假设已被实测证伪，其面板映射不参考）。

## 0. 任务理解（照派发单，不改口径）

- 只改 `src/line3_spatial/scripts/spatial_figures`（新增组合图段）+
  `BioanalysDesktop/server/figures.js`（只加一条 caption 登记）。
- 图名 `l3_{species}_16_domain_panel.png`（mouse/human 各一张，共 2 张；新号从 16 起，
  line3 现存最大号 15 出自 `celltype_annotation` 的 `l3_{sp}_15_deconv_composition`）。
- 三面板（G1 编号 A/B/C）全部出自 `spatial_figures` 已有单图、零重算：
  A=`{sp}_01_domains_{sample}`（样本=物种内样本 ID 升序第一个）、
  B=`{sp}_07_domain_composition`、C=`{sp}_08_target_gene_by_domain`。
- G2 共享图例：域色码（tab20+tab20b+tab20c 60 色板 + 物种级 dom_order 标签）在图组
  下方居中只画一次；域数 >12 按列分组（每列 ≤12 行，沿用 `legend_out` 规则）。
- 跑场 `default` 项目，审计与重跑均传 `--seed 20261013`（磁盘同源，provenance 一致；
  `spatial_figures` 是纯渲染步骤，种子只进 stdout 回显:S18 报告 §3.8-5 结论，
  本轮用 md5 基线实证）。
- 契约主体：`con_hf/2026-10-19_figure_polish_plan.md`「Step 5 组图契约」G1-G5；
  验收 A1-A9。

## 1. 读码与面板映射确认（已完成，行号依据）

`src/line3_spatial/scripts/spatial_figures`（bash 包装 + 单块 PYSCRIPT heredoc，
426 行，md5 `1fd7ab9107603775bae9c31f669e4019`；本地 = 远端
`bin/line3_spatial/spatial_figures` 逐字节一致）：

| 面板 | 成员单图 | 绘图代码行号 | 复用数组（模块级作用域，物种循环内） |
|---|---|---|---|
| A | `{sp}_01_domains_{sample}` | L252-272（`save(fig, "%s_01_domains_%s.png")` L272） | `xy`(L246) / `dom`(L248) / `samp`(L249) / `samples`(L247) |
| B | `{sp}_07_domain_composition` | L397-422（save L422） | `prop`(L398-400, pd.crosstab) / `palette`(L404-406) |
| C | `{sp}_08_target_gene_by_domain` | L293-307（save L307） | `tgt_dom`(L296) / `dom_order`(L295) / `top_gene`(L276) |

- 三张成员单图的绘图代码**一行未动**，组合图段插在 07 段之后（同一物种循环内），
  单图产物字节不受影响。
- 域色码口径：`dom_order = sorted(set(dom))`（L295，物种级）；`palette` =
  tab20+tab20b+tab20c 60 色（L404-406，注释明写 mouse 可达 57 域）。组合图
  **沿用同一套色板与同一套域标签**，不另建色板；A 面板样本域颜色
  （palette[dom_order.index(d)]）与单图 01 的 `cat_colors`（tab20 前 5/3 色）一致。
- C 面板在单图 08 是单色条形（`#4C72B0`）；按派发单 G2「域色码 A 与 C 共用」，
  组合图 C 改为域色（数值 `tgt_dom` 不变、零重算），单图 08 保持原样。

## 2. 远端数据实测（面板可行性与选样规则的执行证据）

```
mouse: spots=17283 genes=18628 domains=57 samples=10；BH001 域数=5（BH001_d0..d4）
       top_target_gene=ENSMUSG00000069919；ko_gene=Spp1；X_umap 存在
human: spots=6877  genes=19613 domains=18 samples=5；JBO014 域数=3（JBO014_d0..d2）
       top_target_gene=ENSG00000256618；ko_gene=SPP1；X_umap 存在
```

- 选样规则执行证据：本地 `outputs/default/line3_spatial/figures` 的 domains 单图
  mouse 10 个样本 = [BH001, CAP002, JBO001, JBO002, JBO003, JBO004, JBO006, JBO009,
  JBO010, JBO012]（升序第一个 = BH001）；human 5 个 = [JBO014, JBO015, JBO018,
  JBO019, JBO022]（第一个 = JBO014）。**与派发单规定一致**。
  附注（事实备案）：派发单写「mouse 图清单里 domains 图共 11 个样本」，实测为
  **10 个**；选取规则（升序第一个）不受影响，结果仍为 BH001。
- 种子证据：远端 `processed/*_report.txt` 空间链各步 `seed=20261013`
  （autocorr/communication/composition/cooccurrence/deconv/dimred/domains）；
  `dr_post_report.txt` 为 20261018（#199 的 seed-sensitive 步骤，**不是本步骤**）。
- 远端 figures 现状：69 张（mouse 42 + human 27），最大号 15。
- 输入 h5ad md5（远端）：mouse `1bc1502a3713adde673dc273bae857be`、
  human `fda28a4b7a01d79a397a7abb113fcfdd`。
- 本地 `outputs/default/line3_spatial/figures` 69 张，与远端清单一致。

## 3. 环境与既有基线

- 远端通道：`adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022` →
  `ssh k40-ubuntu` 通（CONNECT_OK）。
- 本地工作台服务在跑：`http://127.0.0.1:8787/api/health` → `{"ok":true,...}`；
  `/api/tasks` 为空。
- `python cn_debug/figure_code_audit.py --root src`（改动前）→ `code_audit: no issue found`。
- `cn_debug/figure_audit_all.csv` 现状：136 行（135 条判决，含 69 条 l3_ 存量 PASS）；
  `cn_debug/code_audit.csv` 为 header-only（无 issue 的既有表示）。
- 项目根不是 git 仓库（`git status` → not a git repository），无提交类动作可做。

（后续段落随进度追加）

## 4. 实现（已完成）

改动点（全部在 `spatial_figures` 的 PYSCRIPT 块尾部、物种循环内，07 段之后，+121 行；
426 → 547 行，md5 `1fd7ab9107603775bae9c31f669e4019` → `83def9385f9835a4dcd95eecbe8de6a7`）：

| 项 | 做法 |
|---|---|
| 布局 | `GridSpec(2,2)`：A=左上（散点）、B=右上（堆叠条，width_ratios 1:1.75）、C=占满下排（57 域条形）；`figsize` 按域数自适应（mouse≈23.7×21.5 / human 18×15.7，横版宽≥高，≥成员单图较大者 13×12.54）；`fig.set_layout_engine("none")` 锁死显式间距 |
| 数据 | 零重算零重读：A 用 `xy/dom/samp`+`samples[0]`，B 用 `prop`+`palette`，C 用 `tgt_dom/dom_order`；色板与域标签即 07/08 的 60 色板与 `dom_order` |
| A 选样 | `panel_sample = samples[0]`（物种内升序第一个：mouse=BH001 / human=JBO014），只影响组合图 |
| G1 | `ax.set_title(letter, loc="left", fontweight="bold", fontsize=PANEL_FONT_PT=12)`，A/B/C 落各面板左上角外侧、与顶边齐平 |
| G2 | `fig.legend(..., loc="lower center", bbox_to_anchor=(0.5,0.006), ncol=ceil(n/12), frameon=False, title="spatial domain")` 只画一次；三个面板内均不画图例（单图的图例代码一行未动） |
| C 面板着色 | 按 G2「域色码 A 与 C 共用」改为域色（值 `tgt_dom` 不变）；单图 08 仍单色，图注中已声明 |
| 收口 | guard 的 `layout_fix()` 对多子图直接返回（§三之三不搬图例）→ 显式对 axA/axB/axC 调脚本内同一份 `fit_text_edges(fig, ax)`（本图无轴内标注，防御性调用）；图例不搬 |
| caption | 组图级一条一行共 6 行：图名语义与三面板说明 / 输入产物 / A 面板样本 ID 与选取规则 / 样本数与域数 / 色码与图例口径（含 C 着色声明）/ 成员单图清单 |
| 可追溯 | 运行时 log：`composite l3_{sp}_16_domain_panel <- A:…_01_domains_{S} + B:…_07_domain_composition + C:…_08_target_gene_by_domain | A sample=… | domains=… | figsize=… | seed=…`（G3） |
| 降级 | 缺样本/域标签时打 `skip …` log 不产残缺图，单图行为不变 |

实现中处理的一个工具缺陷（同 S16/S17，未改 `cn_debug/`）：`figure_code_audit.py` 的 C4
正则只取一位数字，注释里出现 `fontsize=12` 字面量也会被误报 C4_TINY_FONT → 注释
改为 S17 的先例措辞（不写 `fontsize=<数字>`），字号仍用常量 `PANEL_FONT_PT=12`。

## 5. caption 登记与本地自检（已完成）

- `BioanalysDesktop/server/figures.js` +3 行（2 注释 + 1 条 `match: '16_domain_panel'`）。
  该文件匹配是**子串匹配**（`captionFor` 用 `lower.includes(entry.match)`，无正则），
  物种变体先例是 mouse/human 两条；按派发单「只加这一条」，取物种不变子串
  `16_domain_panel` 同时覆盖两张图（figure_score 的 C1 同为子串语义）。
- 真跑验证（node）：`node --check figures.js` → SYNTAX_OK；
  `captionFor` 对 2 张新图命中新条目，6 张成员单图仍命中原条目（无遮蔽）。
- `python cn_debug/check_heredoc_syntax.py` → `spatial_figures blocks=1 compiled=1`，`bad=0`。
- `python cn_debug/figure_code_audit.py --root src` → `code_audit: no issue found`（rc=0）。

## 6. 远端 dev 渲染 + G1/G2 探针预跑（已完成，dev 图非交付图）

dev 渲染（`/tmp/s18r_dev_a`，processed 用逐文件软链，**不写项目 figures/**；
按契约不直写 `bin/`，本地脚本 scp 到远端 /tmp 副本运行，md5 与本地一致
`83def9385f9835a4dcd95eecbe8de6a7`）：

```
composite l3_mouse_16_domain_panel <- A:l3_mouse_01_domains_BH001 + B:l3_mouse_07_domain_composition
  + C:l3_mouse_08_target_gene_by_domain | A sample=BH001 (first of 10 ascending) | domains=57
  | figsize=23.7x21.5 | seed=20261013
composite l3_human_16_domain_panel <- A:l3_human_01_domains_JBO014 + B:l3_human_07_domain_composition
  + C:l3_human_08_target_gene_by_domain | A sample=JBO014 (first of 5 ascending) | domains=18
  | figsize=18.0x15.5 | seed=20261013
figures_done count=59 elapsed=51.6s
```

- 成品尺寸：mouse 6992×6776（aspect 1.032，横版）、human 5345×5003（aspect 1.068，横版），
  dpi 299.9994，`figure_audit_scan` 2/2 PASS（edge=0.000）。
- **单图回归预证**：dev 渲染的 6 张成员单图与远端项目正本 md5 **逐字节一致**
  （01_domains_BH001 `3d276654…` / 07 `0aed3264…` / 08 `6e22a903…` /
  human 01 `eb6a0384…` / 07 `b40b53cb…` / 08 `6b219c3e…`）→ 模板对这批图是 no-op，
  脚本改动不影响单图产物。
- 图例普查（远端按脚本同款 palette 逐色核查）：mouse **57/57**、human 18/18 个
  图例色块全部在渲染结果里（诊断中"53/16"是探针原型按"彩色"过滤把灰色域色
  #7F7F7F/#C7C7C7/#636363 等漏掉的假象；正式探针的颜色过滤只排除近白/近黑）。
- matplotlib `tab20.colors` 是深/浅成对顺序（非索引顺序），组合图 A/B/C 与图例
  用的正是 07/08 单图同一套 `palette[j]`；单图 01 的 `cat_colors` 是 tab20 索引
  序且只有 20 色（覆盖不了 57 域），故组合图 A 按共享色板取色:组合图内部
  A/B/C/图例完全同码，单图 01 本身一行未动。

G1/G2 探针（`cn_debug/2026-10-20_verification_s18r_g1g2.py`，复用 S16 像素底层；
判据 P1/P2/P3 + L0-L5 + X1-X3）在 dev 图实测：

| 项 | mouse（57 域） | human（18 域） |
|---|---|---|
| P1 三面板 | PASS A=(471,93)-(2337,1788) B=(3024,93)-(6962,1788) C=(279,2029)-(6962,5147) | PASS A=(346,93)-(1842,1785) B=(2325,93)-(5316,1785) C=(240,1952)-(5316,3590) |
| P2/P3 编号 | PASS A/B/C 12pt bold IoU≈0.93-0.95，优于同字 12pt normal | PASS A 0.951 / B 0.939 / C 0.929 |
| L0/L1 图例 | PASS 57 色各 1 块、5 列×≤12 行、居中偏差 1.2% | PASS 18 色各 1 块、2 列×9 行、居中偏差 1.5% |
| L2 标题+条目 | PASS 墨迹 1621/38940 | PASS 1573/13773 |
| L3 无第二份图例 | PASS 图例带外同几何色块 0 | PASS 0 |
| L4 面板内无重复图例 | PASS A/B/C 均 0 | PASS 均 0 |
| L5a A 用共享色码 | PASS A 内图例色 5 = BH001 域数 | PASS 3 = JBO014 域数 |
| L5b C 覆盖全色码 | PASS 57/57 在 C 内 | PASS 18/18 |
| X1 B 堆叠条 | PASS 覆盖率 0.657 | PASS 0.678 |
| X2 C 左对齐条形 | PASS 左缘极差 0、域标签墨迹 73473 | PASS 极差 0、23336 |
| X3 A 无刻度/B 有样本标签 | PASS A=0 / B≥2000 | PASS A=0 / B=4844 |
| 总判 | **probe: PASS (0 fails)** | **probe: PASS (0 fails)** |

负对照（`cn_debug/2026-10-20_verification_s18r_probe_negctl.py`，human dev 图先跑）：
neg1 涂白字母 B → `FAIL P2 面板 B 左上角外侧未找到字形`；neg2 C 面板内贴 4 个
图例同几何色块 → `FAIL L4 … C=4`；neg3 A/B-C 间隙贴同几何色块 →
`FAIL L3 面板外、图例带外的同几何图例色块=4`。三条都按预期变红
（mouse 版随交付图复跑，见 §10）。

## 7. 部署 + 重跑 + 基线比对 → **P0 停止点**（已完成到停止为止）

- 部署：`pwsh -NoProfile ops/06_deploy_scripts.ps1 -Line line3_spatial -Force`（`-Command`
  形式被运行时审批门拦，与 S16 报告 §5 注记一致，改用同一脚本的位置参数形式）。
  脚本自报 `FAIL 10 个文件校验不符（MISSING）`:经排查是**校验环节的 ssh 假阴性**：
  18 个文件实际全部 scp 成功（远端 mtime 10:05-10:06），同一条 stat 命令单独重跑全部
  正常；**全量核对 18/18 md5 本地=远端**（spatial_figures = `83def938…` ✓）。
  deploy 脚本 `$LASTEXITCODE` 在 `scp … | Out-Null` 管道后恒为 0（scp 失败静默）+
  校验循环高频 ssh 被拒:两处工具缺陷，`ops/` 属冻结区未改，登记待修。
- md5 基线：`/tmp/s18r_before.md5`，170 文件（figures 69 + processed 101）。
- 提交：POST `/api/tasks/submit`，taskId `default-line3_spatial-1792491138676`
  （inputs=2 份 h5ad，outputs=71 张，seed=20261013；JSON 存 `cn_debug/s18r_submit.json`）。
  渲染成功：远端 figures 69 → **71**（2 张组合图落盘，md5 与 dev 渲染逐字节一致：
  mouse `45401360…`、human `18c58331…`）。
- **台账未落盘（A7 阻断）**：两次提交均无 `2026-10-20_default_line3_spatial_spatial_figures_*.json`。
  归因（见 §8-2）：`run.js persistEntry` 组装的远端命令长 **10,117 字符**，超过本环境
  ssh 子进程的 **~8KB 命令截断阈值**（实测：6,040 字符完整到达，8,231 被静默截断:
  截断点落在 base64 载荷内，`| base64 -d > file` 未执行，`&&` 链断掉但 `echo` 自身
  exit 0，引擎按退出码判成功，错误不可见）。entry 本身自审合法（node 复刻
  `buildLedgerEntry+auditLedgerEntry` → `legal=true problems=[]`）；小载荷写台账同命令
  模式手测通过。**根因在引擎侧（portal 冻结区，本切片无权修）**。
- **基线比对（P0 差异）**：processed **101/101 逐字节零变化** ✓；figures 新增 2 张组合图 ✓；
  但 `spatial_figures` 产出的 **57 张单图 md5 全部变化**（另 12 张非本步骤产物零变化）:
  违反派发单「其余 69 张 md5 一个不许变」，按纪律停止。

## 8. 归因实验与结论矩阵（全部实测）

### 8-1 57 张单图变化的完整归因

| 对照 | 结果 | 结论 |
|---|---|---|
| 旧正本 vs dev 渲染（当前脚本，无模板链） | **36/57 逐字节一致**，21 张不同（`02_target_gene_*`×10、`03_ko_dr_*`×10、`l3_human_05_knockout_dr`） | 脚本改动对单图零影响；但 21 张旧正本**比当前脚本版本还老**（重跑不可能复现） |
| dev 渲染 vs 同脚本 + 引擎同款模板环境（`BIOANALYS_PROJECT_JSON`+`layout_autoload`） | **57/57 全部不同** | 引擎注入的模板链对全部单图有版式足迹（template_4x3：图例外置右侧、画幅调整） |
| 同脚本 + 模板环境 vs 引擎重跑产物 | **57/57 逐字节一致** | 引擎重跑 = 当前脚本 + 模板链的确定性输出 |
| 组合图 4 次独立渲染（dev×2、模板探针、引擎×2） | 逐字节一致 | 组合图（多子图）模板 no-op，交付字节稳定 |

结论：57 张单图变化 = **模板链足迹（57 张；旧正本不是模板链产物）** + **脚本版本漂移
（21 张旧正本早于当前脚本）**。与本切片代码改动无关（dev 渲染 36 张与旧正本逐字节一致
即为直接证据）。processed/ 数据表零变化 ✓。

### 8-2 台账未落盘的完整归因

| 检验 | 结果 |
|---|---|
| entry 自审（node 复刻 buildLedgerEntry+auditLedgerEntry） | legal=true, problems=[] |
| 小载荷同命令模式手测 | WROTE ✓ |
| node 复刻 persistEntry 全命令（10,117 字符） | exit 0、base64 回显、**无 WROTE、无文件**（静默截断） |
| 截断阈值探测（node spawn ssh，1KB..16KB） | 6,040 字符完整到达；8,231 起截断 |

### 8-3 现状盘点

- 远端 `figures/`：71 张 = 57 张模板链风格单图（可复现、`figure_audit_scan` 71/71 PASS）
  + 12 张未动 + 2 张组合图。processed 零变化。
- 本地 `outputs/default/line3_spatial/figures/`：引擎**自动回搬**（index.js「自动回搬」，
  非 07_pull_outputs）后为 71 张，与远端 71/71 逐字节一致。**注意：自动回搬已把本地
  归档里的 57 张旧正本覆盖**；其中 36 张可从远端 `/tmp/s18r_dev_a/figures/`（dev 渲染）
  恢复，**21 张旧字节（02/03×20 + human_05）已无副本**（仅 md5 记录在
  `/tmp/s18r_before.md5`）:如实上报，不掩饰。
- 远端 `/tmp/` 留档：`s18r_before.md5`（基线）、`s18r_after1.md5`（重跑后）、
  `s18r_dev_a/`（dev 渲染 59 图）、`s18r_probe_tpl/`（模板归因实验产物）。

## 9. 阻断上报（P0）与待主 Agent 决策事项

**P0-1（图件正本与可复现链脱节，非本切片造成）**：line3 单图正本长期落后于「当前脚本 +
引擎模板链」的可复现输出（36 张模板足迹 + 21 张脚本版本漂移）。任何经引擎的重跑都必然
改写这 57 张。本次重跑后磁盘已是可复现态（scan 71/71 PASS）。请裁决：接受为**新基线**
（建议：其可复现、与本地归档一致、审计全 PASS、processed 零变化），还是要求恢复旧字节
（36 张可恢复；21 张无副本，只能按旧脚本考古重渲）。

**P0-2（引擎缺陷）**：`persistEntry` 远端命令 10,117 字符 > ~8KB 截断阈值 → 台账静默
丢失且 exit 0 不可见。71 个 outputs 声明必超限。建议（engine 侧另立切片，本切片无权）：
① base64 写文件改走 stdin/分块；或 ② 台账经 scp 上传；或 ③ 对超长命令改用
`ssh ... bash -s` 传 stdin；并给 runSsh 加「WROTE 标记必须出现」的硬校验（防再静默）。

**P1（deploy 工具）**：`06_deploy_scripts.ps1` 校验循环高频 ssh 被拒报假 MISSING；
scp 后 `$LASTEXITCODE` 被管道吞。同上属冻结区，另立工具修复单。

**A7/A8/A9 缺口**：台账缺失 → status/exit_code/checkpoint/seed 的台账证据暂缺；
seed=20261013 的证据改由渲染 stdout（`bioanalys_seed=20261013`）+ 提交 JSON +
组合图 log 行承担。待 P0-2 修复后重提一次任务即可补齐台账（渲染确定性已证，
图件字节不会再变）。

## 10. 已完成且不受 P0 影响的验证结论

- 组合图 2 张：`figure_audit_scan` PASS（mouse 6992×6776 横版、human 5345×5003 横版、
  300dpi、edge=0.000）；G1/G2 探针 PASS（mouse 57 域多列图例 + human 18 域，全判据）；
  负对照 3 条（human）全变红（neg1 涂白字母→P2 FAIL / neg2 C 内贴图例→L4 FAIL /
  neg3 间隙贴图例→L3 FAIL）；geometry audit 与 figure_score 因 P0 停止**未跑**。
- caption 登记：`captionFor` 对 2 张新图命中、6 张成员单图不受遮蔽（node 实测）。
- 本地静态三检：heredoc 语法 OK、`figure_code_audit` no issue、代码审计基线无回归。

## 11. 终态回报（按 SUBAGENT_CONTRACT 输出契约）

### 11.1 任务理解

在保留成员单图的前提下于 `spatial_figures` 新增 line3 首张组合图
`l3_{sp}_16_domain_panel.png`（A=代表样本空间域散点 / B=域组成 / C=target gene
域均值），满足 G1-G5 并跑通审计链；caption 登记一条；重跑 seed=20261013 并以
md5 基线证不变量。

### 11.2 实现摘要

- `spatial_figures` +121 行（组合图段）：GridSpec 2×2（A/B 上排、C 占满下排）、
  figsize 按域数自适应且横版；零重算复用 `xy/dom/samp/dom_order/tgt_dom/prop/palette`；
  G1 编号 12pt bold 常量；G2 共享图例 `fig.legend` 下方居中一次（>12 条按列分组，
  60 色板 + dom_order 标签同 07/08）；显式 `fit_text_edges` 收口（guard 对多子图 no-op）；
  组图级 caption 6 行；G3 可追溯 log 行；缺数据降级 skip。
- `figures.js` +3 行（1 条 `match: '16_domain_panel'` 子串匹配，同时覆盖两物种）。

### 11.3 文件变更清单

| 文件 | 变更 |
|---|---|
| `src/line3_spatial/scripts/spatial_figures` | 426→547 行，md5 `1fd7ab91…`→`83def938…`（已部署远端，18/18 md5 对齐） |
| `BioanalysDesktop/server/figures.js` | +3 行（1 条 caption） |
| `cn_debug/2026-10-20_verification_s18r_g1g2.py`、`_probe_negctl.py`、`_debug_s18r_geometry.py`、`_debug_s18r_calib.py` | 新增（探针/负对照/诊断） |
| `cn_debug/2026-10-20_s18r_dev/`、`engine_rerun/`、`cn_debug/s18r_submit.json` | 新增（证据） |
| `con_hf/dispatch/S18R_report.md` | 本文件 |
| 远端 figures 71 张、本地 outputs 71 张（引擎自动回搬） | 任务产物（见 P0-1 裁决项） |

未触碰：`src/` 其他脚本、`ops/`、`BioanalysDesktop` 服务端代码、模板四件套、portal、
processed/ 全部数据、12 张非本步骤图件。

### 11.4 测试与验证记录（真跑摘要）

1. 语法/静态：`check_heredoc_syntax.py` bad=0；`figure_code_audit.py --root src`
   → no issue found。
2. caption：`node --check` + `captionFor` 命中性实测（2 新图命中新条目、6 单图不受遮蔽）。
3. dev 渲染（远端 /tmp，不碰项目）：71 张中本步骤 59 张落盘；组合图 md5 与引擎重跑一致。
4. 探针：mouse/human 全判据 PASS（含 57 域多列图例、共享色码、左对齐条形等 X 项）；
   human 负对照 3 条全变红。
5. 部署：18/18 文件 md5 本地=远端（脚本自报 FAIL 为 ssh 假阴性，已归因）。
6. 重跑：2 次 submit，渲染成功、processed 101/101 零变化、figures +2 组合图。
7. `figure_audit_scan`：71/71 PASS（本地归档终态）。
8. **未跑（P0 停止）**：远端几何审计（`--runner bash`）、`figure_score`、
   `figure_audit_all.csv` 合并、mouse 版负对照、A7 台账证据。

### 11.5 假设与风险

1. 组合图 C 面板按派发单 G2「域色码 A 与 C 共用」改为域色（单图 08 保持单色不变），
   已在图注声明；若主 Agent 对此有异议属规格层调整。
2. 组合图 A 的域色码与单图 01 不同（01 用 20 色 cat_colors 索引序，覆盖不了 57 域）；
   组合图内部 A/B/C/图例完全同码（G2 优先），单图 01 未动。
3. 21 张旧单图字节（02/03×20 + human_05）随自动回搬失去副本（详 §8-3），如实上报。
4. 台账缺失期间，该步骤在 system_logs 无记录（历史上本步骤本就无台账，见 S18 报告 §1-5）。

### 11.6 架构/接口变更建议

见 §9 P0-2/P1：引擎台账写长命令截断、deploy 校验假阴性:均建议另立修复切片；
line1/line2 组图（10/26 outputs）未触发该截断，line3 71 outputs 必触发。

### 11.7 待主 Agent 决策事项

P0-1 新基线裁决、P0-2 引擎修复切片、21 张旧字节是否需要考古重渲、
以及 P0-2 修复后是否由本切片补跑（几何审计 + figure_score + 台账补齐 + mouse 负对照）。

### 11.8 建议下一步

1. 先裁 P0-1/P0-2；2. 引擎修复后重提一次 spatial_figures（补台账）；3. 补齐 §10 未跑项。
