# AI 管理员编排实现票

> version 0.1 | 2026-11-11
> 状态：待用户逐票开工
> 规则：每票先写会红的契约测试，再实现。每票收口跑自己的验收命令，最后统一跑总门禁。
> 正本：[AI_ORCHESTRATION_SPEC.md](AI_ORCHESTRATION_SPEC.md)。

## 依赖关系

```text
S0 身份与契约
  -> S1 actor 留痕
     -> S2 单权威租约
        -> S3 AI 编排客户端
           -> S4 界面与端到端封板
```

## S0：身份与契约

### S0-T1 规格与契约测试

- 状态：红测已落盘，待实现
- 范围：`docs/AI_ORCHESTRATION_SPEC.md`、`docs/AI_ORCHESTRATION_TICKETS.md`、`BioanalysDesktop/tests/ai_orchestration_spec_contract.test.js`
- 红测：规格缺少四项裁定、租约端点、actor 字段或阶段票时测试变红。
- 判据：spec、票、导航指针与产品化规格互相可达。
- 验收：`node --test BioanalysDesktop/tests/ai_orchestration_spec_contract.test.js`
- 阻塞边：无

### S0-T2 认证主体映射

- 范围：`BioanalysDesktop/server/auth_principal.js`（新建）、`BioanalysDesktop/server/index.js`、`BioanalysDesktop/tests/auth_principal.test.js`（新建）
- 红测：人工凭证映射 `human`，AI 凭证映射 `ai_assist`，本地免鉴权映射 `local_dev`；请求体 actor 被覆盖。
- 判据：Actor 对象只有 `kind`、`id`、`role` 三个字段，非法 kind 返回 401。
- 验收：`node --test BioanalysDesktop/tests/auth_principal.test.js BioanalysDesktop/tests/auth.test.js`
- 阻塞边：S0-T1

## S1：actor 留痕

### S1-T1 工单元数据 actor 字段

- 范围：`BioanalysDesktop/server/services/work_order.service.js`、`BioanalysDesktop/server/routes/work_orders.routes.js`、`BioanalysDesktop/tests/work_orders_api_contract.test.js`
- 红测：创建工单写 `created_by`，审核入队写 `approved_by`，状态变化写 `last_updated_by`；旧 meta 文件仍可读。
- 判据：列表只透出安全字段，详情返回完整 actor。
- 验收：`node --test BioanalysDesktop/tests/work_orders_api_contract.test.js BioanalysDesktop/tests/work_orders_queue.test.js`
- 阻塞边：S0-T2

### S1-T2 receipt/v1 actor_trace

- 范围：`BioanalysDesktop/server/receipt_v1.js`、`schemas/receipt_v1.schema.json`、`tools/dev/work_order_orchestrator.mjs`、`BioanalysDesktop/tests/receipt_v1_contract.test.js`
- 红测：成功、失败、阻塞回执都含 `actors` 与 `actor_trace`；缺字段或 actor 形状非法时校验变红；旧回执继续通过。
- 判据：`actor_trace` 追加写、顺序稳定，动作名固定在 spec 第五节。
- 验收：`node --test BioanalysDesktop/tests/receipt_v1_contract.test.js BioanalysDesktop/tests/work_order_orchestrator_contract.test.js`
- 阻塞边：S1-T1

## S2：单权威租约

### S2-T1 租约服务与 API

- 范围：`BioanalysDesktop/server/services/authority.service.js`（新建）、`BioanalysDesktop/server/routes/authority.routes.js`（新建）、`BioanalysDesktop/tests/authority_service.test.js`（新建）、`BioanalysDesktop/tests/authority_api_contract.test.js`（新建）
- 红测：获取、冲突 409、过期回收、续租、释放、人工接管、AI 接管 403 各有断言。
- 判据：租约文件原子写，字段与 spec 第三节一致；过期租约可被重新获取。
- 验收：`node --test BioanalysDesktop/tests/authority_service.test.js BioanalysDesktop/tests/authority_api_contract.test.js`
- 阻塞边：S1-T2

### S2-T2 工单状态变更强制租约

- 范围：`BioanalysDesktop/server/routes/work_orders.routes.js`、`BioanalysDesktop/tests/work_orders_api_contract.test.js`、`BioanalysDesktop/tests/authority_api_contract.test.js`
- 红测：缺 `X-Bio-Lease-Id` 返回 409 `ERR_AUTHORITY_REQUIRED`；他人租约返回 409 `ERR_AUTHORITY_HELD`；持有者成功；租约过期返回 409 `ERR_AUTHORITY_EXPIRED`。
- 判据：`POST /api/work-orders`、`POST /api/work-orders/from-package`、`POST /api/work-orders/:id/run` 三个入口都走同一守卫。
- 验收：`node --test BioanalysDesktop/tests/work_orders_api_contract.test.js BioanalysDesktop/tests/authority_api_contract.test.js`
- 阻塞边：S2-T1

## S3：AI 编排客户端

### S3-T1 HTTP 客户端骨架

- 范围：`tools/dev/ai_orchestrator.mjs`（新建）、`BioanalysDesktop/tests/ai_orchestrator_contract.test.js`（新建）
- 红测：源码不含浏览器自动化、`child_process`、直接写 `workspace/`；只使用 HTTP 与凭证环境变量。
- 判据：authority acquire、heartbeat、release、work-order create、work-order run 子命令可用，退出码符合 spec 第六节。
- 验收：`node --test BioanalysDesktop/tests/ai_orchestrator_contract.test.js`
- 阻塞边：S2-T2

### S3-T2 等待、回执与停机

- 范围：`tools/dev/ai_orchestrator.mjs`、`BioanalysDesktop/tests/ai_orchestrator_contract.test.js`
- 红测：`work-order wait` 轮询到终态；`failed`、`blocked` 返回退出码 1；租约冲突返回 3；传输错误返回 4。
- 判据：停机时释放租约并输出状态、错误码与下一步动作。
- 验收：`node --test BioanalysDesktop/tests/ai_orchestrator_contract.test.js`
- 阻塞边：S3-T1

## S4：界面与端到端封板

### S4-T1 租约横幅与 actor 徽标

- 范围：`BioanalysDesktop/src/views/WorkOrderCenterView.tsx`、`BioanalysDesktop/src/App.tsx`、`BioanalysDesktop/src/app.css`、`BioanalysDesktop/tests/work_order_center_view.test.js`
- 红测：租约横幅、人工接管按钮、AI 等待提示、工单 actor 徽标、回执 actor_trace 时间线都有静态锚点。
- 判据：AI 持有租约时人工变更按钮显示为需接管；人工接管后恢复。
- 验收：`node --test BioanalysDesktop/tests/work_order_center_view.test.js`、`npm --prefix BioanalysDesktop run build`
- 阻塞边：S3-T2

### S4-T2 端到端 mock 与便携包

- 范围：`BioanalysDesktop/tests/ai_orchestration_e2e.test.js`（新建）、`tools/dev/build_portable_package.mjs`、文档收口记录
- 红测：AI 获取租约、创建工单、审核排队、mock 完成，回执 actor 为 `ai_assist`；人工接管后 AI 下一次变更返回 409。
- 判据：端到端测试、全量测试、总门禁、便携包同源全部通过。
- 验收：`node --test BioanalysDesktop/tests/ai_orchestration_e2e.test.js`、`node tools/dev/run_all_gates.mjs --skip-tests`、`node tools/dev/dist_parity_gate.mjs`、`cd BioanalysDesktop; npm test`
- 阻塞边：S4-T1

## 收口判据

1. 每票的红测先红后绿，验收命令退出 0。
2. `node tools/dev/run_all_gates.mjs --skip-tests` 输出 `GATE_ALL_OK`。
3. `cd BioanalysDesktop; npm test` 达到当前基线，`fail=0`。
4. `node tools/dev/dist_parity_gate.mjs` 分叉与缺失均为 0。
5. 收口记录写明改动文件、证据、遗留风险与未纳入本轮的扩展点。
