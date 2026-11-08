# 技能指令：结构化工单自动执行与验收

## 任务目标

你当前处于【工单自动执行】场景。输入是一份 `work_order/v1` 结构化工单，输出是完成
建项、上传、DAG 派发、逐任务验收、报告验收、项目汇总与工单回执的闭环结果。

规范正本是 `docs/WORK_ORDER_ORCHESTRATOR.md`。本指令只保留执行顺序与判定口径，
字段表与接口细节以正本为准。

## 执行前置检查

1. 核验 `schema_version` 为 `work_order/v1`，项目号、分析线、Mod、图件与上传名全部合法。
2. 核验图件只来自 `tools/dev/figure_ready_allowlist.json` 的 Ready 单图。
3. 核验计算通道。缺省为 `adb`。只有显式 `computeAdapter=ssh` 且 `allowSsh=true` 才走 SSH。
4. 核验 seed。工单未写时使用 `tools/bio/workflows.json` 中该线的固定 seed。

## 执行顺序

1. 调 `tools/dev/work_order_orchestrator.mjs`，用 `tools/bio/workflows.json` 编译闭包与 DAG。
2. 建项、上传、拉取执行计划，任务数与顺序必须等于编译 DAG。
3. 逐项提交并等待完成回执。上游失败立即停止，下游保持 `blocked`。
4. 全部成功后构建报告，复核四关验收哨兵与 `delivery_verified=true`。
5. 落盘 `Project_Summary.md` 与 `work_order.receipt.json`，两者只含业务状态、产物名与脱敏相对路径。

## 验收

运行 `node tools/dev/work_order_orchestrator_gate.mjs`，以
`WORK_ORDER_ORCHESTRATOR_GATE_OK` 为通过哨兵。门禁使用确定性合成工单与本地 mock
客户端，不连接远端设备，不触发分析计算。

## 输出格式

成功时输出结构化结果：

```json
{
  "workOrderId": "WO-EXAMPLE",
  "projectId": "PRJ_EXAMPLE",
  "computeAdapter": "adb",
  "dispatchedTasks": ["ingest", "qc"],
  "deliveryVerified": true,
  "summaryPath": "report/Project_Summary.md",
  "receiptPath": "report/work_order.receipt.json"
}
```

失败时输出错误码与失败阶段，不输出部分成功结论。
