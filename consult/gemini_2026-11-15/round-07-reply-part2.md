2. 问题 1 裁定：每次阶段唤醒采用 spawn('pi', ['--mode', 'rpc', '--no-session', '--no-builtin-tools'])，严禁常驻进程
​结论：按阶段（Stage）或按自愈回合（Turn）短生命周期 Spawn，用完即焚；状态 100% 由宿主 SQLite (pi_sessions + work_orders) 持有。
​理由：
​防上下文污染与幻觉累积：生信工单动辄跨数十分钟，常驻 RPC 会导致前序报错堆栈撑爆 glm-5.3 上下文窗口并拖慢首字延迟。
​崩溃隔离与可重放性：--no-session 保证每次调用都是纯函数（Input Context JSON + Versioned Prompt → Structured Output JSON），宿主随时可在进程崩溃或 180s 恢复后幂等重放。
​3. 问题 2 裁定：九工具暴露方式对比与唯一选型

​方案 C 执行细则：单次 Stage 内部允许最多 6 步（Max Turns = 6） 的 Pi 输出 Tool Call JSON → 宿主调 piToolsBridge → 将结果追加进 messages 重新唤醒 Pi 循环；超出 6 步未收敛出 finish_stage，宿主直接熔断转 blocked (PI_TURN_EXHAUSTED)。
​三、端到端合龙时序（问题 4 & 问题 5 裁定）
