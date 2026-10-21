# P11 自检第 4 维 SHA256 一致性比对 交付报告

- 日期：2026-10-21
- 执行人：teammate s30-upload
- 任务来源：Lead 直接派发（P11，自检第 4 维补 aims §三.3 的 SHA256 条款）
- 权威口径：con_hf/SPEC_DECISIONS.md D-07；con_hf/pitfalls_ledger.md P-04 / P-10；D-08（child_process 默认导入）

## 1. 任务理解

aims §三.3 要求五维自检的第 4 维（隔离同步维）比对「本地与远端核心文件的 SHA256」。此前第 4 维只有三线隔离门禁与桥接脚本在位检查，SHA256 一致性属规格漂移。

本次要补的是一个离线可测的比对器：本地算哈希，ssh 到 k40-ubuntu 跑 sha256sum 取远端值，逐文件比对，并严格按 D-07 四档判定：

- 两端都存在但哈希不同：fail，reason 带两个哈希前 12 位
- 远端文件不存在：warn，reason 写 MISSING
- ssh 不可达或输出缺哨兵：unknown，reason 写 UNREACHABLE / NO_SENTINEL
- 全一致：pass

关键约束：不可达绝不判 fail（一次网络抖动让自检全红会摧毁红灯可信度）；远端输出解析必须逐行匹配 64 位 hex + 空白 + 路径，并先过滤 ssh 的 known_hosts Warning 行（P-04 / P-10）。

## 2. 实现摘要

在 BioanalysDesktop/server/selfcheck.js 追加第 4 维 SHA256 比对段（纯函数 + 一个薄入口），不改既有函数的任何行为：

- 核心文件清单 CORE_SYNC_FILES 固定 4 项：src/bridge_guard.sh 对应远端 src/bridge_guard.sh 与 ops/bridge_guard.sh 两份（母版 + 部署镜像，D-04），ops/check_storage_and_isolation.sh，ops/verify_bridge_checkpoint.py。远端根 /mnt/ssd/bio_data 与 ops/sync_and_verify_remote.ps1 默认值一致。
- buildSha256Command 逐文件生成 if [ -f '<远端路径>' ]; then sha256sum '<远端路径>'; else echo 'MISSING <远端路径>'; fi，结尾 echo 'SHA256END|' 作哨兵；路径清单不走管道（P-08 的 xargs 执行脚本坑在这条命令里不成立）。
- parseSha256Output 逐行解析：先跳过空行与 Warning: Permanently added 行，再匹配 ^([0-9a-fA-F]{64})\s+\*?(.+)$ 与 ^MISSING\s+(.+)$，哨兵行置 sawSentinel。禁止整段锚定正则。
- collectLocalSha256 用 node:crypto 对仓库根相对路径算 SHA256，本地缺失记为 null。
- evaluateSha256Parity 按 D-07 四档判定，优先级 fail > warn > unknown > pass（已测出坏的就报坏，不因别处没测出来而降级）。
- runSha256ParityCheck 是入口：算本地哈希 + 通过默认导入的 childProcess.spawnSync 调 ssh（BatchMode=yes，ConnectTimeout=15，超时 30s），解析输出后返回 {id:'isolation_sha256', label:'隔离同步 SHA256', status, value, detail}，结构与 /api/selfcheck 的 checks 元素一致。

## 3. 文件变更清单

| 文件 | 变更 | 行号锚点 |
| --- | --- | --- |
| BioanalysDesktop/server/selfcheck.js | 新增 node:fs / node:path / node:crypto / node:child_process（默认导入）/ node:url 导入 | :30-34 |
| BioanalysDesktop/server/selfcheck.js | 新增第 4 维 SHA256 段：常量、命令构造、解析、本地哈希、判定、入口 | :243-426 |
| BioanalysDesktop/server/selfcheck.js | REPO_ROOT / SHA256_SSH_TARGET / SHA256_REMOTE_ROOT / SHA256_SENTINEL | :258-266 |
| BioanalysDesktop/server/selfcheck.js | CORE_SYNC_FILES（4 项，含守卫镜像） | :273-278 |
| BioanalysDesktop/server/selfcheck.js | SELFCHECK_STATUSES 四档常量（禁止新造状态名） | :280-281 |
| BioanalysDesktop/server/selfcheck.js | buildSha256Command / parseSha256Output / collectLocalSha256 | :283-333 |
| BioanalysDesktop/server/selfcheck.js | evaluateSha256Parity / runSha256ParityCheck | :335-426 |
| BioanalysDesktop/tests/selfcheck_sha256.test.js | 新建，16 条离线测试 | 全文 253 行 |

git diff --stat 实测：BioanalysDesktop/server/selfcheck.js 为 192 行新增，1 file changed, 192 insertions(+)；测试文件为新增未跟踪文件。

未改动：server/index.js、server/upload.js、server/task.js、server/proc.js、App.tsx、portal/*、ops/*、src/*（均为他人文件域，按要求不碰）。

## 4. 接口与交互实现说明

- 对外新增导出（均为命名导出，不删任何既有导出名）：REPO_ROOT、SHA256_SSH_TARGET、SHA256_REMOTE_ROOT、SHA256_SENTINEL、CORE_SYNC_FILES、SELFCHECK_STATUSES、buildSha256Command、parseSha256Output、collectLocalSha256、evaluateSha256Parity、runSha256ParityCheck。
- 为什么不用 index.js 的 runRemote：runRemote 返回的是 stdout + stderr 拼接后的文本，丢弃了 ssh 退出码（server/index.js:168-178 调 runSync 后只取输出）。D-07 要求「不可达判 unknown」，必须看退出码，所以本检查自己调 childProcess.spawnSync 并读 result.status。
- 为什么 spawnSync 写在 selfcheck.js：接缝必须可被测试替换。按 D-08，用默认导入 childProcess 后调用 childProcess.spawnSync(...)，测试用 mock.method(childProcess, 'spawnSync', ...) 就能拦住，不会真连 K40。这条同时满足 tests/sync_script_guard.test.js:104-114 的静态断言（server 下任何模块不许具名导入 child_process）。
- 状态并入既有四档：只返回 pass / warn / fail / unknown，不新造状态名；返回对象字段与 index.js 里其它 checks 元素同构，前端 src/App.tsx:2187-2193 按 checks 数组渲染，无需前端改动。
- 与既有第 4 维的关系：第 4 维原本一次 ssh 取隔离门禁与桥接在位结果（buildIsolationCommand）。SHA256 比对是第 4 维内的另一项检查，作为独立 checks 元素返回，id 为 isolation_sha256，不改变 evaluateIsolation 的既有判定。

## 5. 测试与验证记录

### 5.1 新增测试文件（16 条，全部离线）

命令与输出：

    cd BioanalysDesktop
    node --test tests/selfcheck_sha256.test.js
    ...
    ℹ tests 16
    ℹ suites 0
    ℹ pass 16
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    EXIT=0

16 条用例与任务要求逐条对应：

1. tests/selfcheck_sha256.test.js:60 CORE_SYNC_FILES 含守卫母版与 ops 镜像、远端路径带部署根
2. :68 buildSha256Command 逐文件 -f 判断、缺失打印 MISSING、结尾带哨兵、不含 | xargs
3. :80 parseSha256Output 正常解析 64 位 hex + 两空格 + 路径，MISSING 单独收集
4. :95 parseSha256Output 混入 Warning 行仍能解析（P-04 / P-10）
5. :108 全一致返回 pass，value 为 4/4 一致
6. :120 哈希不一致返回 fail，detail 同时含本地与远端哈希前 12 位
7. :133 远端 MISSING 返回 warn，detail 含 MISSING
8. :142 ssh 非 0 退出返回 unknown，detail 含 UNREACHABLE，且断言不等于 fail
9. :154 输出缺哨兵返回 unknown，detail 含 NO_SENTINEL
10. :162 空输出返回 unknown
11. :170 本地核心文件缺失返回 unknown，detail 含 LOCAL_MISSING
12. :178 同时存在不一致与缺失时返回 fail（优先级 fail > warn）
13. :189 runSha256ParityCheck 用 mock.method(childProcess,'spawnSync') 垫片返回一致输出，断言 pass，并断言只调一次、程序名 ssh、目标 k40-ubuntu、远端命令含 sha256sum 与哨兵
14. :210 垫片把镜像哈希改掉，端到端返回 fail 且 detail 点名 ops/bridge_guard.sh
15. :230 垫片返回 ssh 退出码 255，端到端返回 unknown 且 detail 含 UNREACHABLE
16. :242 四档名字不漂移：SELFCHECK_STATUSES 严格等于 ['pass','warn','fail','unknown']，四种判定结果都落在集合内

测试垫片说明：第 13-15 条通过 mock.method 拦截 childProcess.spawnSync，未发起真实 ssh；单跑该文件耗时 122ms，无网络等待，可证垫片生效。

### 5.2 全量回归

    cd BioanalysDesktop
    npm test
    ...
    ℹ tests 634
    ℹ suites 0
    ℹ pass 634
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 21464.2148
    NPM_TEST_EXIT=0

634/634 全绿，退出码 0。基线 580+12 条，本次新增 16 条；其余增量来自并行队友的切片。

### 5.3 真机只读探测（不是测试，仅作证据）

命令与输出：

    cd BioanalysDesktop
    node --input-type=module -e "import { runSha256ParityCheck } from './server/selfcheck.js'; const r = runSha256ParityCheck(); console.log(JSON.stringify(r, null, 2));"
    {
      "id": "isolation_sha256",
      "label": "隔离同步 SHA256",
      "status": "pass",
      "value": "4/4 一致",
      "detail": "本地与远端核心文件哈希一致（含 ops/ 镜像）"
    }
    EXIT=0

只做了远端 sha256sum 读操作，未改远端任何文件或环境。当前 K40 上 4 个核心文件与仓库一致。

### 5.4 语法检查

node --check server/selfcheck.js 退出码 0；测试文件由 node --test 正常加载，语法无误。

## 6. 假设与风险

- 假设远端部署根为 /mnt/ssd/bio_data，ssh 目标为 k40-ubuntu。两者与 ops/sync_and_verify_remote.ps1 的默认参数一致；若运维改过 -RemoteRoot 或 -SshTarget，需要同步改 selfcheck.js 的常量（当前没有环境变量入口）。
- CORE_SYNC_FILES 只覆盖 4 项核心文件，不是全量同步清单。全量清单由 ops 脚本负责；自检要的是「核心母版是否漂移」这个信号，文件越多 ssh 往返越慢。
- 守卫镜像（远端 ops/bridge_guard.sh）依赖 ops 同步脚本第 5.5 步执行过。首次部署未跑同步时，该文件可能不存在，此时判 warn（MISSING），符合 D-07 对「缺失」的口径。
- 本地文件缺失判 unknown（LOCAL_MISSING），D-07 未覆盖该情形。理由：本地仓库不完整属于「这次没测出来」，不是「测出来是坏的」，与不可达同档更安全。
- ssh 超时 30s，ConnectTimeout 15s。自检是用户点按钮触发的同步接口，超时上限可接受；若网络极慢可能返回 unknown（不误判 fail）。
- 未跑 npm run build（按要求由 Lead 统一构建）。

## 7. 架构/接口变更建议

1. /api/selfcheck 接线（一行）：index.js 第 4 维 try 块内加 checks.push(runSha256ParityCheck());，并在顶部 import 里追加 runSha256ParityCheck。index.js 属他人文件域，本次未改，需 Lead 或该文件 owner 接线，否则新检查不会出现在界面。
2. 长期建议把「远端命令 + 退出码 + Warning 过滤」收敛成 server 侧公共函数（类似 runRemote 但返回 code/stdout/stderr），第 1、2、3 维也能受益；当前 runRemote 丢退出码，见第 8 节缺陷。
3. 若后续把 CORE_SYNC_FILES 扩到全量清单，建议与 ops/sync_and_verify_remote.ps1 的 Get-DefaultFiles 同源，避免两处清单各自漂移。

## 8. 待主 Agent 决策事项

1. index.js 的接线由谁做：本次严格不越界，未改 index.js。若 Lead 授权，我可以补一行 import 与一行 push，并跑全量回归。
2. 新检查是否要并入第 4 维的单条 check（合并 status）还是作为独立 checks 元素展示。当前实现是独立元素 isolation_sha256，前端会自动多显示一盏灯，改动最小；若要求「第 4 维仍然只有一条」，需要写一个状态合并函数（建议 fail > warn > unknown > pass），这会改变界面灯数。
3. 发现的既有缺陷（不在本次文件域，未修）：
   - server/index.js:168-178 runRemote 丢弃 ssh 退出码。ssh 不可达时 stdout/stderr 都为空，第 1 维 fs_type 会因空串不含 fuse 判 pass，第 2 维 storage 会把 usedPct 当 0 判成 100% free pass，属于「链路断了反而绿灯」。建议后续单独切片修：runRemote 返回 code，第 1/2 维 code !== 0 判 unknown。
   - git status 显示 BioanalysDesktop/tests/aims_landing.test.js 处于删除状态，非本次改动，请 Lead 确认是否有意为之。

## 9. 建议下一步

1. Lead 决定 index.js 接线归属；若授权我改，预计 2 行改动 + 全量回归 1 次。
2. 接线后用真实环境跑一次 GET /api/selfcheck，确认返回里出现 isolation_sha256 且为 pass（当前真机探测已是 4/4 一致）。
3. 另开切片修 runRemote 丢退出码导致第 1/2 维在断链时误判 pass 的问题。
4. 若要覆盖更多核心文件，先与 ops 清单同源，再扩 CORE_SYNC_FILES，并同步补测试断言。
