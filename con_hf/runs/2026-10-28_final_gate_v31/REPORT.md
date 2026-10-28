# AIMS v3.1 Final Gate Report

日期：2026-10-28

结论：PASS

来源分支：`codex/aims-v3.1-release`

来源提交：`14861f5ca6f1e7dc6935b525c3c1ad65fafa0cc0`

发布冻结：`release/v3.1` + `v3.1.0-final-gate`

## 判定摘要

| 判定 | 数量 |
| --- | ---: |
| PASS | 24 |
| PENDING | 0 |
| FAIL | 0 |
| 合计 | 24 |

Final Gate 开始时工作树为干净状态。运行期同步台账与新证据在本报告提交中一并归档。`delivery_extract/`
仅用于本次解包验签，属于可重新生成的验证中间物，不进入发布提交。

## 关键结果

- Node 全量：`974/974 PASS`，日志见 `node_tests.log`。
- Playwright：`15/15 PASS`，日志见 `playwright.log`。
- TypeScript：`PASS`，日志见 `tsc.log`。
- Vite build：`PASS`，日志见 `build.log`。
- K40 三线台账：`55/55 PASS`，54 个分析步骤的种子统一为 `20261013`。
- 真实输入适配：6/6 ready 模板在 K40 完成，6 张 PNG 校验结果为 `invalid=0`。
- Plot Matrix：27/27 strict PASS。
- 远端镜像：101/101 SHA256 一致，`src/` 与 `bin/` 部署一致性 55/55。
- 当前门户票据：`2026-10-28_101353_requirement_PRJ_AIMS_V3_20261027`，状态 `done`，结果文件 17 个。
- 当前交付包：329 个清单项，Ed25519 验签 `VERIFIED 329`，归档 SHA256 与旁挂清单一致。
- 运行面：工作台 `127.0.0.1:18787` 五维自检 `all_pass=true`，客户门户 `127.0.0.1:8080/health` 返回 200。
- 端口迁移：活动代码中的 `8787` 精确命中为 0；`18787` 由本项目 Node 独占环回监听；Clash Verge 相关监听为 2592、7057、7890、9097，无冲突。

## 24 项门禁

| No. | 判据 | 结果 | 证据 |
| ---: | --- | --- | --- |
| 1 | 项目 data、figures、debug、deliverables、ledger 位于自包含项目根 | PASS | `local_projects/PRJ_AIMS_V3_20261027/`、`handoff_check.log` |
| 2 | 全局与项目 JSONL 台账按作用域分离 | PASS | `local_projects/PRJ_AIMS_V3_20261027/ledger/actions.jsonl`、`con_hf/ledger/` |
| 3 | ledger indexer 聚合状态并校验 handoff | PASS | `handoff_check.log` |
| 4 | 当前版本真实门户票据完成 pending、running、done | PASS | `ticket_status.json` |
| 5 | Sync 为 18787 单向出站到 8080，环回代理豁免 | PASS | `node_tests.log`、`port_migration.json` |
| 6 | 8080 与 18787 的项目服务只存在 loopback 监听 | PASS | `runtime_health.json`、`port_migration.json` |
| 7 | 当前最终交付包 Ed25519 验签通过 | PASS | `delivery_verify.json`、`delivery_verify.txt` |
| 8 | 60 秒 Sync 限流 | PASS | `node_tests.log`、`playwright.log` |
| 9 | 交付四道闸失败流转 blocked | PASS | `node_tests.log`、`ticket_status.json` |
| 10 | 图库入口、ready 注册表与 KEGG 阻塞均如实 | PASS | `figure_registry_summary.json`、`plot_matrix_strict.log` |
| 11 | 内置预览与项目结果图物理分离 | PASS | `playwright.log` |
| 12 | 跨项目与跨线 adapt_vars 拒绝 | PASS | `node_tests.log`、`port_tests.log` |
| 13 | 派生副本保留母版 SHA 且先运行真实数据覆盖层 | PASS | `node_tests.log`、`k40_summary.json` |
| 14 | Preview 漂移被识别并降级 | PASS | `playwright.log` |
| 15 | K40 三线 55 个步骤当前代码 `exit 0` | PASS | `k40_summary.json`、`con_hf/runs/2026-10-28_aims_v31/pipeline_rerun/k40_55_ledgers.tsv` |
| 16 | DEG 与 DR Genes 在表、图题和报告中区分 | PASS | `node_tests.log`、`con_hf/runs/2026-10-28_aims_v31/real_input_adapters/REPORT.md` |
| 17 | K40 仓库镜像与 bin 执行落点零漂移 | PASS | `sync_all_remote.log` |
| 18 | 20GiB 上传配额在写盘前拦截 | PASS | `node_tests.log` |
| 19 | 单测、TypeScript、build、Playwright 全绿 | PASS | `node_tests.log`、`tsc.log`、`build.log`、`playwright.log` |
| 20 | 高温或离线时 10 秒内切换到显式备用节点 | PASS | `failover.log` |
| 21 | 6 个 ready 模板全部读取真实项目输入并在 K40 出图 | PASS | `k40_summary.json`、`artifact_validation.log`、`artifact_validation.tsv` |
| 22 | ready 模板 `input_tables` 是分析步骤 `produces` 的子集 | PASS | `node_tests.log`、`figure_registry_summary.json` |
| 23 | 母版、预览、真实样例和 Plot Matrix 源文件可 Git 追踪 | PASS | `node_tests.log`、`git_diff_check.log` |
| 24 | 远端预检失败不得伪装 SAME，FailOnDrift 必须硬退出 | PASS | `sync_all_remote.log`、`port_tests.log` |

## 端口迁移

D-28 将工作台默认端口迁移到 `18787`。服务端、Vite、启动器、守护、Sync 和回归测试使用同一默认值。

| 检查 | 结果 |
| --- | --- |
| `8787` 活动代码精确扫描 | 0 命中 |
| `8787` 当前监听 | free |
| `18787` 当前监听 | expected，项目 Node PID 51576，仅 `127.0.0.1` |
| Clash Verge 相关监听 | 2592、7057、7890、9097 |
| 端口冲突 | 无 |

## 证据索引

- `source_head.txt`、`source_branch.txt`：门禁来源。
- `runtime_health.json`：18787 工作台与 8080 门户状态。
- `port_migration.json`、`port_tests.log`：端口配置、占用与冲突检查。
- `node_tests.log`、`playwright.log`、`tsc.log`、`build.log`：本地回归。
- `link_check.log`、`sync_all_remote.log`：K40 链路、镜像与部署一致性。
- `k40_summary.json`：55 步台账与 6 个真实输入模板汇总。
- `figure_registry_summary.json`、`plot_matrix_strict.log`：图模板注册表与 Plot Matrix。
- `artifact_validation.log`、`artifact_validation.tsv`：6 张真实图件校验。
- `ticket_status.json`：当前真实门户票据终态。
- `delivery_verify.json`、`delivery_verify.txt`：当前交付包哈希与签名。
- `handoff_check.log`、`git_diff_check.log`：治理门禁与源码整洁检查。
- `failover.log`：备用节点显式配置与切换回归。
- `SHA256SUMS.txt`：上述终验证据的字节级对账清单。

## 结论

AIMS v3.1 的 24 项 Final Gate 全部通过，图模板真实输入、三线 K40 执行、门户 Sync、交付签名、
18787 端口迁移和项目交接均具备可复核证据。当前提交可以冻结为 `release/v3.1`。
