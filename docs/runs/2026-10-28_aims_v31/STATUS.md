# Aims v3.1 执行状态

日期：2026-10-28  
状态：Final Gate v3.1 PASS，可以冻结 `release/v3.1`

## 已完成

### T-CORE-01

- `D-23` 至 `D-26` 已写入 `con_hf/SPEC_DECISIONS.md`。
- 因历史编号已占用，v3.1 名义 D-18 至 D-21 正式落号为 D-23 至 D-26。
- `con_hf/ledger/changes.jsonl` 新增 5 条 v3.1 change 记录。

### T-CORE-02

- `local_projects/PRJ_AIMS_V3_20261027/handoff.md` 已补齐项目背景、进度、已知坑与下一步。
- `ops/ledger_indexer.py` 新增 `--check-handoff`，验收通过。
- 项目 `actions.jsonl` 新增 `ACT-20261028-001`。

### T-FT-01

- 箱线图正式版与 R453 兼容版均改为 `tip.length = 0`。
- 两份母版字节一致，新 `source_sha256=dfc6a22b7585849c1c4d11bec312d654b9af63bf20dd2e42876c28834f8b0b0d`。
- K40 R4.5.3 重跑 exit 0，新 PNG/PDF 已替换。
- 新 PNG `preview_sha256=ce3d2cb08118011f727b4c901fe4921d81129433a9e0507e43edad5b22bf8a82`。
- 证据：`con_hf/runs/2026-10-28_aims_v31/boxplot_k40/REPORT.md`

### T-FT-02

- 27 个非隔离入口在 K40 全部重跑。
- `script_plot_matrix.json` 已落盘，27/27 status=pass、exit_code=0、marker_found=true。
- 41 张 PNG 全部记录 DPI 与像素方差，产物总数为 78，invalid=0。
- `python ops/verify_plot_matrix.py --strict` 通过。
- 证据：`con_hf/runs/2026-10-28_aims_v31/plot_matrix_result/`

### T-FT-03

- `ops/build_figure_templates.cjs` 已支持真实产物映射。
- `src/figure_templates.json` 当前统计为：
  - ready：6
  - pending：65
  - pending_mapping：10
  - blocked_r453：1
- 严格 ready 映射包含 `lines`、`analysis_step`、`input_tables`、`produces`、`output_glob`、`canonical_output`、`sample_project_output`。
- 10 个没有合格真实样例的模板已退出可用预览。

### T-FT-04

- 新增箱线图零端点测试。
- 新增 ready 强映射和 `sample_project_output` 存在性测试。
- 新增 27 入口 `script_plot_matrix.json` 完整性测试。
- 相关定向测试全部通过。

### T-FT-05

- adapted 任务已支持项目内 `scripts/adapt_<fig_id>.R/.py`。
- 新增 `BioanalysDesktop/server/figure_adapters.js`，当前 6 个 ready 模板全部读取各自真实项目表或 h5ad。
- 真实数据覆盖层先执行后退出，母版源码仅保留为不可达的字节级审计载荷，不再先执行合成数据。
- 6/6 K40 任务 `status=completed`、`exit_code=0`、`checkpoint_status=passed`、`random_seed=20261013`。
- 6 张 PNG 全部回搬并通过 Pillow 校验与目视检查。
- 输入越界、跨线、跨项目、非法字符、母版越界与 canonical shell 注入均已 fail closed。
- 证据：`con_hf/runs/2026-10-28_aims_v31/real_input_adapters/REPORT.md`

### T-FT-06

- 门户 API 已下发 `lines`、`analysis_step`、`input_tables`、`produces`、`output_glob`、`canonical_output`、`sample_project_output`。
- ready 卡片展示“对应步骤”和“产出”标签。
- 前端改为优先按 `lines` 过滤，不再按 `linked_mods` 串线。

### T-LINES-01

- 当前仓库的目标形态与实际运行架构已通过 D-27 明确分离：`src/workflows.json` 是当前 JSON module manifest 的 SSOT，不声称已有 TypeScript 微内核。
- `workflows.json` 新增 `manifest_version=2` 与 `manifest_kind=workspace_module_registry`，`workflow_graph.js` 在注册表校验中强制这两个字段。
- ready 图模板新增 `input_tables ⊆ analysis_step.produces` 跨注册表一致性校验。
- 修正 `fig_l2_pca` 的错误输入映射，只保留 `pca_scores.tsv`，不再把上游 `group_map.tsv` 误记为同一步骤产物。
- 6 个 ready 模板的母版、预览、真实项目样例，以及 27 入口 Plot Matrix 源文件已加入精确 Git 白名单，可在干净克隆中验证。
- 证据：`con_hf/runs/2026-10-28_aims_v31/architecture_gap_audit.md`

### 测试基线

- `npm test -- --test-concurrency` 路径已固定为单并发，避免并行端口抖动。
- Node 全量：974/974 PASS。
- Playwright：15/15 PASS。
- TypeScript：PASS。
- Vite build：PASS。
- 注册表：`figure_templates.check=ok`。
- Plot Matrix strict：27/27 PASS。
- K40 三线重跑：54 个分析步骤加 `probe_env` 共 55/55 `completed / exit 0 / checkpoint passed`，54 个分析步骤均为 `seed=20261013`。
- K40 台账汇总：`con_hf/runs/2026-10-28_aims_v31/pipeline_rerun/k40_55_ledgers.tsv`。
- K40 链路：ADB、8022、10022、R 4.5.3 与四个 runit 服务 PASS。
- 远端镜像：101/101 SHA256 一致，`src/` 与 `bin/` 部署一致性 55/55。

### T-CORE-03

- D-28 已将工作台默认端口从冲突的 8787 迁移到 `127.0.0.1:18787`。
- 服务端、Vite 代理、启动器、守护脚本、Sync、当前 aims、文档和测试默认值已统一。
- `18787` 由项目 Node 服务仅绑定 loopback，`/api/selfcheck` 五维自检 `all_pass=true`。
- 8080 客户端 `/health` 返回 200。
- 已新增 `ops/port_preflight.ps1`，识别全部 TCP 状态并按进程命令行白名单区分项目服务与外部进程。
- `start_workbench.bat`、`start_portal.bat` 已改为 fail closed，不再只筛 LISTENING。
- `serve_guard.ps1` 已改为只停止白名单命中的本项目 Node 进程，新增 `-DryRun`。
- 证据：`con_hf/runs/2026-10-28_aims_v31/port18787/`

## 最终收口

### T-CORE-04 与 T-SYNC-01

- v3.1 改动已按模块边界完成原子提交，Final Gate 开始时工作树为空。
- 当前版本真实门户票据已完成：`2026-10-28_101353_requirement_PRJ_AIMS_V3_20261027`，返回 17 个结果文件，状态 done。
- 当前交付包已重建，归档 SHA256 与旁挂清单一致，解包后 Ed25519 `VERIFIED 329`。
- Node 974/974、Playwright 15/15、TypeScript、Vite build 全部通过。
- K40 55/55 台账通过，101/101 远端文件与 55/55 部署落点零漂移。
- 18787 与 8080 双活，活动代码中的 8787 精确命中为 0，Clash Verge 无端口冲突。
- 24 项 Final Gate 全部 PASS，0 PENDING，0 FAIL。
- 正式证据：`con_hf/runs/2026-10-28_final_gate_v31/REPORT.md` 与 `SUMMARY.json`。

## 当前结论

G1、G2、G3、G4、G5、G6、G7 已全部完成。T-LINES-01 按 D-27 的 JSON module manifest 口径完成，
端口冲突按 D-28 迁移到 18787，T-SYNC-01 的真实票据、当前交付包与零漂移同步均已通过。
AIMS v3.1 达到冻结条件，正式分支为 `release/v3.1`，冻结标签为 `v3.1.0-final-gate`。
