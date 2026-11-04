# 架构整固专项结项报告（第 1~23 轮）

> **正式结项（2026-11-03 22:40，4 Argon 第二十六轮 Q1 裁定）**
>
> AIMS / BioanalysDesktop 架构整固与交付合拢专项（第 1~26 轮）**圆满结项**。
> 自该裁定起，系统进入**无条件静默待命期（Event-Driven Standby）**：
> 绿灯免报、红灯即报、有单才动。
>
> **里程碑基线（最高水位，不得回退）**：HEAD `f92d70f`｜1354 tests / 1336 pass / 0 fail｜
> `npm run gate:all` 7 道全绿（80 秒）｜30 ready 模板白名单锁死｜52 pending 冻结。
>
> **未来接单的开局三锚点**（新会话无需回溯历史）：
> ① 本文件；② `BioanalysDesktop/README.md` 的根基线行（1354 tests）；③ 当前 HEAD。

> 第二十八轮补录：便携包四层收敛、净化环境实证与 MSYS/PATH 隔离教训见**第九节**。

> 4 Argon 第二十三轮 Q4 裁定：架构整固专项已达收敛点，做最后一次全局对账并封板，
> 严禁无单开垦 52 个 pending 模板。本文件是那次对账的结果，也是移交日常运营的凭据。

## 一、终局基线（2026-11-03）

| 项 | 值 |
|---|---|
| HEAD | 见 `git log -1`（本报告随封板提交） |
| 测试 | **1354 tests / 1336 pass / 0 fail / 18 skipped**（125 个测试文件） |
| 代码规模 | 20120 SLOC（非空行，66 个文件） |
| 台账 | workflows 3 系列 / 54 Mod / 断链 0；图件 82 = 30 ready + 52 pending |
| 设备 | K40 四服务全 run，8022 与 10022 双通，零 SSH 心跳五层全通 |

## 二、八道门禁全绿（收官大合拢实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| **单命令总门禁** | **`npm run gate:all`** | **GATE_ALL_OK 7 道全绿（80 秒）**——八道门禁串成一条命令 |
| 静态语言门禁 | `node ops/static_gate.mjs` | sh 24 / ps1 24 / py 45 / r 16 全部通过（16 个因宿主缺工具跳过，CI 上不跳） |
| 跳过原因白名单 | `npm run test:skip-gate` | 123 个测试文件，全部命中白名单 |
| 运行时 TAP 面 | `node ops/metrics_sync.mjs --check` | 18 条真实跳过全部带白名单原因（复用同一次 TAP，零额外耗时） |
| 台账一致性 | `node ops/ledger_gen.mjs --check` | 54 Mod / 3 系列 / 断链 0 |
| 宿主机依赖 | `node ops/preflight.mjs` | PREFLIGHT_OK 必需项齐备 |
| 交付审计汇总 | `npm run delivery:audit` | AUDIT_SUMMARY_OK 1 次交付 / 1 个项目 / 357 文件 |
| 交付验收 | `npm run delivery:verify -- <tar>` | 四关全绿（真包实测 0.7 秒 VERIFIED 357） |
| 工作区清理 | `npm run clean:workspace` | 演练模式列出 222 MB 候选，磁盘零改动 |

## 二点五、客户盲测预演（仓库外空目录，只用手工命令）

按 Argon 第二十四轮 Q3 裁定，在 `D:\Temp\client_blind_test\client_env`（完全脱离仓库、
PATH 不含 node 与仓库）逐字照 `HOW_TO_VERIFY.txt` 手工执行四步：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 1 包本体 | `sha256sum -c <tar>.sha256` | exit 0，OK |
| 2 解包 | `tar -xzf <tar>` | exit 0，单一一级目录 |
| 3 包内逐文件 | `sha256sum -c CHECKSUMS.sha256` | exit 0，9 个文件全 OK、零 FAILED |
| 4 验签 | `openssl pkeyutl -verify -pubin -inkey ED25519_PUBLIC_KEY.pem -rawin -in CHECKSUMS.sha256 -sigfile CHECKSUMS.sig` | exit 0，`Signature Verified Successfully` |

篡改探针（同样在客户环境、同样只用系统工具）：

- 改图件一个字节 → 第 3 步 `fig1.png: FAILED`，exit 1；恢复后复绿。
- 改 CHECKSUMS 首字节 → 第 4 步 `EVP_DigestVerify: provider signature failure`，exit 1；恢复后复绿。

结论：客户侧零仓库依赖的验真闭环成立，且两条篡改路径都能当场抓住。

## 三、这二十三轮建成了什么

**底座**：三线隔离（GEO bulk / 单细胞 / 空间）的分析编排、图件模板准入、交付打包。

**算力面**：K40 安卓机 Termux + proot 容器四服务，runit 监督，零 SSH 心跳探针，
host key 指纹台账与轮换检测，runsvdir 幂等点火，三卷冷备恢复演练。

**交付链**（本轮重点收口）：

```
preflight（宿主机依赖） → 打包（CHECKSUMS + 签名 + HOW_TO_VERIFY）
   → 内联四关验收（侧车/解包/验签/双向差集）
   → 随包回执 + 脱敏审计流（append-only）
   → 下载门禁（409 ERR_DELIVERY_UNVERIFIED）
   → 客户自助验签（含 openssl -rawin 命令）
   → 交付复盘（audit_summary 只读汇总）
   → 工作区清理（默认演练 + 神圣黑名单）
```

**客户文档双件套**：`HOW_TO_VERIFY.txt`（四步验收单）与 `CLIENT_DELIVERY_GUIDE.md`（使用与验真指南），都由打包器动态渲染、随包生成、受 CHECKSUMS 与签名保护；后者按「四准四不准」口径剥离全部内部术语。

**陌生用户可用性**：五张票全部落地（预检 / 一页式 RUNBOOK / 自助验签单 /
工作区清理 / 缺设备 Mock 横幅）。

## 四、封板声明（不可随意回退）

| 资产 | 状态 | 锁定机制 |
|---|---|---|
| 30 个 ready 图件模板 | **封板** | `ops/figure_ready_allowlist.json` + 集合恒等断言 + 5 条变异 |
| 52 个 pending 模板 | **冻结** | 非真实客户订单点名，不得预制开发（本轮裁定明令） |
| 22 个冻结判据 | **不动** | 判据正本 `docs/figure_pending_triage.md` |
| 交付验收四关 | **唯一真源** | `ops/delivery_acceptance_core.mjs`（ps1 只是委托包装） |
| 审计流落点 | **锁死** | deliverables 根（gitignore 区），仓库 records 仅演练样本 |

## 五、移交后的日常节奏（结项后常态）

```powershell
# 每天开工
node ops/preflight.mjs          # 依赖齐不齐
npm run test:skip-gate          # 跳过写法没有新违规（毫秒级）

# 有真实订单时
cd BioanalysDesktop; npm test   # 全量回归（同一进程里顺带跑运行时 skip 门禁）
node ops/ledger_gen.mjs --check # 台账无断链
# 打包 + 验收 + 回执 + 审计流由 /api/report/build 一条链路内联完成

# 交付复盘
npm run delivery:audit          # 跨项目交付历史只读汇总

# 磁盘清理（默认演练，确认后加 --execute）
npm run clean:workspace
```

## 六、遗留与边界（诚实清单）

1. **52 个 pending 模板**：按裁定冻结，等真实客户点单再单点激活。这不是技术债，是长尾池。
2. **22 个冻结模板**：判据未变，本专项不动。
3. **ubuntu-sshd 的 `got TERM` 残留**：服务是 run，不影响；清掉需重启该服务，收益为零。
4. **本机无 pwsh 7 / R**：静态门禁对这 16 个文件标记「宿主缺工具跳过」，CI 上会实检。
5. **Mock 多边形**：`BIO_COMPUTE_ADAPTER=mock` 时前端有横幅，但 mock 仍只能覆盖传输层，
   真实算力的验证仍必须在 K40 上做。

## 七、这次专项抓到的真缺陷（留档）

| 缺陷 | 教训 |
|---|---|
| `# SKIP` 字面量进了测试标题，被 TAP 当指令读 | 名字里的 TAP 指令记号必须转义 |
| HOW_TO_VERIFY 进 CHECKSUMS 仍被第 4 关当幽灵 | CHECKSUMS 与 manifest 是两套口径 |
| 审计流初版落进 acceptance/ 子目录 | clean 会连带清掉审计历史，必须落 deliverables 根 |
| openssl 命令写成续行被客户复制断掉 | 给客户的命令必须是单行可复制 |
| 审计行字段断言只查「不含某路径」，注入 host_path 存活 | 脱敏必须用字段集合精确恒等 |
| 空目录测试预建了子目录，M5 变异存活 | 断言名要配得上它真正覆盖的形态 |
| 变异恢复放 finally 只跑一次，红用例串味 | 每条变异前必须恢复到干净基线 |

这七条都不是「防未来」，是这把真跑打出来的。留在这里，是因为同样的坑换个人会再踩一遍。

## 八、结项后的状态声明（2026-11-03）

| 项 | 状态 |
|---|---|
| 架构拓展权限 | **封存**——无真实订单不开新支线 |
| 主动汇报 | **停止**——绿灯免报，红灯即报 |
| 30 ready 模板白名单 | **锁定**（`ops/figure_ready_allowlist.json`） |
| 私有 CI | **锁定**（`.github/workflows/ci.yml`，仓库保持私有） |
| 三卷冷备 | **暂缓刷新**（本轮未新装 Tier-1 之外包、未准入模板，按 Argon Q2 判定不动） |
| 《如何接第一张订单》操作单 | **不写**（现有 RUNBOOK + 代码即单一真源，按 Argon Q3 否决） |
| 会话 | **归档封存**（接单时开新会话，用三锚点接手） |

待真实订单到来时，唯一允许变动的受控闸门是：
`ops/figure_ready_allowlist.json`（点名激活 pending 图件，需同步 k40 验证证据进 registry）。

## 九、第二十八轮补录：便携包与四层收敛（2026-11-04）

> 4 Argon 第二十八轮 Q4：正式确认便携包双环境实证圆满成功，体系终局封板，
> 转入事件驱动静默待命期。本节是该轮的行动清单第 2 条（补录终局报告）。

### 9.1 四层收敛实测

| 层 | 内容 | 文件数 |
|---|---|---|
| L1 软件核心 | BioanalysDesktop/ ops/ src/ portal/ shared/ bin/ configs/ tests/ aims/ docs/ .github/ 根级文件 | 618（含前端 dist 3） |
| L1 附加 | 测试依赖闭包（react/react-dom/scheduler/loose-envify/js-tokens/esbuild/@esbuild） | 92 |
| L2 真源资产 | reference/ con_hf/ cn_debug/ local_projects/ deliverables/ | 821 |
| L3 便携运行时 | vendor/tools（node v24.19.0 + MSYS ssh/scp/tar/sha256sum/openssl + 全部 msys-*.dll） | 81 |
| 入口 | 5 个 .cmd 启动器 + 使用说明.md + MANIFEST | 6 |
| **合计** | **dist/portable/BioanalysWorkbench，约 172 MB** | **1526** |

L4 运行时产物不进包：.tmp/ outputs/ projects/ artifacts/ project_data/ node_modules/ .npmcache/ Python/ vendor/ dist/ .git/。

### 9.2 净化环境实证（无 node、无 git、无 ssh 的 PATH）

环境只有包内 runtime + SystemRoot/System32 + Wbem，TEMP/TMP 指向包内 .tmp：

| 判据 | 结果 |
|---|---|
| `gate.cmd`（gate:all 七道） | **GATE_ALL_OK 7 道全绿，11 秒** |
| 全量测试 | **1354 tests / 0 fail**，63 条跳过全部命中 8 类白名单原因 |
| 交付验收四关（包内样例包） | **DELIVERY_ACCEPTANCE_OK**：sidecar `b5c74f06…`、unpack 解出 PRJ_NAFLD_E2E_20261028_Client_Delivery、signature VERIFIED 112、set_equality 业务 111 全在清单、counts 合计 117 |

对比开发机同轮基线：GATE_ALL_OK 7 道全绿 78 秒，1354 tests / 1336 pass / 0 fail / 18 skipped。
两环境 fail 都是 0，pass/skip 的分配差来自宿主能力（无 git/无 pwsh/无设备），不是行为差。

### 9.3 这轮抓到的真缺陷（都已修并有提交）

| 缺陷 | 后果 | 修法 |
|---|---|---|
| `cn_debug/lib/chain_runner.mjs` 被 `.gitignore:160 cn_debug/` 忽略 | 6 个测试 import 它，**新克隆与便携包本身跑不过** | `.gitignore` 改 `cn_debug/*` + `!cn_debug/lib/`，入库该文件 |
| `cn_debug/2026-10-22_m1_line2_rest.mjs` 同样被忽略 | chain_runner_lib.test.js:28 第 4 个输入 ENOENT | `git add -f` 入库 |
| `portal/inbox/` 由测试与运行时非递归 `mkdirSync` 创建 | 新克隆缺目录，收件箱两条用例 ENOENT | portal_inbox.js 加载时 `mkdirSync(…, {recursive:true})` |
| `ops/metrics_sync.mjs` 的 BASELINE_RE 贪婪匹配吞掉行尾 | README 基线行累积 6 层重复尾巴（超 800 字符） | 正则去掉尾部 `\*\*`，只替换整行 |
| 跳过原因白名单只有 6 类 | 无 git / 无 pwsh 的干净 Windows 上跳不过门禁 | 扩到 8 类，新增 `HOST_MISSING_GIT` 与 `HOST_MISSING_SHELL`，并给相关用例加前置 guard |

### 9.4 MSYS/PATH 隔离教训（换机器会再踩）

1. vendor 的 MSYS `ssh.exe` **不读 Windows 用户 `~/.ssh/config`**（它去找 `/etc/ssh/ssh_config`），
   且把 `~/.ssh/id_ed25519` 展开成 POSIX 家目录 `/home/<user>`；必须显式 `-F <config 绝对路径> -i <私钥绝对路径>`。
   `ops/toolchain.mjs` 的 `resolveSshArgs()` 已封装该拼装。
2. 单拷 `ssh.exe` 会报 `0xC0000135`（DLL 未找到），必须整批复制 `msys-*.dll`（74 个，34 MB）。
3. 把 vendor 顶到 PATH 首位会打红 4 个测试文件的 argv 全等断言（共 52~54 条），
   因此 toolchain **只做显式路径解析，不改 PATH**；包内自足由 runtime/ 目录保证。
4. TEMP/TMP 必须指向包内 `.tmp`，否则 node 落回系统临时目录，在受限环境成片 EPERM。

### 9.5 Argon 第二十八轮四条裁定（存档）

| 问 | 裁定 | 落地 |
|---|---|---|
| Q1 vendor 128 MB 是否入库 | **绝对禁止**；本地受控缓存 + 构建时按需组装 + 清单校验 | `vendor/` 整目录进 .gitignore；`docs/vendor_assembly.md` 给组装步骤；构建器缺件点名拒绝 |
| Q2 便携 `--verify` 是否进日常 CI | 不进；属发布期或本地封板前置门禁 | `.github/workflows/ci.yml` 只跑 gate:all，不含 portable 步骤 |
| Q3 升级方式 | 整包重发 + MANIFEST 校验，拒绝内置自更新脚本 | 构建器产出 MANIFEST.sha256；无自更新代码 |
| Q4 是否结项 | 正式确认，终局封板，转静默待命 | 本节 |

静默待命期唯一允许的主动动作：八道门禁报警、真实订单、或用户点名。
待真实订单到来时，唯一允许变动的受控闸门仍是 `ops/figure_ready_allowlist.json`。
