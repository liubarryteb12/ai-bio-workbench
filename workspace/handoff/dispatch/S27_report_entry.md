[派发单 · 切片 S27] 子 Agent 任务：客户交付报告工作台入口（补 R3 整域缺失，A 批 A4）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\architecture_review_2026-10-20.md
     §3.1 链路图 + §5 A4（本切片的定位）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\build_client_report.py
     docstring（1-33 行，**设计红线：不编造数字/不重写母版/脱敏路径**，退出码 0/1/2）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\server\ssh.js
     （`buildRemoteCommand`/`buildFetchCommand` 两个导出）、`server/run.js`（任务执行与
     ssh 调用范式、`stripSshNoise`）、`server/pull.js`（回搬范式）、`server/index.js`（路由挂载范式）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\src\App.tsx
     （ResultPreviewStudio 一带，你的 UI 落点）
  6) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\aims\aims.txt §三.4（交付界面要求）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【文件域】你只改/建：`BioanalysDesktop/server/report.js`（新建）、
`BioanalysDesktop/server/index.js`（只加路由）、`BioanalysDesktop/src/App.tsx`、
`BioanalysDesktop/tests/report.test.js`（新建）。
**禁止碰**：`ops/`（引擎在另一会话域，只调用）、`portal/`、`src/` 三线、
`server/run.js`、`server/figures.js`、其他 server 模块、`docs/`、真实 `projects/` 数据。
【并行约束】S26 可能仍在跑（改 `server/run.js` + `tests/index.test.js` +
`tests/run.test.js`）——**那三个文件你别碰**。

【背景（主 Agent 已实测）】
- 引擎在且健康：`python3 ops/build_client_report.py --self-test` 本机跑通，
  11 项断言全 PASS（三大件齐全/md+html 落盘/路径脱敏/tar.gz 非空/空项目不崩等）。
- CLI 契约（docstring:21-30 + argparse:2153-2159）：
  `--project <项目目录（含 project.json）>`、`--out <输出目录，默认 <project>/deliverables>`、
  `--no-tar`、`--dry-run`、`--self-test`；退出码 0=成功 / 1=参数或数据错误 / 2=环境错误。
- 缺口：8787 服务端 23 个端点**零** report/download 类接口（S21 疑点 a），
  客户端无 UI → 报告只能人工 ssh 跑 CLI（链路图 §3.1 手工断点 2/3）。
- 远端事实：`/mnt/ssd/bio_data/ops/` 与 `/mnt/ssd/bio_data/projects/<6 个项目>` 均在；
  本项目 use ssh 别名 `k40-ubuntu`（BatchMode 免密）。

【主 Agent 已定死的接口契约（不许自行更改）】

服务端 `server/report.js` 新建模块，导出（名字定死）：
1. `buildReportCommand(projectId)` → `{ command, remoteProjectDir }`
   - `remoteProjectDir` = `/mnt/ssd/bio_data/projects/<projectId>`（**项目根不是 line 目录**，
     引擎自己会扫线下三线产物；`projectId` 必须先经 `sanitizeFileNameSegment` 消毒，
     照 project.js 的既有做法，防路径穿越）
   - `command` = 远端执行完整交付：
     `cd /mnt/ssd/bio_data && python3 ops/build_client_report.py --project '<dir>'`
     （打 tar.gz 的完整形态；**引号必须整体包住远端路径**，照 run.js 台账命令的
     2026-10-13 事故教训）
   - 该函数必须纯函数可单测（不碰 ssh）。
2. `runReportBuild(projectId, handlers)` → Promise
   - 经既有 ssh 范式执行（用 `server/ssh.js` 的 `buildRemoteCommand` + spawn，
     照 run.js 的 spawn 用法；`assertAllowedProgram(['ssh'])` 照 proc.js 红线）
   - 退出码 0 → resolve({ ok:true, stdout })；非 0 → **reject 且带 stderr 原文**
     （不许把失败吞成成功；引擎退出码 1=数据错误、2=环境错误，都要如实带回）
   - stdout/stderr 经 `stripSshNoise`（run.js 已导出）去噪。
3. `LOCAL_DELIVER_ROOT`：本地交付缓存根 = `process.env.BIO_LOCAL_DELIVERABLES`
   || 仓库下 `deliverables/`（**只读 env 或默认，不许硬编码其他路径**）。
4. `localDeliverDir(projectId)`：`LOCAL_DELIVER_ROOT/<sanitize 后的 projectId>`。
5. **下载阶段**：build 成功后，把远端 `<project>/deliverables/` 下三大件
   （`Analysis_Report.md`、`Analysis_Report.html`、`<project_id>_Client_Delivery.tar.gz`）
   拉回 `localDeliverDir(projectId)`。拉回用 `ssh.js` 的 `buildFetchCommand`（scp）
   或既有 pull 范式，**逐个文件校验大小 >0**；文件名允许集合以上三件为准，
   以远端 `ls` 实际结果为准（引擎可能改名），拉取前先列目录。
   任一文件缺失/大小为 0 → 明确报错（不许假装成功）。

`server/index.js` 只加三个路由（其余一律不动）：
6. `POST /api/report/build`：body `{ projectId }` → 校验（projectId 必填+消毒；
   项目目录必须存在于远端——用一条只读 ssh `test -d` 判定，不存在 400 点名）
   → 同步执行 build + pull（本机算力任务可接受分钟级；前端显示"生成中…"）
   → 200 `{ ok:true, files:[{name, bytes, path}], report_md_bytes, report_html_bytes }`
   → 失败 500 `{ ok:false, error: <stderr 原文或缺失文件名> }`。
   **安全红线**：`files[].path` 只回**相对 localDeliverDir 的文件名**，不回绝对路径。
7. `GET /api/report/files?projectId=` → 列本地 `localDeliverDir` 下已有交付文件
   （项目目录不存在或为空 → 200 `{ ok:true, files:[] }`，不是 500）。
8. `GET /api/report/download?projectId=&file=` →
   **只允许下载 `localDeliverDir(projectId)` 下、且文件名在允许集合内的文件**；
   `projectId` 与 `file` 都要消毒；越界/穿越/不在允许集合 → 400；
   以 `application/octet-stream` 流式回吐。

客户端 `App.tsx`（ResultPreviewStudio 内，视觉融入既有按钮/卡片体系）：
9. 「生成交付报告」按钮 + 生成中状态 + 结果清单（三个文件名 + 字节数 + 下载链接）
   + 失败时**原样展示服务端 error**（不美化、不截断关键信息）。
10. 已有的历史交付文件在进入 Studio 时自动列（调 `/api/report/files`）。

测试 `tests/report.test.js`（新建，≥8 条，全绿）：
11. `buildReportCommand`：正常项目 id → 命令含 `--project` 与正确目录；
    **路径穿越 id（`../../etc`、含空格、含引号）必须被消毒或拒绝**（至少 3 条负路径）。
12. 退出码非 0 → reject 且 error 含 stderr 原文（用假 ssh 垫片，照既有测试的
    spawn 拦截手法；**不许真连 K40**）。
13. 三端点契约（起真服务打真 HTTP，照 auth.test.js 手法，**build 端点用假 ssh 垫片**：
    成功垫片回 0 + 预置本地交付文件；失败垫片回 1）：
    - build 成功 → 200 且 files 形状对；
    - build 失败 → 500 且 error 透传；
    - files 空项目 → 200 files=[]；
    - download 合法文件 → 200 且字节数对；
    - download 穿越/不在允许集合 → 400；
    - projectId 缺失/非法 → 400。
14. **既有 22 个测试文件一条不许红**（`npm test` 全绿；注意 S26 可能同时在改
    `tests/index.test.js` 端口——若你看到 index.test.js 的 8 条 FAIL 是
    EADDRINUSE 且 S26 未跑完，就等 S26 结束后再跑一次，不许改那两个文件）。

【任务项】
1. 读上述文件，贴出 `buildRemoteCommand`/`buildFetchCommand`/`stripSshNoise` 的签名
   与返回形状（你要复用它们）。
2. 实现 report.js + 三个路由 + 客户端 UI。
3. 写 report.test.js（≥8 条）。
4. `npm test` 全绿（贴尾行）；`npm run build` 成功（贴尾行）。
5. **E2E 真链（真 K40）**：对既有项目 `PRJ_E2E_GSE277173` 跑一次完整 build：
   - `POST /api/report/build` → 200 + 三件齐全且 bytes>0；
   - 远端 `deliverables/` 与本地 `localDeliverDir` md5 一致（逐件）；
   - `GET /api/report/download?file=Analysis_Report.html` → 200 且能打开
     （断言字节数与非空 HTML 头）；
   - 报告内容抽查：`Analysis_Report.md` 里**不许出现服务器真实路径**
     （引擎脱敏红线，grep `/mnt/ssd` 应为 0 命中，或只有 `{{DATA_ROOT}}` 占位）；
   - 脚本落 `cn_debug/2026-10-20_verification_s27_report_e2e.mjs`（幂等）。
   - 若 K40 不可达：写「未运行：K40 ssh 不可达」+ 已完成替代验证，**不许伪造**。
6. **每完成一步更新一次 `con_hf/dispatch/S27_report.md`**（硬要求）。

【硬性禁止】
- 禁止改 `ops/build_client_report.py`（只调用；引擎在另一会话域）。
- 禁止在报告内容里编造任何数字（引擎红线，你的 UI/接口也不许补默认值）。
- 禁止碰 `server/run.js`、`tests/index.test.js`、`tests/run.test.js`（S26 域）。
- 禁止让 download 能下到 `localDeliverDir` 之外的文件（路径穿越）。
- 禁止把绝对路径回给前端。
- 禁止把"应该能生成"写成已验证；E2E 必须真打 K40 或明确写未运行。

【验收标准】
A1 report.js 五导出全部实现且 buildReportCommand 纯函数可单测。
A2 三端点契约测试全过（含 3 条穿越/非法负路径）。
A3 `npm test` 全绿 + `npm run build` 成功。
A4 K40 E2E：三件生成 + 本地远端 md5 一致 + 报告无真实路径泄漏
   （或明确未运行 + 原因）。
A5 客户端 UI 可用（按钮/状态/清单/下载/error 透传），构建产物由 build 产出。
A6 失败路径不假成功（退出码非 0 → 500 且 error 含原文）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约返回，并写入上述 report 文件。
