# 项目自包含结构与 sync 数据流方案（v1.0）

> 2026-10-25 立项。本文是**方案**，不是实现。分期与验收见第八、九节。
> 上游讨论跨八轮，用户逐条裁定：本地项目根改名 `local_projects/`；台账不合并；
> `system_logs` 保持独立；spool 由 `directories.md` 新增条款合法化；
> 项目级 README 与 handoff 保持两份。
> 上位约束：`AGENTS.md` 双平面铁律、`docs/isolation.md` 三线隔离、`docs/directories.md` 文件落点。
> 隔离红线优先于本文任何条目。

## 一、问题与目标

现状一个项目的东西散在四处：数据在 `outputs/<项目>/`、台账在 `con_hf/` 与
`outputs/system_logs/`、交付在 `deliverables/`、调试在 `cn_debug/`。
找一个项目的信息要记四个位置，跨会话接手成本高。

两个目标：

1. **项目自包含**。一个项目一个根目录，数据、产物、交付、调试、台账、交接全部收在里面，
   通过索引对外暴露。全局共享件（母版、ops、规范）留在原地，不搬进项目，避免每项目一份拷贝导致漂移。
2. **数据流向纪律**。客户只往门户写、只看编排面推来的结果，从不拉取服务端内部状态；
   编排面对门户全出站。同机部署，规范的意义在软件层钉死边界，防止以后有人图省事
   让门户直连 workbench。

## 二、目录结构

```
<工作区根>/
├── local_projects/                  # 本地项目根，与远端 /mnt/ssd/bio_data/projects/ 语义区分
│   └── <项目A>/
│       ├── project.json             # 机器读硬字段：id、名称、分析线、创建时间
│       ├── handoff.md               # 项目级交接：项目是什么、跑到哪一步、哪些步骤有坑、下一步
│       ├── README.md                # 人读索引：台账入口、产物入口、交付入口
│       ├── INDEX.json               # 机读索引：路径映射与产物计数，脚手架生成，禁止手改
│       ├── data/                    # 从 K40 回搬的产物
│       │   └── <line>/{processed,figures,results}
│       ├── deliverables/            # 客户交付包
│       ├── debug/                   # 本项目调试脚本与日志
│       └── ledger/                  # 项目级五种台账，JSONL 追加式
│           ├── actions.jsonl        # kind: run | edit | init，做了就是做了，不设 status
│           ├── changes.jsonl        # 修改记录
│           ├── errors.jsonl         # 失败记录，status 可为 open
│           ├── fixes.jsonl          # 修复记录
│           └── pitfalls.jsonl       # 踩坑记录
│
├── con_hf/                          # 全局侧，与项目级同构
│   ├── handoff.md                   # 全局交接：工作台在哪、三条线状态、K40 通不通、git 可写否
│   ├── ledger/                      # 全局五种台账，与项目级同构
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
└── ops/ src/ BioanalysDesktop/ portal/ docs/     # 全局件，原位不动
```

本地 `projects/` 若已存在，整体改名 `local_projects/`，现有内容规整进去，不另起新根。

## 三、记录双层判据

**判据：换个项目还成立不成立。** 成立，上全局；只对本项目成立，留项目级。

| 记录 | 归属 |
|---|---|
| line2 步骤 7 两次 exit 1，根因 seed 未注入 | 项目 A `errors.jsonl` + `fixes.jsonl` |
| runner 高频 ssh 轮询触发 proot abort，轮询改 60 秒 | 全局 `pitfalls.jsonl` |
| GEO FTP 返回 990 字节 XML，NCBI 侧行为未定位 | 全局 `pitfalls.jsonl` |
| 客户 X 的 GSE252465 少一组样本 | 项目 A `errors.jsonl` |
| 把 outputs/ 迁到 local_projects/ | 全局 `changes.jsonl` |
| 把 ledger 格式改成 JSONL | 全局 `changes.jsonl` |

**防重复纪律**：项目级遇跨项目结论只记 `{"title":"见 P-29","refs":["P-29"]}`，正文在全局；
全局不写"某项目某步骤失败三次"这种细节，只提炼可复用结论。

## 四、JSONL 记录 schema

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

1. **JSONL 只能追加**。改状态是追加同 `id` 新行，读时取最后一条。渲染脚本负责按 id 聚合成逻辑记录。
2. **历史编号不动**。`P-XX`、`D-XX` 原样作 `id`，转 JSONL 只是换载体，仓库内现有引用不断。
3. **errors 与 fixes 不合并**（用户裁定）。一次修复常对应多个错误，靠 `refs` 关联，
   渲染脚本聚合时按 refs 串成一条 issue 视图。

## 五、需求到项目的衔接

用户提交需求生成项目 A 时：

1. 需求单内容作为第一条 `action` 落进 `local_projects/A/ledger/actions.jsonl`，
   `kind: init`，`refs` 指向需求 ticket。
2. `project.json` 只自动带 `ticket_id` 与 `created_at`，疾病名等由 agent 首次接手确认后回填，
   并补一条 action 记录"初始化项目元数据"。不做不可靠的自动提取。

## 六、sync 机制

### 6.1 角色与流向

| 角色 | 允许 | 禁止 |
|---|---|---|
| 客户端 | 往门户发文件与表单，发起结果同步请求，查看编排面推来的预览图与结果 | 拉取服务端任何内部状态 |
| 门户 | 收客户输入，落盘标记状态，展示编排面推来的结果 | 主动连接 workbench，读其内部 |
| 编排面（8787） | 出站拉门户 inbox，经 SSH 派 K40，拉回产物，推结果回门户 | 开公网入站，自己跑计算 |
| 算力面（K40） | 执行计算 | 对外 |

三条流向，方向单一：客户到门户（唯一入口）、编排面到门户 inbox（拉待办，出站）、
编排面到门户（推结果，出站）。门户从不主动连 workbench。

### 6.2 网络配置（写死，照抄会错）

同机通信全走 `127.0.0.1`，显式设 `NO_PROXY=127.0.0.1,localhost`，**不注入 `127.0.0.1:7890`**。
AGENTS.md §1.2 的代理规定针对外网出口，同机环走属豁免范围。若照该节写"出站前注入代理"，
守护进程第一趟就会因代理连不上本机门户。

### 6.3 门户侧改动

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

结果存 `local_projects/<项目A>/deliverables/`，一票一项目，不另起目录。

### 6.4 编排面守护进程

`ops/sync_daemon.ps1`，薄编排器：窄接口只做拉待办与推结果，深处全部复用第七节现成件，
不重写任何一段传输或打包。`SYNC_BATCH=1` 默认串行，队列结构支持后续扩展并行度。

单票流程：claim → 下载到 spool 并验 sha256 → 防 slip 解包 → 导入建项 → 派发 K40 →
拉回产物 → 打交付包 → 推结果。任一步失败重试三次退避，仍失败推 `failed` 并附错误详情。

**闸不过的出口**：交付四道闸拦下时推 `blocked`，客户侧文案"待人工确认，详见对接人"，
不停在 `running` 假装在跑。人工确认后由对接人触发重推。

**守护进程自身行动**记全局 `con_hf/ledger/actions.jsonl`（启动、停止、拉了哪个 ticket），
不直接写项目 ledger；项目内事实由导入建项后的工作流写。

**探活**：并入 `ops/serve_guard.ps1` 的 30 秒周期多探一个进程在不在，不新起第三个守护。

### 6.5 长任务队列行为（照 P-26 P-27 P-29 写死）

- **P-26**：本机进程树承载远端长任务必死。派发用远端 `setsid nohup` 脱离本机进程树，
  守护进程不跨 ssh 等待。
- **P-27**：固定时长等待对重步骤必然假失败。台账等待分档，`l2_tf_scenic` 与
  `l2_ko_scrna` 按 40 分钟档，其余按分钟档。
- **P-29**：禁止并发 ssh 到 k40-ubuntu，轮询不小于 60 秒，重试不超过两次，
  下发长任务前确认容器安静，容器内禁 `find` / `ps` / `grep -r`。
- 等待期间只读台账不碰 ssh，因此一个 40 分钟任务不会阻塞其他 ticket 的轮询节奏。

## 七、复用清单

| 能力 | 现成件 |
|---|---|
| 客户提交存储 | `portal/inbox/` 加 JSON 加包结构 |
| 传输骨架 | `ops/06_deploy_scripts.ps1` 的 scp 加字节校验加重试 |
| 导入建项 | 8787 `POST /api/projects/create` |
| 派发算力 | `server/task.js` 的 `BIO_EXEC_CMD` 命令串模式 |
| 产物回收 | `ops/07_pull_outputs.ps1`，落点改 `local_projects/<项目>/data/` |
| 客户结果包 | `ops/build_client_report.py` 加 `CHECKSUMS.sha256`，三大件已备好 |
| 探活模式 | `ops/serve_guard.ps1` 周期骨架 |
| 可跑流水线 | 自己的 mod 注册表与 `resolvePlan`，不引外部 pipeline |

## 八、分期

| 阶段 | 内容 | 跑不跑 |
|---|---|---|
| 1 | `directories.md` 新增 `local_projects/` 与 `con_hf/sync/` 两条；脚手架生成目录结构与五种台账 | 不跑 |
| 2 | 索引生成器，产出 `INDEX.json` 与 `README.md` 模板；全局 `local_projects/INDEX.md` 扫各项目汇总 | 不跑 |
| 3 | 迁 `PRJ_20261019_IS_lactylation` 与 `default`，前后比对文件数与字节；`con_hf/pitfalls_ledger.md` 转 JSONL 保留 P-XX 编号 | 不跑 |
| 4 | 门户 sync 六接口加 `sync_status` 加减流，产出 `BioanalysDesktop/tests/portal_sync.test.js`（自带服务生命周期） | 不跑真活 |
| 5 | 守护进程骨架，拉待办、claim、下载、验签、防 slip 解包、推结果全通，导入与派发留 seam 桩 | 不跑真活 |
| 6 | 接通导入、派发、拉回、打包、推送 | 后续专人 |
| 7 | 隔离审计、重试记日志、零入站验收、`serve_guard` 并入守护进程探活 | 后续专人 |

1 到 5 合起来是可验收框架：一条假 ticket 从 `pending` 走到 `done`，全程不碰 K40。

## 九、验收判据

1. 一条 GSE 从门户提交到客户看到图和报告。
2. 编排面对门户全出站，门户从不主动连 workbench。
3. `netstat` 证实 8787 只监听 `127.0.0.1`。
4. 两个方向 checksum 校验通过。
5. A 项目客户读不到 B 项目或别的线的任何数据。
6. PC 上无任何计算进程，计算全部落在 K40。
7. 同一任务 60 秒内二次点同步返回"稍后重试"。
8. 项目台账与全局台账无重复记录，跨项目结论只存在于全局。
9. 四道闸拦下时客户看到 `blocked` 而非假 `running`。

## 十、不在本期范围

- 门户与 workbench 分离部署，因此无数据驻留问题。
- frpc 由用户自行部署，本文不涉及其上下线。
- 真机取证与生产跑批，按用户安排由专人后续对接。