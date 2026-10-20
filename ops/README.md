# ops/ — 链路运维脚本

> PC 侧入口用 PowerShell（`pwsh -File ops/xx.ps1`）。
> 本机没有 bash 也没有 WSL，所以 bash 脚本只在服务器侧执行（scp 过去再跑）。
> 每个脚本都要有退出码：0 = 成功，非 0 = 失败并在输出里指明哪一环。

## 脚本清单

| 脚本 | 位置 | 用途 | 实测状态 |
|---|---|---|---|
| `00_link_check.ps1` | PC | 链路四段自检：设备 → forward → Termux sshd → 容器 sshd，加四服务状态 | exit 0 |
| `01_fix_svlogger.ps1` | PC | 修复 log 子服务 crash-loop（坑#88），可回滚 | exit 0 |
| `01_fix_svlogger.ps1` 依赖的模板 | PC → 手机 | `svlogger_sshd` / `svlogger_crond` / `svlogger_ssh-agent` | 已生效 |
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

### 交付报告依赖的两份清单

| 清单 | 仓库正本 | 服务器部署位置 | 说明 |
|---|---|---|---|
| 软件版本 | `docs/software_versions.json` | `ops/software_versions.json` | 版本号由 `cn_debug/2026-10-19_s11_collect_versions.py` 在算力容器内实采，不许手抄；每条带 `source` 实测命令与 `lines`（该包被哪条线用） |
| 文献索引 | `reference/生信分析可用参考文献/citations.json` | `ops/reference_citations.json` | 报告方法学引用只读这一份；`INDEX.md` 是它的人读视图 |

部署方式与 `build_client_report.py` 相同（scp 直送 `ops/`）。两份清单都缺失时报告照常生成，
只在正文写明缺什么——报告引擎不允许因为缺清单就静默少写一段。


## 日常用法

链路不通时先跑：

```
pwsh -File ops/00_link_check.ps1
```

它会告诉你断在哪一段。若 FAIL，先搜 `con_hf/踩坑台账.md` 再动手。

重启手机后若 `sv status` 出现 `down: log`，跑：

```
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
