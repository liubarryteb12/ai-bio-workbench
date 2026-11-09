# Matt Pocock 工程规范（Codex 工作流版）

> version 1 | 2026-10-23
> 提取自 `references/01.工程规范/mattpocock-skills`（Matt Pocock 的 agent skills 仓库）。
> 本文件是可执行口径，不是仓库说明：原仓库各 `SKILL.md` 保留完整步骤，这里只留判定、门槛与不变量。
> 配套 [mattpocock-writing-spec.md](mattpocock-writing-spec.md)（写 agent 文档的规范）；
> 与 [coding-standards.md](coding-standards.md) 分工：那份管代码怎么写，本文件管活怎么干。

## 定位：这套规范在对抗什么

上游的出发点不是流程托管（GSD / BMAD / Spec-Kit 那一类接管流程的方案），而是四个具体失效模式，
每个对应一个修法。技能被刻意做成小、可改、可组合，换模型照样跑。

| 失效模式 | 症状 | 修法 |
|---|---|---|
| 没对齐 | 你以为他要 A，做出来是 B | grilling：动手前先盘问 |
| 太啰嗦 | agent 用 20 个字说 1 个字能说清的事 | 共享词汇：`GLOSSARY.md` |
| 跑不起来 | 对齐了还是产出烂代码 | 反馈闭环 + TDD 红绿循环 |
| 烂泥球 | agent 提速的同时也在加速软件腐化 | 每天投设计：deep module |

## 一、调用约定（元规范）

先定"谁能触发谁"，否则后面全是空话。分界只看一件事：谁能触发。

- **user-invoked**：只有人打字能触发。frontmatter 加 `disable-model-invocation: true`，
  Codex 侧在 `agents/openai.yaml` 配 `policy.allow_implicit_invocation: false`。
  此时 `description` 是给人扫的一行摘要，删掉 "Use when the user says..." 那类触发词表。
  代价是认知负载：你得自己记得有这门技能。
- **model-invoked**：人和模型都能触发，默认形态。`description` 是给模型看的顶层
  context pointer，必须常驻，保留触发短语。换来可发现性，也换来常驻的上下文成本。

三条硬规则：

1. user-invoked 技能**永远不能被另一个技能调到**，包括用 Skill tool 点名。
2. user-invoked 可以调 model-invoked；model-invoked 之间也可以互相调。
3. 依赖写成显式指令：`Call the Skill tool with "tdd"`。不写 `../other-skill/FILE.md` 深链，
   不写裸 `/tdd` 让模型自己猜。一次调用只带一个技能名；要两个就写成"调用两次"。

前置条件本身是 user-invoked 技能时（如 `setup-matt-pocock-skills`），措辞只能是
"让用户去跑 `/xxx`"，不能是让 agent 去调它。

## 二、主链：idea 到 ship

大多数活走这条路，三个分支点逐条问。

1. **grill-with-docs**：有工作目录就用它。它跑 `grilling` 加 `domain-modeling` 两个
   model-invoked 技能，边盘问边把 `GLOSSARY.md` 和 ADR 写下来。没有工作目录才用 `grill-me`；
   两者跑同一个盘问原语，区别只在于留不留纸迹。
2. **分支：这个问题能不能全靠对话解决？** 需要可运行的答案（状态模型、业务逻辑、
   必须亲眼看的 UI）就绕去 `prototype`，两端都用 `handoff` 桥接，因为原型活在独立目录里。
3. **分支：这是多会话的活吗？**
   - 是：`to-spec`（把线程综合成 spec，不再面试）接 `to-tickets`（切成 tracer-bullet 票，
     每票声明阻塞边），然后二选一：
     - `implement` 逐票做，**每票之间清上下文**；
     - `implement-spec` 一把梭，把票当 task graph，子代理并行跑 frontier，全落一条集成分支。
   - 否：直接 `implement`，就在当前窗口做。

   两条路都靠 `tdd` 一块红绿切片一块红绿切片地推，都以 `code-review` 收尾。
   上 PR 时用 `pr` 模板塑身。
4. **retro**：收口。回看这一会话，提议改**环境**（导航指针、自动检查、编码标准、
   steering 文件、工具）。机械失误变成确定性检查，判断题变成编码标准。

**上下文卫生**：步骤 1 到 3 保持在一个不中断的窗口里，`/to-tickets` 之前不要 compact 或 clear，
盘问、spec、票要共享同一套思考。上限是 smart zone（约 150k token）；
到界了就在最近的相位边界 compact，别带着降级的脑子硬推。

## 三、上匝道：产生活的三条入口

- **issue 堆起来了**：`triage`。只处理**不是你提的** issue：bug 报告、别人提的需求。
  `to-tickets` 产出的票本身已经 agent-ready，不要再 triage 一遍。
- **有东西坏了**：`diagnosing-bugs`。留给硬 bug：看一眼看不出的、间歇性的、
  两个已知良好状态之间溜进来的回归。修完在同一个会话里跑 `retro` 问"什么能防住它"；
  如果真正的发现是"没有好的 seam 能把它锁死"，那是 `improve-codebase-architecture` 的活。
- **大到装不进一个会话**：`wayfinder`。这里到目的地的路还看不清楚，它在 tracker 上画一张
  决策票地图，一次解一张票，**产出决策，不产出交付物**。地图清了之后从 `to-spec` 并回主链，
  不要直接跳 `implement`，那会把地图里的关联细节全丢掉。

## 四、相位边界：什么时候换上下文

**相位**是一个会话里的一块活（盘问、实现、QA）。**相位边界**是两块之间的缝，
这个决策只属于边界；中途没有这个决策可做，继续或者把剩下的拆给子代理。

五个选项，按序问，第一个 yes 就赢：

1. **这个会话能继续吗？** 下一相位需要本相位当**主源**，或者 smart zone 还够，
   就 **Continue**。继续不花钱也不丢东西，所以第一个排除它。
2. **上下文对接下来的活毫无关系吗？** 探索、决策、死路全都可弃，就 **`/clear`**。
   棋盘上最便宜的一步，且不清空历史，旧会话还能恢复。
   判错的代价是单向的：清了相关上下文，"为什么这么做"就没了，把 diff 读回来也要不回来。
3. **需要交接吗？** 只有四种情况：换 harness、换目录或仓库、交给同事、
   或者中途分叉一个支线任务。`/handoff` 买的是**可移植性**，一个能带着走的文件。
   没什么在走，就不需要它。
4. **这活能 AFK 干完吗？** 范围够紧、不需要你盯着，就 **subagent**。自动评审是标准场景。
5. **否则 `/compact`**。上下文相关、同 harness、同目录、你还要在场，树就落在这儿，
   而且经常落在这儿。给它一句指令（`/compact we're going to QA this area`），
   让摘要留下下一相位要的东西。

除 Continue 之外，每一步都在把**主源**换成**次源**：真实发生的会话被一份摘要取代。
主源信息全、噪声多、没什么腾挪空间；次源有损、干净、腾挪空间大。
所以第 1 问排第一：只有"留着比省下贵"的时候才付那份有损。
compact 是**默认，不是首选**；一上来就 compact 的失效模式是新会话对某个被摘要压平的决策
信心满满地搞错。

## 五、每门技能的硬门槛

摘要只用于定向。要动真格，或要判断某一步能不能跳，去读原 `SKILL.md` 全文。

### grilling（盘问）

把设计看成一棵 **design tree**：每个决策分出挂在它下面的决策。按 **rounds** 推进，
**frontier** 是前置已定的那批决策，也就是现在就能问、不用猜没听到的答案的问题。
一轮把整个 frontier 一次问完，编号，每题附推荐答案，然后等回答再进下一轮。
措辞让 "yes" 等于接受你的推荐答案。

查**事实**是 agent 的活，永远不是用户的：需要环境里的事实就派子代理，
别问用户你本来能自己查的东西，也别被它堵住，只让下游问题等它报告。
做**决策**是用户的。frontier 空了才叫聊完，且用户确认达成共识之前不动手。

### tdd

- **只测约定好的 seam。** 写任何测试之前，先把要测的 seam 写下来并和用户确认；
  没有在未确认的 seam 上写的测试。测不完所有东西，事前约定 seam 就是让测试精力
  落在关键路径和复杂逻辑上，而不是每个边界情况。
- **红先于绿。** 先写失败测试，再写刚好让它过的代码。不预判后续测试，不加投机功能。
- **一次一个垂直切片。** 一个 seam、一个测试、一个最小实现。
- **重构不属于这个循环**，归 review 阶段。
- 三类反模式：**实现耦合**（mock 内部协作者、测私有方法、走侧信道验证）；
  **同义反复**（期望值按代码的方式重算一遍，构造上就不可能失败；
  期望值必须来自独立真源，已知正确的字面量、算好的例子、spec）；
  **水平切片**（先写完所有测试再写所有实现，测的是想象中的行为）。
- mock 只 mock 系统边界（外部 API、数据库、时间与随机、文件系统），
  自己的类和内部协作者不 mock。可测性靠**接住依赖而非自己造**：依赖注入、
  SDK 式细粒度接口、返回结果而不是改副作用。

### diagnosing-bugs

**Phase 1 就是这个技能本身**，其余都是机械操作。有一条对**这个** bug 会变红的
**tight** 信号，你就会找到原因；二分、假设检验、插桩都只是在消费它。
没有它，盯着代码看再久也白搭。这一步要花不成比例的功夫，要 aggressive，要有创意，不许放弃。

构造反馈环的办法，大致按优先级：失败测试，curl 打 dev server，CLI 喂固件 diff stdout，
无头浏览器脚本，回放捕获的 trace，一次性 harness，属性或模糊循环
（"有时输出错"就跑 1000 个随机输入看失效模式），二分 harness（能 `git bisect run`），
差分循环（新旧版本或两种配置喂同一输入再 diff 输出），HITL 脚本（最后手段，
用模板把人也纳入结构化循环）。

有了环就**收紧**它：更快（缓存 setup、跳过无关初始化、收窄范围）、
信号更锐（断言具体症状，不是"没崩"）、更确定（钉住时间、种子 RNG、隔离文件系统、冻住网络）。
30 秒的 flaky 环跟没有差不多，2 秒的确定性环才是调试超能力。
非确定性 bug 的目标不是干净复现，是**更高复现率**：循环触发 100 次、并行、加压、收窄时序窗口。
50% 的 flake 可调试，1% 不可调试。

**Phase 1 完成判据**，四条全中才算完：一条你**已经至少跑过一次**（贴出调用和打码输出）、
命名得出来的**一条命令**，并且 red-capable（驱动真实 bug 路径、断言用户的原话症状，
能因这个 bug 变红，不是"跑没错"）、deterministic、fast（秒级）、agent-runnable。
**在 Phase 2 之前不许靠读代码建立理论。**

后续相位：Phase 2 复现并最小化，一次砍一个元素、砍完重跑，直到每个剩下元素都是承重的；
Phase 3 先出 3 到 5 个**可证伪**的排序假设（"如果 X 是原因，那么改 Y 会让 bug 消失"），
给用户看过再验；Phase 4 一次只动一个变量，日志打唯一前缀（`[DEBUG-a4f2]`），
性能回归走基线测量再二分，不打"什么都记然后 grep"；
Phase 5 先写回归测试再修，但先确认存在**正确的 seam**，
seam 太浅给出的回归测试是假信心，**没有正确 seam 本身就是发现**，要记下来；
Phase 6 清理：原复现不再复现、回归测试过、`[DEBUG-...]` 全清、
一次性原型删掉或挪到明确标记处、正确的假设写进 commit 或 PR 让下一个 debugger 学到。

### code-review

两个轴并行跑子代理，互不污染，报告**不合并、不重排**：
**Standards**（代码符不符合本仓库成文标准，加 Fowler 气味基线）和
**Spec**（有没有忠实实现来源 issue 或 spec）。分开报是因为一个轴会掩盖另一个：
全守标准但做错了东西，是 Standards 过 Spec 挂；照 issue 做了但破了约定，反过来。

气味基线 12 条，永远标注为判断题：Mysterious Name、Duplicated Code、Feature Envy、
Data Clumps、Primitive Obsession、Repeated Switches、Shotgun Surgery、Divergent Change、
Speculative Generality、Message Chains、Middle Man、Refused Bequest。
两条绑定规则：**仓库规范优先**（成文标准背书的东西，压掉对应气味）；
**永远是判断题**（写成 "possible Feature Envy" 这种带标签的启发式，不是硬违规）。
工具已经管的一律跳过。

### codebase-design（词汇层）

术语固定用，不许换成 component / service / API / boundary。
**module** 是有接口和实现的任何东西，尺度不限；
**interface** 是调用方正确使用它必须知道的一切，签名、不变量、顺序约束、错误模式、
必填配置、性能特征；**implementation** 是模块内部的代码体；
**adapter** 是在 seam 上满足接口的具体东西，说的是角色不是内容；
**depth** 是接口处的杠杆，每学一点接口能驱动多少行为；
**seam** 是能不在此处编辑就改掉行为的地方，模块接口所在的位置；
**leverage** 是调用方从深度得到的东西，**locality** 是维护者得到的。

原则：**接口就是测试面**（调用方和测试过同一个 seam，想测到接口外面去，
说明模块形状不对）；**删除测试**（删掉它复杂度是消失了，还是在 N 个调用方处复活，
前者是穿针引线，后者才是在干活）；**一个 adapter 是假想 seam，两个才是真的**
（没有东西真的在变，就别开 seam）。可测性三招：接住依赖、返回结果而非改副作用、缩小接口面。

### to-spec、to-tickets、implement

- `to-spec` **不面试**，只综合已知。动手前先草拟要在哪些 seam 上测，
  **已有 seam 优先于新 seam，用尽可能高的那个，理想数量是一个**，然后和用户核对。
- `to-tickets` 切 **tracer bullet** 垂直切片：窄但**完整**穿过每一层
  （schema、API、UI、tests），做完本身可演示可验证，大小塞进一个全新上下文窗口。
  每票声明阻塞边，先出阻塞者。**宽重构是例外**：机械改动、爆炸半径铺满全库、
  一刀下去几千个调用点同时红、没有垂直切片能独自绿。别硬塞进 tracer bullet，
  排成 **expand-contract**：先 expand（新旧并存，什么都不破），
  再按爆炸半径分批迁移（每批一票，被 expand 阻塞，逐批保持 CI 绿），
  最后 contract（没有调用方了才删旧形，被每一批阻塞）。
- `implement` 在约定好的 seam 上调 `tdd`，规律地跑类型检查、单测文件、整跑一遍测试，
  完了调 `code-review`，然后提交到当前分支。
- `implement-spec` 把票当 task graph，子代理各自在自己 worktree 和分支上做，
  报告前把集成分支尖端合进自己；完成一个就由一个 merger 子代理合回来，
  frontier 变了就再放新的 implementer。与子代理的沟通要**稀疏**，
  主要走 **context pointer**（指向 spec、票、研究笔记、此前的 commit），
  不重复指针已经能给的东西。

### pr

Summary 用**最小的那个视图**把关键处讲清楚（伪代码、调用树、组件树、文件树、
mermaid、diff，按主题选，别堆）；Evidence 给**能用的前后证据**，
截图是 S 级，执行类（测试结果、控制台输出）是 A 级；
Merge Danger 判**单向门还是双向门**（能回退的是双向门，破坏性、难回退的是单向门），
外加一句话的 blast radius。

### retro

改**环境**不改代码。候选按严重度排：导航（找文件花了多久、要不要加 navigation pointer）；
自动检查（agent 犯的错有没有检查能接住，**先读仓库自己的 check 命令**，
已经存在但没接上或静默坏掉的检查才是发现，不是重新造一个，
没有 guardrail 本身就是发现）；编码标准（先分类违规，**机械类**包括固定语法模式、
禁用 API、import 形状、文件位置，一律上确定性检查，默认做检查而不是写规则，
`CODING_STANDARDS.md` 只留给真正的判断题）；全局 `AGENTS.md`
（steering 指令是不是该挪去编码标准或自动检查）；工具经济；no-op 指令；信息可达性。

分工依据：实现 agent 上下文压力最大，要探索、写码、调试；
评审 agent 压力最小，只收到一个 diff。**所以编码标准该由评审 agent 执行，不是实现 agent。**

## 六、贯穿全链的不变量

- `GLOSSARY.md` 保持**纯净**：只有术语，不含实现细节。不当 spec 用、不当草稿本用、
  不当实现决策库用。多上下文仓库用 `GLOSSARY-MAP.md` 指向各处。
- **ADR 三条件全中才写**：难回退、没有上下文未来读者会问"为什么这么干"、
  是一次真权衡的结果。少一条就跳过。ADR 可以只有一个段落，
  价值在于记下"做了这个决定以及为什么"，不在于把章节填满。
- **一个含义一个真源。** 文档重复环境（`package.json` scripts、配置、目录布局、`--help` 输出）
  就是缓存，只在查找很贵时才配花这个负载：缓存 agent 查不到的东西，
  不成文的约定、选择背后的理由、配置不肯招的坑。
- **逐句过相关性检查**：它还管不管这份文档干的事。不修剪的默认结局是 **sediment**：
  因为"加着安全、删着危险"而沉积的过期层，直到你得钻透它找还活着的东西。
- **每条都当 no-op 审一遍**：相对模型默认行为改变了什么？没改变就整句删掉，不要抠字眼。
- **先打码再展示**。所有命令、输出、捕获产物里的 secret 写成 `<REDACTED>`。
  环要建在环境变量上，别建在你展示的东西里。

## 怎么用起来

三条路，按要不要自动更新选一条：

1. **Codex 插件市场**（自动更新，推荐）：

   ```bash
   codex plugin marketplace add mattpocock/skills
   codex plugin add mattpocock-skills@mattpocock
   ```

2. **skills.sh**（复制可编辑文件进项目，自己改自己更新）：

   ```bash
   npx skills@latest add mattpocock/skills -a codex
   ```

3. **只取规范不取技能**：就用本目录这两份文档，把该动的手动纪律搬进 `AGENTS.md`
   和 `CODING_STANDARDS.md`。注意 `AGENTS.md` 每轮都进上下文，
   按上游规范只放**导航指针**，别把流程抄进去；流程放 skill 或参考文档，用指针指过去。

装完先跑一次 `/setup-matt-pocock-skills`，把 issue tracker、triage 标签、文档布局定下来，
其余工程技能都假设这三样已经配好。其中 `to-tickets`、`to-spec`、`triage` 是**硬依赖**：
没有映射，产出是错的，不只是糙；`tdd`、`diagnosing-bugs`、
`improve-codebase-architecture` 是**软依赖**，只是输出不够锐。
