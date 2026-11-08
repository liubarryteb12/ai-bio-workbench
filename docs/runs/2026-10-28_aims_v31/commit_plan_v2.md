# T-CORE-04 提交边界只读审计 v2

审计时间：2026-10-28（会话内即时快照）  
分支：`master`，HEAD：`4ae8c7c`  
状态条目：当前 `git status --porcelain=v1 -uall` 为 1790 条（含本报告新增 1 条）。  
本报告为只读审计产物，未执行任何 `git add`、`commit`、`reset`、`clean` 或其他写树命令。

## 结论速览

1. **T-FT-05 本轮改动不能作为一个单独安全提交直接落地。** 核心原因是 `BioanalysDesktop/server/index.js`、`BioanalysDesktop/server/task.js`、`BioanalysDesktop/src/App.tsx` 和 `portal/index.html` 是共享耦合文件，同一文件内同时包含 T-FT-05 派生执行逻辑与 8787 端口预检、模板选择器、图库入口、Sync 状态机等并行工作。整文件暂存必然把多个工作流混入同一提交。
2. 但 T-FT-05 的核心代码、注册表和 6 个 ready 模板的真实输入适配是自洽的。如果把共享文件按 hunk 拆分，只保留 T-FT-05 相关行，再把 6 份 K40 执行台账作为证据一并纳入，则可以形成一个语义完整、边界干净的独立提交。
3. 当前 `reference/` 目录整体被 `.gitignore` 第 43 行忽略。6 个 ready 模板引用的母版源码全部位于该目录下，因此在当前规则下这些母版无法进入版本控制，任何新环境克隆都无法通过模板注册表校验。这是提交前必须由用户或后续提交解决的独立阻断项，与 T-FT-05 本轮代码质量无关。
4. 当前工作树混有大量历史并行改动（约 1700+ 条），包括 `src/line*` 三线分析脚本、`artifacts/` 历史验证产物、`cn_debug/` 历史调试数据、启动器编码修复、图库/Sync/模板选择器前端改动等。这些内容必须按各自的原子边界另行提交，禁止混入 T-FT-05 提交。

## 一、T-FT-05 能否独立安全提交

### 1.1 本轮 T-FT-05 的真实代码面

T-FT-05 的目标是让 6 个 `ready` 图模板从合成数据切换为读取各自真实项目表或 h5ad，并在 K40 上完成闭环验证。涉及以下工作：

| 层 | 文件 | 性质 | 是否需 hunk 拆分 |
| --- | --- | --- | --- |
| 适配器核心 | `BioanalysDesktop/server/figure_adapters.js` | 新增，纯 T-FT-05 | 否 |
| 派生执行 | `BioanalysDesktop/server/task.js` | 修改，混合 T-FT-05 与并行工作 | 是 |
| API 编排 | `BioanalysDesktop/server/index.js` | 修改，混合 T-FT-05 与图库/8787/模板路由 | 是 |
| 图模板图 | `BioanalysDesktop/server/figure_graph.js` | 新增，T-FT-03/04/05 共享 | 否 |
| 前端适配卡 | `BioanalysDesktop/src/App.tsx` | 修改，混合 T-FT-05 与结果区/图库 UI | 是 |
| 前端样式 | `BioanalysDesktop/src/app.css` | 修改，`FigureAdaptCard` 相关样式 | 是（可选） |
| 注册表 | `src/figure_templates.json` | 新增，T-FT-03/04/05 共享 | 否 |
| 注册表生成器 | `ops/build_figure_templates.cjs` | 新增，T-FT-03/04/05 共享 | 否 |
| 测试（核心） | `BioanalysDesktop/tests/figure_adapters.test.js` | 新增，纯 T-FT-05 | 否 |
| 测试（集成） | `BioanalysDesktop/tests/figure_templates_parity.test.js` | 新增，混合 T-FT-03/04/05 | 否 |
| 测试（集成） | `BioanalysDesktop/tests/wp33_figure_adapt.test.js` | 新增，混合 T-FT-03/04/05 | 否 |
| 测试（任务层） | `BioanalysDesktop/tests/task.test.js` | 修改，新增 adapted 任务与 seed 测试 | 是 |
| 项目台账 | `local_projects/PRJ_AIMS_V3_20261027/handoff.md` | 新增，T-CORE-02 与 T-FT-05 共享 | 否 |
| 裁定记录 | `con_hf/SPEC_DECISIONS.md` | 修改，混合 T-CORE-01 与 D-26 | 是 |
| K40 证据 | `con_hf/runs/2026-10-28_aims_v31/real_input_adapters/` 下 9 个文件 | 新增，纯 T-FT-05 | 否 |

### 1.2 判定

**当前状态下：不能直接提交。** 原因：

1. `task.js` 和 `index.js` 的 diff 均超过 500 行，其中只有一部分属于 T-FT-05。整文件暂存会把多节点故障转移、端口预检、图库路由、模板选择器预览等并行工作一起带入。
2. `App.tsx` 中新增的 `FigureAdaptCard` 组件属于 T-FT-05 前端，但同一文件还有结果区与图库相关改动，需要按 hunk 拆分。
3. `figure_templates_parity.test.js` 同时覆盖 T-FT-03 的注册表映射、T-FT-04 的箱线图断言和 T-FT-05 的真实数据派生。语义上属于同一批模板收口，可接受，但如果用户要求更严格的原子性，可进一步拆为注册表映射提交和派生执行提交。
4. `reference/` 下 6 个母版源码被 gitignore，导致注册表校验在干净克隆上会因缺少母版文件而失败。这不是 T-FT-05 代码缺陷，而是仓库资产白名单缺口，必须在提交前明确处置。

**结论：在完成 hunk 拆分并处理 reference 白名单后，T-FT-05 核心可以形成独立安全提交。**

## 二、当前变化的功能耦合图谱

### 2.1 与 8787 端口占用耦合的文件

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `ops/port_preflight.ps1` | 新增 | 8787 端口 Bound/Listen 预检，防止误占 |
| `ops/serve_guard.ps1` | 修改 | 守护脚本改为基于 preflight 的项目内进程识别，拒绝杀外部进程 |
| `start_workbench.bat` | 修改 | 编码修复 + 集成 `port_preflight.ps1` |
| `start_all.bat`、`start_portal.bat` | 修改 | 编码修复，与 8787 无直接逻辑耦合但同属启动器清理 |
| `con_hf/runs/2026-10-28_aims_v31/port_8787_audit.md` | 新增 | 8787 侧车审计证据 |
| `BioanalysDesktop/vite.config.js` | 未修改 | 仍在第 18 行硬编码 `http://127.0.0.1:8787`，临时端口时开发代理不可用 |

这些文件构成独立的 8787 预检切片，与 T-FT-05 无功能耦合，应单独提交。

### 2.2 与图库（figure catalog）耦合的文件

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `portal/figure_catalog.html` / `.css` / `.js` | 新增 | 候选图库页面三件套 |
| `BioanalysDesktop/server/figure_catalog.js` | 新增 | 图库服务端模块 |
| `BioanalysDesktop/tests/figure_catalog.test.js` | 新增 | 图库单测 |
| `ops/build_figure_catalog.py` 等 5 个 Python 工具及测试 | 新增 | 图库构建、分析、验证 |
| `portal/index.html` | 修改，hunk | 新增“浏览候选图库”入口链接 |
| `portal/serve.mjs` | 修改，hunk | 导入 `figure_catalog.js` 并新增 `/figure-catalog` 与 `/api/figures/catalog*` 路由 |
| `BioanalysDesktop/server/index.js` | 修改，hunk | 新增 `/api/figures/catalog*` 路由 |
| `reference/05.可参考出图代码/library/catalog.json` 等 | gitignored | 图库索引资产，当前无法提交 |
| `con_hf/runs/2026-10-27_figure_catalog_adaptation/` | 新增，约 612 条 | 图库适配运行证据 |

图库是独立的 Commit 1 边界，与 T-FT-05 在 `portal/index.html` 和 `portal/serve.mjs` 内存在 hunk 级共享。

### 2.3 与模板注册表耦合的文件

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `src/figure_templates.json` | 新增 | 82 模板注册表，当前 6 ready |
| `ops/build_figure_templates.cjs` | 新增 | 从 R453 证据生成注册表 |
| `BioanalysDesktop/server/figure_graph.js` | 新增 | 注册表加载、校验与派生任务构造 |
| `BioanalysDesktop/tests/figure_templates_parity.test.js` | 新增 | 注册表与派生一致性测试 |
| `reference/05.可参考出图代码/_meta/script_plot_matrix.json` | gitignored | 27 入口 Plot Matrix，T-FT-02 证据 |
| `con_hf/runs/2026-10-28_aims_v31/plot_matrix_*` | 新增 | Plot Matrix 运行证据 |
| `reference/05.可参考出图代码/_meta/R453_compat/L2_more_code.R` 等 6 个母版 | gitignored | 6 个 ready 模板引用的母版源码 |

模板注册表是 T-FT-03/04/05 的共享底座。T-FT-05 依赖它的 6 个 `ready` 条目、`canonical_output`、`source` 和 `source_sha256`。如需最严格原子性，可把注册表和派生执行拆为两个提交，但当前按一个模板收口提交也可接受。

### 2.4 与 handoff 与项目台账耦合的文件

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `local_projects/PRJ_AIMS_V3_20261027/handoff.md` | 新增 | 项目交接文档 |
| `local_projects/PRJ_AIMS_V3_20261027/INDEX.json` / `project.json` / `README.md` / `ledger/*.jsonl` | 新增 | 项目元数据与台账 |
| `con_hf/handoff.md`、`con_hf/操作台账.md`、`con_hf/ops_ledger.md`、`con_hf/pitfalls_ledger.md` | 修改 | 顶层台账更新 |
| `con_hf/ledger/*.jsonl` | 新增 | 顶层台账记录 |
| `con_hf/SPEC_DECISIONS.md` | 修改 | D-23 至 D-26 裁定，混合 T-CORE-01 与 D-26 |
| `ops/ledger_indexer.py` | 新增 | 台账索引与 handoff 校验工具 |

这些文件是项目治理与交接切片，不专属于 T-FT-05，但 `handoff.md` 中记录了 T-FT-05 进度。如果 T-FT-05 提交要携带台账更新，可把 `local_projects/PRJ_AIMS_V3_20261027/` 整目录纳入。否则应与台账一起作为独立治理提交。

### 2.5 与 Final Gate 耦合的文件

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `con_hf/runs/2026-10-28_aims_v31/STATUS.md` | 新增 | 当前执行状态总览 |
| `con_hf/runs/2026-10-28_aims_v31/commit_plan.md` | 新增 | 第一版提交计划 |
| `con_hf/runs/2026-10-28_aims_v31/commit_plan_v2.md` | 新增（本文件） | 本次只读审计 |
| `con_hf/runs/2026-10-28_aims_v31/review_spec.md` / `review_standards.md` | 新增 | T-FT-05 双轴评审证据 |
| `con_hf/runs/2026-10-28_aims_v31/template_mapping_audit.md` / `plot_matrix_audit.md` | 新增 | T-FT-03/02 审计证据 |
| `con_hf/runs/2026-10-27_final_gate/` | 新增 | v3.0 基线证据，不属于 v3.1 Final Gate |
| `con_hf/runs/2026-10-28_final_gate_v31/` | 不存在 | Final Gate v3.1 目标目录尚未产出 |

Final Gate 证据应在所有核心代码提交完成后、干净工作树上重跑后单独提交。`STATUS.md` 和本报告可以在提交后更新。

## 三、必须排除的历史并行改动

以下内容不属于 T-FT-05，禁止混入其提交。建议按各自独立边界另行处置。

| 范围 | 条目数或性质 | 处置建议 |
| --- | --- | --- |
| `src/line1_bulk/`、`src/line2_scrna/`、`src/line3_spatial/` 下脚本与 manifest | 约 59 条 | 历史三线分析脚本正确性、路径和 seed 改动，不属于四组边界，保持未暂存或单独提交 |
| `artifacts/` | 243 条 | 历史验证产物，不应进入源码提交 |
| `cn_debug/` | 117 条 | 历史调试、benchmark 和备份，保持未跟踪 |
| `start_all.bat`、`start_portal.bat`、`start_workbench.bat` | 3 条 | 启动器编码与预检修复，与 8787 预检一起单独提交 |
| `ops/encoding_backup/` | 83 条 | 备份目录，整体排除 |
| `local_projects/default/`、`local_projects/PRJ_20261019_IS_lactylation/` | 约 19 条 | 其他项目，与 AIMS v3.1 无关 |
| `portal/serve.mjs` 中 Sync 状态机、tar 包、下载缓存等 | hunk 级 | 独立 Sync 切片，排除 |
| `portal/index.html` 中调查页、Sync 结果预览等 | hunk 级 | 独立 Sync/调查页切片，排除 |
| `BioanalysDesktop/server/` 下 `audit.js`、`link.js`、`project.js`、`pull.js`、`report.js`、`run.js`、`selfcheck.js`、`tumor_blacklist.js`、`upload.js` 等 | 约 20 个文件 | 并行功能改动，不属于 T-FT-05 |
| `BioanalysDesktop/package.json` / `package-lock.json` | 2 个文件 | Playwright E2E 依赖，属于模板选择器 Commit 2 边界 |
| `BioanalysDesktop/playwright.config.ts`、`tests/e2e/portal.spec.ts`、`tests/preview_mods.test.js` | 3 个文件 | Commit 2 范围 |
| `.gitignore`、`.gitattributes` | 2 个文件 | 全局规则变更（con_hf/runs 白名单、local_projects 忽略规则、snapshots 等），需单独提交并谨慎 hunk 拆分 |
| `aims/`、`docs/`、`configs/`、`.agents/` | 约 35 条 | 历史文档与配置，与 T-FT-05 无关 |
| 根目录临时文件 `$null`、`.probe_*`、`.run_*`、`summary.md`、`split_plan.json` | 约 9 条 | 临时产物，不应提交 |
| `con_hf/runs/2026-10-28_aims_v31/` 下 STATUS/commit_plan/template_mapping_audit/plot_matrix_audit/review 等证据 | 7 个文件 | 可作为证据类提交，但不进入 T-FT-05 核心代码提交 |
| `con_hf/runs/2026-10-27_figure_catalog_adaptation/` | 612 条 | 图库运行证据，不进入 T-FT-05 |
| `con_hf/runs/2026-10-27_final_gate/` | 6 条 | v3.0 基线证据，不进入 v3.1 Final Gate |

## 四、T-FT-05 独立提交的精确 path 清单与验收命令

### 4.1 提交前置条件

1. 用户明确批准 T-FT-05 单独提交，并批准 `reference/` 白名单问题的处置方案（见 4.5）。
2. 使用 `git add` 显式列出下述路径，禁止使用 `git add .`。
3. 对共享文件（`task.js`、`index.js`、`App.tsx`、`app.css`、`task.test.js`、`SPEC_DECISIONS.md`）执行 hunk 级拆分，只暂存 T-FT-05 相关行。
4. 提交前重新运行 `git status --porcelain=v1 -uall`，确认条目数不低于本报告记录值，且没有新的用户改动进入暂存区。

### 4.2 核心 path 清单（必须提交）

```text
src/figure_templates.json
ops/build_figure_templates.cjs
BioanalysDesktop/server/figure_adapters.js
BioanalysDesktop/server/figure_graph.js
BioanalysDesktop/server/task.js            # hunk 拆分，仅保留 adapted 执行、seed 注入与 canonical 校验
BioanalysDesktop/server/index.js           # hunk 拆分，仅保留 /api/figures/adapt/derive 与 adapted 任务提交
BioanalysDesktop/src/App.tsx               # hunk 拆分，仅保留 FigureAdaptCard 组件与对应类型
BioanalysDesktop/src/app.css               # hunk 拆分，仅保留 .figure-adapt 样式块
BioanalysDesktop/tests/figure_adapters.test.js
BioanalysDesktop/tests/figure_templates_parity.test.js
BioanalysDesktop/tests/wp33_figure_adapt.test.js
BioanalysDesktop/tests/task.test.js        # hunk 拆分，仅保留 adapted 任务与 seed 测试
local_projects/PRJ_AIMS_V3_20261027/handoff.md
con_hf/SPEC_DECISIONS.md                   # hunk 拆分，仅保留 D-26 中与 T-FT-05 交付对应的行
```

### 4.3 K40 证据 path 清单（推荐一并提交）

```text
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/REPORT.md
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/FINAL_CHECKS.txt
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/artifact_validation.tsv
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/markers.txt
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/real_input_results.csv
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/fig_l2_pca_ledger.json
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/fig_l2_heatmap_ledger.json
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/fig_l2_volcano_ledger.json
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/fig_l2p_dotplot_ledger.json
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/fig_l2p_volcano_ledger.json
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/fig_l2p_umap_ledger.json
```

以下同目录文件明确排除：

```text
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/run_remaining_adapters.ps1   # 一次性执行脚本
con_hf/runs/2026-10-28_aims_v31/real_input_adapters/fig_l2_pca_submit.json       # 一次性提交载荷
```

### 4.4 验收命令

按顺序在仓库根目录执行。前四步为提交前验证，第五步为边界断言，第六步为用户批准后的提交动作。

```powershell
# 1) 语法检查
node --check BioanalysDesktop/server/figure_adapters.js
node --check BioanalysDesktop/server/index.js
node --check BioanalysDesktop/server/task.js
node --check ops/build_figure_templates.cjs

# 2) 核心测试
node --test BioanalysDesktop/tests/figure_adapters.test.js
node --test BioanalysDesktop/tests/figure_templates_parity.test.js
node --test BioanalysDesktop/tests/wp33_figure_adapt.test.js
node --test BioanalysDesktop/tests/task.test.js

# 3) 注册表与派生链路完整校验
node --test BioanalysDesktop/tests/figure_templates_parity.test.js --test-name-pattern 'registry|ready|derive|adapt'

# 4) 产物与种子契约
python ops/validate_plot_artifacts.py --manifest con_hf/runs/2026-10-28_aims_v31/real_input_adapters/artifact_validation.tsv

# 5) 暂存边界断言（暂存后执行）
git diff --cached --name-only   # 输出必须精确等于 4.2 与 4.3 的并集，不得多一行或少一行

# 6) 用户批准后执行提交（本审计未执行）
git commit -m "feat(figure-adapters): T-FT-05 real-input adapters for 6 ready templates"
```

### 4.5 提交前必须解决的阻断项

1. **`reference/` 母版白名单缺口。** 6 个 ready 模板的 `source` 字段指向 `reference/05.可参考出图代码/` 下的文件，而 `.gitignore` 第 43 行整体忽略 `reference/`。当前 `figure_templates_parity.test.js` 和 `figure_adapters.test.js` 在干净克隆上会因缺少母版文件而失败。建议由用户选择以下方案之一：
   - 在 `.gitignore` 中为 6 个母版路径和箱线图母版添加精确白名单，并作为独立小提交先落地。
   - 把 6 个母版内容复制到 `src/figure_templates/` 或其他可跟踪目录，并更新注册表 `source` 字段（改动面更大）。
   - 暂时接受“本地可跑、干净克隆不可复现”的风险，并在提交消息和 handoff 中显式标注该缺口。
2. **`App.tsx` hunk 拆分精度。** `FigureAdaptCard` 是 T-FT-05 前端入口，但当前文件还包含结果区其他改动。如果 hunk 拆分导致提交后的前端构建或 Playwright 失败，应把 `App.tsx` 从 T-FT-05 核心提交中剔除，与 Commit 2 一起提交，并在提交消息中注明“前端 UI 延后”。
3. **`SPEC_DECISIONS.md` hunk 拆分。** 该文件同时包含 T-CORE-01 的 D-23 至 D-25 和 D-26。若 T-FT-05 提交只对应 D-26 的交付语义，应只暂存 D-26 相关段落。若拆分困难，可将整个裁定文件与 T-FT-05 一起提交，但在提交消息中说明“包含 T-CORE-01 裁定记录”。
4. **本报告更新。** 提交完成后，T-FT-05 的 `STATUS.md` 和本文件应更新为“已提交 + commit hash”，但这属于提交后的元数据更新，不应提前写入。

## 五、四个问题的直接回答

1. **T-FT-05 本轮相关文件能否形成一个独立安全提交？**  
   代码语义上可以，操作上当前不能直接提交。必须先对 `task.js`、`index.js`、`App.tsx`、`app.css`、`task.test.js`、`SPEC_DECISIONS.md` 做 hunk 拆分，并解决 `reference/` 母版白名单阻断。完成后按 4.2 与 4.3 的 path 清单执行即可。

2. **哪些文件与 8787、图库、模板注册表、handoff、Final Gate 各自耦合？**  
   8787：`ops/port_preflight.ps1`、`ops/serve_guard.ps1`、`start_workbench.bat`、`start_all.bat`、`start_portal.bat`、`port_8787_audit.md`。  
   图库：`portal/figure_catalog.*`、`BioanalysDesktop/server/figure_catalog.js`、`figure_catalog.test.js`、`ops/*figure_catalog*`、`portal/index.html` 和 `portal/serve.mjs` 中 catalog hunk、`reference/.../library/`（gitignored）。  
   模板注册表：`src/figure_templates.json`、`ops/build_figure_templates.cjs`、`BioanalysDesktop/server/figure_graph.js`、`figure_templates_parity.test.js`、`reference/.../_meta/script_plot_matrix.json`（gitignored）、6 个母版（gitignored）。  
   handoff：`local_projects/PRJ_AIMS_V3_20261027/` 全目录、`con_hf/handoff.md`、`con_hf/ledger/`、`con_hf/SPEC_DECISIONS.md`、`ops/ledger_indexer.py`。  
   Final Gate：`con_hf/runs/2026-10-28_aims_v31/` 下状态与审计证据、`con_hf/runs/2026-10-27_final_gate/`（v3.0 基线）。  
   其中 `task.js`、`index.js`、`App.tsx`、`portal/index.html`、`portal/serve.mjs` 是跨域 hunk 共享点。

3. **哪些当前变化属于历史并行工作，必须排除？**  
   见第三节清单。核心是 `src/line*` 三线脚本、`artifacts/`、`cn_debug/`、启动器编码修复、`ops/encoding_backup/`、其他项目台账、Sync 状态机、调查页、图库运行证据、`package.json` E2E 依赖、`.gitignore` 全局规则和所有根目录临时文件。

4. **如果先把本轮 T-FT-05 单独提交，精确 path 清单和验收命令是什么？**  
   见 4.2 核心 path 清单、4.3 K40 证据 path 清单和 4.4 验收命令。提交前必须先完成 4.5 的三项前置处置。

## 六、后续处置

2026-10-28 已处理 `reference/` 白名单阻断：

- `.gitignore` 改为精确白名单，不再整体忽略当前需要的 `reference/05.可参考出图代码/` 资产。
- 白名单覆盖 6 个 ready 模板母版与预览、6 个真实项目样例、27 入口 Plot Matrix 源文件、箱线图母版与验证产物、图模板生成器输入。
- `figure_templates_parity.test.js` 新增 `git check-ignore` 回归，任何 ready 资产重新被忽略都会变红。

仍未执行任何 Git 暂存或提交。剩余提交阻断是共享文件 hunk 拆分和当前 2000 级混合工作树。
