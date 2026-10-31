[派发单 · 切片 S26] 子 Agent 任务：修台账 8KB 静默截断 P0 + 测试端口硬编码脆弱（两处均为我的文件域）

【你是谁】项目实现型子 Agent。动手前必须完整阅读：
  1) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\SUBAGENT_CONTRACT.md
  2) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\con_hf\dispatch\S18R_report.md 的 §9（P0-2 现场）
  3) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\server\run.js
     （`buildLedgerWriteCommand` :164-169、`persistEntry` :172-176、`runSsh` :178-198）
  4) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\index.test.js
     （:18 硬编码 `PORT = 18787`）与 `tests/portal_submit.test.js`（`freePort()` 的正确先例）
  5) D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop\tests\run.test.js
     （persistEntry 相关既有断言，**不许改旧断言**）
以上是最高行为准则；本派发单只定义任务项。

【项目根】D:\00.AIagent\codespace\AI辅助生信分析流程工作台
【文件域】你只改：`BioanalysDesktop/server/run.js`、`BioanalysDesktop/server/task.js`
（仅任务项 3 若确有必要）、`BioanalysDesktop/tests/index.test.js`、
`BioanalysDesktop/tests/run.test.js`（**只许新增用例，不许改既有断言**）。
**禁止碰**：`portal/`、`ops/`、`src/`、`server/figures.js`、其他 server 模块、`docs/`。
【并行约束】S25 侦察在跑（只读）；S18R 已结束，`server/figures.js` 仍别碰。

【背景（主 Agent 已实测确认）】
- **P0（S18R §9 P0-2）**：`buildLedgerWriteCommand` 把整个台账 JSON base64 后
  拼进 `ssh k40-ubuntu '<command>'` 的**单行 argv**。71 个 outputs 的条目命令
  长达 10,117 字符，超过 ssh/远端 shell 约 8KB 上限被截断 → base64 解出半截 JSON
  仍 exit 0 →「WROTE」照印 → `persistEntry` 当成功 → **台账静默丢失且不可见**。
  现场：`spatial_figures` 步骤 system_logs 台账数 = 0（主 Agent 实测）。
- **P1（我实测）**：`tests/index.test.js:18` 硬编码 `PORT = 18787`，
  与无关进程（本机 `.dsh\profiles\desktop\...billion-` PID 28256）相撞即 8 条 FAIL
  （EADDRINUSE）。`portal_submit.test.js` 已有 `freePort()` 正确先例。

【主 Agent 已定死的改动规格（不许自行更改）】

一、台账落盘改 stdin（解 P0）：
1. `persistEntry` 不再走命令行传 payload：改为把 base64 写到 ssh 进程的 **stdin**，
   远端命令只做解码与落盘，例如 `ssh k40-ubuntu "base64 -d > '<remotePath>'"`，
   payload 由 `child.stdin.write(...)` 写入（stdin 无 8KB 限制）。
   远端命令里保留 `mkdir -p`（分两次调用或保持一条，但 payload 绝不进 argv）。
2. **硬校验（防再静默）**：落盘后远端必须回一个可验证的标记，
   且 `persistEntry` 必须**校验该标记**，缺失即 reject（不许当成功）。
   建议形态：远端命令末尾 `echo WROTE <remotePath> <bytes>`
   （bytes 用 `wc -c < file` 取），本地比对 bytes 与 payload 长度一致，不一致即 reject。
3. **失败必须响**：`persistEntry` 的 rejection 不许被 `void` 丢弃
   （tests/run.test.js:139 与 index.test.js:102 有 2026-10-13 事故的护栏注释，
   保持该性质；**若既有断言约束了 rejection 传播方式，遵守它，不要改断言**）。
4. 行为兼容：成功路径的台账号内容/路径/文件名**完全不变**（只改传输方式）；
   `buildLedgerWriteCommand` 若被测试 import，**保留导出但语义改为 stdin 方案**，
   无法兼容则保留原函数并新增 stdin 版本:以既有断言为准，不许删导出。

二、同类隐患排查（任务项 3，"修一类不修一个"）：
5. 检索服务端其他"把大 payload 拼进 ssh 命令行"的调用点
   （重点：`server/task.js` 的任务提交命令构造、`server/upload.js` 的部署命令、
   `server/pull.js`、`server/index.js` 里任何 `runSsh`/`spawn('ssh',...)`），
   逐个判断是否同样有 8KB 风险（命令长度随 outputs 数量/文件数增长）。
   有风险的列清单上报；**只修台账这一处**（本切片范围），其余列为后续切片建议，
   不许擅自扩大改动。

三、测试端口（解 P1）：
6. `tests/index.test.js` 改用 `freePort()`（照 `portal_submit.test.js` 的写法：
   `net.createServer()` listen(0) 取空闲端口再关掉），删掉硬编码 18787。
   注意该文件可能有多处引用 PORT（如 `BAD_PORT` 的派生），全部改用动态端口。

四、测试（tests/run.test.js 只增不改）：
7. 新增用例（≥4 条，全绿）：
   - **长条目用例**：构造一个 io_files.output 含 71 项的 entry，
     断言 `buildLedgerWriteCommand`（或新方案对应函数）**产生的 ssh argv 不含 payload**
     且 payload 经 stdin 传递；用假 ssh 垫片（照 tests 里既有垫片手法，
     如 `auth.test.js`/`run.test.js` 的 spawn 拦截）验证 stdin 收到完整 payload。
   - **标记缺失即失败**：垫片回显不带 WROTE 标记 → `persistEntry` 必须 reject
     （不许静默成功）。
   - **bytes 不符即失败**：垫片回显的 bytes 与 payload 长度不一致 → reject。
   - **端口冲突不再致死**：`index.test.js` 改造后，即使 18787 被占
     测试仍应通过（可串行占用 18787 制造冲突来验证，或至少证明端口来自 freePort）。

【任务项】
1. 先复现 P0：写一个一次性复现（可用假 ssh 垫片 + 71 outputs 的 entry），
   证明旧代码的命令行超长且标记校验缺失:贴证据。**先红再改**。
2. 按规格改 `run.js`（stdin 传输 + 硬校验）。
3. 查同类隐患列清单（只修台账一处）。
4. 改 `index.test.js` 端口。
5. 新增 4 条测试；`npm test` **必须 247/247 全绿**
   （注意：跑测试前先确认 18787 当前被无关进程占用:这正好验证端口修复；
    若仍有 FAIL 必须查明是不是端口问题）。
6. E2E 真链（**真 ssh 到 K40**，这是本切片的价值所在）：
   - 提交一个 outputs ≥ 40 的任务到 K40（用既有 E2E 脚本的提交手法，
     可用 `scrna_figures` 这种 outputs 多的既有步骤，`seed=20261018`，
     `default` 项目 line2，**不要新建项目、不要动 processed 数据**）；
   - 等任务结束，读远端 `system_logs/*_<step>_*.json`，
     断言文件存在、`JSON.parse` 成功、io_files.output 长度与声明一致、
     seed 字段 = 20261018、stdout 回显里有 WROTE 标记的证据；
   - 脚本落 `cn_debug/2026-10-20_verification_s26_ledger_e2e.mjs`（幂等）。
   - **若 K40 不可达**：明确写「未运行：K40 ssh 不可达」+ 已完成的替代验证，
     不许伪造。
7. **每完成一步更新一次 `con_hf/dispatch/S26_report.md`**（硬要求）。

【硬性禁止】
- 禁止改 `tests/run.test.js` 的既有断言（只许新增）。
- 禁止改台账号文件内容/命名规则。
- 禁止修任务项 3 清单里的其他 ssh 调用点（上报即可）。
- 禁止让 `persistEntry` 的 rejection 被吞。
- 禁止把"应该不会超了"写成已验证；必须贴 argv 不含 payload 的证据。
- 禁止伪造 K40 结果；连不上就写未运行。

【验收标准】
A1 P0 复现证据（旧代码 argv 超长/标记缺失）先于修复存在。
A2 台账 payload 走 stdin；远端 WROTE + bytes 双校验，不符即 reject。
A3 台账号内容与路径不变（既有断言全绿为证）。
A4 同类隐患清单已列出（含是否高危判断）。
A5 `index.test.js` 端口动态化；18787 被占时测试仍全绿。
A6 `npm test` 247/247 全绿（贴 output 尾行）。
A7 K40 E2E：真台账落盘 + JSON 可解析 + 字段完整（或明确未运行 + 原因）。

【回报】按 SUBAGENT_CONTRACT.md 输出契约返回，并写入上述 report 文件。
