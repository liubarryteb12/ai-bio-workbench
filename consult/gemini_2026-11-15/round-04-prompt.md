继续。G1 已完全落地：容器包装器 run_throttled_task.sh 单任务上限从 8.0 收到 6.5，工具桥回报默认 6.5；D2 接收器与 D4.9a/b/c 已实现。本轮做 D4.9 生产接线终审。

【材料 1：桩函数现状】
server/index.js 创建 piToolsBridge 时只注入 inboxRoot、workspaceRoot、workflowsPath、figureAllowlistPath、ledgerAppend；以下四个依赖未接，工具调用默认 fail-closed：
runValidationFn（run_validation 执行器）
dispatchStepFn（dispatch_step 执行器）
assertLease（租约校验器）
autonomyGrantsProvider（项目授权读取器）

【材料 2：容器执行链】
任务入口 POST /api/tasks/submit → routes/tasks.routes.js → run.js runTask；run.js 生成命令串，经 ADB 下发，包装器 tools/ops/run_throttled_task.sh 以 BIO_EXEC_CMD 模式执行：nice/ionice 降权、内存余量检查（现单任务 6.5GB）、温度阈值、失败退出码 5；母版必须回 WROTE '<path>' <bytes>，run.js 解析并落 task_receipts 与追加台账；python 侧 core/mem_guard.py 提供容器 7.5GB 与验证态 3.5GB 两档。

【材料 3：现有 25 条变异】
infra 8 条（清理守卫、基线一致性、台账同源、跳过白名单等），behavior 17 条（静态语言扫描、出图证据漂移、路由匹配、Pi 裸写数值、参数边界、幽灵 Mod、母版克隆、未验证直发、吊销伪造等）。当前 escaped=0。

【本轮问题】
1. 四个依赖的接线顺序与代码缝：runValidationFn、dispatchStepFn、assertLease、autonomyGrantsProvider 各自应该接到哪个模块/函数？谁先接、谁后接？
2. dispatch_step 如何在不破坏队列单消费者的前提下做单步下发？工单 meta 需要新增哪些字段（step_lock、adaptation_epoch、attempt）？
3. 容器侧 6.5/7.5 与 Exit 137、包装器 exit 5、温度降频如何映射成 failed/blocked 与重试预算？哪些错误允许留在 running 重试，哪些必须立即 blocked？
4. 切换真接线后必须新增哪几条变异反证（M-Pi-10/11/12 的候选）？第 28 道门禁需要加什么判据？

输出格式固定：结论 / 接线契约 / 状态迁移 / 变异清单 / 风险 / 下一轮材料。
