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
npm run dev        # 后端 18787 + 前端 5173 同时起
```

单独起某一边：`npm run dev:server` / `npm run dev:web`。
生产：`npm run build && npm start`。

改端口：`BAD_PORT=9000 npm run dev:server`。

上传会话 GC 的保留时长：`BIO_UPLOAD_TTL_HOURS=48 npm run dev:server`（默认 24 小时，
非正数/非法值回落默认；启动时跑一次，之后由 `POST /api/upload/init` 惰性触发，10 分钟节流）。

上传暂存的总量配额：`BIO_UPLOAD_QUOTA_BYTES=10737418240 npm run dev:server`（字节，默认 20GiB，
`0` 表示一个会话都不收；缺省/空串/非数字/负数回落默认值）。TTL 只管单个会话何时过期，
管不住"同时活跃的会话太多把磁盘撑爆"，所以 TTL 之后还有这道总量闸门：超配额时从 mtime 最旧的
会话开始淘汰，**活跃会话（10 分钟内被写过）一律不淘汰**；清理后仍超配额则 `POST /api/upload/init`
回 507。

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

当前基线 **1778 tests / 1777 pass / 0 fail / 1 skipped**（206 个测试文件；口径由 ops/metrics_sync.mjs 实测 node --test 汇总行）｜代码规模 22310 SLOC（非空行，79 个文件）
唯一 skip 是条件跳过（宿主缺 python+anndata 时 `bridge_stage` 的坏 h5ad 用例），属设计行为。
链路断开时会是 `1077 / 1073 / 3+ / 1+`：那几条红来自 `proc.test.js` 真连、`consistency.test.js` 远端目录、`link.test.js` 四段自检，全是链路信号，见下面第 2 条。

跑之前先知道三件事，否则会把环境问题误读成代码回归：

1. **临时区已自带兜底，无需手动设 `TEMP`**（2026-11-01 起）。`tests/support/test_tmp.js` 按
   `BIO_TEST_TMP` → 工作区 `.tmp` → `os.tmpdir()` 依次挑可写目录并 realpath 归一，
   全部真跑类用例都经它落临时区。仍想强制指定就设 `BIO_TEST_TMP`。原前提供对照：`wrapper_exec_modes` / `wrapper_running_marker`
   等 7 条会在临时目录里真跑包装器，沙箱外临时目录会让他们全红（实测：指到工作区内后
   这 16/16 全绿）。PowerShell 里可以这样跑：
   `$env:TEMP=$env:TMP="$PWD\.tmp"; node --test tests/*.test.js`
2. **链路类用例「不通就红」是设计行为，不要删也不要改成跳过**：
   `proc.test.js` 的真连服务器验证（经 ssh 接缝拿 `CONTAINER_OK`）、
   `consistency.test.js` 的远端目录准备、`link.test.js` 的设备/forward/四段自检。
   K40 或 adb 不在位时它们红，属于预期信号。

3. **adb 与 ssh 的失败是沙箱权限假象，先提权再判定**。沙箱内 `adb.exe` 一启动就
   `Cannot mkdir '\.android': Permission denied`（退出码 `0xC0000142`），连 `adb version`
   都崩；ssh 则报 `Could not resolve hostname k40-ubuntu`。两者都不是代码问题，提权重跑
   即通（2026-10-24 实测：提权后 `3a3e1f52` 在线、双 forward 在位、四段自检全 PASS，
   848/848 全绿，46 条 skipped 也全部真跑）。
   所以看到这 5 条红（`link.test.js` 三条 + `proc.test.js` 一条 + `consistency.test.js` 一条）
   先提权复跑，再决定要不要查代码。环境变量绕不过去：设 `HOME` 与
   `ANDROID_ADB_SERVER_HOME` 都无效，`adb` 仍去建盘根 `\.android`。

其余环境性失败还有两类，排查时先分清：
宿主没有 python3 时 `bridge_guard_local` 的 local 分支用例会跳过（可用
`BRIDGE_GUARD_PYTHON3` 指定解释器让它们真跑）；宿主没有 bash + pandas/matplotlib 时
`ppi_string_offline` 的真跑用例整体跳过（源码口径另由静态用例覆盖）。

## 三线隔离怎么落

界面上按线收敛选项之外，后端还有无条件兜底：命令文本里出现其他线的 line_id，
`server/audit.js` 一律拒绝执行并返回原因。测试覆盖了跨线、大小写变体、
Windows 风格分隔符、多行命令单行越界四种情形。

## 已知限制

- `data/config.json` 尚未创建，配置读写逻辑留到需要时再加（不预造）。
- 前端 import 的是 `../server/domain.js`，走 Vite 代理，`npm run build` 已验证通过。
- dev 模式下 React StrictMode 会让接口请求发两次，生产不会。
