# 算力接口（Compute Interface）

本工作台把“算力从哪来”定义成一个可配置接口。仓库不绑定任何具体设备，也不保存设备身份信息。使用者按自己的环境提供算力节点，工作台只负责按契约下发命令、回收产物与记录回执。

## 一、接口边界

算力接口负责四件事：

1. **探活**：节点是否在线，容器是否可执行命令。
2. **执行**：在远端执行脚本或命令，透传退出码与输出。
3. **传输**：把输入文件送到远端，把产物取回本地，并给出 sha256 回执。
4. **观测**：读取节点资源、温度、存储水位与服务状态。

算力接口不负责分析逻辑、不做参数决策、不持有凭证，也不在本地启动 R 或 Python 计算。

## 二、适配器

当前支持两种适配器，由 `BIO_COMPUTE_ADAPTER` 选择：

| 值 | 行为 |
|---|---|
| `adb` | 通过 ADB 把命令与脚本下发到用户自备的 Linux 节点。默认值 |
| `mock` | 测试与离线演示，不连接任何真实节点。生产进程默认拒绝 |

未识别的值直接报错，不静默回落到其他通道。

## 三、环境变量

### 3.1 适配器与节点池

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `BIO_COMPUTE_ADAPTER` | 否 | `adb` | 适配器类型 |
| `BIO_COMPUTE_NODES` | 否 | 单节点默认池 | JSON 数组，描述主节点与备用节点 |
| `BIO_COMPUTE_HOST` | 否 | 实现默认别名 | 主计算节点的主机名或连接别名 |
| `BIO_COMPUTE_BASE_HOST` | 否 | 实现默认别名 | 底座节点的主机名或连接别名 |
| `BIO_COMPUTE_SCP_TARGET` | 否 | `root@127.0.0.1` | 文件传输目标 |
| `BIO_COMPUTE_SSH_PORT` | 否 | `10022` | 传输端口 |

`BIO_COMPUTE_NODES` 示例：

```json
[
  { "id": "compute-node-1", "host": "compute-node-1", "primary": true },
  { "id": "compute-node-2", "host": "compute-node-2", "primary": false }
]
```

约束：

- 数组必须非空。
- 节点 `id` 必须唯一，只允许字母、数字、点、下划线与短横线。
- 有且只有一个节点 `primary` 为 `true`。
- `host` 可以是主机名、连接别名或 IP，但不得包含空白或 shell 元字符。

未显式配置时，实现会使用内置的兼容别名。该别名只是适配器的历史默认值，不代表任何特定设备。接入自己的环境时，建议同时设置 `BIO_COMPUTE_HOST`、`BIO_COMPUTE_BASE_HOST` 与 `BIO_COMPUTE_NODES`。

### 3.2 ADB 通道

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `BIO_ADB_SERIAL` | 否 | 空 | 目标设备序列号。为空时使用当前 `adb devices` 中的第一台在线设备 |
| `BIO_ADB_PATH` | 否 | 自动查找 | `adb` 可执行文件路径 |
| `BIO_REMOTE_HOME` | 否 | 参考适配器默认值 | 远端基础用户空间前缀 |
| `BIO_REMOTE_HOME_DIR` | 否 | 前缀的兄弟目录 `home` | 远端用户主目录 |
| `BIO_CONTAINER_NAME` | 否 | `ubuntu` | 远端容器名称 |

### 3.3 资源与路径

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `BIO_REMOTE_DATA_ROOT` | 否 | `/mnt/ssd/bio_data` | 远端数据根，必须显式存在且可写 |
| `BIO_MEM_LIMIT_GB` | 否 | 由运行面决定 | 单任务内存上限，生产默认 7.5，单任务最高 8.0 |

远端数据根下的固定布局：

```text
<BIO_REMOTE_DATA_ROOT>/
├── projects/<project>/<line>/{raw_data,processed,results,figures}
├── bin/<line>/                分析母版部署区
├── envs/<line>/               环境声明
├── public_references/         跨项目只读共享
└── system_logs/               全局运行台账
```

数据根不存在时，所有数据操作必须显式失败，不得静默落到其他分区。

### 3.4 离线演示

| 变量 | 必填 | 说明 |
|---|---|---|
| `BIO_ALLOW_MOCK_COMPUTE` | 否 | 设为 `1` 时允许在生产进程外使用 mock |
| `BIO_COMPUTE_MOCK_EXIT_CODE` | 否 | mock 回放退出码 |
| `BIO_COMPUTE_MOCK_STDOUT` | 否 | mock 回放标准输出 |
| `BIO_COMPUTE_MOCK_STDERR` | 否 | mock 回放标准错误 |

## 四、节点侧要求

用户自备的算力节点需要满足：

- Linux 用户空间，bash 或 sh 可用。
- 可执行 R 与 Python，并安装项目所需的分析包。
- 数据根可写，且剩余空间不低于门禁阈值。
- `sha256sum` 可用，用于传输与产物回执。
- ADB 适配器下，`adb devices` 能看到目标设备，且远端用户空间可通过 `run-as` 或等价机制进入。
- 容器内可执行容器入口命令，具体命令由适配器配置。

仓库只提供参考实现，不提供任何具体设备的连接信息。

## 五、健康探针

健康探针按层返回结论，不做自愈：

| 层 | 判据 |
|---|---|
| 设备 | `adb devices` 中存在目标序列号，或存在唯一在线设备 |
| 命令通道 | 远端执行 `echo ADB_EXEC_OK` 成功 |
| 资源 | 能读取 CPU、内存、磁盘与温度 |
| 数据根 | 数据根存在，文件系统不是 FUSE 降级层，剩余空间达标 |

任意一层失败时返回层代号与原因。调用方按代号定位，不猜测。

## 六、文件传输契约

- 文本脚本走标准输入，避免 Windows 命令行引号转义与路径长度问题。
- 二进制输入走 base64 分块或专用传输函数，落盘后校验 sha256。
- 产物回搬时校验文件名、大小与 sha256，三项一致才写入本地。
- 传输失败即停止，不跳过校验，不覆盖已有同名产物。

## 七、失败语义

- 适配器不可用：立即报错。
- 节点不在线：返回明确错误码，不等待无限超时。
- 命令退出码非零：原样透传，调用方按步骤契约处理。
- 数据根缺失或只读：拒绝执行。
- 校验失败：拒绝写入或拒绝交付。

## 八、安全要求

- 设备序列号、主机名、密钥指纹、登录凭证只放在本地环境变量或未跟踪的 `.env.local`。
- 这些信息不得写入仓库、文档、报告、台账或提交信息。
- 演示、截图与评审材料使用占位值，例如 `<your-device-serial>`。
- 发现身份信息误入仓库时，先脱敏，再评估是否需要清理历史。

## 九、示例

`.env.local` 示例：

```dotenv
BIO_COMPUTE_ADAPTER=adb
BIO_ADB_SERIAL=<your-device-serial>
BIO_ADB_PATH=adb
BIO_COMPUTE_NODES=[{"id":"compute-node-1","host":"compute-node-1","primary":true}]
BIO_REMOTE_DATA_ROOT=/mnt/ssd/bio_data
```

工作台启动时会自动读取仓库根下的 `.env.local` 与 `.env`，已存在的进程环境变量优先。
JSON 示例见 `configs/compute.example.json`。
