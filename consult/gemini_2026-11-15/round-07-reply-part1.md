继续。这一轮不改代码，只做方案设计。用户要求先和您对齐，再拿给他审核，最后才写目标。

【角色与用户意图】
Codex 是终端操作者与总控，负责下指令、跑命令、验收。Pi agent 是被 Codex 调用的专业分析代理，负责读需求、编 DAG、看指标、提适配、核报告。宿主服务端负责九工具桥、检查点、状态机与 ADB 下发。手机只跑计算。用户认为当前 Pi agent 的安排有一个未说完的缺陷，请您先直接指出它。

【现状】
1. Pi CLI 已装：@earendil-works/pi-coding-agent 1.5.2，走 SenseNova 的 OpenAI 兼容端点，默认模型 glm-5.3。`pi --print` 与 `pi --mode rpc --no-session` 都已实测可用。
2. `runPiRpc` 已修：原来发完 prompt 立刻关 stdin，模型没答完就退出，finalText 为空；现在等 agent_settled 再关，并从 message_end 的 content 片段取正文。
3. 但 Pi 目前只能对话，不能干活：
   - 九工具桥 `pi_tools_bridge.js` 存在，但未以 Pi extension 或 MCP 形式暴露给 Pi；Pi 自带的 read/bash/edit/write 已用 `--no-builtin-tools` 关闭。
   - `pi_runner._dispatchRpcStage` 发的是原始 JSON（job_id/stage/context），没有阶段指令，也没有输出 schema。
   - Pi 会话与工单计算是两条链：检查点一放行后不会自动触发工单 run；这次真机冒烟是管理员确认工单跑的，Pi 只单独跑了状态机。
   - `pi_runner.completeStage3PullAndWipe` 有远端清零设计，但未接生产路由；工单路径交付后手机仍留 raw_data、processed、figures、results。
4. 已跑通：run_validation 3.5GB、dispatch_step 6.5GB、step_lock、退出码矩阵、检查点一 180 秒自动放行、检查点二人工签发、交付 Ed25519 验签。
5. 未跑通：真实 Pi 驱动九工具跑一单；四阶段提示词；单会话合龙；交付后擦除；便携包内置 Pi CLI 与模型配置。

【请裁定的设计问题】
1. Codex 与 Pi 的调用方式：每次任务 spawn 一次 `pi --mode rpc --no-session`，还是常驻 RPC？谁持有 session 与状态？
2. 九工具如何暴露给 Pi：Pi extension、MCP server、还是宿主解析 Pi 的结构化输出后代执行？三种方案的边界、成本与安全差异。
3. 四阶段提示词放哪、怎么版本化、如何防注入；每个阶段的输入与输出 schema。
4. 检查点一放行后如何自动触发工单 run，同时不破坏单权威租约与队列单消费者。
5. 交付后远端擦除放在哪个阶段、用什么令牌、如何保证只删项目沙箱、失败如何回滚。
6. 便携包如何内置 Pi CLI 与模型配置：node_modules 体积、许可证、离线可用性、密钥管理。
7. 用户说的“Pi agent 安排缺陷”最可能是什么？请直接指出，不要客气。

【输出要求】
请给一份可直接给用户审核的细化方案，按：目标与非目标、角色边界、端到端时序、接口契约、分阶段落地 P0/P1/P2、文件级改动、验收判据、风险与回滚、需要用户拍板的 3 到 5 个问题。
直指核心：当前 Pi Agent 安排的根本缺陷（问题 7 裁定）
​在进入全套方案前，先毫不客气地指出用户所说但未点破的三大结构性假象（致命缺陷）：
​缺陷一：“提线木偶假象”——Pi 既无眼睛也无手脚，沦为昂贵的 JSON 复读机：
当前用 --no-builtin-tools 废掉了 Pi 的原生工具，是完全正确的安全防御；但 pi_tools_bridge.js 的 9 个受控工具根本没有注册进 Pi 的工具调用上下文（Tool-Calling Loop）。更糟的是，_dispatchRpcStage 只往里扔一坨裸 {job_id, stage, context}，既无 System Prompt 角色契约，也无工具定义。结果就是：Pi 根本不知道自己有 9 个工具可用，无法在单阶段内执行“调 read_step_metrics 看指标 → 发现异常 → 调 propose_adaptation → 调 run_validation”的多步闭环推理，只能干巴巴吐回一段散文，完全背离了“AI 作为主力分析驱动者”的立项初衷。
​缺陷二：“双轨脑裂”——Pi 状态机是悬浮在生产计算链之上的“沙盘伴游”：
检查点一（180s 自动放行）走完后，Pi 会话停在 PLAN_APPROVED，而真正的生产工单却要靠管理员去另一个入口手动点确认才能触发 run.js。这意味着 Pi 会话（pi_sessions）和工单执行（work_orders）在控制流上是两条平行线——Pi 审批了个寂寞，算力端跑了个寂寞，出了 OOM 或 Exit 5 也不会自动把控制权交回给 Pi 做自愈。
​缺陷三：“触发器错位”——误把 Codex（外部施工/验收总控）当成了运行时守护进程：
在生产交付态下（比如半夜 2 点客户从门户提单，D2 拉包，180s 自动放行），Codex 根本不在场！如果把 Pi 设计成“必须由 Codex 在终端手动敲命令才能唤醒”，那么 180 秒无人值守自动放行就成了彻头彻尾的伪命题。生产态下唤醒 Pi 的唯一合法宿主只能是 Node 服务端编排器（pi_runner），而 Codex 是开发/运维态的“总工程师与巡检员”。
​AI 生信交付工作台：Pi Agent 主力化与单会话合龙架构方案（供审核版）
​一、目标与非目标
​1. 目标（Goals）
​G1 真工具闭环：让 Pi Agent 在不开启任何原生危险工具（read/bash/edit/write 保持禁用）的前提下，通过宿主受控协议精确调用 9 个生信受控工具，跑通“读需求 → 编工单 → 跑 DAG/单步自愈 → 验靶点出报告”全流程。
​G2 单会话合龙：消灭“Pi 审 Pi 的、工单跑工单的”双轨制，实现 PKG 入箱 → Stage 1 立项 → 180s 放行自动入队 → Stage 2 计算与自愈 → Stage 3 靶点锁定与签发 → Stage 4 远端清零 的单会话端到端驱动。
​G3 算力面零残留（Wipe-on-Sign）：在报告完成 Ed25519 签发且交付包落盘验签后，自动触发 K40 容器内该项目沙箱的物理擦除并写入 receipt/v1。
​G4 绿色便携自包含：将 @earendil-works/pi-coding-agent@1.5.2 与四阶段受控 Prompt 随便携包同源分发（遵守 REJ-004 / REJ-007），API Key 与模型端点通过外部环境/系统凭据注入，零源码硬编码。
​2. 非目标（Non-Goals）
​NG1：绝不向 Pi 开放宿主机或手机容器的任意 Shell（bash）或任意文件读写权限。
​NG2：绝不让 Pi 绕过 SQLite 单权威租约（X-Bio-Lease-Id）或队列单消费者锁直接调 run.js。
​NG3：绝不引入长生命周期、带跨项目记忆污染的常驻有状态 LLM 会话。
​二、角色边界与调用模型（问题 1 & 问题 2 裁定）
​1. 四方角色铁律
