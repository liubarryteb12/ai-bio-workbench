# S27 执行台账：客户交付报告工作台入口（A 批 A4 / R3）

## 状态：完成（实现 + 测试 + 算力节点 E2E 全过，待主 Agent 验收）

## 实现落地
- server/report.js（新建）：LOCAL_DELIVER_ROOT / localDeliverDir / buildReportCommand /
  runReportBuild / pullDeliverables / checkRemoteProjectDir / isAllowedDeliverableName /
  localDeliverFilePath。ssh 走 childProcess 默认导入 spawn argv 数组（run.js 范式；
  buildRemoteCommand 的整串形式在 Windows cmd 下会被远端命令里的 && 拆断，
  派发单契约此处按 run.js 实际范式落地，已在回报中标注）；scp 走 pull.js argv 范式。
- server/index.js：+3 路由（/api/report/build、/api/report/files、/api/report/download）+
  report.js import，其余零改动。
- src/App.tsx：ResultPreviewStudio 内新增 DeliveryReportCard（按钮/生成中/清单/下载/error 原样透出）。
- tests/report.test.js（新建）：16 条全绿（纯函数 4 + 垫片行为 4 + 端点契约 8）。
  踩坑：假 ssh 垫片 exit 事件必须 setImmediate 发，否则 data 未投递 exit 先到（已修）。
- cn_debug/2026-10-20_verification_s27_report_e2e.mjs（新建）：幂等 E2E 脚本。

## 验证记录（实测）
- node --test tests/report.test.js：16/16 PASS。
- npm test：tests 281 / pass 281 / fail 0（含 22 个既有测试文件与 S26 域的
  index.test.js、run.test.js）。
- npm run build：✓ built in 689ms（32 modules）。
- 算力节点 E2E（PRJ_E2E_GSE277173，真 ssh 跑远端引擎）：10/10 PASS——
  build 200 + 三大件（md 34296B / html 48230B / tar.gz 8758657B）；
  三件本地↔远端 md5 逐件一致；download html 200 + 48230B + <!doctype html 头；
  Analysis_Report.md 无 /mnt/ssd 泄漏（{{DATA_ROOT}} 占位正常）。
- 踩坑记录：
  1. 引擎真实产物布局是 deliverables/<pid>_Client_Delivery/03_Interpretation_Report/
     下的 md/html + 根下 tar.gz（非平铺），pullDeliverables 已按递归 find + basename
     匹配落地（首版假设平铺被 E2E 当场打回）。
  2. 本地交付缓存根实际解析为仓库根 deliverables/（与 pull.js 的 outputs/ 同位）。
- 算力节点 链路实测通（LINK_OK，6 项目在，PRJ_E2E_GSE277173 在）。

## 已完成
- 2026-10-20 已通读：SUBAGENT_CONTRACT.md、architecture_review §3.1/§5 A4、
  ops/build_client_report.py docstring（红线：不编造数字/不重写母版/脱敏路径，退出码 0/1/2）、
  server/ssh.js、server/run.js、server/pull.js、server/index.js、server/proc.js、
  server/domain.js、src/App.tsx（ResultPreviewStudio）、tests/auth.test.js / index.test.js / run.test.js。
- 接口签名确认：
  - `buildRemoteCommand(command, face='compute')` → `ssh -o BatchMode=yes -o ConnectTimeout=10 k40-ubuntu '<escaped>'`（整体单引号包裹，内层 `'` 转义）。
  - `buildFetchCommand(remotePath, localPath, face='compute')` → `scp -o BatchMode=yes -o ConnectTimeout=10 "host:remote" "local"`。
  - `stripSshNoise(text)`（run.js 导出）→ 按行前缀剥 ssh 噪声。
  - `sanitizeProjectId`（domain.js:343）→ 非法返回 null（防穿越用拒绝式，与 project.js buildCreateProjectCommand 一致）。
- 环境事实：仓库无 .git（git status 不可用，改动核验走文件清单）；22 个既有测试文件；
  S26（run.js stdin 台账 + freePort）已落盘，run.test.js 的 childProcess 假 ssh 垫片手法可复用。
