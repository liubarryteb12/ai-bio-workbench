# P5 报告：portal 编译期注入共享契约

任务：portal 单文件页（portal/index.html）无法 import，白名单 / 上限 / 黑名单只能保留手抄副本；
本切片让 portal/serve.mjs 在返回页面时把唯一权威注入成 window.__SHARED_CONTRACTS__，
前端优先用注入值，缺失时回落到字面量副本（离线双击 html 仍可用），并用测试把守。

## 一、任务理解

1. 权威来源：shared/data_formats.mjs 的 DATA_EXT、MAX_DATA_BYTES；BioanalysDesktop/server/tumor_blacklist.js 的 BLACKLIST_PATTERNS。
2. 服务端在 GET / 与 GET /index.html 时把三者序列化注入 HTML 锚点，不改页面状态码、不改标题。
3. 前端脚本优先读 window.__SHARED_CONTRACTS__：命中则覆盖 DATA_EXT / MAX_DATA_BYTES / BL_PATTERNS，并同步 accept 属性与提示文案；未命中则沿用字面量副本。
4. 新增测试覆盖注入内容逐项相等、注入脚本安全、离线回落、前端覆盖逻辑（vm 跑页面真实代码段）、其他端点不受影响。
5. 只读引用 shared/ 与 BioanalysDesktop/server/，未改权威值；未新增依赖。

## 二、改动清单

### 1. portal/serve.mjs（修改，+44 行左右）

- :30-34 新增 import：shared/data_formats.mjs 的 DATA_EXT（别名 SHARED_DATA_EXT）与 MAX_DATA_BYTES（别名 SHARED_MAX_DATA_BYTES）；BioanalysDesktop/server/tumor_blacklist.js 的 BLACKLIST_PATTERNS。
- :57 常量 INJECT_ANCHOR = '<!-- __INJECT_SHARED_CONTRACTS__ -->'。
- :60-66 export function sharedContractsPayload()：返回 { DATA_EXT: [...SHARED_DATA_EXT], MAX_DATA_BYTES: SHARED_MAX_DATA_BYTES, BL_PATTERNS: [{source, flags}] }，顺序与权威一致。
- :72-77 function scriptSafeJson(value)：JSON.stringify 后把 < 转成 \u003c，U+2028 / U+2029 转义，防止 </script> 提前闭合。
- :83-87 export function injectSharedContracts(html)：无锚点原样返回；有锚点替换成 <script>window.__SHARED_CONTRACTS__ = <json>;</script>。
- :573 GET / 与 /index.html 分支改为 injectSharedContracts(fs.readFileSync(INDEX, 'utf8'))，其余响应头、500 分支、/health、404 均未动。

### 2. portal/index.html（修改，+58 行左右）

- :611 在唯一 inline <script> 之前插入 <!-- __INJECT_SHARED_CONTRACTS__ -->。
- :412 上传规则 span 增加 id="df-upload-guide"（静态文案一字未改，parity 测试继续按原文断言）。
- :1244-1292 新增 P5 代码段（// #region P5 shared contracts 与 // #endregion P5 shared contracts 标记，测试按标记抽取）：
  - :1249-1253 limitTextOf(bytes)：GiB / MiB 文案换算。
  - :1255-1289 applySharedContracts()：读 window.__SHARED_CONTRACTS__；命中则覆盖 DATA_EXT、MAX_DATA_BYTES、BL_PATTERNS（new RegExp(source, flags || '')），把 #f-df-file 的 accept 设为 DATA_EXT.join(',')，重写 #h-df-file 文案，并只替换 #df-upload-guide 里的文本节点（保留 <strong>）；未命中直接返回 false，不改 DOM。
  - :1291 立即调用 applySharedContracts()。
- :1441 dfPrecheck 的超限文案改用 limitTextOf(MAX_DATA_BYTES)，公式与原先一致（去重，不改语义）。
- 三份字面量副本（DATA_EXT :1235、MAX_DATA_BYTES :1238、BL_PATTERNS :622-625）原样保留，供离线回落与既有 parity 测试使用。

### 3. BioanalysDesktop/tests/portal_inject.test.js（新增，16 条测试）

- before 设 PORTAL_PORT=0（内核分配端口）、PORTAL_HOST=127.0.0.1、PORTAL_INBOX=临时目录，动态 import('../../portal/serve.mjs')，等 listening 后从 server.address().port 读实际端口，再轮询 /health；after 关 server、删临时目录。
- 断言清单：GET / 200 且无锚点残留；注入 JSON 与 sharedContractsPayload 逐字段相等；DATA_EXT 14 项逐项同序；MAX_DATA_BYTES 等于 shared 默认 5 GiB；BL_PATTERNS 8 条 source + flags 同序；注入 JSON 无裸 <、无 </script>、注入脚本唯一；注入正则重建后与 checkTumorBlacklist 判定矩阵一致；served 页面仍含三处字面量；剥掉注入后字面量仍与权威一致；injectSharedContracts 无锚点原样返回 / 有锚点只替换锚点；vm 跑页面 #region 段：有注入时变量、accept、两处提示文案按注入值，无注入时保留副本且不改 DOM；/health 字段不变；/index.html 同样注入且未知路径 404；磁盘 index.html 仍保留锚点。

## 三、接口与交互实现说明

1. 注入载荷：window.__SHARED_CONTRACTS__ = { DATA_EXT: string[14], MAX_DATA_BYTES: number, BL_PATTERNS: {source, flags}[8] }。
2. 页面加载顺序：注入 <script> 在主 <script> 之前，主脚本执行时变量已就绪。
3. 离线回落：锚点在磁盘文件里是 HTML 注释，双击打开时 window.__SHARED_CONTRACTS__ 不存在，applySharedContracts 返回 false，字面量副本继续生效，accept 与提示文案保持静态原文。
4. 运行时校验同源：dfPrecheck 用注入后的 DATA_EXT 与 MAX_DATA_BYTES；checkBlacklist 用注入后重建的 BL_PATTERNS。
5. 安全：JSON 序列化后转义 < 与 U+2028 / U+2029，页面里只有一个注入脚本，避免 </script> 截断与脚本注入。
6. 兼容：injectSharedContracts 找不到锚点时原样返回，不抛错；页面结构、标题、/health、404 行为不变。

## 四、测试与验证记录

1. 语法检查：

```
cd D:\00.AIagent\codespace\AI辅助生信分析流程工作台
node --check portal/serve.mjs
exit 0
```

2. 相关测试（parity 18 条 + 新增 16 条）：

```
cd BioanalysDesktop
node --test tests/data_format_parity.test.js tests/tumor_blacklist_parity.test.js tests/portal_inject.test.js
ℹ tests 34 / pass 34 / fail 0
```

3. 新增测试单跑：

```
node --test tests/portal_inject.test.js
ℹ tests 16 / pass 16 / fail 0
```

4. 全量回归（第一轮）：

```
cd BioanalysDesktop; npm test
ℹ tests 577 / pass 575 / fail 2
失败 1：aims_drift_guard §八 五本台账的物理落点全部存在（con_hf/SPEC_DECISIONS.md 不存在，属 Lead 正在补的已知红）
失败 2：upload_reserve P4 complete 只下发一次 scp（并发下抖动；单跑 node --test tests/upload_reserve.test.js 为 23/23 绿）
```

5. 全量回归（第二轮，期间队友在并行加测试）：

```
npm test
ℹ tests 580 / pass 578 / fail 2
失败 1：同上 aims_drift_guard §八（已知红）
失败 2：report_html.test.js「Markdown 自带的目录段被丢弃，不产生死锚点」（队友新增测试，不在本切片范围）
```

说明：全量测试文件数与队友并行改动有关（577 到 580 波动）；本切片新增的 16 条与三份 parity 测试稳定全绿。

## 五、假设与风险

1. 注入的 MAX_DATA_BYTES 取 shared/data_formats.mjs 默认值（5 GiB），不感知 portal/lib/archive.mjs 的 PORTAL_MAX_DATA_BYTES 环境变量覆盖。若运维改过该变量，页面提示仍显示 5 GiB，而服务端按环境变量校验。这是既有前后端不一致，本切片未扩大范围；如需彻底一致，可改为注入 archive.mjs 的有效值（见建议）。
2. 前端覆盖逻辑依赖 DOM 元素 id（f-df-file、h-df-file、df-upload-guide）。改这些 id 需同步 P5 段，测试会红。
3. 注入在每次 GET / 时重新读文件并替换（与原先每次读文件一致），无缓存，性能影响可忽略。
4. 页面若被裁剪掉锚点，注入静默跳过，前端仍可用字面量副本（测试覆盖无锚点分支）。
5. 未运行 npm run build（按派发单要求，dist 由 Lead 统一构建）。

## 六、架构 / 接口变更建议

1. 建议把 MAX_DATA_BYTES 注入改为取 portal/lib/archive.mjs 的有效值（该值默认来自 shared，支持环境变量覆盖），彻底消除页面提示与服务端校验在覆盖场景下的不一致。
2. 后续若 portal 引入打包步骤，可直接 import shared/data_formats.mjs，删除字面量副本与本注入机制。
3. 注入载荷可扩展为通用契约集合（数据角色、文件数上限等），减少后续手抄点。

## 七、待主 Agent 决策事项

1. 是否接受注入 MAX_DATA_BYTES 取 shared 默认值（当前实现），还是改为取 archive.mjs 的有效值。
2. 全量测试中 aims_drift_guard §八（SPEC_DECISIONS.md 缺失）与队友并行测试的失败不属本切片，需由对应负责人收口。

## 八、建议下一步

1. Lead 统一构建 dist 并跑一次全量回归，确认除已知红外全绿。
2. 决定是否采纳「注入有效 MAX_DATA_BYTES」的改进。
3. 若后续修改白名单 / 黑名单，只需改 shared/data_formats.mjs 与 BioanalysDesktop/server/tumor_blacklist.js，页面通过注入自动跟随。
