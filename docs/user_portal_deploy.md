# 用户需求提交入口（User Portal）部署说明

## 是什么

给客户用的**纯需求采集页**，与管理员工作台（BioanalysDesktop）**彻底解耦**，两者不共用端口、不共用进程、不共用接口：

| | 管理员工作台 | 用户提交入口 |
|---|---|---|
| 使用者 | 项目负责人（你） | 外部客户 |
| 访问地址 | `http://127.0.0.1:18787/` | `http://127.0.0.1:8080/` |
| 进程 | `BioanalysDesktop/server/index.js` | `portal/serve.mjs` |
| 代码 | `src/App.tsx` → 构建产物 `dist/` | `portal/index.html`（单文件，零构建） |
| 能力 | 建项 / 任务下发 / 文件 / 图件 / 台账 / 自检 | 只填需求表单，提交到本机收件箱 |
| 与数据面关系 | 直连 `projects/<项目>/` | 只落 `portal/inbox/`，不连工作台 |

**交接方式 = 人工中转**：客户填完点「提交给对接人」，需求 `JSON` 落到本机 `portal/inbox/`；对接人（你）看到后在工作台里手动建项目、下发任务。客户也可点「下载需求文件」自行保存后发给你。整个链路里，用户入口不调用工作台的任何接口、不读写工作台数据面。

## 启动

### 方式一：双击启动脚本（推荐）

项目根目录已备好三个 `.bat`（双击即用，无需敲命令）：

| 脚本 | 作用 |
|---|---|
| `start_workbench.bat` | 启动管理员工作台（18787） |
| `start_portal.bat` | 启动用户需求提交台（8080） |
| `start_all.bat` | 一次开两个窗口，分别启动上面两个 |

脚本会自动检查 Node、检查端口占用（已占用则友好提示而非报错崩溃）；工作台脚本在 `dist/` 缺失时自动执行 `npm run build`。

### 方式二：命令行

两个服务相互独立，分别启动：

```bash
# 1) 管理员工作台（自己用，本机 18787）
cd BioanalysDesktop
npm run build            # 前端构建，代码变更后执行一次
node server/index.js     # http://127.0.0.1:18787

# 2) 用户需求提交入口（给客户，本机 8080）
cd ..
node portal/serve.mjs    # http://127.0.0.1:8080
```

用户入口只服务 `portal/index.html`，外加两个接口：`POST /api/submit`（收件落盘）与 `GET /health`（探活），其余路径一律 404。可用环境变量调整监听：

```bash
PORTAL_PORT=9000 node portal/serve.mjs        # 换端口
PORTAL_HOST=0.0.0.0 node portal/serve.mjs     # 换监听地址（默认仅本机）
```

## 内网穿透

当前实际走 **frp**（`frpc.exe` + `frpc.toml`，服务端 `47.108.25.114:7000`，TLS + token）：

| 代理名 | 本地端口 | 公网端口 | 状态 |
|---|---|---|---|
| `Bio_user` | 8080 | 45644 | **启用**，用户需求提交入口，给客户 |
| `Bio` | 18787 | 1219 | **已注释，暂不启用**（工作台只在本机用） |

```bash
# 手动起隧道（工作目录必须是 frpc.toml 所在目录）
frpc.exe -c ./frpc.toml
```

客户地址：`http://47.108.25.114:45644/`。工作台只在本机 `http://127.0.0.1:18787/` 使用，默认不设口令。

### 需要在外网用工作台时

1. 打开 `frpc.toml`，把 `[[proxies]]` / `name = "Bio"` 那一段的注释去掉；
2. 重启 frpc（守护会自动拉起，或手动 `frpc.exe -c ./frpc.toml`）；
3. 让工作台**带口令**启动：`pwsh -File ops/serve_guard.ps1 -RequireAuth`（守护会把已在跑的免密实例替换掉）。

frp 从本机 `127.0.0.1` 回连，服务端**无法用来源地址区分内外**，所以只要 18787 映射出去就必须整站鉴权：

- 服务端读 `BAD_AUTH_USER` / `BAD_AUTH_PASS`，两个都给了才启用 HTTP Basic；都不给保持免密（本机日常使用走这条路径）。
- 启用后 `/api/health` 仍免鉴权（探活用），其余一切接口与静态页无凭证一律 401。
- 口令文件 `C:\Users\<用户名>\.bioanalys\workbench_auth.json`，由 `ops/serve_guard.ps1 -RequireAuth` 首次运行时随机生成，**不进源码、不进仓库**。
- 轮换口令：删掉该文件，再用 `-RequireAuth` 重启守护即可重新生成。

## 常驻守护（不注册开机自启）

`ops/serve_guard.ps1` 负责把 工作台 18787、用户端 8080、frpc 三个进程维持在跑：

```bash
pwsh -File ops/serve_guard.ps1                 # 常驻，30 秒一轮（本机用，工作台免口令）
pwsh -File ops/serve_guard.ps1 -Once           # 只跑一轮，排障用
pwsh -File ops/serve_guard.ps1 -RequireAuth    # 工作台带口令启动（映射到公网时用）
pwsh -File ops/serve_guard.ps1 -IntervalSec 60
```

- 只探活，活着的一律不碰，不会打断正在跑的分析任务。
- 挂了按**端口占用者**杀进程再拉起（不按命令行匹配，避免路径写法差异）。
- `-RequireAuth` 时若发现工作台探活通但没强制口令，会替换成带口令实例；不带该开关时不动鉴权设置。
- 单实例互斥；日志追加 `cn_debug/serve_guard.log`。
- **不做开机自启**：电脑重启后需手动启动一次本脚本。

## 收件箱

客户点「提交给对接人」后，**一次提交生成一个包目录**：

```
portal/inbox/
  PKG_<YYYY-MM-DD_HHMMSS>_<项目名>/
    requirement.json          需求原文
    package_manifest.json     包清单：每个文件的原名 / 归档名 / 大小 / sha256 / 绑定编号
    references/               参考文献，按 01_ / 02_ 序号重命名
    raw_data/                 数据文件，按 <角色>__<绑定编号>__<原名> 重命名
```

重命名不是美化：归档名自带角色与绑定编号，对接人不必回翻 JSON 才知道
某个 tsv 是训练集还是验证集。示例：

```
raw_data/train_matrix__GSE277173__series_matrix.txt.gz
raw_data/sample_sheet__groups.xlsx
references/01_Nature2024_psoriasis.pdf
```

- `requirement.json` 里的 `references[].path` / `dataFiles[].path` 已改写为包内相对路径
- 归档失败会回滚：已搬走的文件放回暂存区，包目录删除，不会留下半成品
- 归档成功后 `inbox/refs/<sid>/` 与 `inbox/uploads/<sid>/` 一并清空
- `inbox/` 是唯一落点，与工作台 `projects/` 数据面完全隔离
- **旧格式仍兼容**：2026-10-18 之前的 `YYYY-MM-DD_HHMMSS_需求_<项目名>.json` 平铺文件
  照常列出、照常导入，不会因为新结构而消失

### 上传的数据文件

第 2 步「数据文件上传」支持：训练集矩阵、验证集矩阵、样本信息表、分组映射表、
平台注释表、其他补充文件。单文件 ≤200MB，扩展名白名单
（`.tsv .csv .txt .xlsx .xls .gz .zip .h5ad .rds .rda .mtx .bed .bam`）。

校验规则（前端即时提示 + 服务端权威校验）：

| 场景 | 规则 |
|---|---|
| 自有上传模式 | 上传文件名必须与填写的 `train_matrix` / `val_matrix` 路径末段**完全一致** |
| 公共数据库模式 | 训练/验证矩阵必须绑定到需求里已填的 GSE，且用途要对（训练角色绑训练集） |
| 文件名带 GSE | 文件名中的 `GSE\d+` 必须与绑定编号一致 |
| 单角色 | 矩阵 / 样本表 / 分组表 / 平台注释各只允许 1 个；`other` 最多 5 个 |
| 重复 | 同角色同名重传覆盖旧文件，不会留两份 |

## 交接流程

```
客户填表  →  点「提交给对接人」
          →  需求 JSON 落到 portal/inbox/
          →  对接人打开 inbox/，按需求在工作台建项目、下发任务
（提交失败时，客户也可「下载需求文件」自行发给你）
```

页面顶部与页脚均写明「提交后需求会发送给对接人」，客户能明确知道提交是否成功。

## 需求文件契约

客户提交的文件是一份 `manifest_version: "1.0"` 的 JSON，字段与工作台建项接口的四段式对齐，人工建项时逐项对照：

```json
{
  "manifest_version": "1.0",
  "submitted_at": "2026-10-14T00:00:00.000Z",
  "basicInfo":   { "name": "...", "description": "...", "domain": "心脑血管", "disease": "...", "species": "Homo sapiens", "contact": "...", "nonTumorVerified": true },
  "dataSource":  { "source": "GEO", "dataType": "microarray", "datasets": [ { "gse": "GSE16561", "gpl": "GPL6883", "role": "train" }, { "gse": "GSE58294", "gpl": "GPL570", "role": "validation" } ], "sampleCount": 60, "tissue": "..." },
  "groupingDesign": { "mode": "ordered_stage", "groups": [ { "groupName": "...", "role": "reference", "stageOrder": 0, "colorHex": "#3B4992", "sampleIds": ["GSM..."] } ], "contrasts": [ { "name": "..._vs_...", "case": "...", "ctrl": "...", "isPrimary": true } ] },
  "pipelineDag": [ { "order": 1, "stepId": "prep_matrix" } ],
  "aclAndOutput": { "collaborators": [], "expectedFormats": ["png_300dpi", "tsv_tables"], "targetKoGene": "" },
  "references": [ { "name": "Smith2020.pdf", "path": "PKG_2026-10-18_231500_项目名/references/01_Smith2020.pdf", "size": 204800, "sha256": "…" } ],
  "dataFiles": [ { "role": "train_matrix", "bind": "GSE16561", "name": "series_matrix.txt.gz", "path": "PKG_2026-10-18_231500_项目名/raw_data/train_matrix__GSE16561__series_matrix.txt.gz", "size": 1234567, "sha256": "…" } ],
  "package_dir": "PKG_2026-10-18_231500_项目名",
  "notes": "更详细的研究目的、期望分析手段等自由文本"
}
```

`references` / `dataFiles` 里的 `path` 是**归档后**的包内相对路径，由服务端在提交时改写；
客户端上传阶段拿到的还是 `refs/<sid>/…` 与 `uploads/<sid>/…` 暂存路径。

页面内置了非肿瘤黑名单正则（与工作台 `server/tumor_blacklist.js` 同源），在客户输入时实时红字拦截；生成前还会再校验一次项目名称、分组数（≥2）、样本编号跨组不重复。

### dataType：数据类型（必填，2026-10-18 新增）

GSE / GPL 只说明「数据从哪来、什么平台」，说明不了「这是什么数据」。数据类型决定后续走哪条分析线，缺失就会选错线、跑错流程，因此在用户端是必填项，提交时服务端还会再兜一道（不在枚举内直接 400 拒收）。

| dataType | 页面文案 | 分析线 |
|---|---|---|
| `microarray` | 基因芯片（表达谱） | `line1_bulk` |
| `bulk_rnaseq` | Bulk RNA-seq（转录组测序） | `line1_bulk` |
| `scrna` | 单细胞转录组（scRNA-seq） | `line2_scrna` |
| `spatial` | 空间转录组（Visium 等） | `line3_spatial` |

粒度刻意分到芯片 / Bulk 两级：两者都属 GEO bulk，但预处理路径不同（探针注释 vs counts）。枚举以工作台 `server/domain.js` 的 `DATA_TYPES` 为准，本端 `index.html` 与 `serve.mjs` 各自持有一份同值副本（两端解耦不共享代码）。

### datasets：数据集 ↔ 平台配对（必填 ≥1 组，2026-10-18 新增；2026-10-19 加行级三元组）

GSE 与 GPL 是两组独立信息，客户一次传多组数据时必须说清「哪个平台属于哪个数据集」——不同平台走不同的探针注释与归一化，配对错了预处理就会跑偏。同一项目合入多个 GSE 时，「数据类型 / 样本数量 / 组织来源」也常不同（芯片 60 例外周血 vs 测序 24 例皮肤），因此这三项按行填写：

```json
"datasets": [
  { "gse": "GSE16561", "gpl": "GPL6883", "role": "train",
    "dataType": "microarray", "sampleCount": 60, "tissue": "Peripheral Blood" },
  { "gse": "GSE58294", "gpl": "GPL570", "role": "validation",
    "dataType": "bulk_rnaseq", "sampleCount": 24, "tissue": "Skin Lesion" }
]
```

| 字段 | 说明 |
|---|---|
| `gse` | 数据集编号，单行必填（如 `GSE16561`） |
| `gpl` | 平台编号，芯片必填、纯测序数据可留空 |
| `role` | `train`（训练集：建模 / 特征筛选）或 `validation`（验证集：独立验证） |
| `dataType` | 行级数据类型，留空回落项目级 `dataSource.dataType`；填了必须是四种枚举之一 |
| `sampleCount` | 行级样本数量，正整数；留空回落项目级 `dataSource.sampleCount` |
| `tissue` | 行级组织来源，留空回落项目级 `dataSource.tissue` |

- 同一 GSE 涉及多个平台时，拆成多行分别写。
- 用户端提交时每行 `gse` 必填；行级三元组可留空（回落项目级），但填了必须合法——`dataType` 不在枚举内、`sampleCount` 非正整数，服务端直接 400 并指明第几组。
- 服务端 `server/domain.js` 的 `normalizeDatasets` 统一做兜底：行级未填 → 继承项目级；都缺 → 留空串 / 0，不编造默认值。工作台建项时把归一化结果写进 `project.json` 的 `data_source.datasets`。
- **旧格式兼容**：2026-10-18 之前的需求文件用 `trainGse` / `valGse` / `gpl` 三个扁平数组，彼此没有显式对应关系。工作台读取这类文件时由 `normalizeDatasets` 按位置推断配对（单个 GPL 广播给全部 GSE，数量对不上则留空），并在界面明确标注「旧格式推断，需核对」，不当作可信数据直接跑。

### references / notes：参考文献与备注（可选，2026-10-18 新增）

用户端第 5 步可上传参考文献、填写备注；两者都随需求 JSON 一起交接给对接人。

**参考文献**：最多 5 篇、单篇 ≤20MB、扩展名限 `.pdf` / `.doc` / `.docx` / `.txt` / `.md` / `.zip`。选中即上传（不等到提交），走独立接口：

```
POST /api/references?sid=<上传会话 id>&name=<原文件名>
Content-Type: application/octet-stream     # 请求体就是文件原始二进制，零依赖、不解析 multipart
→ 200 { ok:true, name, path:"refs/<sid>/<安全化文件名>", size }
```

- 上传阶段落 `portal/inbox/refs/<sid>/`（暂存），提交时搬进 `PKG_.../references/` 并重命名为 `01_原名`。
- 同名不覆盖（追加 `_2` / `_3`）；单批次满 5 篇后服务端直接 400。
- 需求 JSON 里只记元数据；**文件本体不进 JSON**（否则撑爆 1MB 上限）。
- 提交时服务端逐条校验：条数 ≤5、`path` 必须匹配 `refs/<sid>/<文件名>` 且**该文件真实存在**（`fs.statSync` 为普通文件、且解析后仍在 `inbox/` 内），防止客户端伪造路径。

### dataFiles：数据文件上传（可选，2026-10-18 新增）

第 2 步可直接上传表达矩阵、样本表、分组表、平台注释等文件，走独立接口：

```
POST /api/datafiles?sid=<会话>&role=<角色>&bind=<数据集编号>&name=<原文件名>
Content-Type: application/octet-stream
→ 200 { ok:true, name, storedName, path:"uploads/<sid>/<角色>__<编号>__<原名>", size, role, bind }
```

- 暂存路径 `uploads/<sid>/`，提交时搬进 `PKG_.../raw_data/`（归档名与暂存名一致）。
- 服务端流式写盘（不把 200MB 读进内存），超限即中断并删半成品。
- 一致性校验在提交时由 `portal/lib/archive.mjs` 的 `validateDataFiles` 统一执行，
  前端用同规则做即时提示（见上文「上传的数据文件」表）。

**备注**（`notes`）：自由文本，上限 4000 字。它会随建项落进项目 `project.json` 的 `notes` 字段，并**同样参与非肿瘤黑名单校验**（客户在备注里写「肿瘤/免疫浸润」相关字样，建项时会被拦下）。

## 五步向导

1. **项目信息** — 名称 / 疾病 / 描述 / 物种 / 领域 / 联系方式（黑名单实时校验）
2. **数据来源** — **数据类型（必填）** / 数据库 / **数据集 ↔ 平台配对表（可增删多行）** / 样本数 / 组织
3. **分组设计** — 三种分组模式、动态 N≥2 组、组内样本批量粘贴 + 跨组查重、对比对生成
4. **分析流程** — 分析线由第 2 步的数据类型**自动锁定**（其余两条置灰不可选）、勾选步骤（含功能说明）、虚拟敲除需填目标基因
5. **补充材料与提交** — 参考文献（≤5 篇）/ 备注 / 交付物勾选 / 需求摘要 → 提交给对接人（落盘 inbox）→ 备用下载 / 复制 / 打印

每步顶部有「填写引导」提示；质控步骤自动锁定不可取消。

## 规范符合性（web-interface-guidelines）

- 语义化 `<form>/<label>/<button>/<fieldset>/<legend>`；skip link；标题层级 h1→h2
- 所有控件带 `<label for>`；checkbox/radio 整块可点；`aria-label` 覆盖删除按钮
- `:focus-visible` 焦点环；不用 `outline:none` 裸奔
- `aria-live`/`role=alert`/`role=status` 覆盖异步校验与生成反馈
- 错误内联展示；placeholder 以 `…` 结尾；`autocomplete` 已设
- `prefers-reduced-motion` 降级；仅动画 `transform`/`opacity`；显式列 transition 属性
- `touch-action: manipulation`；`color-scheme: light`；`theme-color` 已设
- 数字列 `tabular-nums`；标题 `text-wrap: balance`；长文本 `word-break`
- 无 `user-scalable=no`；无粘贴拦截；无 `transition: all`
