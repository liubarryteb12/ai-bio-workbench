运行期事件 探针信号 / 退出码 重试预算状态 工单五态迁移 租约 (leases) 动作 防僵尸 / 防误杀机制
单步 OOM (6.5GB/7.5GB) Exit 137 或 mem_guard 捕获 MEM_LIMIT_EXCEEDED 剩余预算大于 0（adaptation_count < 2） 保持 running 保持持有（心跳继续） 先发 adb shell kill -9 -PGID 清理容器残留进程组，再允许 AI 调 remediate_step_param（如降 worker 至 1）重发 dispatch_step
单步 OOM 预算耗尽 同上 剩余预算等于 0（adaptation_count == 2） running → blocked (failure_stage=mod_id) 同事务释放 (DELETE/EXPIRE) 写入 receipt/v1 (status=blocked, error=OOM_EXHAUSTED)，禁止转为 failed 以免丢失已完成前序步骤缓存，留待人工接管
代码/数据硬错误 Exit 非 0 且非 OOM，且非白名单可调参错误 不消耗自适应预算（不可自愈） running → failed 同事务释放 (DELETE/EXPIRE) 收集 stderr 尾部写入 receipt/v1，执行容器临时目录清理
ADB 瞬时闪断 adb exec-out / forward 10022 Socket 断开 重连窗口内（3 次，间隔 5s/10s/20s） 保持 running 保持持有（本地编排器代维持心跳） 容器内任务由 nohup/setsid 托管写本地 pidfile 与 exitfile；重连成功后先探查 /proc/{pid} 与 exitfile，实现断点续接
ADB 永久失联 3 次重连（共 35s）全部失败 不适用 running → blocked (error=ADB_LOST) 同事务释放 (DELETE/EXPIRE) 标记算力节点 OFFLINE，阻断队列后续工单下发，待设备重插恢复后人工或巡检清理远端孤儿进程
大文件流式回传中 处于 ARCHIVE_PULLING 阶段（10022 端口满载） 正常传输中 保持 running 传输旁路自动续期 只要本地接收流每 10s 内 bytes_received 增量大于 64KB，编排器直接在本地 SQLite 刷新 leases.expires_at = now + 120s，不发 ADB 命令探活，彻底免疫末段带宽饥饿
守护进程崩溃 编排器自身进程挂掉（expires_at < now） 不适用 巡检器扫出超时工单：running → blocked Reaper 强制回收 独立 Watchdog 每 30s 扫描 work_orders.status='running' AND leases.expires_at < now，先尝试 ADB 杀远端进程组，再原子置为 blocked
