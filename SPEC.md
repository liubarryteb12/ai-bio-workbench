# 架构宪法（SPEC.md）

> 版本：1.0 | 2026-11-08
> 定位：本仓库的最高架构原则。每条原则都绑定真实存在的执行门禁，只写被强制执行的事实。

## 使命

为三条生信分析线（bulk、单细胞、空间转录组）提供受控、可信、可验证的自动化工作台：
确定性代码做执行与防线，模型做决策与参数抽取，过程全审计。

## 三原则

### 原则一：三明治架构

外部触发由确定性代码捕获；模型只在约束范围内匹配路由、抽取参数；工具执行前必须过
强类型网关断言。

执行门禁：`schemas/schema_gateway.py`（短命文件 IPC，0=ALLOW、2=DENY、1=ERROR）、
`BioanalysDesktop/server/task_fsm.js`、`ops/router_gate.mjs`。

### 原则二：控制面与数据面物理隔离

代码、门禁、规约在控制面（core / tools / skills / schemas / ops）；客户数据、中间态、
交付物只在数据面（workspace、服务器 projects）。算力与传输默认走 ADB 通道。

执行门禁：`tools/ops/02_check_isolation.ps1`、`tools/dev/test_isolation_gate.mjs`、
`docs/remote_channel_policy.md` 契约测试。

### 原则三：Fail-Closed 与真源唯一

网关故障即拒绝（CI 传 bypass 必红）；一个含义一个真源；已否决设计进 `SCOPE.md` REJ
台账，每条绑定可执行门禁与 180 天有效期上限。

执行门禁：`tools/dev/router_gate.mjs`（REJ 生命周期与 enforced_by 校验）、
`BioanalysDesktop/tests/schema_gateway.test.js`（MUT-P2-A bypass 必红）、
`tools/dev/mutation_gate.mjs`（变异反证）。

## 边界与红线索引

- 范围与已否决设计：`SCOPE.md`（REJ 台账，含算力与内存红线 REJ-006）。
- AI 执行纪律：`AGENTS.md`（真源；`AGENT.md` 是它的入口指针）。
- 结构与迁移：`MIGRATION.md`、`INDEX.yaml`。
- 术语：`GLOSSARY.md`。

## 修订规则

改本文件属于架构裁定，须在决策记录层面留痕：提交信息说明裁定来源
（用户终审、复审轮次或测试反证），并同步 `INDEX.yaml` 的版本号。
