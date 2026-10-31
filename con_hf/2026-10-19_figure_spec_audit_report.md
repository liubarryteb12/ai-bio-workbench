# 2026-10-19 · 出图规范全量核查报告

**核查对象**：`docs/figure_spec.md`（v2.2）、`aims/aims.txt` 第五章、`src/` 三线 21 个出图脚本、
本地已生成图件（`outputs/PRJ_E2E_GSE277173/line1_bulk/figures/`，30 张）。

**核查方式**：文档逐条比对 + 源码静态扫描（`cn_debug/figure_code_audit.py`）+
渲染期几何审计（`ops/audit_figure_layout.py`）+ 交付物逐张扫描（`cn_debug/figure_audit_scan.py`）+
五维打分（`cn_debug/figure_score.py`）+ 逐张目视复核。

---

## 一、规范文档核查项清单

| # | 核查项 | 结果 | 说明 |
|---|---|---|---|
| 1 | 图件落点与命名规则是否明确 | PASS | §一 现明确"一律 `<line>/figures/`"，并规定命名格式与 a/b 分号 |
| 2 | DPI 与文件格式规定 | PASS | 300 DPI PNG；PDF/SVG 仅可选副本（2026-10-19 修订收紧） |
| 3 | 字号下限 | PASS | >=8pt，且对 R 的 `cex` 给出换算说明（0.75 × 12pt = 9pt） |
| 4 | 图例位置规则 | PASS | 一律轴框外；v2.3 起补充"源级也不得写轴内 loc" |
| 5 | 图注位置与排列 | PASS | 横版下方 / 竖版右上，一条一行；R 端由模板统一左对齐 |
| 6 | 阈值线标注避让 | PASS | §三之三 规定 p 阈值贴左内缘、log2FC 竖排放顶部 |
| 7 | colorbar label 要求 | PASS | §三之二 硬约束，已落实到 WGCNA 热图等 |
| 8 | 二分类配色 | PASS | ctrl `#3B4992` / case `#EE0000`，v2.3 补充"角色不得脱钩" |
| 9 | 虚拟敲除角标 | PASS | `[Virtual KO - DR Genes]` 强制 |
| 10 | 机器验收命令 | PASS | `ops/audit_figure_layout.py`，A-E 判定 + 负对照纪律 |
| 11 | **SCI 期刊格式对应关系** | **原有缺口 → 已补齐** | 新增 §6.1 核对表，逐条映射期刊通用要求到本规范条款，并标明哪些不覆盖（投稿前需按目标期刊人工核对） |
| 12 | **质量打分与达标阈值** | **原有缺口 → 已补齐** | 新增 §七：5 类 20 项、满分 100、>=75 达标、4 项一票否决 |
| 13 | **"vs" 的语义** | **原有缺口 → 已补齐** | 新增 §八 分组与比对契约；aims 新增 §5.4 同口径 |
| 14 | 分组/方向来源是否规定 | **原本缺失 → 已补齐** | 原规范未规定 case/ctrl 从哪来，导致 WGCNA 硬编码组名（见台账 FE-001） |
| 15 | 与前端/客户端契约一致性 | PASS | `figures.js` caption 登记表与图件命名一一对应，新增 4 条 caption |
| 16 | 与前期约定（`con_hf/`）一致性 | PASS | 本轮结论已回写踩坑台账 #180-#182、handoff、操作台账 |

---

## 二、发现的问题点明细（含严重等级）

| ID | 严重等级 | 优先级 | 问题 | 影响 |
|---|---|---|---|---|
| P-01 | **高（阻塞交付）** | P0 | `wgcna_modules` 硬编码 `== "LS"` 定 trait 方向，未读 project.json contrasts；且把 LS/NLS 压成单一 0/1 列，违反"vs = 组间比对" | 换项目时方向静默颠倒；图注无法说明依据；模块-表型相关结论可能整体反向 |
| P-02 | 中 | P1 | 8 处图例写在轴内（`loc="best"/"upper right"/"lower right"`），分布在 5 个脚本 | 类别多或数据占满绘图区时图例压数据，违反 v2.2 既定条款 |
| P-03 | 中 | P1 | `cox_analysis` 森林图 `cex=0.65~0.7`，低于 8pt 下限 | 印刷/传输后不可读 |
| P-04 | 高（已在前轮修，本轮确认落地） | P0 | 3 个步骤曾把 PDF 图写进 `processed/` | 工作台图廊不可见；违反 PNG 300dpi 交付约定 |
| P-05 | 低 | P2 | 规范缺少 SCI 期刊格式映射、质量打分、"vs" 契约三块内容 | 检查标准不统一，靠肉眼与记忆 |
| P-06 | 低 | P2 | R 端 ggplot caption 默认右对齐，与"横版左下起"不一致 | 图注起点漂移（已由 `layout_helper.R` 统一修正） |

**所有 P-01 ~ P-06 均已修复。** 详见 `con_hf/figure_error_ledger.md` FE-001 ~ FE-012。

---

## 三、可落地修改建议（已执行）

1. **WGCNA 分组改为契约驱动**（`src/line1_bulk/scripts/wgcna_modules`）
   - 读 `BIOANALYS_PROJECT_JSON` 的 `grouping_design.contrasts`，取主对比对定 case/ctrl；
   - 性状矩阵按组展开：主对比对一列 `case=1/ctrl=0` + 每组指示列，模块与每列分别算相关；
   - 无契约时按字典序派生，并在 `wgcna_report.txt` 打印 `trait_source` 与 `primary_contrast`；
   - 图注固定三要素：对比对名、case/ctrl 名、trait 来源。
2. **补齐规范三块内容**
   - `docs/figure_spec.md`：§6.1 SCI 核对表、§七 打分系统、§八 vs 契约；
   - `aims/aims.txt`：§5.4 vs 契约、§8 表同步。
3. **源码违规全清**：8 处轴内图例 → 轴框外；R `cex` 提至 >=0.75。
4. **三个检查工具常驻**
   - `cn_debug/figure_code_audit.py`：源码 C1-C7；
   - `cn_debug/figure_audit_scan.py`：交付物 6 维；
   - `cn_debug/figure_score.py`：五维百分制 + 一票否决。
5. **caption 与图件登记同步**：`server/figures.js` 补 4 条；报告 STEP_CATALOG 补新图声明。

---

## 四、验证结果（全部真跑）

| 检查 | 命令 | 结果 |
|---|---|---|
| 源码静态扫描 | `python cn_debug/figure_code_audit.py --root src` | **no issue found**（修复前 23 处） |
| 渲染期几何审计 | 远端 `audit_figure_layout.py --runner bash`，line1 富集 / ML hub | **4 图 fail=0** / **10 图 fail=0** |
| 交付物逐张扫描 | `python cn_debug/figure_audit_scan.py --dir .../figures` | **30 张 PASS**（DPI/面积/边缘/非空白全过） |
| 五维打分 | `python cn_debug/figure_score.py --dir .../figures` | **figs=30 PASS=30 FAIL=0 avg=100.0**（阈值 75） |
| WGCNA 专项 | 远端重跑 `wgcna_modules`，读 `wgcna_report.txt` | `trait_source=project.json grouping_design`<br>`primary_contrast=LS_vs_NLS (case=LS vs ctrl=NLS)`<br>ledger `completed`，图件落 `figures/` |
| 回归 | 重跑 enrichment_figures / bulk_figures / ml_hub_analysis | 3 步均 `running=0`，30 张图复扫仍全 PASS |
| 前端单元测试 | `npm test`（BioanalysDesktop） | **227/227 pass** |

**WGCNA 图注实测**（`l1_29_wgcna_module_trait.png` 底部）：

```
line1: module-trait correlation | contrast LS_vs_NLS (case=LS vs ctrl=NLS)
| trait source=project.json grouping_design | n=16 samples, 40 modules
```

x 轴标签已由含糊的 `Group` 改为对比对名 `LS_vs_NLS`。

---

## 五、剩余风险与未覆盖项

1. **打分系统 B/D2/D3 项默认给满分**：`figure_score.py` 目前把需外部判定的项记为满分，
   属"待外部输入"而非"已验证"。下一步改为 `--audit-csv` 显式导入几何与源码扫描结果，
   无输入时标记 `unverified`。（台账 FE-012，待修）
2. **line2 / line3 未用真实数据重渲染**：源码已修，但项目无这两线数据，几何审计未跑。
3. **SCI 期刊专属要求不覆盖**：目标期刊 `author guidelines`、文件类型、栏宽、版权协议需交付方人工核对（§6.1 已标明）。
4. **base R 图件不套三模板**：`png()` 设备无法套 ggplot 模板，仅保证 300 DPI 与图注规范。
