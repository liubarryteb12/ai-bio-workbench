# S20 子 Agent 回报（portal 上传上限 5GiB + 每角色 5 + 流式写盘）

> 按 `con_hf/dispatch/S20_upload_limit_streaming.md` 执行；本文件每完成一步更新一次。
> 项目根：D:\00.AIagent\codespace\AI辅助生信分析流程工作台

## 进度台账

| 步 | 内容 | 状态 |
|---|---|---|
| 0 | 读契约/源码/测试，基线 npm test | 进行中 |
| 1 | archive.mjs 三处改动（上限/每角色/env 覆盖 + 注释） | 未开始 |
| 2 | serve.mjs handleDataFileUpload 流式改造 | 未开始 |
| 3 | node --check ×2 | 未开始 |
| 4 | npm test 237/237 | 未开始 |
| 5 | 验证脚本 cn_debug/2026-10-20_verification_s20_upload_limit.mjs | 未开始 |
| 6 | 生产 8080 /health 冒烟（不重启） | 未开始 |
| 7 | latent 问题上报（不改） | 未开始 |

## 步骤 0：接任务与基线

- 已完整阅读：SUBAGENT_CONTRACT.md、portal/serve.mjs、portal/lib/archive.mjs、
  BioanalysDesktop/tests/portal_submit.test.js、portal_archive.test.js。
- 并行约束确认：S19 在改 portal/index.html，本切片不碰该文件。
- grep 命中清单（任务项 2，命令
  `grep -rn "单文件超过上限\|超过单文件上限\|other 角色最多\|写入数据文件失败\|读取上传内容失败\|上传内容为空" BioanalysDesktop/tests/`）：
  唯一命中 `portal_archive.test.js:179` 的测试名 `超过单文件上限时拒绝`；
  其断言为 `/超过/`（第 183 行），匹配的是 archive.mjs:130 的
  `体积 ${size} 字节超过单文件上限 ${MAX_DATA_BYTES}`——该文案按要求**不动**。
  其余 5 个候选文案在测试中零命中，可安全改 serve.mjs 的超限提示。
- 基线（改前）：`cd BioanalysDesktop && npm test` → tests 237 / pass 237 / fail 0。
- 项目根非 git 仓库（`git status` 报 not a git repository），无提交类动作，验证以文件内容+测试为准。
- 生产 portal 确认在跑：`netstat -ano` 显示 127.0.0.1:8080 LISTENING PID 5968（与派发单一致），全程不重启。

（后续步骤结果见下方「正式回报」。）

---

# 正式回报

## 一、任务理解

用户 2026-10-20 拍板：portal 数据文件上传上限 1 GiB → 5 GiB（实测挡过 IS 项目 line3 的 1.89GB tar 包），
每角色文件数 3 → 5（仅约束 other），并要求 `handleDataFileUpload` 从"整文件攒内存再 Buffer.concat"
改为流式写盘，避免上限调大把 OOM 风险同比放大。默认值必须是 5 GiB，新增 `PORTAL_MAX_DATA_BYTES`
环境变量覆盖仅供超限负路径真测。不碰 index.html（S19 并行）、测试、ops/、src/、BioanalysDesktop/、
MAX_BODY、REF_MAX_*、DATA_ROLES、DATA_EXT、handleSubmit、/api/references；不修任务项 7 的 latent 问题。

## 二、实现摘要

共 3 个代码点 + 2 条注释 + 1 个新辅助函数：

1. `portal/lib/archive.mjs:29` — `MAX_DATA_BYTES` 改为 `Number(process.env.PORTAL_MAX_DATA_BYTES) > 0
   ? Number(...) : 5 * 1024 * 1024 * 1024`（默认 5 GiB = 5368709120）。
   注释更新为："2026-10-20 用户拍板 5 GiB；依据：单细胞/空间 RAW tar 常见 1–3GB，
   IS 项目 line3 原始包实测 1.89GB"，并说明 env 覆盖的用途与同步生效机制。
   `validateDataFiles` 与 `serve.mjs` 均 import 该常量，覆盖后两端天然同步。
2. `portal/lib/archive.mjs:32` — `MAX_DATA_FILES_PER_ROLE` 3 → 5，注释补明
   "仅约束 other 角色；其余角色由 validateDataFiles 硬编码为每角色 1 个"。
3. `portal/serve.mjs` `handleDataFileUpload` 重写为流式写盘：
   - `fs.createWriteStream` 边收边写；函数内不再有 `chunks` 数组 / `Buffer.concat`（grep 确认，
     剩余 6 处 chunks/Buffer.concat 全在 `handleSubmit`（1MB JSON 体）与 `handleReferenceUpload`
     （20MB 参考文献）内，均为派发单明令不动的部分）。
   - 首个数据块才建目录/定落点/开写流 → 0 字节上传不落任何文件（与旧行为一致）；
     `uniqueInDir` 碰撞追加 `_2`、"同 sid 下同角色先删旧的"那段逻辑**原样照抄**（任务项 7 只观察不改）。
   - 背压处理：`stream.write(chunk) === false` 时 `req.pause()` + drain 后 `req.resume()`，
     内存不随文件体积增长。
   - 三条失败路径都删半成品（`stream.destroy()` + `fs.rmSync(target, { force: true })`）：
     超限 → 400；写流出错/建流失败 → 500 `写入数据文件失败: <message>`（既有文案格式）；
     客户端断传（end 前触发 close/aborted）→ 删半成品且不再写响应。
   - 必须等写流 `finish` 才回 200；成功响应 `{ok:true, name, path, size}` 与
     `console.log('[user-portal] 收到数据文件: ...')` 日志行一字未变。
   - 超限文案改为人类可读 `单文件超过上限 ${humanBytes(...)}`：默认显示 `单文件超过上限 5GiB`，
     env 覆盖 1MiB 时显示 `单文件超过上限 1MiB`（新 helper `humanBytes`，KiB/MiB/GiB 取整，
     非整倍数如实显示如 1.43MiB）。archive.mjs:130 的 `体积 ${size} 字节超过单文件上限 ${MAX_DATA_BYTES}`
     未动（测试依赖其子串）。

## 三、文件变更清单

| 文件 | 变更 |
|---|---|
| `portal/lib/archive.mjs` | MAX_DATA_BYTES（env 覆盖 + 默认 5GiB）、MAX_DATA_FILES_PER_ROLE=5、两条注释 |
| `portal/serve.mjs` | 新增 `humanBytes()` helper；`handleDataFileUpload` 流式重写 |
| `cn_debug/2026-10-20_verification_s20_upload_limit.mjs` | 新建：S20 验证脚本（起真进程、打真 HTTP，幂等） |
| `con_hf/dispatch/S20_report.md` | 本回报文件 |
| `con_hf/handoff.md` | 追加 S20 完成条目 |

未触碰：`portal/index.html`（S19 并行在改）、`BioanalysDesktop/` 全部、`ops/`、`src/`、
`handleSubmit`、`/api/references`、`handleReferenceUpload`、MAX_BODY、REF_MAX_*、DATA_ROLES、DATA_EXT。

## 四、接口与交互实现说明

- HTTP 契约不变：入参校验（sid/role/name/扩展名）顺序与文案照旧；成功响应
  `{ok:true, name, path, size}`、`path = uploads/<sid>/<落盘名>`、`size` = 实际写入字节数。
- 时序保证：`/api/datafiles` 的 200 在写流 `finish` 之后发出，客户端拿到的 path 必定对应已写全的文件
  （C2 md5 逐字节一致是硬证据）。
- 一处**与派发单字面顺序的偏差**（有探针证据，契约不变）：
  派发单要求超限时 `req.destroy()` + 销毁写流 + 删半成品 + 返回 400。实测（Node v24.19.0，本机）：
  先 `req.destroy()` 再回 400，客户端收到的是 `read ECONNRESET`，**400 永远送不到**
  （探针：destroy-only / destroy-first 两种顺序均 ECONNRESET；先回 400 再 drain / drain 完再 destroy
  均 400 送达）。且旧实现的"在 'end' 里回超限 400"因 destroy 后 'end' 不再触发，本就是死代码。
  故实现为：**先回 400 → 继续把剩余 body 读光丢弃 → 'end' 后再 `req.destroy()`**。
  req.destroy、销毁写流、删半成品、返回 400 四项要求全部满足，只调整了先后次序以保证 400 可达。

## 五、测试与验证记录（全部实测）

1. **文案依赖 grep**（任务项 2）：`BioanalysDesktop/tests/` 内唯一命中
   `portal_archive.test.js:179` 测试名 `超过单文件上限时拒绝`，其断言 `/超过/` 匹配的是
   archive.mjs:130 文案（未动）。serve.mjs 旧超限文案无测试依赖，可安全改。
2. **语法检查**：`node --check portal/serve.mjs && node --check portal/lib/archive.mjs` → SYNTAX_OK。
3. **契约护栏**：`cd BioanalysDesktop && npm test` → **tests 237 / pass 237 / fail 0**。
   改前基线同 237/237；改后共跑 8 次全绿（详见"偶发 flake"说明）。
4. **验证脚本**：`node cn_debug/2026-10-20_verification_s20_upload_limit.mjs` → **14/14 PASS**，
   连跑两次结果一致（幂等）。逐项：
   - C0 默认配置（干净 env 子进程实测）：`MAX_DATA_BYTES = 5368709120 字节（5 GiB）`、
     `MAX_DATA_FILES_PER_ROLE = 5`。
   - C1/C2 正路径：64MiB 随机文件（train_matrix + bind=GSE10001）→ 200、size=67108864、
     落盘 md5 与源一致（流式写全的硬证据）。
   - C3 内存有界性（powershell Get-Process WorkingSet64 实测）：64MiB 上传前后 RSS 增量
     **11.86MB**（第二次上传增量 **-1.40MB**，内存还被回收）远小于 64MiB，流式判据成立。
   - C4 空文件 → 400 `上传内容为空` 且不落盘；C5 `.exe` → 400 且不落盘（既有行为不破）。
   - C6 同名重传 → `_2` 追加且旧文件仍在（同时是 latent 问题取证，见第七节）。
   - C7 建流失败（uploads/<sid> 处预置同名文件）→ 500 `写入数据文件失败: EEXIST...`（既有文案格式）。
   - C8 全链路：POST /api/submit → `PKG_2026-10-20_…_S20验证项目` 生成，`raw_data/` 内文件
     md5 与源一致，manifest counts.data_files=1，提交后 uploads/<sid> 已清（归档链路未被破坏）。
   - C9/C9b 超限负路径：`PORTAL_MAX_DATA_BYTES=1048576` 起独立实例，上传 4MiB →
     400、error 含 `单文件超过上限 1MiB`、`uploads/<sid>/` 无任何残留文件。
   - C10 客户端断传（raw socket 发 64KiB 即断开）→ 半成品被删、目录空、服务进程不崩、后续用例正常。
5. **生产 8080 冒烟（未重启）**：`curl http://127.0.0.1:8080/health` →
   `{"ok":true,"service":"user-portal","port":8080,...}`；`tasklist` 确认 PID 5968（node.exe）仍存活；
   `netstat` 确认 127.0.0.1:8080 LISTENING PID 5968 前后一致。全程未重启、未动真实收件箱。

## 六、假设与风险

- **偶发 flake（1 次，未能复现）**：一次 `npm test` 中 `portal_submit.test.js:158` 的 fetch 报
  `fetch failed`（undici mainFetch 栈），该用例不经过本次改动的上传路径；当时完整 pass/fail 计数
  未截获（tail 截断）。其后 8 次全量 + 5 次该文件单独运行全部 237/237 全绿。判断为环境性偶发
  （Windows 回环/端口抖动类），但按诚实口径上报，非"已证明与本次改动无关"。
- **生产实例仍在跑旧代码**：PID 5968 启动于改动之前，其内存里的上限仍是 1 GiB/攒内存逻辑；
  新 5 GiB + 流式行为需重启 portal 才生效（重启被派发单禁止，留给主 Agent 决定时机）。
- 临时残留：早前两次脚本失败运行（REPO 路径 bug、duplex 缺失，均已修）留下
  `C:\Users\18765\AppData\Local\Temp\s20_run_bNCpYX`（含 1 个随机源 .bin）与
  `...\s20_run_Ph0a0p`（空）。清理命令被本会话安全策略拦截（"未经授权不删除"），
  两个目录合计 <1MB，可直接删除；成功运行已验证无残留（s20_inbox_* 均清空）。
- 验证脚本用 `powershell Get-Process` 读 RSS，本机可用；若换环境无 powershell，
  脚本会按派发单要求记「未验证」而不是编数。

## 七、latent 问题上报（任务项 7，只上报未修）

`serve.mjs` 里"同 sid 下同角色只留一个"用 `n.startsWith(\`${role}__\`)` 找旧文件，但落盘名由
`uniqueInDir(dir, name)` 产生、**不带 role 前缀**，该过滤永远匹配不到任何文件——"同角色重复上传
先删旧的"实际失效。本切片用真服务复现（C6）：同一 sid+role+name 上传两次，得到
`dup_matrix.tsv` 与 `dup_matrix_2.tsv` 两个文件并存，旧文件未被删。下游 `validateDataFiles`
会在提交时以"角色只允许一个文件"拦住，不产生错误交付，只是 uploads 目录会留垃圾。
另注：本切片把该段逻辑照抄进了流式版，触发位置从"end 时"移到"首个数据块时"，行为不变。

## 八、待主 Agent 决策事项

1. **index.html 客户端副本已与服务端脱节（重要）**：`portal/index.html:1186-1187` 仍持有
   `MAX_DATA_BYTES = 1024*1024*1024` 与 `MAX_DATA_FILES_PER_ROLE = 3` 的本地副本
   （两端解耦各持一份的既有设计）。S19 正在改 index.html 且其派发单明令不碰这两个拟值，
   本切片也不碰。后果：**浏览器端上传前的体积检查仍按 1 GiB 拦截、other 角色按 3 个封顶**，
   用户经 Web UI 实际到不了服务端新的 5 GiB/5 个上限。`index.html:1337` 若照抄
   `Math.round(/1024/1024)+'MB'` 还会显示"5120MB"。建议单开一个小切片（与 S19 协调）改这三处。
2. 生产 8080 portal（PID 5968）重启时机：新代码需重启生效，且重启会短暂中断真实收件箱服务。
3. 超限 400 的送达机制如第四节所写与派发单字面顺序有偏差（契约不变，探针证据齐全），请主 Agent 认可或另定。
4. 一次性 flake（第五节第 3 条）是否需要后续专门排查。

## 九、建议下一步

1. 主 Agent 复核本报告 → 决定 index.html 客户端副本切片与 8080 重启时机。
2. 重启 portal 后可重跑 `node cn_debug/2026-10-20_verification_s20_upload_limit.mjs`（幂等，不碰真实收件箱）回归。
3. latent"先删旧的"问题如需修复，建议单独切片（顺带决定文件名是否统一带 role 前缀）。

## 附：进度台账终态

| 步 | 内容 | 状态 | 证据 |
|---|---|---|---|
| 0 | 读契约/源码/测试，基线 npm test | 完成 | 基线 237/237 |
| 1 | archive.mjs 三处改动 + 注释 | 完成 | patch diff |
| 2 | serve.mjs 流式改造 + humanBytes | 完成 | patch diff；grep 无 chunks/Buffer.concat 残留于 handleDataFileUpload |
| 3 | node --check ×2 | 完成 | SYNTAX_OK |
| 4 | npm test 237/237 | 完成 | 改后 8 次全绿（1 次环境性 flake，见六） |
| 5 | 验证脚本 | 完成 | 14/14 PASS ×2（幂等） |
| 6 | 生产 8080 /health 冒烟（不重启） | 完成 | PID 5968 存活，health ok |
| 7 | latent 问题上报（不改） | 完成 | 第七节 + C6 实测取证 |
| 8 | 本回报文件逐步更新 | 完成 | 本文件 |
