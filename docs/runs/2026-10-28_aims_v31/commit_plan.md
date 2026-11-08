# D-21 未提交条目原子提交分类与风险计划

审计时间：2026-10-28 00:27 Asia/Shanghai

审计性质：只读审计。未执行 `git add`、`commit`、`checkout`、`reset`、`clean`，未修改任何被跟踪文件。本报告是本次审计唯一新增的提交计划文件。

审计基线：

- 分支：`master`
- HEAD：`4ae8c7c1b0ea3c3ca796911497a2f05395e9ed6b`
- 暂存区：0 个文件
- 工作树快照：1731 个状态条目
- 其中已跟踪状态条目 201 个，未跟踪条目 1530 个
- 其中真实内容差异 149 个文件，52 个条目为状态缓存或 EOL 噪声，`git diff` 为空
- 删除条目 14 个

注意：审计期间有其他只读子任务并行写入 `con_hf/runs/2026-10-28_aims_v31/`，因此本报告是上述时间点的快照。最终提交前必须重新运行 `git status --porcelain=v1 --untracked-files=all`。

## 一、D-21 边界与文档冲突

本报告采用 `aims/00_20261027_1204.md` 第 35 行的 D-21 定义，四个原子提交边界如下：

1. 图库扩展与 `/figure-catalog`
2. 模板选择器过滤与 E2E
3. G1 至 G6 缺口修补
4. Final Gate v3.1 新证据

存在两处必须由主代理裁定的文档冲突：

1. `aims/02_aimstodolist_20261027_1204.md` 第 59 行把箱线图、Plot Matrix、注册表映射和派生执行放入 Commit 2，但 `aims/00_20261027_1204.md` D-21 把它们放入 Commit 3。
2. `con_hf/SPEC_DECISIONS.md` 已将最新四项裁定正式落号为 D-23 至 D-26，并明确说明 aims 名义 D-18 至 D-21 已被历史条目占用。报告与提交消息必须同时写明名义编号和正式编号，避免追溯歧义。

建议：后续一律以 `con_hf/SPEC_DECISIONS.md` 的 D-23 至 D-26 作为正式编号，同时在括号中注明 aims 名义 D-18 至 D-21。

## 二、四组分类总表

| 边界 | 条目数 | 说明 | 当前可否提交 |
| --- | ---: | --- | --- |
| 1 图库扩展与 `/figure-catalog` | 654 | 42 个源码、测试和 fixture，612 个运行产物 | 不可提交 |
| 2 模板选择器过滤与 E2E | 7 | 前端、依赖、Playwright 配置与 E2E | 不可提交 |
| 3 G1 至 G6 缺口修补 | 348 | 46 个源码与文档，302 个证据或运行产物 | 不可提交 |
| 4 Final Gate v3.1 新证据 | 0 | 目标证据目录不存在 | 不可提交 |
| 无法归入四组 | 722 | 历史调试、备份、其他项目、启动器、临时脚本等 | 保持未暂存 |
| 合计 | 1731 | 与审计快照一致 | 不执行提交 |

## 三、Commit 1：图库扩展与 `/figure-catalog`

### 3.1 可纳入边界的内容

源码、测试与 fixture 共 42 个：

- `portal/figure_catalog.html`
- `portal/figure_catalog.css`
- `portal/figure_catalog.js`
- `BioanalysDesktop/server/figure_catalog.js`
- `BioanalysDesktop/tests/figure_catalog.test.js`
- `ops/build_figure_catalog.py`
- `ops/analyze_figure_catalog_splits.py`
- `ops/materialize_figure_catalog_splits.py`
- `ops/verify_figure_catalog.py`
- `ops/figure_catalog_r_adapter.py`
- `ops/figure_catalog_r_adapter.R`
- `ops/tests/test_build_figure_catalog.py`
- `ops/tests/test_analyze_figure_catalog_splits.py`
- `ops/tests/test_materialize_figure_catalog_splits.py`
- `ops/tests/test_verify_figure_catalog.py`
- `ops/tests/test_figure_catalog_r_adapter.py`
- `ops/tests/batch_direct_fixture/` 下 23 个文件
- `ops/tests/escape/` 下 2 个文件

运行证据：

- `con_hf/runs/2026-10-27_figure_catalog_adaptation/` 下 612 个文件

### 3.2 阻断风险

1. D-21 指定的 `reference/05.可参考出图代码/library/catalog.json` 当前被 `.gitignore` 第 43 行的 `reference/` 规则整体忽略。`git check-ignore` 已确认该文件不可直接提交。
2. 该目录是独立大资产目录，不能直接删除整条忽略规则而不做范围控制。建议为以下最小路径增加白名单：
   - `reference/05.可参考出图代码/library/catalog.json`
   - `reference/05.可参考出图代码/library/licenses.json`
   - `reference/05.可参考出图代码/library/manifest.csv`
   - 必需的预览索引或证据文件
3. `.gitignore` 当前还有其他修改，必须按 hunk 拆分，只暂存图库白名单，不可整文件暂存。
4. `portal/index.html`、`portal/serve.mjs`、`BioanalysDesktop/server/index.js` 同时包含图库、模板选择器、结果区和 Sync 路由。整文件暂存会把 Commit 1、2、3 混在一起，必须按 hunk 拆分。
5. `con_hf/runs/2026-10-27_figure_catalog_adaptation/` 下 612 个文件是运行产物，不应进入原子源码提交。建议保留在运行证据目录，只提交最终摘要和校验清单。

结论：Commit 1 目前被 `reference/` 忽略规则和共享文件耦合双重阻断，不能提交。

## 四、Commit 2：模板选择器过滤与 E2E

### 4.1 边界内候选文件

- `BioanalysDesktop/src/App.tsx`
- `BioanalysDesktop/src/app.css`
- `BioanalysDesktop/package.json`
- `BioanalysDesktop/package-lock.json`
- `BioanalysDesktop/playwright.config.ts`
- `BioanalysDesktop/tests/e2e/portal.spec.ts`
- `BioanalysDesktop/tests/preview_mods.test.js`

### 4.2 耦合风险

1. `BioanalysDesktop/src/App.tsx` 同时包含模板选择、派生适配卡和结果区，跨越 Commit 2 与 Commit 3。
2. `BioanalysDesktop/src/app.css` 同时包含选择器、适配卡和结果区样式，跨越 Commit 2 与 Commit 3。
3. `portal/index.html` 包含候选图库入口、选择器、结果区和调查页逻辑，跨越 Commit 1、2、3。
4. `portal/serve.mjs` 包含图库 API、模板 API、Sync 编排和结果文件服务，跨越 Commit 1、2、3。
5. `BioanalysDesktop/server/index.js` 包含图库 API、模板预览、适配派生、自检和 Sync，跨越 Commit 1、2、3。
6. `package.json` 与 `package-lock.json` 同时服务于 Playwright E2E 和运行时依赖，需确认本提交只引入 E2E 必需依赖。
7. D-21 原文写 949 单测加 15 E2E，`aims/02_aimstodolist` 后文写 955 单测加 16 E2E。测试计数口径不一致，验收时以实际执行的报告为准，并更新 aims 唯一真源。

结论：Commit 2 的独立候选文件可识别，但共享 UI、服务和依赖文件必须先做 hunk 级拆分。当前不能整文件暂存。

## 五、Commit 3：G1 至 G6 缺口修补

### 5.1 边界内源码与文档

- `src/figure_templates.json`
- `src/workflows.json`
- `ops/build_figure_templates.cjs`
- `BioanalysDesktop/server/figure_graph.js`
- `BioanalysDesktop/server/workflow_graph.js`
- `BioanalysDesktop/tests/figure_templates_parity.test.js`
- `BioanalysDesktop/tests/wp33_figure_adapt.test.js`
- `BioanalysDesktop/tests/workflow_graph.test.js`
- `BioanalysDesktop/tests/step_name_resolve.test.js`
- `con_hf/SPEC_DECISIONS.md`
- `con_hf/handoff.md`
- `con_hf/ops_ledger.md`
- `con_hf/pitfalls_ledger.md`
- `con_hf/操作台账.md`
- `con_hf/ledger/actions.jsonl`
- `con_hf/ledger/changes.jsonl`
- `con_hf/ledger/errors.jsonl`
- `con_hf/ledger/fixes.jsonl`
- `con_hf/ledger/pitfalls.jsonl`
- `local_projects/PRJ_AIMS_V3_20261027/INDEX.json`
- `local_projects/PRJ_AIMS_V3_20261027/README.md`
- `local_projects/PRJ_AIMS_V3_20261027/handoff.md`
- `local_projects/PRJ_AIMS_V3_20261027/project.json`
- `local_projects/PRJ_AIMS_V3_20261027/ledger/actions.jsonl`
- `local_projects/PRJ_AIMS_V3_20261027/ledger/changes.jsonl`
- `local_projects/PRJ_AIMS_V3_20261027/ledger/errors.jsonl`
- `local_projects/PRJ_AIMS_V3_20261027/ledger/fixes.jsonl`
- `local_projects/PRJ_AIMS_V3_20261027/ledger/pitfalls.jsonl`
- `ops/verify_plot_matrix.py`
- `ops/stage_plot_matrix.ps1`
- `ops/validate_plot_artifacts.py`
- `ops/verify_r453_figures.py`
- `ops/verify_r453_l2.py`
- `ops/verify_public_references.py`
- `ops/ledger_indexer.py`
- `ops/hook_ledger.py`
- `ops/migrate_to_local_projects.py`
- `ops/local_project_workspace.py`
- `ops/local_project_workspace.ps1`
- `ops/init_project_scaffold.py`
- `ops/tests/test_verify_plot_matrix.py`
- `ops/tests/test_ledger_index_and_migrate.py`
- `ops/tests/test_local_project_workspace.py`

### 5.2 G1 至 G6 当前实证

| 缺口 | 当前证据 | 状态 |
| --- | --- | --- |
| G1 注册表强映射 | 82 个模板中 16 个 `ready`，但 16 个全部缺 `lines`、`produces`、`analysis_step`、`output_glob`、`sample_project_output` | 未闭合 |
| G2 派生执行闭环 | `task.js`、`figure_graph.js`、`workflow_graph.js` 均无 `mod_figure_adapt_exec` 匹配，`ops/run_adapted_figure.sh` 不存在 | 未闭合 |
| G3 27 入口 Plot Matrix | `reference/05.可参考出图代码/_meta/script_plot_matrix.json` 不存在，当前只有前序运行证据和只读审计 | 未闭合 |
| G4 箱线图纯横线 | 审计时两份箱线图母版已改为 `tip.length = 0`，新 K40 产物位于 `con_hf/runs/2026-10-28_aims_v31/boxplot_k40/` | 源码已修补，提交与最终验收未闭合 |
| G5 工作树收口 | 1731 个状态条目，四组以外仍有 722 个条目 | 未闭合 |
| G6 项目交接 | `local_projects/PRJ_AIMS_V3_20261027/handoff.md` 已填充，包含背景、当前进度、已知坑和下一步 | 已闭合 |

### 5.3 G3 证据目录

- `con_hf/runs/2026-10-27_plotting_feasibility/` 下 285 个文件
- `con_hf/runs/2026-10-27_figure_template_alignment/`
- `con_hf/runs/2026-10-27_gate1/`
- `con_hf/runs/2026-10-27_gate2/`
- `con_hf/runs/2026-10-26_verification_k40-rebuild/`
- `con_hf/runs/2026-10-28_aims_v31/plot_matrix_audit.md`
- `con_hf/runs/2026-10-28_aims_v31/boxplot_k40/`
- `con_hf/runs/2026-10-28_aims_v31/boxplot_k40/REPORT.md`
- `con_hf/runs/2026-10-28_aims_v31/commit_plan.md`

这些文件可以作为 G3、G4 的证据候选，但在 G1、G2、G3 正式交割物补齐前，不应整目录提交。

### 5.4 阻断风险

1. G1 未实现，`src/figure_templates.json` 仍是 16 个 `ready` 但映射字段全空的状态。当前提交会固化错误准入。
2. G2 未实现，派生副本仍只有生成与上传能力，没有 `mod_figure_adapt_exec` 真实执行子步骤。
3. G3 未实现，正式 `script_plot_matrix.json` 缺失，运行目录中的 `result/plot_matrix.json` 不能替代最终注册表。
4. G4 的源码修复位于被忽略的 `reference/` 目录，除非增加精确白名单，否则 Git 无法记录修复。
5. `BioanalysDesktop/server/task.js`、`project.js`、`run.js`、`report.js`、`pull.js` 同时承载 G1 至 G6 修复、任务重试、Sync 和报告逻辑，需要 hunk 级拆分或拆成额外提交。
6. `src/line1_bulk/scripts/*`、`src/line2_scrna/scripts/*`、`src/line3_spatial/scripts/*` 共 59 个条目是前序分析正确性、运行时路径和产物台账改动，不属于 D-21 四组。整批暂存会污染 Commit 3。

结论：Commit 3 当前不能提交。必须先完成 G1、G2、G3，再决定 G4 修复如何纳入版本控制。

## 六、Commit 4：Final Gate v3.1 新证据

当前没有以下目标证据：

- `con_hf/runs/2026-10-27_final_gate_v31/REPORT.md`
- `con_hf/runs/2026-10-28_final_gate_v31/REPORT.md`

现有 `con_hf/runs/2026-10-27_final_gate/` 是 v3.0 基线，不属于 v3.1 新证据。

`con_hf/SPEC_DECISIONS.md` D-26 的正式落点写的是 `con_hf/runs/2026-10-28_final_gate_v31/REPORT.md`，与 aims 使用的 `2026-10-27_final_gate_v31` 不一致。提交前必须统一目录名，并只保留一个真源。

结论：Commit 4 当前没有可提交内容，不能伪造空目录或提前提交旧门禁报告。

## 七、无法归入四组的 722 个条目

| 顶层范围 | 条目数 | 风险 |
| --- | ---: | --- |
| `artifacts/` | 243 | 历史验证产物与运行日志，不应混入原子源码提交 |
| `ops/` 未归类部分 | 134 | 含 83 个 `ops/encoding_backup/` 备份，以及旧运维脚本、K40 安装脚本和测试夹具 |
| `cn_debug/` | 117 | 历史调试数据、旧审计 CSV、benchmark 结果和备份 |
| `BioanalysDesktop/` 未归类部分 | 63 | 测试、服务端其他功能、README、tsconfig 和运行残留 |
| `src/` 未归类部分 | 59 | 三线分析脚本正确性、路径、seed、台账改动，不属于 D-21 四组 |
| `con_hf/` 未归类部分 | 31 | topic survey、旧计划、旧报告和临时探针 |
| `local_projects/` 未归类部分 | 19 | `default` 与 `PRJ_20261019_IS_lactylation`，不是本次 AIMS 项目 |
| `docs/` | 16 | 旧规范、编码审计、topic survey 与 reconcile 文档 |
| `aims/` | 12 | 新旧 aims、旧目录归档和删除项 |
| `portal/` 未归类部分 | 4 | `index.html`、`serve.mjs`、survey 页面，存在跨组耦合 |
| `configs/` | 4 | K40 设备与构建状态 |
| `.agents/` | 3 | 外部 skill 文件 |
| 根目录临时项 | 23 | `start_*.bat`、`.probe_*`、`.run_*`、`split_plan.json`、`summary.md`、`$null` 等 |

重点误提交风险：

1. `$null` 是异常文件名，不能进入任何提交。
2. `.probe_gmt.sh`、`.probe_l2s.sh`、`.probe_l2s2.sh`、`.run_backup.sh`、`.run_new.sh`、`.run_v2.sh`、`.tmp_probe.sh` 是临时脚本，不应提交。
3. `start_all.bat`、`start_portal.bat`、`start_workbench.bat` 是独立启动器修复，不属于 D-21 四组，应单独提交。
4. `ops/encoding_backup/` 是备份目录，必须整体排除。
5. `BioanalysDesktop/test-results/.last-run.json` 是运行残留，不应提交。
6. `local_projects/default/` 与 `local_projects/PRJ_20261019_IS_lactylation/` 是其他项目，不应混入 AIMS v3.1。
7. 52 个 `cn_debug`、`con_hf` 和 `src` 条目在 `git diff` 中无内容差异，是状态缓存或 EOL 噪声。提交前建议先执行 `git update-index --refresh`，确认它们消失后再继续，禁止直接 `git add .`。

## 八、跨组耦合文件清单

以下文件不能整文件暂存，必须按 hunk 拆分：

- `portal/index.html`
- `portal/serve.mjs`
- `BioanalysDesktop/server/index.js`
- `BioanalysDesktop/server/task.js`
- `BioanalysDesktop/server/project.js`
- `BioanalysDesktop/server/run.js`
- `BioanalysDesktop/server/report.js`
- `BioanalysDesktop/server/pull.js`
- `BioanalysDesktop/src/App.tsx`
- `BioanalysDesktop/src/app.css`
- `BioanalysDesktop/package.json`
- `BioanalysDesktop/package-lock.json`
- `BioanalysDesktop/tests/aims_drift_guard.test.js`
- `.gitignore`
- `.gitattributes`

## 九、建议执行顺序

1. 先冻结并行写入，重新采集 `git status`、`git diff --stat` 和文件哈希。
2. 执行 `git update-index --refresh`，确认 52 个无内容差异条目从状态中消失。
3. 把 59 个 `src/line*` 改动、启动器修复和临时运维改动拆成独立提交或移出本次发布范围。
4. 为 `reference/` 增加最小白名单，纳入图库、箱线图母版和正式 Plot Matrix。
5. 按 hunk 拆分共享文件和 `.gitignore`，先准备 Commit 1 和图库路由。
6. 完成模板选择器与 E2E 的独立拆分，准备 Commit 2。
7. 完成 G1、G2、G3，确认 G4 与 G6 证据，再准备 Commit 3。
8. 在干净工作树重跑 Final Gate v3.1，生成唯一约定目录下的证据，再准备 Commit 4。
9. 每个 Commit 提交前执行 `git diff --cached --name-only` 和边界断言，禁止 `git add .`。

## 十、最终裁决

当前不能按 D-21 直接执行四个原子提交。主要阻断是图库资产被忽略、共享文件跨组耦合、G1 强映射缺失、G2 派生执行缺失、G3 正式矩阵缺失、G4 修复未纳入版本控制、G5 工作树混入大量历史内容、Commit 4 证据不存在。

本报告建议先完成边界清理和 G1 至 G4 缺口闭合，再重新执行本审计。当前审计快照中，无法归入四组的条目数为 722。下一轮状态快照必须重新确认该计数，因为 G1 至 G4 的并行修补仍可能继续新增证据文件。
