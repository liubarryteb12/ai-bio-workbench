# S33 切片报告：桥接守卫本机化 + 自检第 4 维合并 + ssh 严格化

- 日期：2026-10-21
- 执行者：Lead（自办，非子代理切片）
- 关联条款：aims §一.2 铁律 3（双保险机制）、§三.3 第 4 维（跨线隔离/桥接/版本一致性灯）
- 关联裁定：con_hf/SPEC_DECISIONS.md D-14 / D-15 / D-16
- 关联坑：con_hf/pitfalls_ledger.md P-15 / P-16 / P-17 / P-18
- 涉及文件：`src/bridge_guard.sh`、`ops/verify_bridge_checkpoint.py`、
  `BioanalysDesktop/server/{selfcheck.js,proc.js,index.js}`、`aims/aims.txt`、
  `BioanalysDesktop/tests/{selfcheck_isolation_merge,bridge_guard_local,bridge_stage}.test.js`

## 一、为什么做（三个真机缺陷）

1. **守卫在真实主路径上恒空转（P-15 / D-14）**。母版 `gsva_pathways` 跑在计算容器内，
   守卫却按老设计 `ssh k40-ubuntu` 回宿主。容器里 `k40-ubuntu` 不可解析
   （`ssh: Could not resolve hostname k40-ubuntu`，退出码 255），守卫走 SKIP 分支放行。
   即：四项跨语言断言在 2026-10-21 之前的每一次真机运行里都没生效过。
2. **自检假绿灯（P-16 / D-15）**。`server/index.js` 的 `runRemote` 只拼接 stdout+stderr，
   丢弃 ssh 退出码。链路断时输出为空 → 第 1 维 `fsType=''` 不含 `fuse` 判 pass、
   第 2 维 `usedPct` 取 0 → `freePct=100` 判 pass。断链反而全绿。
3. **引擎崩溃被当成"不可达"（P-17 / D-16）**。真机给守卫喂坏文件
   （`printf notah5ad > /tmp/bad.h5ad`），引擎抛 `OSError: Unable to synchronously open file
   (file signature not found)` 裸 traceback，守卫按"引擎不可达"降级 SKIP，坏输入被静默放行。

## 二、怎么改（三处，最小改动）

### 1. 守卫引擎解析：本机优先、ssh 兜底（D-14）
`src/bridge_guard.sh` 新增 `BRIDGE_ENGINE_LOCAL`（默认
`/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py`，显式置空可强制走 ssh），
MODE 判定顺序：本机引擎文件存在且 `python3` 可用 → `local`；否则 `command -v ssh` 可用 → `ssh`；
都不行 → SKIP。OK 文案带 `engine=local|ssh`，失败文案带 `（$MODE 模式退出码 $rc）`。

### 2. 契约 3c：本机模式引擎非 0 即 FAIL（D-16）
`ssh_rc != 0` 分支先判 `[ "$MODE" = "local" ]` → 打印
`[BRIDGE FAIL] $WHERE 桥接引擎异常退出（local 模式退出码 $ssh_rc），见上方引擎输出` 并透传退出码；
只有 ssh 不可达（255/超时）才维持 SKIP 放行。理由写进脚本注释，附 2026-10-21 `/tmp/bad.h5ad` 事故。

### 3. 引擎自身：不可读输入 = 断言失败
`ops/verify_bridge_checkpoint.py`：新增 `os.path.exists` 前置检查（`输入文件不存在: %s`）；
h5ad/rds 校验分支包 `try/except SystemExit: raise / except Exception: fail("引擎无法校验输入（%s: %s）")`；
模块级把 stdout/stderr 都 `reconfigure(encoding="utf-8")`（P-18：Windows 控制台 cp936 会把中文打成乱码，
断言 grep 不到）。

### 4. 自检 ssh 严格化 + 第 4 维合并报灯（D-15）
`server/proc.js` 新增 `runSshRaw`（返回 `{code, text}`，逐行滤 `Warning: Permanently added`）与
`runSshStrict`（code!==0 抛 `远端命令退出码 N`；输出空抛"远端命令无输出"）。
`server/index.js` 第 1~4 维全部改走 `runRemoteStrict`，`runRemote`（宽松）只留给靠
`|| true` / MISSING 兜底的调用点。
`server/selfcheck.js` 新增 `STATUS_SEVERITY` / `worstStatus` / `mergeIsolationChecks`：
隔离门禁与 SHA256 比对各自出状态，**取最坏合并成一盏灯**（fail > warn > unknown > pass），
`detail` 点名坏在隔离还是版本漂移。不做成两盏灯的理由：aims §三.3 第 4 维原文就是三件事共用一盏灯。

## 三、验证

### 单测（659/659 全绿，约 30s）
- 新建 `tests/selfcheck_isolation_merge.test.js` 16 条：worstStatus 四档 + 未知状态名；
  mergeIsolationChecks 六种组合（value 用 ` | ` 拼接、detail 用「；」连接、全 pass 固定文案）；
  runSshRaw 滤 Warning 且保留退出码；runSshStrict 三种抛错；index.js 静态断言
  （runRemoteStrict ≥5 处、第 1~4 维四条具体调用、禁 `runRemote(buildIsolationCommand())`、五维 id 齐全）。
- `tests/bridge_guard_local.test.js` 6 → 7 条：本机引擎崩溃由"降级 SKIP"改成"必须 FAIL"，
  新增 ssh 分支 255 仍 SKIP 用例。
- `tests/bridge_stage.test.js` 11 → 13 条：损坏 h5ad、输入文件不存在两条真跑。

### 真机（算力节点 / Ubuntu 容器）
1. `ops/sync_and_verify_remote.ps1 -All`：76 个文件，**76/76 哈希一致**，镜像 `ops/bridge_guard.sh` 1/1 一致，exit 0。
2. gsva 母版真跑：`EXIT=0`，日志出现
   `[BRIDGE] Python -> R, file=.../scrna_norm.h5ad, stage=pre-dimred`、三条 `[BRIDGE OK]`
   （24969 基因 / 4587×24969 nnz=16903576 / 4587 细胞）、`[BRIDGE WARN] obsm 无 X_pca...（stage=pre-dimred）`、
   `[BRIDGE PASS] all 4 assertions passed`、`[BRIDGE OK] ... engine=local`、`gsva_pathways_done pathways=7174`。
   **engine=local 证明守卫不再空转。**
3. 守卫失败路径：`/tmp/bad.h5ad` → `[BRIDGE FAIL] 引擎无法校验输入（OSError: ...）` + 守卫 exit 1。

## 四、遗留

1. line1 全链真机 exit 0 尚未跑全（M1 DoD 剩余项），且 STRING 离线文件在 算力节点 上还不存在
   （已把预下载命令写进 `ops/README.md`）。
2. `inspectBridgeNeed` 的 `guardWired` 判定仍按原文匹配，注释里提到 `bridge_guard.sh` 会假阳性（P3 遗留）。
3. `mergeIsolationChecks` 的 value 是字符串拼接（`4/4 一致 | 三线均隔离`），前端未做结构化展示；
   目前够用，若将来要画子灯需改成数组。
