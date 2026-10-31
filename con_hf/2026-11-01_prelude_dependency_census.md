# 前置层搬迁依赖普查报告

> 产出代理：只读情报子代理
> 日期：2026-11-01
> 普查基线：server/index.js 共 877 行（与 P3 专项文档实测一致）
> 普查方法：@babel/parser 静态遍历 server/ routes/ tests/ src/，辅以 rg 全文搜索复核
> 普查脚本：BioanalysDesktop/.tmp/census-symbols.cjs（已在 .tmp/ 内，git 忽略）

## 0. 普查方法与验证命令

### 0.1 实际运行的验证命令及结果

1. `node .tmp/map-index.cjs server/index.js`：输出 index.js 顶层结构地图，47 个顶层语句，import 占 48 行。
2. `node .tmp/show-lines.cjs server/index.js <from> <to>`：逐段取行原文，绕开工具渲染错乱。
3. `rg -n "readFileSync" tests/ --no-heading`：扫出 30 个测试文件使用 readFileSync 读源码。
4. `rg -n "readFile\(" tests/ --no-heading`：扫出 6 个测试文件使用异步 readFile 读源码。
5. `rg -n "import\(" tests/ --no-heading`：扫出 34 处动态 import。
6. `rg -n "\bspawn\b|\bspawnSync\b|\bexecFileSync\b|\bfork\b" tests/ --no-heading`：扫出全部子进程调用。
7. `node .tmp/census-symbols.cjs`：用 @babel/parser 遍历全部源文件与测试，输出每个待搬符号的 文件:行号 指针。
8. `rg -n "runRemoteStrict\(" server/index.js`：实测 index.js 中 runRemoteStrict( 出现 1 次（仅定义，L265）。
9. `rg -c "runRemoteStrict\(" server/routes/diagnostics.routes.js`：实测 diagnostics.routes.js 中出现 4 次（调用），均为 selfcheck 路由内部。

### 0.2 方法陷阱已覆盖

- `preview_mods.test.js` 用异步 `readFile`（L152-155），只 grep `readFileSync` 会漏，已补上。
- `aims_drift_guard.test.js` 用自封装 `read()` 函数（L92），读 `BioanalysDesktop/server/index.js`，已覆盖。
- `workflow_api.test.js` 也用异步 `readFile`（L97-98），扫 index.js + projects.routes.js 并集。
- `manifest_mod_form.test.js` 用异步 `readFile`（L62），扫 index.js + projects.routes.js 并集。

## 1. 待搬符号的 server/ 与 src/ 引用全覆盖

### 1.1 server/sinks.js 目标符号

#### createSink

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 176 | 定义 |
| server/index.js | 774 | routeCtx 注入（obj-key + obj-shorthand） |
| server/routes/tasks.routes.js | 26 | routeCtx destructure（obj-key + obj-shorthand） |
| server/routes/tasks.routes.js | 366 | routeCtx 调用 |

#### dropSink

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 182 | 定义 |
| server/index.js | 774 | routeCtx 注入 |
| server/routes/tasks.routes.js | 26 | routeCtx destructure |
| server/routes/tasks.routes.js | 368 | routeCtx 调用 |

#### sendEvent

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 190 | 定义 |
| server/index.js | 774 | routeCtx 注入 |
| server/routes/tasks.routes.js | 26 | routeCtx destructure |
| server/routes/tasks.routes.js | 295, 296, 299, 310, 314 | routeCtx 调用 |

#### closeSink

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 207 | 定义 |
| server/index.js | 774 | routeCtx 注入 |
| server/routes/tasks.routes.js | 26 | routeCtx destructure |
| server/routes/tasks.routes.js | 301, 316 | routeCtx 调用 |

### 1.2 server/ledger_fetch.js 目标符号

#### fetchLedgerFromServer

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 217 | 定义 |
| server/index.js | 769 | routeCtx 注入 |
| server/routes/diagnostics.routes.js | 25 | routeCtx destructure |
| server/routes/diagnostics.routes.js | 133 | routeCtx 调用 |

### 1.3 server/remote_exec.js 目标符号

#### runRemoteRaw

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 238 | 定义 |
| server/index.js | 86, 255 | 直接调用（uploadPreparedFigureScripts L86, runRemote L255） |
| server/index.js | 769 | routeCtx 注入 |
| server/routes/diagnostics.routes.js | 25 | routeCtx destructure |
| server/routes/figures.routes.js | 28 | routeCtx destructure |
| server/routes/figures.routes.js | 225 | 调用 |
| server/routes/projects.routes.js | 24 | routeCtx destructure |
| server/routes/projects.routes.js | 325 | 调用 |
| server/routes/tasks.routes.js | 26 | routeCtx destructure |
| server/routes/tasks.routes.js | 163 | 调用 |

#### listRemoteProcessed

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 247 | 定义 |
| server/index.js | 770 | routeCtx 注入 |
| server/routes/figures.routes.js | 29 | routeCtx destructure |
| server/routes/figures.routes.js | 326 | 调用 |
| server/routes/preview_mods（无独立模块） | | |

注意：`preview_mods.test.js:159` 静态守卫断言 `function listRemoteProcessed\(` 出现在 index.js + figures.routes.js 并集中。当 `listRemoteProcessed` 定义搬到 `remote_exec.js` 后，此守卫须把 `remote_exec.js` 也加进并集，否则断言 `function listRemoteProcessed\(` 在并集中不再命中。

#### runRemote

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 254 | 定义 |
| server/index.js | 218, 226, 249, 365, 368, 400, 404, 749 | 直接调用 |
| server/index.js | 769 | routeCtx 注入 |
| server/routes/diagnostics.routes.js | 25 | routeCtx destructure |
| server/routes/diagnostics.routes.js | 121, 171, 184 | 调用 |
| server/routes/figures.routes.js | 28 | routeCtx destructure |
| server/routes/figures.routes.js | 422 | 调用 |
| server/routes/projects.routes.js | 24 | routeCtx destructure |
| server/routes/projects.routes.js | 146, 289, 331, 360, 405, 436 | 调用 |
| server/routes/upload.routes.js | 21 | routeCtx destructure |
| server/routes/upload.routes.js | 207 | 调用 |

#### runRemoteStrict

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 265 | 定义 |
| server/index.js | 769 | routeCtx 注入 |
| server/routes/diagnostics.routes.js | 25 | routeCtx destructure |
| server/routes/diagnostics.routes.js | 31, 39, 48, 58 | 调用（四维自检） |

#### sanitizeBridgeOutput

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 279 | 定义 |
| server/index.js | 774 | routeCtx 注入 |
| server/routes/tasks.routes.js | 27 | routeCtx destructure |
| server/routes/tasks.routes.js | 260 | 调用 |

### 1.4 server/query_views.js 目标符号

#### resolveProjectParam

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 355 | 定义 |
| server/index.js | 769, 813 | routeCtx 注入 + 直接调用（preview/figures 端点 L813） |

注意：resolveProjectParam 在 index.js L813 被直接调用（`/preview/figures` 端点），不是经 routeCtx。搬走后 index.js 须 import 回来或把 `ht = resolveProjectParam(url)` 也改成 `ht = routeCtx.resolveProjectParam(url)`。这是 1.4 节的关键发现。

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/routes/diagnostics.routes.js | 25, 153 | routeCtx destructure + 调用 |
| server/routes/figures.routes.js | 28, 148, 274, 308, 407 | routeCtx destructure + 调用 |

#### listProjectsWithMeta

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 364 | 定义 |
| server/index.js | 776 | routeCtx 注入 |
| server/routes/projects.routes.js | 23, 29 | routeCtx destructure + 调用 |

#### listFiguresForLine

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 384 | 定义 |
| server/index.js | 770, 820 | routeCtx 注入 + 直接调用（preview/figures 端点 L820） |

注意：与 resolveProjectParam 相同，listFiguresForLine 和 renderFiguresPreview 在 index.js L810-829 的 `/preview/figures` 端点中被直接调用。搬走后须 import 回来或改用 routeCtx 注入。

### 1.5 server/portal_page.js 目标符号

#### escapeHtml

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 416 | 定义 |
| server/index.js | 440, 444, 446, 447, 452, 481 | 在 renderFiguresPreview 内部调用 |

#### renderFiguresPreview

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 429 | 定义 |
| server/index.js | 823 | 在 `/preview/figures` 端点直接调用 |

### 1.6 server/portal_inbox.js 目标符号

#### PORTAL_INBOX

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 499 | 定义 |
| server/index.js | 520, 535, 539, 550, 556, 596, 605, 727, 728 | 在 portal_inbox 函数群内部调用 |
| server/index.js | 777 | routeCtx 注入 |
| server/routes/projects.routes.js | 22, 476, 477 | routeCtx destructure + 调用 |

注意：deployDataFiles（task_input.js 目标）也直接引用 PORTAL_INBOX（L727-728）。搬 PORTAL_INBOX 到 portal_inbox.js 后，deployDataFiles 与 listInboxManifests/readPackageManifest 等函数都需要 import PORTAL_INBOX，或把 PORTAL_INBOX 的定义放在比所有消费者更早加载的模块。

#### isSafeManifestName

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 507 | 定义 |
| server/index.js | 777 | routeCtx 注入 |
| server/routes/projects.routes.js | 22, 472 | routeCtx destructure + �9调用 |

#### readPackageManifest

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 515 | 定义 |
| server/index.js | 596 | 在 listInboxManifests 内部调用 |
| server/index.js | 777 | routeCtx 注入 |
| server/routes/projects.routes.js | 23, 491 | routeCtx destructure + 调用 |

#### listInboxManifests

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 532 | 定义 |
| server/index.js | 777 | routeCtx 注入 |
| server/routes/projects.routes.js | 23, 465 | routeCtx destructure + 调用 |

### 1.7 server/static_assets.js 目标符号

#### DIST_DIR

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 490 | 定义 |
| server/index.js | 649, 665 | 在 serveStatic 内部调用 |

#### STATIC_MIME

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 609 | 定义 |
| server/index.js | 652 | 在 serveStatic 内部调用 |

#### serveStatic

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 634 | 定义 |
| server/index.js | 843 | 在 createServer 静态兜底直接调用 |

注意：serveStatic 内部调用 json()（L638, L676）和 DIST_DIR / STATIC_MIME。搬 serveStatic 到 static_assets.js 后，static_assets.js 须 import json。或者把 json 定义也搬走（但 json 被 6 个路由模块通过 routeCtx 使用，搬走会让 routeCtx 少一个符号）。

### 1.8 server/task_input.js 目标符号

#### remoteTaskInput

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 64 | 定义 |
| server/index.js | 770 | routeCtx 注入 |
| server/figure_project_plan.js | 5 | 独立同名定义（与 index.js 版本不同，不依赖） |

注意：figure_project_plan.js 有自己的 remoteTaskInput，是独立实现，不受搬迁影响。

#### uploadPreparedFigureScripts

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 82 | 定义 |
| server/index.js | 86 | 调用 runRemoteRaw |
| server/index.js | 776 | routeCtx 注入 |
| server/routes/projects.routes.js | 24, 157, 319 | routeCtx destructure + 调用 |

#### deployDataFiles

| 文件 | 行号 | 引用方式 |
|---|---|---|
| server/index.js | 714 | 定义 |
| server/index.js | 727, 728 | 引用 PORTAL_INBOX |
| server/index.js | 749 | 调用 runRemote |
| server/index.js | 776 | routeCtx 注入 |
| server/routes/projects.routes.js | 22, 170 | routeCtx destructure + 调用 |

### 1.9 跨模块共享但留在 index.js 的辅助（json / uploadError / runningTasks / logSinks / routeCtx）

| 符号 | 定义位置 | routes/ 消费方式 |
|---|---|---|
| json | index.js L294 | routeCtx destructure（全部 6 个路由模块） |
| uploadError | index.js L313 | routeCtx destructure（upload.routes.js L21） |
| runningTasks | index.js L168 | routeCtx destructure（tasks.routes.js L26） |
| logSinks | index.js L174 | 仅 sinks 群使用，不经 routeCtx |
| routeCtx | index.js L768 | 各路由模块的 ctx 参数 |

## 2. tests/ 下对每个待搬符号的依赖（三分开列）

### 2.1 运行时依赖（import index.js 后取符号）

| 符号 | 测试文件 | 行号 | 获取方式 |
|---|---|---|---|
| server | tests/figure_catalog.test.js | 69 | `const { server } = await import('../server/index.js')` |
| server | tests/report.test.js | 46 | `const { server } = await import('../server/index.js')` |
| server | tests/bridge_checkpoint.test.js | 196 | `const mod = await import('../server/index.js')` then `mod.server.closeAllConnections()` |
| server | tests/wp33_figure_adapt.test.js | 251 | `const { server } = await import('../server/index.js')` |
| server | tests/upload_quota.test.js | 461 | `const mod = await import('../server/index.js')` then `mod.server.closeAllConnections()` |
| server | tests/upload_reserve.test.js | 6 | `const mod = await import('../server/index.js')` then `mod.server.closeAllConnections()` |
| server | tests/upload_resume.test.js | 191 | `const mod = await import('../server/index.js')` then `mod.server.closeAllConnections()` |
| server | tests/upload_session.test.js | 456 | `const mod = await import('../server/index.js')` then `mod.server.closeAllConnections()` |
| validateTaskPaths | tests/task_submit_validation.test.js | 78, 114, 127, 131, 136, 146, 153, 161, 164, 171, 179, 186, 192, 198 | `validateTaskPaths = mod.validateTaskPaths`（L78），静态断言 L79，后续纯函数调用 |

### 2.2 源码文本守卫（读 server/index.js 源码再匹配符号）

#### tests/selfcheck_isolation_merge.test.js

- L26：`const INDEX_SRC = fs.readFileSync(...server/index.js...)`
- L29-31：`const DIAGNOSTICS_SRC = fs.readFileSync(...routes/diagnostics.routes.js...)`
- L33：`const STRICT_GUARD_SRC = INDEX_SRC + DIAGNOSTICS_SRC`
- L151：`STRICT_GUARD_SRC.match(/runRemoteStrict\(/g)` 断言出现次数 >= 5
- L154：`assert.match(STRICT_GUARD_SRC, /runRemoteStrict\('df -T \/mnt\/ssd\/bio_data/)`
- L155：`assert.match(STRICT_GUARD_SRC, /runRemoteStrict\('df -P \/mnt\/ssd\/bio_data/)`
- L156：`assert.match(STRICT_GUARD_SRC, /runRemoteStrict\(buildHardwareCommand\(\)\)/)`
- L157：`assert.match(STRICT_GUARD_SRC, /runRemoteStrict\(buildIsolationCommand\(\)\)/)`
- L159：`assert.doesNotMatch(STRICT_GUARD_SRC, /runRemote\(buildIsolationCommand\(\)\)/)`
- L160：`assert.doesNotMatch(STRICT_GUARD_SRC, /runRemote\('df -T/)`
- L164：`assert.match(STRICT_GUARD_SRC, /import \{[^}]*runSha256ParityCheck[^}]*\} from '\.\.?\/selfcheck\.js'/s)`
- L165：`assert.match(STRICT_GUARD_SRC, /import \{[^}]*mergeIsolationChecks[^}]*\} from '\.\.?\/selfcheck\.js'/s)`
- L166：`assert.match(STRICT_GUARD_SRC, /const merged = mergeIsolationChecks\(isolation, runSha256ParityCheck\(\)\)/)`
- L171：`assert.match(STRICT_GUARD_SRC, /sub_checks:/)`
- L183-185：App.tsx + app.css 守卫（P3-02 范围，不影响 P3-01 后端搬迁）

#### tests/wp13_runner_guards.test.js

- L66-76：409 闸门守卫扫 index.js + tasks.routes.js 并集
  - L70：`fs.readFileSync(...server/index.js...)`
  - L71：`fs.readFileSync(...routes/tasks.routes.js...)`
  - L73：`assert.match(text, /runningTasks\.size > 0/)`
  - L74：`assert.match(text, /P-29 禁止并发 SSH/)`
  - L75：`assert.match(text, /json\(res, 409/)`

#### tests/aims_drift_guard.test.js

- L92-93：`read('BioanalysDesktop/server/index.js')` 断言 `process\.env\.BAD_PORT\s*\|\|\s*18787`
  普查确认此守卫只匹配 BAD_PORT 字面量，不涉及待搬符号。

#### tests/preview_mods.test.js

- L152-163（异步 readFile）：扫 SERVER (index.js) + FIGURES_ROUTES 并集
  - L154：`await readFile(SERVER, 'utf8')`
  - L155：`await readFile(FIGURES_ROUTES, 'utf8')`
  - L157：`assert.match(src, /url\.pathname === '\/api\/preview\/mods'/)`
  - L158：`assert.match(src, /const picked = modIds\.length/)`
  - L159：`assert.match(src, /function listRemoteProcessed\(/)`
  - L161：`assert.match(src, /ls -1 \$\{dir\} 2>\/dev\/null \|\| true/)`
  - L163：`assert.ok(!/find .*processed/.test(src))`

#### tests/workflow_api.test.js

- L96-98（异步 readFile）：扫 index.js + projects.routes.js 并集
  - L97：`await readFile(new URL('../server/index.js', ...), 'utf8')`
  - L98：`await readFile(new URL('../server/routes/projects.routes.js', ...), 'utf8')`
  - L100-105：断言 `/api/workflows/resolve` 精确匹配位于 startsWith('/api/workflows/') 之前
  - L101：正则 `/url\.pathname\s*===\s*['"]\/api\/workflows\/resolve['"]/`
  - L104：正则 `/url\.pathname\.startsWith\(\s*['"]\/api\/workflows\/['"]\s*\)/`

#### tests/manifest_mod_form.test.js

- L62（异步 readFile）：`[await readFile(SERVER, 'utf8'), await readFile(PROJECTS_ROUTES, 'utf8')].join('\n')`
  - SERVER = index.js, PROJECTS_ROUTES = routes/projects.routes.js
  - L63-64：断言 `seriesId: requested.seriesId`, `modIds: requested.modIds`, `koGene: requested.koGene`
  - L67-68：断言 `lineId: requested\.lineId \|\| requested\.seriesId`
  - L92-93（spawnSync）：`spawnSync(process.execPath, [SERVER], { env: { ...LINE_INFER_PROBE: ... } })`

### 2.3 进程级依赖（spawn node server/index.js 或依赖模块加载期行为）

| 测试文件 | 行号 | 依赖形态 | 依赖的符号/行为 |
|---|---|---|---|
| tests/auth.test.js | L51 | `spawn(process.execPath, ['server/index.js'])` | 模块加载期鉴权 + `isAuthorized` |
| tests/auth.test.js | L132 | `spawn(process.execPath, ['server/index.js'])` | 同上 |
| tests/index.test.js | L43 | `spawn(process.execPath, ['server/index.js'])` | `server.listen` +模块加载期行为 |
| tests/preview_mods.test.js | L34 | `spawn(process.execPath, [SERVER])` | `server.listen` |
| tests/workflow_api.test.js | L41 | `spawn(process.execPath, [entry])` | `server.listen` |
| tests/pipeline_line_infer.test.js | L30 | `spawnSync(process.execPath, [SERVER], { env: LINE_INFER_PROBE })` | `LINE_INFER_PROBE` 短路入口 + `lineFromPipeline` |
| tests/manifest_mod_form.test.js | L92 | `spawnSync(process.execPath, [SERVER], { env: LINE_INFER_PROBE })` | 同上 |
| tests/portal_resolve_parity.test.js | L80 | `spawn(process.execPath, [WORKBENCH])` | `server.listen` + 路由匹配 |

## 3. 搬走后必须把新模块加进并集扫描范围的守卫清单

### 3.1 tests/selfcheck_isolation_merge.test.js L26-33 (STRICT_GUARD_SRC)

当前：

```js
const INDEX_SRC = fs.readFileSync(...server/index.js...);
const DIAGNOSTICS_SRC = fs.readFileSync(...routes/diagnostics.routes.js...);
const STRICT_GUARD_SRC = INDEX_SRC + DIAGNOSTICS_SRC;
```

实测计数：
- index.js 中 `runRemoteStrict(` 出现 1 次（L265 的定义）
- diagnostics.routes.js 中出现 4 次（L31, L39, L48, L58 的调用）
- 并集共 5 次，恰好满足 `>= 5`

搬 `runRemoteStrict` 定义到 `remote_exec.js` 后：
- index.js 贡献 0 次
- diagnostics.routes.js 贡献 4 次
- 并集降至 4 次，`< 5`，守卫报红：`runRemoteStrict 出现次数过少：4`

必须改：在 `STRICT_GUARD_SRC` 并集中加入 `remote_exec.js`。改后：
- remote_exec.js 贡献 1 次（定义本身）
- 并集回升到 5 次，满足 `>= 5`

同时 L157 的 `runRemoteStrict\(buildIsolationCommand\(\)\)` 正则会因定义不在 index.js 而不匹配，搬到 remote_exec.js 后需确认正则对 remote_exec.js 不期望匹配（该正则匹配的是 diagnostics.routes.js 中的调用形态，不涉及定义文件，加 remote_exec.js 进并集不影响这条断言的命中）。

### 3.2 tests/preview_mods.test.js L154-159 (SERVER + FIGURES_ROUTES 并集)

当前并集扫 `index.js` + `routes/figures.routes.js`，断言 `function listRemoteProcessed\(` 必须命中。

实测：`listRemoteProcessed` 定义在 `index.js` L247。搬走后此定义消失，须把 `remote_exec.js` 加进并集。
具体涉及两条断言：
- L159：`assert.match(src, /function listRemoteProcessed\(/, '必须有 processed 列目录辅助')`
- L161：`assert.match(src, /ls -1 \$\{dir\} 2>\/dev\/null \|\| true/)`，此正则匹配 listRemoteProcessed 函数体里的命令，也随定义一起搬走。

### 3.3 tests/pipeline_line_infer.test.js L79 (SERVER 单文件)

L78-82 守卫扫 `SERVER`（即 index.js）单文件，断言：

```js
assert.match(src, /modToScriptMap\(\)/);
assert.match(src, /modToScript\.get\(s\)\s*\|\|\s*s/);
```

`lineFromPipeline` 定义在 index.js L685，函数体内调 `modToScriptMap()`。当前 `lineFromPipeline` 不在搬迁范围，但 L78-82 在 index.js 源码守卫中。P3 专项文档第六节第 3 条说 lineFromPipeline 实现可搬走，但探针入口必须留 index.js。若步骤搬 lineFromPipeline 实现，此守卫须把新位置加入并集。

### 3.4 tests/portal_resolve_parity.test.js (index.js spawn)

L80 spawn `node server/index.js`，进程级依赖。此测试不读 index.js 源码文本，只依赖模块加载期行为。搬走后的行为不变只要 `import` 链完整，此守卫自身不需改。

## 4. 绝对不能搬出 index.js 的符号清单与证据

### 4.1 export { server }

定义：server/index.js L779（`const server = http.createServer(...)`），L877（`export { server }`)

测试钉住位置：
- tests/figure_catalog.test.js L69：`const { server } = await import('../server/index.js')`
- tests/report.test.js L46：`const { server } = await import('../server/index.js')`
- tests/bridge_checkpoint.test.js L196：`const mod = await import('../server/index.js')` -> `mod.server.closeAllConnections()`
- tests/target_ko_gene.test.js L90-91：`const mod = await import('../server/index.js')` -> `mod.server.closeAllConnections()`
- tests/task_submit_validation.test.js L93-94：同上
- tests/upload_quota.test.js L461-462：同上
- tests/wp33_figure_adapt.test.js L251-257：`const { server } = await import('../server/index.js')`

### 4.2 export function validateTaskPaths

定义：server/index.js L329（`export function validateTaskPaths`）

测试钉住位置：
- tests/task_submit_validation.test.js L77-79：

```
const mod = await import('../server/index.js');
validateTaskPaths = mod.validateTaskPaths;
assert.equal(typeof validateTaskPaths, 'function', 'server/index.js 必须导出 validateTaskPaths 纯函数');
```

如果实现搬到 `ledger.js`，index.js 必须 `export { validateTaskPaths } from './ledger.js'` re-export，否则 `mod.validateTaskPaths` 为 undefined。

### 4.3 LINE_INFER_PROBE 短路入口

定义：server/index.js L867-869

```js
if (process.env.LINE_INFER_PROBE) {
  const dag = JSON.parse(process.env.LINE_INFER_PROBE);
  process.stdout.write(lineFromPipeline(dag));
```

测试钉住位置（进程级 spawn，依赖模块加载期短路不 listen）：
- tests/pipeline_line_infer.test.js L30-36：`spawnSync(process.execPath, [SERVER], { env: { LINE_INFER_PROBE: ... } })`
- tests/manifest_mod_form.test.js L92-93：同上

此外 tests/pipeline_line_infer.test.js L78-82 扫 index.js 源码文本断言：
```
assert.match(src, /modToScriptMap\(\)/);
assert.match(src, /modToScript\.get\(s\)\s*\|\|\s*s/);
```
这条守卫可能钉死了 lineFromPipeline 的函数体必须在 index.js。lineFromPipeline 本身不在搬迁范围，但 P3 文档明说"实现可搬走，探针入口留本文件"。若搬实现，此守卫需并集。

### 4.4 process.env.BAD_PORT || 18787

定义：server/index.js L60（`const PORT = Number(process.env.BAD_PORT || 18787)`）

测试钉住位置：
- tests/aims_drift_guard.test.js L92-93：

```
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
assert.match(read('BioanalysDesktop/server/index.js'), /process\.env\.BAD_PORT\s*\|\|\s*18787/);
```

`REPO_ROOT` 同理留本文件，在 report.js（L31定义等）与 selfcheck.js（L259定义）有各自独立的 REPO_ROOT，是同名独立定义，不与 index.js 的 REPO_ROOT 共享。

### 4.5 鉴权块（AUTH_USER / AUTH_PASS / AUTH_ENABLED / IS_TEST_RUNTIME / DEV_NOAUTH / safeEqual / isAuthorized）

定义：
- AUTH_USER：L119
- AUTH_PASS：L120
- AUTH_ENABLED：L121
- IS_TEST_RUNTIME：L123
- DEV_NOAUTH：L124
- 块体：L125-136
- safeEqual：L139
- isAuthorized：L146

测试钉住位置：
- tests/auth.test.js L20, L51, L132：spawn `node server/index.js`，测鉴权负路径（D-29 Fail-Closed）。
- tests/auth.test.js L164：读 runtime JSON 文件验证临时口令生成逻辑。

这些符号全在 index.js 模块加载期执行（L125-136），搬走会让进程启动时鉴权初始化丢失。

## 5. 搬迁顺序建议

按依赖图从叶子往根搬。核心约束：每个 `routeCtx` 注入的符号在搬迁后仍须在 index.js 可见（通过 import 回来），不能只搬走不 re-export。

### 第 0 步（前置）：确定注入策略

`json` 和 `uploadError` 是最底层的共享辅助，6 个路由模块全靠 routeCtx 注入。`serveStatic` 内部也直接调用 `json`。建议先把 `json` 和 `uploadError` 定义留在 index.js（它们很短，6 行 + 3 行），或者搬到一个 `server/helpers.js` 后由 index.js re-export 由 routeCtx 传入。不变 routeCtx 契约的前提方案是留在 index.js。

### 第 1 步：server/sinks.js（叶子，零跨模块依赖）

- 搬出：`logSinks`、`createSink`、`dropSink`、`sendEvent`、`closeSink`
- 内部依赖：无外部符号（全部操作 `logSinks` 这个 Map）
- index.js 改动：删 5 个定义，加 `import { logSinks, createSink, dropSink, sendEvent, closeSink } from './sinks.js'`
- routeCtx 照常注入（index.js 仍可见这些符号）
- tests/ 影响：零。无测试直接测 sink 函数的源码文本，所有依赖都是运行态通过 index.js 的 HTTP 接口。

### 第 2 步：server/remote_exec.js（叶子，只依赖 proc.js 和 domain.js）

- 搬出：`runRemoteRaw`、`runRemote`、`runRemoteStrict`、`listRemoteProcessed`、`sanitizeBridgeOutput`
- 内部依赖：从 proc.js import `runSshRaw`/`runSshStrict`；从 domain.js import `projectLineDir`
- index.js 改动：删 5 个定义，加 `import { runRemoteRaw, runRemote, runRemoteStrict, listRemoteProcessed, sanitizeBridgeOutput } from './remote_exec.js'`
- routeCtx 照常注入
- 必须同步改的守卫：
  - tests/selfcheck_isolation_merge.test.js L29-33：在 STRICT_GUARD_SRC 并集中加入 remote_exec.js
  - tests/preview_mods.test.js L153-156：在 src 数组中加入 remote_exec.js

### 第 3 步：server/ledger_fetch.js（叶子，只依赖 remote_exec）

- 搬出：`fetchLedgerFromServer`
- 内部依赖：调用 `runRemote`
- index.js 改动：删定义，加 import
- routeCtx 照常注入
- tests/ 影响：零新增。

### 第 4 步：server/static_assets.js（叶子，只依赖 json）

- 搬出：`DIST_DIR`、`STATIC_MIME`、`serveStatic`
- 内部依赖：`serveStatic` 调用 `json`
- index.js 改动：删 3 个定义，加 import。index.js L843 `serveStatic(res, url.pathname)` 仍可调用。
- tests/ 影响：零新增（无测试扫 index.js 源码看 serveStatic）。

### 第 5 步：server/query_views.js（依赖 remote_exec + domain + pull + figures）

- 搬出：`resolveProjectParam`、`listProjectsWithMeta`、`listFiguresForLine`
- 内部依赖：`runRemote`、`buildProjectListCommand`/`parseProjectList`/`buildReadProjectMetaCommand`/`parseProjectMeta`（from project.js）、`assertFiguresPath`/`parseFigureList`/`decorateFigures`（from figures.js）、`readLocalFigures`（from pull.js）、`DEFAULT_PROJECT`/`sanitizeProjectId`（from domain.js）
- index.js 改动：删 3 个定义，加 import。注意 L813 `resolveProjectParam(url)` 和 L820 `listFiguresForLine(projectId, lineId)` 是在 createServer 闭包内直接调用，搬后 index.js 须 import 回来。
- tests/ 影响：零新增。

### 第 6 步：server/portal_page.js（依赖 query_views 的 listFiguresForLine）

- 搬出：`escapeHtml`、`renderFiguresPreview`
- 内部依赖：无（`escapeHtml` 是纯函数，`renderFiguresPreview` 只调 `escapeHtml`）
- index.js 改动：删 2 个定义，加 import。L823 `renderFiguresPreview(sections, projectId)` 仍在 index.js 直接调用。
- tests/ 影响：零新增。

### 第 7 步：server/portal_inbox.js（依赖 domain.js 的 normalizeDatasets/resolveLineFromDataType）

- 搬出：`PORTAL_INBOX`、`isSafeManifestName`、`readPackageManifest`、`listInboxManifests`
- 内部依赖：`fileURLToPath`（node:url）、`fs`、`path`、`normalizeDatasets`/`resolveLineFromDataType`（from domain.js）
- index.js 改动：删 4 个定义，加 import。index.js L727-728（deployDataFiles 内部）引用 PORTAL_INBOX，须 import 回来。
- tests/ 影响：零新增。

### 第 8 步：server/task_input.js（依赖 portal_inbox + remote_exec + domain + upload.js）

- 搬出：`remoteTaskInput`、`uploadPreparedFigureScripts`、`deployDataFiles`
- 内部依赖：`projectLineDir`/`PROJECTS_ROOT`（from domain.js）、`runRemoteRaw`/`runRemote`（from remote_exec.js）、`runSync`（from proc.js）、`remoteRawPath`/`deployedRawName`（from upload.js）、`PORTAL_INBOX`（from portal_inbox.js）
- index.js 改动：删 3 个定义，加 import
- tests/ 影响：零新增。

### 搬迁后行数估算

index.js 当前 877 行。待搬符号及其注释共计约 575 行。搬出后约 302 行，满足 < 400 行判据。

## 6. 存疑与未查清的点

1. tests/portal_auth.test.js L123 和 L237 使用 `PORTAL_INBOX` 环境变量名（不是 index.js 中的 `PORTAL_INBOX` 常量），是 portal 自己的收件箱目录环境变量，与 index.js 的 `PORTAL_INBOX` 常量无符号级依赖。
2. tests/portal_resolve_parity.test.js L84 也用 `PORTAL_INBOX` 环境变量名，同样不依赖 index.js 的常量。
3. `lineFromPipeline` 不在搬迁范围（P3 文档第六节明确不在搬迁表中），但 tests/pipeline_line_infer.test.js L78-82 扫 index.js 源码断言 `modToScriptMap()` 在该文件中出现。只搬探针入口不搬实现的方案下此守卫不受影响。若搬实现，此守卫须扩并集。
4. `json` 和 `uploadError` 的处置需在动手前裁定：留在 index.js 可零改动地继续由 routeCtx 注入；搬走则要改 6 个路由模块的 routeCtx 约定或加 re-export。建议留 index.js（与 P3 文档第六节一致：json/uploadError 列在"留 index.js"行）。
5. `resolveProjectParam` 和 `listFiguresForLine` 在 index.js L813 和 L820 被 createServer 闭包直接调用（不在 routeCtx 里取），搬走后 index.js 必须自己 import 它们。这是搬 query_views.js 时唯一需要同步改 index.js 调用点的地方。
6. server/report.js（L31）和 server/selfcheck.js（L259）各自定义了独立的 `REPO_ROOT` 常量，与 index.js 的 `REPO_ROOT` 不共享，不因搬迁受影响。
7. `routeCtx` 对象本身在 L768 定义，内含全部被注入的符号引用。任何搬迁后 index.js 仍须能引用这些符号来构造 routeCtx，因此 index.js 都要 import 它们回来。
