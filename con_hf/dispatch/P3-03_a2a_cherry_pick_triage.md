# P3-03 A2A 择优挑拣核对（主代理实做）

> 2026-11-01。基线 `master @ a4637da`，对 `codex/a2a-v1`（领先 51 提交，827 文件 /
> +62,184 / -6,581）做只读核对。原定派 glm-5.3-flash 子代理，因模型侧 429 限流两轮均未启动，
> 本节由主代理用 `git log` / `git show` / `git ls-tree` 实做。

## 一、决定性事实：`src/engines/` 与 `src/core/` 在 master 上不存在

`git ls-tree -r --name-only master -- src/engines src/mods` 为空（0 文件），
`codex/a2a-v1` 同路径 44 文件。master 的 `src/` 只有 `bridge_guard.sh`、
`figure_templates.json`、`workflows.json` 加三线母版目录。

后果：第二批「本地容器容灾适配器」不是小挑拣。它的载体 `MockComputeAdapter` 位于
`src/engines/compute-engine/adapters.ts`，依赖 `src/core/types.ts`、`src/core/PathGuard.ts`、
`src/engines/bridge-engine/*`（见 `tests/compute_engine_compile.cjs` 的 SOURCES 清单）。
要拿容灾适配器，必须连带引入微内核底座（提交 `0e3e161`）。这是一次架构准入决策，属用户裁定项。

已实测纠正一处初判：`interface.ts:10` 确为 `readonly argv: readonly string[]`，
`adapters.ts:74` 逗号在位，`BridgeComputeAdapter` 无语法缺陷，不许按「分支代码坏掉」立案。

双真源风险：master 已有 `BioanalysDesktop/tests/node_failover.test.js`，
引入引擎层容灾前必须先确认它现有断言钉的是哪条接缝，避免同一能力两套真源。

## 二、51 个提交逐条判定

| 提交 | 主题 | 判定 | 依据 |
|---|---|---|---|
| b348216 | A2A 宪章文档 | skip | master 已有 v3.1 四卷正本，宪章再入即双真源 |
| 769d860 | 锁宪章与安全决策 | skip | 同上，纯文档 |
| b42aae4 | core 路径/台账/总线/模块/安全审计底座 | 第二批前置 | 引擎层底座，P3-03 准入裁定后再动 |
| c433cf7 | pi 与 codex ops 及模块清单 | 第一批候选 | 含 `ops/` 脚本面，需与 master 现有 ops 对表 |
| c5a80a8 | 去打包 typescript 副本、POSIX 路径守卫 | 第二批 | 依赖修复，随引擎层走 |
| 90b2460 | 结构化产物校验器 | skip | 属 A2A 产物协议，P3 三批不含此能力 |
| 8589b05 | 任务轮询与 pi 引导助手 | skip | 同上，随 A2A 运行时整体决策 |
| 0465169 | core 编译支持 Node 18 与 ESM 加载 | 第二批 | 编译门禁，与引擎层同进同退 |
| 6728d59 | 探测手机端 pi 守护安全闸 | skip | 需真机，且属 A2A 运行时 |
| 105128f | 校验 codex serve 并桥接代理到手机 | skip | 网络拓扑属 A2A 运行时 |
| 3ecb8d3 | 记录 k40 门禁结果 | skip | 台账记录，非能力 |
| 6c9fb56 | k40 adb forward 可复现 | 候选小件 | 与 master 现有 adb forward 脚本对表后择一 |
| e8bb236 | 自启 pi server 与安全探针 | skip | A2A 运行时 |
| 3782bb3 | 每个 adapter 归到正确平面 | 第二批 | 平面归属与本项目双平面铁律同源 |
| d638721 | 忽略本地 codex-a2a 运行时库 | skip | master 已在 10-31 清理中删除该目录 |
| ccde81f | pi 锁两个批准推理模型 | skip | A2A 运行时策略 |
| 254b41f | 拒绝裸启 pi 并探测模型锁 | skip | 同上 |
| 0c35b08 | 阶段 1 门禁报告 | skip | 台账 |
| cdf695e | 补 P0/P1 审查缺口 | skip | 面向 A2A 运行时，非 P3 三批 |
| d94457b | 收尾剩余审查项 | skip | 同上 |
| 2b69e70 | 首个真实跨平面任务端到端 | skip | 需真机取证 |
| 128ff14 | 台账记录首个端到端任务 | skip | 台账 |
| 9d58e82 | 从 pi 回复提取结构化产物 | skip | A2A 产物协议 |
| bc5499a | 异步与实时产物门禁记录 | skip | 台账 |
| f4dc3ab | 多文件产物解析 | skip | A2A 产物协议 |
| e607ccb | 息屏保活门禁记录 | skip | 台账；master 已有 `docs/termux_keepalive.md` |
| 2c4c0ba | 工作台实时 Pi agent 监控 | 第三批 | 见第四节，必须排在 P3-02 之后 |
| 55b9585 | 下发模态框、台账轨迹、逐模型用量 | 第三批 | 同上 |
| ce2d680 | v1.1.0 D-11 幂等 runner 与 D-12 遥测旁挂 | 第一批 | 本批主体，`ops/pi_idempotent_runner.sh` 在此 |
| 98a235b | v1.1.0 八维回归套件 | 第一批伴生 | 只为 picked 子集带测试，不许整包 |
| ed74e7c | 记录八维回归门禁 | skip | 台账 |
| d555e73 | start bat 自重启陈旧实例 | 候选小件 | 运维小修，独立可验 |
| 8e862ae | 观测面板近实时化 | 第三批 | 性能优化随主体 |
| 72a8394 | 按 aims html 规格做结构化任务时间线 | 第三批 | 同上 |
| e3551d2 | 03 出图规范应用到 K40 母版 | skip | 出图线，已由 aims-v3.2-figures 合并覆盖，需逐文件复核 |
| 0e3e161 | 微内核 7 件套与 8 共享引擎 | 第二批准入 | 架构准入裁定项 |
| 3439950 | 10 个可插拔 mod、K40 图源 v1.0、A2A 运行时路由 | 拆分处理 | 三件事混一提交，必须按文件切 |
| 42c429e | 100 个工作台测试文件与 A2A 契约测试 | 拆分处理 | 同上，只取与 picked 子集对应的测试 |
| 568de8d | 统一 aims SSOT 导航与 v3.2 发布计划 | skip | 文档，master 有更新版本 |
| 530ae32 | SCI 单图风格配置 | skip | 出图线，非 P3 |
| 6255060 | 管线出图标准化器与发布计划映射 | skip | 出图线 |
| 96bd2d3 | 00_config 部署与 Line1 48 图标准化 | skip | 出图线 |
| 45b16e4 | 空间方形预设与自适应高度 | skip | 出图线 |
| c7dc8ea | Line2/Line3 出图标准化器 | skip | 出图线 |
| 70d1fc0 | Line2/Line3 43+72 图 SCI 合规 | skip | 出图线 |
| f0b63b4 | 桌面 mock 复位与子进程 UTF-8 解码 | 第二批参考 | 与 `node_failover.test.js` 接缝相关，先对表 |
| 98fa46f | start_workbench.bat 加 adb forward 预检 | 候选小件 | 与 6c9fb56 同组 |
| f07f2d9 | 门户 e2e pi 对话断言对齐 | 第三批 | 依赖 PiAgentChat |
| 253c959 | 恢复图目录索引与清单 | skip | 出图线 |
| 8991b51 | 发布计划断言支持干净 worktree | skip | 出图线测试 |
| b5b46f9 | 细化课题调研流程 | skip | 与 master `topic_survey` 冲突风险高 |

## 三、三批落地清单

### 第一批：幂等 runner 与远端长任务锁

**本节结论已按实测改写。原写法（把 `ops/pi_idempotent_runner.sh` 整只挑进来）不可执行。**

实测证据一：`git grep -l pi_idempotent_runner codex/a2a-v1` 命中 15 个路径，全是
A2A 文档（`aims/A2A/*.md`）、A2A 编排器（`aims/A2A/a2a_master_harness.py`）、
分支自己的 `AGENTS.md` 与台账，以及该脚本自身的三份副本。**没有任何生产调用方。**
master 既没有 pi 运行时（那正是本核对判 skip 的 24 个提交），整只挑进来就是落一个没人调的孤儿脚本。

实测证据二：master 真正在用的长任务包装器是 `ops/run_throttled_task.sh`，它的
`RUNNING_DIR`（L102-117）只做**可观测性标记**，注释写得很明白：任务被 abort 或 kill 时
没台账，只留标记，7 天后清理。它**不做互斥**，没有「同一步骤已在跑就拒绝」的判定。
runner 侧靠 `wrapperId()` 随机后缀保证目录不撞，于是重复提交同一步骤会生成两个 wrapper
并真的把重步骤跑两遍。handoff 第十二轮记的 scenic_tf 反复下发正踩这个。

所以第一批该做成这样，与 D-11 幂等 runner 的本意一致但落在 master 真有调用方的地方：

1. 给 `ops/run_throttled_task.sh` 加**按逻辑步骤键**（project + lineId + step，不是随机
   task id）的幂等锁：已有存活锁则拒绝或复用并回明确退出码，锁与现有 `_running` 标记同生命周期回收。
2. 测试放 `ops/tests/`（master 有该目录），走 Git Bash 实跑 bash 级用例，
   仓库已有先例（`bridge_guard` 系列即在 Git Bash 下测 .sh）。
   根 `tests/` 已被 10-31 清理删除，不得为塞分支测试把它重建回来。
3. 分支那三份副本一份都不进：`ops/pi_idempotent_runner.sh`、
   `01_mobile_compute/runtime/`（master 已删该目录）、`aims/A2A/pi_idempotent_runner.bash`。
4. 无设备可验：锁的互斥、重复下发拒绝、过期锁回收（Git Bash 上可用假文件系统目录跑）。
   必须等真机：断链重连后的锁恢复与远端真实并发行为。

### 第二批：本地容器容灾适配器（价值最高，K40 正离线）

- 前置 `0e3e161`（引擎层）、`c5a80a8`、`0465169`、`3782bb3`，参考 `f0b63b4`。
- 能力落点：`ComputeAdapter` 是现成接缝，`MockComputeAdapter` 提供无设备跑通，
  `BridgeComputeAdapter` 走 K40。master 侧对应接缝是 `server/proc.js`（`runSshRaw`、
  `runSshStrict`、`findAdb`）与 `server/link.js`（`checkLink`）。
- 接法建议：不引入 TS 引擎层，改为在 `server/proc.js` 这一个既有 seam 上加
  `BIO_COMPUTE_ADAPTER=mock|ssh` 开关并提供 mock adapter。这样拿到容灾能力，
  又不把 44 文件引擎层与 `src/core` 一次性压进 master。
- 无设备可验：mock adapter 下的全量 `npm test`、`node_failover.test.js` 扩展断言。
- 冲突预判：`server/proc.js` 若被 P3-01 搬进 `server/remote_exec.js`，本批必须等 P3-01 合入后开工。

#### 第二批实做记录（2026-11-01，用户已全量采纳替代路线）

- **picked 提交号**：`0`。本批不 cherry-pick `codex/a2a-v1` 的 TS 引擎层，改为在 master
  既有 `server/proc.js` 单 seam 增加 `BIO_COMPUTE_ADAPTER=mock|ssh`。这是用户对
  「不引入 44 文件引擎层」建议的全量采纳，不是静默丢弃分支提交。
- **本批原子提交**：`a590dd6`。
- **未合入提交与理由**：`0e3e161`、`c5a80a8`、`0465169`、`3782bb3` 随微内核底座整体暂缓，
  `f0b63b4` 仅作接缝参考。理由是 master 已有 `server/proc.js` 与 `node_failover.test.js`，
  直接引入会形成第二套计算面真源，并突破本轮只拆既有接缝的边界。
- **落盘文件**：`BioanalysDesktop/server/proc.js`、`BioanalysDesktop/tests/compute_adapter.test.js`。
- **验证命令与结果**：`node --test tests/compute_adapter.test.js`，6 pass / 0 fail。
  覆盖默认 ssh、显式 mock、未知适配器 fail-closed、非测试环境门禁、strict 非 0/空输出、
  runStream 异步回调和 kill no-op。
- **剩余门禁**：全量 `npm test` 需在真实设备环境复跑；mock adapter 尚未接管
  `run.js`、`task.js`、`report.js` 等直接 SSH 调用点，后续切片按调用面逐块迁移。

### 第三批：PiAgentChat 观测插槽

- 提交 `2c4c0ba`、`55b9585`、`8e862ae`、`72a8394`、`f07f2d9`。
- 落点 `server/pi_agent.js`、`server/pi_agent_routes.js`、`src/PiAgentChat.tsx`、
  `src/mods/mod-pi-observability/*`。
- 硬顺序：这批要动 `src/App.tsx`，必须排在 P3-02 拆分合入之后，否则与视图拆分正面撞车。

## 四、建议执行顺序

1. P3-01 后端拆路由（先行，因为它会搬 `server/proc.js` 的调用面，决定第二批挂点）。
2. P3-02 前端拆视图（第三批的前置）。
3. 第二批：按 `server/proc.js` 单 seam 加 mock adapter，走「不引入引擎层」路线。
4. 第一批：只留 `ops/` 一份 runner，配 `bash -n` 与纯逻辑测试。
5. 第三批：P3-02 之后合 PiAgentChat 插槽。
6. 引擎层与 A2A 运行时整体准入另立议题，请用户裁定，不混进 P3。
