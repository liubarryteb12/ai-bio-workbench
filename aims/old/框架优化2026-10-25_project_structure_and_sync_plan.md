# 工作台整体方案：项目自包含结构、sync 数据流、图级模板库（v1.0）

> 2026-10-25 立项。本文是**一整套系列方案的总纲**，合并三块内容：
> ① 项目自包含结构与台账体系；② sync 数据流；③ 图级模板库与出图预览。
> 用户裁定：三者合并为一整套，因为模板库要落在项目结构上、出图结果要经 sync 推送，
> 拆成三份会互相引用却不同步更新。
> 上位约束：`AGENTS.md` 双平面铁律、`docs/isolation.md` 三线隔离、`docs/directories.md` 文件落点。
> 隔离红线优先于本文任何条目。
>
> 三块的前身文档：`con_hf/2026-10-25_project_structure_and_sync_plan.md` 只含①②，
> 本文是它的超集，实现时以本文为准。

## 第一部分 · 项目自包含结构

### 1.1 问题与目标

现状一个项目的东西散在四处：数据在 `outputs/<项目>/`、台账在 `con_hf/` 与
`outputs/system_logs/`、交付在 `deliverables/`、调试在 `cn_debug/`。
找一个项目的信息要记四个位置，跨会话接手成本高。

目标：一个项目一个根目录，数据、产物、交付、调试、台账、交接全部收在里面，
通过索引对外暴露。全局共享件（母版、ops、规范、图模板池）留在原地，不搬进项目，
避免每项目一份拷贝导致漂移。

### 1.2 目录结构

```
<工作区根>/
├── local_projects/                  # 本地项目根，与远端 /mnt/ssd/bio_data/projects/ 语义区分
│   └── <项目A>/
│       ├── project.json             # 机器读硬字段：id、名称、分析线、创建时间
│       ├── handoff.md               # 项目级交接：项目是什么、跑到哪一步、哪些步骤有坑、下一步
│       ├── README.md                # 人读索引：台账入口、产物入口、交付入口
│       ├── INDEX.json               # 机读索引：路径映射与产物计数，脚手架生成，禁止手改
│       ├── data/                    # 从 算力节点 回搬的结构化产物
│       │   └── <line>/{processed,results}
│       ├── deliverables/            # 客户交付包
│       ├── debug/                   # 本项目调试脚本与日志
│       ├── figures/                 # 本项目产出的图件，算力节点 回搬的真实结果（原 outputs/figures/ 迁入）
│       └── ledger/                  # 项目级五种台账，JSONL 追加式
│           ├── actions.jsonl        # kind: run | edit | init，做了就是做了，不设 status
│           ├── changes.jsonl        # 修改记录
│           ├── errors.jsonl         # 失败记录，status 可为 open
│           ├── fixes.jsonl          # 修复记录
│           └── pitfalls.jsonl       # 踩坑记录
│
├── con_hf/                          # 全局侧，与项目级同构
│   ├── handoff.md                   # 全局交接
│   ├── ledger/                      # 全局五种台账
│   │   ├── actions.jsonl
│   │   ├── changes.jsonl
│   │   ├── errors.jsonl
│   │   ├── fixes.jsonl
│   │   └── pitfalls.jsonl           # 现有 pitfalls_ledger.md 迁入，P-XX 编号不动
│   ├── SPEC_DECISIONS.md            # 决策记录，D-XX 编号不动
│   ├── GLOSSARY.md
│   ├── SPEC.md
│   └── CONTEXT.md
│
├── local_projects/INDEX.md          # 全局检索入口，脚手架扫各项目 INDEX.json 汇总
│
├── con_hf/sync/                     # sync 运行态，directories.md 将新增条款合法化
│   ├── inbox/                       # 待处理 ticket 的 spool
│   ├── outbox/                      # 待推送结果
│   └── daemon.log                   # 守护进程自身日志
│
└── ops/ src/ BioanalysDesktop/ portal/ docs/    # 全局件，原位不动
```

本地 `projects/` 若已存在，整体改名 `local_projects/`，现有内容规整进去，不另起新根。

### 1.3 记录双层判据

**判据：换个项目还成立不成立。** 成立，上全局；只对本项目成立，留项目级。

| 记录 | 归属 |
|---|---|
| line2 步骤 7 两次 exit 1，根因 seed 未注入 | 项目 A `errors.jsonl` + `fixes.jsonl` |
| runner 高频 ssh 轮询触发 容器 abort，轮询改 60 秒 | 全局 `pitfalls.jsonl` |
| GEO FTP 返回 990 字节 XML，NCBI 侧行为未定位 | 全局 `pitfalls.jsonl` |
| 客户 X 的 GSE252465 少一组样本 | 项目 A `errors.jsonl` |
| 把 outputs/ 迁到 local_projects/ | 全局 `changes.jsonl` |
| 把 ledger 格式改成 JSONL | 全局 `changes.jsonl` |

**防重复纪律**：项目级遇跨项目结论只记 `{"title":"见 P-29","refs":["P-29"]}`，正文在全局；
全局不写"某项目某步骤失败三次"这种细节，只提炼可复用结论。

### 1.4 JSONL 记录 schema

```json
{
  "id": "P-29 或自增 ID",
  "ts": "2026-10-25T10:30:00+08:00",
  "type": "action | change | error | fix | pitfall",
  "kind": "run | edit | init（仅 action 用）",
  "project": "PRJ_xxx 或 null，null 表示全局",
  "line": "line1_bulk 或 null",
  "step": "geo_pca_scatter 或 null",
  "title": "一句话标题",
  "detail": "现象、根因、处置",
  "evidence": ["路径、命令或 ticket"],
  "status": "open | resolved | wontfix，error 与 fix 用；action 与 change 不设",
  "refs": ["关联记录 ID"]
}
```

三条语义约定：

1. **JSONL 只能追加**。改状态是追加同 `id` 新行，读时取最后一条。渲染脚本负责按 id 聚合。
2. **历史编号不动**。`P-XX`、`D-XX` 原样作 `id`，转 JSONL 只是换载体，现有引用不断。
3. **errors 与 fixes 不合并**（用户裁定）。一次修复常对应多个错误，靠 `refs` 关联，
   渲染脚本聚合时按 refs 串成一条 issue 视图。

### 1.5 需求到项目的衔接

用户提交需求生成项目 A 时：

1. 需求单内容作为第一条 `action` 落进 `local_projects/A/ledger/actions.jsonl`，
   `kind: init`，`refs` 指向需求 ticket。
2. `project.json` 只自动带 `ticket_id` 与 `created_at`，疾病名等由 agent 首次接手确认后回填，
   并补一条 action 记录。不做不可靠的自动提取。

### 1.6 system_logs 保持独立（用户裁定）

`outputs/system_logs/` 的单文件 JSON 台账（task_id、exit_code、io_files，机器生成字段固定）
与 `ledger/` JSONL（人写，schema 灵活）不是一回事，不互转不合并。
项目级 `INDEX.json` 同时索引两份路径，检索时分开查。

## 第二部分 · sync 数据流

### 2.1 角色与流向

| 角色 | 允许 | 禁止 |
|---|---|---|
| 客户端 | 往门户发文件与表单，发起结果同步请求，查看编排面推来的预览图与结果 | 拉取服务端任何内部状态 |
| 门户 | 收客户输入，落盘标记状态，展示编排面推来的结果 | 主动连接 workbench，读其内部 |
| 编排面（8787） | 出站拉门户 inbox，经 SSH 派 算力节点，拉回产物，推结果回门户 | 开公网入站，自己跑计算 |
| 算力面（算力节点） | 执行计算 | 对外 |

三条流向，方向单一：客户到门户（唯一入口）、编排面到门户 inbox（拉待办，出站）、
编排面到门户（推结果，出站）。门户从不主动连 workbench。

### 2.2 网络配置（写死，照抄 AGENTS.md §1.2 会错）

同机通信全走 `127.0.0.1`，显式设 `NO_PROXY=127.0.0.1,localhost`，**不注入 `127.0.0.1:7890`**。
§1.2 的代理规定针对外网出口，同机环回属豁免范围。若照该节写"出站前注入代理"，
守护进程第一趟就会因代理连不上本机门户。

### 2.3 门户侧改动

inbox JSON 加 `sync_status`，取值 `pending` → `running` → `done` / `failed` / `blocked`，
异常回 `pending`。历史单子无此字段判 `legacy`，守护进程跳过不拉。

六个接口：

| 接口 | 鉴权 | 作用 |
|---|---|---|
| `GET /api/sync/pending` | SYNC_TOKEN | 编排面拉待办，urgent 排前 |
| `POST /api/sync/claim` | SYNC_TOKEN | 标记 running，返回下载地址与 sha256，幂等 |
| `GET /api/sync/package?ticket=` | SYNC_TOKEN | 流式返回 tar.gz |
| `POST /api/sync/result` | SYNC_TOKEN | 终态结算，带 manifest 与文件 |
| `POST /api/sync/trigger` | 客户 | 打 urgent 标记，限流 |
| `GET /api/sync/status?ticket=` | 客户 | 查状态与结果清单 |

限流：同一 `ticket_id` 60 秒内只响应一次，命中返回 `{ok:false, retry_after:N}` 与"稍后重试"。
内存 Map 实现，门户重启丢状态最坏多放行一次，无害。

token 两套：`SYNC_TOKEN` 给编排面，客户登录 token 另一套，均环境变量注入，不硬编码。

### 2.4 编排面守护进程

`ops/sync_daemon.ps1`，薄编排器：窄接口只做拉待办与推结果，深处全部复用第四节现成件，
不重写任何一段传输或打包。`SYNC_BATCH=1` 默认串行，队列结构支持后续扩展并行度。

单票流程：claim → 下载到 spool 并验 sha256 → 防 slip 解包 → 导入建项 → 派发 算力节点 →
拉回产物 → 打交付包 → 推结果。任一步失败重试三次退避，仍失败推 `failed` 并附错误详情。

**闸不过的出口**：交付四道闸拦下时推 `blocked`，客户侧文案"待人工确认，详见对接人"，
不停在 `running` 假装在跑。人工确认后由对接人触发重推。

**守护进程自身行动**记全局 `con_hf/ledger/actions.jsonl`，不直接写项目 ledger；
项目内事实由导入建项后的工作流写。

**探活**：并入 `ops/serve_guard.ps1` 的 30 秒周期多探一个进程在不在，不新起第三个守护。

### 2.5 长任务队列行为（照 P-26 P-27 P-29 写死）

- **P-26**：本机进程树承载远端长任务必死。派发用远端 `setsid nohup` 脱离本机进程树，
  守护进程不跨 ssh 等待。
- **P-27**：固定时长等待对重步骤必然假失败。台账等待分档，`l2_tf_scenic` 与
  `l2_ko_scrna` 按 40 分钟档，其余按分钟档。
- **P-29**：禁止并发 ssh 到 k40-ubuntu，轮询不小于 60 秒，重试不超过两次，
  下发长任务前确认容器安静，容器内禁 `find` / `ps` / `grep -r`。

## 第三部分 · 图级模板库与出图预览

### 3.0 两类图必须分开，责任不能混

工作区里存在两种性质完全不同的图，混在一起会导致客户把示例图当成自己的结果：

| | 预览图（内置示例） | 产出图（真实结果） |
|---|---|---|
| 来源 | 预先准备好的示例代码跑出，不依赖任何项目数据 | 算力节点 按本项目真实数据跑出 |
| 位置 | `reference/05.可参考出图代码/**/_verified.png` | `local_projects/<项目>/figures/<line>/` |
| 谁生成 | 采集时一次性生成，版本化随模板走 | 每次跑分析生成，跟着项目走 |
| 客户何时见 | 选图型时，勾选之前 | 分析跑完，sync 推送之后 |
| 能否代表客户结果 | 不能 | 能 |
| 归属 | 全局素材池，所有项目共用 | 单一项目，跟项目一起迁一起交付 |

原 `outputs/figures/` 属于第二类，已核实为 108 个母版步骤编号的真实结果图
（`l1_01_correlation.png`、`l2_scenic_01_regulon_heatmap.png`、`l3_mouse_01_domains_*.png` 等），
带一个 `index.html` 浏览页。它整体迁入 `local_projects/<项目>/figures/`，不是预览素材。

**门户展示纪律**：预览图与真实结果在界面上分区展示并标注来源，
预览图一律带示例标识，真实结果带项目名与生成时间。两者不混排，避免误导。
### 3.1 现状盘点（已核实，不是估计）

`reference/05.可参考出图代码/` 已有一套完整的高级出图代码池：

- **82 个图型**有机读索引 `_meta/bizard_index.csv`，字段含级别、图型标题、分类、
  英文名、语言、R/Python 代码块数、依赖包、本库状态、本库位置。
- **17 个图型已在 算力节点 验证**，有 `_verified.png` 与 `_verified.pdf` 双产物，
  覆盖 L1 到 L3 三层：箱线、密度、直方、小提琴、散点、分组柱状、热图、PCA、UMAP、
  火山图、KEGG 通路图、桑基图、多面板组合图、单细胞点图、单细胞 UMAP。
- **65 个图型待采集**，索引里标 `待采集`，依赖包清单已列明。
- 文件角色照 FigureYa 六件套组织：代码、README、`input_data.csv`、
  `install_dependencies.txt`、verified PNG、verified PDF。
- 采集路线记在 `_meta/采集路线.md`：Plottie 定视觉目标、Bizard 拿代码、
  FigureYa 定目录契约、算力节点 真跑留证据、交付前对 Nature Figure Guide。

### 3.2 关键断层：代码池与生产链路是两张皮

这批代码目前**没有任何机制**把它变成"某个项目可用的模板"：

| | `reference/05.` | 生产母版 |
|---|---|---|
| 位置 | reference 下，只读参考 | `src/<line>/scripts/` |
| 角色 | 模板候选池 | 实际跑的步骤 |
| 关联 | 无机械关联 | 由 `src/workflows.json` 驱动 |
| 出图规范 | 各自为政 | `docs/figure_spec.md` 加 layout 模板统一管 |

后果：客户在门户选了"我要桑基图"，服务台没有对应物可派。缺的是**图级模板注册**这一层。

### 3.3 注册表设计

新增 `src/figure_templates.json`，与 `src/workflows.json` 并列，同一套纪律
（单一事实源、改名同步防漂移断言、双端同语义）。

单条模板记录：


三个字段是本方案的核心：

- **preview**：指向 verified PNG。客户端出图预览直接用这批现成图，
  不需要渲染、不需要跑数据。客户选之前一眼看到图的形态、风格、复杂程度。
- **adapt_vars**：模板自己声明"哪些可变"。agent 或服务台只在这些变量里改，
  不自由发挥。边界不收窄，适配就变成每次重新写代码，母版不变的保护就没了。
- **linked_mods**：挂到既有 mod 上，复用现有派发链路，不新开一套执行机制。

```json
{
  "id": "fig_l2_volcano",
  "name": "火山图",
  "level": "L2",
  "category": "Correlation",
  "language": "r",
  "lines": ["line1_bulk", "line2_scrna"],
  "source": "reference/05.可参考出图代码/L2_组学常用图/L2_volcano_code.R",
  "source_sha256": "<母版 sha256，改母版必须同批更新>",
  "preview": "reference/05.可参考出图代码/L2_组学常用图/L2_volcano_verified.png",
  "preview_sha256": "<预览图 sha256，与磁盘文件不符时门户提示不同步>",
  "verified": true,
  "deps": ["ggplot2", "ggrepel"],
  "deps_status": "ready",
  "produces": ["volcano.png", "volcano.pdf"],
  "adapt_vars": {
    "input_matrix": "表达矩阵 TSV，基因行为索引",
    "group_col": "分组列名",
    "label_genes": "要高亮的基因清单，可为空"
  },
  "linked_mods": ["l1_deg_limma", "l1_enrich_figures"],
  "deprecated": false
}
```

`deps_status` 与两个 sha256 由验证脚本写，禁止手改，理由见 3.3.1 与 3.3.4。
### 3.3.1 依赖状态从哪来（客户端置灰的依据）

客户端要置灰"环境未就绪"的图型，前提是有一个字段说明依赖装没装。这个字段不能手填，
手填必漂移。唯一可靠来源是算力面的实际环境，采集时机与 R 4.5.3 验证（3.7 节）绑定：

- 3.7 节验证时，对每个图型跑一次依赖探测，结果写回注册表的 `deps_status`。
- `deps_status` 取值：`ready`（依赖齐备）、`partial`（部分缺失，附缺失清单）、
  `blocked_r453`（新版本下跑不通，附失败原因）。
- 客户端只渲染 `ready` 的图型为可选，其余置灰并显示原因。
- 注册表的 `verified` 与 `deps_status` 由验证脚本写，禁止手改，与 `INDEX.json` 同属生成物。

这条补上，客户端置灰才有依据，否则又是一个会过期的静态缓存。
### 3.3.2 适配副本的落点与对账

模板出图不是改母版，是在项目内生成派生副本。这条纪律与 `docs/directories.md`
已有的"项目内适配副本"约定同源：母版 `reference/05.` 只读不改，副本落项目内。

```
reference/05.可参考出图代码/L2_组学常用图/L2_volcano_code.R      # 母版，只读
      ↓ 按 adapt_vars 改写
local_projects/<项目>/figures/adapt/l2_volcano.R                 # 派生副本
      ↓ 在 算力节点 跑
local_projects/<项目>/figures/<line>/l2_volcano.png              # 真实结果
```

三条纪律：

1. **副本留档**。改写后的副本落 `figures/adapt/`，交付时随 `01_Adapted_Code/` 一起给客户，
   客户能看出"我们在他选的图型上改了什么"。这与 `build_client_report.py` 的既有收集规则对齐。
2. **母版零改动**。适配只发生在副本上。母版被改过一次，后续所有项目都拿到被污染的基线。
3. **副本与母版可对账**。副本头部记母版路径与 sha256，跑完在 `_report.txt` 里写明改了哪些
   变量、哪些没动。审计时能还原"这个项目的图型和全局模板差在哪"。
### 3.3.3 三线隔离在图模板层的落实

图型天然可能跨线：火山图 line1 能出（bulk 差异），line2 也能出（伪 bulk 差异）。
这不违反隔离红线，因为隔离约束的是**数据**不是图型。但必须说清判据，否则会被滥用成
"反正图型通用，数据也通用吧"。

**判据：图型可跨线共享，数据与适配变量绝不跨线。**

| 可跨线 | 绝不跨线 |
|---|---|
| 图型定义（画法、风格、依赖） | 表达矩阵、分组表、临床协变量 |
| `adapt_vars` 的字段声明 | 某个项目填进 `adapt_vars` 的具体值 |
| preview 示例图 | 另一个项目的出图结果 |

落到校验上，`server/figure_graph.js` 要比 `workflow_graph.js` 多查两项：

1. **线匹配**：模板的 `linked_mods` 若指定了线，客户跨线选要拒。未指定线的图型
   （如纯统计图）允许三线都选，但 `adapt_vars` 填的值必须来自本项目本线。
2. **来源可溯**：resolve 出的执行计划要带 `source` 模板 id 与母版路径，
   台账记双列（图型 id + 母版名），与 mod 化改造时的 `step_name` + `mod_id` 双列同构。

这条补上，图模板层才真正继承了三线隔离，而不是口头继承。
### 3.3.4 预览图的版本一致性

母版代码改了，`_verified.png` 不重跑，客户看到的预览就是过期图，选了之后跑出来的图和预览不像。
这是预览机制最现实的失效方式，比"没图"更糟：没图客户知道没有，过期图客户以为有。

三条纪律：

1. **母版与预览同批**。改母版代码必须同批重跑 verified 图，两个一起提交。
   照 `tests/master_conventions.test.js` 的做法，这条要落成确定性断言：
   母版 sha256 与 preview 的记录时间戳不匹配即报红。
2. **注册表记 preview 指纹**。`preview` 字段除路径外，加 `preview_sha256`。
   门户加载时若指纹与磁盘文件不符，显示"预览图与模板不同步"而不是显示旧图。
3. **改母版前先看影响面**。母版被 N 个项目引用时，改一次全部项目的预览都动。
   改之前先查 `figure_templates.json` 里有多少条记录指向它，影响面大于 3 时
   另存新图型而不是改老的，老图型标 deprecated 不删。
### 3.4 三层如何协作

```
reference/05.（素材池，只读，不部署）
      ↓ 注册
src/figure_templates.json（图级模板注册表，单一事实源）
      ↓ 消费
portal 出图选择器（客户勾选，preview 用 verified PNG）
      ↓ 提交
8787 resolve（按 linked_mods 与 adapt_vars 生成执行计划）
      ↓ 派发
算力节点 跑适配后的副本，产物落 local_projects/<项目>/figures/
      ↓ 推结果
sync 把图与报告推回门户，客户刷新可见
```

适配副本的落点与 `docs/directories.md` 已有的"项目内适配副本"约定一致：
`local_projects/<项目>/figures/`，母版不动，改的是派生副本。

### 3.5 客户端出图选择器

挂在门户，与现有 mod 勾选并列。交互要点：

- 按 L1/L2/L3 分级加分类（Correlation、Distribution 等）组织，客户按图型浏览。
- 每个图型卡片显示 preview 缩略图、名称、语言标识、依赖状态。
- 选中后展示 `adapt_vars` 表单，让客户填分组列、要高亮的基因等。
- 依赖未装的图型置灰并提示"环境未就绪"，不让客户选了却跑不动。

### 3.6 服务台侧

- `server/figure_graph.js`：读注册表，做与 `workflow_graph.js` 同构的校验
  （linked_mods 是否存在、adapt_vars 是否齐全、语言与线是否匹配）。
- resolve 时把客户选的图型与 adapt_vars 并进执行计划。
- 派发时按 `source` 复制母版到项目 `figures/`，按 `adapt_vars` 改写副本。

### 3.7 R 4.5.3 兼容性验证（用户点名必须做）

这批代码是 R 4.3.3 时代采集的，`_meta/R453_compat/` 就是当时的兼容版。
项目已升到 R 4.5.3，`_meta/R4.5.3升级实录.md` 记录了升级过程。
模板化之前必须逐图验证在新版本下能跑，否则客户选了图、服务台派不动，比没这个功能更糟。

**验证方法照 `_meta/端到端验证框架.md` 的三层递进**：

| 层 | 判据 | 覆盖 |
|---|---|---|
| L1 环境层 | R 报 4.5.3、库路径正确、PNG 魔数 `89504e47`、PDF 落盘、22 个 R 包 `requireNamespace` 全 TRUE | 环境本身 |
| L2 桥接层 | R 与 Python 互传无损、h5ad 四项断言、CSV 中文列头不乱码、17 位精度 bit-exact | 跨语言图型 |
| L3 分析闭环层 | 一条完整链两种语言接力跑通，产物可复现 | 端到端 |

**执行顺序**：先验 17 个已验证的图型在 R 4.5.3 下是否仍绿，再评估 65 个待采集的优先级。
验证产物更新 `_meta/` 下的状态记录，索引的"本库状态"列同步刷新。

**失败处置**：某图型在新版本下失败，状态标 `blocked_r453` 并记录失败原因，
注册表里 `verified` 置 false，客户端置灰。不许带病上线。

### 3.8 与出图规范的关系

模板库服从现有出图治理，不另立标准：

- `docs/figure_spec.md` 是判据真源，模板不得违反。
- `ops/layout_autoload/` 的模板挂载继续生效，母版代码零改动。
- `ops/audit_figure_layout.py` 做真渲染审计，新模板入册前过一遍。
- DPI、主题、版式、页边距由既有机制统一管，模板只声明自己的图型与适配变量。

### 3.9 与 sync 的衔接

图级出图走同一条 sync 通道，不另建：

- 客户选图并填 adapt_vars，作为需求单的一部分提交。
- 守护进程拉到后，除分析流水线外，按注册表生成图型执行计划。
- 产物落 `local_projects/<项目>/figures/`，随交付包一起推回门户。
- 预览图用 verified PNG，出图结果用真实数据跑出的图，两者在门户上分开标注，
  不让客户把示例图当成自己的结果。

## 第四部分 · 复用清单

| 能力 | 现成件 |
|---|---|
| 图型素材池 | `reference/05.可参考出图代码/`，82 图型索引 + 17 已验证 |
| 采集路线与验证框架 | `_meta/采集路线.md` + `_meta/端到端验证框架.md` |
| 步骤注册表 | `src/workflows.json`，图级注册表照它建 |
| 图校验 | `BioanalysDesktop/server/workflow_graph.js`，图级校验照它建 |
| 双端同语义与对账 | `tests/portal_resolve_parity.test.js` 模式 |
| 出图治理 | `docs/figure_spec.md` + `ops/layout_autoload/` + `ops/audit_figure_layout.py` |
| 客户提交存储 | `portal/inbox/` 加 JSON 加包结构 |
| 传输骨架 | `ops/06_deploy_scripts.ps1` 的 scp 加字节校验加重试 |
| 导入建项 | 8787 `POST /api/projects/create` |
| 派发算力 | `server/task.js` 的 `BIO_EXEC_CMD` 命令串模式 |
| 产物回收 | `ops/07_pull_outputs.ps1`，落点改 `local_projects/<项目>/data/` |
| 客户结果包 | `ops/build_client_report.py` 加 `CHECKSUMS.sha256` |
| 探活模式 | `ops/serve_guard.ps1` 周期骨架 |
| 可跑流水线 | 自己的 mod 注册表与 `resolvePlan`，不引外部 pipeline |

## 第五部分 · 分期

| 阶段 | 内容 | 跑不跑 |
|---|---|---|
| 1 | `directories.md` 新增 `local_projects/` 与 `con_hf/sync/` 两条；脚手架生成项目结构与五种台账 | 不跑 |
| 2 | 索引生成器，产出 `INDEX.json` 与 `README.md` 模板；全局 `local_projects/INDEX.md` | 不跑 |
| 3 | 迁 `PRJ_20261019_IS_lactylation` 与 `default`，前后比对文件数与字节；`con_hf/pitfalls_ledger.md` 转 JSONL 保留 P-XX 编号 | 不跑 |
| 4 | 门户 sync 六接口加 `sync_status` 加减流，产出 `BioanalysDesktop/tests/portal_sync.test.js` | 不跑真活 |
| 5 | 守护进程骨架，拉待办、claim、下载、验签、防 slip 解包、推结果全通，导入派发留 seam 桩 | 不跑真活 |
| 6 | **R 4.5.3 图型验证**：17 个已验证图型逐图复跑，按三层框架出结论，失败的标 `blocked_r453` | 跑（算力节点） |
| 7 | 建 `src/figure_templates.json`，先入册验证通过的图型，同步加防漂移断言 | 不跑 |
| 8 | `server/figure_graph.js` 图级校验，双端同语义 + parity 对账测试 | 不跑 |
| 9 | 门户出图选择器，preview 用 verified PNG，依赖未装置灰 | 不跑 |
| 10 | 接通导入、派发、拉回、打包、推送全链路 | 后续专人 |
| 11 | 隔离审计、重试记日志、零入站验收、`serve_guard` 并入守护进程探活 | 后续专人 |
| 12 | 预览图版本一致性：母版与预览同批重跑的断言、`preview_sha256` 不符时门户提示、影响面大于 3 时另存新图型 | 不跑 |
| 13 | 适配副本落 `figures/adapt/` 并随 `01_Adapted_Code/` 交付；副本头部记母版路径与 sha256 | 不跑 |

阶段 6 是用户点名的前置项，必须在阶段 7 之前完成，否则注册进来的模板可能是跑不动的。

## 第六部分 · 验收判据

**结构与台账**

1. 一个项目的信息只在一个根目录下找得到，不需记四个位置。
2. 项目台账与全局台账无重复记录，跨项目结论只存在于全局。
3. JSONL 追加语义下，渲染脚本能按 id 聚合成完整逻辑记录。

**sync**

4. 一条 GSE 从门户提交到客户看到图和报告。
5. 编排面对门户全出站，门户从不主动连 workbench。
6. `netstat` 证实 8787 只监听 `127.0.0.1`。
7. 两个方向 checksum 校验通过。
8. A 项目客户读不到 B 项目或别的线的任何数据。
9. PC 上无任何计算进程，计算全部落在 算力节点。
10. 同一任务 60 秒内二次点同步返回"稍后重试"。
11. 四道闸拦下时客户看到 `blocked` 而非假 `running`。

**图模板库**

12. 客户在门户按图型浏览，每个图型能看到 verified 预览图。
13. 客户填 adapt_vars 提交后，服务台能生成对应执行计划并派发成功。
14. 出图产物落 `local_projects/<项目>/figures/`，母版零改动。
15. 新入册图型在 R 4.5.3 下验证通过，失败的已置灰不可选。
16. 预览图与真实结果在门户上分开标注，客户不会把示例图当自己的结果。

17. 图型可跨线共享，但 `adapt_vars` 填的值全部来自本项目本线，跨线取值被拒。
18. 适配副本落 `figures/adapt/` 并随交付包给客户，母版 sha256 零变化。
19. 改母版不同步重跑预览图时，防漂移断言报红；`preview_sha256` 与磁盘不符时门户提示不同步。
20. `deps_status` 非 `ready` 的图型在客户端置灰，并显示具体原因。

## 第七部分 · 不在本期范围

- 门户与 workbench 分离部署，因此无数据驻留问题。
- frpc 由用户自行部署，本文不涉及其上下线。
- 65 个待采集图型的补采，按优先级另立任务，本文只验证已采集的 17 个。
- 真机取证与生产跑批，按用户安排由专人后续对接。