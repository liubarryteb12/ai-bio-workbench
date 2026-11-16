风险
propose_adaptation 触犯 REJ-007（便携包与源码分叉）与 REJ-012（突破 Ready 实证棘轮）的风险：
如果 AI 用 propose_adaptation 生成的补丁脚本非常有效，但只留在单项目的 runs/{project_id}/adaptations/ 里，久而久之线上靠 AI 临时打补丁混过关，而底层 54 个模块母版得不到反哺；反之如果直接自动写回母版，又直接违反 REJ-002/007/012。裁定：propose_adaptation 产出的代码生命周期严格限制在单次 work_order_id 内，随交付包归档备查，严禁自动合入 references_db 或模块母版。
D2 接收器 .sync_cache 磁盘打满与半包污染：
若 GET /api/sync/package?ticket= 下载中途断流，残留的半截 .tar 会占满桌面端磁盘。裁定：下载必须先写 .sync_cache/{ticket}.tar.part，流式计算 SHA-256 与 claim 返回的 sha256 严格比对一致后，再 rename 为 .tar 并入库 sync_inbox_ledger；不一致立刻 unlink 并重试下载。
单消费者队列与人工强制接管（Human Preemption）的容器侧踩踏：
当人工在 UI 点击“强制接管”抢走 Lease 时，SQLite 层面毫秒级切换完成，但如果容器内 AI 刚才下发的 R/Python 进程还在跑，人工紧接着下发新指令就会在容器内形成双进程争抢 7.5GB 内存。裁定：人工强制接管 API 在更新 SQLite leases.holder='human' 后，必须同步触发一次 adb shell kill -TERM -{pgid}（2 秒后 -KILL），确保容器算力面净空后再把控制权交给人工。
下一轮材料
D4.9 与 D2 的核心接口、状态机与防线已全部锁定。下一轮进入 D0（便携 Electron 桌面壳收尾）与 D1（门户加固） 的架构审查，请提供：
D0 桌面控制台架构现状：
Electron 主进程（Main）、渲染进程（Renderer）与本地 Python/Node 编排器后端的通信拓扑（是内置子进程托管、本地 HTTP Loopback，还是纯 IPC？）。
2 个关键人工交互面（检查点一 180 秒倒计时拦截面板、检查点二报告人工签发与 EXPLORATORY_DEGRADED 探索版签章确认界面）的现有状态流与 API 绑定情况。
D1 门户（Portal）与 PKG 打包规范：
门户生成 PKG 提交包的目录结构、Schema 校验规则，以及门户侧如何防止恶意大文件上传或畸形 GSM 映射注入。
