# 交付包打包脚本规范（Delivery Package Spec）

> 版本：v1.0（2026-10-14）
> 适用对象：`ops/09_package_delivery.ps1`（PC 侧入口，ssh 驱动远端打包）
> 上位约束：`docs/delivery_supervisor_prompt.md` v3.0 第五节、`docs/directories.md`
> 实现状态：**打包能力已由 `ops/build_client_report.py` + 18787 入口 `server/report.js` 承担**；
> `ops/09_package_delivery.ps1` 不再实现（2026-10-21 裁定，见下节「零」）。

> **2026-10-18 补充：本规范的部分内容已被 `aims.txt` v3.0 §7.2 取代。**
>
> - 包内目录名以 aims v3.0 为准：`01_Adapted_Scripts/`（本文写作 `01_Adapted_Code/`）、
>   `02_Figures_and_Tables/`、`03_Interpretation_Report/`。
> - 报告从"三段式 README"升级为**七章标准结构**，并同时产出 `.md` 与单文件可交互 `.html`。
> - 上述能力已由 `ops/build_client_report.py` 实现（服务器侧，`python3 ops/build_client_report.py
>   --project <dir>`），本文第六节的 `09_package_delivery.ps1` 仍未实现。
> - 本文第三节的前置门禁里，**存储水位、失败台账确认、`.sha256` 旁挂文件**三项尚未并入
>   `build_client_report.py`；若要严格执行本规范，需在 PC 侧入口补齐这三道闸。
## 零、实现现状（2026-10-21 起以此为准）

本规范的**打包动作**已经落地，落点与本文原来的设想不同，读本文时以本节为准：

| 能力 | 实际实现 | 位置 |
|---|---|---|
| 交付包（三大件 + tar.gz + delivery_manifest） | `ops/build_client_report.py`（服务器侧引擎，退出码 0/1/2） | 远端 `python3 ops/build_client_report.py --project <项目目录>` |
| 工作台触发 + 三大件回搬本地 | `runReportBuild` + `pullDeliverables` | `BioanalysDesktop/server/report.js`，端点 `POST /api/report/build` |
| 前置门禁：存储水位 >= 20% | `runReportPreflight`（`df -P` 解析剩余百分比） | 同上，`PREFLIGHT_MIN_FREE_PCT = 20` |
| 前置门禁：无进行中任务 | 同上（扫本项目台账 `status=running`） | 同上 |
| 前置门禁：失败台账需人工确认 | 同上（`force: true` 对应本文的 `-Force`） | 同上，HTTP 412 拒绝并列出失败台账 |
| 前置门禁：远端输出完整性 | 同上（缺 `END|` 标记判输出截断） | 同上，防 argv 静默截断老坑 |
| `.sha256` 旁挂校验文件 | `writeSha256Sidecars`（`<文件>.sha256`，sha256sum 可直接 `-c`） | 同上，回搬成功后自动生成 |
| 包内 `CHECKSUMS.sha256` | `write_checksums`（相对路径排序，跳过自身与 `PACKAGE_META.json`，先写清单再打 tar） | `ops/build_client_report.py`；2026-10-21 远端真机 285 文件 `sha256sum -c` 全过 |

**因此**：本文第二节点名的入口 `ops/09_package_delivery.ps1` **作废**，不要照它新建脚本；
本文第三节六条门禁里第 3/5/6 条已在 18787 调用侧实现（引擎 CLI 直跑仍不检查，属于已知边界）；
第四至七节描述的包内结构与脱敏规则由引擎负责，仍具约束力。

## 一、定位与边界

打包脚本只做一件事：把一个已验收通过的项目，从服务器侧收敛成一份可交付给客户的压缩包。

它**不做**：

- 不跑分析、不改任何产物、不重绘图件
- 不改工作台框架（`BioanalysDesktop/`）、不改 ops 6 件套、不改 `bin/<line>/` 母版
- 不打包原始数据与中间态大文件（客户拿不到也用不上，且体积失控）

它**必须做**：

- 产物完整性校验（缺件就失败，不生成残缺包）
- 路径脱敏（不泄露服务器绝对路径、主机名、账号）
- 生成校验清单（`CHECKSUMS.sha256`），客户可自行核验

## 二、调用契约

```
pwsh -File ops/09_package_delivery.ps1 -Project <project_id> [-Line <line_id>] [-Label <标签>]
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `-Project` | 是 | 项目 ID，规则同 `server/domain.js` 的 `sanitizeProjectId`（`[A-Za-z0-9._-]`，不以 `.` 开头，长度 <= 64） |
| `-Line` | 否 | 只打包一条线（`line1_bulk` / `line2_scrna` / `line3_spatial`），缺省三条线全打 |
| `-Label` | 否 | 包名后缀，如 `v1`、`final`，只允许 `[A-Za-z0-9._-]`，缺省为空 |

**输出路径**（服务器侧）：

```
/mnt/ssd/bio_data/projects/<project_id>/deliverables/
├── <project_id>_Client_Delivery_<YYYYMMDD>[_<Label>].tar.gz
└── <project_id>_Client_Delivery_<YYYYMMDD>[_<Label>].tar.gz.sha256
```

**退出码**：`0` 成功；`1` 前置门禁失败；`2` 打包或校验失败。任何非 0 都不得留下可见的成品包。

**幂等**：同名已存在时追加 `_2`、`_3`，绝不覆盖已有交付包。

## 三、前置门禁（任一不过即 exit 1）

1. **链路**：`ssh k40-ubuntu 'echo CONTAINER_OK'` 通（不通先跑 `ops/00_link_check.ps1`）。
2. **项目存在**：`projects/<project_id>/project.json` 可读。
3. **存储水位**：`df -P /mnt/ssd/bio_data` 剩余 >= 20%。
4. **产物非空**：所选线至少一条的 `figures/` 有 `.png`；三条线全空则拒绝打包。
5. **无进行中任务**：`system_logs/` 中本项目最近台账不得有 `status=running`。
6. **失败台账需确认**：若存在本项目 `status=failed` 的台账，脚本打印清单并以 `-Force` 才继续；
   未加 `-Force` 时 exit 1。理由：失败步骤的产物不完整，交付前必须人工确认。

## 四、包内结构（三大件）

```
<project_id>_Client_Delivery_<YYYYMMDD>/
├── 01_Adapted_Code/
│   ├── README.md                  # 每份脚本的作用、运行顺序、依赖版本
│   ├── MANIFEST.tsv               # 线 / 步骤 / 脚本名 / 来源（母版 or 适配副本）/ 改动摘要
│   └── <line_id>/
│       └── <script_name>          # 实际运行过的脚本（适配副本优先，无则母版）
├── 02_Figures_and_Tables/
│   ├── figures/<line_id>/*.png    # 300 DPI 合规图件
│   ├── figures_vector/<line_id>/*.pdf   # 可选，母版若产出矢量图则收录
│   ├── tables/<line_id>/*.tsv     # 全量统计表
│   ├── tables/<line_id>/*.csv     # 结构化结果表（如 scenic_regulons.csv）
│   └── reports/<line_id>/*.txt    # 每步 report（口径、参数、限制说明）
├── 03_Interpretation_Report/
│   └── README.md                  # 三段式解读（核心结论 / 数据与统计依据 / 方法学与生物学限制）
├── CHECKSUMS.sha256               # 包内全部文件 sha256（相对路径排序）
└── PACKAGE_META.json              # 项目 ID、打包时间、包含线、文件计数、脚本版本
```

`03_Interpretation_Report/README.md` 若不存在，脚本**不伪造**，改为在 `PACKAGE_META.json`
写 `report_status: "missing"` 并在控制台 WARN，由代理补齐后重打。

## 五、纳入与排除规则（按实测口径）

### 5.1 纳入

| 来源 | 规则 | 落点 |
|---|---|---|
| `<line>/figures/` | `*.png`（300 DPI 母版直出） | `02_Figures_and_Tables/figures/<line>/` |
| `<line>/processed/` | `*.tsv` | `02_Figures_and_Tables/tables/<line>/` |
| `<line>/processed/` | `*.csv` | `02_Figures_and_Tables/tables/<line>/` |
| `<line>/processed/` | `*.txt`（步骤 report） | `02_Figures_and_Tables/reports/<line>/` |
| `<line>/processed/` | `*.pdf`（矢量图副本，若存在） | `02_Figures_and_Tables/figures_vector/<line>/` |
| `projects/<id>/<line>/scripts/` | 适配副本（存在即优先） | `01_Adapted_Code/<line>/` |
| `bin/<line>/` | 仅收录 `MANIFEST.tsv` 中登记为"实际运行"的母版脚本 | `01_Adapted_Code/<line>/` |
| `projects/<id>/deliverables/03_Interpretation_Report/` | 代理手写报告 | `03_Interpretation_Report/` |

### 5.2 排除（硬规则，打包后需扫描确认）

| 模式 | 理由 |
|---|---|
| `raw_data/**` | 客户自有原始数据，体积大且无需回传 |
| `*.h5ad`、`*.rds`、`*.RData`、`*.loom` | 中间态检查点，单文件可达数百 MB |
| `*.tar`、`*.tar.gz`、`*.gz`、`*.zip` | 原始压缩包与嵌套包 |
| `*.log` | 运行日志，含路径与临时信息 |
| `s*_probe*.py`、`*_readback.py`、`*_diffcheck.py`、`*_kwcheck.py` | 历史调试探针，非交付代码 |
| `__pycache__/`、`.ipynb_checkpoints/`、`.DS_Store` | 缓存与系统垃圾 |
| 其他两条线的任何路径 | 跨线隔离红线 |

> 实测依据（`projects/default`，2026-10-14）：`processed/` 内存在 20 个 `s4_*_probe*.py` 调试残留、
> 45 个 `.h5ad`（单个最大 617 MB）、1 个 `.csv`（`scenic_regulons.csv`，属真实结果需保留）、
> 4 个 `.pdf`（line1 旧版图件）。`results/` 当前为空，规则保留但允许空目录。

## 六、脱敏规则（打包前执行，打包后抽检）

1. **绝对路径**：`/mnt/ssd/bio_data/projects/<project_id>` 替换为 `<PROJECT_ROOT>`；
   `/mnt/ssd/bio_data` 替换为 `<BIO_DATA_ROOT>`。
2. **主机与账号**：删除 `/data/data/com.termux/**`、`/home/<user>/**`、`root@127.0.0.1`、
   `k40` / `k40-ubuntu` 等主机别名。
3. **联系方式**：`project.json` 的 `basicInfo.contact` 不进入包内任何文件；
   `PACKAGE_META.json` 只保留项目 ID、名称、物种、分组数。
4. **内部编号**：`system_logs` 台账只以摘要形式进入 `PACKAGE_META.json`
   （task_id / step / status / 时间），不打包原始台账文件。
5. **抽检**：打包后对包内文本文件执行 `grep -E 'mnt/ssd|termux|k40-ubuntu|root@'`，
   命中即 exit 2。

## 七、打包后校验（任一不过即 exit 2，并删除半成品）

1. `tar -tzf` 可正常列出，条目数 > 0。
2. 三大件目录均存在且非空（`03_Interpretation_Report` 缺失时降级为 WARN，见第四节）。
3. 图件计数一致：包内 `figures/<line>/*.png` 数量 == 服务器 `<line>/figures/*.png` 数量。
4. `CHECKSUMS.sha256` 覆盖包内全部文件，且行数 == 文件数（不含自身与 `PACKAGE_META.json`）。
5. 排除模式扫描无命中。
6. 包体积与文件数打印到控制台，并写入 `PACKAGE_META.json`。

## 八、失败处理与现场保留

- 先在 `deliverables/.staging_<timestamp>/` 组装，全部校验通过后一次性 `tar -czf` 到最终名，
  再 `mv` 到位；失败时删除 `.tar.gz`，保留 `.staging_*` 供排查并打印路径。
- 失败信息必须包含：失败阶段（门禁 / 收集 / 脱敏 / 打包 / 校验）、具体文件或命令、退出码。
- 禁止"打包成功但内容缺件"的假成功：校验未过一律按失败处理。

## 九、与既有体系的关系

| 项 | 关系 |
|---|---|
| `ops/07_pull_outputs.ps1` | 本地回搬通道，与本脚本正交：07 是"服务器到本地存档"，09 是"服务器到客户交付包" |
| `run_throttled_task.sh` | 不调用。打包是 IO 轻任务，不走绑核包装器，也不产生任务台账 |
| `system_logs/` | 只读，用于门禁判断与摘要，不写入新台账 |
| `con_hf/` 台账 | 打包完成后由代理追加一条操作台账（做了什么 / 包路径 / 文件数 / 校验结果） |
| 工作台前端 | 无交互入口，纯命令行工具；后续如需按钮，再单独评估 |

## 十、验收清单（实现后自测项）

- [ ] 正常项目：三条线全打，包内三大件齐全，校验全过
- [ ] 单线打包：`-Line line1_bulk` 只含该线，且不含其他两线任何字面量
- [ ] 非法 `-Project`（含 `..`、以 `.` 开头、超长）立即 exit 1，不触达服务器
- [ ] 空图件项目：exit 1，提示"无图件可交付"
- [ ] 存在 failed 台账且未加 `-Force`：exit 1 并列出失败步骤
- [ ] 重复打包：生成 `_2` 后缀，不覆盖旧包
- [ ] 包内抽检：无 `mnt/ssd`、`termux`、`k40-ubuntu`、`root@` 命中
- [ ] 包内无 `*.h5ad`、`*.rds`、`*.log`、`s*_probe*.py`
- [ ] `CHECKSUMS.sha256` 可在客户侧 `sha256sum -c` 通过
