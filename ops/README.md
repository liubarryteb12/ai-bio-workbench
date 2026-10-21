# ops/ — 链路运维脚本

> PC 侧入口用 PowerShell（`pwsh -File ops/xx.ps1`）。
> 本机没有 bash 也没有 WSL，所以 bash 脚本只在服务器侧执行（scp 过去再跑）。
> 每个脚本都要有退出码：0 = 成功，非 0 = 失败并在输出里指明哪一环。

## 脚本清单

| 脚本 | 位置 | 用途 | 实测状态 |
|---|---|---|---|
| `00_link_check.ps1` | PC | 链路四段自检：设备 → forward → Termux sshd → 容器 sshd，加四服务状态 | exit 0 |
| `_archive/ops/01_fix_svlogger.ps1`（已归档 2026-10-21） | PC | 修复 log 子服务 crash-loop（坑#88），可回滚。一次性修复器，2026-10-20 reboot 后已执行完成；**若复发从 `_archive/` 取回**（`git mv _archive/ops/01_fix_svlogger.ps1 ops/`） | exit 0 |
| 上述脚本依赖的模板 | PC → 手机 | `svlogger_sshd` / `svlogger_crond` / `svlogger_ssh-agent`（本地 `ops/` 下本就不存在，只在远端 Termux 服务目录） | 已生效 |
| `02_check_isolation.ps1` | PC | 校验 `src/<line>/` 代码无跨线引用 | exit 0，反向验证过 |
| `03_check_logs_remote.sh` | 服务器 | 校验台账 JSON 的 `line_id` 与路径合法性（含跨线、缺种子检查） | 双向验证过 |
| `04_check_logs.ps1` | PC | `03` 的一键入口：自动 scp + ssh 执行 + 传回退出码 | exit 0/1 三条路径验证过 |
| `05_push_testdata.ps1` | PC | 测试数据一键上盘（P1-2 预案）：探测 SSD 挂载面 → 建三线目录骨架 → scp 直送三线 raw_data（中文文件名换英文）→ 字节校验 | 完整链路已演练实测：11 文件 905 MB 全过 exit 0（2026-10-13，演练目录已清理）；SSD 在位后跑一次即正式上数 |
| `06_deploy_scripts.ps1` | PC | 步骤脚本部署通道：`src/<line>/scripts/` → 服务器 `<line>/bin/`，scp 直送 + chmod 755 + 字节校验 + `test -x` 复核。`-Line` 单线 / `-Force` 覆盖 / `-Rehearse` 演练 | line1_bulk 首脚本 probe_env 部署 exit 0；复验任务全链路 completed exit 0（2026-10-13） |
| `bio_watchdog.sh` | 手机 Termux | 保活看护（runit 监管）：每分钟重申 `termux-wake-lock` + 检查 5 个服务非 run 则 `sv up`。部署到 `~/p_actions/bin/`，服务目录 `$PREFIX/var/service/bio-watchdog/` | 2026-10-18 实测：唤醒锁 LONG 常驻；`sv down crond` 49 秒内被拉起；`kill -9` 后 runsv 5 秒自愈 |
| `fix_runsvdir.sh` | 手机 Termux | 双 runsvdir 抢锁修复（R15）：杀双 runsvdir+runsv+补杀 proot → 单实例 `runsvdir -P` 重拉 → `sv up` 六服务。**执行方式必须 `run-as com.termux sh <script>`**（直接 exec bash 被 Android W^X 拦） | 2026-10-20 真机 reboot 实战：R15 爆发后用本脚本修复，runsvdir 恢复为 1、六服务全 run（报告 `con_hf/2026-10-20_reboot_test.md`） |
| `serve_guard.ps1` | PC | 运行时守护：每 30 秒探活 工作台 8787 / 用户端 8080 / frpc，挂了按端口占用者杀掉再拉起。默认工作台免口令（本机用）；加 `-RequireAuth` 才带口令启动（口令文件 `~/.bioanalys/workbench_auth.json`，首次需要时自动生成）。**不注册开机自启**，需要时手动启动 | 2026-10-18 故障注入实测：杀 8787+8080 → 一个周期内重建；杀 frpc → 重建且公网 45644 恢复 200；`-RequireAuth` 下免密实例被识别并替换 |
| `layout_helper.py` | 服务器 `ops/` | 单图 SCI 三模板外挂装饰器（Python/matplotlib）：`apply_sci_plot_layout(fig, ax, spec, footnote_text, badge_text)`。读 `project.json` 的 `plot_layout_config`，落位标题/图例/X 轴避让/脚注栏，返回 dpi | 2026-10-18 本机 31 条断言全过（含几何审计零违规）+ 远端部署冒烟通过；已部署 `/mnt/ssd/bio_data/ops/` |
| `layout_autoload/sitecustomize.py` | 服务器 `ops/layout_autoload/` | Python 解释器级模板挂载：任务脚本把本目录放进 `PYTHONPATH`，启动即读 `BIOANALYS_PROJECT_JSON` 并包装 `Figure.savefig`。母版脚本零改动 | 2026-10-18 远端 16 条断言 + 真实 `bulk_figures` 端到端通过（DPI 300、画布按模板重设） |
| `layout_autoload/Rprofile` | 服务器 `ops/layout_autoload/` | R 端模板挂载：包装 `ggplot2::ggsave`，摘掉母版自带的 `width/height/units/dpi` 后按模板落盘 | 2026-10-18 真实 `pca_matrix` 端到端通过（PDF 518×291 pt ≈ 7.19×4.04 in，16:9） |
| `layout_autoload/bin/Rscript` | 服务器 `ops/layout_autoload/bin/` | `Rscript` 垫片：母版统一用 `--vanilla`（会跳过 `R_PROFILE_USER`），垫片把它降级为等价组合并保留 user profile。任务脚本把本目录排在 PATH 最前 | 2026-10-18 真实 `pca_matrix` 验证：无垫片时 6×5 in 原尺寸，加垫片后模板生效 |
| `../bin/layout_helper.R` | 服务器 `bin/` | 同上（R/ggplot2）：`apply_sci_plot_layout_r(p, spec, footnote_text, badge_text)` + `layout_save_r()` | 2026-10-18 在 k40-ubuntu 实跑 24 条断言全过，三模板均落盘；已部署 `/mnt/ssd/bio_data/bin/` |
| `build_client_report.py` | 服务器 `ops/` | 客户交付包七章解读报告引擎：扫描项目产物 → 生成 `Analysis_Report.md` + 单文件交互 `Analysis_Report.html` → 归集 `01_Adapted_Scripts` / `02_Figures_and_Tables` / `03_Interpretation_Report` → 打 `<id>_Client_Delivery.tar.gz`。`--dry-run` 预览、`--no-tar` 只出三大件、`--self-test` 自检。第二章新增「软件与版本登记 / 随机种子 / 方法学引用」三段，数据读 `software_versions.json` + `reference_citations.json`（缺失时正文明确写"版本清单缺失"，不静默） | 2026-10-19 S11 后自检 30 条全过；`PRJ_E2E_GSE277173` 实跑 exit 0，版本表含 WGCNA 1.74 / limma 3.58.1，引用 2 条（WGCNA + Bioconductor），limma 明写"本目录无原始论文" |
| `gen_reference_index.py` | 本地仓库 | 从 `reference/生信分析可用参考文献/citations.json` 生成人读索引 `INDEX.md`，并逐个校验 PDF 路径真实存在（`--check` 只校验不写盘）。改文献信息改 JSON 后重跑，避免索引与报告引用两套说法 | 2026-10-19 生成 18 个 PDF 全覆盖索引，`--check` PASS |
| `run_throttled_task.sh` | 服务器 | 统一降权执行包装器 + 自动台账 JSON（aims §六.3）。默认不绑核仅 nice/ionice 降权（2026-10-20 契约变更，实测 EAS 动态调度更快），`BIO_PIN_CPUS=4,5,6` 可恢复静态绑核 | 长任务守护主通道；**台账只有 `project_id`/`random_seed` 两字段的历史缺口待补** |
| `verify_bridge_checkpoint.py` | 服务器 | 跨语言转换四项断言（基因名完整性 / 矩阵行列方向与稀疏性 / 细胞 Barcode 顺序 / 降维与空间坐标保留） | **当前 58 个分析脚本 0 次调用它（aims §一.3 铁律空转）**，8787 提交层统一接线在整改队列 |
| `check_storage_and_isolation.sh` | 服务器 | 存储水位门禁（<20% 阻断）+ FUSE 红线 + 跨线路径静态扫描（aims §六.2 四门禁） | 隔离红线的服务器侧执行者 |
| `bio_limits.sh` | 服务器 | 容器全局线程封顶与无头渲染配置（aims §六.1，落 `/etc/profile.d/`） | 已在容器生效 |
| `bio_memory_guard.py` | 服务器 | Python 脚本级 7.5GB 软熔断头部模板（aims §六.4） | 与 `bio_r_header.R` 配对 |
| `bio_r_header.R` | 服务器 | R 脚本级 7.5GB 防崩头部模板（aims §六.4） | R 脚本入口 `source()` 它 |
| `07_pull_outputs.ps1` | PC | 产物回搬通道：远端 `projects/<id>/<line>/{figures,results}` → 本地 `outputs/`；同名同大小才跳过（#186 修复后规则）+ 字节校验 | 与 `06` 构成"下发-回搬"一对 |
| `08_migrate_to_projects.ps1` / `.sh` | PC / 服务器 | 数据面一次性迁移：顶层三线目录 → `projects/<id>/<line>/` 结构（2026-10 已完成的历史迁移） | 历史工具，保留备查 |
| `audit_figure_layout.py` | 服务器 | 出图布局合规审计（真渲染判决 A–E，`--runner bash --seed` 真跑脚本取几何） | 出图规范四工具之一；`--seed` 必须传真种子（#190 教训） |
| `fig_theme.py` / `fig_theme.R` | 服务器 | 出图主题层。Python 侧默认关（`BIOANALYS_PY_THEME=1` 开，实测对显式传参脚本零收益 #193）；R 侧仅 base R par（ggplot 走 SCI 模板 #193） | 底座保留、默认不启用 |

### 交付报告依赖的两份清单

| 清单 | 仓库正本 | 服务器部署位置 | 说明 |
|---|---|---|---|
| 软件版本 | `docs/software_versions.json` | `ops/software_versions.json` | 版本号由 `cn_debug/2026-10-19_s11_collect_versions.py` 在算力容器内实采，不许手抄；每条带 `source` 实测命令与 `lines`（该包被哪条线用） |
| 文献索引 | `reference/生信分析可用参考文献/citations.json` | `ops/reference_citations.json` | 报告方法学引用只读这一份；`INDEX.md` 是它的人读视图 |

部署方式与 `build_client_report.py` 相同（scp 直送 `ops/`）。两份清单都缺失时报告照常生成，
只在正文写明缺什么——报告引擎不允许因为缺清单就静默少写一段。

## 该信哪个：一张决策表（认知负担解药）

「断链 / 服务挂 / 台账不对 / 图不合规 / 要交付」各只有**一个**正确入口：

| 你的处境 | 唯一入口 | 别用 |
|---|---|---|
| ssh 连不上 K40 / 隧道断 | `00_link_check.ps1`（四段自检 + 自动重建） | 手动 `adb forward` 再手动试 |
| 8787 或 8080 服务没起/崩了 | `serve_guard.ps1`（注入口令常驻） | 裸 `node server/index.js`（缺口令环境） |
| 手机六服务挂 / reboot 后双 runsvdir 抢锁 | `fix_runsvdir.sh`（必须 `run-as com.termux sh` 执行） | 逐条 `sv up` 手工拉 |
| Termux 服务被系统杀 | `bio_watchdog.sh`（runit 自愈，49 秒拉起） | 另写 cron 保活 |
| 改完分析脚本要上线 | `06_deploy_scripts.ps1 -Line <线>` | 手动 scp（无字节校验） |
| 跑完要收图收表 | `07_pull_outputs.ps1 -Project <项目> -Line <线>` | 手动 scp 单文件 |
| 台账合法性存疑 | `03_check_logs_remote.sh`（`04` 是它的一键 PC 壳） | 人肉 cat JSON 判断 |
| 代码疑似跨线引用 | `02_check_isolation.ps1` | grep 了就算 |
| 图件合规存疑 | `docs/figure_spec.md` §七 四工具 | 肉眼看 |
| 要给客户交付 | 8787 `/api/report/build`（内部调 `build_client_report.py`） | ssh 上手跑 CLI（S27 前的老路） |
| 测试数据上盘 | `05_push_testdata.ps1` | 手动 scp 到 raw_data |

**归档区**：`_archive/` 只放冷备脚本，不参与日常链路；归档清单与"为何有些评审建议归档却保留在职"见 `_archive/README.md`。

**分层记忆法**：PC 侧 `*.ps1` 管"在 Windows 上点什么"；服务器侧 `*.sh`/`*.py` 管
"在 K40 上执行什么"；手机 Termux 侧管"Android 层保活"。三层各司其职，
**没有一个是另一个的替代品**——2026-10-20 架构评审曾误判"六套管家重复建设"，
逐项核查后确认全部在职（`con_hf/architecture_review_2026-10-20.md` §2.3）。


## 日常用法

链路不通时先跑：

```
pwsh -File ops/00_link_check.ps1
```

它会告诉你断在哪一段。若 FAIL，先搜 `con_hf/踩坑台账.md` 再动手。

重启手机后若 `sv status` 出现 `down: log`（坑 #88 复发），从归档区取回修复器再跑：

```
git mv _archive/ops/01_fix_svlogger.ps1 ops/01_fix_svlogger.ps1
pwsh -File ops/01_fix_svlogger.ps1
```

改完代码提交前跑：

```
pwsh -File ops/02_check_isolation.ps1
```

台账校验（一条命令，默认校验 SSD 数据面；`-LogsDir` 可指向别处做演练）：

```
pwsh -File ops/04_check_logs.ps1
```

它内部会自动 scp `03_check_logs_remote.sh` 到容器 `/tmp` 再执行，无需手动两步。
数据面未挂载时会明确报 `目录不存在` 而不是静默通过。

SSD 挂载好后，把 `test_use_data/` 三套可用数据推上三线 raw_data：

```
pwsh -File ops/05_push_testdata.ps1
```

SSD 未挂载时明确报错退出（不往 eMMC 静默落数据）。目标已有同名文件时默认拒绝，
确认覆盖加 `-Force`。传输走 scp 经 ssh 隧道直送目标目录，无中转（容器看不见 `/sdcard`，
见坑#95，所以不能用 adb push + staging 方案）。

**命名约定：Linux 系统内一律英文路径与文件名。** 本地 `test_use_data/` 下的中文目录名
（`测试数据3（可用）` 等）是用户既有资产不重命名，脚本内 `$datasets` 集中引用（改目录名
只改这一处）；推到服务器的文件名按 `$RemoteNameMap` 统一换英文（当前 `分组情况.txt`
→ `grouping.txt`），新增中文文件在映射表加一行即可。三套数据与三线的映射同样在 `$datasets`。

SSD 未在位但想验证脚本本身时，可跑演练（写到容器临时目录，不动真实数据面）：

```
pwsh -File ops/05_push_testdata.ps1 -Rehearse -SsdRoot /tmp/push_rehearsal
```

新增或修改线内分析脚本后（`src/<line>/scripts/`），必须重新部署才在服务器生效：

```
pwsh -File ops/06_deploy_scripts.ps1 -Line line1_bulk
```

部署目标 `<line>/bin/` 已由任务引擎注入 PATH（见 `BioanalysDesktop/server/task.js`），
step 名即文件名。字节校验与同名拒绝逻辑同 `05`；确认覆盖加 `-Force`。
目录约定（一个文件一个步骤、shebang、工作目录）见 `src/line1_bulk/scripts/README.md`。

修改出图模板挂载（`ops/layout_autoload/`）后需单独部署，不走 `06`：

```
scp ops/layout_autoload/sitecustomize.py k40-ubuntu:/mnt/ssd/bio_data/ops/layout_autoload/
scp ops/layout_autoload/Rprofile k40-ubuntu:/mnt/ssd/bio_data/ops/layout_autoload/
scp ops/layout_autoload/bin/Rscript k40-ubuntu:/mnt/ssd/bio_data/ops/layout_autoload/bin/
ssh k40-ubuntu "chmod 755 /mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript"
```

部署后下一次任务下发即生效（`task.js` 会在生成的脚本里注入 `PYTHONPATH`、`R_PROFILE_USER`
和 PATH 垫片）。验证方式：任务 stderr 出现 `[layout_autoload] 已挂载出图模板: <template_id>`。

## 部署落点与一致性（`src/` 镜像 vs `bin/` 执行）

远端有**两个落点**，别把它们搞混（裁定见 `con_hf/SPEC_DECISIONS.md` D-17）：

| 落点 | 谁写 | 谁用 | 权限 | 说明 |
| --- | --- | --- | --- | --- |
| `/mnt/ssd/bio_data/src/<line>/scripts/<step>` | `ops/sync_and_verify_remote.ps1` | 没人执行 | 644 | 仓库镜像，供审计、哈希对账、`diff` 查漂移 |
| `/mnt/ssd/bio_data/bin/<line>/<step>` | `ops/06_deploy_scripts.ps1` | 任务引擎（`task.js` 注入 PATH） | 755 | **真正跑的那份** |

结论：`sync` 成功 ≠ 引擎跑的是新版本。改完母版后的正确顺序是
`06_deploy_scripts.ps1 -Force` 部署 → `sync_and_verify_remote.ps1 -All` 对账。

`sync` 脚本第 6 步会单独核对「仓库 vs `bin/` 落点」，输出：

```
[ OK ] 部署一致性：仓库与 bin/ 落点 55/55 一致
[WARN] 部署漂移 3/55：仓库已改但 bin/ 未重新部署，引擎仍跑旧版本；跑 ops/06_deploy_scripts.ps1 -Force 修复
```

漂移结论同时写进远端 `system_logs/sync_manifest.json` 的 `deploy` 字段与 `con_hf/ops_ledger.md`
台账的「部署」列；带 `-FailOnDrift` 时漂移即 exit 1（可用于提交前检查）。`README.md` 这类文档
不进 `bin/`，不计入漂移。

## 离线参考数据：STRING v12.0（line1 步骤 8 用）

`src/line1_bulk/scripts/ppi_string` 是**离线优先**的：先读本机 STRING 边表，只有离线文件
完全不存在时才回落 `https://string-db.org/api/tsv/network`。K40 的外网不稳，生产跑批前应把
两份文件预下载好，放在：

```
/mnt/ssd/bio_data/public_references/stringdb/
  9606.protein.links.v12.0.txt.gz
  9606.protein.info.v12.0.txt.gz
```

下载：**在本机下好再 scp 进容器，不要直接在容器里 curl**（容器是 proot，长连接会被重启打断，
留下残片 `.gz`，见坑 P-19；本机实测 ~700KB/s，比容器内快且不被打断）：

```powershell
# ① 本机下载（可断点续传：-C -）
New-Item -ItemType Directory -Force -Path C:\Users\Public\stringdb | Out-Null
Set-Location C:\Users\Public\stringdb
curl.exe -sS -C - -o 9606.protein.links.v12.0.txt.gz https://stringdb-downloads.org/download/protein.links.v12.0/9606.protein.links.v12.0.txt.gz
curl.exe -sS -C - -o 9606.protein.info.v12.0.txt.gz  https://stringdb-downloads.org/download/protein.info.v12.0/9606.protein.info.v12.0.txt.gz

# ② 推上容器
ssh k40-ubuntu "mkdir -p /mnt/ssd/bio_data/public_references/stringdb"
scp C:\Users\Public\stringdb\9606.protein.*.txt.gz k40-ubuntu:/mnt/ssd/bio_data/public_references/stringdb/

# ③ 校验完整性（links 约 83MB 压缩 / 解压后 13,715,405 行（含表头，实测 2026-10-21）；info 约 2MB / 19,699 行）
ssh k40-ubuntu "cd /mnt/ssd/bio_data/public_references/stringdb && gzip -t 9606.protein.links.v12.0.txt.gz && gzip -t 9606.protein.info.v12.0.txt.gz && zcat 9606.protein.links.v12.0.txt.gz | wc -l"
```

`gzip -t` 不通过就是残片（下载被打断），删掉重下即可；`ppi_string` 现在会把这种残片
判成「离线文件读取失败（下载中断）」并给出同一条指引，不会再甩 Python traceback。

三个环境变量可在任务下发时覆盖（`server/task.js` 透传 env）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BIO_STRING_LINKS` | `<上面目录>/9606.protein.links.v12.0.txt.gz` | 边表；`.gz` 与解压后的 `.txt` 都支持 |
| `BIO_STRING_INFO` | `<上面目录>/9606.protein.info.v12.0.txt.gz` | 蛋白 ID → 基因符号映射表 |
| `BIO_STRING_MIN_SCORE` | `400` | `combined_score` 阈值（STRING 的 0..1000 口径，越界直接 fail） |

离线文件缺失时脚本**不会静默降级**：两条路都拿不到边表就打印下载指引并以 1 退出。
info 表缺失时保留 `9606.ENSP...` 原始 ID 并打 warning，不中断。

**当前状态（2026-10-21 实测）**：K40 上 `/mnt/ssd/bio_data/public_references/stringdb/`
目录**尚不存在**，即离线分支暂不可用。首次跑 line1 步骤 8 之前必须先按上面命令预下载，
否则任务只能走网络 API（外网抖动时直接 exit 1）。

## 路径速查

- Termux 底座别名：`k40`（8022）
- Ubuntu 容器别名：`k40-ubuntu`（10022）
- Termux 环境变量前缀：`/data/data/com.termux/files/usr`
- 服务目录：`$PREFIX/var/service/<svc>`，日志目录：`$PREFIX/var/log/<svc>`
- 数据面（未挂载）：`/mnt/ssd/bio_data/`。2026-10-13 复测结论：容器与底座两面 `/mnt/ssd`
  均非挂载点（`/proc/mounts` 无记录，实际在内部 226G 分区上），手机侧 Android 也未识别
  OTG 磁盘（`sm list-disks` 为空，`/storage/` 只有 emulated/self），SSD 未在位。

## 已知限制

- `ssh`/`scp` 首次连接会把 known_hosts warning 打进 stdout，脚本里已按特征行过滤；
  新增脚本解析远端输出时也要这么干（坑#90）。
- 容器（proot）读 Termux home 路径不可靠，脚本里的绝对路径要用容器侧自己的路径。
- PowerShell 不支持 `<` 重定向，`ssh ... < script.sh` 这种写法在本机不可用，改用 scp 传过去再执行。
- `04_check_logs.ps1` 跑完会在容器 `/tmp/` 留下 `03_check_logs_remote.sh`，不自动删（省一次 ssh 往返，方便手动复跑）。
