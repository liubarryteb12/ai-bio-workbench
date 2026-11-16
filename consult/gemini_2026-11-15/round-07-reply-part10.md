文件路径 改动类型 核心改动职责
server/prompts/pi_stages/v1/*.md & prompts_manifest.json 新增 存放 Stage 1–3 版本化系统提示词、9 工具 JSON Schema 定义、防注入信封规范与 SHA-256 清单
server/services/pi_runner.js 重构 重写 _dispatchRpcStage：注入阶段 Prompt，实现 Max-6-Turns 受控 Tool-Loop 对接 pi_tools_bridge；校验证据 Schema；剥离 Stage 4 为确定性擦除调用
server/services/pi_tools_bridge.js 修改 增加阶段级工具白名单拦截器（如 Stage 1 禁止调 dispatch_step）；暴露标准化 executeToolCall(stage, toolName, args, context) 接口
server/routes/pi.routes.js & server/services/autonomy_timer.js 修改 在检查点一审批通过（含 180s auto-pass 与人工 pass）的 CAS 事务成功后，触发 onPlanApprovedHook：签发初始 Lease 并唤醒队列消费者
server/services/task_queue.js (或 run.js 调度入口) 修改 单消费者循环在 DAG 遇到单步非致命失败且 adaptation_epoch < 2 时，挂起并回调 pi_runner.runStage2Remediation；DAG 全绿后自动推进会话至 AWAITING_TARGET_APPROVAL
tools/ops/wipe_project_sandbox.sh 新增 K40 容器侧安全擦除脚本：强制校验 ^/data/bio_workspace/runs/[A-Za-z0-9_-]{3,64}$，仅删 4 个数据子目录并写 WIPE_TOMBSTONE.json
server/routes/report_sign.routes.js 修改 在 Ed25519 签发与验签通过后，调用 completeStage3PullAndWipe，并将 wipe_receipt 写入最终交付台账
tools/bin/pi-wrapper.js & desktop/main.js 新增/修改 封装相对路径的本地 Pi CLI 启动器；Electron 侧接入环境变量/DPAPI 密钥透传与 stdin 死亡管道

六、验收判据、风险与回滚
​1. 验收判据（Acceptance Criteria）
​真 AI 驱动实证：在不人工点击“提交计算任务”的前提下，由 glm-5.3 在 Stage 1 调通 inspect_requirement + compile_work_order，经 180 秒自动放行后，系统自动拉起 K40 跑完 4 个模块并停在检查点二靶点审批界面。
​真自愈实证：注入 1 个单步模拟失败（或超限参数），Pi 在 Stage 2 自动调 read_step_metrics → propose_adaptation → run_validation (3.5GB) → dispatch_step (6.5GB) 恢复成功，adaptation_trace 与 EXPLORATORY_DEGRADED 自动落入回执。
​真擦除实证：点击 sign-report 后，ADB 探查 K40 容器内 /data/bio_workspace/runs/{project_id}/ 下 raw_data/processed/figures/results 4 个目录字节数归零，且存在合法的 WIPE_TOMBSTONE.json。
​防线零退化：全量测试保持 0 fail，29 道门禁全绿，新增变异反证 M-Pi-13（越权阶段工具调用拦截） 与 M-Pi-14（未验签提前擦除拦截） 全部 KILLED (escaped = 0)。
​2. 风险与回滚预案
​风险 1：glm-5.3 输出的 JSON 偶发格式损坏（如包裹了多余的 Markdown 代码块或字段拼写错误）
​防护与回滚：宿主解析器先做容错剥离（提取首个 { 到最后一个 }），若仍未通过 Schema 校验，自动将该错误反馈给 Pi 重试 1 次（消耗 1 Turn）；若连续 2 次格式错误，立即触发 Feature Flag 降级（BIO_PI_MODE=DETERMINISTIC_FALLBACK），退回使用规则模板编译工单或转 blocked 交人工处理，绝不卡死队列。
​风险 2：远端擦除脚本因权限或文件占用部分删除失败
​防护与回滚：擦除脚本先执行 fuser -k 清理残留句柄；若 rm -rf 报错，保留现场并写入 pending_remote_wipes 异步重试队列，不影响前端向客户交付已签名的本地结果包。
​七、需要用户拍板的 4 个决策问题
​在正式锁定目标并动手改代码前，请用户对以下 4 项边界做最终裁定：
​工具暴露模式拍板：是否同意采用 方案 C（宿主受控 JSON Tool-Loop，最大 6 步循环，Pi 零原生工具、零扩展依赖），放弃重度的 MCP Server 与紧耦合的 Pi Extension？
​Stage 2 自愈触发边界：当生产单步报错且还有适配预算（adaptation_epoch < 2）时，是由 Pi 自动在后台走完 propose_adaptation → run_validation → dispatch_step（全自动自愈，事后通过 EXPLORATORY_DEGRADED 在检查点二由人工终审），还是每次生成适配提案后必须先停下来弹窗（PiProposalsModal）等人工点批准才能跑 dispatch_step？(架构师建议：3.5GB 验证通过后允许自动跑 dispatch_step，只在超过 2 次预算或最终检查点二签发时卡人工，否则夜间无人值守会被弹窗卡停)。
​交付后远端擦除范围：报告签发后擦除 K40 容器内该项目目录时，是否同意 “彻底清空 raw_data / processed / figures / results，仅保留 1KB 的 WIPE_TOMBSTONE.json 审计墓碑”？如果客户在签发后 24 小时内提出“微调某张图的配色重出报告”，是否接受必须从桌面端重新推送包，还是希望在手机端保留 24 小时延迟擦除窗口（TTL 24h）？
​云端模型断网/欠费降级策略：当 SenseNova (glm-5.3) 端点超时或不可用时，系统是 严格 fail-closed（直接阻断新工单立项并告警），还是允许 降级为“确定性规则模板立项 + 人工在 D0 面板点选审批”？
