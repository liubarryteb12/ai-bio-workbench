# 参考工作目录结构评估（reference/08）

> 评估日期：2026-11-08
> 评估对象：`reference/08.参考工作目录结构`（快照 v1.0.6-clean-release，46 文件）
> 评估背景：L1-L3 流水线功能对话已收尾，官方全量测试 1953 tests / 1952 pass / 0 fail / 1 skipped，
> `run_all_gates --skip-tests` 24/24 全绿，便携包已重建。该基线是本次评估与后续任何结构改动的前提。
> 决策状态：2026-11-08 用户终审裁定整体重构为参考结构，W1 到 W5b 已按 MIGRATION.md 落地。
> 本文档保留为评估记录，其中与已落地结构冲突的旧结论以 MIGRATION.md 为准。

## 一、结论

**不建议把当前项目整体重构成参考目录结构。** 三条理由：

1. **参考是一个 46 文件的通用 MVP 骨架，当前项目是 1953 tests 全绿的成熟体系。**
   参考定位是领域无关的 Ops-Agent-Platform 底座模板；本项目是三条生信线的生产工作台，
   已带 228 个桌面端契约测试、99 个 ops 测试、25 道门禁与 K40 部署 parity 校验。
   整体搬迁等于用骨架替换成品。
2. **参考的核心机制本项目大多已有等价或更强的实现**（见第三节映射表）。
   物理换目录不带来新能力，只带来路径、真源与部署面的全面重写。
3. **参考快照自身不完整**：其文档引用的 10 个关键文件在快照中不存在（见第四节），
   包括 `core/tool_executor.py`、`governance/MVP_MANIFEST.yaml`、`tests/unit`、
   `storage/audit_logger.py` 与三类台账索引。照抄结构会引入悬空引用。

真正值得吸收的是**概念与文档模式**，不是目录形状。建议按第五节四项吸收，全部低风险。

## 二、参考结构是什么

七个 block：governance（SPEC/AGENT/SCOPE/GLOSSARY/LICENSES/MIGRATION）、router（ROUTER.yaml + dispatcher）、
ledgers（knowledge_ledger.jsonl）、references（INDEX + ADR + 代码片段）、skills（stable/in-progress 分级技能）、
execution_and_defense（Pydantic schemas + 白名单工具）、runtime_controls（循环熔断、钩子、检查点、任务清单）。
外加 `workspace/` 数据面（00_input 只读、01_work 中间态、02_output 交付、收件箱/发件箱）与 `run_order_easy.py` 一键入口。

核心思想三条：三明治架构（确定性代码夹住模型决策）、最小上下文与参考对齐、强类型断言防线。这三条本身是对的。

## 三、概念映射：参考 vs 本项目现状

| 参考概念 | 本项目现状 | 对比 |
|---|---|---|
| ROUTER.yaml 事件路由 | `ROUTER.yaml` + `router_gate.mjs` + `route_dispatcher.js` | 已有，且门禁校验路径存在性 |
| Pydantic schemas 防火墙 | `ops/schema_gateway.py` + task FSM + 任务提交校验 | 已有，跨 JS/Py 双语言 |
| workspace 三态数据面 | 服务器 `projects/<线>/{raw_data,processed,results}` + `workspace/projects/` 回搬 + 交付打包 | 已有，服务器侧为英文路径 |
| checkpoint 断点续跑 | `src/*/checkpoint/` + `verify_bridge_checkpoint.py` + bridge_guard | 已有 |
| 知识台账 ledger | `ledger/` 五类 JSONL + 项目级 ledger | 已有，粒度更细 |
| REJ 已否决设计台账 | `SCOPE.md` 12 条 REJ，`enforced_by` 由门禁校验 | 本项目更强（含有效期与撤销链） |
| hooks 安全/审计钩子 | 25 道门禁 + audit.js + 变异反证 mutation_gate | 本项目更强（含变异反证纪律） |
| references 参考资产库 | `reference/` 编号目录 + inventory + gen_reference_index | 已有，规模更大 |
| skills/stable 规约资产（skill.yaml + prompt.md） | 无独立 skills 层，SOP 散在 docs/*.md | **缺口，值得吸收** |
| 一键接单入口 run_order_easy.py | BioanalysDesktop 门户 + 工单编排器 + 交付打包 | 已有且更完整 |
| GLOSSARY 术语表 | `GLOSSARY.md`（唯一权威，2026-11-08 由 con_hf/CONTEXT.md 迁入） | 已有，避免重复建真源 |
| AGENT.md 入职导航 | 根 `AGENTS.md`（导航指针模式） | 已有且更精炼 |

## 四、参考快照的完整性缺口

以下文件被参考自身文档或 manifest 引用，但快照中不存在：

`core/tool_executor.py`（第五步注册的核心网关）、`governance/MVP_MANIFEST.yaml`、根 `INDEX.yaml`、
`config/settings.py`、`ledgers/{reuse,pitfalls,success}/INDEX.yaml`（AGENT.md 强制查阅路径）、
`tests/unit`、`storage/audit_logger.py`（SPEC 红线三的落点）、`requirements.txt`。

另外两点结构冲突：`workspace/01_收件箱_放客户文件` 使用中文目录名，违反本项目服务器侧英文路径红线；
参考是 Python 单栈（Pydantic + pytest），与本项目 JS 门禁 + PowerShell 运维 + Python 分析的多语言生态不匹配。

## 五、建议吸收的四项（低风险，逐项可验收）

| 项 | 动作 | 落点 | 验收判据 |
---|---|---|---|
| A1 技能规约层 | 挑一个成熟 SOP（建议工单编排器）试点转成 `skill.yaml` + `prompt.md` 机器可读规约，含 allowed_tools、exit_criteria、verify_commands | `skills/stable/ops/work_order/`（新目录，不动现有代码） | 规约文件通过 YAML 解析；exit_criteria 与现有门禁一一对应 |
| A2 概念映射表 | 把第三节映射表并入 `docs/ARCHITECTURE_OVERVIEW.md` 末尾，标注各机制的等价实现位置 | `docs/ARCHITECTURE_OVERVIEW.md` | 表内路径全部真实存在 |
| A3 术语别名登记 | 把「三明治架构、三态数据面、技能规约」作为别名登记进领域术语表，注明来源为 reference/08 | `GLOSSARY.md` | 术语表新增条目含定义与出处 |
| A4 迁移六步 SOP 吸收 | 把参考 MIGRATION 的「脚手架、搬迁、Schema、E11/E12 验收、注册路由、扫描合规」六步融合进现有工作流规范 | `docs/mattpocock-workflow-spec.md` | 工作流规范出现六步骨架且引用本项目真实工具 |

不建议做的：根目录按 core/hooks/schemas/tools/workspace 重排；`src/` 三线拆进 `tools/`；
在本地建中文收发件箱目录；用 Pydantic 重写 JS 门禁生态。

## 六、如果仍要整体重构（不推荐路径的预算）

若用户裁定整体重构，必须按下列顺序走，缺一步即回退：

1. 以当前 1953 tests 全绿快照为基线，先打 git tag 与便携包快照；
2. 出全量路径映射表（git mv 清单），过 `router_gate`、`k40_script_parity`、`dist_parity_gate` 预检；
3. 只允许一次原子迁移窗口，同步更新 `workflows.json`、AGENTS.md 导航表与 docs 真源；
4. 迁移后全量测试 + 全量门禁 + 便携包重建全部对齐基线才许收口。

预估代价：数百个路径引用重写、K40 部署面全量重推、历史 git blame 断链。收益仅为目录名可读性，
而该收益通过 A2 概念映射表即可获得大部分。
