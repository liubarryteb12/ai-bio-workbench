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
