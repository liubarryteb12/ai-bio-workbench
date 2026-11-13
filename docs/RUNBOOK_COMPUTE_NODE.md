# 算力节点 RUNBOOK

> 目标：一个没接触过这套工作台的人，照着本页能把自己的算力节点接上，或从常见故障恢复到可用。
> 具体字段与适配器契约见 `docs/COMPUTE_INTERFACE.md`。

## 一、节点要求

| 项 | 要求 |
|---|---|
| 操作系统 | Linux，bash 或 sh 可用 |
| 计算环境 | R 与 Python，安装项目所需分析包 |
| 数据盘 | 存在可写数据根，剩余空间满足门禁 |
| 传输 | `sha256sum` 可用，能完成文件校验 |
| 通道 | 适配器要求的设备或网络通道可用 |

数据根布局：

```text
<BIO_REMOTE_DATA_ROOT>/
├── projects/<project>/<line>/{raw_data,processed,results,figures}
├── bin/<line>/
├── envs/<line>/
├── public_references/
└── system_logs/
```

## 二、最小配置

```dotenv
BIO_COMPUTE_ADAPTER=adb
BIO_ADB_SERIAL=<your-device-serial>
BIO_ADB_PATH=adb
BIO_COMPUTE_NODES=[{"id":"compute-node-1","host":"compute-node-1","primary":true}]
BIO_REMOTE_DATA_ROOT=/mnt/ssd/bio_data
BIO_REMOTE_HOME=/home/bio/.local
BIO_REMOTE_HOME_DIR=/home/bio
BIO_CONTAINER_NAME=ubuntu
```

把配置写入仓库根下的 `.env.local`，该文件已被 `.gitignore` 忽略。

## 三、启动

```powershell
cd BioanalysDesktop
npm install
npm run dev
```

或运行仓库根下的 `start_all.bat`。

## 四、自检

```powershell
# 宿主机依赖
node tools/dev/preflight.mjs

# 算力通道
pwsh -File tools/ops/adb_exec.ps1 -Level container -Command 'echo ADB_EXEC_OK'

# 数据根
pwsh -File tools/ops/adb_exec.ps1 -Level container -Command 'test -w /mnt/ssd/bio_data && echo DATA_ROOT_OK'
```

期望输出包含 `ADB_EXEC_OK` 与 `DATA_ROOT_OK`。

## 五、故障分层

按顺序排查，不要跳层：

| 层 | 判据 | 处理 |
|---|---|---|
| 设备或通道 | `adb devices` 能看到目标设备 | 检查连接、授权与驱动 |
| 用户空间 | 能在节点基础用户空间执行命令 | 检查服务是否启动 |
| 容器 | 能进入 Linux 容器 | 检查容器入口与名称 |
| 数据根 | 数据根存在且可写 | 检查挂载与权限 |
| 计算环境 | R 与 Python 可执行 | 检查环境声明与版本 |

任意一层失败时先修该层，不要改上层代码。

## 六、恢复

1. 确认节点在线，通道可用。
2. 确认数据根已挂载且剩余空间达标。
3. 确认容器入口命令与容器名和 `BIO_CONTAINER_NAME` 一致。
4. 重跑第四节自检。
5. 仍失败时保留错误原文与时间戳，按层代号定位。

## 七、安全

- 设备序列号、主机名、密钥与个人路径只放 `.env.local` 或本机 `_private/`。
- 这些信息不进入仓库、报告、台账或提交信息。
- 报告正文不写机器名、绝对路径、运行环境与内部脚本目录。

## 八、相关文档

- 算力接口契约：`docs/COMPUTE_INTERFACE.md`
- 远程通道策略：`docs/remote_channel_policy.md`
- 目录与文件放置：`docs/directories.md`
- 分析代码规范：`docs/coding-standards.md`
- 三线隔离约束：`docs/isolation.md`
