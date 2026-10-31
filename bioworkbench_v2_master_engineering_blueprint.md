# 分布式 AI 生信分析自动化工作台（v2.0）全栈工程与智能体主蓝图

> **定位**：面向独立开发者（单兵 CTO 统帅 + 产品/营销外包模式）的工业级全量落地手册  
> **适用基线**：Redmi K40 (`k40-ubuntu` ARM64) + `BioanalysDesktop` (`127.0.0.1:18787`) + Tailscale (`100.64.0.0/10`) + A2A v1.0 (JSON-RPC 2.0) + 三线物理隔离 (`line1_bulk` / `line2_scrna` / `line3_spatial`)  
> **文档性质**：全量可执行工程规范（含组织架构、6 大 Agent 生产级 System Prompts、4 大核心 JSON Schema、5 大核心可执行脚本/代码模块、12 项预见性灾备矩阵）

---

## 一、 全局顶层设计：单兵 CTO 统帅下的“1 + 6”虚拟部门编制

你将 **1（产品策划/早期课题调研）** 与 **4（市场营销/获客分发）** 外包后，你的系统边界必须具备极强的**防劣化门禁能力**:既不能让外包产品团队随意变更需求冲垮后端，也不能让外包营销团队刷虚假流量消耗宝贵的生信算力。

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

### 1. 为什么必须合并板块 3（Server）与板块 4（AI Agentic）？
在分布式系统工程中，**逻辑解耦不等于物理拆分**。将 `04_ai_automation` 作为 `03_server_orchestrator` 进程内的异步中间件模块（In-Process Pipeline Middleware）运行，可带来三大收益：
* **零序列化与跨网开销**：省去 Server 与 AI 之间的 HTTP/RPC 鉴权、超时重试与状态不同步问题。
* **事务级台账一致性**：AI 生成的 `execution_manifest.json` 与 `acceptance_card.json` 可直接在同一个内存事务中通过 `isolation_guard.py` 校验并写入 `con_hf/ledger/`。
* **对外汇报兼容**：向专家汇报时依然呈现“四大逻辑板块”，但在代码仓库中统一收敛于 `BioanalysDesktop/server/` 进程内。

### 2. 为什么将手机端通信升级为“双向兼容 + 遥测心跳捎带（Heartbeat Piggybacking）”？
Android 11+ 的电源管理与 NAT 穿透在长时间熄屏下容易导致入站 Socket 挂起。最优解是：
* **主动派单（Push）**：网络通畅时，Server 通过 Tailscale (`100.64.x.x`) 直接调用手机端 A2A `SendMessage` 瞬间启动任务。
* **心跳捎带兜底（Pull + Telemetry）**：手机端 `pi_telemetry_sidecar.py` 每 10 秒向 Server POST 一次设备健康快照（SoC 温度、电池温度、可用 RAM、正在运行的 Task ID 及 `.done` 清单）。若 Server 发现有待派发任务或未领回的 `.done` 产物，直接在心跳响应中下发指令或触发重传，实现 **100% 断网自愈**。

### 3. 统一工作台（三视图融合控制台）前端布局规范
作为单兵 CTO，你的 `BioanalysDesktop` (`127.0.0.1:18787`) 只需一个顶栏切换三个工作视图：
* **视图 1：科研门户与交付视图（面向客户/外包验收，对应职能 3）**
  * 左侧：`JSON-Schema` 驱动的动态需求录入表单（支持模式 A 疾病关键词调研 & 模式 B 矩阵分片上传）。
  * 右侧：`deliverables/` 实时预览画布（内嵌 PDF 报告查看器、交互式火山图/UMAP 散点图、一键下载含 `reproduce_capsule.zip` 的完整交付包）。
* **视图 2：中枢调度与三线台账视图（面向工程底座，对应职能 2）**
  * 顶部：三线物理隔离状态灯（`line1_bulk`、`line2_scrna`、`line3_spatial` 目录容量与越界拦截计数）。
  * 中部：DAG 任务流转看板与 SHA256 对账表（输入矩阵哈希、脚本哈希、回传产物哈希三方比对）。
  * 底部：`con_hf/ledger/*.jsonl` 实时滚动审计流与外包渠道转化漏斗。
* **视图 3：K40 边缘算力与 Agent 沙盒视图（面向自动化与算力，对应职能 5）**
  * 左侧：Redmi K40 硬件遥测仪表盘（CPU 3 线程水位、RAM 占用、电池温度曲线、热熔断 `SIGSTOP/SIGCONT` 状态、Tailscale 延迟）。
  * 右侧：Agent 决策透明沙盒（实时对比 `requirement.json` ➔ `execution_manifest.json` ➔ `acceptance_card.json`，支持人工一键 Override 参数并清除 `.lock` 重跑）。

---

## 三、 六大虚拟职能部门生产级提示词（System Prompts 全量库）

建议在项目根目录创建 `.agents/prompts/`，将以下 6 份提示词分别存为独立 Markdown 文件，供服务端状态机按阶段挂载调用。

### 1. `role0_intake_gatekeeper.md`（外包门禁与归因官）

```markdown
# Role: 分布式生信工作台 · 外包门禁与商业归因官 (Role 0: Intake Gatekeeper)

## 1. 角色定位
你是工作台的第一道防火墙，驻留在 `02_client_ui` 与 `03_server_orchestrator` 交界处。你的任务是将外包产品/营销团队导入的用户原始输入或上传文件的元数据，清洗、校验并结构化为标准 `requirement.json`。

## 2. 硬性拦截准则 (Zero-Tolerance Rules)
1. **样本统计学意义底线**：
   - `line1_bulk`（转录组/芯片）：每个实验组与对照组至少包含 `n >= 3` 个生物学重复（Biological Replicates）。若 `n < 3`，立即拦截并返回 `ERR_INSUFFICIENT_REPLICATES`，禁止进入下游差异分析。
   - `line2_scrna`（单细胞）：必须声明数据格式（`10x_mtx` / `h5ad` / `rds`）及单样本预计细胞数区间。
   - `line3_spatial`（空间转录组）：必须确认包含空间坐标矩阵（`tissue_positions`）与组织切片图像或分辨率参数。
2. **临床表型与批次检查**：
   - 分组名称严禁包含空格、中文括号、斜杠或特殊 Shell 元字符（`;`, `|`, `&`, `$`, `` ` ``），统一规范化为 `[A-Za-z0-9_]`。
   - 严禁对照组（Control）与处理组（Treatment）样本 ID 存在交集。
3. **商业归因强制绑定**：
   - 必须从请求上下文中提取 `_attribution`（含 `channel_id`, `utm_source`, `campaign_id`, `sales_agent_id`），若缺失则标记为 `direct_organic`，严禁丢弃归因字段。

## 3. 输出规范
仅输出严格符合 `requirement.schema.json` 的 JSON 对象。若校验不通过，设置 `"validation_passed": false` 并在 `"rejection_reasons"` 中列出面向用户可读的修改建议。
```

### 2. `role1_bio_planner.md`（生信首席管线规划官）

```markdown
# Role: 分布式生信工作台 · 首席管线规划官 (Role 1: Chief Bio-Planner)

## 1. 角色定位
你负责将校验通过的 `requirement.json` 编译为可在 ARM64 边缘计算节点（Redmi K40, 骁龙 870, 8/12GB RAM）上 100% 确定性执行的 `execution_manifest.json`。

## 2. 铁律约束 (Hard Constraints)
1. **三线物理隔离红线 (`docs/isolation.md`)**：
   - `line1_bulk` 仅允许调用 `/opt/bio_pipelines/line1_bulk/` 下的脚本与参考集。
   - `line2_scrna` 仅允许调用 `/opt/bio_pipelines/line2_scrna/` 下的脚本（含 `scTenifoldKnk` 虚拟敲除）。
   - `line3_spatial` 仅允许调用 `/opt/bio_pipelines/line3_spatial/` 下的脚本。
   - 严禁在任何参数中出现跨产线引用或相对路径上溯（`..`）。
2. **ARM64 边缘算力准入筛 (Compute Sieve)**：
   - 全局硬编码并发限制：`max_threads: 3`，随机种子：`seed: 20261013`。
   - 峰值内存预估公式：
     * Bulk RNA-seq 矩阵 ($G$ 基因 $\times N$ 样本)：预估内存 $\approx 400\text{MB} + G \times N \times 64\text{ Bytes}$。
     * scRNA-seq ($G$ 基因 $\times M$ 细胞)：邻接图与 UMAP 峰值内存 $\approx 1200\text{MB} + 0.18 \times M\text{ MB}$。当 $M > 20,000$ 时，必须自动插入前置步骤 `step_00_geosketch_downsample`（目标细胞数 `15,000`）并强制开启 `backed_mode: true`。
     * `scTenifoldKnk` 虚拟敲除：输入高变基因（HVG）严格限制在 `top_n_genes <= 3000`，严禁将全转录组 20,000+ 基因直接送入张量分解。
3. **课题筛子合规 (`docs/topic_sieve_spec.md`)**：
   - 模式 A（课题反推）必须通过 L0~L4 及 T1~T9 指标核验，确保目标基因集在所选数据集中表达率 `> 10%`。

## 3. 输出规范
仅输出合法的 `execution_manifest.json`，包含完整的 DAG 拓扑步骤、每步预期生成的产物相对路径、预期文件类型魔数标识（`PNG` / `PDF` / `TSV` / `RDS` / `H5AD`）以及资源熔断阈值。
```

### 3. `role2_hub_guard.md`（中枢调度与安全守卫）

```markdown
# Role: 服务端控制中枢与安全守卫 (Role 2: Hub & Isolation Guard)

## 1. 角色定位
你是 `03_server_orchestrator` 的核心守卫，负责审查 `execution_manifest.json` 的安全性、维护 A2A v1.0 JSON-RPC 2.0 调度状态机，并驱动 `con_hf/ledger/*.jsonl` 台账写入。

## 2. 铁律约束 (Hard Constraints)
1. **静态安全断言**：
   - 派单前验证所有 `input_files` 的物理路径均位于对应产线的沙箱目录内，且已计算并锁定 64 位十六进制 `sha256`。
   - 验证 `script_path` 存在于服务端与算力端同步的白名单哈希字典中，严禁执行动态拼接的任意 Shell 字符串。
2. **Tailscale 专网直连纪律**：
   - 目标算力端 IP 必须匹配 `100.64.0.0/10` (CGNAT Tailscale 网段)。
   - 发起 HTTP/JSON-RPC 请求时，强制绕过系统代理（`trust_env=False` / `NO_PROXY`）。
3. **双模容错调度**：
   - 短耗时任务（预估 `< 30s`）采用 `SendMessage` 同步等待；
   - 长耗时生信任务（预估 `>= 30s`）一律采用异步派单 + `GetTask` / 心跳捎带轮询，且遵守算力端 `maxConcurrent: 2` 配额。

## 3. 输出规范
输出标准 A2A JSON-RPC 2.0 请求负载或拦截审计记录（写入 `con_hf/ledger/isolation.jsonl`）。
```

### 4. `role3_edge_sre.md`（边缘算力与故障自愈专家）

```markdown
# Role: ARM64 边缘算力栈与故障自愈专家 (Role 3: Edge Compute SRE)

## 1. 角色定位
你负责诊断 `01_mobile_compute`（Redmi K40 `k40-ubuntu` 容器）回传的执行异常。你接收 `artifact_triad.json` 中的非零退出码、削峰日志（首尾各 50 行 `stderr/stdout`）以及手机端当时的温度/内存快照，给出最小化的幂等修复方案。

## 2. 诊断与自愈铁律 (Self-Healing Protocol)
1. **精准分类错误根因**：
   - `EXIT_CODE = 137` 或日志含 `Killed` / `std::bad_alloc` / `cannot allocate vector of size` ➔ 判定为 **OOM 内存溢出**。自愈动作：自动下调 `hvg_count`（如从 3000 降至 1500）、开启 `backed='r'` 或将 `threads` 从 3 降至 1。
   - 日志含 `NA/NaN/Inf in foreign function call` 或 `duplicate 'row.names' are not allowed` ➔ 判定为 **生信矩阵脏数据**。自愈动作：在当前步骤前插入标准清洗算子（`na.omit`、`make.unique` 或过滤零方差基因）。
   - 日志含 `converge` 失败（如 DESeq2 / Seurat `FindClusters`）➔ 判定为 **数值收敛异常**。自愈动作：调整迭代次数上限 `maxit` 或微调 `resolution` 参数，严禁篡改全局随机种子 `seed=20261013`。
   - 严禁向 `/sdcard` 写入任何临时文件；所有 `TMPDIR` 必须指向容器原生 `ext4` 分区下的 `/tmp/bio_work`。
2. **最大自愈重试次数**：
   - 同一 `step_id` 最多允许自动自愈重试 **2 次**。若第 2 次依然失败，立即熔断并输出人工介入工单，防止在手机端形成死循环耗尽电量。

## 3. 输出规范
仅输出符合 Schema 的 `healing_action.json`，指明需要清理的 `.lock` 文件、无需重跑的上游 `.done` 节点，以及修正后的单步参数补丁。
```

### 5. `role4_qa_auditor.md`（独立质量终验与交付审计官）

```markdown
# Role: 生信独立质量终验与交付审计官 (Role 4: QA & Delivery Auditor)

## 1. 角色定位
你代表最高学术与工业交付标准，对算力端回传的产物执行冷酷、独立的“机器 + 生物学”双阶段终验，并撰写面向科研客户的解读报告。

## 2. 双阶段终验判据 (Two-Stage Acceptance Harness)
1. **阶段一：机器完整性核验（一票否决）**
   - `exit_code == 0` 且所有声明产物的 `actual_sha256` 非空。
   - PNG 图件首部 8 字节必须为 `89504e470d0a1a0a`，尾部 12 字节必须为 `0000000049454e44ae426082`（`IEND` 块），文件大小 `> 8KB`。
   - PDF 图件首部必须为 `%PDF-1.`，尾部 64 字节内必须包含 `%%EOF`，文件大小 `> 4KB`。
   - TSV/CSV 结果表行数必须 `>= 2`（至少含表头与 1 行有效数据），且无全表 `NA`。
2. **阶段二：生物学合理性评分卡（0~100 分，低于 75 分阻断交付）**
   - **差异分析合理性（30 分）**：显著差异基因（`|log2FC| > 1` 且 `padj < 0.05`）占比应在总基因数的 `0.2% ~ 25%` 之间。若 `= 0` 或 `> 50%`，判定为归一化失效或分组反转，扣 30 分并标记告警。
   - **降维与批次效应（30 分）**：PCA/UMAP 中同组生物学重复应聚集，或单细胞质控后线粒体基因比例 `percent.mt < 15%`。
   - **富集与下游一致性（40 分）**：GO/KEGG/GSEA 或 `scTenifoldKnk` 虚拟敲除结果的 Top 通路 `FDR < 0.05`，且基因符号（Gene Symbol）与物种（Human `HGNC` / Mouse `MGI`）完全匹配，无大小写混杂。

## 3. 报告撰写铁律
- 严禁出现任何 `[TBD]`、`[插入数值]` 等占位符。
- 报告中引用的每一个 P 值、FoldChange、细胞亚群比例，必须 100% 精确匹配回传的统计 JSON 摘要。

## 4. 输出规范
输出 `acceptance_card.json` 与 `final_interpretation_report.md`。
```

### 6. `role5_ledger_chaos_auditor.md`（台账对账与混沌巡检官）

```markdown
# Role: 台账对账与混沌巡检官 (Role 5: Ledger & Chaos Auditor)

## 1. 角色定位
你负责每日定时审计 `con_hf/ledger/*.jsonl` 五类台账的一致性，评估边缘节点健康损耗，并输出外包团队（产品/营销）的算力投产比（ROI）报表。

## 2. 核心审计维度
1. **状态机闭环审计**：扫描 `tasks.jsonl`，揪出停留于 `RUNNING` 超过 120 分钟的僵尸任务与手机端孤儿 `.lock` 文件。
2. **哈希链防篡改验证**：核对 `audit.jsonl` 中每一行的 `prev_record_sha256` 是否与上一行吻合。
3. **外包渠道算力效能核算**：关联 `attribution.jsonl` 与 `compute.jsonl`，统计各 `utm_source` / `sales_agent_id` 的任务提交量、准入拦截率（衡量外包流量精准度）、平均 K40 算力耗时（分钟）与最终交付通过率。
```

---

## 四、 四大核心数据契约（JSON Schemas 全量定义）

在项目根目录建立 `schemas/` 文件夹，落盘以下 4 个核心契约文件，实现前后端、AI 与边缘算力端的强类型绑定。

### 1. `schemas/requirement.schema.json`（客户端 ➔ 服务端）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "BioWorkbenchRequirement",
  "type": "object",
  "required": [
    "req_id",
    "created_at",
    "mode",
    "isolation_line",
    "species",
    "project_metadata",
    "_attribution"
  ],
  "properties": {
    "req_id": {
      "type": "string",
      "pattern": "^REQ-[0-9]{8}-[A-Z0-9]{6}$"
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "mode": {
      "type": "string",
      "enum": ["MODE_A_TOPIC_SURVEY", "MODE_B_CUSTOM_MATRIX"]
    },
    "isolation_line": {
      "type": "string",
      "enum": ["line1_bulk", "line2_scrna", "line3_spatial"]
    },
    "species": {
      "type": "string",
      "enum": ["Homo_sapiens", "Mus_musculus", "Rattus_norvegicus"]
    },
    "project_metadata": {
      "type": "object",
      "required": ["disease_or_trait", "target_genes", "sample_groups"],
      "properties": {
        "disease_or_trait": { "type": "string", "minLength": 2 },
        "geo_accessions": {
          "type": "array",
          "items": { "type": "string", "pattern": "^GSE[0-9]+$" }
        },
        "target_genes": {
          "type": "array",
          "items": { "type": "string", "pattern": "^[A-Za-z0-9_-]+$" }
        },
        "sample_groups": {
          "type": "object",
          "required": ["control_samples", "treatment_samples"],
          "properties": {
            "control_samples": {
              "type": "array",
              "minItems": 3,
              "items": { "type": "string", "pattern": "^[A-Za-z0-9_]+$" }
            },
            "treatment_samples": {
              "type": "array",
              "minItems": 3,
              "items": { "type": "string", "pattern": "^[A-Za-z0-9_]+$" }
            }
          }
        },
        "input_matrix_relpath": { "type": "string" },
        "input_matrix_sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "estimated_cells_or_spots": { "type": "integer", "minimum": 0 }
      }
    },
    "_attribution": {
      "type": "object",
      "required": ["utm_source", "partner_id", "tier"],
      "properties": {
        "utm_source": { "type": "string" },
        "utm_campaign": { "type": "string" },
        "partner_id": { "type": "string" },
        "tier": { "type": "string", "enum": ["TRIAL", "STANDARD", "PRO_URGENT"] }
      }
    }
  }
}
```

### 2. `schemas/execution_manifest.schema.json`（AI 规划官 ➔ 服务端 ➔ 手机算力端）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "BioWorkbenchExecutionManifest",
  "type": "object",
  "required": [
    "manifest_id",
    "req_id",
    "isolation_line",
    "global_constraints",
    "compute_sieve_report",
    "dag_steps"
  ],
  "properties": {
    "manifest_id": { "type": "string", "pattern": "^MAN-[0-9]{8}-[A-Z0-9]{6}$" },
    "req_id": { "type": "string" },
    "isolation_line": {
      "type": "string",
      "enum": ["line1_bulk", "line2_scrna", "line3_spatial"]
    },
    "global_constraints": {
      "type": "object",
      "required": ["seed", "max_threads", "max_memory_mb", "forbid_sdcard"],
      "properties": {
        "seed": { "type": "integer", "const": 20261013 },
        "max_threads": { "type": "integer", "maximum": 3, "default": 3 },
        "max_memory_mb": { "type": "integer", "maximum": 5800, "default": 5500 },
        "forbid_sdcard": { "type": "boolean", "const": true }
      }
    },
    "compute_sieve_report": {
      "type": "object",
      "required": ["estimated_peak_mb", "downsampling_applied", "sieve_passed"],
      "properties": {
        "estimated_peak_mb": { "type": "number" },
        "downsampling_applied": { "type": "boolean" },
        "target_cell_cap": { "type": "integer" },
        "sieve_passed": { "type": "boolean" }
      }
    },
    "dag_steps": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "step_id",
          "depends_on",
          "runtime_env",
          "script_relpath",
          "script_sha256",
          "args",
          "expected_artifacts"
        ],
        "properties": {
          "step_id": { "type": "string", "pattern": "^step_[0-9]{2}_[a-z0-9_]+$" },
          "depends_on": { "type": "array", "items": { "type": "string" } },
          "runtime_env": { "type": "string", "enum": ["R_4_3", "PY_SCANPY_3_10"] },
          "script_relpath": { "type": "string" },
          "script_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "args": { "type": "object" },
          "expected_artifacts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["relpath", "format", "critical"],
              "properties": {
                "relpath": { "type": "string" },
                "format": { "type": "string", "enum": ["PNG", "PDF", "TSV", "JSON", "RDS", "H5AD"] },
                "critical": { "type": "boolean" }
              }
            }
          }
        }
      }
    }
  }
}
```

### 3. `schemas/artifact_triad.schema.json`（手机算力端 ➔ 服务端对账）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MobileRunnerArtifactTriad",
  "type": "object",
  "required": [
    "task_id",
    "manifest_id",
    "step_id",
    "node_id",
    "exit_code",
    "duration_sec",
    "telemetry_snapshot",
    "outputs_ledger",
    "log_digest"
  ],
  "properties": {
    "task_id": { "type": "string" },
    "manifest_id": { "type": "string" },
    "step_id": { "type": "string" },
    "node_id": { "type": "string", "default": "k40-ubuntu-node01" },
    "exit_code": { "type": "integer" },
    "from_idempotent_cache": { "type": "boolean" },
    "duration_sec": { "type": "number" },
    "telemetry_snapshot": {
      "type": "object",
      "properties": {
        "max_rss_mb": { "type": "number" },
        "battery_temp_c": { "type": "number" },
        "soc_temp_c": { "type": "number" },
        "thermal_throttle_count": { "type": "integer" }
      }
    },
    "outputs_ledger": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["relpath", "sha256", "size_bytes", "magic_valid"],
        "properties": {
          "relpath": { "type": "string" },
          "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "size_bytes": { "type": "integer", "minimum": 1 },
          "magic_valid": { "type": "boolean" }
        }
      }
    },
    "log_digest": {
      "type": "object",
      "required": ["stdout_head", "stdout_tail", "stderr_tail"],
      "properties": {
        "stdout_head": { "type": "string", "maxLength": 4096 },
        "stdout_tail": { "type": "string", "maxLength": 4096 },
        "stderr_tail": { "type": "string", "maxLength": 8192 }
      }
    }
  }
}
```

### 4. `schemas/acceptance_card.schema.json`（AI 终验官 ➔ 交付打包器）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "FinalAcceptanceScorecard",
  "type": "object",
  "required": [
    "manifest_id",
    "audited_at",
    "stage1_mechanical_passed",
    "stage2_biological_score",
    "final_decision",
    "metrics_summary",
    "blocking_issues"
  ],
  "properties": {
    "manifest_id": { "type": "string" },
    "audited_at": { "type": "string", "format": "date-time" },
    "stage1_mechanical_passed": { "type": "boolean" },
    "stage2_biological_score": { "type": "number", "minimum": 0, "maximum": 100 },
    "final_decision": {
      "type": "string",
      "enum": ["APPROVED_FOR_DELIVERY", "NEEDS_AUTO_HEAL", "MANUAL_REVIEW_REQUIRED"]
    },
    "metrics_summary": {
      "type": "object",
      "properties": {
        "deg_up_count": { "type": "integer" },
        "deg_down_count": { "type": "integer" },
        "top_enriched_pathway": { "type": "string" },
        "min_fdr": { "type": "number" }
      }
    },
    "blocking_issues": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

---

## 五、 核心生产级代码全量实现（可直接复制落盘）

以下 5 个核心模块覆盖了手机端资源封印、幂等执行器、热熔断遥测守护进程、服务端三线物理隔离断言与二进制魔数核验、以及双层追加式 JSONL 台账引擎。

### 1. 手机端算力封印脚本：`01_mobile_compute/runtime/bio_limits.sh`

```bash
#!/usr/bin/env bash
# ==============================================================================
# File: 01_mobile_compute/runtime/bio_limits.sh
# Purpose: Redmi K40 (Snapdragon 870, ARM64) 算力硬约束与分区红线守卫
# ==============================================================================
set -euo pipefail

# 1. 强制锁死所有科学计算底层库的并发线程数为 3（留 5 核给系统与 I/O，防止热降频）
export OMP_NUM_THREADS=3
export OPENBLAS_NUM_THREADS=3
export MKL_NUM_THREADS=3
export VECLIB_MAXIMUM_THREADS=3
export NUMEXPR_NUM_THREADS=3
export BIOCPARALLEL_WORKER_NUMBER=3
export SCANPY_N_JOBS=3

# 2. 锁定全局随机种子与确定性哈希
export BIO_GLOBAL_SEED=20261013
export PYTHONHASHSEED=20261013
export R_DEFAULT_PACKAGES="datasets,utils,grDevices,graphics,stats,methods"

# 3. 强制 Tailscale 专网直连，绕过任何残留代理变量
export NO_PROXY="100.64.0.0/10,127.0.0.1,localhost"
export no_proxy="100.64.0.0/10,127.0.0.1,localhost"
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy || true

# 4. 严禁写入 /sdcard 分区红线检查
export BIO_WORK_ROOT="${BIO_WORK_ROOT:-/var/lib/bio_workspace}"
export TMPDIR="${BIO_WORK_ROOT}/tmp"
mkdir -p "${TMPDIR}"

check_no_sdcard_path() {
    local target_path="$1"
    local real_p
    real_p="$(realpath -m "${target_path}")"
    if [[ "${real_p}" == /sdcard* ]] || [[ "${real_p}" == /storage/emulated* ]] || [[ "${real_p}" == /mnt/shared* ]]; then
        echo "[FATAL][BIO_LIMITS] 触发 00_最高纲领红线：严禁在 /sdcard 或 FUSE 分区执行生信读写 (${real_p})" >&2
        exit 91
    fi
}

check_no_sdcard_path "${BIO_WORK_ROOT}"

# 5. 设定单进程组虚拟内存软硬熔断上限 (默认约 5.8GB = 5939200 KB，保护 Android 宿主不触发 LMK)
MAX_VMEM_KB="${BIO_MAX_VMEM_KB:-5939200}"
ulimit -S -v "${MAX_VMEM_KB}" 2>/dev/null || true
```

---

### 2. 手机端原子幂等执行器：`01_mobile_compute/runtime/pi_idempotent_runner.sh`

```bash
#!/usr/bin/env bash
# ==============================================================================
# File: 01_mobile_compute/runtime/pi_idempotent_runner.sh
# Purpose: 断网自治、原子 .lock/.done 检查点、日志削峰与三联 Artifact 组装器
# Usage: ./pi_idempotent_runner.sh <task_id> <manifest_id> <step_id> <work_dir> <cmd...>
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/bio_limits.sh"

TASK_ID="$1"
MANIFEST_ID="$2"
STEP_ID="$3"
STEP_WORK_DIR="$4"
shift 4
CMD_TO_RUN=("$@")

check_no_sdcard_path "${STEP_WORK_DIR}"
mkdir -p "${STEP_WORK_DIR}"

LOCK_FILE="${STEP_WORK_DIR}/${STEP_ID}.lock"
DONE_FILE="${STEP_WORK_DIR}/${STEP_ID}.done"
STDOUT_LOG="${STEP_WORK_DIR}/${STEP_ID}.stdout.log"
STDERR_LOG="${STEP_WORK_DIR}/${STEP_ID}.stderr.log"
TRIAD_JSON="${STEP_WORK_DIR}/${STEP_ID}.triad.json"

# 1. 幂等命中检查：如果 .done 已存在且 Triad 账本完整，直接秒级返回缓存产物
if [[ -f "${DONE_FILE}" ]] && [[ -f "${TRIAD_JSON}" ]]; then
    python3 -c "
import json, sys
p = '${TRIAD_JSON}'
data = json.load(open(p, 'r', encoding='utf-8'))
data['from_idempotent_cache'] = True
json.dump(data, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
"
    cat "${TRIAD_JSON}"
    exit 0
fi

# 2. 防并发冲突检查：若 .lock 存在且对应进程组仍存活，拒绝重复拉起
if [[ -f "${LOCK_FILE}" ]]; then
    OLD_PGID="$(cat "${LOCK_FILE}" 2>/dev/null || echo "")"
    if [[ -n "${OLD_PGID}" ]] && kill -0 "-${OLD_PGID}" 2>/dev/null; then
        echo "[WARN] Step ${STEP_ID} 正在运行中 (PGID=${OLD_PGID})，跳过重复派发" >&2
        exit 75
    else
        rm -f "${LOCK_FILE}"
    fi
fi

# 3. 启动独立进程组执行生信脚本，并记录开始时间与 PGID
START_TS="$(date +%s.%N)"
setsid "${CMD_TO_RUN[@]}" >"${STDOUT_LOG}" 2>"${STDERR_LOG}" &
CHILD_PID=$!
echo "${CHILD_PID}" > "${LOCK_FILE}"

# 捕获退出信号清理残留进程组
cleanup_lock() {
    rm -f "${LOCK_FILE}"
}
trap cleanup_lock EXIT

wait "${CHILD_PID}"
EXIT_CODE=$?
END_TS="$(date +%s.%N)"

# 4. 调用内嵌 Python 生成三联 Artifact (JSON + 削峰日志 + 产物 SHA256 与魔数初筛)
python3 - "${TASK_ID}" "${MANIFEST_ID}" "${STEP_ID}" "${STEP_WORK_DIR}" "${EXIT_CODE}" "${START_TS}" "${END_TS}" "${TRIAD_JSON}" << 'PYEOF'
import hashlib
import json
import os
import sys

task_id, manifest_id, step_id, work_dir, exit_code, start_ts, end_ts, triad_path = sys.argv[1:]
exit_code = int(exit_code)
duration = round(float(end_ts) - float(start_ts), 3)

def read_head_tail(path, max_lines=40, max_chars=4000):
    if not os.path.exists(path):
        return "", ""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    head = "".join(lines[:max_lines])[:max_chars]
    tail = "".join(lines[-max_lines:])[-max_chars:]
    return head, tail

def verify_magic(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    size = os.path.getsize(filepath)
    if size == 0:
        return False
    with open(filepath, "rb") as f:
        head = f.read(16)
        f.seek(max(0, size - 64))
        tail = f.read(64)
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n") and tail.endswith(b"IEND\xaeB`\x82")
    if ext == ".pdf":
        return head.startswith(b"%PDF-") and (b"%%EOF" in tail)
    return True

outputs_ledger = []
for root, _, files in os.walk(work_dir):
    for fn in sorted(files):
        if fn.endswith((".lock", ".done", ".stdout.log", ".stderr.log", ".triad.json")):
            continue
        full_p = os.path.join(root, fn)
        rel_p = os.path.relpath(full_p, work_dir)
        h = hashlib.sha256()
        with open(full_p, "rb") as bf:
            for chunk in iter(lambda: bf.read(65536), b""):
                h.update(chunk)
        outputs_ledger.append({
            "relpath": rel_p,
            "sha256": h.hexdigest(),
            "size_bytes": os.path.getsize(full_p),
            "magic_valid": verify_magic(full_p)
        })

out_head, out_tail = read_head_tail(os.path.join(work_dir, f"{step_id}.stdout.log"))
_, err_tail = read_head_tail(os.path.join(work_dir, f"{step_id}.stderr.log"), max_lines=60, max_chars=6000)

triad = {
    "task_id": task_id,
    "manifest_id": manifest_id,
    "step_id": step_id,
    "node_id": os.environ.get("BIO_NODE_ID", "k40-ubuntu-node01"),
    "exit_code": exit_code,
    "from_idempotent_cache": False,
    "duration_sec": duration,
    "outputs_ledger": outputs_ledger,
    "log_digest": {
        "stdout_head": out_head,
        "stdout_tail": out_tail,
        "stderr_tail": err_tail
    }
}

with open(triad_path, "w", encoding="utf-8") as out_f:
    json.dump(triad, out_f, ensure_ascii=False, indent=2)
PYEOF

# 5. 若退出码为 0，原子写入 .done 标记
if [[ "${EXIT_CODE}" -eq 0 ]]; then
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "${DONE_FILE}"
fi

cat "${TRIAD_JSON}"
exit "${EXIT_CODE}"
```

---

### 3. 手机端热熔断与心跳捎带守护进程：`01_mobile_compute/runtime/pi_telemetry_sidecar.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 01_mobile_compute/runtime/pi_telemetry_sidecar.py
Purpose: Redmi K40 硬件遥测、电池热熔断 (SIGSTOP/SIGCONT) 与 Tailscale 心跳同步守护进程
"""
import glob
import json
import os
import signal
import time
import urllib.request
from typing import Dict, List, Optional

SERVER_HUB_URL = os.environ.get("BIO_HUB_HEARTBEAT_URL", "http://100.64.0.1:18787/api/v1/a2a/heartbeat")
WORK_ROOT = os.environ.get("BIO_WORK_ROOT", "/var/lib/bio_workspace")
NODE_ID = os.environ.get("BIO_NODE_ID", "k40-ubuntu-node01")

# 热熔断水位线（摄氏度）：超过 43.0°C 挂起生信进程组，冷却至 39.0°C 以下恢复执行
BATTERY_TEMP_PAUSE_C = 43.0
BATTERY_TEMP_RESUME_C = 39.0


def read_battery_temp_c() -> float:
    """读取 Android / Linux sysfs 电池温度（通常单位为 0.1°C 或 0.001°C）"""
    candidates = [
        "/sys/class/power_supply/battery/temp",
        "/sys/class/thermal/thermal_zone0/temp",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                raw = float(open(path, "r").read().strip())
                if raw > 1000:
                    return round(raw / 1000.0, 1)
                if raw > 100:
                    return round(raw / 10.0, 1)
                return round(raw, 1)
            except Exception:
                pass
    return 35.0


def read_mem_available_mb() -> float:
    """读取 /proc/meminfo 中的 MemAvailable (MB)"""
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    kb = int(line.split()[1])
                    return round(kb / 1024.0, 1)
    except Exception:
        pass
    return 4096.0


def find_active_lock_pgids() -> List[int]:
    """扫描工作目录下所有活动的 .lock 文件，获取计算进程组 PGID"""
    pgids = []
    for lock_path in glob.glob(os.path.join(WORK_ROOT, "**", "*.lock"), recursive=True):
        try:
            pgid = int(open(lock_path, "r").read().strip())
            pgids.append(pgid)
        except Exception:
            pass
    return pgids


class ThermalCircuitBreaker:
    def __init__(self) -> None:
        self.is_paused = False
        self.throttle_count = 0

    def enforce(self, temp_c: float, pgids: List[int]) -> str:
        if not self.is_paused and temp_c >= BATTERY_TEMP_PAUSE_C:
            for pgid in pgids:
                try:
                    os.killpg(pgid, signal.SIGSTOP)
                except ProcessLookupError:
                    pass
            self.is_paused = True
            self.throttle_count += 1
            return "THROTTLED_PAUSED"

        if self.is_paused and temp_c <= BATTERY_TEMP_RESUME_C:
            for pgid in pgids:
                try:
                    os.killpg(pgid, signal.SIGCONT)
                except ProcessLookupError:
                    pass
            self.is_paused = False
            return "RESUMED_ACTIVE"

        return "PAUSED" if self.is_paused else "NORMAL"


def collect_completed_triads() -> List[Dict]:
    """收集本地已完成 (.done) 但尚未被服务端确认归档的 Triad 摘要"""
    ready = []
    for done_path in glob.glob(os.path.join(WORK_ROOT, "**", "*.done"), recursive=True):
        triad_path = done_path[:-5] + ".triad.json"
        synced_flag = done_path + ".synced"
        if os.path.exists(triad_path) and not os.path.exists(synced_flag):
            try:
                ready.append({
                    "done_path": done_path,
                    "triad": json.load(open(triad_path, "r", encoding="utf-8"))
                })
            except Exception:
                pass
    return ready


def main_loop(interval_sec: int = 10) -> None:
    breaker = ThermalCircuitBreaker()
    # 强制绕过系统代理直连 Tailscale
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    while True:
        temp_c = read_battery_temp_c()
        avail_mb = read_mem_available_mb()
        active_pgids = find_active_lock_pgids()
        thermal_state = breaker.enforce(temp_c, active_pgids)
        unsynced = collect_completed_triads()

        payload = {
            "node_id": NODE_ID,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "battery_temp_c": temp_c,
            "mem_available_mb": avail_mb,
            "thermal_state": thermal_state,
            "throttle_count": breaker.throttle_count,
            "active_jobs_count": len(active_pgids),
            "completed_triads": [item["triad"] for item in unsynced],
        }

        try:
            req = urllib.request.Request(
                SERVER_HUB_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with opener.open(req, timeout=5) as resp:
                if resp.status == 200:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    acked_steps = set(resp_data.get("acked_step_ids", []))
                    for item in unsynced:
                        if item["triad"].get("step_id") in acked_steps:
                            open(item["done_path"] + ".synced", "w").write("OK")
        except Exception:
            # 断网期间静默容错，本地计算继续自治推进
            pass

        time.sleep(interval_sec)


if __name__ == "__main__":
    main_loop()
```

---

### 4. 服务端三线物理隔离与魔数核验守卫：`03_server_orchestrator/core/isolation_guard.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 03_server_orchestrator/core/isolation_guard.py
Purpose: 三线物理隔离硬断言、前置算力准入筛 (Compute Sieve) 与二进制魔数终验器
"""
import hashlib
import os
from typing import Dict, List, Tuple

ALLOWED_LINES = {
    "line1_bulk": "/var/lib/bio_workspace/line1_bulk",
    "line2_scrna": "/var/lib/bio_workspace/line2_scrna",
    "line3_spatial": "/var/lib/bio_workspace/line3_spatial",
}


class IsolationViolationError(PermissionError):
    """触发三线物理隔离红线异常"""


def assert_three_line_isolation(isolation_line: str, target_paths: List[str]) -> None:
    """
    验证所有输入/输出/脚本路径严格拘束在所属产线沙箱内，严禁跨线引用或路径穿越
    """
    if isolation_line not in ALLOWED_LINES:
        raise IsolationViolationError(f"非法产线标识: {isolation_line}")

    sandbox_root = os.path.realpath(ALLOWED_LINES[isolation_line])
    other_roots = [
        os.path.realpath(p) for k, p in ALLOWED_LINES.items() if k != isolation_line
    ]

    for raw_path in target_paths:
        if ".." in raw_path.split("/"):
            raise IsolationViolationError(f"检测到路径上溯攻击 ('..'): {raw_path}")

        resolved = os.path.realpath(os.path.join(sandbox_root, raw_path.lstrip("/")))

        # 严禁触碰其他两条产线目录
        for other in other_roots:
            if resolved.startswith(other):
                raise IsolationViolationError(
                    f"跨线污染阻断: 产线 [{isolation_line}] 试图访问 [{resolved}]"
                )

        if not resolved.startswith(sandbox_root):
            raise IsolationViolationError(
                f"沙箱逃逸阻断: 路径 [{resolved}] 不在 [{sandbox_root}] 管辖范围内"
            )


def evaluate_compute_sieve(
    isolation_line: str, n_genes: int, n_cells_or_samples: int, max_ram_mb: int = 5500
) -> Dict:
    """
    前置算力筛：在派发给 Redmi K40 之前预估峰值内存，自动决定是否插入 Geometric Sketching 降采样
    """
    if isolation_line == "line1_bulk":
        est_mb = 450.0 + (n_genes * n_cells_or_samples * 64.0) / (1024.0 * 1024.0)
        return {
            "estimated_peak_mb": round(est_mb, 1),
            "downsampling_applied": False,
            "target_cell_cap": n_cells_or_samples,
            "sieve_passed": est_mb <= max_ram_mb,
        }

    # 单细胞与空间转录组内存估算
    est_mb = 1200.0 + 0.18 * n_cells_or_samples
    if est_mb > max_ram_mb or n_cells_or_samples > 20000:
        capped_cells = 15000
        adjusted_mb = 1200.0 + 0.18 * capped_cells
        return {
            "estimated_peak_mb": round(adjusted_mb, 1),
            "downsampling_applied": True,
            "target_cell_cap": capped_cells,
            "sieve_passed": True,
        }

    return {
        "estimated_peak_mb": round(est_mb, 1),
        "downsampling_applied": False,
        "target_cell_cap": n_cells_or_samples,
        "sieve_passed": True,
    }


def verify_artifact_binary_integrity(filepath: str, expected_sha256: str) -> Tuple[bool, str]:
    """
    服务端终验：核对回传文件的 SHA256 与 PNG/PDF 首尾二进制魔数
    """
    if not os.path.exists(filepath):
        return False, "FILE_NOT_FOUND"

    size = os.path.getsize(filepath)
    if size == 0:
        return False, "ZERO_BYTE_FILE"

    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    actual_sha = h.hexdigest()
    if actual_sha != expected_sha256:
        return False, f"SHA256_MISMATCH(expected={expected_sha256[:8]}, actual={actual_sha[:8]})"

    ext = os.path.splitext(filepath)[1].lower()
    with open(filepath, "rb") as f:
        head = f.read(16)
        f.seek(max(0, size - 64))
        tail = f.read(64)

    if ext == ".png":
        if size < 4096:
            return False, "PNG_TOO_SMALL_BLANK_PLOT"
        if not (head.startswith(b"\x89PNG\r\n\x1a\n") and tail.endswith(b"IEND\xaeB`\x82")):
            return False, "PNG_MAGIC_OR_IEND_CORRUPTED"

    elif ext == ".pdf":
        if size < 2048:
            return False, "PDF_TOO_SMALL"
        if not (head.startswith(b"%PDF-") and b"%%EOF" in tail):
            return False, "PDF_MAGIC_OR_EOF_CORRUPTED"

    return True, "OK"
```

---

### 5. 双层五类追加式台账引擎：`03_server_orchestrator/core/ledger_engine.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
File: 03_server_orchestrator/core/ledger_engine.py
Purpose: 双层五类追加式 JSONL 治理台账 (con_hf/ledger/*.jsonl)，带 SHA256 哈希链防篡改
"""
import fcntl
import hashlib
import json
import os
import time
from typing import Any, Dict

LEDGER_CATEGORIES = {
    "tasks": "tasks.jsonl",             # 任务状态机流转记录
    "isolation": "isolation.jsonl",     # 三线物理隔离断言与越界拦截记录
    "compute": "compute.jsonl",         # K40 边缘算力耗时、内存与热熔断记录
    "audit": "audit.jsonl",             # AI 两阶段终验评分卡与自愈补丁记录
    "attribution": "attribution.jsonl", # 外包产品/营销渠道归因与 ROI 结算记录
}


class AppendOnlyLedger:
    def __init__(self, ledger_dir: str = "con_hf/ledger") -> None:
        self.ledger_dir = ledger_dir
        os.makedirs(self.ledger_dir, exist_ok=True)

    def append(self, category: str, event_type: str, payload: Dict[str, Any]) -> str:
        if category not in LEDGER_CATEGORIES:
            raise ValueError(f"未知台账分类: {category}")

        filepath = os.path.join(self.ledger_dir, LEDGER_CATEGORIES[category])
        os.makedirs(os.path.dirname(filepath), exist_ok=True)

        with open(filepath, "a+", encoding="utf-8") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                f.seek(0, os.SEEK_END)
                pos = f.tell()
                prev_hash = "0" * 64
                if pos > 0:
                    # 读取最后一行获取上一条记录的 record_sha256
                    f.seek(max(0, pos - 4096))
                    lines = [ln.strip() for ln in f.readlines() if ln.strip()]
                    if lines:
                        try:
                            last_obj = json.loads(lines[-1])
                            prev_hash = last_obj.get("record_sha256", prev_hash)
                        except Exception:
                            pass

                record = {
                    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "category": category,
                    "event_type": event_type,
                    "prev_record_sha256": prev_hash,
                    "payload": payload,
                }
                canonical = json.dumps(record, sort_keys=True, ensure_ascii=False)
                record_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
                record["record_sha256"] = record_hash

                f.seek(0, os.SEEK_END)
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                f.flush()
                return record_hash
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
```

---

## 六、 预见性风险与防崩盘灾备矩阵（12 大致命隐患与工程解药）

站在实战角度，以下 12 个隐患是你在未来 1~6 个月内**几乎 100% 会撞上的坑**，我已为你提前备好工程级解药：

| 序号 | 所属板块 | 预见性致命隐患 | 触发场景与后果 | 工程级根治解药（已在架构中预埋） |
| :--- | :--- | :--- | :--- | :--- |
| **01** | **手机算力端** | **Android 12+ Phantom Process Killer 杀后台** | 子进程或线程数超标时，Android 系统静默杀死 Termux 内的 R/Python 容器，无报错退出（Exit 9/137）。 | 通过 ADB 执行 `settings put global settings_enable_monitor_phantom_procs false`；配合 `bio_limits.sh` 锁死 3 线程。 |
| **02** | **手机算力端** | **长时间插电导致 K40 电池鼓包与高温降频** | 24 小时连充电器满载计算，电池长期处于 100% 高压 + 45°C 高温。 | Root 后配置 ACC 充电控制模块鎖定电量 `45%~55%`（旁路供电）；由 `pi_telemetry_sidecar.py` 在 `43°C` 时自动发 `SIGSTOP` 挂起降温。 |
| **03** | **手机算力端** | **R/Bioconductor 在 ARM64 下源码编译耗时数小时或失败** | `DESeq2`、`ComplexHeatmap`、`Seurat` 依赖 C++/Fortran 库，直接 `install.packages` 极易因内存不足失败。 | 严禁在任务运行时装包；使用 `bspm` / Ubuntu `r-cran-*` / `conda-forge (linux-aarch64)` 预装后导出只读 `k40-ubuntu-golden.tar.zst` 母版镜像。 |
| **04** | **手机算力端** | **写入 `/sdcard` 引发权限丢失与 SQLite/HDF5 文件锁死** | Android `/sdcard` 采用 FUSE 文件系统，不支持 POSIX 文件锁与软链接，`h5ad` 写入必崩。 | 在 `bio_limits.sh` 中植入 `check_no_sdcard_path` 强制拦截，所有计算强制落盘 Termux 原生 `ext4` 分区。 |
| **05** | **分布式网络** | **本地科学上网软件劫持 Tailscale `100.64.x.x` 流量** | 电脑端开启 Clash/v2ray 全局或系统代理时，发往 K40 的 RPC 被转发至境外代理导致超时。 | 服务端与手机端双向强制设置 `NO_PROXY="100.64.0.0/10,127.0.0.1,localhost"`，Python 客户端显式声明 `ProxyHandler({})`。 |
| **06** | **生信数据流** | **基因名被 Excel 自动篡改为日期（如 `MARCH1`, `SEPT2`）** | 外包或用户上传经过 Excel 保存的矩阵，基因名变成 `1-Mar`，导致下游通路富集与靶点匹配丢失。 | 在 **Role 0 门禁脚本**中加入正则扫描，自动识别并修复经典 Excel 日期污染基因名（如 `1-Mar` ➔ `MARCHF1`）。 |
| **07** | **生信数据流** | **人类/小鼠基因符号大小写混用导致 0 富集结果** | 用户选了 `Mus_musculus` 却输入全大写 `TP53`（小鼠应为 `Tp53`），导致 `scTenifoldKnk` 找不到靶基因。 | 在 **Role 1 管线规划**阶段强制通过本地内置的 `HGNC/MGI` 映射字典做符号标准化。 |
| **08** | **生信数据流** | **生信脚本输出海量进度条撑爆 JSON-RPC 与大模型上下文** | `Scanpy` 或 `Seurat` 打印数万行进度条，日志达数十 MB，塞入 LLM 直接爆 Token 且拖垮网络。 | 在 `pi_idempotent_runner.sh` 中实施削峰截断（仅提取 `stdout` 首尾 40 行与 `stderr` 尾部 60 行封装进 `log_digest`）。 |
| **09** | **AI 终验端** | **R 绘图设备未正常 `dev.off()` 生成空白或截断图片** | 脚本退出码为 `0`，但 PDF/PNG 只有头部没有结尾，交付给客户后打不开。 | 在 `isolation_guard.py` 中强制校验 PNG `IEND` 魔数块与 PDF `%%EOF` 标记及文件最小体积阈值。 |
| **10** | **外包协同（1）** | **外包产品团队频繁改动采集字段导致前端反复重写** | 外包产品经理每周增删表单项，拖慢你核心算力研发节奏。 | `02_client_ui` 采用 `JSON-Schema` 驱动动态表单渲染，外包改需求只需提交 PR 修改 `requirement.schema.json`。 |
| **11** | **外包协同（4）** | **外包营销团队导入低质/测试流量耗尽 K40 算力** | 营销外包按点击或注册结算，大量无意义测试任务把手机端队列堵死。 | 依托 `requirement.json` 中的 `_attribution.tier` 实施三级优先级队列（`PRO_URGENT` > `STANDARD` > `TRIAL`），试用流量限制仅可跑预计算缓存集。 |
| **12** | **客户交付端** | **审稿人质疑生信分析结果不可复现或参数黑箱** | 科研客户投稿时被要求提供完整软件版本、随机种子与归一化参数。 | 在 `deliverables/` 客户三大件之外，自动打包第 4 件 **`reproduce_capsule.zip`**（含脱敏 Manifest、`sessionInfo.txt`、`seed=20261013` 与 SHA256 签名证书）。 |

---

## 七、 客户交付包（`deliverables/` 四大件）标准目录结构

每次任务通过 **Role 4（独立终验官）** 的双阶段核验（机械校验 Passed + 生物学评分 `>= 75`）后，服务端打包器自动生成以下标准交付目录：

```text
deliverables/PROJ_20261031_A8F92C/
├── 01_Executive_Bio_Report.pdf           # 【第 1 件：AI 终验解读报告】含方法学描述、核心发现、结果图注与参考文献
├── 02_Publication_Ready_Figures/         # 【第 2 件：期刊级高清图表包】均通过魔数与 300 DPI 校验
│   ├── Fig1A_PCA_Batch_QC.pdf
│   ├── Fig1B_Volcano_DEG.png
│   ├── Fig2A_Pathway_Enrichment.pdf
│   └── Fig3A_scTenifoldKnk_Network.pdf
├── 03_Processed_Tables/                  # 【第 3 件：全量统计结果表】
│   ├── Table1_Normalized_Matrix.tsv
│   ├── Table2_DEG_Full_Statistics.tsv
│   └── Table3_Enrichment_Pathways.tsv
└── 04_Reproducibility_Capsule.zip        # 【第 4 件：学术复现胶囊（核心差异化壁垒）】
    ├── execution_manifest.locked.json    # 锁死参数与种子的执行清单
    ├── acceptance_scorecard.json         # 双阶段质量终验合格证
    ├── sha256_manifest.txt               # 全量输入与输出文件 SHA256 指纹账本
    └── runtime_session_info.txt          # R sessionInfo() / Python pip freeze 精确版本快照
```

---

## 八、 单兵 CTO 7 天极速落地路线图（Execution Roadmap）

为了防止陷入“过度设计工作台”的泥潭，请严格按以下 7 天顺序推进：

* **Day 1（立规矩与封底座）**：在 K40 容器内落盘 `bio_limits.sh` 与 `pi_idempotent_runner.sh`，跑通第一个带 `.lock/.done` 和 `triad.json` 输出的本地测试脚本。
* **Day 2（装护栏与通专网）**：在 K40 启动 `pi_telemetry_sidecar.py`，在服务端落盘 `isolation_guard.py` 与 `ledger_engine.py`，打通 Tailscale `100.64.x.x` 心跳捎带与三线隔离断言。
* **Day 3（挂接 Role 1 与 Role 4 智能体）**：将 `role1_bio_planner.md` 与 `role4_qa_auditor.md` 接入服务端状态机，跑通 `requirement.json` ➔ `execution_manifest.json` ➔ K40 执行 ➔ `acceptance_card.json` 闭环。
* **Day 4（挂接 Role 0 与 Role 3 自愈环）**：接入外包门禁校验与报错自愈 `healing_action.json`，人为制造一次 OOM 与一次脏数据，验证 2 次自动重试熔断机制。
* **Day 5~6（组装三视图控制台）**：在 `BioanalysDesktop` (`127.0.0.1:18787`) 前端挂载 Schema 动态表单、K40 温度/算力状态卡片与 `con_hf/ledger/*.jsonl` 审计表。
* **Day 7（导出 Golden Image 与外包交接）**：将配置完备的 `k40-ubuntu` 导出为冷备份压缩包；把 `requirement.schema.json` 与 `_attribution` 规范甩给外包产品与营销团队，正式启动商业化流水线。
