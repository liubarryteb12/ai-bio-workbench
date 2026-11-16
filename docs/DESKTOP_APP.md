# 便携版工作台（Bioanalys Workbench）

> 形态裁定（2026-11-14）：**只有便携版**。放弃安装版（NSIS/单文件 portable 已从构建移除），整个应用就是 `D:\00.AIagent\codespace\bioworkbench` 这样一个文件夹，双击其中的 `BioanalysWorkbench.exe` 即可使用。

## 一、目录框架

```text
<便携根>\
├── BioanalysWorkbench.exe     入口，双击即用
├── venv\                      自带 Python 3.15 运行环境（含 pydantic，schema 网关真源）
├── resources\
│   ├── app\                   Electron 主进程与 preload
│   └── runtime\               只读运行时
│       ├── node\node.exe      后端运行时
│       ├── BioanalysDesktop\  server + dist（React 界面）
│       ├── BioanalysDesktop\node_modules\better-sqlite3\   单权威租约
│       ├── shared|schemas|configs|core\
│       ├── tools\{bio,reporting,dev,ops}\
│       ├── references\05.可参考生信代码\library\   图件模板资产
│       ├── platform-tools\    随包 adb.exe
│       └── app-index.json     运行时索引（带来源关系）
├── index.json                 整机引用关系索引（文件级 sha256 + relations）
└── data\                      唯一可写目录（数据跟着便携版走）
    ├── config.json            桌面设置
    ├── logs\                  后端与服务日志
    ├── raw_data\              原始数据存放目录（可在设置页改，仅限本目录树内）
    ├── workspace\projects\    项目工作区（原仓库框架原样保留）
    ├── portal\inbox\          客户提交包收件箱
    ├── .ops_state\            单权威租约库
    └── ledger\                动作台账
```

根目录只有 exe、venv、resources、index.json、data 五项，保持整洁。

## 二、构建与部署

```powershell
cd BioanalysDesktop
npm ci
npm run build            # React 界面

cd ..\desktop
npm ci
npm run dist             # stage（含 venv 构建）+ electron-builder zip
npm run verify           # 运行时完整性 + 索引新鲜度 + 真网关冒烟
npm run verify:functions # 12 项功能矩阵（内置测试数据跑通）
```

产物只有 `release\BioanalysWorkbench-<version>-win.zip` 与 `release\win-unpacked\`。部署到目标位置：

```powershell
pwsh -File tools\ops\deploy_bioworkbench.ps1
```

部署脚本完成：复制 win-unpacked、校验 venv、建 data 脚手架、生成整机 index.json、刷新桌面与开始菜单快捷方式。改了文件之后重新生成索引：

```powershell
pwsh -File desktop\scripts\reindex_portable.ps1
```

## 三、功能对齐矩阵（原项目 → 便携版）

验证脚本 `desktop/scripts/verify-functions.mjs` 用项目内置测试原始数据（`workspace/projects/PRJ_GSE316126_SANITY/data/expr_matrix.tsv`）对打包运行时真实跑通，全部判据以脚本为准：

| 原项目功能 | 便携状态 | 验证 |
|---|---|---|
| 服务健康 /api/health | 保留 | PASS |
| 五维自检 /api/selfcheck | 保留（mock 面如实标注） | PASS |
| 模块注册表 /api/workflows（54 Mod） | 保留 | PASS |
| 图件模板 92 模板 + catalog | 保留（library 资产随包） | PASS |
| 建项 /api/projects/create | 保留，schema 网关走随包 venv 真 pydantic | PASS |
| 网关负路径拒绝 | 修复后真实执行（见下） | PASS |
| 项目列表 /api/projects/list | 保留 | PASS |
| 数据导入 init/chunk/status/complete | 保留，原始文件落 raw_data 目录 | PASS |
| 任务下发 + SSE 日志 /api/tasks/* | 保留（mock 执行面） | PASS |
| 工单 create/list/queue/receipt | 保留（完整执行链由仓库门禁覆盖） | PASS |
| 门户收件箱 /api/portal/inbox | 保留 | PASS |
| 报告构建 /api/report/build | 保留，需真实算力节点，判据由 delivery_acceptance 门禁覆盖 | SKIP（无真机） |

## 四、本轮修复的真 bug

1. **建项网关从未执行**：`/api/projects/create` 在 `collectJsonBody` 返回的原始字符串上直接取字段，`body.projectId` 恒为 undefined，schema 网关块被静默跳过。已修复为先 JSON.parse 再过网关，非法 pipeline 现在被随包 venv 真网关拒绝（实测 DENY exit 2）。
2. **PowerShell 5.1 解析崩溃**：`adb_exec.ps1` 无 BOM 被 5.1 按 GBK 解析直接报错。已加 UTF-8 BOM 并强制 UTF-8 输出，干净 Windows 无 pwsh 7 也可用。
3. **路径真源**：新增 `BioanalysDesktop/server/paths.js`（assetRoot/dataRoot 分离），桌面版数据全部落 `data\`，`%APPDATA%` 不再使用。

## 五、安全与索引

- 后端只监听 `127.0.0.1:<随机端口>`，每次启动随机 Basic 口令，经 Electron login 注入。
- preload 白名单能力，无 Node/文件系统直通，外部链接进系统浏览器。
- 退出时 IPC 优雅停机 + 进程树清理，无残留 node/adb/pwsh。
- `index.json` 覆盖整机稳定文件（sha256）与来源关系（runtime-source/node-runtime/venv 等 12 类）；`npm run verify` 会重算磁盘清单比对，新增/删除未更新索引即红。

## 六、常见问题

| 现象 | 处理 |
|---|---|
| 双击无窗口 | 任务管理器查 `BioanalysWorkbench.exe`；日志在 `data\logs\` |
| 提示 SmartScreen | 未签名，点「更多信息 → 仍要运行」，或校对 SHA256SUMS |
| 数据想去别的盘 | 数据必须跟着便携目录走；仅原始数据目录可在设置页改到便携目录树内的其他位置 |
