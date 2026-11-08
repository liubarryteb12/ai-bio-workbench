[派发单 · 切片 S31] 子 Agent 任务：portal 可选 Token 鉴权（B4，向后兼容，用户已授权）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\serve.mjs
     （全文 528 行；路由在 :491-528，四个写端点 `/api/submit`、`/api/datafiles`、
     `/api/references` + `/health`；`sendJson` 与 SID_RE 等既有工具）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\portal\index.html
     （提交链路 JS：state/fetch 调用在 1400-1900 一带；`/api/datafiles` 的上传调用）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\portal_submit.test.js
     （真进程 E2E 范式，你的新测试照它写；**这些既有断言一条不许红**）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\aims\aims.txt §一.1
     （"HTTP/S（配合外网穿透与 Token 鉴权）支持远程建项、大文件分片上传与结果预览"——
     本切片的规格依据）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【文件域】你只改：`portal/serve.mjs`、`portal/index.html`、
`BioanalysDesktop/tests/portal_auth.test.js`（新建）。
**禁止碰**：`ops/`、`src/`、`BioanalysDesktop/server/`、`BioanalysDesktop/src/`、
其他任何文件。
【并行约束】主 Agent 在同一时段会做 `git init`（只动 .gitignore 与新建 .git），
**不要执行任何 git 命令**。

【背景（主 Agent 已裁决，用户 2026-10-20 授权"先 B 后 A"）】
- P0 风险（架构评审 R1）：portal 设计为"可单独内网穿透给客户"
  （serve.mjs:5-8 注释），但四个端点**无任何鉴权**——可达者即可匿名写需求 JSON、
  上传至 5GiB 文件、投毒参考文献。
- aims §一.1 要求"配合外网穿透与 Token 鉴权"——**规格有要求，实现缺席**。
- 约束：现有客户已在无口令使用；**默认行为必须保持开放**
  （不设 env 时与今天完全一样），只有运维显式设了 `PORTAL_TOKEN` 才启用鉴权。

【主 Agent 已定死的接口契约（不许自行更改）】

一、`portal/serve.mjs`：
1. 读取 `const PORTAL_TOKEN = process.env.PORTAL_TOKEN || '';`（模块级，与
   `PORTAL_PORT`/`PORTAL_INBOX` 同一处风格）。
2. **豁免端点**：`GET /`、`GET /index.html`、`GET /health` **永不鉴权**
   （页面要能打开、健康检查要能探活）。
3. **受保护端点**：`/api/submit`、`/api/datafiles`、`/api/references`——
   当 `PORTAL_TOKEN` 非空时，要求请求携带 token，两种形态都接受：
   - `Authorization: Bearer <token>` 头；
   - query 参数 `?token=<token>`（便于浏览器表单/下载直链）。
   **比对用定长比较**（`crypto.timingSafeEqual`，两边先 Buffer 化；
   长度不等时直接拒，不许裸 `===` 泄露时序）。
4. 未启用（env 空）时：**行为与今天逐字节一致**（既有测试全绿即证）。
5. 鉴权失败：`401 { ok:false, error:'未授权：缺少或错误的 access token（设置 PORTAL_TOKEN 的服务需要令牌）' }`。
6. `/health` 响应**新增字段** `auth_required: Boolean(PORTAL_TOKEN)`
   （不删既有字段；客户端靠它决定是否显示 token 输入框）。
7. token 匹配逻辑抽成**纯函数导出** `export function checkToken(req, url)` →
   `{ ok:true }` 或 `{ ok:false, error }`，便于单测（不起服务）。
8. **日志**：鉴权失败时 `console.warn` 一行（含 method+pathname，**绝不打印 token 本身**）。

二、`portal/index.html`（最小侵入，视觉融入既有体系）：
9. 页面加载时读 `/health` 的 `auth_required`；为 true 时在页面顶部显示一条
   token 输入区（说明文字："本实例已启用访问令牌，请输入对接人提供的 token"），
   token 存 `localStorage['portal_token']`。
10. 所有 `/api/*` 的 fetch（`/api/submit`、`/api/datafiles`、`/api/references`）
    在 `auth_required` 时自动带上 `Authorization: Bearer <token>` 头；
    401 时原样展示服务端 error 并提示重新输入 token。
11. `auth_required` 为 false 时**零变化**（不显示 token 区、不加头）——
    现有客户无感。

三、测试 `BioanalysDesktop/tests/portal_auth.test.js`（新建，≥8 条，全绿）：
12. `checkToken` 纯函数单测：无 env 时任何请求 ok；有 env 时
    Bearer 正确 ok / Bearer 错误拒 / query 正确 ok / query 错误拒 /
    两者都缺拒 / **token 长度不等时不抛异常且拒**（4 条以上负路径）。
13. 真进程 E2E（照 portal_submit.test.js：`spawn` + `PORTAL_PORT`/`PORTAL_INBOX`
    临时目录，**额外传 `PORTAL_TOKEN`**）：
    - 启用后无 token 打 `/api/submit` → 401 且 error 含"未授权"；
    - 启用后错误 token → 401；
    - 启用后正确 Bearer → 200（真提交一个最小合法 payload）；
    - 启用后正确 query token 上传 `/api/datafiles` → 200 且落盘；
    - `/` 与 `/health` 在启用后仍 200（豁免生效）；
    - `/health` 的 `auth_required` 在启用/未启用两种下分别为 true/false；
    - **未启用时全链路与今天一致**（提交+上传+归档成功，等价于
      portal_submit.test.js 的正路径）。
14. **既有 `portal_submit.test.js` 与 `portal_archive.test.js` 一条不许红**
    （`npm test` 全绿即证；它们不设 PORTAL_TOKEN，走未启用路径）。

【任务项】
1. 读上述文件，贴出 `sendJson`、路由分发、SID_RE 的现状行号（你要改的位置）。
2. 实现 serve.mjs 的 token 机制 + index.html 的 token 区与请求头。
3. 写 portal_auth.test.js（≥8 条）。
4. `cd BioanalysDesktop && npm test` **全绿**（贴尾行；注意现有 251 条 + 你的新增）。
5. 生产冒烟（**不重启 8080**，已在跑）：只验证 `/health` 现在返回
   `auth_required:false`（未启用态），证明没破坏现状；贴输出。
6. **每完成一步更新一次 `con_hf/dispatch/S31_report.md`**（硬要求）。

【硬性禁止】
- 禁止默认启用鉴权（env 不设时必须与今天完全一致）。
- 禁止改 `ops/`、`src/`、`BioanalysDesktop/` 除指定测试文件外的任何文件。
- 禁止在日志/响应里回显 token 明文。
- 禁止用裸 `===` 比对 token。
- 禁止改 `/health` 既有字段或删字段。
- 禁止执行任何 git 命令（主 Agent 同期在 git init）。
- 禁止把"应该能拦住"写成已验证；401/200 必须真打 HTTP。

【验收标准】
A1 `checkToken` 纯函数导出 + 4 条以上负路径单测。
A2 启用态：无 token/错 token → 401 点名；Bearer 与 query 两种形态均放行。
A3 `/`、`/index.html`、`/health` 豁免；`/health` 带 `auth_required`。
A4 未启用态：既有 28 条 portal 契约测试 + 新增正路径全绿（零行为变化）。
A5 `npm test` 全绿（贴尾行）。
A6 index.html 在两种态下的行为正确（启用显示 token 区并带头；未启用零变化）。
A7 日志不泄露 token；失败有 warn 行。

【回报】按 SUBAGENT_CONTRACT.md 输出契约返回，并写入上述 report 文件。
