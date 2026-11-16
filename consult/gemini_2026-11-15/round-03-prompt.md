继续。第二轮判决已部分执行：D2 接收器已实现（空闲 15s/活跃 3s、幂等键 ticket+sha256、.part 流式哈希、原子解包、result 重试队列，3 条测试绿）；D4.9 已加 pi_sessions.state_version CAS、适配提案上限 2、receipt 顶层 delivery_grade 与 adaptation_trace。生产执行器接线仍待完成。本轮审 D0 桌面壳与 D1 门户防护。

【材料 1：D0 桌面通信拓扑】
Electron 主进程用 child_process.spawn 启动 Node 后端（server/index.js），监听 127.0.0.1 随机端口；每次启动生成随机 Basic 口令，经 Electron login 事件注入渲染层；渲染层加载 http://127.0.0.1:<port>；preload 白名单只暴露 service.status/restart、settings、logs、shell.openPath，无 Node/文件系统直通；退出时进程树清理。

【材料 2：D0 人工检查点现状】
检查点一面板 PiCheckpointsPanel 目前只处理两类 Pi 任务审批：外源数据下载批准、验收通过；数据来自 /api/pi/jobs。检查点二靶点锁定与报告签发尚无 UI。适配提案有独立三栏弹窗 PiProposalsModal（列出 entry_point、验证状态、哈希一致性、批准/驳回，经租约头调用 proposals 端点）。180 秒倒计时面板尚未实现。

【材料 3：D1 门户 PKG 现状】
包目录 PKG_<时间戳>_<项目名>/，含 requirement.json、package_manifest.json、raw_data/、references/。数据角色 6 种：train_matrix、val_matrix、sample_sheet、group_map、platform_annotation、other；扩展名白名单 14 项；单文件上限 5GB；除 other 外每角色 1 个文件，other 最多 5 个；参考文献最多 5 个、合计 20MB；文件名消毒后落盘；提交走客户 token，内置肿瘤黑名单筛查；sync trigger 有冷却；4MB 分块上传与会话指纹。

【本轮问题】
1. D0 通信拓扑：继续 child_process + loopback HTTP，还是改成主进程内嵌或纯 IPC？单管理员绿色便携场景下哪个最稳、攻击面最小？
2. 180 秒倒计时面板：状态真源放服务端 state_version + grace_deadline，UI 用轮询还是 SSE？人工在最后 1 秒点拦截的 API 与竞态处理怎么设计？
3. 报告签发 UI：靶点卡片、delivery_grade、探索版特批、Ed25519 签名的最小状态流与 API 绑定。
4. D1 门户最小加固集：恶意 GSM 映射注入、超大文件、畸形表型列、zip-slip/symlink、内容类型伪造、提交限流，按优先级给唯一清单。
5. D2 解包硬化：现有 extractTarGz 已拒绝 .. 与绝对路径；还需要哪些上限（条目数、总字节、单文件、压缩炸弹）才算够？

输出格式固定：结论 / 接口契约 / 状态流 / 风险 / 下一轮材料。
