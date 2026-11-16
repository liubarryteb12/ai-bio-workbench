# 第三方组件声明（桌面版）

本目录的桌面壳随包分发以下运行时组件。逐项许可以各组件自带 LICENSE 为准。

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| Electron | 45.3.1 | MIT | 桌面窗口与 Chromium 运行时 |
| Node.js | 24.19.0 | MIT | 随包后端运行时 |
| better-sqlite3 | 13.0.3 | MIT | 单权威租约 SQLite |
| Android platform-tools | 随构建机 | Android SDK 条款，随包含 NOTICE.txt | ADB 单通道 |
| React | 18.3.1 | MIT | 前端界面 |
| Uppy | 6.x | MIT | 分片上传 |

Python 与 Pydantic 仅在构建时显式提供 `BIO_DESKTOP_PYTHON_DIR` 或 `BIO_DESKTOP_PYTHON_EXE` 时随包，许可分别为 PSF 与 MIT。

构建前请按 `LICENSES.md` 与各组件 LICENSE 复核。对外交付前建议执行一次许可审计。
