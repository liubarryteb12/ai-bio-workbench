# 项目交接

## 项目背景

本项目是 AIMS v3.0 的三线全闭环基准验证项目，用于验证 Line 1 Bulk、Line 2 scRNA 与 Line 3 Spatial 在 K40 计算容器内的完整分析、图件、台账、交付和门户 Sync 链路。v3.1 在此基础上继续收口图模板真实产物映射、派生执行闭环和脚本级 Plot Matrix。

## 当前进度

- v3.0 Gate 1、Gate 2 与 Final Gate 已通过，三线 55 个脚本在 K40 汇总为 55/55 completed、exit 0。
- 项目资产包含 data 195 个文件、figures 153 个文件、deliverables 317 个文件、机器日志 101 个。
- 正式交付包已通过 Ed25519 验签，客户端结果为 VERIFIED 302。
- 真实门户票据 `2026-10-27_132400_requirement_PRJ_AIMS_V3_20261027` 已完成 pending、running、done 状态流转。
- 2026-10-28 已完成 D-23 至 D-26 台账裁定，并新增 `ledger_indexer.py --check-handoff` 验收入口。
- T-FT-01、T-FT-02、T-FT-03、T-FT-04 已完成：箱线图纯横线、27 入口矩阵、严格映射和防漂移测试已落盘。
- 当前注册表按严格准入保留 6 个 ready 模板，其他无合格真实样例的模板归入 pending 或 pending_mapping。
- T-FT-05 已完成真实输入语义闭环：6/6 ready 模板均读取项目真实 TSV 或 h5ad，K40 全部 completed、exit 0，PNG 回搬并通过 Pillow 与目视检查。
- T-FT-06 已完成门户映射字段与对应步骤标签。
- T-LINES-01 已按 D-27 完成：`workflows.json` 是当前 JSON module manifest 的 SSOT，带 `manifest_version=2` 与 `manifest_kind`；ready 模板 `input_tables` 必须属于绑定步骤 `produces`。
- 6 个 ready 模板母版、预览、真实项目样例、27 入口源码与验证输入已加入精确 Git 白名单，干净克隆具备复现基础。
- K40 三线已按 `seed=20261013` 重跑：Line 1 15 步、Line 2 22 步、Line 3 17 步全部完成，加 `probe_env` 共 55/55 台账通过。
- 远端审计镜像 101/101 SHA256 一致，`src/` 与 `bin/` 部署一致性 55/55。
- 当前 Node 974/974、Playwright 15/15、TypeScript 与 build 均通过。
- D-28 已将工作台默认端口迁移到 `127.0.0.1:18787`；五维自检 `all_pass=true`，8080 客户端 `/health` 返回 200。
- 当前真实门户票据 `2026-10-28_101353_requirement_PRJ_AIMS_V3_20261027` 已完成 pending → running → done，返回 17 个结果文件。
- 当前交付包已重建，解包后 Ed25519 验签 `VERIFIED 329`。

## 已知坑

- P-26：远端长任务必须使用 setsid nohup 脱离本机进程树，本机只轮询，不承载远端生命周期。
- P-27：长任务按分档超时等待，SCENIC 与虚拟敲除走 40 分钟档，不能固定短超时一刀切。
- P-29：禁止并发 SSH 风暴，轮询间隔不低于 60 秒，容器内禁止 find、ps、grep -r 等递归扫描。
- Final Gate 13:31 后工作树继续变化，旧门禁不能代表当前发布状态。
- 最新 aims 名义 D-18 至 D-21 与历史台账编号冲突，v3.1 已正式落号为 D-23 至 D-26。
- 当前工作树混有大量历史调试与并行改动，禁止用 `git add .` 一次提交。
- 新增 ready 模板前必须同时提供真实项目样例和对应输入适配器，否则只能标为 pending_mapping。
- 端口状态可能是 Bound 而不是 Listen，只筛 LISTENING 会误判；启动前必须调用 `ops/port_preflight.ps1`。
- 工作台端口以 D-28 的 18787 为准，历史证据中的 8787 只代表迁移前状态。

## 下一步

1. 按来源边界重新审计工作树，只提交 v3.1 所需文件，禁止混入临时探针、备份目录和其他项目。
2. 在干净工作区重跑 Final Gate v3.1，并保留 8080/18787 双活、Sync、交付签名与真实模板出图证据。
3. 只有在 Final Gate 全绿后创建 `release/v3.1` 与冻结标签。
4. 后续若扩充 ready 模板，逐个补充真实样例、输入适配器和 K40 实跑证据。
