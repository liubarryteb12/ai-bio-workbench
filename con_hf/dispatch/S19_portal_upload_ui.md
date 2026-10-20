[派发单 · 切片 S19] 子 Agent 任务：portal 补"数据文件上传"UI（服务端契约已就绪，只缺前端）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\index.html（**你只改这一个文件**）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\lib\archive.mjs
     （`DATA_ROLES`/`DATA_EXT`/`MAX_DATA_BYTES`/`validateDataFiles`/`buildPackagePlan`
     的**全部**校验规则——UI 必须与服务端一致，这是契约主体）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\serve.mjs
     （`handleDataFileUpload` 的 query 参数契约、`handleSubmit` 的 payload 字段契约）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\portal_submit.test.js
     与 `BioanalysDesktop/tests/portal_archive.test.js`（**这是接口契约的断言化表达，
     你的 UI 产出的 payload 必须能被这些测试所代表的链路接受**）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【服务启动方式】`PORTAL_PORT=<port> PORTAL_INBOX=<临时目录> node portal/serve.mjs`

【背景（主 Agent 已实测确认）】
- 服务端契约**完整就绪**：`POST /api/datafiles`（二进制流上传，query 参数
  `sid`/`role`/`bind`/`name`，落 `inbox/uploads/<sid>/`）；
  `POST /api/submit` 读 `payload.dataFiles`（数组）+ `payload.uploadSid`，
  经 `validateDataFiles` + `buildPackagePlan` 归档成 `PKG_<时间戳>_<项目名>/raw_data/`。
- **前端缺失**：`grep IN_HOUSE_UPLOAD portal/index.html` = **0 命中**。
  现有页面只有"数据来源"步骤里的 GEO/公共数据库路径（`data_source_mode` 收集后
  没有 `IN_HOUSE_UPLOAD` 这个模式选项），没有任何文件选择器、角色选择、bind 选择。
- 本切片**只补前端**，服务端一行不改。

【主 Agent 已定死的接口契约（不许更改，全部来自服务端源码）】

1. **模式字段**：`dataSource.data_source_mode`，取值 `PUBLIC_DB`（既有）或
   **`IN_HOUSE_UPLOAD`（新增选项）**。选 `IN_HOUSE_UPLOAD` 时显示数据文件上传区。
2. **上传调用**：`POST /api/datafiles?sid=<sid>&role=<role>&bind=<bind>&name=<原始文件名>`
   - **请求体是文件二进制流本身**（`Content-Type: application/octet-stream`），
     **不是 FormData/multipart**（服务端 `req.on('data')` 直接收裸流）。
   - `sid`：本次上传会话 id，前端生成（形如 `u` + 12 位十六进制；
     服务端 `SID_RE` 校验，照 serve.mjs 里的正则要求生成）。
   - `role`：必须是 `DATA_ROLES` 之一：
     `train_matrix` / `val_matrix` / `sample_sheet` / `group_map` /
     `platform_annotation` / `other`。
   - `bind`：GSE 编号（`train_matrix` 必须绑训练集 GSE、`val_matrix` 必须绑验证集 GSE；
     `sample_sheet`/`group_map` 绑 train GSE；`other`/`platform_annotation` 可不绑）。
     **UI 必须把这个规则显式呈现**（下拉选项来自用户在步骤 2 填的数据集 GSE 列表）。
   - `name`：原始文件名（服务端会 sanitize；文件名里出现的 `GSE\d+`/`GPL\d+`
     必须与 bind 一致，不一致服务端 400）。
   - 返回 `{ok:true, name, path, size}` 或 `{ok:false, error}`——**error 必须原样展示给用户**。
   - 单文件上限 1 GiB；扩展名白名单：
     `.tsv .csv .txt .gz .zip .xlsx .h5ad .rds .mtx`
     （**UI 要在文件选择器旁明示，且前端先做同规则预检，别等服务端拒**）。
3. **提交 payload 新增字段**：
   - `uploadSid`：上传会话 id（有上传文件时才带）
   - `dataFiles`：数组，每项 `{ role, bind, name, size, path }`，
     `path` 用服务端返回的 `uploads/<sid>/<savedName>`。
   - `dataSource.data_source_mode = 'IN_HOUSE_UPLOAD'`。
   - 这些字段必须进 `buildManifest()`（现有函数），且**不影响 PUBLIC_DB 路径的 payload 形状**
     （PUBLIC_DB 时不带 `dataFiles`/`uploadSid`，保持既有行为）。
4. **重复上传语义**（服务端规则，UI 要一致）：同 sid 同角色只留一个，重复上传先删旧的。
   UI 层面：同角色再次上传应提示"将替换该角色此前的文件"。
5. **每角色上限**：`other` 之外每个角色只允许一个（`MAX_DATA_FILES_PER_ROLE=3`
   是 other 的容量，UI 对非 other 角色选过一次后应禁用该角色选项或明确提示替换）。

【任务项】
1. 读上述四个文件，把服务端校验规则逐条整理成"前端预检清单"（写在回报里）。
2. 在 `portal/index.html` 的"数据来源"步骤加 `IN_HOUSE_UPLOAD` 模式选项
   （视觉与既有 `.check` 卡片一致，用同一套 CSS 变量，不引外部依赖）。
3. 选该模式时渲染上传区：角色下拉（带中文说明与必填标记）、bind 下拉
   （来自步骤 2 已填的数据集 GSE 列表，含"不绑定"选项，仅对允许不绑的角色可用）、
   文件选择、上传按钮、已传文件列表（显示 角色/bind/文件名/大小/状态，可删除）。
4. 上传走 `fetch('/api/datafiles?...', {method:'POST', body: file})`，
   成功/失败都要有可见反馈；服务端 error 原文展示。
5. `buildManifest()` 增加上述三个字段（仅在有上传时）；
   `validateStep(2)` 对 `IN_HOUSE_UPLOAD` 模式补最小校验：
   **至少上传一个文件**（否则不许进下一步），文件清单非空时才允许提交。
6. 保持其余五步（项目信息/数据来源/分组设计/分析流程/提交需求）既有行为**零变化**
   （PUBLIC_DB 路径的 payload 与提交流程不许变）。
7. 本地自检：`node --check portal/serve.mjs`（确认你没碰坏它）；
   `cd BioanalysDesktop && npm test` 必须 **237/237 全过**（契约测试是你的护栏，
   一个不许红）。
8. 真链验证（**起真进程、打真 HTTP**，照 `portal_submit.test.js` 的做法）：
   - 起服务（`PORTAL_PORT` 用空闲端口、`PORTAL_INBOX` 用临时目录）
   - 正路径：造一个合法文件（如 `GSE277173_series_matrix.txt.gz`，几十字节即可），
     选 `train_matrix` + bind 训练集 GSE，上传 → 断言返回 `{ok:true}` 且
     `inbox/uploads/<sid>/` 下落盘；再 POST `/api/submit` 带完整 payload
     （含 `dataFiles`/`uploadSid`/`data_source_mode='IN_HOUSE_UPLOAD'`）
     → 断言 200 且 `PKG_*` 包目录生成、`raw_data/` 里有该文件、
     `package_manifest.json` 的 `data_files` 条目正确
   - 负路径（至少 4 条，全部断言 400 且 error 点名问题）：
     ① 角色非法 ② 扩展名不在白名单（如 `.exe`）③ bind 不在数据集列表
     ④ train_matrix 的 bind 不是训练集 GSE；如能做再加 ⑤ 文件名里 GSE 与 bind 不一致
   - 把验证脚本留在 `cn_debug/2026-10-20_verification_s19_portal_upload.mjs`（可复跑）
   - **验证必须覆盖你新写的 UI 所产生的真实 payload**：用脚本模拟"按 UI 的字段收集逻辑"
     构造 payload 提交，而不是手写一个想当然的 JSON（防"UI 产出的形状服务端不认"）。
9. 浏览器侧可用性：页面在 `http://127.0.0.1:8080/` 打开后，新模式可选、上传区能显示、
   无 JS 报错（用 `node` 起服务后 curl 首页 200 + 你脚本里的 DOM 断言；
   **没有浏览器环境就在回报里写「未验证：真实浏览器交互」**，不许推断）。
10. **每完成一步就更新一次 `con_hf/dispatch/S19_report.md`**（硬要求）。

【硬性禁止】
- 禁止改 `portal/serve.mjs`、`portal/lib/archive.mjs`、`BioanalysDesktop/` 任何文件、
   任何测试文件、`ops/`、`src/`。
- 禁止改 `DATA_ROLES`/`DATA_EXT`/`MAX_DATA_BYTES` 等拟值（它们不在本切片范围）。
- 禁止引外部 CDN/依赖；禁止用 multipart/FormData（服务端收裸流）。
- 禁止改 PUBLIC_DB 路径的任何行为。
- 禁止把"服务端应该会接受"写成已验证；必须真打 HTTP。
- 禁止改页面既有视觉体系（teal 主题/CSS 变量/步骤条），新增元素必须融入现有样式。

【验收标准】
A1 `IN_HOUSE_UPLOAD` 模式可选，选中后上传区正确渲染（角色/bind/文件/列表）。
A2 上传正路径真通：文件落盘 + `PKG_*` 包生成 + manifest 正确。
A3 至少 4 条负路径真 400 且 error 点名问题。
A4 验证脚本落在指定路径且可复跑；payload 由"UI 字段收集逻辑"构造。
A5 `npm test` 237/237 全过；`node --check portal/serve.mjs` 通过。
A6 PUBLIC_DB 路径零变化（既有测试全过即为证；回报里贴测试结果）。
A7 页面无 JS 报错（或明确标注浏览器交互未验证）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约，Markdown 按序返回，并写入上述 report 文件。
