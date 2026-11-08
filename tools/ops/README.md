# tools/ops/ 链路运维脚本

> PC 侧入口用 PowerShell（`pwsh -File tools/ops/xx.ps1`）。
> 本机没有 bash 也没有 WSL，所以 bash 脚本只在服务器侧执行（scp 过去再跑）。
> 每个脚本都要有退出码：0 = 成功，非 0 = 失败并在输出里指明哪一环。

## 脚本清单

| 脚本 | 位置 | 用途 | 实测状态 |
|---|---|---|---|
| `00_link_check.ps1` | PC | 链路四段自检：设备 → forward → Termux sshd → 容器 sshd，加四服务状态 | exit 0 |
| `10_diagnose_abort.ps1` | PC | proot abort 分诊器（只读）：按 logcat 判 P-29（15 秒周期）/ P-23（容器内敏感命令）/ 未归类，逐类给处置步骤 | exit 0 无活动；exit 1 判出 P-23/P-29；exit 2 链路不通 |
| `_archive/tools/ops/01_fix_svlogger.ps1`（已归档 2026-10-21） | PC | 修复 log 子服务 crash-loop（坑#88），可回滚。一次性修复器，2026-10-20 reboot 后已执行完成；**若复发从 `_archive/` 取回**（`git mv _archive/tools/ops/01_fix_svlogger.ps1 ops/`） | exit 0 |
| 上述脚本依赖的模板 | PC → 手机 | `svlogger_sshd` / `svlogger_crond` / `svlogger_ssh-agent`（本地 `ops/` 下本就不存在，只在远端 Termux 服务目录） | 已生效 |
| `02_check_isolation.ps1` | PC | 校验 `src/<line>/` 代码无跨线引用 | exit 0，反向验证过 |
| `03_check_logs_remote.sh` | 服务器 | 校验台账 JSON 的 `line_id` 与路径合法性（含跨线、缺种子检查） | 双向验证过 |
| `04_check_logs.ps1` | PC | `03` 的一键入口：自动 scp + ssh 执行 + 传回退出码 | exit 0/1 三条路径验证过 |
| `05_push_testdata.ps1` | PC | 测试数据一键上盘（P1-2 预案）：探测 SSD 挂载面 → 建三线目录骨架 → scp 直送三线 raw_data（中文文件名换英文）→ 字节校验 | 完整链路已演练实测：11 文件 905 MB 全过 exit 0（2026-10-13，演练目录已清理）；SSD 在位后跑一次即正式上数 |
| `06_deploy_scripts.ps1` | PC | 步骤脚本部署通道：`src/<line>/scripts/` → 服务器 `<line>/bin/`，scp 直送 + chmod 755 + 字节校验 + `test -x` 复核。`-Line` 单线 / `-Force` 覆盖 / `-Rehearse` 演练 | line1_bulk 首脚本 probe_env 部署 exit 0；复验任务全链路 completed exit 0（2026-10-13） |
| `bio_watchdog.sh` | 手机 Termux | 保活看护（runit 监管）：每分钟重申 `termux-wake-lock` + 检查 5 个服务非 run 则 `sv up`。部署到 `~/p_actions/bin/`，服务目录 `$PREFIX/var/service/bio-watchdog/` | 2026-10-18 实测：唤醒锁 LONG 常驻；`sv down crond` 49 秒内被拉起；`kill -9` 后 runsv 5 秒自愈 |
| `fix_runsvdir.sh` | 手机 Termux | 双 runsvdir 抢锁修复（R15）：杀双 runsvdir+runsv+补杀 proot → 单实例 `runsvdir -P` 重拉 → `sv up` 六服务。**执行方式必须 `run-as com.termux sh <script>`**（直接 exec bash 被 Android W^X 拦） | 2026-10-20 真机 reboot 实战：R15 爆发后用本脚本修复，runsvdir 恢复为 1、六服务全 run（报告 `con_hf/2026-10-20_reboot_test.md`） |
| `08_migrate_to_projects.sh`（+ `.ps1` 一键入口） | 服务器 | 数据面引入项目维度后的一次性迁移：顶层平铺三线 `mv` 进 `projects/default/`，`bin/` `envs/` 提到顶层全局，旧台账 `io_files` 加 `projects/<项目>/` 前缀并补 `project_id`。同分区 rename 秒级完成，迁移前后逐线比对文件数与字节；幂等（已迁移直接 `ALREADY_MIGRATED` 退出 0） | 2026-10-14 迁移实测：文件数与字节逐线一致，旧台账重写后 04 巡检全过 |
| `render_report_html.py` | 服务器 | 把交付目录的 `Analysis_Report.md` 渲染成单文件出版级 HTML（内联 CSS、零外部依赖、含目录锚点与七章结构）。`--self-test` 跑内建用例（转义 / 死锚点 / 缺输入抛 `InputError`）；写盘前自校验，不自行容错 | 远端已部署；`BioanalysDesktop/tests/report_html.test.js` 覆盖 |
| `port_preflight.ps1` | PC | 端口占用预检：读取全部 TCP 状态，按进程命令行白名单区分本项目 Node 服务与外部进程。退出码 `0=free / 10=expected / 20=foreign / 2=error`，只有 `expected` 允许进入停止流程 | 2026-10-28 fixture 覆盖 free、Bound foreign、Listen expected；迁移后真机识别 18787 为本项目 Node expected |
| `serve_guard.ps1` | PC | 运行时守护：每 30 秒探活 18787 / 8080 / frpc。服务异常时先调 `port_preflight.ps1`，只停止命令行匹配本项目 Node 服务的 owner；外部进程占用只记录并按原样保留。`-DryRun` 只输出决策，不启动服务。默认工作台免口令，`-RequireAuth` 才启用口令；不注册开机自启 | 2026-10-28 迁移后 18787 五维自检 PASS，8080 `/health` 200 |
| `layout_helper.py` | 服务器 `tools/ops/` | 单图 SCI 三模板外挂装饰器（Python/matplotlib）：`apply_sci_plot_layout(fig, ax, spec, footnote_text, badge_text)`。读 `project.json` 的 `plot_layout_config`，落位标题/图例/X 轴避让/脚注栏，返回 dpi | 2026-10-18 本机 31 条断言全过（含几何审计零违规）+ 远端部署冒烟通过；已部署 `/mnt/ssd/bio_data/ops/` |
| `layout_autoload/sitecustomize.py` | 服务器 `tools/ops/layout_autoload/` | Python 解释器级模板挂载：任务脚本把本目录放进 `PYTHONPATH`，启动即读 `BIOANALYS_PROJECT_JSON` 并包装 `Figure.savefig`。母版脚本零改动 | 2026-10-18 远端 16 条断言 + 真实 `bulk_figures` 端到端通过（DPI 300、画布按模板重设） |
| `layout_autoload/Rprofile` | 服务器 `tools/ops/layout_autoload/` | R 端模板挂载：包装 `ggplot2::ggsave`，摘掉母版自带的 `width/height/units/dpi` 后按模板落盘 | 2026-10-18 真实 `pca_matrix` 端到端通过（PDF 518×291 pt ≈ 7.19×4.04 in，16:9） |
| `layout_autoload/bin/Rscript` | 服务器 `ops/layout_autoload/bin/` | `Rscript` 垫片：母版统一用 `--vanilla`（会跳过 `R_PROFILE_USER`），垫片把它降级为等价组合并保留 user profile。任务脚本把本目录排在 PATH 最前 | 2026-10-18 真实 `pca_matrix` 验证：无垫片时 6×5 in 原尺寸，加垫片后模板生效 |
| `../bin/layout_helper.R` | 服务器 `bin/` | 同上（R/ggplot2）：`apply_sci_plot_layout_r(p, spec, footnote_text, badge_text)` + `layout_save_r()` | 2026-10-18 在 k40-ubuntu 实跑 24 条断言全过，三模板均落盘；已部署 `/mnt/ssd/bio_data/bin/` |
| `build_client_report.py` | 服务器 `tools/ops/` | 客户交付包七章解读报告引擎：扫描项目产物 → 生成 `Analysis_Report.md` + 单文件交互 `Analysis_Report.html` → 归集 `01_Adapted_Scripts` / `02_Figures_and_Tables` / `03_Interpretation_Report` → 打 `<id>_Client_Delivery.tar.gz`。`--dry-run` 预览、`--no-tar` 只出三大件、`--self-test` 自检。第二章新增「软件与版本登记 / 随机种子 / 方法学引用」三段，数据读 `software_versions.json` + `reference_citations.json`（缺失时正文明确写"版本清单缺失"，不静默） | 2026-10-19 S11 后自检 30 条全过；`PRJ_E2E_GSE277173` 实跑 exit 0，版本表含 WGCNA 1.74 / limma 3.58.1，引用 2 条（WGCNA + Bioconductor），limma 明写"本目录无原始论文" |
| `gen_reference_index.py` | 本地仓库 | 从 `reference/生信分析可用参考文献/citations.json` 生成人读索引 `INDEX.md`，并逐个校验 PDF 路径真实存在（`--check` 只校验不写盘）。改文献信息改 JSON 后重跑，避免索引与报告引用两套说法 | 2026-10-19 生成 18 个 PDF 全覆盖索引，`--check` PASS |
| `run_throttled_task.sh` | 服务器 | 统一降权执行包装器 + 自动台账 JSON（aims §六.3）。默认不绑核仅 nice/ionice 降权（2026-10-20 契约变更，实测 EAS 动态调度更快），`BIO_PIN_CPUS=4,5,6` 可恢复静态绑核 | 长任务守护主通道；**台账只有 `project_id`/`random_seed` 两字段的历史缺口待补** |
| `verify_bridge_checkpoint.py` | 服务器 | 跨语言转换四项断言（基因名完整性 / 矩阵行列方向与稀疏性 / 细胞 Barcode 顺序 / 降维与空间坐标保留） | **当前 58 个分析脚本 0 次调用它（aims §一.3 铁律空转）**，18787 提交层统一接线在整改队列 |
| `check_storage_and_isolation.sh` | 服务器 | 存储水位门禁（<20% 阻断）+ FUSE 红线 + 跨线路径静态扫描（aims §六.2 四门禁） | 隔离红线的服务器侧执行者 |
| `bio_limits.sh` | 服务器 | 容器全局线程封顶与无头渲染配置（aims §六.1，落 `/etc/profile.d/`） | 已在容器生效 |
| `bio_memory_guard.py` | 服务器 | Python 脚本级 7.5GB 软熔断头部模板（aims §六.4） | 与 `bio_r_header.R` 配对 |
| `bio_r_header.R` | 服务器 | R 脚本级 7.5GB 防崩头部模板（aims §六.4） | R 脚本入口 `source()` 它 |
| `07_pull_outputs.ps1` | PC | 产物回搬通道：远端 `projects/<id>/<line>/{figures,results}` → 本地 `outputs/`；同名同大小才跳过（#186 修复后规则）+ 字节校验 | 与 `06` 构成"下发-回搬"一对 |
| `08_migrate_to_projects.ps1` / `.sh` | PC / 服务器 | 数据面一次性迁移：顶层三线目录 → `projects/<id>/<line>/` 结构（2026-10 已完成的历史迁移） | 历史工具，保留备查 |
| `09_snapshot.ps1` | PC | 工作区快照：源码 + 台账打成带 SHA256 的 zip 落 `snapshots/`，`.git` 只读、无法 commit 时充当回滚点。`-Keep` 保留代数 / `-Note` 备注 / `-DryRun` 演练 | 实测 775 文件 86.7MB，解压后 775/775 字节一致 |
| `audit_figure_layout.py` | 服务器 | 出图布局合规审计（真渲染判决 A–E，`--runner bash --seed` 真跑脚本取几何） | 出图规范四工具之一；`--seed` 必须传真种子（#190 教训） |
| `build_figure_catalog.py` | PC | 把外部图码交付包导入项目候选库：按单图状态拆分，生成 `catalog.json`、`manifest.csv`、独立代码文件和单图预览，并保留验证/阻塞状态 | 2026-10-27 候选库 772 条，其中 438 条通用候选、16 条 K40 验证通过 |
| `verify_figure_catalog.py` | PC/K40 | 批量验证 Python 候选：外部 seed、Agg、单图输出、PNG 校验、证据归档和失败分类 | 2026-10-27 22 条实跑，8 通过、6 缺依赖、8 外网失败 |
| `figure_catalog_r_adapter.R` | K40 | R 单图输出适配器：统一 PNG 设备、外部 seed 和单图落盘 | 2026-10-27 批量 19 条中 6 通过，9 缺依赖，4 代码失败 |
| `analyze_figure_catalog_splits.py` | PC | 对页面级多图记录生成单图拆分计划，输出 split_ready、缺主图、人工映射和外网阻塞分类 | 2026-10-27 179 条全覆盖 |
| `materialize_figure_catalog_splits.py` | PC | 消费 split_ready，按代码 cell 和图片顺序生成单图代码与预览候选 | 2026-10-27 23 条记录生成 82 个候选，23 个有本地主图 |
| `verify_plot_matrix.py` | 服务器 | 参考出图库源码级矩阵验证：逐个隔离运行 R/Python 入口，检查 `RENDER_OK`、PNG 解码与非空白、PDF 文件头和产物 SHA256，输出 `plot_matrix.json`、`PLOT_AVAILABILITY.md` 与 `summary.tsv` | 2026-10-27 K40 实跑 27/27 非隔离源码通过，1 个隔离文件按策略排除 |
| `stage_plot_matrix.ps1` | PC | 把中文源码路径复制为纯英文 payload，供 K40 矩阵验证使用，并保留原始源码 SHA256 清单 | 2026-10-27 28 条目 staging 通过 |
| `build_plot_contact_sheet.py` | 本地可视化 | 从 `plot_matrix.json` 生成带条目标签的 QA 总览。使用与交付单位始终是单张图，总览不进入成品 | 2026-10-27 41 张 PNG QA 总览生成成功 |
| `skip_reason_gate.mjs` | 仓库 | 条件跳过原因白名单门禁（Argon 第二十一轮 Q4）：静态扫 `tests/*.test.js` 的 skip 表达式（常量展开、注释与字符串不误伤），运行时解析 TAP 的 `# SKIP` 原因。白名单 = HOST_MISSING_BASH / PYTHON / ANNDATA / RSCRIPT + HOST_UNREACHABLE_K40 / HOST_MISSING_LOCAL_DATA；裸 `skip: true`、空原因、枚举外标签一律判红。`main()` 可直接进程内调用，CLI 亦可用 `--tests-dir` / `--tap-file` / `--tap-stdin` | 2026-11-03 静态面 116 文件全绿；真实全量 TAP 18 条跳过全带标签；构造 6 类违规全红；变异反证 5/5 红 |
| `clean_workspace.mjs` | 仓库 | 工作区清理（Ticket 4）：默认演练只报清单不删，`--execute` 才真删；白名单只含 .tmp / 过期解包 / 超期日志；神圣黑名单（审计流、ops/、src/、server/、docs/、.git/、D:\Backup\k40_cold）扫描与删除各熔断一次 | 通则 222MB 候选零改动；真删实测审计流与回执原样保留；变异 5/5 红 |
| `preflight.mjs` | 仓库 | 宿主机依赖预检（Ticket 3）：必需项 node>=22/ssh/scp 缺失即 exit 1，可选 adb/tar/python 只 warn；纯 PATH+版本检查不起子进程；`--path` 可注入假 PATH 测红路径 | 真机必需项全绿；空 PATH 与低版本 node 两条红路径实测 |
| `audit_summary.mjs` | 仓库 | 跨项目交付审计只读汇总（收官拼图）：扫各项目 deliverables 下的 acceptance_audit.jsonl，校 7 个标准键，坏行报 INVALID_AUDIT_LINE 不静默，输出总次数/唯一项目数/累计校验数/最近一次；`--root` 可注入夹具，`--json` 机器读；零写操作 | 真数据 1 次交付 357 文件；夹具多项目合并/空目录/坏行三向实测；变异 5/5 红 |
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
| 容器 15 秒一崩 / proot abort | `10_diagnose_abort.ps1`（只读分诊，按 P-29/P-23 给处置） | 直接 `proot-distro reset` 重装（最后手段，先分诊） |
| 18787 或 8080 服务没起/崩了 | `serve_guard.ps1`（注入口令常驻） | 裸 `node server/index.js`（缺口令环境） |
| 手机六服务挂 / reboot 后双 runsvdir 抢锁 | `fix_runsvdir.sh`（必须 `run-as com.termux sh` 执行） | 逐条 `sv up` 手工拉 |
| Termux 服务被系统杀 | `bio_watchdog.sh`（runit 自愈，49 秒拉起） | 另写 cron 保活 |
| 改完分析脚本要上线 | `06_deploy_scripts.ps1 -Line <线>` | 手动 scp（无字节校验） |
| 跑完要收图收表 | `07_pull_outputs.ps1 -Project <项目> -Line <线>` | 手动 scp 单文件 |
| 台账合法性存疑 | `03_check_logs_remote.sh`（`04` 是它的一键 PC 壳） | 人肉 cat JSON 判断 |
| 代码疑似跨线引用 | `02_check_isolation.ps1` | grep 了就算 |
| 图件合规存疑 | `docs/figure_spec.md` §七 四工具 | 肉眼看 |
| 要给客户交付 | 18787 `/api/report/build`（内部调 `build_client_report.py`） | ssh 上手跑 CLI（S27 前的老路） |
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
git mv _archive/tools/ops/01_fix_svlogger.ps1 tools/ops/01_fix_svlogger.ps1
pwsh -File tools/ops/01_fix_svlogger.ps1
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

## 容器内禁用递归遍历命令（会让 proot 自己 abort，杀掉在跑任务）

2026-10-21 实测：在 `k40-ubuntu` 容器里执行 `ps -eo ...` / `pgrep -a ...` / `pkill` / `grep -r ...` / `find ...` / `du` / `ls -R`
这类**递归目录遍历**命令（`ps`/`pgrep` 遍历 `/proc`，`grep -r`/`find` 走 fts(3) 逐层下降），
会触发 proot 的路径断言并让**整个容器退出**（Termux 侧 `$PREFIX/var/log/ubuntu-sshd/current` 里留下
`./path/path.c:546: ... assertion "length1 > 0" failed` + `proot warning: signal 6 received`），
容器内正在跑的分析任务（含已跑 31 分钟的 SCENIC）随之消失、不留台账。详见 con_hf/pitfalls_ledger.md P-23。

判活 / 取证的替代手段（都在容器内安全）：

| 想知道 | 别用 | 改用 |
| --- | --- | --- |
| 容器还活着吗 | `ps -eo pid,etime,comm \| grep proot` | `ssh k40-ubuntu 'echo ALIVE'`（跑通即活） |
| 某步跑完了吗 | `pgrep -a python3` | `ls -t /mnt/ssd/bio_data/system_logs/*<PROJECT>* \| head` |
| 产物有没有更新 | `ps -eo pcpu,args` | `ls -lt <项目>/<线>/processed \| head` |
| 容器有没有重启 | 容器内 `uptime`（静态假文件，P-22） | Termux 宿主侧 `ssh k40 'ps -eo pid,etime,args \| grep -i proot'` |
| 某个文件在不在 | `find /mnt/ssd -name 'x*'` | `ls -t /mnt/ssd/bio_data/system_logs/*x* \| head` 再逐个 `test -f` |
| 某目录里有几个文件 | `du -sh` / `ls -R` | `ls -1 <dir> \| wc -l`（只列一层） |

判据：**只要一条命令会「自己决定下一层看哪个目录」就属于危险集合**；
显式点名路径的 `ls <dir>`、`ls -t <glob> | head`、`cat <file>`、`test -f <file>` 是安全的。
13:09 那次连崩就是一条 `grep -rl <taskId> system_logs/` 造成的（没有 ps 参与）。

注意：宿主侧 `ps` **看不到** guest 进程（`ssh k40 'ps -eo ... \| grep python3'` 输出为空），
所以它只能用来判「proot 进程有没有换 pid」，不能用来判任务存活。
`BioanalysDesktop/tests/proot_probe_guard.test.js` 会静态拦住往容器里塞这些命令的脚本。

## 怎么判断「任务还在跑」还是「卡死了」（判活口径）

容器内**没有任何可信的进程级信号**：`/proc/loadavg` 读的是 Android 宿主的全局负载（任务在满负荷跑时它可能显示 0.1），
`uptime` 是 proot bind 进来的静态假文件，`/proc/<pid>/cmdline` 不可读，guest 进程在宿主 `ps` 里也看不到。
2026-10-21 就有人拿 `loadavg=0.12` + 「processed 没新文件」判 scenic_tf 卡死，连续误杀两次（真跑 30 分钟才出产物）。

按这个顺序判活，只有这四步可信：

| 顺序 | 手段 | 命令 / 位置 |
| --- | --- | --- |
| ① | 引擎 SSE 日志（最直接，实时远端 stdout） | `GET /api/tasks/logs?id=<taskId>` |
| ② | 该步临时产物出现 | 例：scenic_tf 的 `processed/_scenic_expr_tmp.csv`（约 2 分钟） |
| ③ | 台账新增 | `ls -t /mnt/ssd/bio_data/system_logs/*<PROJECT>* \| head` |
| ④ | 产物 mtime | `ls -lt <项目>/<线>/processed \| head` |

**不能当判活依据**：`/proc/loadavg`、进程数、`/api/tasks` 里任务在不在。
`/api/tasks` 里任务消失只说明本机 ssh 子进程结束；没有台账就是「被杀 / 无输出退出」，这时看日志，不要猜。

安全的旁证：本机 `Get-CimInstance Win32_Process` 看 ssh.exe 的 CommandLine（能看到引擎下发的完整远端命令，可用于手工复现），
以及 Termux 宿主侧 `ssh k40 'ps -eo pid,etime,args \| grep -i proot'`（只判容器是否换 pid）。

详见 con_hf/pitfalls_ledger.md 的 P-23（递归遍历会 abort proot）与 P-24（loadavg 是宿主负载）。

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

## 季度例行维护（工作区瘦身流程，2026-10-31 沉淀）

每季度（或 D 盘可用空间低于 20%）跑一轮两阶段清理。核心纪律：删前零引用核查，删后落台账。

### 阶段 A：零引用残留清理

1. 找残留：`.Temp`、`.tmp`、`.uploads`、`backups`、`cache`、`__pycache__`、`*.pyc`、
   根目录隐藏探针脚本（`.probe_*.sh`、`.run_*.sh`、`.tmp_probe.sh`）、
   `BioanalysDesktop` 下 `.tmp`（ko-gene 测试目录会积累数百个）、`.Temp`、`.uploads`、
   `artifacts`、`console`、`test-results`、`tests\.build`、`server\runtime\.generated`。
2. 逐项确认零引用：在代码（排除 node_modules/dist）、`docs`、`con_hf` 台账文本里搜目录名。
   零引用才进删除清单；有引用的单独记录原因。
3. 删除必须走带路径守卫的脚本：先 `Resolve-Path`，断言结果以工作区根开头，越界直接跳过。
   删除脚本用完即删，不留工作区。
4. E2E spool 类（`con_hf/sync/e2e_*`、`portal/inbox/sync_results`）按 mtime 清 7 天前的。

### 阶段 B：重复与大体量裁定

1. 重复核查交给子代理做哈希级比对（文件名+大小全量匹配，抽样 SHA256），禁止凭文件名目测判重复。
2. 大体量目录（>100MB）删除必须用户裁定，逐项列「体量 / 真源在哪 / 删除后果」三要素。
3. 远端 SSD 为真源的本地回搬副本（`outputs/<项目>`、`local_projects/<项目>/data`），
   删除前确认 `ops/07_pull_outputs.ps1` 可随时拉回。
4. 不可逆参考数据（如 `cn_debug/scenic_db`）默认保留，重下需要网络的都算不可逆。
5. 每次清理后：更新 `con_hf/handoff.md` 头部与第二十轮式清理小节，记录删除清单、
   保留裁定与前后磁盘空间；`.gitignore` 同步增补忽略声明，防止已删目录复活。

### 台账与验收

- 验收判据：`git status --untracked-files=normal` 中临时目录残留为 0；handoff 有本轮记录；磁盘空间变化有数字。
- 本轮执行记录：2026-10-31 第二十轮，释放约 37 GB（D 盘 47.3→84 GB），详见 `con_hf/handoff.md`。