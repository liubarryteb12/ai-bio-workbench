# Spec 到阶段 TODO 到 Goal 的运行契约

> version 0.1 | 2026-11-11
> 定位：给用户可见的「写一份 spec，拆阶段任务，开 goal 后无人值守」提供最小契约。
> 本文只写阶段边界、前置裁定与终态判据。规范正本见 [mattpocock-workflow-spec.md](mattpocock-workflow-spec.md)、[PRODUCTIZATION_SPEC.md](PRODUCTIZATION_SPEC.md)、[PRODUCTIZATION_TICKETS.md](PRODUCTIZATION_TICKETS.md)、[WORK_ORDER_ORCHESTRATOR.md](WORK_ORDER_ORCHESTRATOR.md)。

## 结论

兼容，但分两层：

1. 代码工程任务可由 `spec.md` 拆成阶段与任务，开 goal 后按 tracer bullet 逐票推进到全部门禁绿灯。
2. 生信分析任务只能推进到「已审核入队」，随后由队列泵接管。设备离线、输入缺失、未审核、服务重启、验收失败一律停在既有状态，保持证据与状态一致。

「睡醒就完成」的成立条件是：目标范围、写权限、允许触碰的真源、终态判据、阻塞时停机策略、审核授权方式都由用户预先裁定。需求模糊的项留给人工判断，goal 不替用户做决策。

这份契约的落地样例见 [AI_ORCHESTRATION_SPEC.md](AI_ORCHESTRATION_SPEC.md) 与 [AI_ORCHESTRATION_TICKETS.md](AI_ORCHESTRATION_TICKETS.md)。

## 用户写的 spec.md 最小字段

| 字段 | 内容 | 完成判据形态 |
| :--- | :--- | :--- |
| `objective` | 一句话目标与非目标 | 可判定是否超出范围 |
| `scope` | 允许写与保留原状的路径清单 | 路径清单 |
| `stages` | 有依赖边的阶段列表 | 每阶段有出口命令与哨兵 |
| `tickets` | 每阶段内一张 tracer bullet 票 | 红测、实现、验收命令、回滚点 |
| `acceptance` | 全局终态命令、回执路径、基线数字 | 命令退出码与文件状态 |
| `blocked_policy` | 离线、冲突、缺数据、审核缺失时的动作 | 停机、重试上限与终态 |
| `decisions` | 已由用户裁定的单向门 | 裁定来源与日期 |

已有真源不进 spec 正文。字段表、命令帮助、目录布局、测试数量、版本号一律用 context pointer 指向环境或既有文档。新增正文只写选择理由、不成文约定、验收口径与坑位。

## 阶段与任务模板

```markdown
# <专题名> spec

## 裁定
- 目标：
- 非目标：
- 允许写：
- 保留原状：
- 阻塞时：

## 阶段 S0：对齐与反馈环
- 红测：<测试路径与必红原因>
- 出口：<命令>，<哨兵>
- 票：S0-T1 <垂直切片名>，阻塞边：无

## 阶段 S1：实现
- 依赖：S0 出口全绿
- 红测：<测试路径与必红原因>
- 出口：<命令>，<哨兵>
- 票：S1-T1 <垂直切片名>，阻塞边：S0-T1

## 阶段 S2：收口
- 依赖：S1 出口全绿
- 出口：`node tools/dev/dist_parity_gate.mjs`，`node tools/dev/run_all_gates.mjs --skip-tests`，`cd BioanalysDesktop; npm test`
- 回执：<文件或汇总路径>
```

每张票必须窄而完整，穿过 schema、接口、界面与测试中的适用层。每张票先红后绿，收口跑自己的验收命令与总门禁。票之间清上下文，`implement-spec` 只调度 frontier，不替用户裁定需求。

## Goal 启动模板

```text
objective: 按 <spec 路径> 从 S0 推进到 S2。每轮只推进 frontier 上一张票，先写红测再实现，收口跑该票验收命令与总门禁；阻塞时按 spec 的 blocked_policy 停机并回报，不自动缩小范围，不自动改判据，不自动越过审核门；全部 acceptance 通过且终态回执落盘后标记完成并汇报证据。
```

创建 goal 属于用户显式动作。当前 chat 没有活动 goal 时，把上面 `objective` 交给用户的 `/goal` 或 `create_goal` 动作即可。goal 自身只维持续跑与终态审核，不承载 spec 正文。

## 自动完成的终态

代码工程任务完成必须同时满足：

1. 每票红测与验收命令全绿，阶段依赖边按顺序关闭。
2. `node tools/dev/run_all_gates.mjs --skip-tests` 输出 `GATE_ALL_OK`。
3. `cd BioanalysDesktop; npm test` 达到 spec 声明的基线，`fail=0`。
4. 便携包与源码同源时，`node tools/dev/dist_parity_gate.mjs` 分叉与缺失均为 0。
5. `git status --porcelain` 里没有计划外文件，收口记录写明改动文件、证据与遗留风险。

生信分析任务完成必须同时满足：

1. 工单已由用户预授权或管理员确认，`approved=true` 且 `status=queued` 后由队列泵接管。
2. `workspace/projects/<project_id>/report/receipt.v1.json` 为 `completed`，成功哨兵为 `PRODUCTIZATION_RECEIPT_OK`。
3. `acceptance` 通过四关验收，`delivery_verified=true`，产物清单含相对路径、大小与 SHA-256。
4. 编排器与工作台元数据一致，失败和阻塞不写成功投影。
5. 报告正文保持脱敏，不含机器名、主机名、绝对路径、运行环境、内部脚本目录与设施用语。

## 停机条件

遇到下列任一条件，goal 停在当前票并回报，不继续 downstream：

- 需求缺字段、依赖边矛盾、验收命令不可执行、红测不红。
- 两个合理实现需要用户在成本、范围或视觉上做取舍。
- 工单未审核，或服务接口要求管理员确认。
- ADB 设备离线、算力通道失败、输入文件哈希不符、上游失败、远端回执缺失。
- 进程重启后作业被标为 `failed`，或权威回执为 `failed`、`blocked`。
- 门禁变红、便携包分叉、测试基线变化、报告脱敏判据变红。

按 [remote_channel_policy.md](remote_channel_policy.md)，ADB 失败即报错，SSH 只在用户显式特殊开关下启用，不自动回落。按 [PRODUCTIZATION_SPEC.md](PRODUCTIZATION_SPEC.md) 第七节，AI 管理员编排按 [AI_ORCHESTRATION_SPEC.md](AI_ORCHESTRATION_SPEC.md) 执行，条件是独立凭证、全局单权威租约、人工强制接管与回执 actor 留痕。Electron 安装包仍在后续阶段，四关验收判据与审计流字段保持原位。

## 预授权的可选边界

用户若希望「睡醒后分析也算完成」，必须在 spec 的 `decisions` 里逐项写明：

1. 是否允许把指定工单设成 `require_admin_review=false`，或是否只对指定工单做一次性预批准。
2. 设备离线的重试次数、等待间隔、超限后写 `blocked` 还是 `failed`。
3. 服务重启后的作业处理口径，现有实现会把无 inflight 的 `running` 作业按 `failed` 恢复。
4. 可触碰的分析线、项目、Mod 与 Ready 单图白名单。
5. 全量测试与总门禁是否纳入收口，以及便携包是否需要重建。

这些裁定会改变现有产品化规格的非目标，属于架构裁定，须先更新 [PRODUCTIZATION_SPEC.md](PRODUCTIZATION_SPEC.md) 与 [SCOPE.md](../SCOPE.md) 的相应边界，再让 goal 执行。相关裁定到位后，goal 执行对应边界；裁定前，goal 完成代码工程任务，或把分析作业推进到已审核入队。
