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
- **RCA**：守卫默认只实现了 ssh 通道，而它自己的运行位置就在远端计算容器里 —— 容器内没有 k40-ubuntu 这个主机名，于是「远程校验远端文件」这条设计在主路径上必然失败；失败又被契约 3 静默降级为 SKIP，无人报警。
- **永久修复方案**：本机优先 + ssh 兜底（D-14）。`BRIDGE_ENGINE_LOCAL` 默认指向容器内引擎落点；OK 文案带 `engine=local|ssh` 便于日志取证；母版侧守卫候选路径列表覆盖仓库布局与部署布局两种（`$(dirname $0)/../../bridge_guard.sh` → `/mnt/ssd/bio_data/ops/` → `/mnt/ssd/bio_data/`）。
- **防回归单测用例路径**：BioanalysDesktop/tests/bridge_guard_local.test.js（本机优先、ssh 兜底、置空强制 ssh、契约 3b/3c 静态断言）；真机验收命令见 D-14。

## P-16 自检 runRemote 丢弃 ssh 退出码 → 断链时假绿灯

- **所属域**：Server（自检）
- **现象与复现条件**：拔掉 K40 或 ssh 配置错时，`GET /api/selfcheck` 第 1 维（fs_type）返回空串被判 pass，第 2 维（storage）空串算成 100% free 判 pass，只有第 5 维链路灯变红 —— 前两盏灯是假的。
- **RCA**：`runRemote` 只做 stdout+stderr 拼接并 `.trim()`，退出码被丢弃；调用方又都把空串当成「读到了但是空」，没有「没读到」这一态。
- **永久修复方案**：proc.js 新增 `runSshRaw`（返回 code + text，统一滤 known_hosts 噪声）与 `runSshStrict`（非 0 或空输出抛错）；自检第 1~4 维改走严格版，异常一律落到各维既有的 `catch` 分支报 unknown。
- **防回归单测用例路径**：BioanalysDesktop/tests/selfcheck_isolation_merge.test.js（255 + 空输出必须抛错、只有噪声行视同无输出、多行输出不被裁）+ index.js 静态断言（第 1~4 维不许再出现宽松调用）。

## P-17 引擎崩溃被当成「不可达」，坏输入静默放行

- **所属域**：Ops / 桥接引擎
- **现象与复现条件**：`printf notah5ad > /tmp/bad.h5ad` 后调守卫，引擎吐 `OSError: Unable to synchronously open file (file signature not found)` 的裸 traceback，守卫打印 `[BRIDGE SKIP] ... local 模式退出码 1` 并 exit 0 —— 损坏的矩阵被当成"没问题"放行。
- **RCA**：守卫只按「输出里有没有 BRIDGE FAIL 字样」判失败，引擎抛未捕获异常时没有该字样，于是落进契约 3 的「不可达」分支；而本机引擎是否存在在解析阶段就已确认，本地非 0 退出不可能是"不可达"。
- **永久修复方案**：D-16 两边都改 —— 引擎侧存在性检查 + 异常折成 [BRIDGE FAIL] + UTF-8 输出；守卫侧契约 3c：本机模式非 0 即 FAIL 并透传退出码，ssh 分支的 255 仍 SKIP。
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
  代码就落进 `if (-not $remoteBytes)` 分支判 MISSING —— 把「链路故障」误报成「文件缺失」。
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
  （**2026-10-21 更正**：容器内 `ps` 本身会 abort proot，见 P-23 —— etime 判活只能在 Termux 宿主侧跑。）

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
- **永久修复**：容器内**禁用** `ps` / `pgrep` / `pkill` / `find -newermt` 这类遍历 `/proc` 的命令。判活与取证改用：
  ① 台账新增：`ls -t /mnt/ssd/bio_data/system_logs/*<PROJECT>* | head`；
  ② 产物 mtime：`ls -lt <项目>/<线>/processed | head`；
  ③ 单点检查（确知 pid 时）：`ls /proc/<pid>`；
  ④ 判容器是否重启：Termux 宿主侧 `ssh k40 'ps -eo pid,etime,args | grep -i proot'`（宿主进程，不经过 proot，安全）。
  注意宿主侧 `ps` **看不到** guest 进程（实测 `ssh k40 'ps -eo ... | grep python3'` 输出为空），所以不能用它判任务存活。
- **连带修正**：P-22 的「容器从不重启」结论作废 —— `uptime` 是静态假文件这一点仍然成立，
  但**真重启确实存在**，且触发者是我们自己的 `ps` 探针；P-19 / P-20 的「proot 长进程被打断」现象有了确切根因。
- **防回归单测**：`BioanalysDesktop/tests/proot_probe_guard.test.js`（静态断言：所有可能通过 ssh 进容器的脚本里，
  凡出现 `k40-ubuntu` 的文件不得出现 guest 侧 `ps -eo/ps aux/ps -ef`、`pgrep`、`pkill`；并断言本条目与 ops/README.md 的禁令文字在位）。
