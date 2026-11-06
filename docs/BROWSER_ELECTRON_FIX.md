# 内置浏览器 Electron 内核修复记录（2026-11-06）

## 症状

调用 `dsh_browser_open` / `dsh_browser_screenshot` 等浏览器工具时报：

```
browser provider(s) electron are registered but report themselves unavailable
— for dsh-builtin-browser this means no spawnable Electron binary was found;
run `npx install-electron` in the active profile or set ELECTRON_PATH
```

## 根因

不是「没装 Electron 包」，而是**包装了但二进制缺失**。

| 位置 | 状态 |
|---|---|
| `~/.dsh/profiles/desktop/node_modules/electron` | 包在（`44.10.1`），`dist/` 有 72 个文件 132.7 MB，**但 `dist/electron.exe` 缺失** |
| `~/.dsh/dsh-builtin-browser-host/` | 只有 `history.jsonl`，无内核 |

即解压中断留下的半成品：依赖树里的附属文件都在，唯独 234 MB 的主可执行文件没落地。
这解释了为什么「插件装了、包也在」却仍报找不到可启动内核。

## 为什么不能直接用 DSH 外壳的 exe

`D:\00.AIagent\Dsharness\DeepSeek Harness.exe` 确实是 Electron 二进制，
但它是**打包应用**（旁边有 `resources/app.asar`）。打包应用会忽略脚本参数、
直接启动外壳自身，表现为 `browser host exited (code=0)`。
插件 CHANGELOG 第十二轮（issue #6）专门修过这个误判，并用 `isBareElectron()` 排除打包 exe。

插件要的是**裸 Electron**：有 `resources/` 目录，但里面**没有** `app.asar` 或 `app/`。

## 修复

在 DSH 安装树内建一份独立的裸 Electron，通过目录联接接进 profile。

1. 建 `D:\00.AIagent\Dsharness\browser-electron\`，只声明 `electron@44.10.1` 依赖
2. `npm install`（装包但不含二进制）
3. `ELECTRON_RUN_AS_NODE=1 node node_modules/electron/install.js` 触发下载（234.4 MB）
4. 把 profile 里残缺的 `dist` 改名为 `dist.incomplete-<时间戳>` 留档
5. `New-Item -ItemType Junction` 把 profile 的 `dist` 指向本目录的 `dist`

细节与重建步骤见 `D:\00.AIagent\Dsharness\browser-electron\README.md`。

## 为什么用目录联接而不是复制或环境变量

| 方案 | 问题 |
|---|---|
| 把 exe 复制进 profile | 多占 234 MB，且两份会各自漂移 |
| 设 `ELECTRON_PATH` 环境变量 | 环境变量对**已在运行**的进程无效，必须重启 DSH 才生效；而本会话就跑在 DSH 里，重启会中断工作 |
| 目录联接 `dist` → Dsharness | 磁盘只有一份内核；插件 bundled 探测在 depth=4 命中，30 秒探测冷却后自动接上，**无需重启** |

## 验证证据

| 项 | 结果 |
|---|---|
| 探测等价性（复刻插件 `bundledElectronBinary()`） | `RESOLVED=...\electron\dist\electron.exe`，`EXE_SIZE_MB=234.4`，`is_bare_electron=true` |
| `resources` 内容 | 只有 `default_app.asar`（无 `app.asar`、无 `app/`），符合裸 Electron 判据 |
| 版本一致性 | profile 包 `44.10.1` 与 `dist/version` 的 `44.10.1` 相同 |
| 真实调用 | `dsh_browser_open` 打开本地 HTTP 报告，返回正确 `title` |
| 截图能力 | `dsh_browser_screenshot` 正常出图，用于目视核对报告排版 |

## 顺带发现并修掉的两个报告缺陷

浏览器修好后第一次真正「看」报告，立刻暴露两处结构性校验查不出的问题：

1. **基因数标错**：KPI 里「基因数 10」实际取的是 marker 表的列数。
   改为从 `domains_report.txt` 的 `spots=N genes=M` 解析，真实值 **21318**。
   同时 spot 数改用报告口径 **12097**（QC 前 12099，过滤掉 2 个）。
2. **「细胞类型反卷积」措辞误导**：`primary_celltype` 的值是 `D1-D7_d2` 这类**域编号**，
   不是细胞类型名。查母版 `celltype_annotation` 第 256 行，它自己写明
   `signature_note=A 是域 marker 自签名，不是外部细胞类型参考表达谱`。
   即设计上就是「域签名近似」，报告原先的措辞把它说成了细胞类型注释。
   已改为「域签名反卷积（自签名近似）」并在正文加口径澄清。

第 2 条同时暴露一个可改进点：`signature_note` 目前只打印到 stdout，
没有落盘成 `celltype_report.txt`，事后无法从产物里读到这条关键声明。

## 残留可清理项

`~/.dsh/profiles/desktop/node_modules/electron/dist.incomplete-20261106-110013`
是被替换下来的残缺 dist（72 文件 / 132.7 MB）。确认新内核稳定后可删除。
