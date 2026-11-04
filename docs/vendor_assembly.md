# vendor/tools 组装说明（构建机专用，二进制不进 Git）

> 4 Argon 第二十八轮 Q1 裁定：仓库只存源码与确定性逻辑；128 MB 二进制
> 用「本地受控缓存 + 构建时动态组装」解决「克隆即可出包」与仓库轻量的矛盾。
> 因此 `vendor/` 已整体进 `.gitignore`，`git status` 对它永远零污染。

## 一次性组装（每台构建机做一次）

目标布局：`vendor/tools/` 平铺以下文件（约 128 MB）：

| 文件 | 来源 | 用途 |
|---|---|---|
| `node.exe` | 本机 Node 发行版根目录（实测 D:\\node-v2.4\\node.exe） | 包内唯一解释器（runtime/ 顶 PATH） |
| `ssh.exe` `scp.exe` `tar.exe` `sha256sum.exe` `openssl.exe` `bash.exe` | Git for Windows 的 `usr\\bin`（实测 D:\\Git\\usr\\bin） | 链路测试与交付验真的便携替身 |
| `msys-*.dll` 全集（约 74 个，34 MB） | 同上目录，**整批拷，别挑** | MSYS 依赖；单拷 exe 会 0xC0000135（实测） |

```powershell
# 参考命令（路径按本机调整；必须复制整个 msys-*.dll 集合）
mkdir vendor\tools -Force
copy D:\node-v2.4\node.exe vendor\tools\
copy D:\Git\usr\bin\ssh.exe    vendor\tools\
copy D:\Git\usr\bin\scp.exe    vendor\tools\
copy D:\Git\usr\bin\tar.exe    vendor\tools\
copy D:\Git\usr\bin\sha256sum.exe vendor\tools\
copy D:\Git\usr\bin\openssl.exe vendor\tools\
copy D:\Git\usr\bin\msys-*.dll vendor\tools\
```

## 完成判据（别靠目测）

```powershell
node ops\build_portable_package.mjs
```

构建器会先做 `runtimeFiles()` 预检：缺目录 → 报「从哪组装」的指引；
缺任一关键二进制（node/ssh/scp/tar/sha256sum/openssl）→ 点名缺谁并拒绝打包。
两项都过才会继续产出 `dist/portable/`。**因此这份说明的正确性是可执行的，
不是口头承诺**，这也是它作为测试替身（vendor 不入库，测试无法 import 二进制）的补偿。

## 为什么不是下载清单方案

toolchain.mjs 已把「工具在哪」收进单一解析器（vendor > 环境变量 > 本地覆盖表 >
候选探测 > PATH）。构建机与开发机共用同一份解析结果；目标机拿到的包内 `runtime/`
自足，不再访问任何外部目录。若把清单写死下载 URL，等于把网络可用性强加给
离线优先的交付场景，与本项目的隔离红线相反。
