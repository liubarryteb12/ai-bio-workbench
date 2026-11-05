# 参考代码与生信代码整理台账（2026-11-06）

> 触发：用户要求「把没有用的无效的生信代码（R/Python）与参考代码单独整理出去」。
> 原则：先取证再动手，只做**可逆**动作（移入归档区，不物理删除），每一笔留哈希与去向。
> 基线：HEAD `1fd1cb3`（B1 溯源门禁收口）。B1 证明「按名字信人」会漏审，本轮同法用于整理。

## 一、判定口径（机器可复现）

| 类别 | 判据 | 处置 |
|---|---|---|
| 嵌套版本库 | reference/ 下出现 `.git` 目录（第三方仓库内嵌） | 移入 `_archive/nested_git_20261106/` |
| 未声明母版 | `src/<line>/scripts/*` 不在 `workflows.json` 的 `series[].stages[].mods[].script` | 逐份甄别，有效则补声明，无效才归档 |
| 重复副本 | 与 `src/` 真源 sha256 完全相同 | 归档并登记来源 |
| 参考资产 | `reference/09.待整理/` 与主力区无同哈希重叠 | 保留（是独有内容，非重复） |

## 二、本轮实际执行

### 2.1 已归档：5 个嵌套 .git（1583 文件 / 12.65 MB）

| 原路径 | 去向 | 文件数 | 体积 |
|---|---|---|---|
| `reference/00a.可参考代码库/geo-normal-pipeline-skill/.git` | `_archive/nested_git_20261106/` | 276 | 1.87 MB |
| `reference/00a.可参考代码库/scrna-pipeline-skill/.git` | 同上 | 954 | 4.83 MB |
| `reference/00a.可参考代码库/spatial-pipeline-skill/.git` | 同上 | 280 | 2.16 MB |
| `reference/01.工程规范/mattpocock-skills/.git` | 同上 | 29 | 0.36 MB |
| `reference/05.可参考出图代码/FigureYa_CodeMap/repo/.git` | 同上 | 44 | 3.43 MB |

判定依据：这些是上游第三方仓库的完整版本库，被整体拷进参考区；
`git ls-files` 实测跟踪数为 **0**（reference 除 `05` 外全在 .gitignore），
它们对主仓无任何版本关系，只制造「嵌套仓库」告警与全仓文本搜索噪音。
归档后实测 `reference/` 下剩余嵌套 .git = **0**。

### 2.2 甄别后判定为「有效，不整理」的项

| 项 | 证据 | 结论 |
|---|---|---|
| `src/line1_bulk/scripts/probe_env` | 唯一未被 workflows.json 声明的母版；`src/line1_bulk/README.md:75` 明确写「环境自检冒烟脚本（S0 部署通道验证桩），不计入线内步骤」；`BioanalysDesktop/tests/deploy_and_parity_guard.test.js:114` 断言部署豁免必须含它 | **有效**，保留。它不是死代码，是部署通道的验证桩 |
| `reference/09.待整理/`（259 文件 / 234.3 MB） | 与 `00a`、`05` 的 sha256 逐一比对：同哈希重复 = **0**，全部为独有内容 | **有效**，保留。按 `docs/directories.md` 它是约定待整理区，内容不与主力区重复 |
| `reference/05.可参考出图代码/FigureYa_CodeMap`（2105 文件 / 14.1 MB） | 是上游出图代码地图；`library/` 被 10 处代码引用 | **有效**，保留（仅其内嵌 .git 已归档） |
| `reference/05.可参考出图代码/图码对应库_交付包`（230 文件 / 62.7 MB） | 有 1 处引用 | **有效**，保留 |
| `cn_debug/`（366 文件） | 260 个已被 git 跟踪，是取证留痕区 | **有效**，保留 |

### 2.3 未做物理删除的理由

用户要「整理出去」，不是「删掉」。所有动作都是 `Move-Item` 到 `_archive/`：
可逆、可回溯、不破坏任何既有引用。真删需单独授权，且要先跑全量门禁证明零引用。

## 三、复现命令

```powershell
# 复现嵌套 .git 探测（期望 0）
node .tmp/probe_nested_git.mjs

# 复现孤儿母版探测（期望只剩 probe_env，且它是 A 级有效桩）
node .tmp/probe_dead2.mjs

# 复现参考区重复副本探测（期望同哈希重复 = 0）
node .tmp/probe_ref_dup.mjs
```

## 四、后续（不再本轮扩面）

- `reference/09.待整理/` 的 234 MB 是否清出，需用户单独裁定（它不与主仓重复，删了不可逆）。
- `FigureYa_CodeMap` 的 2105 文件是否保留全量，需按「实际被引用到的图型」二次甄别后再定。
