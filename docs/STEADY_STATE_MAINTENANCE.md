# 稳态维护例行（2026-11-16，Gemini 联合裁定版）

> 定位：纯 web 形态单人稳态维护。本文件是操作手册，不是门禁：所有命令可手动跑，
> 例行脚本只串既有工具，新增门禁为零。裁定记录见会话与 Gemini 往返（Argon）。

## 裁定摘要（Gemini 决策 + 执行者交集）

| 裁定项 | 结论 |
|---|---|
| 测试资产 | 2566 用例全部保留，不删不冰封。日常 `--skip-tests` 快检，每周全量一次 |
| 触发规则 | 触碰状态机/队列租约/`run_throttled_task.sh` 的修改，提交前跑对应模块单测子集 |
| 门禁 | 29 道全保留；变异反证在改动关键防线后手动跑 |
| 台账 | 五类 JSONL 全保留（追加式），REJ 台账照旧 |
| 脱敏契约 | 保留机器强制（商业红线，3 秒成本） |
| Pi CLI 双检查点 | 保留（fail-closed 安全面，绕过成本大于收益） |
| SQLite 租约 | 保留（双进程撑爆内存的保命底线） |
| 磁盘卫生 | 一次性清理 + 每周例行纳入 |
| 环境快照 | 算力端 pip freeze + R sessionInfo 双侧归档 |
| 黄金冒烟 | 每周例行可选开关（设备在线才跑，离线打印提示跳过） |

## 每日 / 开工前（10 秒）

```bash
pwsh -File tools/ops/bio_check.ps1
```

检查项：D 盘余量、`.tmp` 体积、残留 node/python 进程、git 工作区状态。
任何一项异常先排障再开工。

## 每周（2 分钟 + 可选冒烟）

```bash
pwsh -File tools/ops/bio_clean.ps1
```

动作：`clean_workspace.mjs` 清测试残留 → 便携库 VACUUM（若存在 db）→
台账超 50MB gzip 归档 → 全量测试提醒（手动跑 `npm run gate:all`）→
黄金冒烟开关（`-WithSmoke`，设备在线才跑 `node tools/dev/smoke_golden.mjs`）。

## 环境/每周全量测试

```bash
cd BioanalysDesktop && npm run gate:all
```

约 3~4 分钟含全量测试；只验证不修复，红了按门禁输出排障。

## 五个停手信号（出现即停止投递新工单）

1. **OOM 痕迹**：`dmesg -T | grep -i oom` 有记录，或设备反复重启。内存泄漏或数据超 6.5GB 任务上限，先看 `system_logs/<task_id>.log` 的 RLIMIT 行。
2. **同一工单断点重跑连续失败 2 次**（非网络原因）：上游数据格式静默变异，人工看原始表头。
3. **黄金基线统计数值漂移**（log2FC/padj 第 4 位以后变化）：种子失效或包被升级，立即回滚环境，golden expected 用 `--bless` 前必须先解释漂移原因。
4. **磁盘写入明显变慢或 D 盘余量 < 10GB**：UFS 写放大，先清 `.tmp` 与结项工单中间矩阵。
5. **SQLite 频繁 SQLITE_BUSY 且无运行中子进程**：租约释放死锁，检查进程退出钩子，手动清僵尸锁前先备份 db。

## 环境快照（每季度或环境变更后）

- Python：算力端 `/root/venvs/bio-py/bin/pip freeze`，连同三线声明 `envs/<line>/manifest.txt` 的依赖锚点，导出存 `docs/generated/env_snapshot_py.txt`
- R：算力端走生产线垫片 `/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript`（注入 `R_LIBS_USER` 指向 site-library；裸调 `/opt/R/4.5.3/bin/Rscript` 看不到分析包），导出存 `docs/generated/env_snapshot_r.txt`
- Node：`BioanalysDesktop/package-lock.json` 已在版本库，无需额外动作
