# 整体重构迁移契约（MIGRATION.md）

> 版本：1.1 | 2026-11-09
> 性质：本仓库向 `references/08.参考工作目录结构`（Ops-Agent-Platform v1.0.6）整体重构的唯一执行契约。
> 谁读：所有参与重构的 Agent 与人。执行顺序、映射、验收、回滚都以本文为准。

## 一、决策记录

| 日期 | 裁定 | 依据 |
|---|---|---|
| 2026-11-07 | 采纳三阶段渐进吸收，严守零新增顶层目录（Argon 第 74 轮 Q7，置信度 100%） | 交接清单/07 |
| 2026-11-08 | 用户终审推翻上条：整体重构为参考结构，后续开发计划以该结构为纲 | 用户在重构评估线程明确裁定 |
| 2026-11-09 | W6 门户落位裁定：`BioanalysDesktop/` 原地保留，`tools/portal/` 槽位撤销 | W6 评估事实见本文第七节 W6 小节 |

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
- `tools/`：业务与运维工具（bio / dev / reporting / ops / examples）。
- `workspace/`：数据与制品工作区（项目产物、收发件箱）。
- `ledger/`：统一知识台账（五类 JSONL）。
- `references/`：只读参考资产库（原 `reference/`）。
- `docs/`：工程规范与架构文档（保留，属工程规范层）。
- `BioanalysDesktop/`：门户应用（W6 裁定原地保留；`tools/` 不再规划 portal 槽位）。

`docs/` 保留理由：参考结构的 `references/` 是只读资产，工程规范是活文档，两者语义不同。
活的规范留在 `docs/`，只读标杆进 `references/`。

## 四、全量映射表

| 现路径 | 目标路径 | 波次 |
|---|---|---|
| `ops/router.yaml` | `ROUTER.yaml` | W1 已完成 |
| `docs/SCOPE.md` | `SCOPE.md` | W1 已完成 |
| `con_hf/CONTEXT.md` | `GLOSSARY.md` | W1 已完成 |
| `src/engines/*`（空占位，已清理）、`src/bridge_guard.sh` | `core/` | W3 已完成 |
| `ops/schema_gateway.py` + 任务契约 | `schemas/` | W4 已完成 |
| `src/line1_bulk` | `tools/bio/line1_bulk` | W3 已完成（git mv 保留历史） |
| `src/line2_scrna` | `tools/bio/line2_scrna` | W3 已完成（git mv 保留历史） |
| `src/line3_spatial` | `tools/bio/line3_spatial` | W3 已完成（git mv 保留历史） |
| `src/workflows.json`、`src/figure_templates.json` | `tools/bio/` | W3 已完成（git mv 保留历史） |
| `ops/*.mjs` 门禁与库 | `tools/dev/` | W5a 已完成（31 件 + work_order 两件 + lib/diagnostics） |
| `ops` 出图与报告脚本 | `tools/reporting/` | W5 |
| `ops` PowerShell 运维入口 | `tools/ops/` | W5 |
| `ops/work_order_orchestrator.mjs` | `skills/stable/ops/` 绑定的工具 | W7 |
| `con_hf/ledger/` | `ledger/` | W8 已完成 |
| `local_projects/` | `workspace/projects/` | W8 已完成 |
| `reference/` | `references/` | W9 已完成 |
| `BioanalysDesktop/` | 原地保留 | W6 已裁定 |
| `con_hf/handoff.md`、`con_hf/SPEC*.md`、`con_hf/dispatch/`、`con_hf/topic_survey/`、根级计划与汇报快照 | `workspace/handoff/` | W8 已完成 |
| `con_hf/ops_ledger.md`、`con_hf/pitfalls_ledger.md`、`con_hf/踩坑台账.md`、图件台账 | `ledger/` | W8 已完成 |
| `con_hf/runs/` | `docs/runs/` | W8 已完成 |
| `con_hf/sync/` | `ledger/sync/` | W8 已完成 |
| `docs/` | 保留原地 | 不迁 |

映射表执行时逐波细化到文件级，波内用 `git mv` 保留历史。

## 五、波次与验收

| 波 | 内容 | 验收判据 |
|---|---|---|
| W1 | 治理文件上移 + 骨架目录落地 | `router_gate` 绿；router 契约测试绿；残留引用为零 |
| W2 | 三线与注册表迁 `tools/bio/` | 全量测试绿；`k40_script_parity` 绿；`workflows.json` 路径全解析 |
| W3 | 引擎与桥接守卫迁 `core/`，三线母版物理迁 `tools/bio/` | 全量测试 1953 对齐基线；24 门禁全绿；k40 parity 绿 |
| W4 | 契约网关迁 `schemas/` | `schema_gateway` 契约绿；短命 IPC 三态退出码不变 |
| W5a | `ops/*.mjs` 门禁与库迁 `tools/{dev,reporting}/` | `run_all_gates --skip-tests` 24/24 绿；1953 tests 对齐基线；`enforced_by` 白名单已换 tools/dev |
| W5b | 报告与运维脚本迁 `tools/{reporting,ops}/` | 全量测试绿；K40 同步契约同步更新 |
| W6 | 门户应用落位评估 | 出评估记录；裁定为原地保留，回归保持基线全绿 |
| W7 | SOP 转 `skills/` 规约资产 | 首个 skill（工单编排）YAML 解析绿；exit_criteria 与门禁一一对应 |
| W8 | 台账与数据面迁 `ledger/`、`workspace/` | ledger 契约绿；服务器侧路径同步方案落地 |
| W9 | `reference/` 改名 `references/` | 索引双向匹配；gitignore 白名单同步 |
| W10 | 总收口 | 官方全量测试对齐基线；全量门禁（当前 25 道）全绿；便携包重建一致；AGENTS.md 与 docs 导航全更新 |

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
| W4 | 已完成（schema_gateway 迁入 schemas/） |
| W5b | 已完成（21cfa5e + 9a1a0af + e17bb9b） |
| W6 | 已裁定（评估与契约收口） |
| W7 | 已完成（工单 skill + skills 契约门禁，门禁数 24 增至 25） |
| W8 | 已完成（数据面与台账迁入 workspace/ 与 ledger/） |
| W9 | 已完成（reference/ 改名 references/，白名单同步） |
| W10 | 排队 |

### W8 评估结论

仓库侧改为 `workspace/projects/` 与 `ledger/`，设备侧固定布局不变。核心事实：

1. 本地项目根只服务开发与回搬视图，设备侧项目根仍是 `/mnt/ssd/bio_data/projects/`。
   两侧语义对应，路径不互相推导。
2. `con_hf/ledger/` 五类 JSONL 迁 `ledger/`，`con_hf/sync/` 迁 `ledger/sync/`。
   追加式台账的历史条目保留写入时路径原文，作为当时事实的证据，不做回写。
3. 交接、决策、历史派单与调研快照归 `workspace/handoff/`；历史运行记录归 `docs/runs/`。
4. 历史 QA 事故隔离脚本继续使用设备侧原始路径与固定哈希，不随仓库目录重构改写。
5. 历史交接、结项与评审文档保留写入时的路径原文，作为当时事实的证据；活文档与代码常量使用新结构。

### W6 评估结论

裁定：`BioanalysDesktop/` 原地保留，`tools/portal/` 槽位撤销。核心事实：

1. 门户是独立运行面：自有 `package.json`、Vite 构建产物、228 个契约测试；
   `start_workbench.bat` 与便携包 `start-workbench.cmd` 都按应用根锚定。
2. 门禁与治理已把它登记为受控应用区：`clean_workspace` 神圣名单、
   `proc_seam_guard` 扫描面、`dist_parity_gate` 关键资产、`metrics_sync` 统计面
   与 `router_gate` 黄金集入口都引用该路径。
3. 迁入 `tools/portal/` 只带来目录名收益，代价是 40 个测试文件、8 个服务模块、
   13 个门禁与两个启动器同时重写，还会打断便携包同源基线。
4. 参考结构没有强制 `tools/portal/` 槽位；其 `tools/` 是领域无关容器。
   本项目把门户视为应用根，与参考 `run_order_easy.py` 的一键入口同级，保留原地语义更准确。
