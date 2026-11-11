# 产品化规格

> version 0.1 | 2026-11-10
> 状态：待用户逐票确认
> 性质：把已跑通的确定性闭环收成产品契约与作业中心。本文冻结协议、边界、完成判据。
> 配套：`docs/PRODUCTIZATION_TICKETS.md` 是实现票，`docs/WORK_ORDER_ORCHESTRATOR.md` 是现有编排器契约。

## 一、裁定

| 主题 | 当前裁定 | 理由 |
| :--- | :--- | :--- |
| 产品形态 | 本地 Web 工作台加绿色便携包 | 已有 React 前端、Node 服务、运行时与 `MANIFEST.sha256` |
| 客户入口 | 保留 `portal/` 需求提交台 | 需求录入与共享校验器已经落地 |
| 管理入口 | 保留 `BioanalysDesktop/` | 上传、任务、报告与鉴权接口已在此运行 |
| 正式执行入口 | `work_order/v2` 工单 | 把需求、文件、执行、输出、控制面一次说清 |
| 执行链 | 作业 API 调 `runWorkOrder` | 保留单入口、DAG 串行、逐任务回执、fail closed |
| 统一回执 | 新增 `receipt/v1` 权威文件 | 聚合阶段证据，现有回执作为证据子对象或投影 |
| 桌面安装壳 | 放到封板后的第二阶段 | 先修协议割裂与便携包同源分叉 |

架构宪法、三线隔离、ADB 主通道、NNLS 轻算力红线、Ready 单图、四关验收、报告脱敏、零本地算力与既有门禁保持原位。

## 二、用户可见流程

1. 客户在门户填需求单，上传数据与参考文献。
2. `POST /api/submit` 落 `PKG_<时间戳>_<项目名>/` 提交包。
3. 管理员在工作台收件箱审阅提交包，选择分析线、Mod、Ready 单图与 seed。
4. 工作台生成 `work_order/v2` 预览，管理员确认后创建作业。
5. 作业 API 调 `runWorkOrder`，按现有 DAG 执行。
6. 作业页显示统一状态、阶段时间线、错误码、证据摘要与交付清单。
7. 全绿后下载报告、交付包、汇总与统一回执。

作业状态固定为 `queued`、`running`、`completed`、`failed`、`blocked`。
任务层继续使用 `BioanalysDesktop/server/task_fsm.js` 的既有状态机。

## 三、输入契约

### 3.1 需求单信封

`requirement.json` 保留客户可读字段。声明面真源是 `shared/requirement_schema.json`，
运行时校验真源是 `shared/requirement_schema.mjs`，Pydantic 网关同字段集。

第一票先完成三项对齐：

1. `basicInfo.name` 是项目人读名称，进入建项 `name`。
2. `dataSource.source`、`groupingDesign.mode`、`group.sampleIds`、`contrast.name`
   与 `analysisCutoffs.profile` 的枚举在三个校验器同值。
3. 历史档位名 `standard_sci` 与 `sensitive` 只在导入时映射，不写回新需求单。

### 3.2 `work_order/v2`

正式工单是单个 JSON 文件。真源为 `schemas/work_order_v2.schema.json`，
运行时校验由 `shared/work_order_v2.mjs` 提供，CLI 与服务端共用。

```json
{
  "schema_version": "work_order/v2",
  "work_order_id": "WO-20261110-001",
  "project_id": "PRJ_EXAMPLE_BULK",
  "source_package": {
    "package_dir": "PKG_20261110_120000_示例项目",
    "requirement_path": "PKG_20261110_120000_示例项目/requirement.json",
    "manifest_path": "PKG_20261110_120000_示例项目/package_manifest.json"
  },
  "requirement": {
    "basicInfo": {},
    "dataSource": {},
    "groupingDesign": {},
    "analysisCutoffs": {},
    "biologicalPriors": {},
    "figure_templates": []
  },
  "inputs": [
    {
      "role": "train_matrix",
      "path": "PKG_20261110_120000_示例项目/raw_data/train_matrix.tsv",
      "filename": "train_matrix.tsv",
      "size": 1024,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "format": "tsv"
    }
  ],
  "execution": {
    "line_id": "line1_bulk",
    "mod_ids": ["l1_ingest_prep", "l1_qc_matrix"],
    "figure_selections": [],
    "seed": 20261013,
    "compute_adapter": "adb",
    "allow_ssh": false,
    "species_scope": []
  },
  "delivery": {
    "profile": "client_standard",
    "report_md": "Analysis_Report.md",
    "report_html": "Analysis_Report.html",
    "delivery_tar_pattern": "Client_Delivery.tar.gz"
  },
  "controls": {
    "require_admin_review": true,
    "resume": false,
    "resume_since": null,
    "force_report_build": false
  }
}
```

字段规则：

1. `schema_version` 只接受 `work_order/v2`。
2. `work_order_id` 与 `project_id` 复用现有安全名规则。
3. `inputs[].path` 是仓库或门户收件箱内相对路径，服务器校验后只读。
4. `inputs[].sha256` 必填。上传前服务端重算，回执哈希不一致即停。
5. `execution` 字段语义对齐现有编排器，`compute_adapter=ssh` 仍要求 `allow_ssh=true`。
6. `requirement.figure_templates[].adapt_vars` 保留到建项请求。
7. `source_package` 指向门户归档后的真实路径，服务端校验后写入审计。

### 3.3 文件引用与上传

1. 正式工单用 `inputs[]` 文件引用替代 base64 主体。
2. 编排器先校验相对路径、扩展名白名单、大小上限与 SHA-256。
3. 上传沿用 `upload/init`、`chunk`、`complete`，改为流式读文件并核对回执哈希。
4. `package_manifest.json` 登记归档文件名、相对路径、大小与 SHA-256。
5. 公共库与自有上传沿用现有角色与绑定校验。

## 四、回执契约

### 4.1 统一权威回执

权威文件是 `workspace/projects/<project_id>/report/receipt.v1.json`，原子写。
顶层字段：

| 字段 | 规则 |
| :--- | :--- |
| `schema_version` | 固定 `receipt/v1` |
| `receipt_id` | 稳定 ID，`sha256(work_order_digest + started_at)` 截断 |
| `work_order_digest` | 规范化工单 JSON 的 SHA-256 |
| `work_order_id` | 与工单同值 |
| `project_id` | 与工单同值 |
| `line_id` | 与工单同值 |
| `status` | `queued`、`running`、`completed`、`failed`、`blocked` |
| `started_at`、`finished_at` | ISO 时间 |
| `failure_stage` | 失败或阻塞阶段名，成功为 null |
| `stages` | 现有阶段结果数组 |
| `upload_receipts`、`task_receipts` | 现有证据原样保留 |
| `acceptance` | 四关验收结果对象 |
| `delivery` | 交付回执相对路径、`tar_sha256`、计数与覆盖结果 |
| `artifacts` | 相对路径、角色、大小、SHA-256、来源阶段 |
| `producer` | 名称与版本 |
| `error` | 失败码与人读原因 |

成功哨兵为 `PRODUCTIZATION_RECEIPT_OK`。失败与阻塞作业也写权威回执，
旧 `work_order.receipt.json` 仍只在成功时写投影，文件名与现有门禁字面量保持不变。

### 4.2 兼容投影

旧文件继续由权威回执投影生成，字段尽量沿用现有编排器回执。
`schema_version` 继续携带对应工单版本，消费者按哨兵与文件名读取。
交付下载门禁仍只认 `deliverables/acceptance/<project_id>.receipt.json` 的实时哈希，
权威回执只引用交付验收结果，不改判据。

## 五、作业 API

| 方法与路径 | 行为 |
| :--- | :--- |
| `POST /api/work-orders` | 校验 `work_order/v2`，落工单，状态 `queued` |
| `GET /api/work-orders` | 列出作业，只返回安全字段，`project` 为可选过滤 |
| `GET /api/work-orders/queue` | 返回待执行队列，含 `position` |
| `GET /api/work-orders/:id` | 返回工单摘要、`queue_position` 与回执状态 |
| `POST /api/work-orders/:id/run` | 管理员确认并加入队列，返回 202 与队列位置 |
| `GET /api/work-orders/:id/receipt` | 返回 `receipt.v1.json` |
| `GET /api/work-orders/:id/work-order` | 返回原始工单 |

执行判据：

1. 工单与元数据落 `workspace/projects/<project_id>/work_orders/`，
   权威回执落 `workspace/projects/<project_id>/report/receipt.v1.json`。
2. `run` 写入 `approved=true` 与 `approved_at`，返回 `{ok:true,status,position}`；重复确认幂等，`running` 返回执行中，终态返回 409。
3. 队列由磁盘元数据派生，只含 `approved=true` 且 `status=queued` 的作业，按 `created_at` 升序，`position` 从 1 开始。
4. 后台泵单进程单并发，按队列顺序执行，完成后自动取下一个；`startQueue` 与 `stopQueue` 控制生命周期。
5. 服务启动时扫描 `running` 且无 inflight 的作业，标记 `failed` 并写 `recovery_reason=server_restart`，随后继续排空队列。
6. 前端执行按钮为确认并排队，展示队列位置；存在 `running` 作业时每 3 秒轮询列表、队列与详情，直到终态。
7. API 层只做作业簿记与调用编排器，不改任务执行语义。
8. 汇总与报告正文保持脱敏，接口错误不含机器名、绝对路径与内部脚本目录。

## 六、输出与交付

1. 产物清单由权威回执登记：报告、图件、交付 tar、汇总、兼容回执、统一回执。
2. 每个产物登记相对路径、角色、大小、SHA-256 与来源阶段。
3. 交付 tar 的放行只由现有四关验收与下载门禁决定。
4. `Project_Summary.md` 继续只写业务状态与脱敏相对路径。
5. 客户下载入口复用现有 `/api/report/download`。

## 七、非目标

1. 本阶段不引入 Electron 或安装包。
2. 本阶段不改三条分析线脚本、`workflows.json`、Ready 白名单与图件模板。
3. 本阶段不改四关验收判据与审计流字段。
4. AI 管理员编排按 `docs/AI_ORCHESTRATION_SPEC.md` 执行：AI 使用独立凭证取得管理员主体，
   状态变更以全局单权威租约为准入条件，并受人工强制接管约束，回执记录 actor。
   自动执行以租约与 actor 留痕为放行条件。
5. 本阶段不引入 SSH 自动回落。

## 八、验收判据

1. `work_order/v2` schema 与运行时校验器覆盖所有必填、枚举、路径与哈希规则。
2. 门户提交包能生成合法工单，示例包端到端可跑 mock 闭环。
3. 统一回执含全部顶层字段，成功、失败、阻塞三态均可读。
4. 旧消费者契约测试、编排器门禁与 skills 契约保持绿。
5. 作业 API 有 fail closed 测试：重复执行、非法工单、终态重跑均拒。
6. 便携包重建后 `dist_parity_gate` 全绿，`MANIFEST.sha256` 覆盖新增资产。
7. `run_all_gates --skip-tests` 25 道全绿。
