# 结构化工单编排器

> version 1（2026-11-08）

## 用途

`ops/work_order_orchestrator.mjs` 是不依赖 AI 对话的单入口自动执行器。输入一份结构化工单 JSON，顺序完成建项、上传、按 DAG 派发、逐任务完成回执核对、报告构建、交付验收、项目汇总与工单回执。任何上游失败立即短路，下游保持 `blocked`，不把部分产物写成成功。

计算通道由产品服务端决定，默认 ADB。工单不带 `computeAdapter` 时记为 `adb`。只有工单显式写 `computeAdapter=ssh` 且 `allowSsh=true` 才允许特殊场景启用 SSH。编排器自身不导入远端执行接缝，不启动 SSH，不自动回落。

## 工单字段

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `schema_version` | 是 | 固定 `work_order/v1` |
| `workOrderId` | 否 | 工单号，缺省按项目号派生 |
| `projectId` | 是 | 合法项目 ID，只允许字母数字、点、下划线、连字符 |
| `lineId` | 是 | `line1_bulk`、`line2_scrna`、`line3_spatial` 之一 |
| `modIds` | 是 | 选择的 Mod，编排器按 `src/workflows.json` 补齐必需上游闭包 |
| `figureSelections` | 否 | 只允许 `tools/dev/figure_ready_allowlist.json` 中的 Ready 单图，组图与 draft 一律拒绝 |
| `uploads` | 否 | `filename` 与 `content_base64`，按线上传到项目 raw data |
| `seed` | 否 | 缺省用该线 `src/workflows.json` 的固定 seed |
| `computeAdapter` | 否 | `adb` 默认，`ssh` 需 `allowSsh=true`，`mock` 仅测试 |
| 建项字段 | 视服务端契约 | `basicInfo`、`dataSource`、`groupingDesign`、`analysisCutoffs` 等原样透传给 `/api/projects/create` |

样例见 `tools/examples/work_order.example.json`。

## 执行判据

1. 先静态校验工单，项目 ID、分析线、Mod、图件、上传名、seed、通道开关任一不合法即拒绝。
2. 用 `src/workflows.json` 编译 DAG，分析 Mod 与图件前置 Mod 必须同线，缺的上游必需阶段自动补齐。
3. 调 `/api/projects/create`，再按 `/api/upload/init`、`chunk`、`complete` 上传，每个文件必须有 `sizeMatch=true` 回执。
4. 调 `/api/projects/execution-plan`，任务数与顺序必须等于编译 DAG，否则 `ERR_DAG_PARITY`。
5. 逐项调 `/api/tasks/submit`，串行等待 `/api/tasks` 与 `/api/ledger/check`，完成回执必须满足：项目、线、步骤、状态、退出码、seed、台账回执与产物清单吻合。
6. 上游失败即停止派发，不继续下游，不构建报告。
7. 全部成功后调 `/api/report/build`，要求四关验收哨兵，再用 `/api/report/files` 复核 `delivery_verified=true` 与两份解读报告、交付 tar 包。
8. 通过后在 `local_projects/<projectId>/report/` 写 `Project_Summary.md` 与 `work_order.receipt.json`。汇总与回执只含业务状态、产物名与机密脱敏后的相对路径，不含机器名、运行环境、绝对路径或内部脚本目录。

## 运行

```powershell
node ops/work_order_orchestrator.mjs tools/examples/work_order.example.json --base-url http://127.0.0.1:18787
```

需要鉴权时由环境变量 `BIO_WORKBENCH_USER` 与 `BIO_WORKBENCH_PASS` 提供，凭证不写入工单和回执。CLI 成功输出 `WORK_ORDER_ORCHESTRATOR_OK`，失败输出错误码并以退出码 1 结束。

门禁入口：

```powershell
node ops/work_order_orchestrator_gate.mjs
```

门禁只跑确定性合成工单与本地 mock HTTP 客户端，不连接设备，不执行分析计算。报告落 `docs/WORK_ORDER_ORCHESTRATOR_REPORT.md`，成功哨兵 `WORK_ORDER_ORCHESTRATOR_GATE_OK`。

## 与旧同步守护进程的关系

`tools/ops/sync_daemon.ps1` 保留门户收件箱轮询与结果回传能力。它没有完成回执逐项校验，任务之间只按固定等待，不能单独作为严格验收证据。新编排器以工单 JSON 为入口，把同样的服务接口收紧成可复核的 fail closed 闭环。
