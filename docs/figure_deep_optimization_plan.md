# 出图深度优化专题 · 阶段性长远目标设计稿

> version 1.1（设计稿） | 2026-11-04
> 状态：**待用户调优后自行 `create_goal` 长期运行**。本稿只做规划，不含实现代码。
> 授权：4 Argon 第三十轮裁定 `.tmp/argon30_full.txt`（Q1~Q5 全选 A）与第三十一轮裁定 `.tmp/argon31_full.txt`（Q1~Q4 全选 A），置信度均 100%。第三十一轮四项裁定已回填本稿：B2 渲染溯源元数据、3.2 铁律 5 批次量纲、C4 `preview_state=stale` 降级、D3 独占一轮。
> 上游订单：m04423、m04426（"特别是出图那一部分的优化，据目前现状来讲非常糟糕，需要开专题来深度优化修改"，"你为我设计好阶段性长远目标，我来调优后设置goal长期运行"）。
> 补充硬要求：m04576（"你要告诉他具体内容和结构啊，不然你搁那里空谈，他也不懂你说了啥啊"）。本稿因此把每个阶段的**具体动作、产出物、完成判据、阻塞边、红环**逐条写实。
> 代码基线：HEAD `cc21c99`，`git status --porcelain` 空，1406 tests / 1405 pass / 0 fail / 1 skipped，`npm run gate:all` 7 道全绿。本轮不改代码、不动 `ops/figure_ready_allowlist.json`、不创建 Goal。

---

## 一、这份稿子怎么用

| 你是谁 | 什么时候够这份稿 | 拿走什么 |
|---|---|---|
| 用户 | 调优阶段性目标、设置长期 Goal 前 | 第四节到第八节五阶段具体内容、第十节调优项、第十一节 Goal 建议 |
| 主 Agent（长期运行的每一轮开头） | 每轮开工前 | 第九节票图与当前票的阻塞边，先出阻塞者 |
| 主 Agent（每轮收尾） | 每轮 `code-review` 后 | 第九节每轮推进方式，回写阶段台账里本阶段完成判据的实测证据 |
| 4 Argon | 阶段门评审 | 第二节缺陷证据、第三节阶段门总表（出口判据）、第四节到第八节各阶段红环 |

**单一真源**：出图规范正文在 `reference/03出图规范/sci.md`；本稿只写**阶段、判据、依赖、证据索引**，不复述规范条文。`.tmp/round30.md` 是第三十轮汇报底稿，`.tmp/argon30_full.txt` 是裁定原文，二者被 `.gitignore` 的 `.tmp*/` 排除，随会话留存，供复盘。

---

## 二、起点：缺陷点位与量化取证

第三十轮用一次性侦察脚本 `.tmp/fig_recon*.cjs` 逐项实测，结论如下。每个缺陷簇在第四节到第八节挂到具体阶段。

### 2.1 数量基线

| 项 | 实测值 | 出处 |
|---|---|---|
| 模板池 | 82 条 | `src/figure_templates.json` |
| Ready | 30 条，全部有 source + preview + verified，`source_sha_match=30/30`、`preview_sha_match=30/30` | 同上 |
| 无母版 | 52 条 `source=null`（51 pending + 1 blocked_r453） | 同上 |
| Ready 母版分布 | `_meta/R453_compat` 15 / `L2_组学常用图` 14 / `L3_高级组合图` 1 | 同上 |
| 适配器覆盖 | `SUPPORTED_TEMPLATE_IDS` 30 个（`BioanalysDesktop/server/figure_adapters.js:6-37`），`R_OVERLAYS` 唯一 29 个（:173），`fig_l2p_umap` 由 `PYTHON_OVERLAYS.fig_l2p_umap`（:1314）复用 `fig_l2_umap` | 同上 |
| 产线图 | 21 个出图脚本 / 141 张（line1 35、line2 37、line3 69） | `docs/figure_spec.md:184-208` |
| 出图矩阵 | `{"total":28,"executed":27,"failed":0,"quarantined":1,"overall_status":"pass"}`，PDF 只判 `"PDF header passed; full validation not performed"` | `reference/05.可参考出图代码/_meta/script_plot_matrix.json` |
| 白名单 | `ops/figure_ready_allowlist.json` sealed 2026-11-03，`ids.length=30`，首 `fig_l1_boxplot`，末 `fig_l3_sankey` | 同上 |

### 2.2 六组缺陷簇

| 簇 | 缺陷 | 证据 |
|---|---|---|
| A 规范双真源 | `sci.md` v3.0 与 `docs/figure_spec.md` 在 6 类规则上直接冲突，且判断工具自身也冲突 | `sci.md:129` 严禁 `bbox_inches="tight"`（固定传 `bbox_inches=None`）、:162 物理尺寸核对、:161 三件套、:160 纯单图、:125 字号 6 至 7pt；`docs/figure_spec.md:13` 静态图统一 PNG（dpi=300，`bbox_inches="tight"`）且禁止 PDF/SVG、:15 12x8 英寸且字号 >=8pt、:24 标题注明来源、:82 `bbox_inches="tight"` 自动扩边、:19-24 同图多面板分面；`cn_debug/figure_code_audit.py:14` C6 把输出 PDF/SVG 判违规，与 `sci.md:161` 的 PDF 矢量母版要求正面相撞 |
| B 母版分叉 | main 与 compat 逐字节 `same=4/diff=2`，`compat_only=1`、`main_only=10`；测试硬编码绑 compat | `L2_core_code.R` main=`d60ecbf24668` / compat=`a8ae5c81ea4e`；`L3_sankey_code.R` main=`6c94fe74a105` / compat=`9f80d4b63e70`；`BioanalysDesktop/tests/wp33_figure_adapt.test.js:326` `master_sha256='a8ae5c81ea4e66546c40cd3d4f22609bb96dfe37febd0f21fd2b684daff04ad0'` |
| C 覆盖与假绿 | R 侧无几何审计；`figure_score.csv` 29 条 `l1_*` 全 `score=100 PASS`，与人工目视记录冲突；三件套缺 PDF / RDS-PKL | `ops/audit_figure_layout.py` 只覆盖 Python，且 :22/:92 写死"脚本统一 savefig.bbox='tight'"；`con_hf/figure_manual_review.md:54` "状态：6/6 未目视"、:57-58 "保持 UNVERIFIED，不得因看起来没问题改判 PASS"；`cn_debug/figure_score.py:270-277` 三态判决本身已写对"有未验证项 → UNVERIFIED" |
| D 无渲染后判决 | 视觉规则只停在源码层 | `artifacts/agent_tasks/figure_spec_audit_result.md` P1④ 原话："15 个模板判定结论：尺寸契约通过了机器验证，但视觉规则仅停留在源码层面一致，无渲染后像素级判决" |
| E 预览与元数据 | 预览是静态字节；`adapt_vars` 是中文描述字符串；模板缺 `figure_layout` | `portal/serve.mjs handleFigureTemplatePreview`（:710）直接 `readFileSync`（:735/:782）静态 PNG，改适配器零影响；`ops/build_figure_templates.cjs:355-466` 的 `adapt_vars` 值形如 `input_data: '项目本线只读输入文件路径，相对于本项目根目录'` |
| F 演进矛盾 | 30 Ready 白名单封死与 82 模板池长期演进 | `docs/figure_admission_sealed.md:12` 冻结 33 真待办、:14 不新增 CSV 槽位、:56 长尾、:61 明确冻结 22 个；`docs/final_closure_report.md:6/317/325` 终局裁定事件驱动静默待命，本专题订单 m04423/m04426 已解除该静默 |

### 2.3 决定次序的那条实测改判

第二十九轮已实测：母版 `L2_core_code.R` 的 `set.seed(42); n=4000; pvalue=runif(n); padj=p.adjust(...,"BH")` 得 `min_padj=0.540058`、`n_sig=0`，数学上不可能有显著点，这是"全灰无红蓝"的根因。只调配色重渲染仍是全灰。**结论：验收机（Phase B）必须排在母版重渲染（Phase C）之前**，4 Argon 第三十轮 Q2 裁定原话："验收先行、重渲染殿后是防止盲目调参重演全灰假图的唯一科学次序"。

---

## 三、总体结构

### 3.1 阶段依赖图（DAG）

```
A 规范统一与收敛
    │  产出：唯一强制真源 + 冲突矩阵 + 豁免迁移台账
    ▼
B 渲染后视觉与结构验收机建
    │  产出：可判 FAIL 的审计机 + 6 类变红样例集
    ▼
C 核心 Ready 模板母版重构与真机重渲染
    │  首个 tracer bullet：fig_l2_volcano（阻塞边 = A5 + B4）
    │  产出：30 个 Ready 真机重渲染 + 预览哈希回写
    ▼
D 产能扩展与按单受控准入
    │  产出：按真实订单逐批转 Ready 的四件套门禁
    ▼
E 长效防回潮门禁闭环
       产出：第 8 道门禁 + CI 同构 + 门禁自验红环
```

### 3.2 阶段门总表

| 阶段 | 名称 | 入口条件 | 出口判据（可检查且穷尽） | 阻塞边 |
|---|---|---|---|---|
| A | 规范统一与收敛 Spec Unification | 订单已授权 | 6 类冲突逐行有裁定、迁移窗口、责任阶段；`docs/figure_spec.md` 头部有指向 `sci.md` 与豁免台账的 context pointer；`gate:all` 7 道全绿 | 放行 B |
| B | 渲染后视觉与结构验收机建 Post-Render Visual & Structural Rigging | A 绿 | 6 类违规样例集全部判 FAIL；30 个 Ready 预览无假 PASS；6 张人工目视样本保持 UNVERIFIED；`gate:all` 7 道全绿 | 放行 C |
| C | 核心 Ready 模板母版重构与真机重渲染 | A + B 绿 | `figure_templates_parity.test.js` 全绿；`ids.length=30` 且 ID 集合与白名单恒等；预览哈希与 K40 产物逐字节一致；30/30 重渲染无 FAIL；`gate:all` 7 道全绿 | 放行 D |
| D | 产能扩展与按单受控准入 | C 绿 + 真实外部订单点名 | 每批 4/4 四件套齐备且留档；白名单每次变化可逐条追溯到订单号；被转 Ready 的行 source/preview/verified 全非空；`gate:all` 7 道全绿 | 放行 E |
| E | 长效防回潮门禁闭环 | D 绿 | 注入 6 类违规后 `--skip-tests` 在 120 秒内返回非 0 且点名第 8 道；样例移除后 8 道全绿；CI 与本地 GATES 清单逐条同构；`gate:all` 全绿 | 专题收口 |

**铁律（硬护栏，全程生效）**：
1. Phase C 全程 `ops/figure_ready_allowlist.json` 的 `ids.length` 恒等于 30，ID 集合绝对恒等，本阶段只重渲染与回写哈希。
2. Phase D 起按真实订单受控递增白名单，每次变更附订单号与授权字样，写入 `docs/final_closure_report.md` 补录日志。
3. 每阶段出口一律以 `npm run gate:all` 全绿收口，阶段台账回写实测证据后再进下一阶段。
4. 静默待命纪律承接 `docs/final_closure_report.md:317/325`：真实订单之外的主动开垦一律留给用户点名。
5. 画布量纲**按单次交付批次归属**：同批次内尺寸与档位统一，批次之间可变（第三十一轮 Q2 裁定）。裁剪或统一尺寸一律以批次为单位，不跨批次一刀切。

---

## 四、Phase A：规范统一与收敛（Spec Unification）

**目标**：让"一张图合规"只有一个答案。以 `reference/03出图规范/sci.md` v3.0 为顶层真源，把 `docs/figure_spec.md` 转为《141 张产线图兼容豁免与迁移台账》。

**为什么排第一**：规范不定，B 阶段的审计机不知道该判谁违规，C 阶段的重渲染不知道该往哪个尺寸收敛。先立尺，再量布。

### 具体动作

| 票 | 动作 | 落点 | 完成判据 |
|---|---|---|---|
| A1 | 给 `sci.md` 加版本头与适用范围声明：新产线图与 Ready 模板重渲染立即适用；存量 141 张经豁免台账按项目交付节奏迁移 | `reference/03出图规范/sci.md` 头部 | 头部写明 `version 3.0`、适用范围、迁移入口指向 A2 台账 |
| A2 | 把 `docs/figure_spec.md` 降级为兼容层：保留生产路径规则（`figures/` 目录、命名、dpi=300），逐条标注与 `sci.md` 的差异 | `docs/figure_spec.md` 头部与 §一 | 头部有 context pointer 指向 `sci.md` 与 A4 矩阵；6 类冲突每类有一节"兼容口径" |
| A3 | 裁定 `cn_debug/figure_code_audit.py:14` C6 冲突：拆为 C6a（交付图件禁 PDF/SVG，保留）与 C6b（矢量母版 PDF 允许，白名单） | A4 矩阵记裁定；C6a/C6b 的**实现**归 B3 | 矩阵里 C6 一行有明确裁定与责任阶段 B3 |
| A4 | 产出冲突矩阵 `docs/figure_spec_conflict_matrix.md`，每行 `{冲突点, sci.md 行号, figure_spec.md 行号, 受影响产线图数量, 裁定, 迁移窗口, 责任阶段}`；`迁移窗口` 一律按**交付批次**表述（第三十一轮 Q2 裁定） | 新文件 | 6 行齐备：`bbox_inches`、画布单位与档位、交付扩展名与三件套、图内字号、多面板与纯单图、标题；每行 7 个字段全填，无 `TBD`，`迁移窗口` 不含"全量"这种跨批次表述 |
| A5 | 定义审计机的输入契约：`ops/audit_figure_layout.py:22/:92` 两处"脚本统一 savefig.bbox='tight'"的假设改由 A4 矩阵驱动，写进矩阵的接口节 | A4 矩阵接口节 | 接口节写明审计机读取矩阵的方式、默认档位、`UNAVAILABLE` 的触发条件 |

**产出物**：`sci.md` 版本头、`docs/figure_spec.md` 降级后的兼容层、`docs/figure_spec_conflict_matrix.md`（6 行 + 接口节）。

**出口判据**：4 Argon 第三十轮 Q1 原话"避免 141 张既有产线图直接雪崩"。可检查面：A4 矩阵 6 行无未定义模糊地带；`docs/figure_spec.md` 头部 pointer 到位；`cn_debug/figure_code_audit.py` 静态审计对 141 张产线图无新增 FAIL；`npm run gate:all` 7 道全绿。

**红环**：往 A4 矩阵塞一行 `TBD`，`ops/ledger_gen.mjs --check`（第 4 道）或新增的矩阵完整性检查必须变红，且点名该行。

**刻意留白**：A 阶段只做文档层映射。C6a/C6b 的代码改动、审计机改造、母版改动全部归 B 与 C，避免 A 阶段借"顺手"提前动工。

---

## 五、Phase B：渲染后视觉与结构验收机建（Post-Render Visual & Structural Rigging）

**目标**：造一条对"这张图不合规"会变 **红** 的 `tight` 环。补渲染产物面判据，让源码层一致升级为像素级与结构级判决。

**为什么排在 C 前**：见 2.3。没有红环就重渲染，等于拿全灰假图再刷一遍配色。

### 具体动作

| 票 | 动作 | 落点 | 完成判据 |
|---|---|---|---|
| B1 | 建单一入口 `audit(path, profile) -> {verdict: PASS\|FAIL\|UNAVAILABLE, checks[]}`，覆盖源码静态面与渲染产物面 | `ops/audit_figure_visual.py`（或把 `ops/audit_figure_layout.py` 扩成 v2 后共用一个入口） | 两类输入都从同一入口进；`verdict` 三态齐全；`--check` 可批量跑 |
| B2 | 渲染产物面判据，承接 `sci.md:162/163`：PNG 按档位 58/88/130/180 mm 反算像素（dpi=300，宽 px = mm/25.4*300）、PDF 页框同档、PDF 字体 Type42 且无 Type3、图内标题为空、图例不出轴框、火山图色阶 Up 红 / Down 蓝 / NS 灰像素抽样；**并做渲染溯源校验** | B1 同一文件 + 产物旁 `<figure>_render_meta.json` | 6 项判据各有独立 `checks[]` 条目，任一缺失即 `UNAVAILABLE`；溯源 4 字段（`master_sha256` 母版字节哈希、`adapter_sha256` 适配器文件哈希、`rendered_at` ISO8601、`toolchain` 版本串）齐备且与仓库当前真源一致，缺字段或对不上直接判 `UNAVAILABLE`，绝不判 PASS |
| B3 | 补 `ops/audit_figure_artifacts.py`：三件套齐备（PDF / `_preview.png` / `_plot.rds` 或 `_plot.pkl`）、dpi=300、单文件 <=10MB、`05_figures/main/` 落位；同时落地 A3 的 C6a/C6b 拆分 | 新文件 + `cn_debug/figure_code_audit.py:14/:55-58` | 141 张产线图静态审计无新增 FAIL；矢量母版 PDF 命中 C6b 白名单后判合规 |
| B4 | 补 `tests/test_figure_layout_contract.py`，每类违规至少一个**变红样例**，先红后绿 | 新测试 + `tests/figure_red_samples/` 样例集 | 6 类样例齐备：色彩映射违规（橙代红上调点）、图例越界（外置图例被 bbox 裁切）、`bbox_inches="tight"` 裁小画布、三件套缺 PDF、分辨率 150dpi、C6 矢量母版误判；每个样例先红后绿且留 TAP 证据 |
| B5 | 把 `cn_debug/figure_score.py:270-277` 三态判决接到 B1：有 `UNAVAILABLE` 项即 `UNVERIFIED`；修掉 `figure_score.csv` 29 条 `l1_*` 全 `score=100 PASS` 的假绿 | `cn_debug/figure_score.py` + `con_hf/figure_score.csv` + `con_hf/figure_manual_review.md:57-58` | 6/6 未目视样本保持 `UNVERIFIED`；29 条假绿逐条改判并留 diff |

**产出物**：`ops/audit_figure_visual.py`、`ops/audit_figure_artifacts.py`、`tests/test_figure_layout_contract.py`、`tests/figure_red_samples/`（6 类）、`con_hf/figure_score.csv` 改判结果。

**出口判据**：4 Argon 第三十轮 Q2 补答原话"必须交付每类违规的红测样例集（色彩映射违规注入错误色阶用橙代红上调点、图例/边框越界注入外置图例截断或 bbox 裁切违规、三件套/分辨率缺失即拒收）"。可检查面：6 类样例全部判 FAIL；30 个 Ready 预览全部判 PASS 或 UNAVAILABLE，无假 PASS；任一产物缺 `master_sha256`/`adapter_sha256`/`rendered_at`/`toolchain` 四字段之一即判 `UNAVAILABLE` 而非 PASS；`npm run gate:all` 7 道全绿。

**红环**：把 B4 的橙色样例喂回 B1，`verdict` 必须为 `FAIL` 且 `checks[]` 点名色彩映射条目；把样例改回正确色后必须转 PASS。这条环必须秒级、确定性、Agent 可跑。

---

## 六、Phase C：核心 Ready 模板母版重构与真机重渲染

**目标**：让 30 个 Ready 模板的"代码、预览、验收"三者同源，且预览里真的看得见红蓝显著点。

### 6.1 首个 tracer bullet：`fig_l2_volcano`

**阻塞边**：A4（尺寸与色阶口径已裁定）、B4（红环已绿）。**这两条先绿，才动 C1**。4 Argon Q3 选它的理由：黄金数据集 4000 基因 / 245 显著点、明确红蓝诉求、三档阈值、变异反证最易量化。

一条链全通才算切块完成，结构如下：

```
母版  reference/05.可参考出图代码/_meta/R453_compat/L2_core_code.R
  ↓  sha256 登记
适配  BioanalysDesktop/server/figure_adapters.js  R_OVERLAYS.fig_l2_volcano
  ↓  产出字节
注册  src/figure_templates.json  source_sha256 / preview_sha256
  ↓  端点读取
预览  portal/serve.mjs  handleFigureTemplatePreview
  ↓  断言
验收  BioanalysDesktop/tests/wp33_figure_adapt.test.js:326  master_sha
  ↓  合规
审计  Phase B 的 ops/audit_figure_visual.py
```

| 票 | 动作 | 完成判据 |
|---|---|---|
| C1.1 | 母版数据缺陷修复：把 `runif(n)` + BH 得 `min_padj=0.540058/n_sig=0` 的假数据换成确定性黄金集（前 120 上调 `runif(1.6,3.2)`、后 120 下调 `-runif(1.5,3.0)`、240 个 `p=10^runif(-8,-3)` 再 BH），得 245 至 247 显著点 | `set.seed(42)` 下两次运行显著点数一致；`n_sig > 200` |
| C1.2 | 配色与阈值口径：Up=`#EE0000` / Down=`#3B4992` / NS=`#BEBEBE`；loose 0.5/p0.1、standard 1.0/p0.05、strict 2.0/p0.05；`use_adj_p` 派生 `effective_p_field` | K40 真机三档实测落在第二十九轮基线附近（loose up=247/down=249、adj up=124/down=122） |
| C1.3 | 走完整条链，回写 `source_sha256` / `preview_sha256` / `master_sha256` | 6 个环节逐一有实测输出，预览 PNG 与仓库字节一致，B1 判 PASS 或 UNAVAILABLE |
| C1.4 | 变异反证：把黄金集换回 `runif(n)`，红环必须变红（`n_sig=0` 或火山图无红蓝像素） | 换回后 B1 判 FAIL 且点名"无显著点"；换回黄金集后转 PASS |

### 6.2 其余 29 个 Ready

| 票 | 动作 | 完成判据 |
|---|---|---|
| C2 | 母版收敛：main 与 compat 的 `same=4/diff=2`、`compat_only=1`、`main_only=10` 收敛到单一真源，清掉 11 个孤儿副本；`wp33_figure_adapt.test.js:326` 的 `master_sha256` 改指向新真源 | 逐字节 `diff` 只剩 1 份母版；测试硬编码与真源一致 |
| C3 | 其余 29 个 Ready 各走一遍 C1 的链，批次台账 `docs/figure_ready_rerender_ledger.md` 每行 `{id, source_before, source_after, preview_before, preview_after, verdict, k40_job_id}` | 30 行齐备，每行 7 字段全填 |
| C4 | 预览端点同源化：`portal/serve.mjs handleFigureTemplatePreview` 从 `readFileSync` 静态字节升级为"注册哈希校验 + 可手动触发真机重渲染"，改适配器后预览可见变化；K40 不可达时**自动回落静态 PNG 并在响应元数据标 `preview_state=stale`**，不抛 503、不返回空白（第三十一轮 Q3 裁定） | 改一处 overlay 的配色常量后，预览端点返回的字节与 `preview_sha256` 同步变化；断掉 K40 后端点仍返回 200 且 `preview_state=stale`；静态 PNG 作为封板资产保留 |
| C5 | 矩阵与产物判据对齐：`script_plot_matrix.json` 的 `quarantined=1` 补判据，PDF 的 `"PDF header passed; full validation not performed"` 换成 B3 的产物面判据 | `ops/verify_plot_matrix.py` 在 K40 重跑 `{"failed":0,"overall_status":"pass"}`，PDF 条目带 Type42 与页框尺寸实测值 |

**产出物**：收敛后的母版、30 个重渲染预览、`docs/figure_ready_rerender_ledger.md`、`src/figure_templates.json` 新哈希、`portal/serve.mjs` 同源化端点。

**出口判据**：4 Argon Q4 原话"Phase C 全程锁死 30 集合恒等仅重渲染回写哈希"。可检查面：`BioanalysDesktop/tests/figure_templates_parity.test.js` 全绿；`ops/figure_ready_allowlist.json` 的 `ids.length=30` 且 ID 集合绝对恒等；`preview_sha256` 与 K40 产物逐字节一致；30/30 重渲染无 FAIL；`npm run gate:all` 7 道全绿。

---

## 七、Phase D：产能扩展与按单受控准入

**目标**：把 52 条 `source=null` 的模板按真实外部订单逐批转 Ready，每批都能演示、能验证、能追溯。

| 票 | 动作 | 完成判据 |
|---|---|---|
| D1 | 准入单据模板 `docs/figure_admission_order.md`：每单点名 `{模板 id, 真实项目/数据集, 期望图语义, 验收人}` | 单据 4 字段全填，缺字段的批次留在该批之外 |
| D2 | 每批四件套门禁：① 真实样例（项目数据，避免 `runif` 假数）② 适配器（`figure_adapters.js` 增 overlay 或 Python overlay）③ `script_plot_matrix.json` 加入口并在 K40 真机跑 ④ B1 自动化审验判 PASS | 每批 4/4 齐备且留档，缺任一件该批保持 pending |
| D3 | 结构化 `adapt_vars`：把 `ops/build_figure_templates.cjs:355-466` 的中文描述字符串改成 `{type, default, required, description}`；每条模板补 `figure_layout` 字段 `{size_preset, width_mm, height_mm, legend_position, caption_lines}`；`src/figure_templates.json` 同步且 `schema_version` 显式递增；**本票独占一轮、不与任何其他票并行**（第三十一轮 Q4 裁定：跨切面结构性变更须中间态可精确归因） | `ops/build_figure_templates.cjs --check` 绿；82 条模板的 `adapt_vars` 全为对象、`figure_layout` 全非空 |
| D4 | 挂单咬合：`BioanalysDesktop/server/figure_execution_plan.js:15 buildTaskExecutionSequence` 要求 `adapted === true`（:57）且 `depends_on_step` 在执行计划中（:60），每批新模板在 `meta.figure_tasks` 补条目并验证依赖闭包 | 每批新模板的 `buildTaskExecutionSequence` 返回 `ok:true`，`errors` 为空 |
| D5 | 白名单与审计回执：按 `docs/figure_pending_triage.md` 分类（actionable / blocked_upstream / excluded_out_of_scope），对齐 `docs/figure_admission_sealed.md:12/14/:56/:61` 的 33 真待办与 22 冻结；每次转 Ready 后更新白名单并追加 `docs/final_closure_report.md` 补录日志（理由 + 授权字样） | 白名单 ids 每次变化可逐条追溯到订单号；补录日志含授权字样；`npm run gate:all` 7 道全绿 |

**产出物**：`docs/figure_admission_order.md`、逐批四件套留档、结构化后的 `adapt_vars` 与 `figure_layout`、受控递增的白名单、补录日志。

**出口判据**：4 Argon Q4 原话"Phase D 依单据受控递增"，补充答"每批真实样例 + 适配器 + plot_matrix + 自动化审验四件套门禁并同步白名单与审计回执"。可检查面：每批 4/4 齐备；被转 Ready 的行 `source`/`preview`/`verified` 全非空；`npm run gate:all` 7 道全绿。

---

## 八、Phase E：长效防回潮门禁闭环

**目标**：把 B 阶段的红环固化进总门禁与 CI，让后续提交破坏出图规范时自动拦截。

| 票 | 动作 | 完成判据 |
|---|---|---|
| E1 | `ops/run_all_gates.mjs:40-47` 的 `GATES` 新增第 8 道 `figure_visual`，插在 `figure_registry` 之后、`metrics`（`slow:true`）之前，调 `ops/audit_figure_visual.py --check`；顺带修掉本文件既有文案不一（`:5` 与 `:116` 写"八道串联"、`:40` 实际 7 条、`:128` 输出"7 道全绿"） | `GATES.length=8`；`node ops/run_all_gates.mjs --skip-tests` 含第 8 道；任一 FAIL 即整体非 0 且点名道号；四处文案与实测道数一致 |
| E2 | `.github/workflows/ci.yml` 同步，保持"本地与 CI 100% 同构"：单 job `gate-all`、`ubuntu-latest`、`timeout-minutes: 20`、node 22、`node ops/run_all_gates.mjs --json`；CI 无真机的检查按 `HOST_UNREACHABLE_K40` 白名单原因跳过，`skip_reason_gate` 核验 | CI 与本地 `GATES` 清单逐条 diff 为空；CI 刻意不含 SSH/adb 的注释保留 |
| E3 | 门禁自验红环：把 B4 的 6 类变红样例固化为 `ops/run_all_gates.mjs` 自检项，每轮自验"注入违规样例 → 第 8 道必须红" | 注入后第 8 道红，移除后 8 道全绿；防止审计机自己腐化成假绿 |
| E4 | 120 秒拦截：定义快速面 `preflight → static_gate → figure_registry → figure_visual`（`--skip-tests`）从提交到报警 <=120 秒；全量面按 CI 单轮约 3 分钟、上限 `timeout-minutes: 20` | 注入违规后快速面在 120 秒内返回非 0 且点名第 8 道；实测墙钟时间留档 |
| E5 | retro：把本专题的机械失误（母版假数据、静态预览、C6 误判、`score=100` 假绿）写成确定性检查，判断题写进 `docs/coding-standards.md`，收口到 `docs/final_closure_report.md` 新一节 | 4 类失误各有对应确定性检查；补录节含五阶段落点表与收口基线 |

**出口判据**：`npm run gate:all` 8 道全绿；注入 6 类违规样例后快速面在 120 秒内变红；CI 与本地同构；补录日志归档。

---

## 九、票图与每轮推进方式

按 `docs/mattpocock-workflow-spec.md` 的 `to-tickets` 走 tracer bullet，每票声明阻塞边，先出阻塞者：

```
A1 → A2 → A4 → A3 → A5        （A4 是 A3 的裁定落点）
A5 ┐
B4 ┴→ C1.1 → C1.2 → C1.3 → C1.4    （首个可演示切块：火山图）
C1 ─→ C2 → C3 → C4 → C5
C5 ─→ D1 → D2 → D3 → D4 → D5
D5 ─→ E1 → E2 → E3 → E4 → E5
```

每轮开工：读本稿第九节票图里当前票的阻塞边，先绿阻塞者。每轮收尾：`code-review` 两轴（Standards 与 Spec）分开报，回写 `docs/figure_ready_rerender_ledger.md` 或阶段台账的实测证据，再 `npm run gate:all` 收口。每阶段门向 4 Argon 汇报一次，拿到裁定再进下一阶段（承接 m00001 第 8 条流程纪律）。

---

## 十、给用户调优的六项（推荐答案已附，"yes" 等于接受推荐）

第三十一轮已向 4 Argon 提出四项具体裁定并全部取回（Q1~Q4 全选 A，置信度各 100%），裁定正文见 `.tmp/argon31_full.txt` 与本轮汇报。**下表六项仍需用户本人调优**，4 Argon 的裁定只覆盖设计取舍，不代替用户对目标与轮数的设定。

| # | 调优项 | 推荐答案 | 理由 |
|---|---|---|---|
| Q1 | Phase A 豁免迁移窗口 | 存量 141 张随所属项目交付自然迁移，设具体截止日；新产线图与 Ready 重渲染立即按 `sci.md` v3.0 | 避免一次性雪崩，且新产物立刻受益 |
| Q2 | Phase B 审计机建法 | 扩展 `ops/audit_figure_layout.py` 成 v2 并新增产物面模块，保留单一入口 `audit(path, profile)` | 一个入口减少两套判据漂移 |
| Q3 | Phase C 预览端点 | 升级为"注册哈希校验 + 可手动触发真机重渲染"，静态 PNG 作为封板资产保留 | 既满足"改适配器能在预览看见"，又守住已有哈希证据 |
| Q4 | Phase D 是否解冻 `docs/figure_admission_sealed.md:12` 的 33 真待办 | 只在真实订单点名时逐条解冻，按 `docs/figure_pending_triage.md` 分类 | 承接事件驱动纪律，主动开垦交还给用户 |
| Q5 | Goal 轮数与粒度 | `max_goal_rounds=256`，一轮 = 一个 tracer bullet 或一个阶段门 | 与第二十九轮 Goal 同量级，边界清楚 |
| Q6 | "120 秒"口径 | 定义为快速面 `--skip-tests`，全量面按 CI 单轮约 3 分钟 | 可检查，且不与 `timeout-minutes: 20` 冲突 |

---

## 十一、建议的 Goal 配置（供用户复制后自行 `create_goal`）

本轮保留设计稿，待用户调优第十节六项后自行 `create_goal`。

```text
objective: 按 docs/figure_deep_optimization_plan.md 五阶段推进出图深度优化专题：
A 规范统一 → B 渲染后视觉与结构验收机 → C 30 个 Ready 母版重构与 K40 真机重渲染 →
D 按真实订单受控准入 → E 长效防回潮门禁闭环。
全程 Phase C 锁死 ops/figure_ready_allowlist.json 的 ids.length=30 与 ID 集合恒等，
Phase D 起按订单号受控递增；每阶段以该阶段出口判据 + npm run gate:all 全绿收口，
每轮开工先绿阻塞边、收尾回写阶段台账；
每阶段门与 4 Argon 汇报一次并取裁定；
收口后回写 docs/final_closure_report.md 补录节并汇报进入下一轮。
max_goal_rounds: 256
```

**每轮自检三问**：① 本轮票的阻塞边全绿了吗？② 本阶段出口判据的实测证据回写了吗？③ `git status --porcelain` 与 `gate:all` 收口了吗？

---

## 十二、证据索引（按需查阅，不复述正文）

| 主题 | 路径与行号 |
|---|---|
| 规范真源 | `reference/03出图规范/sci.md:120-164`（:125 字号与 Type42、:127 画布档位、:129 bbox 禁令与三件套、:160-163 自检清单） |
| 兼容层 | `docs/figure_spec.md:13/15/19-24/70/82/109/124/184-208/213-234/236-238/241-274/362/380` |
| 源码级判据 | `cn_debug/figure_code_audit.py:9-17/:55-58`（C1~C9） |
| 评分三态 | `cn_debug/figure_score.py:40/:54/:270-277` |
| 人工目视 | `con_hf/figure_manual_review.md:54/:57-58` |
| 几何审计 | `ops/audit_figure_layout.py:22/:92/:190` |
| 注册表与构建 | `src/figure_templates.json`、`ops/build_figure_templates.cjs:355-466` |
| 适配器与测试 | `BioanalysDesktop/server/figure_adapters.js:6-37/:173/:1314`、`BioanalysDesktop/tests/wp33_figure_adapt.test.js:326` |
| 门户预览 | `portal/serve.mjs:668/:710/:735/:782` |
| 挂单咬合 | `BioanalysDesktop/server/figure_execution_plan.js:15/:57/:60` |
| 门禁与 CI | `ops/run_all_gates.mjs:40-47`、`.github/workflows/ci.yml` |
| 准入与封板 | `docs/figure_pending_triage.md`、`docs/figure_admission_sealed.md:12/:14/:45/:56/:61`、`docs/final_closure_report.md:6/:317/:325` |
| 既有审计票 | `artifacts/agent_tasks/figure_spec_audit_result.md` P1④、`artifacts/agent_tasks/figure_audit_visual.md` |
| 裁定与汇报 | `.tmp/argon30_full.txt`、`.tmp/round30.md`、`.tmp/argon31_full.txt`、`.tmp/round31.md`（均被 `.gitignore` 排除） |
