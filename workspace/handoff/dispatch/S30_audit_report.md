# S30 审计报告（S31-audit）

> 任务：共享任务板 task-3（S31-audit），只读审计 A/B/C/D 四节。
> 执行：子 Agent audit-probe。项目根 `D:\00.AIagent\codespace\AI辅助生信分析流程工作台`。
> 边界声明：本轮未修改任何源码、配置、远端文件；未执行 git 写操作；未删除任何文件；未安装任何包；未起停常驻服务。只写了本报告与 `cn_debug/_s31_probe_state_db.py` 一个只读探针。
> 基线：`npm test`（BioanalysDesktop）实测 **tests 339 / pass 339 / fail 0，exit code 0**（任务书基线 296，现为 339，增量来自 S28/S29/S30 未提交的测试文件）。所有结论附真实命令与输出摘要，未验证项单独标注。

---

## 0. 结论速览

| 节 | 问题 | 结论 |
|---|---|---|
| A | S28 报告 3 条待归因台账 | **明确归因**：全部是 8787 引擎（`server/run.js`）写的台账，来源是**两个执行者并发跑同一个验证脚本**：S28 主会话 2 条（17222ebe/25d51e17）+ 第三方并发执行者 3 条（58546485/86b31149/c2cc6e68）。已排除 ops 包装器、第二 8787 实例、计划任务、守护脚本、远端 cron/runit。仅 58546485、86b31149 缺第三方会话转录，无法 1:1 映射到具体运行记录 |
| B | D1-D7 规格漂移 | D3 已修、D4 已作废（用户裁定）；D1、D2、D5、D6 **仍在**；D7 维持跳过（非缺陷） |
| C | A 批 A1-A8 | A1、A2、A3、A4、A5、A6、A7 已完成；A8 **一半**（白名单已统一，断点续传未做，与 D5 同源） |
| D | B 批不可逆清单 | B1 的 3 项里 2 项已不存在（scenic_db 689MB、ops/`__pycache__`），subagent 日志只剩 4 个 237KB；B2 归档**完全未执行**（`_archive/` 不存在）。剩余可删总量约 0.36MB，已无 689MB 级收益 |

---

## A. S28 报告 3 条待归因台账（最高优先级）

### A.1 远端台账清单（只读实测）

命令：
```
ssh -o BatchMode=yes k40-ubuntu "ls -l --time-style=full-iso /mnt/ssd/bio_data/system_logs/ | grep gsva_pathways"
```
结果：`system_logs/` 共 298 个文件，其中 `gsva_pathways` 台账 **7 条，全部 836 字节**：

| 台账（task_id 前 8） | 文件 mtime（UTC） |
|---|---|
| 58546485 | 2026-10-20 15:09:33.11 |
| 17222ebe | 2026-10-20 15:09:42.95 |
| 86b31149 | 2026-10-20 15:10:35.13 |
| c2cc6e68 | 2026-10-20 15:11:46.20 |
| 25d51e17 | 2026-10-20 15:12:18.45 |
| d657656f | 2026-10-20 15:25:20.67 |
| af52f80e | 2026-10-20 15:26:01.26 |

（S28 报告只提了前 5 条；后 2 条是上一轮审计会话的复核运行，见 A.3。）

### A.2 逐字段比对：判给 8787 引擎

`cat` 全部 5 条（58546485/17222ebe/86b31149/c2cc6e68/25d51e17），字段完全同构，以 58546485 为例：

```json
{
  "task_id": "58546485-bc48-4330-a2c4-857fb0d0a740",
  "project_id": "default",
  "line_id": "line2_scrna",
  "step_name": "gsva_pathways",
  "status": "failed",
  "environment": {"language": "Python", "version": "3.12.3", "env_name": "line2_scrna_env",
                  "container_image": "容器-ubuntu24.04-aarch64", "random_seed": 20261013},
  "resource_usage": {"max_cpu_percent": null, "max_memory_gb": null, "disk_io_peak_mb_s": null},
  "io_files": {"input": ["/mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_annotated.h5ad"], "output": []},
  "checkpoint_status": "failed",
  "error_log": "stderr 为空，退出码非零",
  "exit_code": null,
  "next_action_suggested": null
}
```

与两个候选写入方逐字段比对：

| 字段 | 实测台账 | `server/run.js` + `server/task.js` buildLedgerEntry | `ops/run_throttled_task.sh` |
|---|---|---|---|
| 文件名 | `2026-10-20_default_line2_scrna_gsva_pathways_<id8>.json` | 一致（run.js:151-161 `buildLedgerFileName`） | `<task_id>_ledger.json`，task_id 形如 `task_<epoch>_<rand>` |
| task_id | UUIDv4 | 一致（run.js:45 `randomUUID()`） | shell 生成，非 UUID |
| project_id | default | 一致 | **无此字段** |
| environment.random_seed | 20261013 | 一致 | **无此字段** |
| environment 其余 | language/version/env_name/container_image | 一致（task.js:249-309） | 只有 language/wrapper/memory_limit_gb:7.5 |
| io_files / resource_usage / exit_code / next_action_suggested | 存在（部分 null） | 一致 | **全部无** |
| checkpoint_status | `failed` | 一致 | 只写 `passed`/`halted` |
| error_log | `stderr 为空，退出码非零` | 一致（run.js:83 回退字符串） | 写远端日志路径 |

结论：**这 5 条台账只可能由 8787 引擎（server/run.js）产生，可排除 ops/run_throttled_task.sh 包装器来源**。
另：5 条 start_time→end_time 间隔仅 24~34ms，`exit_code: null` 表示 ssh 子进程被信号杀死（`child.kill()`），即「提交成功后立刻 stop」，与 S28 验证脚本注释「正路径任务被 stop，会按既有 stop 行为落一条 failed 台账」一致，不是真实业务失败。

### A.3 归因映射：两个执行者并发跑同一脚本

关键在 task_id 的毫秒段（`default-line2_scrna-<epoch_ms>`）与台账 start_time 的对应关系：

| 台账 | start_time (UTC) | 对应提交 taskId | 提交时刻 (UTC) | 来源 |
|---|---|---|---|---|
| 17222ebe | 15:09:40.948 | `default-line2_scrna-1792508969786` | 15:09:29.786 | S28 主会话 `3b843c` 第 1 次运行（`/api/tasks` 回报 startedAt=15:09:40.96Z） |
| 25d51e17 | 15:12:16.399 | `default-line2_scrna-1792509126608` | 15:12:06.608 | 同会话第 2 次运行（startedAt=15:12:16.41Z） |
| c2cc6e68 | 15:11:44.188 | `default-line2_scrna-1792509096095` | 15:11:36.095 | `cn_debug/_s28_run3.log` 记录（startedAt=15:11:44.201Z），**不在 3b843c 会话的两次运行里** |
| 58546485 | 15:09:31.148 | 无留存日志 | 约 15:09:20 | 同一第三方执行者的第 1 次运行 |
| 86b31149 | 15:10:33.132 | 无留存日志 | 约 15:10:22 | 同一第三方执行者的第 2 次运行 |

证据链：
1. hermes 会话库（只读 sqlite，探针 `cn_debug/_s31_probe_state_db.py`，`mode=ro`）：S28 主会话 `20261020_224455_3b843c`（22:44:56 至 23:18:41，123 条消息）在台账窗口内对验证脚本的 terminal 调用只有 2 次成功运行（23:09:24 与 23:12:01），**只产生 2 条台账**。此前 3 次运行分别崩在 `spawn ENOENT`、`spawn node ENOENT`、`服务未就绪 / MODULE_NOT_FOUND`，均未走到 submit。
2. `cn_debug/_s28_run3.log`（1793 字节，mtime 23:12:10）里的 taskId `...096095` 精确对应 c2cc6e68，但该 taskId 不在 3b843c 会话中，说明**存在第三个执行者**在同一时段（23:09 至 23:12）跑同一脚本至少 3 次（文件名「run3」自证至少 3 次），每次各自 freePort 起独立临时 server（端口随机，互不冲突，所以 5 条台账能并存）。
3. 三次台账间隔 62s/71s，符合同一 agent「改脚本、重跑」的节奏；提交 body 完全一致（projectId=default、line2_scrna、gsva_pathways、inputs=[scrna_annotated.h5ad]、seed=20261013）。
4. 交叉扫描 3 个 hermes profile 的 state.db 与主库（87935 条消息）：窗口内除 3b843c 外无任何会话出现 gsva_pathways 或 `/api/tasks/submit` 相关内容，说明第三方执行者不在 hermes 里，属于 DSH 侧（本工作台团队/审计会话）。
5. DSH 侧 `.dsh/sessions` 递归过滤 2026-10-20 23:00 至 23:30 的写入返回空，搜 `1792509096095`、`verification_s28_bridge` 也 0 命中，**第三方会话转录已不可取证**，只能靠 `_s28_run3.log` 反推。

### A.4 本机第二实例 / 守护排查（全部排除）

```
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | select ProcessId,CreationDate,CommandLine
Get-NetTCPConnection -LocalPort 8787
Get-ScheduledTask | ? TaskName -match 'bio|k40|workbench|serve|portal|guard|watch'
```
输出摘要：
- node.exe 只有 2 个：PID 30460（opencli daemon，2026-10-19 启动）、PID 6104（billion-context `--port 18787`，2026-10-20 21:00 启动）。**没有 server/index.js 进程**。
- `Get-NetTCPConnection -LocalPort 8787` 返回空，8787 当前无监听。
- 计划任务过滤无匹配（只有 cua-driver-serve 等系统任务）。
- `ops/serve_guard.ps1`（214 行）通读：只做 8787/8080/frpc 的 HTTP 探活与重启（单实例 Mutex），**不含任何任务提交/派发逻辑**。
- `ops/bio_watchdog.sh`（56 行）通读：只做 termux-wake-lock 与 `sv up` 服务自愈，**不提交任务**。

### A.5 远端自动续跑排查（全部排除）

- k40-ubuntu：`crontab` 命令不存在（`bash: line 1: crontab: command not found`），`systemctl` 不存在，`/etc/cron.d` 只有系统默认 `e2scrub_all`。无 cron/systemd 定时器。
- k40（基础用户空间，经 adb forward 8022）：`crontab -l` 唯一一条 `*/5 * * * * /data/data/com.termux/files/home/p_actions/bin/tick.sh`。读该脚本（2439 字节）：只扫 `~/p_actions/inbox/*.json` 跑 geo_chip/spatial 取件流水线，不碰 8787；`p_actions/logs/tick.log` 最后一条是 2026-10-09T12:25:21Z，inbox 0 个文件。
- runit 服务目录 `/data/data/com.termux/files/usr/var/service`：bio-watchdog、crond、ssh-agent、sshd、t5sp-run、ubuntu-sshd。其中 bio_watchdog.sh（基础用户空间 版，2218 字节）只做 sv up 自愈；t5sp-run/run 是一次性 容器 Rscript 06_spatial.R。**均无工作台任务续跑能力**。

### A.6 结论（三选一：明确归因）

**明确归因**：3 条「时间点对不上」的台账不是第二个 8787 后端、也不是看门狗自动续跑，而是**同一台机器上另一个执行者（DSH 侧）并发跑同一个验证脚本**产生的。脚本每次自起 freePort 临时 server 实例，因此不需要常驻 8787，也不会端口冲突。加上 S28 主会话自己的 2 次，5 条台账全部解释得通。

- 已排除：ops/run_throttled_task.sh 包装器；常驻第二 8787 实例；Windows 计划任务；ops/serve_guard.ps1 与 bio_watchdog.sh；远端 cron（基础用户空间 crond、Ubuntu 无 cron）；远端 runit 服务。
- 残留（不影响结论，只影响 1:1 追溯）：58546485、86b31149 两条缺第三方会话转录，无法指出具体是哪个会话的哪次调用。若要补齐，需要 DSH 侧会话存储（`.dsh/sessions` 无对应写入）或当时的终端记录。

---

## B. 架构评审 D1-D7 现状逐条复核

| # | 评审结论 | 当前状态 | 关键证据 |
|---|---|---|---|
| D1 | 桥接四项断言 58 脚本 0 调用（高） | **仍在**（但 8787 提交层已接线） | `grep -r verify_bridge_checkpoint src/` = **0 命中**；桥接在 `server/index.js:1513-1560`、`server/task.js` |
| D2 | 三线 Rscript/python 调用数口径未定义（低） | **仍在**（非缺陷，未修） | 三线脚本 17+23+18=58 个；`git status` 无 `src/` 变更，口径未动 |
| D3 | `png_150dpi` vs 300 DPI，App.tsx 标签写 150（中） | **已修** | `aims/aims.txt:140` = `["png_300dpi", ...]`；`src/App.tsx:1888` = `Web 预览图集 (300 DPI PNG)` |
| D4 | `ops/09_package_delivery.ps1` 不存在（中） | **已作废**（用户 2026-10-21 裁定） | `docs/delivery_package_spec.md:7`「不再实现」，:33「入口作废」；改由 `server/report.js` 承担 |
| D5 | 5MB 分片断点续传，实测 4MB 且无续传（中） | **仍在** | `server/upload.js:22` `CHUNK_SIZE = 4 * 1024 * 1024`；无续传逻辑；前端不调 status |
| D6 | 自检 isolation 硬编码 line1_bulk，缺温度与 7.5GB 水位（中） | **仍在** | `server/index.js:949` 仍 `check_storage_and_isolation.sh line1_bulk` |
| D7 | public_references 铁律（记录在案） | **维持跳过**（非缺陷） | 按用户裁定反卷积不跑 |

### B.1 D1 桥接断言

- `grep -r "verify_bridge_checkpoint" BioanalysDesktop/src/` 命中 **0**。58 个三线脚本（`src/line1_bulk/scripts` 17、`src/line2_scrna/scripts` 23、`src/line3_spatial/scripts` 18）仍无一处调用，评审「58 脚本 0 调用」现状未变。
- 桥接改为在 8787 提交层统一接（S28）：`server/index.js:1513` 注释「桥接四项断言检查点（S28 / 架构评审 D1）」，:1539 `runBridgeCheckSync(bridgePlan)`，:1544 处理 ssh 255 与超时 -1，:1552 失败返回 400/503。位置在 `auditCommand` 之后、`runTask` 之前，符合任务书描述。
- 结论：D1 的「铁律空转」在**工作台提交路径上已闭环**，但「58 脚本自身 0 调用」这条事实仍成立（设计如此：不动三线脚本，由提交层统一把关）。

### B.2 D2 三线调用数口径

评审给的是「实测 Rscript/python 调用 23/10、5/24、2/17，口径未定义调用 vs 桥接」。本轮只核对脚本数与改动状态：三线脚本 58 个，`git status --short` 无 `src/` 下任何改动，说明该口径问题自评审以来未处理。属「低/定义不清」，非代码缺陷，维持现状。

### B.3 D3 150 DPI 漂移（已修）

- `aims/aims.txt:140`：`"expected_formats": ["png_300dpi", "pdf_vector", "tsv_tables", "rds_checkpoint"]`（已是 300dpi）。
- `src/App.tsx:1888`：`Web 预览图集 (300 DPI PNG)`；:1947「DPI 固定 300」；:2358 显示 `DPI：{...dpi || 300}`。原 :1638 的 "150 DPI" 标签已不存在。
- :1312 `web_preview: formats.includes('png_300dpi') || formats.includes('png_150dpi')` 是历史值兼容映射（读取旧 project.json），不是标签，保留合理。
- 结论：**已修**（对应 A3）。

### B.4 D4 打包入口（已作废）

`docs/delivery_package_spec.md` 已加裁定横幅：:7「`ops/09_package_delivery.ps1` 不再实现（2026-10-21 裁定，见下节「零」）」、:33「本文第二节点名的入口 … **作废**，不要照它新建脚本」。实际入口由 `server/report.js` 承担（`buildReportCommand`、`runReportBuild`、`pullDeliverables`、`runReportPreflight`、`writeSha256Sidecars`），`server/index.js:1179/1242/1260` 提供 `/api/report/build|files|download`。结论：**已作废/已裁决**，不是待修项。

### B.5 D5 分片续传（仍在）

- `server/upload.js:22`：`export const CHUNK_SIZE = 4 * 1024 * 1024;`（4MB，aims 宣称 5MB）。
- `server/upload.js` 全文 grep `resume|续传`：0 命中，无断点续传实现。
- 服务端 `/api/upload/status` **端点存在**：`server/index.js:1345`（init :1286，chunk/complete 相邻）。
- 前端 `UploadPanel`（`src/App.tsx:3132-3160`）只调 `/api/upload/init` → 循环 `/api/upload/chunk` → `/api/upload/complete`，**不调 status**；`grep api/upload/status src/` = 0 命中。
- 结论：**仍在**（评审描述准确）。补续传 = 服务端已有 status 查询能力，缺前端「先查已收分片、跳过已传」逻辑。

### B.6 D6 自检五维（仍在）

`server/index.js:920-975` 的五项：fs_type、storage（free >= 20%）、memory（只读 `/proc/meminfo` 首行，恒 pass）、isolation、link。
- :949 `runRemote('bash /mnt/ssd/bio_data/ops/check_storage_and_isolation.sh line1_bulk ...')`：**仍硬编码 line1_bulk**，line2/line3 没有各自的隔离扫描。
- 全文件 grep `温度|temperature|7\.5` = 0 命中：**温度项与 7.5GB 内存水位门禁仍缺**（memory 项只展示 meminfo，不判定）。
- 结论：**仍在**。

### B.7 D7 public_references（维持跳过）

全仓库 `public_references` 71 处引用，集中在 `aims/aims.txt:57`、`docs/isolation.md`、`docs/directories.md:48` 等规格与文档，属既定铁律表述。评审已按用户裁定「反卷积不跑，维持跳过，非缺陷」记录在案，本轮无新增动作。

---

## C. A 批 A1-A8 完成度核对

对照 `git log --oneline -8`（实际只有 3 条提交）与代码现状：

```
9354cbe docs(ops): README 补齐 12 个未登记脚本 + 「该信哪个」决策表（架构评审 A6）
bbd09de feat(S27+S31): 客户交付报告工作台入口 + portal 可选 Token 鉴权（架构评审 A4/B4）
5e3ce52 chore: 工作台基线提交（架构评审 B5：初始化 git 获得原生回滚能力）
```

| # | 事项 | 状态 | 证据 |
|---|---|---|---|
| A1 | 台账 8KB 静默截断 P0 | **已完成** | `server/run.js:175-207`：payload 走 ssh stdin（命令行恒定），远端回 `WROTE '<path>' <bytes>`，`persistEntry` 比对字节数，不符即 reject；:163-174 注释记录「实测超 ~8,231 字符 argv 被静默截断」 |
| A2 | 测试端口硬编码 18787 | **已完成** | `tests/index.test.js:20-35`：注释记录回归原因，`freePort()` 先取空闲端口，`const PORT = await freePort()` |
| A3 | png_150dpi 改 300dpi | **已完成** | 同 B.3：`aims.txt:140` 300dpi，`App.tsx:1888` 300 DPI 标签 |
| A4 | 客户交付报告入口 R3 | **已完成** | `server/report.js` 12 个导出（buildReportCommand/runReportBuild/pullDeliverables/runReportPreflight/writeSha256Sidecars 等）；`index.js:1179/1242/1260` 三个端点；`App.tsx:2521-2622` 交付报告卡片；提交 bbd09de |
| A5 | 桥接四项断言接线 | **已完成（未提交）** | `server/task.js` + `index.js:1513-1560`；新增 `tests/bridge_checkpoint.test.js`；`git status` 显示 task.js/index.js 为 M 态 |
| A6 | 收敛守护机制说明 | **已完成** | 提交 9354cbe（ops/README.md 补齐 12 个未登记脚本 + 决策表） |
| A7 | TaskPanel 改造（R8/R9/R10） | **已完成** | 种子默认 `App.tsx:2648 useState('20261013')`；步骤下拉 `App.tsx:2651/2675` 拉 `/api/projects/steps`；路径预校验 `index.js:208-293 validateTaskPaths`，:1508 在 submit 前调用；`tests/task_submit_validation.test.js` 覆盖 |
| A8 | 上传白名单统一 + 断点续传 | **一半** | 白名单已统一：`server/upload.js:29 ALLOWED_EXT = DATA_EXT`，唯一权威 `shared/data_formats.mjs`；断点续传未做（同 D5） |

注：A1/A2 的提交记录不在 `git log` 里（S26 产物在基线提交 5e3ce52 之前就已在盘上），故以代码现状为准。

---

## D. B 批不可逆操作清单实测体积与引用数

> 全程只读：`Get-ChildItem` 统计、`grep` 计数。**未删除任何文件**。

| 项 | 评审记录 | 本轮实测 | 全仓库引用数 | 判断 |
|---|---|---|---|---|
| `cn_debug/scenic_db/` | 3 个文件 689MB（298M+297M+94M） | **目录不存在（0 字节）**；全仓库递归无 `scenic_db` 目录，也没有任何 >50MB 的 feather/tbl 文件 | `grep -r scenic_db` = 8 处，全在文档/报告/下载脚本（`cn_debug/download_scenic_db.ps1:4`、评审报告、handoff）；`*.py` 内 0 处 | **已被清理**（cn_debug 未入 git，无法取证时间与执行者） |
| `cn_debug/subagent_*.log` | 24 个 4.9MB | **4 个，237,270 字节**：subagent_s31.log 115,218 / subagent_s28b.log 87,746 / subagent_s28.log 34,299 / subagent_s27.log 7 | 4 处（评审报告 + 踩坑台账） | **已删 20 个**，残留 4 个约 231KB |
| `ops/__pycache__/` | 存在 | **不存在（0 字节）** | 0 | 已删 |
| `cn_debug/__pycache__/`（评审未列，同性质） | 未列 | **7 个 .pyc，128,822 字节** | 0 | 可删（可再生） |
| `docs/geo_mining_sop_v1.md` | 待归档 | 存在，25,519 字节 | 9 处（v2 文档、handoff、评审报告等） | 待归档（B2 未执行） |
| `ops/serve_guard.ps1` | 待归档（214 行） | 存在，7,942 字节 | 29 处（ops/README.md、脚本自身注释、handoff、踩坑台账） | 待归档；引用较多，归档前需确认 README 指向 |
| `ops/bio_watchdog.sh` | 待归档（56 行） | 存在，2,218 字节 | 16 处（docs/termux_keepalive.md、handoff、评审报告） | 同上 |
| `ops/fix_runsvdir.sh`、`ops/01_fix_svlogger.ps1`、`ops/04_check_logs.ps1` | 待归档 | 2,585 / 3,683 / 3,944 字节 | 三项合计 55 处（合并 grep，未逐项拆分） | 待归档 |
| `ops/svlogger_*` 三个目录 | 待归档 | **0 个**（`ops/` 下只有 `layout_autoload` 一个目录） | 0 | 已不存在 |
| `_archive/`（B2 目标目录） | 计划新建 | **不存在** | 0 | B2 完全未执行 |
| `cn_debug/` 总量 | 727MB（含 scenic_db） | **335 个文件，32,954,182 字节 = 31.43MB** |  | scenic_db 移走后已回落到正常体量 |

补充证据：`con_hf/踩坑台账.md:1244-1259`（#202）记录了 B1 的 subagent 日志清理**已经执行过**，并记录了事故教训「删 `subagent_*.log` 时删掉了正在运行的 S27 日志」。这解释了为什么 24 个只剩 4 个。scenic_db 与 ops/`__pycache__` 的消失无 git 记录（`cn_debug` 未入库），只能确认「当前已不存在」。

给用户的一句话授权决策（按收益排序）：
1. 剩余可删项合计约 **0.36MB**（4 个 subagent 日志 231KB + cn_debug/`__pycache__` 126KB），**已无 689MB 级收益**，删不删都不影响磁盘。
2. 真正待决策的是 **B2 归档**（`_archive/` 尚未创建，涉及 7 个 ops 脚本 + 1 份旧 SOP + 一次性探针，合计约 50KB）。归档前需先确认 `ops/README.md`、`docs/termux_keepalive.md` 里的路径指向是否要同步改。

---

## E. 结论与建议

1. **A 节闭环**：S28 报告「3 条对不上的台账」已归因为并发执行者，不是第二个后端或看门狗。建议在 S28 报告 §6 追加一行更正，并在 `con_hf/踩坑台账.md` 记一条「多 agent 并发跑同一验证脚本会污染台账窗口，取证时先按 taskId 毫秒段对齐」。
2. **B 节**：D3、D4 已收敛；D1 已由提交层兜住（58 脚本仍 0 调用是设计选择，建议在 aims §一.3 补一句「由 8787 提交层统一执行」以消除规格歧义）；D5、D6 仍在，属可排期项，不阻塞当前使用。
3. **C 节**：A 批只剩 A8 的断点续传一半未做，且与 D5 同源，建议合并成一个切片（服务端 status 已就绪，只缺前端续传逻辑）。
4. **未提交改动风险**：S28/S29/S30 的改动（`server/index.js`、`report.js`、`task.js`、`upload.js`、`portal/*`、`docs/*` + 多个新测试）全部处于未提交态，且 `npm test` 已到 339 全绿。建议尽快在用户授权下提交一次，避免再次出现「改动与基线混在一起、无法回滚」的局面。
5. **未验证项（显式标注）**：
   - 58546485、86b31149 两条台账无法 1:1 映射到具体会话（第三方转录不在 `.dsh/sessions`，也无其他留存）。
   - scenic_db 的删除时间与执行者无 git 记录可查。
   - `ops/fix_runsvdir.sh`、`01_fix_svlogger.ps1`、`04_check_logs.ps1` 的引用数是合并统计，未逐项拆分。
   - 本轮未在远端执行任何写操作，未验证远端 system_logs 之外的证据。

---

## 附录 A：本轮运行的关键命令

```powershell
# 台账
ssh -o BatchMode=yes k40-ubuntu "ls -l --time-style=full-iso /mnt/ssd/bio_data/system_logs/ | grep gsva_pathways"
ssh -o BatchMode=yes k40-ubuntu "cat /mnt/ssd/bio_data/system_logs/2026-10-20_default_line2_scrna_gsva_pathways_58546485.json"
# 本机进程与端口
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId,CreationDate,CommandLine
Get-NetTCPConnection -LocalPort 8787
Get-ScheduledTask | Where-Object TaskName -match 'bio|k40|workbench|serve|portal|guard|watch'
# 远端定时任务
ssh -o BatchMode=yes k40-ubuntu "crontab -l; ls /etc/cron.d"
ssh -o BatchMode=yes k40 "crontab -l; ls /data/data/com.termux/files/usr/var/service"
# 代码核对
grep -rn "verify_bridge_checkpoint" BioanalysDesktop/src
grep -rn "upload/status" BioanalysDesktop/src
grep -n "CHUNK_SIZE" BioanalysDesktop/server/upload.js
grep -n "check_storage_and_isolation" BioanalysDesktop/server/index.js
grep -rn "scenic_db" .
# 体积
Get-ChildItem cn_debug -Recurse -File | Measure-Object Length -Sum
# 测试
cd BioanalysDesktop; npm test
```

## 附录 B：本轮新增的探针脚本

- `cn_debug/_s31_probe_state_db.py`：只读（`sqlite3 ... mode=ro`）扫描 hermes 的 4 个 state.db，按时间窗与关键字（gsva_pathways / tasks/submit）导出会话消息，用于台账归因。不改库、不写库。
