[派发单 · 切片 S28] 子 Agent 任务：桥接四项断言接线（补 aims §一.3 铁律空转 D1，8787 提交层统一接）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\architecture_review_2026-10-20.md
     §1.5 与 §4 D1（本切片的立项依据）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\aims\aims.txt §一.3
     （铁律原文：跨语言转换必须过四项断言，`ops/verify_bridge_checkpoint.py` 自动执行）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\ops\verify_bridge_checkpoint.py
     （**你要调用的引擎**：读它的 CLI 参数、退出码、输出契约、它到底检什么）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\server\task.js
     （任务提交的 script 构造处，你的接线点）、`server/index.js` 的
     `/api/tasks/submit`（:1189-1322）、`server/audit.js`（跨线审计的既有范式）
  6) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\task.test.js
     与 `audit.test.js`（既有契约，**只许新增不许改断言**）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【文件域】你只改：`BioanalysDesktop/server/task.js`、`BioanalysDesktop/server/index.js`（只加接线）、
`BioanalysDesktop/tests/bridge_checkpoint.test.js`（新建）。
**禁止碰**：`ops/`（引擎在另一会话域，只调用）、`src/` 三线脚本、`portal/`、
`server/run.js`、`server/report.js`、其他模块、`docs/`。
【远端通道】`adb forward tcp:8022 tcp:8022 && adb forward tcp:10022 tcp:10022`，
然后 `ssh -o BatchMode=yes k40-ubuntu '<命令>'`。

【背景（主 Agent 已实测）】
- aims §一.3 铁律要求"每次跨语言转换必须通过桥接四项断言检查点"，
  但 58 个分析脚本 `grep verify_bridge_checkpoint` **0 命中**——铁律空转。
- 三线实际语言构成（实测 Rscript/python 调用数）：线1 = 23/10、线2 = 5/24、线3 = 2/17。
  即**每条线都有跨语言步骤**，每个任务都可能触发桥接。
- 主 Agent 已裁决接线位置：**8787 任务提交层统一接**（不动 58 个脚本——
  那会动三线隔离域且工作量巨大；且提交层是唯一能看到"这一步是跨语言步骤"的全知位置）。

【主 Agent 已定死的接线规格（不许自行更改）】

一、判定"哪些步骤需要过桥接"（task.js）：
1. 新增**纯函数** `export function needsBridgeCheck(lineId, stepName)` → boolean。
   判定依据**必须可从仓库事实推出**，不许拍脑袋：
   - 读 `src/<line>/scripts/<stepName>` 的**本地母版**（`src/` 是母版，远端 bin 是部署产物），
     统计该脚本内 `Rscript` 调用数与 `python` 调用数（含 heredoc 内），
     **两者都 ≥1 才返回 true**（单语言步骤不过桥）。
   - 母版文件不存在 → 返回 false 并在调用方日志里 warn（不许因读不到就抛错阻断提交，
    也不许静默当"不需要"——要可观测）。
2. 新增**纯函数** `export function buildBridgeCheckCommand(lineId, stepName)` →
   `{ command, remoteScript }`：远端执行
   `python3 /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py <参数>`。
   **参数怎么传必须以你读到的引擎 CLI 契约为准**（先读引擎再定；
   若引擎需要的输入（如矩阵路径）无法在提交层确定，**停下来上报**，
   不许编造参数或跳过校验）。

二、提交层接线（index.js 的 `/api/tasks/submit`）：
3. 在既有校验链（lineId 枚举 → projectId 消毒 → step 字符集 → inputs/outputs 类型 →
   auditCommand 跨线审计）**之后、真正下发之前**，插入桥接检查：
   - `needsBridgeCheck(...)` 为 true → 先同步执行 `buildBridgeCheckCommand` 产生的命令
     （经既有 ssh 范式，照 audit.js 的执行方式）；
   - **引擎退出码非 0 → 整个提交 400**，error 里带引擎 stdout/stderr 原文
     （点名是哪个断言没过：基因名/矩阵方向/Barcode 顺序/坐标保留）；
   - 退出码 0 → 记一条日志 `[bridge] <line>/<step> 四项断言通过` 后继续下发；
   - **母版缺失（needsBridgeCheck 返回 false + warn）时不得阻断提交**
     （保持既有行为，只是不打 bridge 日志）。
4. **性能红线**：这一步是同步 ssh，K40 不可达时**不许让提交挂死**——
   超时照既有 ssh 的 ConnectTimeout 处理，失败时返回 503 并明说
   "桥接校验无法执行（K40 不可达）"，**不许静默放过**（不放过的意思是明确失败，
   不是假装通过）。

三、测试 `tests/bridge_checkpoint.test.js`（新建，≥6 条，全绿）：
5. `needsBridgeCheck` 纯函数：构造/选取三类真实母版各一条——
   双语混合脚本（如线1 的某个既有脚本，贴你选它的行号证据）→ true；
   纯语言脚本 → false；不存在的 step → false。
   **断言前先贴出你统计的 Rscript/python 调用数**（用真实文件，不许 mock 内容）。
6. `buildBridgeCheckCommand`：命令含引擎绝对路径与必要参数；**stepName 含
    shell 元字符（`;`、`$(...)`、空格）必须被拒绝或消毒**（至少 2 条负路径）。
7. 提交层接线（起真服务打真 HTTP + 假 ssh 垫片，照 auth.test.js 手法）：
   - 双语步骤 + 垫片回退出码 1 → 提交 400 且 error 含引擎原文；
   - 双语步骤 + 垫片回 0 → 提交继续（被打断在后续环节或成功，断言
     "没有被 bridge 拦住"即可，用日志或垫片调用计数证明走到了下发）；
   - 单语言步骤 → **垫片不应被调用**（证明没有多余 ssh 往返）；
   - 母版缺失步骤 → 提交不被桥接阻断（保持既有行为）。
8. 既有测试**一条不许红**（`npm test` 全绿；注意现为 281 条）。

【任务项】
1. 读引擎 `verify_bridge_checkpoint.py` 全文，贴出：CLI 参数、退出码语义、
   它检的四项各是什么、输出格式、**它需要哪些输入文件/路径**。
2. 实现 needsBridgeCheck + buildBridgeCheckCommand + 提交层接线。
3. 写测试（≥6 条，含 2 条元字符负路径）。
4. `cd BioanalysDesktop && npm test` **全绿**（贴尾行）；`npm run build` 成功（贴尾行）。
5. 真链验证（**真 K40**，这是本切片的价值）：
   - 对 default 项目 line2 的 `scrna_figures`（或你判定为双语的既有步骤）提交一次任务，
     断言日志出现 `[bridge] ... 四项断言通过`、任务正常下发、
     台账/任务行为与接线前一致（图件集合不变、processed 不动）；
   - 负路径：临时把引擎调用换成一个必然失败的参数（**不改引擎文件**，
     在你的垫片/临时脚本里造），断言提交 400 且 error 点名断言项；
   - 若 K40 不可达：写「未运行」+ 替代验证，**不许伪造**。
   脚本落 `cn_debug/2026-10-20_verification_s28_bridge.mjs`（幂等）。
6. **每完成一步更新一次 `con_hf/dispatch/S28_report.md`**（硬要求）。

【硬性禁止】
- 禁止改 `ops/verify_bridge_checkpoint.py` 与任何 `src/` 脚本（只调用母版做统计）。
- 禁止为让提交通过而放宽校验（引擎说不过就不过）。
- 禁止在母版缺失时阻断提交（那是回归，不是加固）。
- 禁止把 stepName 未消毒就拼进 shell 命令。
- 禁止静默放过 K40 不可达（要明确 503）。
- 禁止把"应该能拦住"写成已验证；必须真打 HTTP/K40 或明确写未运行。

【验收标准】
A1 引擎 CLI/退出码/四项断言/所需输入的读码结论已贴出。
A2 needsBridgeCheck 判定有真实母版行号与调用数证据（三类各一条）。
A3 元字符负路径 ≥2 条；提交层接线在既有校验链之后。
A4 引擎退出码非 0 → 400 带原文；0 → 放行并打 `[bridge]` 日志。
A5 单语言步骤不产生额外 ssh 往返（垫片调用计数为证）。
A6 `npm test` 全绿 + build 成功。
A7 K40 真链正/负路径各一次（或明确未运行 + 原因）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约返回，并写入上述 report 文件。
