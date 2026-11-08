# task-10 桥接四项断言进母版（m00939 边界②）实施报告

执行人：lead（亲自执行，因 teammate 名额已满）
完成时间：2026-10-21
状态：已完成。462/462 测试通过 + K40 真机首次抓到真实断言失败。

---

## 一、问题

架构评审 D1：桥接四项断言（ops/verify_bridge_checkpoint.py）此前**只有提交层**
（BioanalysDesktop/server/index.js 的 /api/tasks/submit）会调用，
58 个分析母版内部 0 调用。后果是：只要用户绕过工作台、直连 K40 跑母版，
铁律（aims §一.3「每次跨语言转换必须过断言」）立刻空转。

派发单假设「58 个母版里只有 1 个 bilingual」是错的，实测见下。

---

## 二、母版语言分布（实测，58 个母版）

判定口径与 server/task.js 完全一致：命令位的 Rscript 调用数 rCount
（正则可 /(^|[\s;&|"])Rscript(?=[\s"']|$)/）与 python3? 调用数 pCount
（/(^|[\s;&])python3?(?=[\s"']|$)/），两者都 ≥1 才是 bilingual。

| 线 | R-only | Python-only | bilingual | 合计 |
|---|---|---|---|---|
| line1_bulk | 9 | 17 | **2** | 28 |
| line2_scrna | 0 | 15 | **1** | 16 |
| line3_spatial | 0 | 14 | 0 | 14 |
| **合计** | **9** | **46** | **3** | **58** |

三个 bilingual 母版（全部已接线守卫）：

| 母版 | python3 行 | Rscript 行 | 守卫位置 |
|---|---|---|---|
| src/line1_bulk/scripts/ml_diagnostics | :61 | :536 | 首个 Rscript 前 |
| src/line1_bulk/scripts/ml_hub_analysis | :66, :203 | :118 | 首个 Rscript 前 |
| src/line2_scrna/scripts/gsva_pathways | :41, :162 | :113 | 首个 Rscript 前 |

行号是接线后的文件行号。三个母版的既有行一字未改，只在首次 Rscript 前插入守卫块。
gsva_pathways 的 python3 :162 与 Rscript :113 说明它是「先 Python 后 R」，
故守卫参数是 --from Python --to R；另两个同理（都是 Python 先 R 后）。

---

## 三、新增 src/bridge_guard.sh（LF，bash，set -euo pipefail，66 行）

### 3.1 用法

    bridge_guard.sh --input <路径> --from Python|R --to R|Python [--script <母版名>]

### 3.2 六条契约

1. 输入必须是**调用方真实持有的路径**，守卫不编造文件名；
2. 输入非 .h5ad/.rds → 打印 [BRIDGE SKIP]，exit 0（引擎只认这两种）；
3. 本机无 ssh 客户端 → [BRIDGE SKIP]，exit 0；
4. ssh 连接失败/超时（退出码非 0 且输出不含 BRIDGE FAIL）→ [BRIDGE SKIP]，exit 0
   —— K40 离线时母版仍可跑，这是可维护性红线；
5. 输出含 BRIDGE FAIL → 透传引擎退出码（至少 1），打印 [BRIDGE FAIL]；
6. 否则 [BRIDGE OK]，exit 0。

不读 BIOANALYS_SEED、不写业务文件、幂等（纯校验副作用）。

### 3.3 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| BRIDGE_ENGINE_REMOTE | /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py | 远端引擎路径 |
| BRIDGE_SSH_TARGET | k40-ubuntu | SSH 别名 |
| BRIDGE_SSH_TIMEOUT | 60 | 秒 |
| BRIDGE_SSH_CMD | ssh | **排障/接 plink/包装器；测试靠它隔离真实 ssh** |

### 3.4 关键实现细节

    output=$("$SSH_CMD" ... 2>&1) && ssh_rc=0 || ssh_rc=$?

必须分开捕获输出与退出码。**ssh 连接失败（255）与引擎断言失败（3）语义完全相反**：
前者是「校验没法做」，后者是「校验做了，没通过」。若把 255 也当断言失败，
母版会在一台离线机器上永久跑不起来。

---

## 四、三处接线

### 4.1 母版侧（最小 diff）

    # gsva_pathways，首次 Rscript 前
    BRIDGE_INPUT=""
    for _f in "${INPUTS[@]}"; do
      case "$_f" in
        *.h5ad|*.rds) BRIDGE_INPUT="$_f"; break ;;
      esac
    done
    if [ -n "$BRIDGE_INPUT" ]; then
      "$(dirname "$0")/../../bridge_guard.sh" --input "$BRIDGE_INPUT" \
          --from Python --to R --script gsva_pathways || exit $?
    fi

- 相对路径是 ../../：guard 在 src/ 根，母版在 src/<line>/scripts/。
  初版写成 ../ 是错的，已修正。
- ml_diagnostics / ml_hub_analysis 输入都是 tsv 家族（无 h5ad/rds），
  **守卫会自行 SKIP 放行**，语义正确：由守卫判定而非母版自己猜。
- 非 0 即 exit $?，透传退出码。

### 4.2 服务端判定可观测（task.js）

    const GUARD_CALL_RE = /bridge_guard\.sh/;
    // inspectBridgeNeed 返回值新增：
    guardWired: GUARD_CALL_RE.test(content)

base 对象与成功返回都加该字段；masterExists=false 时 guardWired=false。

### 4.3 提交层 warn（index.js）

    if (bridgeNeed.bilingual && !bridgeNeed.guardWired) {
      console.warn(`[bridge] ${lineId}/${requested.step} 是跨语言母版但未调用 src/bridge_guard.sh，`
        + `提交层仍会执行断言，直连 K40 跑母版则不会；请按 task-10 接线`);
    }

**只 warn 不阻断**：老母版不该因为新规突然提交失败。不变量由测试钉住。
---

## 五、测试 tests/bridge_guard_invariant.test.js（9 条，全绿）

| # | 用例 | 断言 |
|---|---|---|
| 1 | 母版全集规模 | ≥50 个（防目录被清空仍假 PASS） |
| 2 | bilingual 母版必须调守卫 | 三个全部命中 bridge_guard.sh |
| 3 | 守卫调用早于首次 Rscript | guardIdx < rIdx |
| 4 | 非 bilingual 母版不强制 | 不报错 |
| 5 | bash -n 语法 | guard 脚本可解析 |
| 6 | 引擎回 0 | guard exit 0，输出含 BRIDGE OK |
| 7 | 引擎回 3 | guard exit 3，输出含 BRIDGE FAIL |
| 8 | ssh 不可达 | guard exit 0，输出含 BRIDGE SKIP |
| 9 | 输入非 h5ad/rds | guard exit 0，输出含 SKIP |

---

## 六、真机实测：守卫第一次在真链上抓到真实断言失败

    $ bridge_guard.sh --input /mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_norm.h5ad \
        --from Python --to R --script gsva_pathways
    [BRIDGE FAIL] obsm 无 X_pca / X_umap / spatial，降维/空间坐标可能丢失
    [BRIDGE] Python -> R, file=/mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_norm.h5ad
    [BRIDGE OK] gene names: 24969, numeric < 50% (0)
    [BRIDGE OK] matrix shape: obs=4587 x var=24969, nnz=16903576, density=0.1476
    [BRIDGE OK] obs names: 4587, numeric < 80% (0), sample: ['GSM8049208', ...]
    [BRIDGE FAIL] gsva_pathways 桥接四项断言未过（Python -> R, input=...）
    exit=1

守卫正确透传 exit=1 并打印具体是**哪一项**没过（obsm 降维坐标）。
另三项（gene names / matrix shape / obs names）全部 OK 并可观测。

**这是守卫第一次在真链上抓到真实断言失败，证明不是空转。**

---

## 七、重要发现：obsm 断言与中间产物存在真实口径冲突（未替用户掩盖）

上面那次 FAIL 的根因：scrna_norm.h5ad 是 line2 步骤 3（归一化）的产物，
**它本来就不该有 X_pca/X_umap/spatial**——那些是步骤 5+（scVI/降维/空间配准）
才写入的。但引擎的 obsm 项无条件要求至少一个降维键存在。

后果：**如果 gsva_pathways 真的拿 scrna_norm.h5ad 作为 Rscript 输入跑，
守卫会拦下它。**这是真实的口径冲突，两种解法都不该由我替用户选：

- **A. 改引擎**：obsm 项改为「有 X_pca 或 X_umap 或 spatial 之一则 PASS，
  三者全无时看是否有 obsm 其它键，仍无则 WARN 而非 FAIL」
  ——承认中间产物合法，只对「声称做过降维但没坐标」判死；
- **B. 改母版输入选择**：gsva_pathways 应挑选带降维坐标的 .h5ad
  （如步骤 5 的输出）作为桥接输入，而不是归一化产物。

我选了**先如实上报、不动引擎也不改母版**，因为：
1. 改引擎会放松铁律，属于规格裁定，超出本次「把断言接进母版」的授权范围；
2. 改母版输入会改变分析行为，需要知道 gsva_pathways 真实语义的是数据分析方。

此项已列为待用户裁定项，见 handoff。

---

## 八、踩坑清单（复用价值高）

### 8.1 Windows 宿主无 bash
- wsl.exe -e bash 报「适用于 Linux 的 Windows 子系统」安装提示 → WSL 无发行版；
- git-bash 可用：D:\Git\bin\bash.exe 与 D:\Git\usr\bin\bash.exe；
- 测试用 findBash() 按 BRIDGE_GUARD_BASH → D:\Git\bin\bash.exe
  → D:\Git\usr\bin\bash.exe → bash 顺序探测，**找不到则相关用例 skip，
  不假 PASS**。

### 8.2 git-bash 会重置 PATH，PATH 注入垫片不可靠
实测把 shim 目录放 PATH 最前，type -a ssh 仍只列
/usr/bin/ssh 与 /bin/ssh——/etc/profile 把 /mingw64/bin:/usr/bin prepend 了。
**解决方案是给 guard 加 BRIDGE_SSH_CMD 环境变量覆盖**，测试用绝对路径指向垫片，
而不是改 PATH。这个变量同时服务排障和接 plink。

### 8.3 母版注释污染 bilingual 判定（真实缺陷）
task.js 的语言正则在**所有行**上计数，包括注释。初版接线后测试报：
guardIdx 531 > rIdx 522——但 522 行其实是注释里写的 Rscript。

解决：把三个母版注释中的 python /Rscript 改写为 Python /R 侧执行
（大写 P 不匹配 PYTHON_CALL_RE）。

**遗留边界**：正确的修法是让 inspectBridgeNeed 跳过注释行
（行首 #）再计数。本轮未做，因为改动判定口径会影响 58 个母版的分类结果，
需要与 S28 的报告口径一并复核。已在 handoff 记为待办。

### 8.4 require 在 ESM 里不可用
tests/bridge_guard_invariant.test.js 最初用 require('os').tmpdir() 报错，
改为 import。

---

## 九、相关锚点

- src/bridge_guard.sh（新增）
- src/line1_bulk/scripts/ml_diagnostics 首个 Rscript 前
- src/line1_bulk/scripts/ml_hub_analysis 首个 Rscript 前
- src/line2_scrna/scripts/gsva_pathways 首个 Rscript 前
- BioanalysDesktop/server/task.js:43 GUARD_CALL_RE
- BioanalysDesktop/server/task.js:72 guardWired 判定
- BioanalysDesktop/server/index.js:1504-1510 提交层 warn
- BioanalysDesktop/tests/bridge_guard_invariant.test.js（新增，9 条）
- /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py（远端引擎，本轮未改）

---

## 十、测试基线

   全量 npm test → tests 462 / pass 462 / fail 0 / duration 3914ms
   （基线 453 + 本切片新增 9）
   node --check server/index.js  exit 0
   node --check server/task.js    exit 0
   python ops/build_client_report.py --self-test → 41/41 PASS（无关回归确认）
