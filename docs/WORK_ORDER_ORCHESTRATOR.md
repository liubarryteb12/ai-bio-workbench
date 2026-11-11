# 结构化工单编排器

> version 1（2026-11-08）

## 用途

`tools/dev/work_order_orchestrator.mjs` 是不依赖 AI 对话的单入口自动执行器。输入一份结构化工单 JSON，顺序完成建项、上传、按 DAG 派发、逐任务完成回执核对、报告构建、交付验收、项目汇总与工单回执。任何上游失败立即短路，下游保持 `blocked`，不把部分产物写成成功。

计算通道由产品服务端决定，固定 ADB。工单不带 `computeAdapter` 时记为 `adb`。SSH 通道已封存至 `_archive/ssh_retired_20261111/`，显式写 `computeAdapter=ssh` 或 `allowSsh=true` 一律以 `ERR_SSH_DISABLED` 拒绝。编排器自身不导入远端执行接缝，不启动任何备用通道。

## 工单字段

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `schema_version` | 是 | 固定 `work_order/v1` |
| `workOrderId` | 否 | 工单号，缺省按项目号派生 |
| `projectId` | 是 | 合法项目 ID，只允许字母数字、点、下划线、连字符 |
| `lineId` | 是 | `line1_bulk`、`line2_scrna`、`line3_spatial` 之一 |
| `modIds` | 是 | 选择的 Mod，编排器按 `tools/bio/workflows.json` 补齐必需上游闭包 |
| `figureSelections` | 否 | 只允许 `tools/dev/figure_ready_allowlist.json` 中的 Ready 单图，组图与 draft 一律拒绝 |
| `uploads` | 否 | `filename` 与 `content_base64`，按线上传到项目 raw data |
| `seed` | 否 | 缺省用该线 `tools/bio/workflows.json` 的固定 seed |
| `computeAdapter` | 否 | `adb` 默认，`mock` 仅测试，`ssh` 已封存 |
| 建项字段 | 视服务端契约 | `basicInfo`、`dataSource`、`groupingDesign`、`analysisCutoffs` 等原样透传给 `/api/projects/create` |

样例见 `tools/examples/work_order.example.json`。

## 执行判据

1. 先静态校验工单，项目 ID、分析线、Mod、图件、上传名、seed、通道开关任一不合法即拒绝。
2. 用 `tools/bio/workflows.json` 编译 DAG，分析 Mod 与图件前置 Mod 必须同线，缺的上游必需阶段自动补齐。
3. 调 `/api/projects/create`，再按 `/api/upload/init`、`chunk`、`complete` 上传，每个文件必须有 `sizeMatch=true` 回执。
4. 调 `/api/projects/execution-plan`，任务数与顺序必须等于编译 DAG，否则 `ERR_DAG_PARITY`。
5. 逐项调 `/api/tasks/submit`，串行等待 `/api/tasks` 与 `/api/ledger/check`，完成回执必须满足：项目、线、步骤、状态、退出码、seed、台账回执与产物清单吻合。
6. 上游失败即停止派发，不继续下游，不构建报告。
7. 全部成功后调 `/api/report/build`，要求四关验收哨兵，再用 `/api/report/files` 复核 `delivery_verified=true` 与两份解读报告、交付 tar 包。
8. 通过后在 `workspace/projects/<projectId>/report/` 写 `Project_Summary.md` 与 `work_order.receipt.json`。汇总与回执只含业务状态、产物名与机密脱敏后的相对路径，不含机器名、运行环境、绝对路径或内部脚本目录。

## 运行

```powershell
node tools/dev/work_order_orchestrator.mjs tools/examples/work_order.example.json --base-url http://127.0.0.1:18787
```

需要鉴权时由环境变量 `BIO_WORKBENCH_USER` 与 `BIO_WORKBENCH_PASS` 提供，凭证不写入工单和回执。CLI 成功输出 `WORK_ORDER_ORCHESTRATOR_OK`，失败输出错误码并以退出码 1 结束。

门禁入口：

```powershell
node tools/dev/work_order_orchestrator_gate.mjs
```

门禁只跑确定性合成工单与本地 mock HTTP 客户端，不连接设备，不执行分析计算。报告落 `docs/WORK_ORDER_ORCHESTRATOR_REPORT.md`，成功哨兵 `WORK_ORDER_ORCHESTRATOR_GATE_OK`。

## 与旧同步守护进程的关系

`tools/ops/sync_daemon.ps1` 保留门户收件箱轮询与结果回传能力。它没有完成回执逐项校验，任务之间只按固定等待，不能单独作为严格验收证据。新编排器以工单 JSON 为入口，把同样的服务接口收紧成可复核的 fail closed 闭环。

## v1 与 v2 双版本兼容

编排器从 `work_order/v2` 起接受正式产品工单。两个版本共用同一编译与执行链，
差异只在入口归一化层，`compileWorkOrderPlan` 本体与 DAG、任务回执、报告验收判据不变。

| 项目 | `work_order/v1` | `work_order/v2` |
| :--- | :--- | :--- |
| 字段风格 | camelCase | snake_case 外壳，`requirement` 复用需求单四段 |
| 声明面 | 无独立 schema，字段散在文档与硬校验 | `schemas/work_order_v2.schema.json` |
| 运行时校验 | 编排器内 `compileWorkOrderPlan` | `shared/work_order_v2.mjs` 先归一化，再进同一编译 |
| 版本标识 | `schema_version=work_order/v1` | `schema_version=work_order/v2`，内部回落为 v1 |
| 样例 | `tools/examples/work_order.example.json` | `tools/examples/work_order_v2.example.json` |

兼容规则：

1. `schema_version` 为 `work_order/v1` 或省略时走原有路径，行为与历史基线一致。
2. `schema_version` 为 `work_order/v2` 时，`runWorkOrder` 与 `loadWorkOrder` 先调用
   `normalizeWorkOrderInput`，校验失败直接产出 `failed` 回执，不触发任何接口调用。
3. 归一化后 `workOrderId`、`projectId`、`lineId`、`modIds`、`figureSelections`、
   `uploads`、`seed`、`computeAdapter`、`speciesScope`、
   `basicInfo`、`dataSource`、`groupingDesign`、`analysisCutoffs`、`biologicalPriors`
   与 v1 同名字段一一对应，`resume`、`resumeSince`、`forceReportBuild` 由 `controls` 映射。
4. `requirement.figure_templates[].adapt_vars` 与 `execution.figure_selections` 按
   `template_id` 合并，未声明适配参数的一侧不覆盖已声明值。
5. `compute_adapter=ssh` 或 `allow_ssh=true` 一律报 `ERR_SSH_DISABLED`，恢复方式见 `_archive/ssh_retired_20261111/RESTORE.md`。
6. `inputs[]` 与 `source_package` 只接受包内相对路径，禁止绝对路径、反斜杠、空段与 `..` 段；
   `inputs[].sha256` 必须是 64 位小写十六进制。
7. `inputs` 省略或为空数组时正常归一化。非空时每项归一化为
   `{role, path, filename, size, sha256, format}`，挂在内部形态的 `inputs` 上。
   `uploads` 保持空数组，v1 的 base64 上传路径不受影响。
8. `source_package` 归一化后挂在 `sourcePackage` 上供审计，编排器暂不消费。
9. `controls.require_admin_review` 缺省为 `true`，作业 API 层据此要求管理员先确认预览。

文件引用上传（T2）：

1. `runWorkOrder` 接受 `options.inputsRoot`，默认取仓库根；`inputs[].path` 相对它解析。
2. 上传前预检：路径必须落在 `inputsRoot` 内（词法解析与 `realpath` 双重校验，挡住
   链接逃逸）、真实存在、是文件、声明 `size` 与声明 `sha256` 都与磁盘一致。
   缺失、目录、大小不符报 `ERR_INPUT_FILE`，哈希不符报 `ERR_INPUT_HASH`。
3. 上传按服务端 `init` 返回的 `chunkSize` 分片，`createReadStream` 边读边发，
   内存峰值约一个分片，不再把整包文件 base64 进内存。
4. `upload/complete` 回执带 `sha256` 时与工单声明比对，不一致报
   `ERR_UPLOAD_HASH_MISMATCH`。
5. 门户归档 `PKG_` 包时，`package_manifest.json` 的 `data_files[]` 与
   `references[]` 登记实际字节数与 SHA-256。

v2 样例保持 `inputs: []`，补上真实文件项即可进入流式上传链。

## 统一回执 receipt/v1

编排器从 T3 起把作业终态写成两份文件：

| 文件 | 位置 | 写入时机 | 用途 |
| :--- | :--- | :--- | :--- |
| 权威回执 | `workspace/projects/<projectId>/report/receipt.v1.json` | 成功、失败、阻塞、校验失败 | 唯一权威状态与证据聚合 |
| 兼容投影 | `workspace/projects/<projectId>/report/work_order.receipt.json` | 仅成功 | 旧消费者、门禁字面量与既有哨兵 |

权威回执使用 `BioanalysDesktop/server/receipt_v1.js` 生成，原子写复用
`BioanalysDesktop/server/atomic_write.js`，先写同目录临时文件再 rename，异常时清理临时文件。

状态固定为 `queued`、`running`、`completed`、`failed`、`blocked`。状态转移只允许
`queued` 到 `running`、`failed`、`blocked`，`running` 到 `completed`、`failed`、`blocked`，
终态不可逆。成功哨兵为 `PRODUCTIZATION_RECEIPT_OK`，旧投影哨兵仍为
`WORK_ORDER_ORCHESTRATOR_OK`。

字段与判据：

1. `receipt_id` 取 `sha256(work_order_digest + started_at)` 前 24 位十六进制。
2. `work_order_digest` 是输入工单 canonical JSON（键排序）的 SHA-256，把回执绑定到输入。
3. `stages`、`upload_receipts`、`task_receipts`、`acceptance` 保留现有阶段与证据，
   任务台账中的绝对路径与错误日志路径在权威回执里只留文件名。
4. `delivery` 只引用现有验收回执的相对路径、`tar_sha256`、`verified_count`、
   `coverage_ok` 与 `verifier_version`，不复制四关判据。下载门禁仍只认
   `deliverables/acceptance/<projectId>.receipt.json` 的实时哈希。
5. `artifacts` 登记报告、交付 tar、`Project_Summary.md` 与兼容投影的相对路径、大小与
   SHA-256。权威回执自身不登记，避免自指。
6. 失败与阻塞也写权威回执，旧投影只在成功时写。校验失败在 `projectId` 合法时同样落
   权威回执，`projectId` 不可用则跳过落盘。
7. 运行期前置条件缺失按阻塞处理：`ERR_API_UNREACHABLE`、`ERR_INPUT_FILE`、
   `ERR_ADMIN_REVIEW_REQUIRED`。其余执行错误按失败处理。

权威回执正文只含业务状态、相对路径与脱敏错误说明，不含机器名、绝对路径、运行环境与
内部脚本目录。`schemas/receipt_v1.schema.json` 是声明面，运行时形态由
`receipt_v1.js` 校验。
