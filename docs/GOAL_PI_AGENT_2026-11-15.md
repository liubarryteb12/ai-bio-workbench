# Pi Agent 生产化目标（2026-11-15）

> 本目标由 Gemini Argon 第七、八轮方案收敛，用户授权 Codex 与 Gemini 商定四项决策后自动推进。

## 一、目标

把 Pi Agent 从只会对话的壳升级为 Codex 可调用的生产级分析代理：

1. **G1 真工具闭环**：Pi 在禁用 read/bash/edit/write 的前提下，通过宿主受控 JSON Tool-Loop 调用九个生信工具，跑通读需求、编工单、跑 DAG 与单步自愈、验靶点出报告。
2. **G2 单会话合龙**：PKG 入箱 → Stage 1 立项 → 180 秒放行自动入队 → Stage 2 计算与自愈 → Stage 3 靶点锁定与签发 → Stage 4 远端清零，一条会话端到端。
3. **G3 算力面零残留**：报告签发且交付包验签通过后，自动擦除手机项目沙箱，只留 `WIPE_TOMBSTONE.json`。
4. **G4 便携包自包含**：Pi CLI、阶段 Prompt、模型配置随便携包分发，密钥走外部注入。

## 二、非目标

- 不向 Pi 开放任意 shell、任意文件读写、网络。
- 不让 Pi 绕过单权威租约或队列单消费者直接调 `run.js`。
- 不引入长生命周期、跨项目记忆污染的常驻 LLM 会话。

## 三、已锁定的四项决策

1. **工具暴露**：方案 C，宿主受控 JSON Tool-Loop，最多 6 轮，Pi 零原生工具、零 MCP、零扩展。
2. **Stage 2 自愈**：3.5GB `run_validation` 通过后允许自动 `dispatch_step`（6.5GB）；只在 `adaptation_epoch` 达到 2 或检查点二签发时卡人工。自动适配必须把 `delivery_grade` 锁为 `EXPLORATORY_DEGRADED` 并写 `adaptation_trace`。
3. **擦除**：签发并验签通过后立即擦除，0 TTL，只留墓碑；改图重出必须从桌面端重新推包；失败入 `pending_remote_wipes` 重试。
4. **模型降级**：默认严格 fail-closed；`DETERMINISTIC_FALLBACK` 只作为管理员显式开关。

## 四、实施阶段

### P0 控制面

- P0.1 阶段 Prompt 与清单：`server/prompts/pi_stages/v1/*.md` + `prompts_manifest.json`，SHA-256 校验。
- P0.2 受控 Tool-Loop：`pi_runner._dispatchRpcStage` 注入 System Prompt，最多 6 轮，宿主执行工具并回灌结果；`pi_tools_bridge.executeToolCall` 做阶段白名单。
- P0.3 检查点一自动入队：审批 CAS 成功后签发初始 Lease 并 `enqueueWorkOrder`，不裸调 `runTask`。
- P0.4 Stage 2 自愈：单步失败且 `adaptation_epoch < 2` 时挂起 DAG，Pi 读指标、提适配、3.5GB 验证、6.5GB 下发，成功后继续剩余节点。

### P1 物理算力面

- P1.1 `tools/ops/wipe_project_sandbox.sh`：安全擦除项目沙箱，写墓碑。
- P1.2 签发后置钩子：验签通过后调用擦除，失败入 `pending_remote_wipes`。
- P1.3 新增变异 `M-Pi-13`（Stage 1 越权工具拦截）与 `M-Pi-14`（未验签提前擦除拦截），并入 G28。
- P1.4 真机端到端：真 Pi + 真自愈 + 真擦除一单。

### P2 产品化

- P2.1 便携包内置 `@earendil-works/pi-coding-agent@1.5.2`，锁定版本，`runtime/node_modules`，内置 Node 拉起。
- P2.2 密钥走环境或 DPAPI，日志脱敏。
- P2.3 合入 `TICKET-D0-01` stdin 死亡管道与 `TICKET-OPS-01` K40 哈希自检。

## 五、验收判据

1. 不人工点“提交计算任务”，Pi 在 Stage 1 调通 `inspect_requirement` 与 `compile_work_order`，180 秒后自动拉起 K40 跑完 4 个模块，停在检查点二。
2. 注入单步失败，Pi 自动完成读指标、提适配、3.5GB 验证、6.5GB 下发，`adaptation_trace` 与 `EXPLORATORY_DEGRADED` 入回执。
3. 签发后四个数据目录归零，存在合法 `WIPE_TOMBSTONE.json`。
4. 全量测试 0 fail，29 道门禁全绿，30 条变异 escaped=0。

## 六、风险

1. 模型 JSON 损坏：剥代码块、取首尾大括号，重试 1 次，连续 2 次降级或 blocked。
2. 擦除部分失败：`fuser -k` 清句柄，失败入重试队列，不影响本地交付。
3. 冷备恢复后的 R 环境可能再次断链，由 `TICKET-OPS-01` 自检兜底。

## 七、当前完成状态（2026-11-15）

- [x] P0.1 阶段 Prompt 与 SHA-256 清单。
- [x] P0.2 宿主受控 JSON Tool-Loop，最多 6 轮，阶段白名单。
- [x] P0.2a Stage 1 生产入口：`runStage1Intake` + `POST /api/pi/jobs/start-intake`，真 `glm-5.3` 按序调用 `inspect_requirement` → `compile_work_order`，输出 `plan_text` 与 5 节点 DAG。
- [x] P0.3 检查点一 `onPlanApproved` 钩子，人工与自动放行都触发。
- [x] P0.4 Stage 2 自愈入口 `runStage2Remediation`，队列失败回调已接。
- [x] P1.1 `wipe_project_sandbox.sh`，真机验证只留墓碑。
- [x] P1.2 签发后擦除服务与 `pending_remote_wipes` 重试队列。
- [x] P1.3 `M-Pi-13` 与 `M-Pi-14`，30 条变异 escaped=0。
- [x] P2.1 便携包内置 Pi CLI：`desktop/runtime/picli` 整目录进 `resources/runtime/picli`，版本锁在 `runtime/picli/package.json`；后端默认经 `pi-wrapper.js` 解析包内 CLI 并注入 `PI_CODING_AGENT_DIR`，不依赖全局 `pi`。产物 `BioanalysWorkbench-0.1.0-win.zip` 重建通过，`verify` 与 11 项功能矩阵全绿。
- [x] P2.2 `BIO_PI_API_KEY` 环境注入；Electron safeStorage 待接入。
- [x] P2.3 `TICKET-D0-01` stdin 死亡管道；`TICKET-OPS-01` K40 哈希与 limma 自检。
- [x] P1.4a 检查点一自动入队真机闭环：`WO_PI_E2E_2` 无人工提交，60 秒跑完 4 模块。
- [x] P1.4b 真实 Stage 2 自愈：真 Pi 读指标 → `propose_adaptation` → `run_validation` 3.5GB `VERIFIED_OK` → `dispatch_step` 6.5GB `completed`，输出 `resolution=RECOVERED` 与 `adaptation_trace`，交付等级 `EXPLORATORY_DEGRADED`。
- [x] P1.4c 签发后擦除真机闭环：`node tools/dev/pi_sign_wipe_drill.mjs` 真实签发（一次性 Ed25519 密钥对）→ 交付包验签 `true` → 设备侧擦除 `ok=true`（242 字节墓碑）→ 目录只剩 `WIPE_TOMBSTONE.json`，`project_id` 与 `VERIFIED_AT_*` token 均正确。
