# P3 报告：inspectBridgeNeed 去注释判定（stripShellAndCodeComments）

- 切片：P3（todo 2.1，aims §三.2「提交三道闸 / 去注释桥接识别」）
- 项目根：`D:\00.AIagent\codespace\AI辅助生信分析流程工作台`
- 完成时间：2026-10-21
- 结论：`server/task.js` 新增导出纯函数 `stripShellAndCodeComments`，`inspectBridgeNeed` 的 R/Python 计数改用剥离注释后的文本；新增 15 条测试全绿；`tests/bridge_guard_invariant.test.js` 9/9 仍绿（未改它一个字）；全量 `npm test` 518 条，516 通过，2 条失败均为 Lead 已知落点缺失（与本切片无关）。

## 1. 任务理解

现状问题：`inspectBridgeNeed` 读母版全文，按行跑 `RSCRIPT_CALL_RE` / `PYTHON_CALL_RE` 计数，注释里出现 "Rscript" / "python3" 字样会被当成真调用，把单语言母版误判成 bilingual，进而强行触发桥接四项断言。上一轮实测踩到：ml_diagnostics 的注释导致守卫行号大于 Rscript 行号、测试假失败，当时只能改注释绕过（治标）。

要求：

1. `server/task.js` 新增导出纯函数 `stripShellAndCodeComments(src)`：剥离整行注释（行首可选空白后 `#` 起，`#!` shebang 行必须保留）与引号外的行尾注释（引号内 `#` 不算注释，单双引号都算；转义 `\#` 不算注释）。纯函数、零依赖、不改换行。
2. `inspectBridgeNeed` 的 `rCount` / `pCount` 改用剥离后的文本；返回值结构、`guardWired` 字段、`masterExists` 语义全部不变。
3. 既有 bilingual 集合不变：58 个母版中恰为 `line1_bulk/ml_diagnostics`、`line1_bulk/ml_hub_analysis`、`line2_scrna/gsva_pathways`。
4. 新增 `tests/task_comment_strip.test.js` >=10 条。
5. 禁改 `server/index.js`、`src/**`、`aims/**`、其他既有 tests。

## 2. 改动清单

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `BioanalysDesktop/server/task.js` | `:45-93` | 新增 `export function stripShellAndCodeComments(rawText)`（`:62`）与私有 `stripLineComments(line)`（`:73`），含规则注释 |
| `BioanalysDesktop/server/task.js` | `:114-119` | `inspectBridgeNeed` 计数改用 `stripShellAndCodeComments(content)` 后再切行；新增一行注释说明口径 |
| `BioanalysDesktop/tests/task_comment_strip.test.js` | 新文件，约 190 行 | 15 条测试（语义边界 7 条 + 真实踩坑 2 条 + 母版全集回归 6 条） |
| `con_hf/dispatch/P3_comment_strip_report.md` | 新文件 | 本报告 |

未改动：`server/index.js`、`src/**`、`aims/**`、`tests/bridge_guard_invariant.test.js`、`tests/task.test.js` 及其他既有测试。无新增依赖，无调试残留（探针用 `node -e` 一次性执行，未落盘）。

### 2.1 实现要点（`server/task.js:45-93`）

```js
export function stripShellAndCodeComments(rawText) {
  const text = String(rawText ?? '');
  // split 捕获分隔符：偶数位是行内容，奇数位是原始换行符（\n 或 \r\n），join 回去换行不变
  const parts = text.split(/(\r?\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = stripLineComments(parts[i]);
  }
  return parts.join('');
}
```

单行判定按字符扫描维护引号状态：

1. 行首（`trimStart` 后）是 `#!` 的行原样返回（shebang 保留）。
2. 引号内：反斜杠转义下一字符；遇到匹配引号才退出引号态。单引号、双引号都算。
3. 引号外：反斜杠转义下一字符（`\#` 不当注释）。
4. 引号外遇到 `#`，仅当前一字符是行首、空白或 `;&|()` 之一时才算注释起点（shell 里只有词首的 `#` 起注释），否则保留为字面量：`$#`、`${var#prefix}`、`a#b` 都不被误伤。
5. 整行注释返回空串（保留行数）；行尾注释返回 `line.slice(0, i)` 去掉尾部空白，代码字节不变。

与 todo 2.1 示例代码的差异（有意为之）：示例用 `trimmed.startsWith('#')` 加 `line.replace(/\s+#.*$/,'')`，会（a）把 `echo "a # b"` 的引号内容切断、（b）把 `while [ $# -gt 0 ]` 截成 `while [ $`。仓库 `src/` 下 `$#` 出现在 56 行母版里，因此按派发单要求实现了引号感知与词首判定，示例仅作参考。

## 3. 行为变化

- `inspectBridgeNeed` 的 `rCount` / `pCount`：由"对全文行匹配"改为"对剥离注释后的行匹配"。
- 返回值结构（7 个字段）、`bilingual = rCount >= 1 && pCount >= 1` 判据、`masterExists` 语义、`guardWired` 口径（仍用原文 `GUARD_CALL_RE.test(content)`）全部不变。
- 对当前仓库 58 个母版：剥离前后 R/Python 计数完全一致（`diff=0`），bilingual 集合仍是那 3 个，因此**现网行为零变化**；变化只体现在"注释里出现 python3/Rscript 的母版不再被误判为 bilingual"这一类修复前会误触发桥接断言的场景。
- `tests/bridge_guard_invariant.test.js` 独立维护 raw 计数正则，不依赖本实现，仍 9/9 通过。

## 4. 测试与验证记录

### 4.1 新增测试 `tests/task_comment_strip.test.js`：15 条

语义边界（7）：

1. 整行注释（含缩进 / 制表符）清空，行数与空行不变
2. 行尾注释剥离，注释前代码逐字节不变；`x=1#没有空格` 视为字面量保留
3. 引号内 `#` 保留（单引号、双引号、引号后接真注释、双引号内含 `'`）
4. shebang 行原样保留（含非首行的 `#!`）
5. 转义 `\#`、`$#`、`${p#prefix}` 保留
6. 换行符原样保留（CRLF 不改成 LF，LF 场景同样验证）
7. 空输入安全（`''` / `undefined` / `null` 都返回 `''`）

真实踩坑样例（2）：

8. 注释里只出现 `python3` / `Rscript` 的合成脚本：剥离后 `rCount=0`、`pCount=0`
9. 真实母版 `src/line1_bulk/scripts/ml_diagnostics`：原文计数 R1/P1；在头部插入历史踩坑注释（含 `python3` 与 `Rscript` 字样）后计数不变，`inspectBridgeNeed` 仍 `bilingual=true`

母版全集回归（6）：

10. 母版全集规模稳定：`masters.length === 58`
11. 全仓 58 个母版 strip 前后 R/Python 计数完全一致（证明去注释没误删真调用、也没漏剥注释）
12. strip 后 bilingual 集合恰为 `line1_bulk/ml_diagnostics`、`line1_bulk/ml_hub_analysis`、`line2_scrna/gsva_pathways`
13. `inspectBridgeNeed` 对三个 bilingual 母版判 true，对 `line1_bulk/prep_matrix`、`line1_bulk/qc_matrix`、`line2_scrna/scrna_qc` 判 false
14. strip 不改变非注释代码字节（每行都是原行前缀）且幂等（`strip(strip(x)) === strip(x)`），对全部 58 个母版逐行验证
15. `inspectBridgeNeed` 返回值仍是 7 个字段，母版缺失时 `masterExists=false`、计数 0、reason 含「母版不存在」

### 4.2 命令与输出摘要（真实执行）

```
$ cd BioanalysDesktop; node --check server/task.js
CHECK_EXIT=0
$ cd BioanalysDesktop; node --check tests/task_comment_strip.test.js
TESTCHECK_EXIT=0

$ cd BioanalysDesktop; node --test tests/task_comment_strip.test.js
✔ P3: 整行注释（含缩进）清空，行数与空行保持不变
... (15 条全部 ✔)
ℹ tests 15
ℹ pass 15
ℹ fail 0
exit 0

$ cd BioanalysDesktop; node --test tests/bridge_guard_invariant.test.js
✔ 引擎返回 0 → 守卫 0 且含 BRIDGE OK
✔ 引擎断言失败（3）→ 守卫透传同码且含 BRIDGE FAIL
✔ ssh 不可达 → 守卫 0 且含 BRIDGE SKIP（算力节点 离线母版仍可跑）
✔ 输入非 h5ad/rds → 守卫 0 且 SKIP（不编造可校验对象）
ℹ tests 9
ℹ pass 9
ℹ fail 0
exit 0

$ cd BioanalysDesktop; npm test
✖ §九 表里点名的每个路径都真实存在（落点没被改名或删除）
✖ §八 五本台账的物理落点全部存在（新章不能只是文字）
ℹ tests 518
ℹ pass 516
ℹ fail 2
exit 1
```

两条失败均为 Lead 已知落点缺失，与本切片无关：

- `tests/aims_drift_guard.test.js:179` 失败原因：`§八 点名的台账不存在：con_hf/SPEC_DECISIONS.md`
- 同文件 `§九` 失败原因：`'**§六 防崩与同步** -> ops/sync_and_verify_remote.ps1'` 仍缺失

### 4.3 全集计数对照（一次性探针，未落盘）

```
masters=58
rawBilingual=3
  raw line1_bulk/ml_diagnostics r1 p1
  raw line1_bulk/ml_hub_analysis r1 p2
  raw line2_scrna/gsva_pathways r1 p2
stripBilingual=3
  strip line1_bulk/ml_diagnostics r1 p1
  strip line1_bulk/ml_hub_analysis r1 p2
  strip line2_scrna/gsva_pathways r1 p2
diff=0
```

`diff` 的判据同时包含：raw 与 strip 的 bilingual 布尔、strip 布尔与 `inspectBridgeNeed().bilingual`、以及 `rCount`/`pCount` 三向一致，58 个母版无一例外。

## 5. 遗留风险

1. `guardWired` 仍按原文判定（`GUARD_CALL_RE.test(content)`）。若某母版只在注释里写 `bridge_guard.sh`，会得到 `guardWired=true` 的假阳性。本次按派发单要求"保持不变"，未收紧；若要收紧需同时调整 `bridge_guard_invariant.test.js` 的口径，属另一片。
2. 词中 `#` 保守保留（如 `x=1#c`，R/Python 里其实是注释）。若此类行尾紧贴注释里写了 `python3`，仍会残留一次误判。当前 58 个母版 strip 前后计数完全一致，说明现网不存在这种形态；这是"宁可漏剥、不可误删代码"的取舍。
3. 不解析 heredoc 边界：shell 主脚本与内嵌 R/Python heredoc 统一按"引号 + 词首 `#`"处理。对 R/Python 而言词首规则偏保守（漏剥），不会误删代码。
4. 未执行任何分析母版（不跑脚本、不连远端），验证限于静态与单测层面。
5. 测试里写死了母版数量 58 与三个 bilingual 名单。母版增删时该测试会红，这是有意的漂移守卫（新增/删除母版需同步核对 bilingual 集合），不是脆弱断言。

## 6. 建议下一步

1. Lead 复核 `git diff BioanalysDesktop/server/task.js`：本切片只动 `:45-93`（新增函数）与 `:114-119`（计数改用剥离文本），其余未碰。
2. 若要顺手收紧 `guardWired`（见风险 1），建议单独切片：`guardWired: GUARD_CALL_RE.test(stripShellAndCodeComments(content))`，并同步把 `bridge_guard_invariant.test.js` 的 bilingual 判定也改为剥离后计数，避免两边口径再度分叉。
3. 等 Lead 补齐 `ops/sync_and_verify_remote.ps1` 与 `con_hf/{SPEC_DECISIONS,ops_ledger,pitfalls_ledger}.md` 后重跑 `npm test`，预期 518/518 全绿。
