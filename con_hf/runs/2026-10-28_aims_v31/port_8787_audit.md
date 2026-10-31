# 8787 端口冲突只读侧车审计

日期：2026-10-28  
审计时刻：2026-10-28 01:09:21 +08:00  
审计方式：本地静态代码检查、现有测试检查、当前端口状态读取、无服务启动

## 一、结论

1. 当前 `127.0.0.1:8787` 没有工作台服务。端口由 `verge-mihomo.exe` 进程持有，状态为 TCP `Bound`，不是 `Listen`。
2. `curl.exe --noproxy '*'` 访问 `http://127.0.0.1:8787/api/health` 直接连接失败。现有 `con_hf/runs/2026-10-28_aims_v31/STATUS.md` 还记录了 Node 实测 `EACCES 127.0.0.1:8787`。
3. 代理规则的环回旁路已经是现状：当前进程环境包含 `NO_PROXY=localhost,127.0.0.1`，`ops/sync_daemon.ps1` 也强制设置同一旁路。旁路只能防止本地请求误入 `127.0.0.1:7890`，不能释放 `verge-mihomo.exe` 持有的 8787。
4. 最安全且可完全自动化的技术侧车方案是临时使用 `BAD_PORT`，例如 18787，并配合 `NO_PROXY` 和 `BIO_WORKBENCH_BASE`。该方案能验证服务、鉴权、API、构建产物和 Sync 客户端，但不能冒充 8787 已上线。
5. v3.1 的 G7 与 `DOD-CORE-04` 明确要求 8787 双活。若要按字面口径收口，必须由用户决定调整 mihomo 的端口或临时停止其对 8787 的占用。用户释放端口后，项目侧的绑定、探活和自检可以自动化。
6. 当前不能执行 `ops/serve_guard.ps1`。它会强制清理端口监听者，并拉起工作台、8080 门户和 frpc，不符合本轮“不杀用户进程、不启动长期服务”的约束。

## 二、当前端口事实

| 项目 | 实测 |
| --- | --- |
| 端口 | 8787 |
| 本地地址 | `0.0.0.0` |
| 状态 | TCP `Bound` |
| 占用 PID | 33064 |
| 进程名 | `verge-mihomo` |
| `Get-NetTCPConnection -State Listen -LocalPort 8787` | 空 |
| `Get-NetUDPEndpoint -LocalPort 8787` | 空 |
| HTTP 探活 | `curl: (7) Failed to connect` |
| 已有运行记录 | Node 绑定 8787 返回 `EACCES` |

当前候选临时端口 18787、18788、18789、18987 均无 TCP 占用，但临时端口不应依赖固定字面量。自动化验收时应让运行器选择空闲端口，或在启动前重新确认目标端口为空。

## 三、启动与守护链路

### 3.1 `start_workbench.bat`

- 第 19 行只搜索 `netstat` 中的 `LISTENING`。当前 8787 是 `Bound`，不会被识别为占用。
- 第 44 行固定打印 `http://127.0.0.1:8787/`。
- 第 48 行直接运行 `node server\index.js`，没有启动后探活，也没有在 Node 提前退出时给出精确诊断。
- 脚本没有显式接收端口参数。调用者若事先设置 `BAD_PORT=18787`，Node 会继承该环境变量并监听 18787，但脚本仍检查并展示 8787，容易形成“服务在另一端口、提示仍在旧端口”的错位。
- 当前状态下运行该脚本，预检会放行，随后 Node 绑定 8787 失败。它不能被当作 8787 的自动恢复手段。

### 3.2 `ops/serve_guard.ps1`

- `Test-HttpOk` 只验证 8787 的 HTTP 健康接口，当前会返回失败。
- `Stop-PortOwner` 通过 `Get-NetTCPConnection -State Listen` 找 owner，再执行 `Stop-Process -Id ... -Force`。
- 当前 mihomo 持有的是 `Bound`，不是 `Listen`。守护脚本大概率找不到 owner，因此无法释放端口，也不会识别真正的占用者。
- 如果 mihomo 转为 `Listen`，同一函数会直接杀掉该用户进程。这个自动行为违反本轮约束，不能运行。
- `Start-Workbench` 强制设置 `BAD_PORT=8787`，不支持临时端口参数。
- `Start-Process` 后立即写日志“已拉起”，没有等待子进程退出码，也没有等待 `/api/health` 返回 200。Node 启动失败时，守护记录与实际状态可能不一致。
- `Stop-PortOwner 8080` 对门户进程有同样的强杀语义，进一步说明守护脚本不适合作为本轮无副作用探针。

### 3.3 `BioanalysDesktop/server/index.js`

- 第 67 行支持 `BAD_PORT`，默认值为 8787。
- 第 2231 行仅监听 `127.0.0.1`，符合环回绑定要求。
- 第 725 行的 `/api/health` 在鉴权判断之前，适合做自动探活。
- 静态检查未发现 `server.on('error')` 或 `EADDRINUSE`、`EACCES` 的显式处理。端口绑定失败时没有自动换端口，也没有结构化错误报告。
- 因为入口本身支持 `BAD_PORT`，临时端口验收不需要修改服务代码。

### 3.4 Sync 与 Vite 路径

- `ops/sync_daemon.ps1` 默认 `WorkbenchBase=http://127.0.0.1:8787`，但支持 `BIO_WORKBENCH_BASE` 覆盖。临时端口验收可无改文件地把 Sync 客户端指向 18787。
- `ops/sync_daemon.ps1` 第 45 至 46 行强制把 `NO_PROXY` 和 `no_proxy` 设为 `127.0.0.1,localhost`。
- `BioanalysDesktop/vite.config.js` 第 18 行把开发代理硬编码到 8787。临时端口下，`npm run dev` 的前端开发代理不可直接使用。
- 生产 `dist` 由 Node 服务自身托管，因此浏览器访问临时端口上的构建产物可行，不依赖 Vite 开发代理。

### 3.5 现有测试

- `BioanalysDesktop/tests/index.test.js` 使用 `freePort()` 和 `BAD_PORT` 启动真实子进程，验证 `/api/health` 与入口稳定性。此测试不会绑定 8787。
- `BioanalysDesktop/tests/auth.test.js` 同样使用动态空闲端口，验证 health 免鉴权和业务接口鉴权。
- 多个 API、上传、工作流和适配测试也已采用 `freePort()` 加 `BAD_PORT`。
- `BioanalysDesktop/tests/bat_launchers.test.js` 只验证三个 `.bat` 的 CRLF 与 `.gitattributes`，没有覆盖端口占用、`Bound` 状态、启动失败或错误提示。
- 未发现针对 `ops/serve_guard.ps1` 的自动化测试。
- `portal_sync.test.js` 与 `wp33_sync_real_mode.test.js` 只静态断言 Sync 脚本包含环回 `NO_PROXY`，不验证 8787 端口冲突。
- `cn_debug` 中仍有多个一次性验证脚本硬编码 `http://127.0.0.1:8787`。它们不阻塞动态端口单测，但不能直接复用于临时端口 Final Gate。

## 四、三种方案比较

| 方案 | 能否自动化 | 是否需用户决策 | 能否完成 G7 的 8787 字面验收 | 主要风险与边界 |
| --- | --- | --- | --- | --- |
| A. 临时换端口 | 可以，使用 `BAD_PORT`、动态探活和 `BIO_WORKBENCH_BASE` | 不需要修改代理；是否接受“非 8787 侧车结论”需要主控决策 | 不能 | 可完成服务与 Sync 技术验收，但不满足 8787 双活；bat、guard 和 Vite 开发代理仍硬编码 8787 |
| B. 既有代理规则显式旁路 | 可以，当前已有 `NO_PROXY`，也可用 `curl --noproxy '*'` | 仅浏览器或 mihomo 规则变更需要用户决策 | 不能 | 只避免请求走代理，不释放端口，不改变 bind 冲突；当前旁路已存在但 8787 仍不可用 |
| C. 用户侧释放 8787 | 用户动作不能由本项目自动化；释放后的绑定、探活和自检可以自动化 | 必须 | 能 | 涉及用户代理配置或进程状态；必须由用户明确授权，项目侧不得杀进程或改代理配置 |

### 4.1 方案 A，临时换端口

推荐用途：当前 v3.1 收口的侧车验证、API 回归、鉴权回归、构建产物探活、Sync 客户端指向验证。

已有证据：

- `con_hf/runs/2026-10-28_aims_v31/adapted_task/REPORT.md` 记录了通过隔离的 18787 编排面提交任务，K40 台账为 `status=completed`、`exit_code=0`。
- 现有 Node 入口测试和鉴权测试已证明 `BAD_PORT` 路径可用。

不能做什么：

- 不能把 G7 标记为通过。
- 不能证明 `start_workbench.bat` 或 `serve_guard.ps1` 在当前环境能安全启动 8787。
- 不能让 Vite 开发代理和所有硬编码 8787 的一次性脚本自动适配。

### 4.2 方案 B，环回显式旁路

当前环境已经配置：

```text
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1
```

结论：

- 对端到端本地请求，旁路是必要卫生措施，但不是端口冲突解决方案。
- 即使请求完全绕过代理，8787 仍由 mihomo 持有，工作台仍无法绑定。
- 若只修改代理客户端规则，项目状态没有变化，v3.1 G7 仍保持阻塞。

### 4.3 方案 C，用户释放端口

这是唯一能满足 8787 字面门禁的路径。

用户可选动作：

- 把 mihomo 的监听端口改到其他端口。
- 临时停止 mihomo 对 8787 的绑定。
- 若 8787 是某个代理规则或转发入口，由用户在代理侧重新规划端口。

项目侧不能代替执行的动作：

- 修改用户代理配置。
- 杀掉 PID 33064。
- 修改系统代理或 mihomo 配置。
- 使用强制端口预留绕过用户软件。

## 五、建议的安全验收序列

本章是后续方案，本轮没有执行。

### 5.1 当前环境下的临时端口侧车

1. 使用系统空闲端口，或在启动前再次确认目标端口没有任何 TCP 占用。
2. 在临时 PowerShell 进程中设置：

```powershell
$env:NO_PROXY = 'localhost,127.0.0.1'
$env:no_proxy = 'localhost,127.0.0.1'
$env:BAD_PORT = '18787'
```

3. 在 `BioanalysDesktop` 目录启动一个受控的短生命周期进程：

```powershell
node 'server/index.js'
```

4. 轮询：

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:18787/api/health' -UseBasicParsing -TimeoutSec 5
```

5. 验证端口只监听环回地址：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 18787
```

6. 只停止本次自动化创建并记录了 PID 的 Node 进程。禁止按端口杀 owner。
7. 如验证 Sync，显式设置：

```powershell
$env:BIO_WORKBENCH_BASE = 'http://127.0.0.1:18787'
```

8. 报告结论写为“临时端口侧车通过”，不得写为“8787 已上线”。

### 5.2 用户释放 8787 后的正式验收

1. 用户确认 mihomo 已释放 8787，且明确授权启动工作台。
2. 先读端口，确认无任何 TCP 占用，包括 `Bound`、`Listen` 和其他非标准状态。
3. 设置环回旁路和 `BAD_PORT=8787`。
4. 启动受控工作台进程，轮询 `/api/health`。
5. 验证 8787 只监听 `127.0.0.1`。
6. 执行 `/api/selfcheck` 及 v3.1 规定的门禁。
7. 只有在已确认当前 listener 是本项目工作台后，才可考虑运行守护脚本。当前守护脚本缺少 owner 指纹和绑定失败诊断，不建议在收口阶段直接依赖。

## 六、自动化边界

可以自动化：

- 临时端口选择。
- `BAD_PORT` 启动与进程 PID 记录。
- `NO_PROXY` 注入。
- `/api/health` 与 `/api/selfcheck` 轮询。
- 监听地址、状态和 owner 读取。
- `BIO_WORKBENCH_BASE` 指向临时端口后的 Sync 验证。
- 动态端口 Node 测试。
- 用户释放端口后的 8787 绑定与门禁验证。

必须由用户决策：

- 是否调整 mihomo 端口。
- 是否临时停止 mihomo 对 8787 的占用。
- 是否接受临时端口侧车结论作为收口中间证据。
- 是否修改浏览器或系统级代理规则。

不得自动化：

- 杀 PID 33064 或其他用户代理进程。
- 修改用户代理配置。
- 以强制占用或抢占方式取得 8787。
- 在未确认 owner 的情况下按端口杀进程。

## 七、发现的测试与设计缺口

1. `serve_guard.ps1` 缺少端口参数、owner 白名单、进程指纹、启动就绪断言和绑定失败分类。
2. `start_workbench.bat` 只识别 `LISTENING`，遗漏 `Bound` 和其他持有状态。
3. `bat_launchers.test.js` 只覆盖换行符，不覆盖端口冲突和启动失败。
4. `server/index.js` 没有显式 `error` 事件处理，无法区分 `EADDRINUSE`、`EACCES` 和普通启动失败。
5. Vite 开发代理硬编码 8787，临时端口模式只能依赖构建后的 Node 托管页面。
6. 部分历史 `cn_debug` 脚本硬编码 8787，不能直接纳入临时端口 Final Gate。

本轮按只读约束未修改上述任何文件。

## 八、对 v3.1 收口的判定

- 8787 当前不可用，G7 仍未关闭。
- 临时端口可以提供有效的 API、鉴权、构建产物和 Sync 侧车证据，但不能替代 8787 双活门禁。
- 在用户明确释放 8787 前，不应执行 `ops/serve_guard.ps1`，不应杀 `verge-mihomo.exe`，不应修改代理配置。
- 若用户不接受释放 8787，v3.1 只能保留“技术侧车通过、正式 G7 阻塞”的状态，不能标记 Final Gate 完成。

## 九、本轮执行边界

已执行：

- 读取启动器、守护脚本、服务入口、依赖配置、现有测试与相关证据文件。
- 读取 8787 当前 TCP 状态和占用进程名。
- 使用 `curl.exe --noproxy '*'` 做一次无凭证健康探活，连接失败。
- 读取当前代理环境变量，未记录任何凭证。

未执行：

- 未启动工作台、门户或 frpc。
- 未运行会启动长生命周期子进程的测试。
- 未连接 K40 或其他远端。
- 未修改代理配置。
- 未杀任何进程。
- 未执行 `ops/serve_guard.ps1`。

## 十、证据入口

- `ops/serve_guard.ps1`
- `start_workbench.bat`
- `BioanalysDesktop/server/index.js`
- `BioanalysDesktop/vite.config.js`
- `ops/sync_daemon.ps1`
- `BioanalysDesktop/tests/index.test.js`
- `BioanalysDesktop/tests/auth.test.js`
- `BioanalysDesktop/tests/bat_launchers.test.js`
- `BioanalysDesktop/tests/portal_sync.test.js`
- `BioanalysDesktop/tests/wp33_sync_real_mode.test.js`
- `con_hf/runs/2026-10-28_aims_v31/STATUS.md`
- `con_hf/runs/2026-10-28_aims_v31/adapted_task/REPORT.md`

## 十一、后续落地

2026-10-28 已新增 `ops/port_preflight.ps1`：

- 按全部 TCP 状态读取占用者，不只看 `Listen`。
- 通过进程命令行白名单判断是否为项目自己的 Node 服务。
- `foreign` 与 `error` 一律 `safe_to_stop=false`。
- 退出码：`0=free`、`10=expected`、`20=foreign`、`2=error`。

`start_workbench.bat` 与 `start_portal.bat` 已改为调用预检，不再用 `netstat` 只筛 `LISTENING`。

`ops/serve_guard.ps1` 已改为：

- 停止进程前先过 owner 白名单。
- 外部进程占用时打印 `pid/name/state` 并拒绝清理。
- 新增 `-DryRun`，只做决策和日志，不启动服务。

实测：

- `8787` 为 `foreign`，owner `verge-mihomo.exe`，PID 33064，状态 `Bound`，`safe_to_stop=false`。
- `8080` 同时存在 `Weixin.exe` 的 Bound 套接字与项目 `node.exe` 的 Listen 套接字。
- `serve_guard.ps1 -Once -DryRun` 明确拒绝清理 8787 外部进程，未启动 frpc 或其他服务。

证据：`con_hf/runs/2026-10-28_aims_v31/port_guard_live.txt`

正式 G7 仍需用户释放或迁移 8787 占用，代码侧不会再误杀未知进程。

