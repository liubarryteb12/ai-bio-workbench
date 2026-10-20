# S31 执行报告 · portal 可选 Token 鉴权（B4）

状态：已完成（实现 + 测试全绿 + 冒烟），待主 Agent 验收。
执行时间：2026-10-20 21:4x（Asia/Chongqing）。

## 1. 任务理解

portal 四个写端点（/api/submit、/api/datafiles、/api/references + /health 旁路）无鉴权，
与 aims.txt §一.1「配合外网穿透与 Token 鉴权」不符。按主 Agent 已定契约实现**可选**鉴权：
不设 `PORTAL_TOKEN` 时行为与现状逐字节一致；设了才要求 Bearer 头或 `?token=` 查询参数，
`crypto.timingSafeEqual` 定长比较；`/`、`/index.html`、`/health` 永不鉴权；
`/health` 新增 `auth_required` 字段；前端按该字段决定是否显示 token 输入区。

## 2. 改动文件（全部在授权文件域内）

| 文件 | 改动 |
|---|---|
| portal/serve.mjs | +import crypto；模块级 `PORTAL_TOKEN`/`AUTH_ERROR`（:33-40 一带）；`tokensEqual`+`export function checkToken(req, url)`（:127-155 一带，紧跟 sendJson）；路由守卫（/api/* 三端点前，:545-556 一带）；`/health` 增 `auth_required`（:570-575 一带）；启动日志一行（启用时提示，不打印 token） |
| portal/index.html | +`#token-gate` 样式（</style> 前）；+隐藏 token 输入区 HTML（</header> 与 <nav> 之间）；+`authRequired`/`authHeaders`/`authDeniedHint`/`initAuth`（state 定义前）；三处 fetch（/api/references :1186、/api/datafiles :1462、/api/submit :1957）改用 `authHeaders(...)` 且 401 时 error 原文追加"重新输入 token"提示；`init()` 首行调 `initAuth()` |
| BioanalysDesktop/tests/portal_auth.test.js | 新建，14 条（checkToken 单测 7 条 + 启用态 E2E 6 条 + 未启用态全链路 1 条） |

未触碰：ops/、src/、BioanalysDesktop/server/、BioanalysDesktop/src/ 及其他任何文件。
未执行任何 git 命令。

## 3. 验证记录（真实命令与输出）

1. 新测试：`node --test tests/portal_auth.test.js` → **tests 14 / pass 14 / fail 0**（535ms）。
2. 全量回归：`cd BioanalysDesktop && npm test` → **tests 281 / pass 281 / fail 0**（3771ms）。
   注：派发单写"现有 251 条"，实测总量 281 = 既有 267 + 本切片新增 14；
   既有 portal_submit / portal_archive 等全部绿（未启用路径零行为变化）。
3. 生产冒烟（不重启 8080）：
   `curl http://127.0.0.1:8080/health` → HTTP 200，
   返回 `{"ok":true,"service":"user-portal","port":8080,"inbox":"...portal\\inbox\\"}`；
   `GET / -> 200`。现网进程仍为旧代码，响应**尚无** `auth_required` 字段（见 §5 风险 1）。
4. 未启用态 `auth_required:false` 与全链路等价性：由 portal_auth.test.js 中
   另起的未启用子进程实测（`PORTAL_TOKEN:''` 显式置空防 env 继承）——
   无 token 上传/包归档/扁平提交全部 200，`auth_required=false` 断言通过。

## 4. 契约逐条对照

- A1 checkToken 导出 ✅（serve.mjs `export function checkToken`）；负路径单测：
  Bearer 错 / query 错 / 两者都缺 / Basic scheme 视为缺 / 长度不等不抛异常拒 / 同长不同值拒（6 条 > 4）。
- A2 启用态 401 点名 ✅（无 token → 401 含「未授权」；错 Bearer → 401）；
  Bearer ✅（submit 200）、query ✅（datafiles 200 落盘）。
- A3 豁免 ✅（启用态 `/`、`/index.html`、`/health` 无 token 均 200）；`/health.auth_required` ✅（true/false 两态实测）。
- A4 既有 portal 契约测试零红 ✅（npm test 281 全绿）。
- A5 npm test 全绿 ✅（尾行：tests 281 / pass 281 / fail 0）。
- A6 index.html 两态行为 ✅（实现层：auth_required=false 时零渲染变化、零加头；
  浏览器人工目检未做——无 UI 自动化，标注「未在真实浏览器目检」）。
- A7 日志 ✅（warn 行 `鉴权失败: POST /api/submit`，测试断言日志不含 token 明文）。

## 5. 假设与风险

1. **现网 8080 未重启**（派发单明确禁止）：新代码（含 auth_required 字段与鉴权能力）
   要等下次重启 portal 进程才生效。冒烟只能证明"没破坏现状"，不能证明新逻辑已上线。
   重启属主 Agent/运维动作，本切片未执行。
2. checkToken 在「启用态」下同时接受头与 query：契约原文即要求两种形态都接受，已照办；
   query 形态会把 token 留在访问日志/浏览器历史，属契约既定取舍，由运维知悉。
3. token 以明文存 localStorage（契约第 9 条指定 key），XSS 面不因本切片扩大（页面本就同源直出）。
4. index.html 前端行为无浏览器级自动化测试，A6 的「启用显示/带头」依据为实现审查 + 服务端
   401/200 契约测试；建议主 Agent 或运维启用实例后人工开一次页面确认输入区显示。

## 6. 待主 Agent 决策事项

- 无阻断项。可选建议：重启 portal 后用 `curl /health` 复核 `auth_required` 字段出现。

## 7. 建议下一步

1. 主 Agent 验收：复核 npm test 输出与本文件 §3 命令。
2. 运维侧择机重启 portal 并设置 PORTAL_TOKEN（生成高熵随机串，勿用短口令）。
