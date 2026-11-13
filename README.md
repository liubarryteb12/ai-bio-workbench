# AI 辅助生信分析流程工作台

把一次生信分析需求，变成一条可审计、可复现、可验收、可追责的交付流水线。

本仓库覆盖三条分析线：GEO Bulk、单细胞转录组、空间转录组。它提供管理员工作台、客户需求门户、结构化作业编排、质量门禁、报告与交付链，以及一个可配置的算力适配层。本地只做交互与控制，具体计算由使用者自备的算力节点执行。

## 目录

- [项目定位](#项目定位)
- [核心能力](#核心能力)
- [系统架构](#系统架构)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [算力接口](#算力接口)
- [三条分析线](#三条分析线)
- [一次作业的生命周期](#一次作业的生命周期)
- [质量门禁](#质量门禁)
- [常用命令](#常用命令)
- [文档导航](#文档导航)
- [隐私与安全边界](#隐私与安全边界)

## 项目定位

本项目的重点不是“能不能跑分析”，而是下面四个问题：

1. **可追溯**：产物来自哪次工单、哪个 Mod、哪个随机种子、哪个执行面，回执里可以查到。
2. **可复现**：分析母版与执行面同源，环境版本与随机种子冻结，项目层不复制母版副本。
3. **可验收**：交付包先验后签，验收门禁只认实时哈希。
4. **防退化**：门禁不仅证明“修好能变绿”，还用变异反证证明“改坏会变红”。

明确不做的事写在 `SCOPE.md`：不做脱离退出判据的自主探索型 Agent，不做通用大模型问答窗口，不接与三条线无关的临时脚本需求，不在生产链引入重型解卷积算法。

## 核心能力

| 能力 | 说明 |
|---|---|
| 三条分析线 | Bulk、单细胞、空间转录组，线之间默认硬隔离 |
| 分析模块 | `tools/bio/workflows.json` 登记 54 个 Mod，母版脚本按目录即契约组织 |
| 图件体系 | 92 个图件模板，27 个 Ready 单图，300 DPI，版式可机器校验 |
| 作业编排 | `work_order/v2` 作为正式输入，`receipt/v1` 作为唯一权威回执 |
| 状态管理 | 五态状态机，单消费者队列，终态重跑拒绝，回执不重复 |
| 质量体系 | 27 道串联门禁，全量契约测试，19 条基础设施变异反证与 6 条行为变异反证 |
| 交付链 | 报告构建、四关验收、Ed25519 验签、客户交付包 |
| 算力适配 | 本地零算力，计算命令通过可配置适配器下发到用户自备节点 |

## 系统架构

```text
客户浏览器
   |
   v
[客户门户 portal/ :8080]  需求单、数据文件分块上传、课题调研
   |
   v
[门户收件箱 portal/inbox/]  需求单、清单、数据、参考文献
   |
   v
[管理员工作台 BioanalysDesktop/ :18787]  审阅、选线、选 Mod、排队、看回执
   |
   v
[算力适配层]  adb / mock，由使用者按自己的环境配置
   |
   v
[用户自备算力节点]  Linux 容器与数据盘，执行 R 与 Python 分析
```

四层职责：

| 层 | 位置 | 职责 | 边界 |
|---|---|---|---|
| 交互层 | `BioanalysDesktop/src/`、`portal/` | 表单、预览、任务状态、回执时间线 | 不直接跑分析 |
| 控制面 | `core/`、`schemas/`、`skills/`、`tools/` | 门禁、契约、路由、编排、报告与交付 | 不存放客户原始数据 |
| 数据面 | `workspace/projects/`、算力节点数据盘 | 项目输入、中间态、结果、图件、交付物 | 不混入控制面代码 |
| 算力面 | 使用者自备的 Linux 容器 | R 与 Python 计算、产物落盘、运行标记 | 不长期存放仓库副本 |

架构宪法是 `SPEC.md`。它定义三原则：三明治架构、控制面与数据面隔离、Fail-Closed 与真源唯一。每条原则都绑定真实执行门禁。

## 目录结构

```text
.
├── SPEC.md / SCOPE.md / ROUTER.yaml / GLOSSARY.md
│   架构宪法、范围与否决台账、声明式路由、术语表
├── INDEX.yaml / MIGRATION.md / AGENTS.md
│   全局导航、重构契约、Agent 工作纪律
├── BioanalysDesktop/          管理员工作台，React + 原生 node:http
├── portal/                    客户需求门户与收件箱
├── tools/
│   ├── bio/                   三条线分析母版与 workflows.json
│   ├── dev/                   质量门禁、作业编排、变异反证
│   ├── reporting/             报告、图件、交付与验收
│   └── ops/                   本地运维与算力通道脚本
├── core/                      跨语言桥接守卫
├── schemas/                   工单、回执与网关 schema
├── shared/                    前后端共享的纯函数与契约
├── skills/                    SOP 规约资产，stable 与 in-progress 分级
├── workspace/
│   ├── projects/              每个项目一个自包含目录
│   └── handoff/               跨会话交接与历史决策
├── ledger/                    追加式 JSONL 台账与运维台账
├── references/                只读参考库
├── docs/                      工程规范、运行记录与架构文档
└── deliverables/ artifacts/   交付与产物暂存
```

`docs/directories.md` 规定“文件放哪”。`docs/ARCHITECTURE_OVERVIEW.md` 给出更细的信息流与判定顺序。

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- PowerShell 7，Windows 本地运维使用
- 可选：`adb`，仅当使用 ADB 算力适配器时需要

### 启动管理员工作台

```powershell
cd BioanalysDesktop
npm install
npm run dev
```

默认地址：

- 管理员工作台：`http://127.0.0.1:18787/`
- 前端开发服务器：`http://127.0.0.1:5173/`

### 启动客户需求门户

```powershell
node portal/serve.mjs
```

默认地址：`http://127.0.0.1:8080/`

Windows 下也可以直接运行：

```powershell
.\start_all.bat
```

### 离线演示

没有真实算力节点时，使用 mock 适配器跑通界面与链路：

```powershell
$env:BIO_COMPUTE_ADAPTER = "mock"
$env:BIO_ALLOW_MOCK_COMPUTE = "1"
cd BioanalysDesktop
npm run dev
```

mock 只用于测试与离线演示，生产进程默认拒绝 mock。

## 算力接口

本仓库不绑定任何具体设备。设备型号、序列号、主机名、密钥指纹与个人目录都属于使用者的本地环境，不进入仓库，也不进入公开文档。

算力层通过适配器接入。当前支持两种适配器：

| 适配器 | 用途 |
|---|---|
| `adb` | 通过 ADB 把命令与脚本下发到用户自备的 Linux 节点 |
| `mock` | 测试与离线演示，不连接任何真实节点 |

最小配置：

```powershell
$env:BIO_COMPUTE_ADAPTER = "adb"
$env:BIO_ADB_SERIAL = "<your-device-serial>"
$env:BIO_COMPUTE_NODES = '[{"id":"compute-node-1","host":"compute-node-1","primary":true}]'
```

完整字段、节点池格式、健康探针、文件传输契约与故障语义见 `docs/COMPUTE_INTERFACE.md`。示例配置见 `configs/compute.example.json` 与 `.env.example`。

三条硬约束：

1. **算力节点由使用者自备**，仓库只提供接口与参考实现。
2. **凭证与设备标识只放本地环境变量**，不写入仓库、不写进文档、不写进报告。
3. **适配器失败即拒绝**，不静默回落到其他通道。

## 三条分析线

注册表真源是 `tools/bio/workflows.json`。线之间默认硬隔离，唯一例外是注册表声明的冻结签名桥。

| 线 | 名称 | 主要能力 | 主语言 | 末端模块 |
|---|---|---|---|---|
| `line1_bulk` | GEO Bulk 常规挖掘 | 预处理、整合去批次、QC、DEG、WGCNA、富集、PPI、机器学习、外部验证 | R | 机器学习建模与外部验证 |
| `line2_scrna` | 单细胞转录组 | Harmony 整合、聚类注释、细胞组成、分支分析、转录因子、虚拟敲除 | Python | 虚拟敲除与 DR 后分析 |
| `line3_spatial` | 空间转录组 | Visium 读入、spot QC、降维、空间域、空间自相关、解卷积、空间虚拟敲除 | Python 与 R | 空间虚拟敲除 |

算力与内存红线：

- 运行面按 12 GB 物理内存设计，容器默认上限 7.5 GB，单任务最高 8.0 GB，由 `BIO_MEM_LIMIT_GB` 控制。
- 空间与单细胞解卷积只允许 `scipy.optimize.nnls`，单步内存不超过 2.2 GB。
- 禁止 `cell2location`、`Stereoscope`、`RCTD` 等重型算法进入生产链。
- 精度提升走零算力路线：上游 Top 20 特异 Marker 提纯，输出端小于 0.05 丰度硬截断。

## 一次作业的生命周期

```text
需求单 requirement.json
  -> 门户归档 PKG_<时间戳>_<项目名>/
  -> 管理员审阅，生成 work_order/v2
  -> 作业 API 校验，落 workspace/projects/<id>/work_orders/
  -> 管理员确认，进入受控队列
  -> runWorkOrder 编译 DAG，补齐必需上游
  -> 逐项上传，校验 size 与 sha256
  -> 逐任务提交，串行等待回执
  -> 失败即短路，下游保持 blocked
  -> 报告构建，四关验收，Ed25519 签名
  -> receipt/v1 权威回执
  -> 客户下载交付包
```

关键真源：

| 环节 | 文件 |
|---|---|
| 工单声明面 | `schemas/work_order_v2.schema.json` |
| 工单运行时校验 | `shared/work_order_v2.mjs` |
| 回执声明面 | `schemas/receipt_v1.schema.json` |
| 回执运行时生成 | `BioanalysDesktop/server/receipt_v1.js` |
| 编排执行 | `tools/dev/work_order_orchestrator.mjs` |
| 作业服务 | `BioanalysDesktop/server/services/work_order.service.js` |
| 作业路由 | `BioanalysDesktop/server/routes/work_orders.routes.js` |
| 作业视图 | `BioanalysDesktop/src/views/WorkOrderCenterView.tsx` |

## 质量门禁

单命令总门禁：

```powershell
node tools/dev/run_all_gates.mjs
```

快速门禁，跳过全量测试：

```powershell
node tools/dev/run_all_gates.mjs --skip-tests
```

门禁覆盖环境预检、静态语言、目录隔离、项目脚本边界、工单闭环、路由与台账一致性、图件注册表、Ready 实证矩阵、出图规范、交付审计、变异反证、单权威租约、队列单消费者与全量测试基线。

跳过必须带白名单原因，由 `tools/dev/skip_reason_gate.mjs` 校验。新增防线必须先写会红的契约测试，再写实现。

## 常用命令

| 目标 | 命令 |
|---|---|
| 安装前端依赖 | `cd BioanalysDesktop; npm install` |
| 启动工作台 | `cd BioanalysDesktop; npm run dev` |
| 启动门户 | `node portal/serve.mjs` |
| 前端类型检查 | `cd BioanalysDesktop; node node_modules/typescript/bin/tsc --noEmit` |
| 契约测试 | `cd BioanalysDesktop; npm test` |
| 端到端测试 | `cd BioanalysDesktop; npm run test:e2e` |
| 总门禁 | `node tools/dev/run_all_gates.mjs` |
| 快速门禁 | `node tools/dev/run_all_gates.mjs --skip-tests` |
| 宿主依赖预检 | `node tools/dev/preflight.mjs` |
| 路由静态校验 | `node tools/dev/router_gate.mjs` |

## 文档导航

| 想知道什么 | 先读 |
|---|---|
| 架构原则与执行门禁 | `SPEC.md` |
| 范围红线与已否决设计 | `SCOPE.md` |
| 术语的唯一权威 | `GLOSSARY.md` |
| 目录与文件放置规则 | `docs/directories.md` |
| 分析代码规范 | `docs/coding-standards.md` |
| 三线隔离约束 | `docs/isolation.md` |
| 当前改造目标与里程碑 | `docs/GOAL_2026-11-11.md` |
| 工单编排与回执 | `docs/WORK_ORDER_ORCHESTRATOR.md` |
| AI 管理员编排规格 | `docs/AI_ORCHESTRATION_SPEC.md` |
| 出图规范 | `docs/figure_spec.md` |
| 空间 H&E 叠加流程 | `docs/SPATIAL_HE_OVERLAY_PIPELINE.md` |
| 算力接口配置 | `docs/COMPUTE_INTERFACE.md` |
| 算力节点搭建与恢复 | `docs/RUNBOOK_COMPUTE_NODE.md` |
| 远程通道策略 | `docs/remote_channel_policy.md` |

## 隐私与安全边界

- 本仓库不包含任何个人设备型号、序列号、主机名、登录凭证、SSH 私钥或密钥指纹。
- 设备档案与历史交接件只放本机 `_private/`，该目录已被 `.gitignore` 忽略。
- 算力节点信息通过本地环境变量或未跟踪的 `.env.local` 提供。
- 交付报告只写对读者有意义的事实。机器名、主机名、绝对路径、运行环境、内部脚本目录与设施用语不进入报告正文与页脚。
- 展示命令、输出或捕获产物前先脱敏。secret 一律写 `<REDACTED>`。
- 客户数据、中间态与交付物只放在数据面，不混入控制面。

## 赞助支持

如果这个项目对你有帮助，可以通过下面的赞助码支持后续维护与更新。

![赞助码](docs/assets/sponsor.jpg)

## 许可与状态

许可证与第三方依赖说明见 `LICENSES.md`。本仓库当前为私有仓库，包含核心商业生信母版与交付底座，公开前需要单独评审。
