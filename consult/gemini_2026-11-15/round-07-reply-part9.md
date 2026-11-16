文件路径 改动类型 核心改动职责
server/prompts/pi_stages/v1/*.md & prompts_manifest.json 新增 存放 Stage 1–3 版本化系统提示词、9 工具 JSON Schema 定义、防注入信封规范与 SHA-256 清单
server/services/pi_runner.js 重构 重写 _dispatchRpcStage：注入阶段 Prompt，实现 Max-6-Turns 受控 Tool-Loop 对接 pi_tools_bridge；校验证据 Schema；剥离 Stage 4 为确定性擦除调用
server/services/pi_tools_bridge.js 修改 增加阶段级工具白名单拦截器（如 Stage 1 禁止调 dispatch_step）；暴露标准化 executeToolCall(stage, toolName, args, context) 接口
server/routes/pi.routes.js & server/services/autonomy_timer.js 修改 在检查点一审批通过（含 180s auto-pass 与人工 pass）的 CAS 事务成功后，触发 onPlanApprovedHook：签发初始 Lease 并唤醒队列消费者
server/services/task_queue.js (或 run.js 调度入口) 修改 单消费者循环在 DAG 遇到单步非致命失败且 adaptation_epoch < 2 时，挂起并回调 pi_runner.runStage2Remediation；DAG 全绿后自动推进会话至 AWAITING_TARGET_APPROVAL
tools/ops/wipe_project_sandbox.sh 新增 K40 容器侧安全擦除脚本：强制校验 ^/data/bio_workspace/runs/[A-Za-z0-9_-]{3,64}$，仅删 4 个数据子目录并写 WIPE_TOMBSTONE.json
server/routes/report_sign.routes.js 修改 在 Ed25519 签发与验签通过后，调用 completeStage3PullAndWipe，并将 wipe_receipt 写入最终交付台账
tools/bin/pi-wrapper.js & desktop/main.js 新增/修改 封装相对路径的本地 Pi CLI 启动器；Electron 侧接入环境变量/DPAPI 密钥透传与 stdin 死亡管道
