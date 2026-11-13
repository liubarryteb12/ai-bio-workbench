# B1 清理 + B2 归档 执行报告（2026-10-21）

> 依据：用户 2026-10-21 授权（"B1 清理，B2 归档……采纳"）+ `con_hf/architecture_review_2026-10-20.md` §2.1/§2.2/§2.3。
> 执行者：Lead。性质：不可逆操作（B1 删除）+ 可回滚移动（B2 归档，走 `git mv` 保留历史）。

## 一、B1 清理（已执行）

| 项 | 评审预期 | 实测 | 处置 |
|---|---|---|---|
| `cn_debug/scenic_db/`（689MB） | 删除 | **已不存在**（早前清理过） | 无需动作 |
| `ops/__pycache__/` | 删除 | 不存在；但仓库内另有 7 个 `__pycache__` | 全部删除 |
| `cn_debug/subagent_*.log`（24 个 4.9MB） | 删除 | 实为 21 个 `*.log` 共 **497,925 字节（486KB）** | 全部删除 |

实测释放：**1,042,977 字节（约 1.0MB）**——其中 `*.log` 21 个 486KB、`__pycache__` 7 个 532KB（`cn_debug` 1 个 + `project_data/` 4 个 + `reference/` 2 个）。

删除清单（`cn_debug/`，全部被 `.gitignore:52` 的 `*.log` 忽略，删除不进版本库）：
`figure_audit_sweep_subagent_s2.log`、`figure_audit_sweep_subagent_s3.log`、`subagent_s27/s28/s28b/s31.log`、`serve_guard.log`、`workbench_err/out/server.log`、`portal_server.log`、`s50_rerun_clean.log`、`s9_run_stdout.log`、`2026-10-19_e2e_line2_smoke.log`、`2026-10-19_verify_step_catalog.log`、`2026-10-20_s26_e2e_server_stderr.log`（0 字节）、`figure_audit_sweep_s4c_v9.log`、`_s28_check1/check2/probe/run3.log`。

**保留**：`_s28_forensic.sh`、`_s28_probe_bridge_output.mjs`、`_s31_probe_state_db.py` 等取证脚本（非日志，是 S28/S31 归因证据，见 `con_hf/dispatch/S30_audit_report.md` §A）。

结论修正：评审预期的 689MB 级收益**已不存在**，B1 实际收益约 1MB；它的真实价值是把调试目录里的过程垃圾清空，让 `cn_debug/` 只剩可引用证据。

## 二、B2 归档（部分执行，附理由）

新建 `_archive/`（评审点名的目录，此前不存在），结构 `_archive/{README.md, docs/, ops/}`。

### 已归档（`git mv`，历史保留）

| 新路径 | 原路径 | 理由 |
|---|---|---|
| `_archive/docs/geo_mining_sop_v1.md` | `docs/geo_mining_sop_v1.md` | 已被 v2 取代，v1 自带取代横幅（:3-5 "不要基于本文件修订"） |
| `_archive/ops/01_fix_svlogger.ps1` | `ops/01_fix_svlogger.ps1` | 一次性修复器（坑 #88），2026-10-20 reboot 后已执行完成，不属日常链路 |

引用同步：
- `ops/README.md` 脚本清单第 12-13 行改指归档路径并写明取回命令；"日常用法"第 86-90 行改为"坑 #88 复发时从归档取回再跑"；决策表前新增"归档区"说明行。
- `docs/geo_mining_sop_v2.md:3` 版本记录改指 `_archive/docs/geo_mining_sop_v1.md`。

### 评审建议归档但**保留在职**（不执行归档，逐条给理由）

评审 §2.3 的"守护六套 → 两套、日志检查两套 → 一套"与 A6 结论冲突：A6 逐项核查后判定**全部在职**（已写进 `ops/README.md` §分层记忆法 第 68-71 行），且这四个脚本正是决策表"该信哪个：唯一入口"里四个场景的唯一答案。归档它们会让决策表指向空路径。故保留，理由与"若真要归档需同步改哪些文档"记入 `_archive/README.md` §二：

| 脚本 | 保留理由（一句话） |
|---|---|
| `ops/serve_guard.ps1` | 8787/8080/frpc 的唯一常驻守护入口；`docs/user_portal_deploy.md` §74-97 全部以它为准 |
| `ops/bio_watchdog.sh` | 基础用户空间 保活正本模板；`docs/termux_keepalive.md` 四处引用 |
| `ops/fix_runsvdir.sh` | reboot 后双 runsvdir 抢锁（R15）唯一修复入口，2026-10-20 真机用过 |
| `ops/04_check_logs.ps1` | 台账校验 PC 侧一键壳；`03_check_logs_remote.sh` 是它调用的服务端本体（壳+体，不是重复） |
| `ops/svlogger_*` 三个目录 | 本地 `ops/` 下本就不存在（只在远端 基础用户空间 服务目录），无可归档对象 |

执行前已确认：无 Windows 计划任务引用 `serve_guard`（`Get-ScheduledTask` 匹配 0 条）、无 `serve_guard`/8787/8080 进程在跑，移动不影响正在运行的服务。

### 未批量归档：`cn_debug/` 一次性探针

`cn_debug/` 有 266 个受版本控制文件（约 33MB）。评审 §2.2 说"一次性探针可归档"，但 §2.5 同时要求"保留判决证据"，且 `con_hf/dispatch/` 的报告逐条按 `cn_debug/<文件名>` 引用——批量移动会让这些引用失效。
处置改为**建索引不搬家**：新增 `cn_debug/README.md`，五节登记（判决证据勿删 / 验证脚本按切片 / 一次性探针可删 / 目录说明 / 已清理记录），并规定"新增探针必须登记"。

## 三、验证

- `git status` 显示两个 `git mv` 为重命名（历史连续），无内容丢失。
- 归档文件可 `git mv` 原路取回（README 已给命令）。
- 未改任何运行时脚本的 import/source 关系（归档的两项均无代码引用：`01_fix_svlogger.ps1` 只被 README 文档引用，`geo_mining_sop_v1.md` 只被 v2 版本记录引用）。
- 全量 `npm test` 在切片收口时统一跑（见收口报告）。

## 四、遗留

1. `con_hf/2026-10-20_调研_三线定制数据集与实验设计.md:145` 仍写 `docs/geo_mining_sop_v1.md`——历史调研文档，按"台账追加不重写"纪律未改，读者按 v2 版本记录可跳转。
2. `cn_debug/` 里 `s3_*`/`s4_*`/`s5*` 系列原型脚本（约 100 个）确属"可删"，但它们是三线母版脚本的演化证据，按 §2.5 保留；如后续确认不需要，可整体移入 `_archive/cn_debug/`。
3. `ops_legacy_2026-10-20/`（`cn_debug` 下）与 `_archive/` 存在语义重叠，下一轮可合并。
