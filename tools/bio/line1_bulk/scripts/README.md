# scripts/ 与 checkpoint/ 说明

## 目录约定（2026-10-13 定，S0 部署通道）

本目录放线内分析步骤脚本。**每个文件即一个可执行步骤**，部署后 step 名 = 文件名。

约定：

1. **一个文件一个步骤**：文件名就是 TaskPanel 里"步骤名"填的值（只能用字母数字与 `. _ -`，
   提交接口按此校验），参数通过 `--input` / `--output` / `--seed` 传入
   （任务引擎 `buildTaskScript` 会拼好，seed 同时注入环境变量 `BIOANALYS_SEED`）。
2. **必须带 shebang 且可执行**：`#!/usr/bin/env bash`（包装 R/Python）或直接
   `#!/usr/bin/env Rscript` / `#!/usr/bin/env python3`。部署通道会 `chmod 755`，
   但本地也建议置可执行位，保持一致。
3. **工作目录是 `<line>/processed/`**：任务引擎 `cd` 到那里再执行，脚本里用相对路径
   读写中间产物，或用 `--input` / `--output` 传绝对路径。
4. **只能用本线 line_id**：不得出现另外两条线的字面量（提交前审计强制，
   `ops/02_check_isolation.ps1` 也会在本地侧校验）。
5. 桥上检查点脚本命名 `checkpoint_*.R` / `checkpoint_*.py`，放 `checkpoint/`，
   必须校验四项：基因名、矩阵方向、细胞名/样本名、embedding（若有）。
6. 注释只解释"为什么"，不用 em dash，变量不用单字母。

## 部署

```powershell
pwsh -File ops/06_deploy_scripts.ps1              # 三线全量部署
pwsh -File ops/06_deploy_scripts.ps1 -Line line1_bulk   # 只部署一条线
pwsh -File ops/06_deploy_scripts.ps1 -Force       # 覆盖服务器上同名文件
```

部署目标：服务器 `/mnt/ssd/bio_data/bin/<line>/`（全局一份，任务引擎已把该目录注入 PATH）。
本地改脚本后必须重新部署才在服务器生效；字节校验与同名拒绝逻辑同 `ops/05_push_testdata.ps1`。
