# 项目架构全景：目录结构、信息流、判定顺序、存储结构

写这份文档的目的：让外部评审（Argon）在看到具体优化建议前，先准确知道这套系统**长什么样、数据怎么流、谁在什么时刻判定什么**。
所有条目都是从代码实测得来，不是设计意图的复述。

## 一、目录结构（实测）

### 1.1 根目录 27 个条目

```
参考与研究            references/        只读出图规范与代码库（772 条 catalog）
分析母版              tools/bio/        三线脚本与注册表
工作台（服务端+前端）  BioanalysDesktop/ 整个 Web 应用
控制面工具            tools/dev/ tools/reporting/ tools/ops/
                                     门禁、报告交付链、运维入口
项目产物              workspace/projects/   每个项目一个目录（6 个现存）
台账                  ledger/           JSONL 与运维/坑位台账
交接与历史            workspace/handoff/ 交接、决策、派单与调研快照
运行记录              docs/runs/        历史验证证据
文档                  docs/             规范正本（coding-standards / isolation / directories / figure_spec）
交付                  deliverables/ outputs/ artifacts/ dist/
其它                  bin/ portal/ projects/ shared/ tests/ Python/ vendor/ configs/ aims/
临时与归档            .tmp/ _archive/ cn_debug/
```

### 1.2 `tools/bio/` 分析母版层

```
tools/bio/line1_bulk/     21 文件   bulk RNA-seq 线（R 为主）
tools/bio/line2_scrna/    29 文件   单细胞线（Python 为主）
tools/bio/line3_spatial/  26 文件   空间转录组线（Python + R）
tools/bio/workflows.json           步骤注册表（54 个已登记 mod）
tools/bio/figure_templates.json    92 条出图模板（27 条 Ready 单图）
core/bridge_guard.sh               跨语言桥接守卫
```

**目录即契约**：`tools/bio/<line>/scripts/` 下除 README.md 与两个共享库外，每个文件都必须是可提交的步骤母版，
且必须登记进 `workflows.json`。这条由测试钉死（scripts_registry_parity）。

### 1.3 `BioanalysDesktop/` Web 应用层

```
server/           48 文件   Node HTTP 服务（无框架，手写路由）
  index.js                入口：鉴权 -> 路由分发（8 组 handle*Routes）
  routes/                 6 个路由模块（projects/tasks/figures/report/upload/diagnostics）
  run.js                  任务执行接缝：buildTaskScript + auditCommand + wrapper + ledger
  task.js                 算力节点选择、健康探测、故障转移
  reconcile.js            任务状态对账（remote probe -> 状态机）
  ledger.js               路径判定（analyzePath / classifyPath / isPathUnderLegalRoot）
 proc.js                 子进程接缝（ADB 单通道）
  figure_*.js             出图适配、目录、执行计划、分类
src/              19 文件   前端 React（views / components / shared）
tests/            161 文件  node:test 契约测试
Python/           2418 文件  打包的 Python 运行时
dist/             3 文件    构建产物
```

### 1.4 `workspace/projects/` 项目产物层（每个项目一个）

```
<project>/
  project.json     四段式 manifest：basicInfo / data_source / pipeline_dag / acl_and_output
  data/            输入数据（按线分目录）
  scripts/         本项目适配脚本（与 tools/bio 母版的差异层）
  results/         按线分目录：line1_bulk/ line2_scrna/ line3_spatial/
  figures/         图件产物
  *.md             报告
```

注意 `scripts/` 的存在：**项目级适配脚本与母版是分层关系**，母版是通用逻辑，项目脚本是数据形态适配。
这个分层是本仓库最重要的一个设计决定，也是漂移事故的来源（远端被直接改过，母版没跟上）。

## 二、信息流（一条任务从点击到落账的完整路径）

```
[前端 React]
   │ POST /api/tasks/submit  (step / project / line / 参数)
   ▼
[server/index.js]  鉴权（Basic，常量时间比较） -> 路由分发
   ▼
[routes/tasks.routes.js]
   ▼
[server/run.js]  runTask()
   │ 1. buildTaskScript(task)      拼出远端要执行的命令
   │ 2. auditCommand(cmd)          审计：拒绝可疑命令
   │ 3. 套 wrapper                  tools/ops/run_throttled_task.sh <task_id> <line> <step> ...
│ 4. remoteRunner(cmd)          ADB 单通道下发，SSH 已封存
   ▼
[K40 容器 /mnt/ssd/bio_data]
   │ run_throttled_task.sh：nice -n10 / ionice / 幂等锁 / 内存闸门 / 退出码 0-4
   │ 执行 src 母版（或项目适配脚本），工作目录 = <line>/processed
   │ 产物写 processed/ 与 results/
   │ 运行标记写 system_logs/_running/<task>.json
   ▼
[server/run.js]  persistEntry()
   │ 读远端回执（WROTE '<path>' <bytes>）
   │ 写台账 ledger/*.jsonl
   ▼
[server/reconcile.js]  reconcileTask()
   │ 探针复查（RECONCILE_END 哨兵）：进程还在？产物在不在？
   │ 判定：succeeded / failed / interrupted / unknown
   ▼
[前端]  轮询 /api/tasks/... 拿状态与日志
```

## 三、判定顺序（谁在什么时刻判定什么）

这是整套系统最容易出错也最值得优化的部分。按时间顺序：

| 序 | 判定点 | 位置 | 判定内容 | 失败后果 |
|---|---|---|---|---|
| 1 | 鉴权 | `index.js:isAuthorized` | Basic 头，常量时间比较 | 401 |
| 2 | 请求体上限 | `http_body.js:collectJsonBody` | 1 MB 硬顶（T3-7） | 413 |
| 3 | 参数合法性 | 各路由 `sanitizeProjectId` 等 | 路径穿越、长度、字符集 | 400 |
| 4 | 命令审计 | `run.js:auditCommand` | 可疑命令拦截 | 400 |
| 5 | 算力节点选择 | `task.js:selectComputeNode` | 健康度、温度、内存、失败次数 | 故障转移或拒绝 |
| 6 | 幂等锁 | `run_throttled_task.sh` | 同 line+step 是否在跑 | 退出码 4 |
| 7 | 内存闸门 | `bio_memory_guard.py` | RLIMIT_AS 上限 | 干净报错而非拖垮设备 |
| 8 | 步骤自校验 | 每个母版内部 | 输入契约、seed、产物 | 退出码 1/2/3 |
| 9 | 产物回执 | `persistReceiptMarker` | `WROTE '<path>' <bytes>` | 台账记 failed |
| 10 | 状态对账 | `reconcile.classifyRemoteState` | 进程 + 产物 + 标记 | succeeded/failed/interrupted |
| 11 | 交付验收 | `report.js` 四关 + 回执 | tar sha256 + 验收记录 | 409 ERR_DELIVERY_UNVERIFIED |

**判定顺序的核心设计**：越便宜、越能早失败的判定越靠前。门禁串联器 `tools/dev/run_all_gates.mjs` 用的是同一条原则，清单本身是唯一真源。

## 四、存储结构

### 4.1 三类存储，职责严格分离

| 类型 | 位置 | 内容 | 生命周期 |
|---|---|---|---|
| **台账**（authoritative） | `ledger/*.jsonl` | 每次任务执行的权威记录 | 永久，append-only |
| **产物**（derived） | `workspace/projects/<id>/results|figures` | 分析结果 | 随项目 |
| **缓存**（disposable） | `.tmp/ .ops_state/ node_modules` | 临时与可重建 | 可随时删 |

### 4.2 远端算力面存储

```
/mnt/ssd/bio_data/
  bin/<line>/            部署的母版（与仓库 src 双向同源，门禁校验）
  bin/_legacy_wild/      已归档的野生脚本（11 个）
  projects/<id>/         项目产物（与本地 workspace/projects 对应）
  system_logs/_running/  运行标记
  system_logs/_locks/    幂等锁
  system_logs/*_ledger.json  台账回执
```

### 4.3 注册表类真源（single source of truth）

| 真源 | 路径 | 管什么 |
|---|---|---|
| 步骤注册表 | `tools/bio/workflows.json` | 54 个 mod 的 id/script/输入输出 |
| 图件模板 | `tools/bio/figure_templates.json` | 92 条模板，27 条 Ready 单图 |
| Ready 白名单 | `tools/dev/figure_ready_allowlist.json` | 封板的 27 个 ID |
| Ready 实证矩阵 | `tools/dev/figure_ready_matrix.json` | 27 条的 sha256 核验结果 |
| 项目 manifest | `workspace/projects/<id>/project.json` | 分组设计、阈值、pipeline_dag |
| 门禁清单 | `tools/dev/run_all_gates.mjs` | 门禁顺序与参数的唯一真源 |

## 五、当前架构的已知问题（客观陈述，供优化时参考）

1. **项目适配脚本与母版的分层没有机器约束**：`workspace/projects/<id>/scripts/` 可以任意改，没有一致性检查。漂移事故就是这么来的（远端被改、母版没跟上，导致真机失败）。
2. **路由层仍在膨胀**：`projects.routes.js` 已 27KB（27,332 字节），**12 个端点**挤在一个文件里。这是 T3-1「巨石」问题的服务端版本。
3. **判定点分散**：11 层判定分散在 6 个模块，没有统一的状态机描述。新增判定点容易漏。
4. **`.tmp/` 有 18,713 个文件**：本地临时目录没有清理策略，已经影响文件扫描类工具的性能（实测一次全仓色值扫描要遍历它们）。
5. **`BioanalysDesktop/Python/` 2418 个文件**：打包运行时混在应用目录里，与源码层级混在一起。
