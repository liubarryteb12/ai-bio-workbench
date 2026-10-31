# 分布式 AI 生信分析自动化工作台（v2.0）全栈工程与智能体主蓝图

> **定位**：面向独立开发者（单兵 CTO 统帅 + 产品/营销外包模式）的工业级全量落地手册  
> **适用基线**：Redmi K40 (`k40-ubuntu` ARM64) + `BioanalysDesktop` (`127.0.0.1:18787`) + Tailscale (`100.64.0.0/10`) + A2A v1.0 (JSON-RPC 2.0) + 三线物理隔离 (`line1_bulk` / `line2_scrna` / `line3_spatial`)  
> **文档性质**：全量可执行工程规范（含组织架构、6 大 Agent 生产级 System Prompts、4 大核心 JSON Schema、5 大核心可执行脚本/代码模块、12 项预见性灾备矩阵）

---

## 一、 全局顶层设计：单兵 CTO 统帅下的“1 + 6”虚拟部门编制

针对将 **1（产品策划/早期课题调研）** 与 **4（市场营销/获客分发）** 外包后，系统边界必须具备极强的**防劣化门禁能力**：既保护后端免受随意变动的需求冲击，又阻断低质营销流量对生信算力的无谓消耗。

为此，在原有的 4 大核心执行角色基础上，补充 **Role 0（外包门禁与归因官）** 与 **Role 5（台账审计与混沌巡检官）**，构成完整的 **6 大虚拟职能部门**：

| 岗位编号 | 虚拟职能部门名称 | 驻留位置 | 触发时机 | 输入契约 | 输出契约 | 核心工程职责 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Role 0** | **外包门禁与商业归因官**<br>*(Intake & Attribution Gatekeeper)* | `02_client_ui` 边界 | 用户或外包提交表单瞬间 | 原始表单 / 文件流 + UTM 参数 | `requirement.json` | 拦截残损临床表型、校验样本量下限、注入营销渠道归因指纹、核算算力配额成本 |
| **Role 1** | **生信首席管线规划官**<br>*(Chief Bio-Planner)* | `03_server` 内嵌 Agent | 收到合法 `requirement.json` | `requirement.json` + `topic_sieve_spec.md` | `execution_manifest.json` | 依据 L0~L4 / T1~T9 准入筛规划 DAG 管线、执行前置内存估算、锁定 `seed=20261013` |
| **Role 2** | **中枢调度与三线隔离守卫**<br>*(Hub & Isolation Guard)* | `03_server` 核心引擎 | Manifest 生成后 / 派单前 | `execution_manifest.json` | `A2A JSON-RPC Task` | 断言 `line1/2/3` 物理隔离、锁定输入矩阵 SHA256、维护双模状态机与追加式 JSONL 台账 |
| **Role 3** | **边缘算力与故障自愈专家**<br>*(Edge Compute SRE)* | `01_mobile` + `03_server` | 算力执行期 / 报错触发时 | `A2A Task` 或削峰报错日志 | `三联 Artifact` 或 `healing_action.json` | 管控 K40 容器 3 线程执行、电池温度熔断挂起、`.lock/.done` 幂等续跑、R/Python 报错最小化自愈 |
| **Role 4** | **独立质量终验与交付审计官**<br>*(QA & Delivery Auditor)* | `03_server` 内嵌 Agent | 算力端回传三联 Artifact 后 | `三联 Artifact` + 图件二进制流 | `acceptance_card.json` + `deliverables/` | 双阶段核验（退出码 + PNG/PDF 首尾魔数 + 生物学显著性评分卡）、打包客户四大件（含复现胶囊） |
| **Role 5** | **台账对账与混沌巡检官**<br>*(Ledger & Chaos Auditor)* | `03_server` 定时守护 | 每日闲时 Cron / 发版前 | `con_hf/ledger/*.jsonl` | `daily_health_report.json` | 扫描孤儿进程、核验双层五类台账哈希链完整性、统计外包渠道 ROI 与算力耗时分布 |

---

## 二、 架构降维优化：从“5 实体乒乓通信”重构为“模块化单体中枢 + 边缘心跳拉取”

### 1. 物理合体、逻辑解耦（Modular Monolith）
在工程落地中，**逻辑解耦不等于物理拆分**。将 `04_ai_automation` 作为 `03_server_orchestrator` 进程内的异步中间件模块（In-Process Pipeline Middleware）运行，具备三大优势：
* **零跨网 RPC 开销**：省去 Server 与 AI 之间的网络鉴权、重试风暴与超时维护负担。
* **事务级台账一致性**：AI 生成的 `execution_manifest.json` 与 `acceptance_card.json` 在同一内存上下文中通过 `isolation_guard.py` 校验并写入 `con_hf/ledger/`。
* **对外汇报视图清晰**：对外部专家汇报依然保持四大板块清晰分界，代码实现收敛于高效单体。

### 2. 双向兼容 + 遥测心跳捎带（Heartbeat Piggybacking）
针对移动端长时间休眠可能导致的入站 Socket 挂起，确立双向保障机制：
* **主动派发通道（Push）**：网络通畅时，服务端直接通过 Tailscale 专网调用手机端 `:9910` A2A `SendMessage` 接口。
* **心跳拉取兜底（Pull + Telemetry）**：手机端 `pi_telemetry_sidecar.py` 每 10 秒向服务端上报硬件指标并捎带未同步的 `.done` 三联产物。即使入站网络中断，手机自治跑完后依然通过心跳主动回传，确保断网零重跑。

### 3. JSON-Schema 驱动前端表单
客户端交互完全由 `requirement.schema.json` 驱动。外包团队增删字段只需提交 Schema 补丁，前端组件自动适配，保护研发核心不受频繁需求变动干扰。

### 4. 客户交付包升级为“四大件”
在常规分析报告、期刊级图表包与全量数据表之外，自动生成第 4 件：**`04_Reproducibility_Capsule.zip`（学术复现胶囊）**，内含锁死参数清单、运行环境精确快照与全链路 SHA256 签名证书，建立严密的学术复现凭证。

---

## 三、 六大虚拟职能部门生产级提示词体系

见 `.agents/prompts/` 目录：
- `role0_intake_gatekeeper.md`
- `role1_bio_planner.md`
- `role2_hub_guard.md`
- `role3_edge_sre.md`
- `role4_qa_auditor.md`
- `role5_ledger_chaos_auditor.md`

---

## 四、 四大核心数据契约体系

见 `schemas/` 目录：
- `schemas/requirement.schema.json`
- `schemas/execution_manifest.schema.json`
- `schemas/artifact_triad.schema.json`
- `schemas/acceptance_card.schema.json`

---

## 五、 核心生产级代码体系

见各板块实现：
- `01_mobile_compute/runtime/bio_limits.sh`
- `01_mobile_compute/runtime/pi_idempotent_runner.sh`
- `01_mobile_compute/runtime/pi_telemetry_sidecar.py`
- `03_server_orchestrator/core/isolation_guard.py`
- `03_server_orchestrator/core/ledger_engine.py`

---

## 六、 预见性风险与防崩盘灾备矩阵（12 大致命隐患与工程解药）

| 序号 | 所属板块 | 预见性致命隐患 | 触发场景与后果 | 工程级根治解药 |
| :--- | :--- | :--- | :--- | :--- |
| **01** | **手机算力端** | **Android 12+ Phantom Process Killer 杀后台** | 子进程数超标时系统静默杀死容器内进程，无报错退出（Exit 9/137）。 | ADB 执行 `settings put global settings_enable_monitor_phantom_procs false`，并由 `bio_limits.sh` 锁死 3 线程。 |
| **02** | **手机算力端** | **长时间插电导致 K40 电池鼓包与高温降频** | 24 小时满电满载，电池处于高压高温环境。 | 配置 ACC 旁路供电将电量锁在 45%~55%；`pi_telemetry_sidecar.py` 在 43°C 自动发 `SIGSTOP` 降温。 |
| **03** | **手机算力端** | **R/Bioconductor 在 ARM64 源码编译失败** | 依赖 C++/Fortran 的生信包在本地编译容易遭遇内存不足。 | 严禁运行时动态编译；采用预编译 Wheel/Deb 包构建 golden 镜像冷备份。 |
| **04** | **手机算力端** | **写入 `/sdcard` 引发权限丢失与文件锁死** | FUSE 文件系统不支持 POSIX 权限位与软链接，`h5ad` 写入报错。 | `bio_limits.sh` 植入 `check_no_sdcard_path`，强制所有计算拘束在原生 `ext4` 分区。 |
| **05** | **分布式网络** | **本地系统代理劫持 Tailscale 流量** | 电脑代理软件拦截 `100.64.0.0/10` 导致 RPC 超时。 | 双端强制配置 `NO_PROXY` 环境变量并显式声明绕过代理。 |
| **06** | **生信数据流** | **基因名被 Excel 篡改为日期** | 导入数据中基因名变为 `1-Mar`、`2-Sep` 等日期格式。 | Role 0 门禁正则扫描自动修正 Excel 污染基因名。 |
| **07** | **生信数据流** | **物种基因大小写混用导致富集全空** | 小鼠实验输入全大写人类基因符号，导致靶点匹配落空。 | Role 1 规划期通过物种同源字典强制标准化。 |
| **08** | **生信数据流** | **海量进度条输出撑爆通信上下文** | 单细胞进度条产生几十 MB 文本日志拖垮网络。 | `pi_idempotent_runner.sh` 执行首尾削峰，日志压缩提取。 |
| **09** | **AI 终验端** | **绘图设备异常导致截断或空白图件** | 进程退出码为 0 但图件破损打不开。 | `isolation_guard.py` 强制核验 PNG `IEND` 与 PDF `%%EOF` 真实二进制魔数。 |
| **10** | **外包协同** | **外包团队频繁改动输入表单** | 采集字段变动导致前端频繁修改。 | 采用 JSON-Schema 驱动动态渲染，仅改配置即完成前后端对齐。 |
| **11** | **外包协同** | **营销外包导入低质刷量流量** | 无效测试任务堵死算力队列。 | 按 `_attribution.tier` 实行分级调度队列，低优先级仅分配缓存算力。 |
| **12** | **客户交付端** | **审稿人质疑生信分析不可复现** | 投稿时被要求提供精确环境与参数证明。 | 自动生成 `04_Reproducibility_Capsule.zip`，内含全链路哈希与环境签名。 |

---

## 七、 客户交付包（四大件）标准目录结构

```text
deliverables/PROJ_20261031_A8F92C/
├── 01_Executive_Bio_Report.pdf           # 【第 1 件：AI 终验解读报告】
├── 02_Publication_Ready_Figures/         # 【第 2 件：期刊级高清图表包】
│   ├── Fig1A_PCA_Batch_QC.pdf
│   ├── Fig1B_Volcano_DEG.png
│   ├── Fig2A_Pathway_Enrichment.pdf
│   └── Fig3A_scTenifoldKnk_Network.pdf
├── 03_Processed_Tables/                  # 【第 3 件：全量统计结果表】
│   ├── Table1_Normalized_Matrix.tsv
│   ├── Table2_DEG_Full_Statistics.tsv
│   └── Table3_Enrichment_Pathways.tsv
└── 04_Reproducibility_Capsule.zip        # 【第 4 件：学术复现胶囊】
    ├── execution_manifest.locked.json
    ├── acceptance_scorecard.json
    ├── sha256_manifest.txt
    └── runtime_session_info.txt
```

---

## 八、 单兵 CTO 7 天极速落地路线图

* **Day 1（立规矩与封底座）**：落盘 `bio_limits.sh` 与 `pi_idempotent_runner.sh`，完成首个带 `.lock/.done` 的本地算力测试。
* **Day 2（装护栏与通专网）**：部署 `pi_telemetry_sidecar.py`、`isolation_guard.py` 与 `ledger_engine.py`，联调心跳捎带与三线隔离断言。
* **Day 3（挂接规划与终验）**：接入 Role 1 与 Role 4，打通 `requirement.json` ➔ `execution_manifest.json` ➔ K40 ➔ `acceptance_card.json`。
* **Day 4（挂接门禁与自愈）**：接入 Role 0 门禁与 Role 3 报错自愈，验证 OOM 与脏数据容错熔断。
* **Day 5~6（组装控制台三视图）**：在 `BioanalysDesktop` 挂载 Schema 动态表单、遥测卡片与 JSONL 审计流。
* **Day 7（Golden 镜像归档与交接）**：导出 K40 容器冷备份，向外包产品与营销团队输出 Schema 规范，正式上线。
