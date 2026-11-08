# Final Gate v3.1 Precheck

日期：2026-10-28  
结论：24 项预检全部通过，正式 Final Gate 仍等待干净工作树与发布提交

## 判定摘要

| 判定 | 数量 |
| --- | ---: |
| PASS | 24 |
| PENDING | 0 |
| FAIL | 0 |
| 合计 | 24 |

正式冻结仍被一个治理条件阻塞：当前工作树仍有 2000 级混合条目，尚未完成 v3.1 原子提交、干净工作树检查和 release 分支冻结。

## 24 项预检

| No. | 判据 | 结果 | 证据 |
| ---: | --- | --- | --- |
| 1 | 项目 data / figures / debug / deliverables / ledger 位于自包含项目根 | PASS | 项目目录与现有 Gate 证据 |
| 2 | 全局与项目 JSONL 台账按作用域分离 | PASS | `con_hf/ledger/`、项目 `ledger/` |
| 3 | ledger indexer 聚合状态并校验 handoff | PASS | `ledger_indexer --check-handoff` |
| 4 | 当前版本真实门户票据完成 pending → running → done | PASS | `2026-10-28_101353_requirement_PRJ_AIMS_V3_20261027` |
| 5 | Sync 为 18787 单向出站到 8080，环回代理豁免 | PASS | `wp33_sync_real_mode.test.js`、Sync 测试 |
| 6 | 8080 与 18787 的项目服务只存在 loopback 监听 | PASS | 18787 Node `127.0.0.1:18787`；8080 `/health` 200 |
| 7 | 当前最终交付包 Ed25519 验签通过 | PASS | `VERIFIED 329`，10:24 重建 |
| 8 | 60 秒 Sync 限流 | PASS | `portal_sync.test.js`、Playwright |
| 9 | 交付四道闸失败流转 blocked | PASS | report preflight 与 portal Sync 测试 |
| 10 | 图库入口、ready 注册表与 KEGG 阻塞均如实 | PASS | 6 ready、65 pending、10 pending_mapping、1 blocked_r453 |
| 11 | 内置预览与项目结果图物理分离 | PASS | Playwright 15/15 |
| 12 | 跨项目与跨线 adapt_vars 拒绝 | PASS | figure parity 与 adapter 测试 |
| 13 | 派生副本保留母版 SHA 且先运行真实数据覆盖层 | PASS | `figure_adapters.test.js`、K40 6/6 |
| 14 | Preview 漂移被识别并降级 | PASS | parity 测试与 Playwright |
| 15 | K40 三线 55 个步骤当前代码 `exit 0` | PASS | `pipeline_rerun/k40_55_ledgers.tsv`、`SUMMARY.json` |
| 16 | DEG 与 DR Genes 在表、图题和报告中区分 | PASS | delivery report 与相关静态测试 |
| 17 | K40 仓库镜像与 bin 执行落点零漂移 | PASS | `sync_all_remote.log` 101/101、55/55 |
| 18 | 20GiB 上传配额在写盘前拦截 | PASS | upload quota 与 reservation 测试 |
| 19 | 单测、TypeScript、build、Playwright 全绿 | PASS | Node 974/974、tsc、build、Playwright 15/15 |
| 20 | 高温或离线时 10 秒内切换到显式备用节点 | PASS | node failover 测试 |
| 21 | 6 个 ready 模板全部读取真实项目输入并在 K40 出图 | PASS | `real_input_adapters/REPORT.md` |
| 22 | ready 模板 `input_tables ⊆ analysis_step.produces` | PASS | D-27 与 figure parity 测试 |
| 23 | 母版、预览、真实样例和 Plot Matrix 源文件可 Git 追踪 | PASS | `.gitignore` 精确白名单与 `git check-ignore` 测试 |
| 24 | 远端预检失败不得伪装 SAME，FailOnDrift 必须硬退出 | PASS | `sync_verify_fail_on_drift.log`、部署守卫测试 |

## 当前门禁

### G7 端口

D-28 已将工作台默认端口迁移到 `127.0.0.1:18787`。实际监听只出现在 loopback，五维自检 `all_pass=true`，8080 `/health` 返回 200。旧 8787 的 mihomo Bound 不再阻塞项目。

### 发布收口

- 当前工作树包含历史脚本、调试产物、图库证据、本地项目和其他并行工作。
- 不允许 `git add .`。
- 需要先按提交计划完成共享文件 hunk 拆分，再提交并验证干净工作树。
- `release/v3.1` 与标签必须在 Final Gate 全绿后创建。

## 已完成的强证据

- K40 当前代码重跑：55/55 台账通过，54 个分析步骤 `seed=20261013`。
- 远端同步：101/101 SHA256 一致，`src/` 与 `bin/` 55/55 一致。
- 图模板：6/6 ready 真实输入闭环，27/27 Plot Matrix strict。
- 自动回归：Node 974/974、Playwright 15/15、TypeScript、build。
- 现有交付包：解包后 Ed25519 `VERIFIED 302`。
- 当前交付包：10:24 重建，解包后 Ed25519 `VERIFIED 329`。
- 当前真实票据：`2026-10-28_101353_requirement_PRJ_AIMS_V3_20261027`，17 个结果文件，状态 done。
- 端口迁移：18787 五维自检 PASS，8080 健康 PASS。

## 证据入口

- `con_hf/runs/2026-10-28_aims_v31/pipeline_rerun/k40_55_ledgers.tsv`
- `con_hf/runs/2026-10-28_aims_v31/pipeline_rerun/SUMMARY.json`
- `con_hf/runs/2026-10-28_aims_v31/sync_all_remote.log`
- `con_hf/runs/2026-10-28_aims_v31/sync_verify_fail_on_drift_pass.log`
- `con_hf/runs/2026-10-28_aims_v31/link_check.log`
- `con_hf/runs/2026-10-28_aims_v31/port_guard_live.txt`
- `con_hf/runs/2026-10-28_aims_v31/delivery_verify.log`
- `con_hf/runs/2026-10-28_aims_v31/port18787/`
- `con_hf/runs/2026-10-28_aims_v31/portal_sync_v31/portal_sync_status.json`
- `con_hf/runs/2026-10-28_aims_v31/portal_sync_v31/delivery_verify_current.log`
