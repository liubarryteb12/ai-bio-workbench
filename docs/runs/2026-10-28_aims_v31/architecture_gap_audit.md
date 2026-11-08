# 只读架构差距审计：aims 微内核契约与当前工作台实现

日期：2026-10-28。范围：只读审计，除本报告外未修改任何文件。对象：aims 四卷中的 ModManifest、微内核目录与 T-LINES-01 要求，对照当前 `src/workflows.json` 与 `BioanalysDesktop/server/workflow_graph.js` 架构。

## 结论

1. 当前仓库没有 TypeScript 微内核。`src/mods/*/manifest.ts` 不存在，`src/core/` 与 `src/engines/` 也不存在。运行时真源是 `src/workflows.json`（三线步骤与产物）和 `src/figure_templates.json`（图模板），执行与校验由 `BioanalysDesktop/server/workflow_graph.js` 与 `BioanalysDesktop/server/figure_graph.js` 完成。
2. 这不是简单的文件缺失，而是两代架构概念混用。aims 用 TypeScript interface 与 `manifest.ts` 描述目标微内核形态，当前仓库是一个已经过 v3.0 与 v3.1 收口、K40 验证过 55 个分析脚本与 27 个图库入口的 JSON 注册表架构。T-LINES-01 的字面验收命令（`npx tsc --noEmit`）在当前架构下只能证明既有 TS 工程能编译，不能证明任何模块契约存在。
3. T-LINES-01 的功能意图（机器可读的步骤标准输出契约）已大部分实现。`workflows.json` 每个步骤声明了 `produces`，`figure_graph.js` 的 `validateReadyMapping` 对 ready 模板做 `analysis_step` 存在性、`lines`、`input_tables`、`produces`、`output_glob`、`canonical_output`、`sample_project_output` 全量校验。图模板与分析步骤的机器可读绑定不是零，已经存在并经过测试与 K40 验证。
4. 但存在校验缺口。`validateReadyMapping` 检查 `input_tables` 非空，却未断言 `input_tables` 是否为该 `analysis_step` 的 `produces` 子集，这是跨注册表一致性漏洞。`canonical_output` 在 ready 必填、非 ready 允许 null 属于有意的状态机设计，ready 值已在 `figure_adapters.js` 做 allowlist 与转义校验。
5. 在不大规模迁移的前提下，T-LINES-01 的 authoritative completion evidence 应重新定义为 JSON/JS 契约证据链，不应继续用 TypeScript 微内核的表面名词代表完成。

## 现状对照

| aims 契约项 | 目标形态 | 当前实现 | 差距性质 |
|---|---|---|---|
| `src/mods/*/manifest.ts` | TypeScript manifest，Node 动态 import 与 Vite glob 加载 | 不存在 | 形态差距，功能契约由 `workflows.json` + `figure_graph.js` 承载 |
| `ModManifest.pipelineSteps` | 类型系统内声明步骤、输入、输出 | `workflows.json` 中每个 mod 声明 `id`、`script`、`requires`、`produces`、资源估算 | 语义等价但无编译期校验，脚本存在性由 `scripts_registry_parity.test.js` 与部署闸门覆盖 |
| `FigureTemplateEntry` | 类型系统内声明 `lines`、`analysis_step`、`produces` | `figure_templates.json` 同名字段已落盘，`figure_graph.js` 做运行时校验 | 语义等价但缺 `input_tables` 与步骤 `produces` 一致性校验 |
| `CapabilityBus.query('pipeline.getStepOutputs')` | 微内核能力总线 | `figure_graph.js` 直接 `import { indexMods } from './workflow_graph.js'` | 缺总线形态，但跨模块数据流单向且显式，语义上等价于 `getStepOutputs` 查询 |
| `outputGlobs` + `adaptCodeDir` | manifest 声明，sync-engine 遍历收集 | `output_glob` 已在图模板声明；`build_client_report.py` 仍有硬编码收集逻辑 | sync 路径尚未消费 manifest 声明，属后续演进项 |
| `SlotManager` + UI 插槽 | manifest 声明 UI 贡献 | portal UI 相关逻辑硬编码在 `portal/index.html` | 不属于 T-LINES-01 范围，可后续演进 |
| T-LINES-01 字面验收 | `npx tsc --noEmit` | 项目 TS 编译可过，但没有模块契约源码 | 字面命令证据不足，须重新定义 |
| T-LINES-01 功能意图 | 三线步骤标准输出清单 | 三线全量步骤均有 `produces` 声明 | 功能意图已大部分满足，缺一致性断言与显式 manifest 命名 |

## 为什么不能声称已有 TypeScript 微内核

1. 诚实报告契约：当前实现是 JSON 注册表加 JS 校验器，已有 964 个单测、27 图库入口 K40 管线与 6 个 ready 模板真实输入适配器全部基于这个架构。把它包装成 TypeScript 微内核违反如实报告契约。逐一生成空 `manifest.ts` 文件让 `tsc` 通过，属于给门禁做样子，不能证明运行时行为。
2. 迁移成本与收益不成比例：大规模迁移需要同时迁移 portal、BioanalysDesktop、ops 与 K40 部署链路。aims 目录设计中的 `src/core/` 与 `src/engines/` 未在任何运行时代码中出现。强行搬迁需要重写 ModLoader、CapabilityBus、SlotManager、LedgerStore、PathGuard 与部署收集器，风险大且会偏离当前已验证的执行链。
3. seam 纪律：按 codebase-design 判据，一个 seam 需要至少两个真实 adapter 才值得开。当前只有一套 JSON 注册表加 JS 校验器的真实实现，尚未有第二种真实 manifest 适配器，现在引入 TypeScript manifest 层属于假想 seam。

## T-LINES-01 的 authoritative completion evidence

应放弃 `npx tsc --noEmit` 作为本项唯一证据，改为以下证据链：

1. 声明完整性：`src/workflows.json` 三线全部步骤有非空 `produces` 声明，脚本存在性由 `scripts_registry_parity.test.js` 与 `ops/06_deploy_scripts.ps1` 部署闸门验证。
2. 映射一致性：`src/figure_templates.json` 中每个 ready 模板的 `analysis_step` 引用真实 mod ID，`input_tables` 是该 mod `produces` 的子集，`lines` 与该 mod 所属 series 一致。
3. 执行闭环：每个 ready 模板有真实输入适配器与 K40 执行证据，任务 `status=completed`、`exit_code=0`、`checkpoint_status=passed`、产物哈希可对账。
4. 防漂移测试：新增或增强一个 seam 测试，断言任何 ready 模板的 `input_tables ⊆ analysis_step.produces`，并包含至少一个坏映射反例（故意指向未声明产物，测试应拒绝）。
5. 机器可读契约命名：在 `workflows.json` 顶层加 `manifest_version: 2` 与 `modules` 键，或另建 `src/module_manifests.json`，使"module manifest"成为当前架构中真实存在的机器可读键名，而不是留在 aims 文本中的 TypeScript 名词。

## 最小可行改造清单

1. 契约命名对齐：修订 `aims/00` 与 `aims/02` 中 T-LINES-01 的字面验收命令与目录描述，或至少在 aims 文本加"当前架构映射"注记，声明 JSON 注册表与 JS 校验器是当前合法实现形态，TypeScript 微内核是长期演进方向。建议在 `con_hf/SPEC_DECISIONS.md` 新增一条 D-27 予以裁定，避免 aims 与实测继续漂移。
2. 修复校验缺口：在 `BioanalysDesktop/server/figure_graph.js` 的 `validateReadyMapping` 中，取 `analysis_step` 对应 mod 的 `produces` 数组，断言 `input_tables` 是其子集。在 `tests/figure_templates_parity.test.js` 加两个反例断言（坏映射拒绝、好映射通过），同时复核当前 6 个 ready 与 10 个 `pending_mapping` 条目，为 10 个条目补齐到真实步骤产物的映射或保持 `pending_mapping`。
3. manifest 演进：不新建 `manifest.ts`。推荐在 `workflows.json` 顶层加 `manifest_version: 2` 与 `modules` 键，三线步骤声明收进 `modules`，宿主读取 `modules` 优先、`series` 兼容。expand-contract 收口时移除 `series` 顶层键。备选方案是另建 `src/module_manifests.json`，`workflows.json` 选项破坏性最低，因为它已经是 SSOT。
4. sync 消费 manifest：`build_client_report.py` 的交付收集逻辑从硬编码改为消费 manifest 中的 `output_globs` 与 `adapt_code_dir` 声明。此改动可作为后续独立票，不阻塞 T-LINES-01。
5. 风险控制：每次只动一个 seam。先做 `input_tables ⊆ produces` 断言与反例测试（红绿循环），再评估 manifest 版本升级；两件事不同时改。

## 涉及文件与测试 seam

| 变更 | 文件 | seam |
|---|---|---|
| 修复 `input_tables` 一致性校验 | `BioanalysDesktop/server/figure_graph.js` | `validateReadyMapping` |
| 增加一致性反例与正例测试 | `BioanalysDesktop/tests/figure_templates_parity.test.js` | `validateRegistry()` 返回值 |
| manifest 版本演进 | `src/workflows.json`、`BioanalysDesktop/server/workflow_graph.js` | `loadWorkflows()` / `indexMods()` |
| 裁定 aims 与当前架构映射 | `con_hf/SPEC_DECISIONS.md`、`con_hf/ledger/changes.jsonl` | 台账追加，不重写历史条目 |

## 风险

1. 一致性校验可能立即暴露当前 6 个 ready 模板中 `input_tables` 与步骤 `produces` 的真实错配，需先跑测试确认现值，再决定是修数据还是修映射策略。
2. 修改 `aims` 文本可能与 v3.1 已有"名义 D-18 至 D-21 正式落号为 D-23 至 D-26"的编号纪律冲突，需先确认编号再落笔。
3. manifest 版本升级若引入 `modules` 顶层键，会影响 `workflow_graph.js`、`figure_graph.js`、portal API 与多个 parity 测试的读取路径，必须用 expand-contract 分步做，不能一次替换。
4. 当前工作树 1788 个条目未收口，任何新改动都会进一步增加分类负担，建议在完成 T-CORE-04 之前不启动大规模 manifest 迁移。

## 不能声称完成的部分

1. 不能声称"微内核架构已完成"，因为 `src/core/`、`src/engines/`、`src/mods/*/manifest.ts` 均不存在，ModLoader、CapabilityBus、SlotManager 均未实现。
2. 不能声称"T-LINES-01 已按字面完成"，因为 `npx tsc --noEmit` 只能证明既有 TS 工程能编译，不能证明任何模块契约存在。
3. 不能声称"`input_tables` 一致性已验证"，因为当前 `validateReadyMapping` 缺这一断言，属未验证状态。
4. 不能声称"manifest 已被 sync 消费"，因为 `build_client_report.py` 仍有硬编码收集逻辑。
5. 不能声称"已达到 ready 16"，因为严格准入后当前只有 6 个 ready，10 个模板处于 `pending_mapping`，需要真实样例或修订映射契约才能升级。

## Resolution

2026-10-28 已按最小方案落地：

- 新增 D-27，明确 `src/workflows.json` 是当前 JSON module manifest 的 SSOT，不声称 TypeScript 微内核已存在。
- `workflows.json` 增加 `manifest_version=2` 与 `manifest_kind=workspace_module_registry`，并由 `validateRegistry()` 强制校验。
- `figure_graph.js` 增加 `input_tables ⊆ analysis_step.produces` 校验，修正 `fig_l2_pca` 的错误输入映射。
- `.gitignore` 仅白名单当前 6 个 ready 模板母版、预览、真实项目样例、27 入口 Plot Matrix 源文件和验证输入，避免整个 `reference/` 目录进入版本控制。
- 对应测试已通过，尚待最终全量门禁复验。
