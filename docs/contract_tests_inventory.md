# server 模块契约测试清册

这份文件回答一个问题：`BioanalysDesktop/server/` 下 45 个模块里，哪些有**独立的契约测试**，
各自钉住什么。测试文件头注释只解释单个模块，跨模块的覆盖全景此前无处可查，所以单独落一份。

## 已覆盖

| 模块 | 测试文件 | 条数 | 变异 | 钉住的契约 |
|---|---|---|---|---|
| `domain.js` | `domain_contract.test.js` | 12 | 3 | 三线枚举闭合、目录根都在 SSD_ROOT 下、非法 projectId 返回 null 而非抛错 |
| `figure_graph.js` | `figure_graph_contract.test.js` | **18** | **9** | produces 与 input_tables 的匹配、语言亲和性（4A）、**跨线亲和性闭合 4B**（step 与 linked_mods 逐线可达 + 分析线枚举）、跨线/跨项目守卫、影响面阈值、ready 才可派发 |
| `static_assets.js` | `static_assets_contract.test.js` | 8 | 4 | 只服务 dist 内文件（含 %2E%2E 编码穿越）、MIME 与安全头 |
| `portal_inbox.js` | `portal_inbox_contract.test.js` | 8 | 3 | 收件箱名单字符类、两种在册目录形态、坏 JSON 不连坐同目录条目 |
| `remote_exec.js` | `remote_exec_contract.test.js` | 7 | 3 | ssh 目标固定 k40-ubuntu（零算力红线）、单层 ls、噪声行只删行首两类 |
| `sinks.js` + `http_response.js` | `sinks_and_http_contract.test.js` | 10 | 6 | SSE 帧格式、单 sink 抛错不连坐、JSON 响应头固定、no-store |
| `a2a_state.js` + `query_views.js` | `a2a_query_contract.test.js` | 17 | 8 | TASK_STATE_ 前缀归一化、终结态集合、项目参数越界回 null、本地副本优先于远端 |
| `routes/diagnostics.routes.js` | `diagnostics_routes_contract.test.js` | 15 | 7 | 命中必须显式 return true、五盏灯与 all_pass 的等价、探测抛错落 unknown、台账不可达报阻塞、数据面树的三级 400 |
| `portal_page.js` | `portal_page_contract.test.js` | 8 | 6 | 客户端字段进 HTML 前必须转义、URL 三段参数必须编码、阻塞段与空段各有可读原因 |

合计 9 个文件覆盖 11 个模块、98 条断言、46 次变异。

## 三条方法论

1. **先探针实测再写断言，实现是真源。** 按想象写会得到「测试红了但代码是对的」，
   比不写更糟：它会把正确实现改坏。`domain.js` 那轮三处差异（非法值返回 `''` 而不是 `null` 等）
   全部是改测试而不是改实现。
2. **变异必须能证明自己生效。** 用 node 的 `split/join` 替换并校验 `broken !== original`，
   否则一次静默未命中的替换会被误读成「测试太弱」。PowerShell 的 `-replace` 就踩过这个坑。
3. **行为断言抓不到的冗余守卫，用结构断言钉住并在注释里写明它是纵深第二层。**
   `static_assets` 的包含性校验与 `portal_inbox` 的反斜杠检查当前都无独立输入可触发，
   诚实记录「删掉它行为不变」，比假装被行为测试覆盖更可信。

## 两个会伪造绿灯的坑

- mock `res` 必须是真 `Writable`：非流对象时 `pipe()` 同步抛错、被实现的 catch 吞掉后走 404 分支，
  表现为「合法文件也 404」。
- 顺序比较 `indexOf` 抓不到 `if (false && local)` 这类行为变异：必须断言代码结构本身。

## 边界

本清册只覆盖 `BioanalysDesktop/server/` 模块。`ops/` 下的生成与验收脚本、前端 `src/`，
它们的守门在各自的自检、静态门禁与 e2e 里，不在本文件范围内。

## 第二十一轮补的两处（2026-11-03）

| 件 | 判据 | 位置 | 变异反证 |
|---|---|---|---|
| 第 4 条拓扑不变量（跨线/跨语言亲和性闭合） | 4A 语言失配必败并点名 `模板 r 与 mod Python`；4B `lines` 声明的每条线都必须同时满足「analysis_step 属于该线」与「linked_mods 有该线出图 Mod」，多线模板逐线闭合 | `server/figure_graph.js` 的 `validateLineAffinity`（导出于同文件，`validateRegistry({registry, modsAll})` 可注入合成注册表） | 3 条：step 线判断短路、出图 Mod 判断短路、语言判断短路，各自咬住对应用例 |
| 条件跳过原因白名单门禁 | 每条 skip 必须写 `<TAG>: <说明>`，TAG 限 `ALLOWED_SKIP_REASONS` 六类；裸 `skip: true`、空原因、枚举外标签判红；注释与字符串里的 skip 字样不误伤 | `ops/skip_reason_gate.mjs`（静态面 `scanTestSources` + TAP 面 `checkTapSkips`，`main()` 可进程内直调）+ `tests/skip_reason_gate.test.js` | 5 条：白名单前缀校验放松、裸 skip 放行、跳过白名单检查、TAP 空原因放行、代码位遮罩失效 |

两条落地时的实测发现：

1. **用例名里不能出现未转义的 TAP 指令记号**：`# SKIP` 在 TAP 名字段里必须转义，
   否则任何 TAP 消费者都会把它读成真指令。本门禁首版就因此自伤（全量 TAP 第 5536/5537 行
   被判成跳过原因不在白名单），改成不含该字面量的用例名后复绿。这条对后来人同样有效：
   写测试名时用「跳过指令行」这类说法，别把 `# SKIP` 原样写进测试标题。
2. **skipped 数随宿主漂移（本机 18、装齐工具链 1）是正常现象**，判据从此是「每条跳过都带
   白名单原因 + fail=0」，不再有计数上限断言。

