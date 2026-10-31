# 踩坑与故障复盘台账（pitfalls_ledger）

> 物理落点：本文件（aims §八 台账④）。
> 分工：本文件记「坏了怎么修、怎么防复发」；架构层面的取舍记 con_hf/SPEC_DECISIONS.md；
> 长历史细节仍记 con_hf/踩坑台账.md（#序号），本文件用 P 编号并在条目里互链。
> 纪律：任何测试红灯、真机非 0 退出码的修复闭环后，必须回写一条并给出防回归单测路径。
> 编号连续，不回收不复用，追加到末尾。

字段顺序固定：编号 / 所属域 / 现象与复现条件 / 根因分析(RCA) / 永久修复方案 / 防回归单测用例路径。

---

## P-01 CRLF 换行让 awk 数值比较退化成字符串比较

- **所属域**：Line1/2/3 母版（Linux 侧）
- **现象与复现条件**：脚本在 Windows 上编辑保存后推到 K40，awk 里 if ($3 > 100) 之类的数值比较出现「1000 小于 200」这类诡异结果，阈值过滤整体失效但不报错。
- **RCA**：CRLF 的 \r 留在字段末尾，awk 认为该字段是字符串而非数值，比较按字典序进行。
- **永久修复方案**：Linux 侧所有 .sh/.py/.R 强制 LF；同步脚本在传输前逐字节检查 CRLF 并直接拒绝（Test-LfOnly）。
- **防回归单测用例路径**：BioanalysDesktop/tests/sync_script_guard.test.js（断言同步脚本保留 LF 校验步骤）；详见 con_hf/踩坑台账.md #103。

## P-02 Rscript --vanilla 静默跳过 R_PROFILE_USER，出图模板失效

- **所属域**：Server（任务下发）/ Line 母版
- **现象与复现条件**：客户在需求单选了 plot_layout_config，图仍然按母版默认版式出，日志无任何报错。
- **RCA**：母版统一写 Rscript --vanilla，而 --vanilla 会跳过 R_PROFILE_USER，导致模板挂载点（Rprofile）不加载。
- **永久修复方案**：任务脚本在 PATH 最前插入 Rscript 垫片，把 --vanilla 降级为等价组合并保留 user profile（server/task.js 的 layout_autoload 机制）。
- **防回归单测用例路径**：BioanalysDesktop/tests/layout_inject.test.js。详见 con_hf/踩坑台账.md #169。

## P-03 taskset 静态绑核在 Android 动态核隔离下 EINVAL，任务直接夭折

- **所属域**：Ops（run_throttled_task.sh）
- **现象与复现条件**：设 BIO_PIN_CPUS=4,5,6 后任务启动即失败，taskset 报 EINVAL；不设则正常。
- **RCA**：Android 动态核隔离下 CPU 集合会变化，静态绑核可能在启动瞬间引用了已被隔离的核。
- **永久修复方案**：绑核失败自动降级为不绑核并打 stdout 留痕（不因绑核失败丢任务）；且默认不绑核（实测不绑核 + 3 线程比绑核快 30% Python / 6-11% R）。
- **防回归单测用例路径**：BioanalysDesktop/tests/run.test.js。详见 con_hf/踩坑台账.md #200。

## P-04 ssh 的 known_hosts 提示混进 stdout，按行首锚定的解析全废

- **所属域**：Server / Ops（所有解析远端输出的地方）
- **现象与复现条件**：ssh 非 tty 时把 Warning: Permanently added ... 打到 stderr，调用方 2>&1 合并后，按行首特征解析的逻辑取不到真实数据（曾把服务状态解析成「服务 Warning FAIL」）。
- **RCA**：假设远端输出是干净的；解析器用行首锚定正则（^[0-9a-f]{64}、^sshd: 等），被 Warning 行顶掉首行。
- **永久修复方案**：① 解析前统一过滤 Warning 行（ops/sync_and_verify_remote.ps1 的 Invoke-Remote）；② 解析一律逐行匹配特征白名单，不用整段正则；③ 判定命令是否成功看退出码，不看输出文本。
- **防回归单测用例路径**：BioanalysDesktop/tests/sync_script_guard.test.js（断言 Warning 过滤存在）；tests/selfcheck_sha256.test.js（混入 Warning 行仍能解析）。详见 con_hf/踩坑台账.md #90。

## P-05 台账回读走 exec 缓冲上限，8KB 处静默截断

- **所属域**：Server（server/run.js）
- **现象与复现条件**：任务日志台账超过 8KB 后前端只看到前半段，没有任何报错，容易被误判为「任务没跑完」。
- **RCA**：用 exec 一次性收集输出受 maxBuffer 限制，超限静默截断。
- **永久修复方案**：改为流式读取（stdin/事件流），并在前端标注「已截断」与总字节数。
- **防回归单测用例路径**：BioanalysDesktop/tests/run.test.js（大输出用例）。

## P-06 测试端口硬编码 18787，并行跑测试互相抢端口

- **所属域**：Server（测试基础设施）
- **现象与复现条件**：两个测试文件同时起服务时报 EADDRINUSE，或被连到别人的服务上导致断言随机红。
- **RCA**：端口写死在测试里，测试并行时冲突。
- **永久修复方案**：统一用 freePort / PORT=0 由内核分配，再从 server.address().port 读实际端口（P5 切片进一步把 portal 测试也改成 PORTAL_PORT=0）。
- **防回归单测用例路径**：BioanalysDesktop/tests/portal_inject.test.js（PORTAL_PORT=0 起服务）、tests/index.test.js。

## P-07 具名导入 child_process 让测试垫片失效，测试真连 K40 写了探针文件

- **所属域**：Server（进程执行接缝 server/proc.js）
- **现象与复现条件**：P4 切片写 HTTP 级 POST /api/upload/complete 用例，用 mock.method(childProcess, spawnSync|spawn) 垫片，实测完全没拦住，测试真跑了 scp + ssh，往 /mnt/ssd/bio_data/projects/default/line1_bulk/raw_data/ 写入 reserve_complete.txt 与 probe_complete.txt（各 5 字节）。
- **RCA**：server/proc.js 写 import { spawn, spawnSync } from node:child_process，具名绑定在模块链接期固化，测试替换 module.exports 属性对已绑定的本地引用无效。
- **永久修复方案**：接缝统一改默认导入 + 属性调用（import childProcess from node:child_process，调用 childProcess.spawn / childProcess.spawnSync），一处改动让全部垫片真生效；两个探针文件已从远端删除。铁律见 SPEC_DECISIONS D-08。
- **防回归单测用例路径**：BioanalysDesktop/tests/sync_script_guard.test.js（静态断言 proc.js 不许出现具名导入 child_process）；tests/upload_reserve.test.js（改用不触网的目录级用例）。

## P-08 把带引号的路径清单直接管道给 xargs，shell 会去执行这些脚本

- **所属域**：Ops（sync_and_verify_remote.ps1）
- **现象与复现条件**：远端对账命令写成 路径1 路径2 | xargs sha256sum，实测 bridge_guard.sh 报 Permission denied、run_throttled_task.sh 被无参执行，且所有文件被判「远端无回读」。
- **RCA**：管道左端是命令而不是数据源，shell 逐条执行这些路径；xargs 收到的是它们的 stdout（空），于是哈希全是空内容的 e3b0c442...。
- **永久修复方案**：必须先 printf %s\n 输出路径再管道给 xargs；同步脚本里已加注释写明「改前务必保留 printf」。
- **防回归单测用例路径**：BioanalysDesktop/tests/sync_script_guard.test.js（断言 printf 存在、断言路径清单不直接接管道）。

## P-09 scp 不带 -p 丢执行位，母版按名字调用 ops 脚本直接 Permission denied

- **所属域**：Ops（部署与同步）
- **现象与复现条件**：同步后远端 ops/*.sh 权限为 0644（实测 03_check_logs_remote.sh、bio_watchdog.sh、fix_runsvdir.sh 等），而母版与 run_throttled_task.sh 是按名字直接调用（不带 bash 前缀），执行即 Permission denied。
- **RCA**：scp 默认按 umask 新建文件，不保留源权限位。
- **永久修复方案**：同步脚本 scp 之后立刻按后缀归一化权限（.sh → 755，其余 → 644），镜像文件同样 chmod 755；并在输出里显式声明已归一化。
- **防回归单测用例路径**：BioanalysDesktop/tests/sync_script_guard.test.js（断言 chmod 归一化步骤存在）。

## P-10 镜像哈希校验用整段正则，被 ssh Warning 行顶掉首行

- **所属域**：Ops（sync_and_verify_remote.ps1 第 5.5 步）
- **现象与复现条件**：主清单 18/18 一致，但镜像 ops/bridge_guard.sh 恒判「哈希不一致」，远端手工 sha256sum 两个文件哈希其实相同。
- **RCA**：Invoke-Remote 把 stderr 合并进输出，整段文本以 Warning 行开头，^([0-9a-f]{64}) 锚定首行必然失败；同一文件用逐行解析的 Read-RemoteHashes 就正常。
- **永久修复方案**：镜像校验也复用逐行解析函数（按相对路径取 Map 值），并在 Invoke-Remote 层过滤 Warning 行（与 P-04 同一修法）。
- **防回归单测用例路径**：BioanalysDesktop/tests/sync_script_guard.test.js（断言镜像校验走 Read-RemoteHashes、断言不许用整段锚定正则解析哈希）。

## P-11 部署布局与仓库布局不同，母版相对路径找不到 bridge_guard.sh

- **所属域**：Line2/3 母版 + Ops（部署）
- **现象与复现条件**：仓库里 src/<线>/scripts/<step> 的 ../../bridge_guard.sh 指向 src/bridge_guard.sh 正常；部署后母版在 /mnt/ssd/bio_data/bin/<线>/<step>，同一相对路径指向 /mnt/ssd/bio_data/bridge_guard.sh，守卫静默不生效。
- **RCA**：仓库层级（src/）与部署层级（bin/<线>/ 由 PATH 解析）差一层，相对路径不可移植。
- **永久修复方案**：母版按候选列表解析（相对路径 → /mnt/ssd/bio_data/ops/bridge_guard.sh → /mnt/ssd/bio_data/bridge_guard.sh），全找不到打印 [BRIDGE SKIP] 放行并留痕；同步脚本额外把守卫镜像到远端 ops/。裁定见 SPEC_DECISIONS D-04。
- **防回归单测用例路径**：BioanalysDesktop/tests/bridge_stage.test.js（候选路径静态断言 + 输入源解析块真跑）。

## P-12 桥接四项断言写成空转：58 个母版 0 次调用

- **所属域**：Line1/2/3 母版
- **现象与复现条件**：ops/verify_bridge_checkpoint.py 存在且有单测，但 grep 全部母版发现没有任何脚本真正调用它，等于规格写了、机制没接线。
- **RCA**：先建工具后接线，接线这一步没有落点表也没有断言兜底。
- **永久修复方案**：在 server/task.js 的任务脚本里集中接线（inspectBridgeNeed 判定 R/Python 双语步骤 → 下发前跑 runBridgeCheckSync），并用不变量测试钉住「每条双语母版都必须有守卫调用」。
- **防回归单测用例路径**：BioanalysDesktop/tests/bridge_guard_invariant.test.js（9 条）、tests/bridge_checkpoint.test.js、tests/task_comment_strip.test.js。

## P-13 文档点名的运维脚本根本不存在，交付链断在最后一步

- **所属域**：Ops / 交付
- **现象与复现条件**：docs/delivery_package_spec.md 指定用 ops/09_package_delivery.ps1 打包，实际仓库里没有该文件，交付只能手工执行零散命令。
- **RCA**：文档先行、实现缺位，且没有「文档点名文件必须存在」的巡检。
- **永久修复方案**：交付打包能力收敛到既有链路（build_client_report.py + write_checksums + report.js 四道闸），文档改为指向真实落点；台账类文档点名路径一律纳入防漂移断言。
- **防回归单测用例路径**：BioanalysDesktop/tests/aims_drift_guard.test.js（条款点名文件必须存在）、tests/report.test.js。

## P-14 规格口径与实现不一致：5MB 分片断点续传 vs 4MB 无续传

- **所属域**：Server（上传）
- **现象与复现条件**：aims 与页面文案声称 5MB 分片且支持断点续传，实测 CHUNK_SIZE = 4MB 且前端每次从 chunk 0 重传，弱网下大文件反复重来。
- **RCA**：文案按设计意图写，实现按当时最简单路径写，两者没有对齐机制。
- **永久修复方案**：分片大小统一由 shared/data_formats.mjs 单一事实源提供（4MB），页面文案由注入值生成；续传能力按 uploadId 查已落盘分片列表（listChunks）跳过已传分片。
- **防回归单测用例路径**：BioanalysDesktop/tests/upload_resume.test.js、tests/upload_session.test.js、tests/data_format_parity.test.js。

## P-15 桥接守卫从计算容器里 ssh 自己 → 断言恒 SKIP

- **所属域**：Line1/2/3 母版 / 桥接守卫
- **现象与复现条件**：在 k40-ubuntu 容器内执行母版（真实主路径），日志出现 `ssh: Could not resolve hostname k40-ubuntu: Name or service not known` 紧跟 `[BRIDGE SKIP] ... 桥接引擎不可达（ssh 退出码 255）`，母版 exit 0。PC 侧直连跑则看不出问题。
- **RCA**：守卫默认只实现了 ssh 通道，而它自己的运行位置就在远端计算容器里 : 容器内没有 k40-ubuntu 这个主机名，于是「远程校验远端文件」这条设计在主路径上必然失败；失败又被契约 3 静默降级为 SKIP，无人报警。
- **永久修复方案**：本机优先 + ssh 兜底（D-14）。`BRIDGE_ENGINE_LOCAL` 默认指向容器内引擎落点；OK 文案带 `engine=local|ssh` 便于日志取证；母版侧守卫候选路径列表覆盖仓库布局与部署布局两种（`$(dirname $0)/../../bridge_guard.sh` → `/mnt/ssd/bio_data/ops/` → `/mnt/ssd/bio_data/`）。
- **防回归单测用例路径**：BioanalysDesktop/tests/bridge_guard_local.test.js（本机优先、ssh 兜底、置空强制 ssh、契约 3b/3c 静态断言）；真机验收命令见 D-14。

## P-16 自检 runRemote 丢弃 ssh 退出码 → 断链时假绿灯

- **所属域**：Server（自检）
- **现象与复现条件**：拔掉 K40 或 ssh 配置错时，`GET /api/selfcheck` 第 1 维（fs_type）返回空串被判 pass，第 2 维（storage）空串算成 100% free 判 pass，只有第 5 维链路灯变红 : 前两盏灯是假的。
- **RCA**：`runRemote` 只做 stdout+stderr 拼接并 `.trim()`，退出码被丢弃；调用方又都把空串当成「读到了但是空」，没有「没读到」这一态。
- **永久修复方案**：proc.js 新增 `runSshRaw`（返回 code + text，统一滤 known_hosts 噪声）与 `runSshStrict`（非 0 或空输出抛错）；自检第 1~4 维改走严格版，异常一律落到各维既有的 `catch` 分支报 unknown。
- **防回归单测用例路径**：BioanalysDesktop/tests/selfcheck_isolation_merge.test.js（255 + 空输出必须抛错、只有噪声行视同无输出、多行输出不被裁）+ index.js 静态断言（第 1~4 维不许再出现宽松调用）。

## P-17 引擎崩溃被当成「不可达」，坏输入静默放行

- **所属域**：Ops / 桥接引擎
- **现象与复现条件**：`printf notah5ad > /tmp/bad.h5ad` 后调守卫，引擎吐 `OSError: Unable to synchronously open file (file signature not found)` 的裸 traceback，守卫打印 `[BRIDGE SKIP] ... local 模式退出码 1` 并 exit 0 : 损坏的矩阵被当成"没问题"放行。
- **RCA**：守卫只按「输出里有没有 BRIDGE FAIL 字样」判失败，引擎抛未捕获异常时没有该字样，于是落进契约 3 的「不可达」分支；而本机引擎是否存在在解析阶段就已确认，本地非 0 退出不可能是"不可达"。
- **永久修复方案**：D-16 两边都改 : 引擎侧存在性检查 + 异常折成 [BRIDGE FAIL] + UTF-8 输出；守卫侧契约 3c：本机模式非 0 即 FAIL 并透传退出码，ssh 分支的 255 仍 SKIP。
- **防回归单测用例路径**：BioanalysDesktop/tests/bridge_stage.test.js（损坏 h5ad、文件不存在两条真跑）、tests/bridge_guard_local.test.js（崩溃必须 FAIL、ssh 255 仍 SKIP）。

## P-18 引擎结论在 Windows 宿主变成乱码，grep 不到关键字

- **所属域**：Ops / 桥接引擎
- **现象与复现条件**：在 Windows 上跑 `python ops/verify_bridge_checkpoint.py`（或测试垫片），输出里的中文结论是 `[BRIDGE FAIL] �����޷�У��...`，测试断言 `/引擎无法校验输入/` 直接红；Linux 计算节点不复现。
- **RCA**：Windows 控制台默认代码页 cp936，Python 按它编码 stdout，而管道另一端（node/测试）按 UTF-8 解码。
- **永久修复方案**：引擎启动时对 stdout/stderr 调 `reconfigure(encoding="utf-8")`（失败静默忽略），输出编码不再依赖宿主默认值。
- **防回归单测用例路径**：BioanalysDesktop/tests/bridge_stage.test.js（损坏输入与文件不存在两条用例要求输出含中文结论原文）。

### P-19 容器内 curl 下大文件被 proot 重启打断，留下残片 .gz

- **所属域**：运维 / 离线参考数据
- **现象与复现**：在 K40 Ubuntu 容器里 `curl` STRING v12.0 links（83MB）到
  `public_references/stringdb/`，跑到 2.4~3.7MB 时容器重启（`uptime` 只剩 2 分钟），
  curl 进程消失、文件 mtime 停住，磁盘上留下半截 `.gz`。此后 `ppi_string` 认为
  "离线文件存在" 走进离线分支，读到流尾直接抛 `EOFError: Compressed file ended before
  the end-of-stream marker was reached`（Python traceback）。
- **RCA**：两层原因。① proot 容器不保证长时间前台进程存活（本轮 30 分钟内重启两次），
  大文件下载必须当成"可能被打断"的任务；② 脚本只用 `os.path.isfile` 判断离线文件是否可用，
  存在性不等于完整性。
- **永久修复**：① 下载放到**本机**（Windows `curl.exe`，实测 ~700KB/s）再 `scp` 进容器，
  容器只负责接收，不再承担长连接；② `ppi_string` 增加 `READ_ERRORS` 白名单
  （`OSError`/`EOFError`/`zlib.error`/`UnicodeDecodeError`），把读失败折成
  `离线 protein.links 读取失败（...），文件可能是下载中断的残片：<path>。先跑 gzip -t <path> 验证，
  不通过就删掉重下（curl -C - 可续传）` 并 exit 1，不再甩 traceback。
- **防回归单测**：`BioanalysDesktop/tests/ppi_string_offline.test.js` 两条
  （「静态：离线读失败必须折成修复指引，不许裸 traceback」「下载中断的残片 .gz：exit 1 且给 gzip -t 指引，不冒 traceback」，
  后者把 4000 行边表 gzip 后截到 55% 真跑）。

### P-20 逐文件 ssh 校验在容器重启窗口内变成假红灯

- **所属域**：运维 / 部署通道
- **现象与复现**：`pwsh -File ops/06_deploy_scripts.ps1 -Force` 部署 58 个文件，前面 scp 全成功，
  但校验段刷出 21 行 `[校验] MISSING /mnt/ssd/bio_data/bin/...`，脚本 exit 1。随后手工 `ls`
  发现这些文件全在，且哈希与仓库一致（55/55）。同时 `ssh k40-ubuntu uptime` 显示容器刚重启 2 分钟。
- **RCA**：原实现「一个文件一次 ssh」共 58 次 stat + 58 次 chmod，整个窗口跨了十几秒；
  proot 容器在这段时间里重启，后半段 ssh 直接失败，`2>&1` 的输出里没有 `^\d+$` 行，
  代码就落进 `if (-not $remoteBytes)` 分支判 MISSING : 把「链路故障」误报成「文件缺失」。
- **永久修复**：① 校验与 chmod 都合并成**单次 ssh**（printf 喂 while 循环，回 `FILE|path|size|exec` /
  `MISSING|path`）；② ssh 非 0 先重试一次，仍非 0 才报「校验链路失败（不是文件缺失）」；
  ③ 远端没回某路径结果时单列一档 `NO_RESULT`，不并入 MISSING（见 D-18）。
- **防回归单测**：`BioanalysDesktop/tests/deploy_and_parity_guard.test.js` 三条
  （「校验阶段必须是单次 ssh 批量」「链路失败与文件缺失必须分开判定」「可执行位一次批量置位」）。

### P-21 xargs 的 123 退出码让整段解析被跳过

- **所属域**：运维 / 同步脚本
- **现象与复现**：`ops/sync_and_verify_remote.ps1` 新增的第 6 步（部署一致性）首跑报
  `[WARN] 部署漂移 58/58（bin 落点缺失或不可读）`，但 58 个母版明明都在 `bin/` 下。
- **RCA**：命令是 `printf ... | xargs sha256sum 2>/dev/null`。`bin/` 里有 3 个 README.md 这类
  文档没有部署过去，sha256sum 对它们报错，xargs 于是整体退出 123；PS 侧写的是
  `if ($binRes.Code -eq 0) { 解析 }`，退出码非 0 就把整段解析跳过，$binMap 空 → 全部判缺失。
- **永久修复**：命令尾部加 `|| true`（缺文件是常态，不该让退出码决定要不要解析），
  并且只把「脚本文件」纳入比对（`$rel -notlike '*.md'`），文档缺失不算部署漂移（见 D-17）。
- **防回归单测**：`BioanalysDesktop/tests/deploy_and_parity_guard.test.js` 两条
  （「xargs 必须 || true」「README.md 等文档不算部署漂移」）。

### P-22 proot 容器里的 `/proc/uptime` 是静态假文件，`uptime` 不能用来判断重启

- **所属域**：运维 / 真机取证
- **现象与复现**：多次 `ssh k40-ubuntu uptime` 都显示 `up 2 min`，据此判断「容器每几分钟重启一次」，
  并把它当成 P-19（curl 下大文件被打断）与 P-20（部署校验 ssh 失败）的根因。
  实际连续三次采样 `ps -eo pid,etime,comm | grep proot`：`4200 11:51` → `12:23` → `12:54`，
  **同一 pid 稳定增长**；Termux 宿主 `uptime` 显示 `up 1 day, 8:27`。容器并没有重启。
- **RCA**：proot-distro 启动时把宿主的若干 `/proc` 文件替换成 `sysdata/` 下的**静态副本**并 bind 进来
  （见 proot 命令行里的 `--bind=.../sysdata/uptime:/proc/uptime`）。该文件在容器生命周期内不再更新，
  读到的永远是「容器启动时的宿主 uptime」，看起来就像一个刚启动 2 分钟的系统。
  另注意容器内时钟是 UTC（宿主是 CST，差 8 小时），拿容器时间戳做算术会再错一次。
- **永久修复**：判断容器是否重启只看两条：① `ps -eo pid,etime,comm | grep -i proot` 的 etime 是否
  单调增长（pid 变了或 etime 归零才算重启）；② Termux 宿主侧 `ssh k40 uptime`。
  `uptime` / `/proc/uptime` 一律不作为重启证据。
- **连带修正**：P-19 的「proot 长进程不保证存活」与 P-20 的「窗口内容器重启」两条 RCA 结论作废，
  真实原因尚未定位（候选：Termux/Android 后台休眠掐断 ssh 会话、sshd 会话数上限）。
  永久修复（本机下载再 scp、单次 ssh 批量校验）仍然有效，因为它们消除的是「长连接 + 多次 ssh」
  这个放大器，与重启与否无关。
- **防回归**：无单测（运维事实），本条目即取证结论；后续真机脚本一律用 etime 判活。
  （**2026-10-21 更正**：容器内 `ps` 本身会 abort proot，见 P-23 : etime 判活只能在 Termux 宿主侧跑。）

### P-23 在容器内跑 ps / pgrep 会 abort 整个 proot（path.c 断言），杀掉所有在跑任务

- **所属域**：运维 / 真机取证（所有通过 ssh 进 k40-ubuntu 执行的命令）
- **现象与复现**：2026-10-21 12:57:22 与 12:57:51 容器在两分钟内连崩两次，正在跑的 scenic_tf（12:26 起，已跑 31 分钟）随之消失、无台账、无 exit_code。
  Termux 侧 `/data/data/com.termux/files/usr/var/log/ubuntu-sshd/current` 里留下三条（12:06:07 / 12:57:22 / 12:57:51）：
  `./path/path.c:546: Comparison compare_paths2(const char *, size_t, const char *, size_t): assertion "length1 > 0" failed`
  紧跟 `proot warning: signal 6 received from process <pid>`，随后 `Server listening on 0.0.0.0 port 10022.`（runsv 的 ubuntu-sshd 服务把 proot 重新拉起来）。
  三次崩溃都紧接在我从容器内跑 `ps -eo pid,etime,args` / `pgrep -a python3` / `pgrep -af proot` 之后。
- **RCA**：proot 用 ptrace 做路径翻译，`ps`/`pgrep` 会遍历 `/proc/<pid>` 并读 cmdline、cwd、fd 等符号链接；
  其中某些条目在 proot 的翻译表里解析成空路径，`compare_paths2()` 对长度 0 的路径触发断言（`length1 > 0`），
  整个 proot 进程收到 SIGABRT 退出，容器内**所有**进程（含正在跑的 R/python 任务）一起死。
  这解释了此前被误判为「容器不定时重启」的多次任务中断。
- **2026-10-21 13:09 补充取证（触发面比 ps 更宽）**：13:09:02 与 13:09:11 又连崩两次，
  当时**没有**任何 ps/pgrep 在跑，我执行的是一条 `grep -rl <taskId> /mnt/ssd/bio_data/system_logs/`；
  两个被 abort 的进程分别是 19369 / 19831。故触发面应表述为「**任何递归目录遍历**」：
  `ps`/`pgrep`/`pkill` 遍历 `/proc`、`grep -r`/`grep -R` 经 fts(3) 逐层 `openat`+`fchdir`、
  `find`（含 `-newermt`）、`du`/`ls -R` 这类同样逐层下降的工具都在危险集合里。
  判据：**只要一条命令会「自己决定下一层看哪个目录」就属于危险集合**；
  显式列出路径的 `ls <dir>`、`ls -t <glob> | head`、`cat <file>`、`test -f <file>` 是安全的。
- **永久修复**：容器内**禁用递归遍历**类命令：`ps` / `pgrep` / `pkill` / `find`（含 `-newermt`）/ `grep -r` / `grep -R` / `du` / `ls -R`。
  需要「按名字找文件」时，先用 `ls -t <glob>` 取清单再逐个 `test -f`；判活与取证改用：
  ① 台账新增：`ls -t /mnt/ssd/bio_data/system_logs/*<PROJECT>* | head`；
  ② 产物 mtime：`ls -lt <项目>/<线>/processed | head`；
  ③ 单点检查（确知 pid 时）：`ls /proc/<pid>`；
  ④ 判容器是否重启：Termux 宿主侧 `ssh k40 'ps -eo pid,etime,args | grep -i proot'`（宿主进程，不经过 proot，安全）。
  注意宿主侧 `ps` **看不到** guest 进程（实测 `ssh k40 'ps -eo ... | grep python3'` 输出为空），所以不能用它判任务存活。
- **连带修正**：P-22 的「容器从不重启」结论作废 : `uptime` 是静态假文件这一点仍然成立，
  但**真重启确实存在**，且触发者是我们自己的 `ps` 探针；P-19 / P-20 的「proot 长进程被打断」现象有了确切根因。
- **防回归单测**：`BioanalysDesktop/tests/proot_probe_guard.test.js`（静态断言：所有可能通过 ssh 进容器的脚本里，
  凡出现 `k40-ubuntu` 的文件不得出现 guest 侧 `ps -eo/ps aux/ps -ef`、`pgrep`、`pkill`、`grep -r`/`grep -R`、`find`、`du`、`ls -R`；
  并断言本条目与 ops/README.md 的禁令文字在位；历史一次性取证脚本按白名单豁免，新增文件不得再犯）。

### P-24 容器内 `/proc/loadavg` 是 Android 宿主的负载，用它判活会误杀正在跑的任务

- **所属域**：运维 / 任务判活（K40 proot 容器）
- **现象与复现条件**：line2 的 scenic_tf 在跑 GRNBoost2（纯 CPU、前 20 分钟不出产物），此时容器内 `cat /proc/loadavg` 显示 `0.12 0.07 0.02`、`processed/` 也没有新文件。据此判「卡死」并杀掉重试，13:0x-13:16 连续误杀两次；事后用同一条命令手工直跑，1 分钟就打到 GRNBoost2（日志 `[6.6s] dask threads=3`），证明脚本一直正常。
- **RCA**：proot 只做路径重映射，**不隔离 /proc/loadavg**，读到的是 Android 宿主的全局负载；宿主此刻主要空闲/IO，容器内 CPU 密集任务在宿主的 runnable 计数里并不显著。同源的还有：容器内 `uptime` 是 proot bind 进来的静态假文件（P-22），`/proc/<pid>/cmdline` 不可读，guest 进程在宿主 `ps` 里看不到。**即容器内没有任何可信的「本任务在不在跑」的进程级信号。**
- **判活正确顺序（唯一可信口径）**：
  ① 引擎 SSE 日志 `GET /api/tasks/logs?id=<taskId>`（实时远端 stdout，最直接）；
  ② 该步的临时产物出现（如 scenic_tf 的 `_scenic_expr_tmp.csv` 约 2 分钟出现）；
  ③ 台账文件名新增：`ls -t /mnt/ssd/bio_data/system_logs/*<PROJECT>* | head`；
  ④ 产物 mtime：`ls -lt <项目>/<线>/processed | head`。
  **`/proc/loadavg`、进程数、`/api/tasks` 里任务在不在，一律不能当判活依据**：`/api/tasks` 里任务消失只说明本机 ssh 子进程结束，没有台账就是「被杀 / 无输出退出」，这时要看日志而不是猜。
- **安全的旁证**：本机（Windows）侧 `Get-CimInstance Win32_Process` 看 ssh.exe 的 CommandLine 是安全的（不涉及 guest /proc），能看到引擎下发的完整远端命令，可用于手工复现；Termux 宿主侧 `ssh k40 'ps -eo pid,etime,args | grep -i proot'` 只能判容器是否换 pid（P-23），看不到 guest 进程。
- **口径提醒**：自检第 3 维（`server/selfcheck.js` 的 `cat /proc/loadavg`）读到的是**宿主**负载，不是容器内任务负载；它衡量「手机整体忙不忙」有效，衡量「我这个任务在不在跑」无效。
- **永久修复方案**：判活一律走上表四步；任务重试前必须先在 SSE 日志里看到「确实没有输出增长」的证据，禁止只凭 loadavg/进程数/无新产物就杀任务。
- **防回归单测用例路径**：`BioanalysDesktop/tests/proot_probe_guard.test.js`（断言本条目含 `/proc/loadavg` 与「判活」口径、ops/README.md 有判活小节、cn_debug 下链路脚本不得出现 `loadavg` 判活）。
### P-25 proot 崩溃与「递归遍历」无关：13:44:42 那次 abort 时本机没跑任何容器内命令

- **所属域**：K40 容器稳定性 / 任务中断取证
- **现象与复现条件**：2026-10-21 13:44:42，Termux 侧 sshd 日志出现 `path.c:546 assertion "length1 > 0" failed`、`signal 6 from process 23069`，随后 `Server listening` 重启；当时 line2 的 scenic_tf 正在跑 GRNBoost2（任务被一起带走）。同一台机器 13:20-13:47 之间还有若干次正常 accept/disconnect。
- **RCA**：复盘当时的操作序列，本机只跑了本机 PowerShell 与宿主侧 `ssh k40 'ps ...'`，**没有任何容器内递归命令**（P-23 认定的触发条件是「容器内跑 `ps -ef` / `pgrep` / `find` 这类会遍历 /proc 的命令」）。所以 proot abort 的触发条件比 P-23 记录的更宽：宿主侧对 proot 进程的某些操作、或容器内高负载下的路径解析竞态，都可能触发同一条 path.c 断言。P-23 的「递归遍历会触发」仍然成立，但它不是必要条件。
- **永久修复方案**：① 不能把「不跑 ps 就不会崩」当保险，长任务必须用 `system_logs/_running/<task_id>.json` 残留来取证中断（D-20）；② 长链取证脚本按「快照 + 只认新增台账」定位台账（P15 runner 的做法），避免时钟漂移叠加崩溃造成假失败；③ 重跑前先确认 proot pid / etime 是否变化（只认这个，容器内 uptime 不可信，P-22）。
- **防回归单测用例路径**：`BioanalysDesktop/tests/proot_probe_guard.test.js`（P-23/P-24/P-25 三条并存，且断言 runner 用「快照 + 新增台账」而不是时间比较）。



### P-26 本机进程树承载远端长任务必死：line2 的 scenic_tf 连杀三次，根因是「引擎 ssh 子进程随本机 pwsh 退出被回收」

- **所属域**：取证脚本 / 任务编排（PC 侧 -> K40）
- **现象与复现条件**：line2 全链取证里 scenic_tf（GRNBoost2 要 20-40 分钟）连续三次被打死：
  ① 引擎 8791 的 ssh 子进程随本机 pwsh 调用结束被回收，任务从 `/api/tasks` 消失、远端只剩 `_running/task_*.json` 残留标记；
  ② runner 用 `Start-Process` 起，pwsh 退出即被杀，runner 报 `TypeError: fetch failed`；
  ③ runner 固定 180s 台账等待，对 20-40 分钟的重步骤必然假失败。
  line1 那次能成是因为每步 3s~2.6min，**撑过了进程存活期**，不是方法对。
- **RCA**：Windows 上 `Start-Job` / `Start-Process` 起的 node 进程属于本次 pwsh 调用的作业对象，pwsh 一退就连进程带子进程树一起回收；
  `run_in_background: true` 的 pwsh job 同理受 harness 管辖。所以「本机有个长活进程在等远端」这个形态本身不可靠。
- **永久修复方案**：远端 `setsid nohup` 起 `ops/run_throttled_task.sh`（命令串模式 `BIO_EXEC_CMD`，`BIO_WRAPPER_LEDGER=1` 保留台账），
  本机 runner **只轮询**（`_running/` 标记 + 台账快照差集 + 日志字节数），不承载远端任务生命周期。
  已落地为 `cn_debug/lib/chain_runner.mjs` + `cn_debug/2026-10-22_m1_line2_rest.mjs`。
  实测：`setsid nohup bash -c 'for i in $(seq 1 60)...' & ` 在 ssh 断开 12 秒后 `pgrep` 仍能找到，证明 setsid 形态有效。
- **防回归单测用例路径**：`BioanalysDesktop/tests/proot_probe_guard.test.js`（断言 cn_debug 下 chain runner 不得用 `/api/tasks` 作判活依据、必须含 setsid/nohup 与「快照 + 只认新增台账」）。


### P-28 proot 每 15 秒 abort 的根因是容器 /tmp 堆积（无 systemd 永不自动清理）

- **所属域**：计算容器健康度 / proot 稳定性
  > **2026-10-23 第十九轮修订**：本条 RCA 的「/tmp 堆积是根因」判定**已被推翻**，
  > 真正的充分条件是 **ssh 连接流**，见 P-29。/tmp 清理与 watchdog GC 作为卫生项保留。
- **现象与复现条件**：`ubuntu-sshd` 日志里
  `./path/path.c:546: Comparison compare_paths2(const char *, size_t, const char *, size_t): assertion "length1 > 0" failed`
  + `proot warning: signal 6 received`，**严格 15.0/16.0 秒周期**（实测 514 次，均值 15.16s）。
  runsv 每次重拉都新建 proot，新的活 15 秒即崩，容器永远不可用。
- **RCA**（全部有实测依据）：
  1. **容器 /tmp 堆积 873 项 / 4.9G**（`rootfs/tmp`），里面是历史探针
     （`_probe_grn.py`、`_snap1.txt`、`s28_bad_bridge.h5ad`、`inst_bioc.R`、`ppi_verify` 等）与临时 h5ad。
  2. **proot 容器没有 systemd**，`/etc/tmpfiles.d/` 不存在，所以 `/tmp` **永远不会自动清理**。
  3. proot 启动参数含 `--link2symlink`（`proot-distro login` 默认），每次路径解析都要
     逐层走遍这些 bind 挂载点；`compare_paths2` 在深层/符号链路径上收到空段就断言失败。
  4. **排除的假设**（都有反证）：
     - SSH 连接活动触发：abort 前 10s 内 Accepted 中位数 = 0，均值 0.39
       **低于**全局基线 0.50；且实验建连接后立即断开等 40s，abort 增量 = 0。
     - 会话断开触发：同上实验反证。
     - 手动探测：完全静默 180s 不碰 adb/ssh，abort 照旧 15s 一次。
     - `tick.sh`（5 分钟）/ `bio_watchdog.sh`(60s)：周期不匹配，且脚本中无递归遍历。
     - 双 runsvdir：修好后 abort 依旧（第十五轮已验证）。
     - 双 runsvdir + 手动开的容器（pid 31140）：与 abort 周期无关。
- **永久修复方案**：
  1. **立即**：清理容器 `/tmp` 中 24 小时以前的项（2026-10-22 实测 873 → 12 项，零失败）。
  2. **根治**：`ops/bio_watchdog.sh` 新增第三项职责：每 6 小时执行一次
     `find /tmp -mindepth 1 -maxdepth 1 -mmin +1440 -exec rm -rf {} +`（只删一层、只删 24h 以前，
     不会动正在跑的任务），并把结果写入 watchdog 日志。
  3. **防回归**：`BioanalysDesktop/tests/watchdog_tmp_gc.test.js`
     （断言 watchdog 含 `CONTAINER_TMP` 指向容器 rootfs/tmp、`-mmin +1440`、
     `-mindepth 1 -maxdepth 1`、周期 360 循环）。
- **防回归单测用例路径**：`BioanalysDesktop/tests/watchdog_tmp_gc.test.js`
- **验证状态**：清理后同一个 proot（pid 16009）已稳定运行 8.7 小时零 abort；
  修补后需要求：部署新 watchdog → 观察 24 小时无 abort。


### P-29 proot 每 15 秒 abort 的真正充分条件是 ssh 连接流（P-28 修订）

- **所属域**：计算容器健康度 / proot 稳定性
- **现象与复现条件**：与 P-28 完全同形:`ubuntu-sshd` 日志
  `./path/path.c:546: compare_paths2 ... assertion "length1 > 0" failed` + `signal 6`，
  **严格 15 秒周期**，runsv 每次重拉新 proot，新的活 15 秒即崩。
- **RCA**（2026-10-23 全部实测依据）：
  1. **反证 P-28 的 /tmp 归因**：本轮 abort 活跃时容器 `rootfs/tmp` 只有 **1 项**
     （`_snap1.txt`），watchdog 的 6 小时 GC 也一直在跑。/tmp 干净仍崩，堆积不是必要条件。
  2. **反证计算负载归因**：停掉本机 runner 后静默 3 分钟（08:19:25 → 08:24:59 UTC），
     远端 scenic_tf 的 Python 进程**仍在运行**（`_running` 标记在位、日志在写），
     abort 计数 **202 → 202 零增长**。计算不是触发源。
  3. **正证连接流归因**：同一份日志里两段 abort 之间有 **15 分 27 秒零 abort 窗口**
     （07:54:42 → 08:10:09），窗口内我做过十余次单发 ssh（健康检查、产物清点、
     死标记清理、母版 md5 比对）而 abort 不起；窗口结束于 08:10:09，其前 71 秒
     （08:08:58-08:10:09）出现 **12 个并发 Accepted**。第二段 abort 第一个杀掉的
     正是那个已稳定 15 分钟的 proot（pid 22511）。
  4. **为什么以前查不出来**：P-28 的排除项「静默 180s abort 照旧」与「abort 前 Accepted
     中位数 = 0」都是在**有另一个探测源在跑**的背景下采的:上一轮"静默"时轮询脚本
     没停，所以静默窗口并不干净。本轮先把 runner 进程停掉再计时，才拿到干净窗口。
  5. **机制解释**（推断，未在 proot 源码层证实）：高频/并发 ssh 让 sshd 反复解析
     `--link2symlink` 下的 bind 挂载链，`compare_paths2` 在某个并发时序上收到空段即断言
     失败；sshd 死后 runsv 立刻重拉，本机 runner 的重试又立刻接上，形成 15 秒自我维持环。
- **永久修复方案**：
  1. **runner 不得对容器做高频轮询**：`cn_debug/lib/chain_runner.mjs` 的 `ssh()` 当前是
     「3 次重试 + ServerAliveInterval=15」，`waitNewLedger()` 每 10s 一轮询:对 20-40 分钟
     的重步骤就是每分钟 6 次连接，正好喂饱循环。轮询间隔应拉到 60s 以上，重试改为 1-2 次。
  2. **判活改用"单次长连接"形态**：一次 ssh 里把「读标记 + 读日志字节 + 读台账列表」合并成
     一条命令，不要拆成三次往返（母版 md5 比对那次 9 次串行 ssh 就是典型反例）。
  3. **长任务下发前先确认容器安静**：观察 60 秒无 abort 再下发，避免任务刚起就被循环拖死。
  4. **保留** P-28 的 /tmp GC 与 watchdog 修补，但改判为卫生项而非根因修复。
- **防回归单测用例路径**：`BioanalysDesktop/tests/proot_probe_guard.test.js`（应新增
  「runner 轮询间隔下限」与「单次 ssh 合并探测」断言）。
- **验证状态**：停 runner + 静默 3 分钟，abort 零增长且 scenic_tf 正常推进（P-24 四信号在位）。

### P-30 adb 与 ssh 的链路测试红是沙箱权限假象，不是代码回归（2026-10-24）

- **现象**：`BioanalysDesktop` 全量测试固定 5 条红，与代码改动无关：
  `link.test.js` 三条（设备探测 / forward 探测 / 四段自检）、`proc.test.js` 一条
  （真连服务器拿 `CONTAINER_OK`）、`consistency.test.js` 一条（远端目录准备）。
  另有 46 条 skipped，容易被误读成"链路类用例本该跳过"。
- **根因**（两条独立，同在沙箱权限）：
  1. `adb.exe` 一启动即 `Cannot mkdir '\.android': Permission denied`，退出码
     `3221226505` = `0xC0000142`（进程初始化失败）。它要把家目录建在**盘根**，
     而沙箱无权在 `C:\` 或 `D:\` 建目录，所以连 `adb version` 都崩，
     `adb devices` 自然看不到 `3a3e1f52`，forward 重建也全部失败。
  2. `ssh` 报 `Could not resolve hostname k40-ubuntu`：`~/.ssh/config` 里的别名
     读不到（沙箱对用户主目录只读），HostAlias 无从解析。
- **为什么反复误判**：症状长得像"手机没连"或"代码改坏了"，且 `link.test.js` 的断言
  文案（"链路应通；若此测试红，先查 adb 与 USB"）把人往排查手机的方向引。
  实际手机与链路一直是好的。
- **环境变量绕不过去**（本轮实测，别再试）：设 `HOME`、`USERPROFILE`、
  `HOMEDRIVE`+`HOMEPATH`、`APPDATA`、`ANDROID_SDK_HOME`、`ANDROID_ADB_SERVER_HOME`
  全部无效，`adb` 仍去建盘根 `\.android`。这不是家目录指向问题，是盘根写权限问题。
- **永久修复方案**：把判定顺序写进文档，见 `BioanalysDesktop/README.md`
  「跑测试前先知道三件事」第 3 条：看到这 5 条红先提权复跑，再决定是否查代码。
  提权后实测 `3a3e1f52`（alioth / M2012K11AC）在线、双 forward 在位、
  Termux 与容器 sshd 均返回 OK，**848/848 全绿、0 skipped**，连续三次复跑稳定。
- **顺带修正的认知**：46 条 skipped 不是"链路类用例的预期形态"，同样是沙箱假象
  （宿主 python3 / bash + pandas 等依赖在提权后才可见）。提权跑出的 0 skipped 才是真基线。
- **防回归单测用例路径**：无需新增用例，这 5 条本身就是真链路探针，改它们等于拆警报。
  防线在文档：README 第 3 条 + 本条台账。
- **验证状态**：已修复。提权后 848/848 全绿 ×3，`tsc --noEmit` exit 0，`npm run build` exit 0。

### P-43 A2A 终态比较必须先归一化协议枚举

- **所属域**：A2A 状态机与前端轮询。
- **现象**：Pi 返回 `TASK_STATE_COMPLETED` 等大写协议枚举，前端只比较 `completed` 等小写短名，已完成任务仍继续轮询。
- **风险路径**：任务到终态后未被识别，24 小时超时逻辑可能继续调用 `CancelTask`，界面状态与远端真实状态长期不一致。
- **永久修复**：所有路由响应统一经过 `normalizeA2ATask()`，控制面使用小写 `status.state`，原始协议值保存在 `status.remote_state`。
- **防回归用例**：`BioanalysDesktop/tests/a2a_state.test.js` 与 `BioanalysDesktop/tests/pi_agent_routes.test.js`。
- **验证状态**：Node 定向测试 `19/19 PASS`；真实 completed 与 canceled 任务均通过 `GetTask` 读回归一化状态。
