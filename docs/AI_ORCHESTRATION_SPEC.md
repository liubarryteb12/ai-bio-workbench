# AI 管理员编排与人工接管规格

> version 0.1 | 2026-11-11
> 状态：用户已裁定四项方向，待逐票开工
> 定位：在现有工作台上增加 AI 通过后端 API 以管理员身份推进流程的能力，同时保留人工在可视化界面精细编排。
> 运行契约见 [AFK_SPEC_TODO_GOAL.md](AFK_SPEC_TODO_GOAL.md)，产品化流程见 [PRODUCTIZATION_SPEC.md](PRODUCTIZATION_SPEC.md)，工单执行见 [WORK_ORDER_ORCHESTRATOR.md](WORK_ORDER_ORCHESTRATOR.md)。

## 一、用户裁定

| 主题 | 裁定 | 落地形态 |
| :--- | :--- | :--- |
| 操作载体 | 直接调后端 API | AI 通过现有 HTTP 路由与状态机操作，浏览器服务人工界面 |
| 权限 | AI 具备管理员权限 | AI 可创建、审核、排队、读取回执与报告 |
| 并发 | 全局单权威租约 | 同一时刻只有一个操作者可以变更状态，人工可强制接管 |
| 留痕 | 回执与元数据记录操作主体 | 工单 meta 与 receipt/v1 都带 actor 标记 |

四项裁定共同构成一个受控例外：AI 以管理员身份操作，但每次状态变更都受租约约束并留下可追溯记录。

## 二、角色与身份

| 角色 | 主体 | 凭证来源 | 权限 |
| :--- | :--- | :--- | :--- |
| `human` | 人工管理员 | `BAD_AUTH_USER` / `BAD_AUTH_PASS` | 管理员，可强制接管 |
| `ai_assist` | AI 编排客户端 | `BIO_AI_AUTH_USER` / `BIO_AI_AUTH_PASS` | 管理员，受租约约束 |
| `local_dev` | 本地信任环境 | `BIO_ALLOW_DEV_NOAUTH=1` | 管理员，仅本地 |

Actor 对象固定为 `{kind, id, role}`，例如 `{"kind":"ai_assist","id":"ai-orchestrator","role":"admin"}`。

身份真源是服务端认证主体。请求体里的 actor 字段只作人读展示，服务端按认证结果覆盖，客户端无法通过改 JSON 冒充人工或 AI。人工与 AI 使用独立凭证，回执里的 actor 才具备可追责性。

## 三、全局单权威租约

租约路径固定为 `.ops_state/orchestration_authority.json`，原子写。字段：

```json
{
  "lease_id": "AUTH-20261111-0001",
  "holder": {"kind": "ai_assist", "id": "ai-orchestrator", "role": "admin"},
  "acquired_at": "2026-11-11T00:00:00.000Z",
  "heartbeat_at": "2026-11-11T00:00:00.000Z",
  "expires_at": "2026-11-11T00:02:00.000Z",
  "mode": "exclusive"
}
```

规则：

1. 租约以工作台为作用域，全局唯一。
2. 默认 TTL 120 秒，持有者每 30 秒发一次心跳。
3. 空闲或过期租约可以被 `human` 或 `ai_assist` 获取。
4. 租约被其他主体持有时，获取请求返回 409 `ERR_AUTHORITY_HELD`。
5. 心跳与释放只接受当前租约持有者，其他主体返回 409 `ERR_AUTHORITY_REQUIRED`。
6. 人工强制接管始终允许，写入 `takeover_from`、`takeover_at` 与 `reason`，AI 调接管端点返回 403 `ERR_AUTHORITY_TAKEOVER_DENIED`。
7. 状态变更端点要求请求头 `X-Bio-Lease-Id` 与当前租约一致；缺失返回 409 `ERR_AUTHORITY_REQUIRED`。
8. 读接口对两类主体开放，租约只约束状态变更。

首期强制范围是工单状态变更：`POST /api/work-orders`、`POST /api/work-orders/from-package`、`POST /api/work-orders/:id/run`。任务提交、任务中止、报告构建在后续票扩展到同一租约，扩展前保持现状。

## 四、API 契约

| 方法与路径 | 行为 | 成功 | 失败 |
| :--- | :--- | :--- | :--- |
| `GET /api/orchestration/authority` | 读取当前租约 | 200 `{authority}` | 500 |
| `POST /api/orchestration/authority/acquire` | 获取租约 | 201 `{authority, lease_id}` | 409 `ERR_AUTHORITY_HELD` |
| `POST /api/orchestration/authority/heartbeat` | 续租 | 200 `{authority}` | 409 `ERR_AUTHORITY_REQUIRED` |
| `POST /api/orchestration/authority/release` | 释放租约 | 204 | 409 `ERR_AUTHORITY_REQUIRED` |
| `POST /api/orchestration/authority/takeover` | 人工强制接管 | 200 `{authority, takeover_from}` | 403 `ERR_AUTHORITY_TAKEOVER_DENIED` |

工单状态变更端点统一读取 `X-Bio-Lease-Id`。租约过期后持有者的下一次状态变更返回 409 `ERR_AUTHORITY_EXPIRED`，客户端重新获取租约后再继续。

## 五、回执与审计

工单元数据增加三个字段：

```json
{
  "created_by": {"kind": "ai_assist", "id": "ai-orchestrator", "role": "admin"},
  "approved_by": {"kind": "ai_assist", "id": "ai-orchestrator", "role": "admin"},
  "last_updated_by": {"kind": "ai_assist", "id": "ai-orchestrator", "role": "admin"}
}
```

`receipt/v1` 增加两个可选字段，旧回执继续有效：

```json
{
  "actors": {
    "created_by": {"kind": "ai_assist", "id": "ai-orchestrator", "role": "admin"},
    "approved_by": {"kind": "ai_assist", "id": "ai-orchestrator", "role": "admin"},
    "last_updated_by": {"kind": "human", "id": "admin", "role": "admin"}
  },
  "actor_trace": [
    {
      "action": "work_order.created",
      "actor": {"kind": "ai_assist", "id": "ai-orchestrator", "role": "admin"},
      "at": "2026-11-11T00:00:00.000Z",
      "lease_id": "AUTH-20261111-0001",
      "request_id": "REQ-20261111-0001"
    }
  ]
}
```

`actor_trace` 追加写，顺序固定，每条记录 action、actor、时间、lease_id 与 request_id。首期动作名固定为 `work_order.created`、`work_order.approved`、`work_order.status_changed`、`work_order.failed`、`work_order.blocked`。`actors` 取 trace 中对应动作的最后一条，供列表与详情快速展示。

回执正文继续遵守脱敏口径，actor id 使用登录名而非 secret，产物路径保持相对路径。

## 六、AI 编排客户端

新增 `tools/dev/ai_orchestrator.mjs`，只通过 HTTP 调用工作台：

```text
node tools/dev/ai_orchestrator.mjs authority acquire
node tools/dev/ai_orchestrator.mjs authority heartbeat
node tools/dev/ai_orchestrator.mjs authority release
node tools/dev/ai_orchestrator.mjs work-order create --file <work_order.json>
node tools/dev/ai_orchestrator.mjs work-order run --id <work_order_id>
node tools/dev/ai_orchestrator.mjs work-order wait --id <work_order_id>
node tools/dev/ai_orchestrator.mjs receipt --id <work_order_id>
```

环境变量：

| 变量 | 用途 |
| :--- | :--- |
| `BIO_WORKBENCH_BASE` | 默认 `http://127.0.0.1:18787` |
| `BIO_AI_AUTH_USER` / `BIO_AI_AUTH_PASS` | AI 管理员凭证 |
| `BIO_AUTHORITY_TTL_SECONDS` | 租约 TTL，默认 120 |

退出码固定为 0 成功、1 作业失败或阻塞、2 参数错误、3 租约冲突、4 传输错误。客户端只发 HTTP 请求，浏览器、工作区文件写入与远端执行接缝由现有服务端承担。

## 七、界面契约

1. 顶栏显示当前租约持有者、到期时间与操作按钮。
2. 租约由 `ai_assist` 持有时，人工可点击「人工接管」，接管成功后按钮恢复可操作。
3. 租约由 `human` 持有时，AI 获取请求返回 409，界面显示「AI 正在等待接管」。
4. 工单列表与详情显示 `created_by`、`approved_by` 徽标。
5. 回执详情显示 `actor_trace` 时间线，人工与 AI 使用不同标签。

## 八、非目标

1. 浏览器 DOM 自动化与 Playwright 点击驱动。
2. 新增分析线、算法、图件模板或 Ready 白名单。
3. 绕过四关验收、审计流字段或报告脱敏判据。
4. SSH 自动回落。
5. 多实例并发调度。
6. AI 自动修改 `SPEC.md`、`SCOPE.md`、`AGENTS.md` 等治理文件。

## 九、验收判据

1. 认证主体映射正确，请求体伪造 actor 被服务端覆盖。
2. 租约获取、冲突、过期、续租、释放、人工接管各有契约测试。
3. 工单创建与审核写入 `created_by`、`approved_by`、`last_updated_by`。
4. `receipt/v1` 含 `actors` 与 `actor_trace`，旧回执仍通过校验。
5. AI 客户端只发 HTTP，源码不含浏览器自动化、`child_process` 或直接写 `workspace/`。
6. 端到端 mock 闭环：AI 获取租约、创建工单、审核排队、mock 完成，回执 actor 为 `ai_assist`；人工接管后 AI 下一次变更返回 409。
7. `node tools/dev/run_all_gates.mjs --skip-tests`、`cd BioanalysDesktop; npm test`、`node tools/dev/dist_parity_gate.mjs` 全绿。

## 十、停机条件

1. 租约被其他主体持有或已过期。
2. 人工强制接管发生，AI 的写请求返回 409。
3. 工单进入 `failed` 或 `blocked`。
4. 设备离线、输入哈希不符、上游任务失败、回执缺失或四关验收失败。
5. 需求出现需要用户在成本、范围、视觉或合规上做取舍的判断。

停机时 AI 释放租约并输出当前状态、错误码与下一步人工动作。
