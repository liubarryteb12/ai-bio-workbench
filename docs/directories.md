# 工程规范 — 目录结构

> version 1 | 2026-10-12
> 本规范规定"文件放哪"。新会话接手先读本文件，不要猜。

## 一句话原则

**本地只放"代码本体 + 交接台账"；数据、原始产物、环境全部在服务器侧。**
本地目录不许当数据仓库用。

## 本地工程目录（本仓库）

```
AI辅助生信分析流程工作台/
├── reference/               # 只读参考资料（红米K40实测经验、已有脚本），禁止修改其中任何文件
├── con_hf/                  # 交接上下文
│   ├── CONTEXT.md           # 领域术语表（唯一权威，改词先改这里）
│   ├── SPEC.md              # 阶段规格
│   ├── handoff.md           # 跨会话交接快照（接活先读它）
│   └── ...
├── docs/                    # 工程规范与架构文档
│   ├── directories.md       # 本文件
│   ├── coding-standards.md  # 分析代码规范（Linux 运行面，src/ 动工前必读）
│   ├── isolation.md         # 三线隔离约束与校验
│   └── ledger-schema.md     # 任务台账 JSON schema
├── ops/                     # 链路运维脚本（PC 侧 PowerShell 入口 + 手机/容器侧执行体）
└── src/                     # 三条线分析代码
    ├── line1_bulk/
    ├── line2_scrna/
    └── line3_spatial/
```

## 服务器侧目录

```
/mnt/ssd/bio_data/                      # 红米手机自带储存根
├── projects/                           # 项目根：一个项目一套三线，项目之间物理隔离
│   ├── default/                        # 默认项目（历史三线数据迁入处）
│   │   ├── line1_bulk/                 # GEO bulk 线
│   │   ├── line2_scrna/                # 单细胞 + 虚拟敲除线
│   │   ├── line3_spatial/              # 单细胞空间 + 虚拟敲除线
│   │   └── project.json                # 项目元数据（名称 / 描述 / 创建时间）
│   └── <新项目>/...
│       ├── <line>/scripts/             # 【代理自管】本项目适配后的脚本副本（方案A，框架不创建）
│       └── deliverables/               # 【代理自管】客户交付包三大件（框架不创建）
├── bin/<line>/                         # 脚本部署区（代码本体，全局一份，所有项目共用）
├── envs/<line>/                        # 环境声明（跟代码走，全局一份）
├── public_references/                  # 公共参考（跨项目唯一合法共享读入口）
└── system_logs/                        # 全局台账 JSON（条目带 project_id 区分归属）
```

每条线内部数据子目录固定为 `raw_data/`、`processed/`、`results/`、`figures/`；
脚本 `bin/` 与环境声明 `envs/` 在顶层全局一份，不随项目复制（同一线的所有项目共用同一份代码与环境）。

**两个代理自管目录（不在框架 `LINE_SUBDIRS` 内，工作台不创建、不感知）**：

| 目录 | 用途 | 谁创建 |
|---|---|---|
| `projects/<项目>/<line>/scripts/` | 客户数据需适配时，从 `bin/<line>/` 复制母版到此改，跑通后留档；不改母版 | 代理 `mkdir -p` |
| `projects/<项目>/deliverables/` | 客户交付包三大件（适配代码 / 图表与表格 / 解读报告） | 代理 `mkdir -p` |

交付包结构与打包规则见 `docs/delivery_package_spec.md`（v1.0），打包入口规划为 `ops/09_package_delivery.ps1`（脚本尚未实现，规范先行）。

适配副本不经工作台任务引擎（它只认全局 `bin/<line>/`），而是直跑 ops 包装器：
`bash /mnt/ssd/bio_data/ops/run_throttled_task.sh <task_id> <line> <step> <R|Python> <项目内脚本绝对路径>`。

本地回搬存档（`ops/07_pull_outputs.ps1`）按项目分：`outputs/<项目>/<line>/{processed,results,figures}`；
任务台账统一落 `outputs/system_logs/`。

## 归档分类（写文件前先判断类别）

| 类别 | 落点 |
|---|---|
| 交接上下文 | `con_hf/` |
| 工程规范、架构文档 | `docs/` |
| 运维脚本 | `ops/` |
| 分析代码 | `src/<line_id>/` |
| 调试与临时日志 | `cn_debug/` |
| 运行记录、验证报告 | `con_hf/runs/` |

运行记录命名：`YYYY-MM-DD_[类型]_[简短说明]`，类型 ∈ `initial` 基线 / `debug` 调试 / `failed` 失败现场 / `verification` 验证 / `formal` 正式产物。

## 命名与写法红线

- 标识符、路径用英文；面向用户的说明用中文。
- **Linux 系统内（服务器侧）一律英文路径与文件名**，不出现中文字符：本地既有中文名的
  用户资产（如 `test_use_data/` 下的目录与 `分组情况.txt`）推到服务器前必须换成英文名，
  映射关系集中在引用处（当前在 `ops/05_push_testdata.ps1` 的 `$RemoteNameMap`）。
- 注释只解释"为什么"，不写"这是什么"。
- 注释和文档不用 em dash（—），用逗号、冒号、句号替代。
- 变量命名不用单字母（数学符号和循环计数除外）。
- 不自动重命名、移动或覆盖用户原有文件。
- linux上运行的代码必须符合linux的命名规范。

## 服务器侧执行面

| 面 | 别名 | 用途 | 不该做什么 |
|---|---|---|---|
| Termux 底座 | `k40` | 文件传输、隧道、服务管理、runsv 看护 | 不跑分析计算 |
| Ubuntu 容器 | `k40-ubuntu` | R/Python 科学计算执行 | 不作为文件长期存放地 |

## 环境隔离

- 容器内 R/Python 环境按线固定：每条线一个独立 conda env 或独立 R 库路径，记录主语言与版本到该线 `envs/`。
- 版本、随机种子写进该线 `envs/manifest.txt`，分析中途不更换。
- 跨线不共用编译产物、不共用 conda env。
