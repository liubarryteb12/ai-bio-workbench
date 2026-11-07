# AI 辅助生信分析流程工作台 · 全量技术交接清单 (Handover Checklist)

> **文档性质**：工作台最高级别项目工程与技术交付交接总卷  
> **基线时间**：2026-11-07  
> **Git 分支/基线**：分支 `master`，最新提交 `adb7a9b`（及随后的文档沉淀）  
> **当前官方基线**：**19 道门禁全绿（12秒）**｜**1823 tests / 1822 pass / 0 fail / 1 skipped**（212 个测试文件）｜**代码规模 22,310 SLOC**（非空行，79 个核心源文件）｜**算力面 57 脚本逐字节同源 (`K40_SCRIPT_PARITY_OK`)**｜**空间图件 33/33 比例尺像素实测 0.00% 误差闭环**  
> **终审认证**：4 Argon（Gemini 4 Argon High）第 74 轮正式签署封板批准与框架演进路线图。  

---

## 一、交接清单阅读指引与快速导航

本交接清单是接手工程师（无论是人类架构师、全栈研发还是协作 AI Agent）进入本仓库展开任何维护、开发或运维工作的**第一必读法典**。全卷分为 8 个专业领域分册与 1 个机读结构化总表：

| 分册编号 | 文档名称 | 核心内容摘要 | 适用场景 |
|---|---|---|---|
| **总览** | [`README.md`](README.md) | 全量交接总纲、基线卡片、10 大接手铁律、3 分钟快速启停与验证 | 新人入职第一天、日常操作总索引 |
| **分册 01** | [`01_全仓架构与目录全景.md`](01_全仓架构与目录全景.md) | 云-端解耦物理拓扑、单向依赖架构、`server/proc.js` 单接缝、端口矩阵与全仓目录树 | 系统全局认知、模块划分、代码寻路 |
| **分册 02** | [`02_环境准备与日常运行运维手册.md`](02_环境准备与日常运行运维手册.md) | PC 前端与后端部署、K40 物理机 (Termux + proot) 环境、ADB 转发、常驻守护、命令字典 | 搭建环境、启停服务、日常故障恢复 |
| **分册 03** | [`03_19道质量门禁与测试体系全解.md`](03_19道质量门禁与测试体系全解.md) | 19 道门禁逐道原理解析、1823 条测试全景、变异门禁（7+6 MUT 反证）、跳过白名单 | 提交代码前自检、CI 报红排查 |
| **分册 04** | [`04_三条生信流水线与57母版全景.md`](04_三条生信流水线与57母版全景.md) | Line 1 Bulk (15步)、Line 2 scRNA (22步)、Line 3 Spatial (17步)、49 Mod ID 映射、NNLS 解卷积硬件红线 | 生信算法迭代、流水线调度、母版维护 |
| **分册 05** | [`05_物理尺度真值标定与SCI图件工程.md`](05_物理尺度真值标定与SCI图件工程.md) | Visium 100 µm 晶格标定物理真值、两级验证体系、33 张图实测 0% 误差复核、82 出图模板 | 出图规范审查、比例尺调优、期刊排版 |
| **分册 06** | [`06_交付项目资产与数据流转现状.md`](06_交付项目资产与数据流转现状.md) | `PRJ_STROKE_P1` 与 `PRJ_STROKE_P2` 执行现状、HTML 综合报告生成、商业机密级脱敏红线 | 项目交付验收、客户成果发布、数据归档 |
| **分册 07** | [`07_三审联动智囊会诊与通用框架吸收蓝图.md`](07_三审联动智囊会诊与通用框架吸收蓝图.md) | 元宝(HY4)调研、DeepSeek代码走查、4 Argon终审裁决、Q1~Q7争议仲裁、Phase 0/1/2 路线图 | 架构演进重构、通用 Agent 底座复用 |
| **分册 08** | [`08_技术债_踩坑记录与接手禁忌.md`](08_技术债_踩坑记录与接手禁忌.md) | 11 条 REJ 否决设计、14 项技术债现状、PIT-001~029 踩坑复盘、开发防踩雷指南 | 需求评审避坑、历史决策追溯 |
| **机读总表** | [`交接清单总表.tsv`](交接清单总表.tsv) | 结构化机读总表（分类、项目、规范、验证命令、责任文件、当前状态、验收标准） | 自动化巡检、脚本解析、核对打钩 |

---

## 二、核心架构定位与三原则

### 1. 一句话定位
**本地只做交互编排与门禁，零算力计算；全部高负载生信分析计算严格下沉至物理手机 K40 容器执行面。**

### 2. 架构三原则
1. **确定性归代码，推理归模型，操作有边界，过程全审计**：
   - 严禁让 AI 拥有不受控的命令行执行权限；
   - 模型只能通过强类型参数契约发起动作，由确定性白名单接缝执行。
2. **三线物理隔离优先于一切（最高优先级规则）**：
   - GEO Bulk 转录组常规挖掘（`line1_bulk`）；
   - 单细胞转录组 + 虚拟敲除（`line2_scrna`）；
   - 单细胞空间转录组 + 空间虚拟敲除（`line3_spatial`）。
   - 三线在数据存储、运行环境、结果目录上实施物理隔离，严禁跨线交叉取数（由 `server/audit.js` 硬拦截）。
3. **硬件受限运行面硬约束（8GB 内存配额）**：
   - 目标算力设备为物理手机 K40（Android 13 / Termux / proot Ubuntu 容器），容器配额仅 7680 MB；
   - 空间与单细胞解卷积严格限定为轻量 `scipy.optimize.nnls`（单步内存 $\le 2.2\text{ GB}$）；
   - **严禁在生产流水线上引入 `cell2location`、`RCTD`、`Stereoscope` 等深度学习或重型回归算法**（会导致 OOM Exit 137 或降频死锁）。

---

## 三、十条不可逾越的接手铁律（接手人必背）

1. **本地零算力铁律**：本地 PC 严禁直接启动 R / Rscript / Python / bash 跑分析（`server/proc.js` 白名单仅放行 `ssh`、`scp`、`adb`，违者测试直接报红）。
2. **19 道门禁不全绿不得提交**：修改任何业务代码后，必须本地跑通 `node ops/run_all_gates.mjs`，严禁带着红灯强推代码。
3. **算力面必须双向字节一致**：修改任何 `src/*/scripts/` 下的分析母版，必须通过 `ops/06_deploy_scripts.ps1` 同步到 K40，并由 `ops/k40_script_parity.mjs` 确认 57 个脚本逐字节一致。
4. **空间图件比例尺双口径一致**：标准 Visium 切片严格按晶格常数标定（100.0 µm / 内部点第一壳层中位 px），`manifest bar_px` 必须与 PNG 实际渲染像素严格一致（误差 $\le 0.05\%$）。
5. **交付报告商业机密级脱敏**：任何交付给客户或导出的报告正文中，绝对不得包含内部路径、机器名、IP、端口、容器、Termux、proot、K40、ops 等基础设施字眼（由 `report_redaction_contract.test.js` 守门）。
6. **严禁在项目目录下复制母版副本**：所有分析项目必须通过参数化调用公共只读母版，严禁在 `local_projects/*/scripts/` 下复制同名脚本改一版（由 `project_script_gate.mjs` 硬拦截）。
7. **变异反证红线**：新增或修改关键防线必须提供变异测试反证（`mutation_gate.mjs` 确保防线被破坏时必红，不能存在恒绿的空断言）。
8. **测试跳过显式声明**：用例跳过（SKIP）必须且仅能使用 `ALLOWED_SKIP_REASONS` 中的白名单标签，并写明具体原因，禁止无理由跳过测试。
9. **零新增顶层目录**：吸收通用框架或扩展功能时，严禁在仓库根目录下新建顶层目录，所有资产必须收敛于现有的 `ops/`, `docs/`, `BioanalysDesktop/server/`, `src/` 中。
10. **台账有效期上限锁定**：任何已否决设计（REJ）或知识台账，其 `expires_at` 距今不得超过 180 天，禁止写入超长过期日逃避自动化核验。

---

## 四、三分钟快速上手与常用运维命令

### 1. 一键启动本地工作台（管理端 + 门户）
```powershell
# 终端 1：启动桌面端服务（后端 18787 + 前端 5173）
Set-Location 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop'
npm run dev

# 终端 2：启动客户需求提交门户（默认 8080）
Set-Location 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台'
node portal/serve.mjs
```

### 2. 核心质检与门禁校验命令
```powershell
Set-Location 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台'

# 执行 19 道全量门禁（日常极速模式，跳过耗时测试，约 12 秒）
node ops/run_all_gates.mjs --skip-tests

# 执行全量门禁（含全量 1823 条测试与运行时核验，约 100 秒）
node ops/run_all_gates.mjs

# 仅跑单元与契约测试套件
Set-Location 'BioanalysDesktop'
node --test --test-concurrency=1 tests/*.test.js

# 检查与同步代码规模与测试基线
node ../ops/metrics_sync.mjs --check   # 校验基线一致性
node ../ops/metrics_sync.mjs --write   # 自动回写最新实测基线
```

### 3. K40 算力面通信与部署命令
```powershell
Set-Location 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台'

# 快速四段链路与硬件自检（ADB -> SSH 10022 -> 容器 -> SSD挂载）
pwsh -File ops/00_link_check.ps1

# 校验并部署最新分析母版脚本至手机容器（先比后传，保证双向一致）
& 'D:/node-v2.4/node.exe' ops/k40_script_parity.mjs             # 对账比对
pwsh -File ops/06_deploy_scripts.ps1 -Line line3_spatial -Force # 强制定向同步
```

### 4. 空间图件比例尺独立像素实测
```powershell
Set-Location 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台'

# 交叉核验两个交付项目的所有图件比例尺像素真实性
python ops/figure_scalebar_png_measure.py local_projects/PRJ_STROKE_P1_SPATIAL_ABCA1/figures/line3_spatial
python ops/figure_scalebar_png_measure.py local_projects/PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES/figures/line3_spatial
```

---

## 五、当前项目资产与待办事项交接

### 1. 核心资产完工状态
- **两大交付项目立项与分析全量完成**：`PRJ_STROKE_P1_SPATIAL_ABCA1` 与 `PRJ_STROKE_P2_SPATIAL_LACTPYRO_5GENES` 已跑通全线计算，产出 67 张高精空间切片图并生成两套完整 HTML 综合报告；
- **非生产参考代码彻底归档**：历史积累的 3,000+ 个外部参考代码已全量移入 [`可用代码预筛选/`](../可用代码预筛选/) 独立目录，与生产目录零污染隔离；
- **通用框架会诊裁定完成**：外部框架 `agent工作基础项目结构开发（hyl工作适用）` 已获 4 Argon 终审裁判，瘦身封板方案与三阶段吸收落地令已签发。

### 2. 接手后的后续顺位工作（已获 4 Argon 第 74 轮批准）
1. **第 1 顺位（外部通用框架封板）**：在 `D:\00.AIagent\antiworkspace\agent工作基础项目结构开发（hyl工作适用）` 执行精简瘦身（剔除 `gap_analyzer.py` 与独立 `personas/`，合并三本台账为单一结构，修补 `tasklist.py` 降级短路），保证其 `pytest` 24 项单测全绿封板；
2. **第 2 顺位（本项目 Phase 0 + Phase 1 落地）**：在本项目工作台编写 `ops/schema_gateway.py`（文件 IPC 校验网关）、扩展 `router_gate.mjs` 支持 `expires_at <= 180天` 上限约束、在 `task_fsm.js` 中补齐 `BLOCKED_UPSTREAM_DEGRADED` 显式短路，跑通 MUT-P0-A/B 与 MUT-P1-A/B 4 条变异反证；
3. **第 3 顺位（本项目 Phase 2 受控写）**：将 Schema 网关转正为阻断级校验，落地双语原子写与强杀回滚契约，跑通 MUT-P2-A/B 反证，完成全案终期闭环。

请按顺序参阅各专业分册以获取代码级实现细节与详细指引。
