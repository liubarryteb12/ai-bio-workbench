# BioanalysDesktop — 本地交互层

> 本目录是工作台的**本地交互层**，按用户指定的软件形态构建。
> 规格见 `con_hf/SPEC-bioanalysdesktop.md`（v0.2），术语见 `con_hf/CONTEXT.md`。

## 一句话定位

**本地只做交互，零算力。** 所有计算命令经 ssh 到手机 Linux 服务器执行，本地不跑 R/Python。

## 硬红线（本地零算力）

本地进程只允许启动三类程序，其余一律拒绝（由 [server/proc.js](file:///d:/00.AIagent/codespace/AI辅助生信分析流程工作台/BioanalysDesktop/server/proc.js) 的白名单强制）：

| 放行 | 用途 |
|---|---|
| `ssh` | 命令下发、探活、读文件 |
| `scp` | 取产物回本地 |
| `adb` | 设备状态、forward 重建 |

禁止在本地启动 R / Rscript / Python / bash 等。这一条不只是规范，有测试兜底
（`tests/proc.test.js` 的"零算力红线"用例），本地跑 Rscript 会直接抛错。

## 目录

```
BioanalysDesktop/
├── server/          # Node 后端（零依赖框架，Node 内置 http）
│   ├── index.js     # 入口，监听 127.0.0.1
│   ├── domain.js    # 领域常量（三线、执行面、路径根），前后端共用
│   ├── proc.js      # 本地子进程出口 + 白名单守卫
│   ├── ssh.js       # 远端命令/取文件的接缝（转义在这里收口）
│   └── audit.js     # 命令审计：拦跨线引用
├── src/             # React 前端
├── tests/           # node:test，测外部行为
├── data/            # 软件自身配置（与生信 envs/ 分开）
└── dist/            # 构建产物
```

前端与服务端共用的纯函数（数据格式白名单、上传会话指纹）放在**仓库根** `shared/`：
`shared/data_formats.mjs`、`shared/upload_session.mjs`。`vite.config.js` 的
`server.fs.allow` 已放行 `'..'`，dev 模式下也能直接 import（`build`/`start` 会内联）。

## 跑起来

```
npm install
npm run dev        # 后端 8787 + 前端 5173 同时起
```

单独起某一边：`npm run dev:server` / `npm run dev:web`。
生产：`npm run build && npm start`。

改端口：`BAD_PORT=9000 npm run dev:server`。

上传会话 GC 的保留时长：`BIO_UPLOAD_TTL_HOURS=48 npm run dev:server`（默认 24 小时，
非正数/非法值回落默认；启动时跑一次，之后由 `POST /api/upload/init` 惰性触发，10 分钟节流）。

## 已有能力

| 接口 | 状态 |
|---|---|
| `GET /api/health` | 可用 |
| `GET /api/link/check` | 可用，四段链路自检 + 算力（可用/物理核、内存总量/可用） |
| `GET /api/projects/list` / `POST /api/projects/create` | 可用，项目管理（数据面按项目分文件夹，`projects/<项目>/<线>/`） |
| `GET /api/files/tree?project=&line=&sub=` | 可用，项目内本线目录树 |
| `GET /api/figures/list` / `GET /api/figures/image` / `GET /preview/figures` | 可用，图件浏览 + 后端自带画廊页（均带 project 参数） |
| `POST /api/upload/init` / `chunk` / `complete` | 可用，分片上传 + 格式校验 + 落项目内 raw_data；`init` 带 `fingerprint` 时由纯函数确定性派生 uploadId（响应 `deterministic: true`），不带则回落 `randomUUID`（旧客户端契约不变） |
| `GET /api/upload/status` | 可用，续传查询：返回 `chunks` / `nextIndex`（最小缺失口径）/ `receivedBytes` / `chunkSize`；`not_found` 回 200 `{ok:false}` 而不是 404 |
| `POST /api/tasks/submit` / `GET /api/tasks` / `GET /api/tasks/logs`(SSE) / `POST /api/tasks/stop` | 可用，任务下发 + 日志流 + 中止 |
| `GET /api/ledger/check` | 可用，台账巡检 |

## 测试

```
npm test
```

当前 445 条全绿（2026-10-21），含一条真连服务器验证（经 ssh 接缝拿 CONTAINER_OK）。
这条测试链路不通时会红，正是我们要的信号，不要删。

## 三线隔离怎么落

界面上按线收敛选项之外，后端还有无条件兜底：命令文本里出现其他线的 line_id，
`server/audit.js` 一律拒绝执行并返回原因。测试覆盖了跨线、大小写变体、
Windows 风格分隔符、多行命令单行越界四种情形。

## 已知限制

- `data/config.json` 尚未创建，配置读写逻辑留到需要时再加（不预造）。
- 前端 import 的是 `../server/domain.js`，走 Vite 代理，`npm run build` 已验证通过。
- dev 模式下 React StrictMode 会让接口请求发两次，生产不会。
