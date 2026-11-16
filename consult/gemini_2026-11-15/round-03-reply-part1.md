结论
D0 通信拓扑保持 child_process.spawn + 127.0.0.1 随机端口 + Basic 口令，严禁改为 Electron 主进程内嵌或纯 IPC。理由：第一，直接命中 REJ-007（便携包与源码分叉） 防线——保持 HTTP Loopback 能让便携桌面壳与无头（Headless）CLI/Web 调试端 100% 共享同一套 server/index.js 路由与测试集，改纯 IPC 会导致两套 API 分叉；第二，Node 后端涉及 SQLite native 绑定、大文件 .tar 流式解包及 ADB 子进程高频调度，一旦内嵌进 Electron 主进程，任何重度 I/O 停顿或未捕获异常都会直接卡死窗口甚至拖垮整个 GUI；第三，service.restart 在独立子进程架构下可实现秒级热重启而不闪退界面。仅需补齐 “同机 SSRF / 跨源 CSRF 防护（X-Bio-Local-Token 自定义头 + Sec-Fetch-Site: same-origin 强校验）” 与 “Windows Job Object / 死亡管道 (stdio: ['pipe', ...]) 双重防孤儿进程机制” 即可达到最小攻击面。
180 秒倒计时面板采用“服务端 grace_deadline_ms 单一真源 + 1 秒级轻量轮询（复用 /api/pi/sessions/active）”，不引入 SSE（避免长连接假死与重连状态断层）。人工在最后 1 秒点击拦截直接走 “统一拦截并接管接口（POST /api/pi/sessions/:id/intercept）”：无论此时服务端 CAS 处于 AWAITING_PLAN_APPROVAL（179s 拦截成功）还是刚在 180.001s 跃迁至 PLAN_APPROVED / RUNNING_DAG（Timer 刚胜出），服务端在同一个接口、同一个事务内自动降级/升级为“强制夺取 Lease + adb kill -PGID 净空容器”，对管理员承诺“只要点下拦截按钮，100% 停机交权”。
报告签发 UI 必须将“靶点锁定（AWAITING_TARGET_APPROVAL）”与“报告签发（REPORT_SIGNED）”收口为两阶段同屏单向步进器。当 delivery_grade === 'EXPLORATORY_DEGRADED' 时，前端强制锁死标准签发按钮，要求管理员勾选 ack_exploratory_degraded 并填写降级放行批注（不少于 10 字符），后端校验通过后方可执行整单 receipt/v1 (JCS) + 归档 .tar 的双层 Ed25519 签名。
D1 门户最小加固集唯一优先级：① 表型与 GSM 映射前置流式预检（防命令/公式注入与样本错位） → ② 文件头魔数（Magic Bytes）与压缩流炸弹拦截（破除扩展名伪造） → ③ 分块上传磁盘配额与僵尸会话清理（防磁盘打满 DoS） → ④ Token 级并发锁与滑窗限流。
D2 解包硬化（extractTarGz）必须补齐 6 项硬指标：拒绝非普通文件类型（Symlink/Hardlink/FIFO/Device 一律拦截）、单包最大条目数 ≤ 64、单文件解压上限 ≤ 5GB、整包解压总字节上限 ≤ 12GB、动态膨胀率上限（解压字节 / 已读压缩字节 ≤ 25 倍，前 10MB 豁免）、路径深度 ≤ 4 层且文件名仅限 ASCII 安全字符集。
接口契约
1. D0 Loopback 安全加固契约（防本机恶意网页 CSRF / 端口扫描）
虽然监听 127.0.0.1 随机端口并注入了 Basic Auth，但若管理员浏览器打开了恶意网页，可通过 WebRTC/Timing 探测端口并发起 Simple Request POST。必须在 server/index.js 全局中间件强制执行：
禁止 CORS：不返回任何 Access-Control-Allow-* 响应头。
强制预检与来源校验：所有非 GET/HEAD 请求必须同时满足：
Sec-Fetch-Site 为 same-origin（或 none）；
携带自定义 Header X-Bio-Client: electron-d0（促使浏览器跨域时必发 OPTIONS 预检并被直接 403 拦截）；
Electron 主进程将 spawn 时的 stdin 设为 'pipe'，后端 server/index.js 监听 process.stdin.on('end', () => process.exit(0))，确保 Electron 进程被任务管理器强杀时，Node 后端瞬间殉职，绝不残留僵尸监听端口。
2. 检查点一：180 秒倒计时与“无死角拦截” API
