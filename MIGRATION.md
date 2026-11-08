# 整体重构迁移契约（MIGRATION.md）

> 版本：1.0 | 2026-11-08
> 性质：本仓库向 `reference/08.参考工作目录结构`（Ops-Agent-Platform v1.0.6）整体重构的唯一执行契约。
> 谁读：所有参与重构的 Agent 与人。执行顺序、映射、验收、回滚都以本文为准。

## 一、决策记录

| 日期 | 裁定 | 依据 |
|---|---|---|
| 2026-11-07 | 采纳三阶段渐进吸收，严守零新增顶层目录（Argon 第 74 轮 Q7，置信度 100%） | 交接清单/07 |
| 2026-11-08 | 用户终审推翻上条：整体重构为参考结构，后续开发计划以该结构为纲 | 用户在重构评估线程明确裁定 |

上表第二条为当前生效裁定。零新增顶层目录约束自此解除，已吸收的机制资产（schema 网关、
降级状态机、原子写、门禁）原样保留，只做物理落位调整。

## 二、基线与回滚

- 基线提交：`eb206ca`，tag：`restructure-baseline-20261108`（1953 tests 全绿，24 门禁全通）。
- 每波收口单独成提交，提交信息前缀 `restructure(Wn)`。
- 任一波验收失败且当轮修不绿：`git reset --hard` 回该波起点提交，波内产物作废重排。
- 全部波次收口前，`restructure-baseline-20261108` 保留为最终退回点。

## 三、目标顶层结构

- `SPEC.md`：架构宪法（原则层，每条原则绑定执行门禁）。
- `AGENT.md`：AI 入职入口指针（真源 `AGENTS.md`）。
- `AGENTS.md`：AI 入职纪律与导航（工具链自动加载的真源）。
- `SCOPE.md`：范围与已否决设计 REJ 台账。
- `GLOSSARY.md`：领域术语表（唯一权威）。
- `LICENSES.md`：商用合规许可 posture。
- `MIGRATION.md`：本契约。
- `ROUTER.yaml`：事件与场景路由总表。
- `INDEX.yaml`：全局导航中枢（机器可读）。
- `core/`：框架运行时（引擎、桥接守卫）。
- `hooks/`：切面钩子资产（安全、审计）。
- `schemas/`：强类型契约网关。
- `skills/`：SOP 规约资产（stable 分级 + in-progress）。
- `tools/`：业务与运维工具（bio / dev / reporting / ops / portal / examples）。
- `workspace/`：数据与制品工作区（项目产物、收发件箱）。
- `ledger/`：统一知识台账（五类 JSONL）。
- `references/`：只读参考资产库（原 `reference/`）。
- `docs/`：工程规范与架构文档（保留，属工程规范层）。
- `BioanalysDesktop/`：门户应用（W6 起评估是否迁入 `tools/portal/`）。

`docs/` 保留理由：参考结构的 `references/` 是只读资产，工程规范是活文档，两者语义不同。
活的规范留在 `docs/`，只读标杆进 `references/`。

## 四、全量映射表

| 现路径 | 目标路径 | 波次 |
|---|---|---|
| `ops/router.yaml` | `ROUTER.yaml` | W1 已完成 |
| `docs/SCOPE.md` | `SCOPE.md` | W1 已完成 |
| `con_hf/CONTEXT.md` | `GLOSSARY.md` | W1 已完成 |
| `src/engines/*`（空占位，已清理）、`src/bridge_guard.sh` | `core/` | W3 已完成 |
| `ops/schema_gateway.py` + 任务契约 | `schemas/` | W4 |
| `src/line1_bulk` | `tools/bio/line1_bulk` | W3 已完成（git mv 保留历史） |
| `src/line2_scrna` | `tools/bio/line2_scrna` | W3 已完成（git mv 保留历史） |
| `src/line3_spatial` | `tools/bio/line3_spatial` | W3 已完成（git mv 保留历史） |
| `src/workflows.json`、`src/figure_templates.json` | `tools/bio/` | W3 已完成（git mv 保留历史） |
| `ops/*.mjs` 门禁与库 | `tools/dev/` | W5 |
| `ops` 出图与报告脚本 | `tools/reporting/` | W5 |
| `ops` PowerShell 运维入口 | `tools/ops/` | W5 |
| `ops/work_order_orchestrator.mjs` | `skills/stable/ops/` 绑定的工具 | W7 |
| `con_hf/ledger/` | `ledger/` | W8 |
| `local_projects/` | `workspace/projects/` | W8 |
| `reference/` | `references/` | W9 |
| `BioanalysDesktop/` | 原地保留或 `tools/portal/` | W6 评估 |
| `con_hf/` 其余（handoff、sync、runs、SPEC-*） | `workspace/handoff/`、`ledger/sync/`、`docs/runs/` | W8 |
| `docs/` | 保留原地 | 不迁 |

映射表执行时逐波细化到文件级，波内用 `git mv` 保留历史。

## 五、波次与验收

| 波 | 内容 | 验收判据 |
|---|---|---|
| W1 | 治理文件上移 + 骨架目录落地 | `router_gate` 绿；router 契约测试绿；残留引用为零 |
| W2 | 三线与注册表迁 `tools/bio/` | 全量测试绿；`k40_script_parity` 绿；`workflows.json` 路径全解析 |
| W3 | 引擎与桥接守卫迁 `core/`，三线母版物理迁 `tools/bio/` | 全量测试 1953 对齐基线；24 门禁全绿；k40 parity 绿 |
| W4 | 契约网关迁 `schemas/` | `schema_gateway` 契约绿；短命 IPC 三态退出码不变 |
| W5 | `ops/` 分流 `tools/{dev,reporting,ops}/` | `run_all_gates --skip-tests` 24/24 绿；`enforced_by` 白名单同步更新 |
| W6 | 门户应用落位评估 | 出评估记录；两种落位方案的回归全绿者胜出 |
| W7 | SOP 转 `skills/` 规约资产 | 首个 skill（工单编排）YAML 解析绿；exit_criteria 与门禁一一对应 |
| W8 | 台账与数据面迁 `ledger/`、`workspace/` | ledger 契约绿；服务器侧路径同步方案落地 |
| W9 | `reference/` 改名 `references/` | 索引双向匹配；gitignore 白名单同步 |
| W10 | 总收口 | 官方全量测试对齐基线；24 门禁全绿；便携包重建一致；AGENTS.md 与 docs 导航全更新 |

## 六、外部项目迁入六步 SOP（面向后续新项目）

1. 脚手架：按本文第三节结构建目录，登记 `INDEX.yaml`。
2. 搬迁：业务代码进 `tools/<项目>/`，入参显式收 `input_dir`、`work_dir`、`output_dir`。
3. 契约：参数进 `schemas/`，走短命文件 IPC 网关（0=ALLOW，2=DENY，1=ERROR）。
4. 规约：SOP 进 `skills/stable/<类>/`，写 `skill.yaml` 与 `prompt.md`，验收指令机器可跑。
5. 路由：场景进 `ROUTER.yaml`，`allowed_scripts` 只填真实注册的 Mod 或脚本。
6. 验收：全量测试、`run_all_gates`、变异反证三件套全绿后准接单。

## 七、当前状态

| 波 | 状态 |
|---|---|
| W1 | 已完成（1e778f9） |
| W2 | 已完成（fe0cdcf，k40 双向同源） |
| W3 | 已完成（fb866c7，物理迁移 + 全量对齐） |
| W4 到 W10 | 排队 |
