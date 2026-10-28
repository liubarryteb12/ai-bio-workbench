# 架构裁定与变更台账（SPEC_DECISIONS）

> 物理落点：本文件（aims §八 台账②）。记录所有触及 aims 条款或跨模块契约的裁定。
> 纪律：任何触及 aims.txt 条款或跨模块契约的变更，先在本文件立项，再改代码，再改断言。
> 编号连续，不回收不复用。新增追加到末尾。禁止删除历史裁定（推翻旧裁定用「取代 D-XX」表述）。

字段顺序固定：编号 / 日期 / 问题背景与冲突点 / 备选方案对比 / 最终拍板结论 / 受影响条款 / 同步修改文件清单 / 验证测试名。

---

## D-01 跨线同名脚本不抽公共库（接受四组分叉）

- **日期**：2026-10-20
- **问题背景与冲突点**：line1/line2/line3 存在四组同名脚本（enrichment、enrichment_figures、dr_post_analysis、normalize_hvg），代码相似度高，直觉上应抽公共库。但三线物理隔离是铁律，公共库会让一条线的改动同时影响另外两条线。
- **备选方案对比**：① 抽 src/common/ 公共库：省重复代码，但破坏物理隔离，且任一线路需求变化都要改共享文件（回归面扩大三倍）；② 保持分叉：代码重复，但每条线可独立演进、独立回归。
- **最终拍板结论**：保持分叉。已实测的分叉规模：enrichment 196 行 vs 289 行、enrichment_figures 331 vs 343、dr_post_analysis 497 vs 442、normalize_hvg 198 vs 256，差异已达语义级（不是格式差异），抽库必然引入条件分支。
- **受影响条款**：§一.2 铁律 2（三线物理与逻辑硬隔离）、§四 三线母版。
- **同步修改文件清单**：无代码改动（决定保持现状）；con_hf/architecture_review_2026-10-20.md 记录 C1 结论。
- **验证测试名**：tests/bridge_guard_invariant.test.js（三线母版不许跨线 import）、tests/consistency.test.js。

## D-02 不做框架重构，只做断链补齐 / 重叠收敛 / 历史清理

- **日期**：2026-10-20
- **问题背景与冲突点**：用户原话「工作台越做越臃肿、功能越做越烦，框架没想象中好、效率没想象高」，倾向重构。评审实测结论是架构没坏，臃肿来自门户（portal 8080）、工作台（8787）、运维三套系统各自实现了一遍守护、日志检查、链接检查。
- **备选方案对比**：① 框架重构（拆分服务、统一内核）：工期不可控，且当前 M1 阻塞未清零，重构会把已 PASS 的 137 张图与 296 条测试基线全部置于风险中；② 只做 A 批（断链补齐，无争议）+ B 批（不可逆清理，需授权）+ C 批（决定保持），重叠逻辑用「单一事实源 + 编译期注入」收敛而非重构。
- **最终拍板结论**：选 ②。A 批直接干；B 批列出清单等用户一句话授权；C 批写进本台账不再讨论。
- **受影响条款**：全篇工程纪律（§八）。
- **同步修改文件清单**：con_hf/architecture_review_2026-10-20.md、con_hf/handoff.md。
- **验证测试名**：tests/aims_drift_guard.test.js（条款与落点不得漂移）。

## D-03 桥接四项断言改为阶段感知（--stage post-dimred / pre-dimred）

- **日期**：2026-10-21
- **问题背景与冲突点**：verify_bridge_checkpoint.py 第 4 项要求 h5ad 必须带 X_pca / X_umap / spatial，但 gsva_pathways 消费的是降维前的归一化矩阵（scrna_norm.h5ad），天然没有这些 obsm，导致合法输入被判 fail；若为此放宽断言，又会让真正缺失降维结果的矩阵蒙混过关。
- **备选方案对比**：① 直接删掉第 4 项断言：A 面（真缺降维）失去保护；② 方案 B「阶段感知」为主 + 方案 A「母版改造」为辅：引擎加 --stage，pre-dimred 阶段把该项降级为 [BRIDGE WARN] 并放行，post-dimred 阶段维持硬失败；同时 gsva_pathways 优先消费 00_sc_harmony.h5ad（有 obsm，走 post-dimred 硬断言），文件不存在才回落 scrna_norm.h5ad 并同步降级 stage。
- **最终拍板结论**：选 ②。守卫侧同样加 --stage（默认 post-dimred，非法值打印 [BRIDGE SKIP] 到 stderr 并 exit 0，不让守卫本身成为阻塞），R/Python 双引擎共用同一口径。
- **受影响条款**：§一.2 铁律 3、§三.2 三道闸 ③。
- **同步修改文件清单**：ops/verify_bridge_checkpoint.py（--stage argparse、warn()、check_h5ad/check_rds 分支）、src/bridge_guard.sh（--stage 透传）、src/line2_scrna/scripts/gsva_pathways（输入源解析 + BRIDGE_STAGE + BIO_GSVA_NORM 传参）、BioanalysDesktop/tests/bridge_stage.test.js（新建）。
- **验证测试名**：tests/bridge_stage.test.js（11 条，含真跑 anndata fixture 与 bash 真跑解析块）、tests/bridge_guard_invariant.test.js。

## D-04 守卫双落点 + 母版候选路径解析（部署布局与仓库布局不同）

- **日期**：2026-10-21
- **问题背景与冲突点**：母版在仓库里位于 src/<线>/scripts/<step>，相对路径 ../../bridge_guard.sh 指向 src/bridge_guard.sh；但真机部署后母版在 /mnt/ssd/bio_data/bin/<线>/<step>（task.js 的 binDir 进 PATH），同一相对路径解析成 /mnt/ssd/bio_data/bridge_guard.sh，守卫根本不在那里，等于部署后守卫静默失效。
- **备选方案对比**：① 只改部署目录结构：要动 bin/ 布局与 PATH 契约，影响面大；② 双落点 + 候选解析：src/bridge_guard.sh 作为仓库唯一正本，同步脚本额外镜像一份到远端 ops/bridge_guard.sh；母版按候选列表（相对路径 → /mnt/ssd/bio_data/ops/bridge_guard.sh → /mnt/ssd/bio_data/bridge_guard.sh）解析，全找不到时打印 [BRIDGE SKIP] 放行并留痕。
- **最终拍板结论**：选 ②。理由：守卫是「保护性设施」，它的缺失不该让分析母版跑不起来（那会把保护变成故障源）；但必须留痕，便于运维发现漏部署。
- **受影响条款**：§一.2 铁律 3、§六 本地与远端原子同步。
- **同步修改文件清单**：src/line2_scrna/scripts/gsva_pathways（候选路径循环）、ops/sync_and_verify_remote.ps1（第 5.5 步镜像部署 + 哈希校验）、con_hf/ops_ledger.md（自动追加）。
- **验证测试名**：tests/bridge_stage.test.js（gsva 守卫候选路径静态断言）。

## D-05 上传白名单单一事实源 + 门户编译期注入（禁止三份手抄）

- **日期**：2026-10-21
- **问题背景与冲突点**：14 类扩展名与 5GiB 上限在 shared/data_formats.mjs、portal/lib/archive.mjs、portal/index.html 三处各写一份，改一处漏两处的风险已经实际发生（历史上出现过 9 项 vs 14 项不一致）。
- **备选方案对比**：① 门户改为构建期打包：需要给 portal 引入构建链，与「单文件 index.html 双击可用」的离线交付定位冲突；② 服务端注入 + 字面量回落：portal/serve.mjs 只读 import 权威值，注入到 HTML 的 JSON 块，页面脚本命中注入就覆盖本地副本，未命中（离线双击）回落字面量，parity 测试继续钉住字面量副本与权威值一致。
- **最终拍板结论**：选 ②。注入走 scriptSafeJson（转义 < 与 U+2028/2029），注入失败不影响页面可用性。
- **受影响条款**：§三.1 模块 B。
- **同步修改文件清单**：portal/serve.mjs（sharedContractsPayload / scriptSafeJson / injectSharedContracts）、portal/index.html（注入锚点 + #region P5 shared contracts 覆盖段）、BioanalysDesktop/tests/portal_inject.test.js（新建 16 条）。
- **验证测试名**：tests/portal_inject.test.js、tests/data_format_parity.test.js、tests/tumor_blacklist_parity.test.js。
- **已知边界**：注入的 MAX_DATA_BYTES 取 shared 默认值，不感知 portal/lib/archive.mjs 的 PORTAL_MAX_DATA_BYTES 环境变量覆盖；运维若改过该 env，页面提示与服务端校验会不一致（待后续收敛）。

## D-06 上传会话额度用 reservedBytes 硬预留，413 与 507 分属两级

- **日期**：2026-10-21
- **问题背景与冲突点**：客户端在 init 时声明 fileSize，但服务端此前只按实际落盘字节算配额，等于「声明 20GiB 也先放进来」，全局配额耗尽时其它会话被饿死；同时缺会话级闸门，单片超限只能靠最终 assemble 失败。
- **备选方案对比**：① 只做全局配额：简单，但恶意/误操作会话可长期占坑；② 会话预留 + 两级错误码：init 落 session.json 记录 reservedBytes（写 tmp 再 rename，原子），chunk 写盘前依次过 400（参数）/ 413（会话额度）/ 507（全局配额），complete 成功后显式清元数据。
- **最终拍板结论**：选 ②。顺序固定，不允许调换（400 是调用方错误，413 是会话越界，507 是系统容量，混用会让前端无法正确提示）。
- **受影响条款**：§三.1 模块 B。
- **同步修改文件清单**：BioanalysDesktop/server/upload.js（normalizeReservedBytes / writeSessionMeta / readSessionMeta / checkReservedBytes / checkChunkAdmission）、BioanalysDesktop/server/index.js（init 落元数据 + chunk 闸门 + complete 清理）、tests/upload_reserve.test.js（新建 23 条）。
- **验证测试名**：tests/upload_reserve.test.js、tests/upload_quota.test.js。
- **已知边界**：额度是客户端声明值，不报 fileSize 则只有全局 507 兜底（兼容老客户端）；checkChunkAdmission 与 writeChunk 之间非原子，同一 uploadId 并发两片理论上可各自通过检查。

## D-07 自检第 4 维 SHA256 口径：不一致 fail / 缺失 warn / 不可达 unknown

- **日期**：2026-10-21
- **问题背景与冲突点**：aims §三.3 第 4 维要求「比对本地与远端 bridge_guard.sh 及核心母版的 SHA256，不一致即判 warn/fail」，但实现只有隔离门禁与桥接在位检查，属规格漂移。难点在远端不可达时的判定：若判 fail，一次网络抖动就会让整个自检全红，值班会失去对红灯的信任。
- **备选方案对比**：① 不可达判 fail：信号强但噪声大；② 沿用「远端输出缺 END 一律 unknown」的既有口径：不可达判 unknown，守卫哈希不一致判 fail，守卫缺失判 warn。
- **最终拍板结论**：选 ②。理由：unknown 语义就是「这次没测出来」，与 fail「测出来是坏的」必须区分，否则四档状态形同虚设。
- **受影响条款**：§三.3 第 4 维。
- **同步修改文件清单**：BioanalysDesktop/server/selfcheck.js（第 4 维新增 sha256 比对）、tests/selfcheck_sha256.test.js（新建）。
- **验证测试名**：tests/selfcheck_sha256.test.js、tests/selfcheck.test.js。

## D-08 server/proc.js 必须用默认导入 child_process（测试垫片可拦截）

- **日期**：2026-10-21
- **问题背景与冲突点**：P4 切片写 HTTP 级 complete 用例时用 mock.method(childProcess, spawn|spawnSync) 想拦住 scp/ssh，实际拦不住：server/proc.js 用具名导入 import { spawn, spawnSync }，具名绑定在链接期固化，改 module.exports 属性无效。结果测试真连 K40，往 raw_data 写了两个探针文件。
- **备选方案对比**：① 测试改成不触网的目录级用例（回避）：留下同款隐患，另外 5 个测试文件用同一套失效垫片，只是恰好没走到 scp/ssh；② 接缝改默认导入 + 属性调用：一处改动让全部垫片真生效。
- **最终拍板结论**：选 ②，并作为铁律写进本台账：凡是可被测试替换的接缝，一律默认导入 + 属性调用，禁止具名导入外部可变依赖。
- **受影响条款**：§八.2 文件域写隔离与契约冲突升级（接缝属共享契约）。
- **同步修改文件清单**：BioanalysDesktop/server/proc.js（import childProcess from node:child_process，调用改 childProcess.spawn / childProcess.spawnSync）、tests/sync_script_guard.test.js（新建静态断言防回归）。
- **验证测试名**：tests/sync_script_guard.test.js、tests/upload_reserve.test.js（改用不触网用例）。

## D-09 同步脚本三条硬规矩：printf 喂 xargs、传完归一化权限、过滤 ssh Warning

- **日期**：2026-10-21
- **问题背景与冲突点**：ops/sync_and_verify_remote.ps1 首次真跑连踩三坑：① 把单引号路径串直接管道给 xargs sha256sum，shell 会去执行这些脚本（bridge_guard.sh 报 Permission denied、run_throttled_task.sh 被无参执行）；② scp 不带 -p，落盘 0644，母版按名字直接调用 ops 脚本时 Permission denied；③ ssh 的 known_hosts 提示走 stderr，2>&1 后混进输出，把「按行首锚定」的哈希正则顶掉，导致 18 个文件全判「远端无回读」。
- **备选方案对比**：① 三处分别打补丁；② 立三条硬规矩并加静态断言：路径清单必须先 printf 再管道；scp 之后按后缀 chmod（.sh 755 / 其余 644）；Invoke-Remote 统一过滤 Warning 行。
- **最终拍板结论**：选 ②。第 ③ 条特别重要：解析远端输出时永远不能假设输出干净（与踩坑台账 #90 同源）。
- **受影响条款**：§六 本地与远端原子同步、§八.3 防漂移。
- **同步修改文件清单**：ops/sync_and_verify_remote.ps1、tests/sync_script_guard.test.js（新建静态断言）。
- **验证测试名**：tests/sync_script_guard.test.js；真跑证据见 con_hf/ops_ledger.md 最后一行（18/18 一致、镜像 1/1 一致、exit 0）。

## D-10 反卷积按用户裁定跳过（D7）

- **日期**：2026-10-20
- **问题背景与冲突点**：line3 空间转录组反卷积（cell2location / RCTD 类）在 7.5GB 内存墙下不可行，评审曾建议改 CIBERSORTx 或跳过。
- **备选方案对比**：① 换轻量算法（RCTD 仍需参考矩阵，内存不可控）；② 跳过并在交付物中如实披露缺失项。
- **最终拍板结论**：按用户裁定跳过，交付报告必须披露该步骤未做，禁止用替代指标冒充。
- **受影响条款**：§四 三线母版（line3 步骤清单）。
- **同步修改文件清单**：aims/aims.txt（§四 步骤清单标注跳过）。
- **验证测试名**：tests/aims_drift_guard.test.js（条款与落点一致）。

## D-11 HTML 交付报告渲染器定位：离线单文件、纯标准库、不并入 build_client_report.py

- **日期**：2026-10-21
- **问题背景与冲突点**：交付物此前只有 Markdown 与 PDF 链路，客户拿到 md 体验差；但 build_client_report.py 已 117KB 且承担清单与校验和职责，把渲染塞进去会让单一职责崩掉。
- **备选方案对比**：① 并入 build_client_report.py：少一个文件，但巨型脚本继续膨胀且渲染失败会拖垮交付主链；② 独立 ops/render_report_html.py：单文件、纯标准库、--self-test 自检、退出码 0/2/1 与母版规范一致，由交付链按需调用。
- **最终拍板结论**：选 ②。渲染器只消费 delivery 目录（Analysis_Report.md + delivery_manifest.json），不反向写清单；是否接入 pullDeliverables 之后由交付链决定，接入时必须把 Analysis_Report.html 纳入清单并生成 sha256 边车。
- **受影响条款**：§三.4 交付门禁、§五 出图规范（PDF/HTML 呈现一致性）。
- **同步修改文件清单**：ops/render_report_html.py（新建）、tests/report_html.test.js（新建 23 条）。
- **验证测试名**：tests/report_html.test.js；自检 python ops/render_report_html.py --self-test 30 条 PASS。
- **已知边界**：语法白名单外的元素（图片、嵌套列表、任务列表、脚注、HTML 块）降级为纯文本；仅浅色版式。
- **补充核查（2026-10-21，本次）**：交付主链并没有断。ops/build_client_report.py:1901 已经生成 Analysis_Report.html，BioanalysDesktop/server/report.js:69 的 DELIVERABLE_NAME_PATTERNS 与 :224-228 的 pullDeliverables 把 html 列为必需件（缺了就报「远端交付件缺失」）。因此 render_report_html.py 的定位是**离线兜底与预览工具**，不并入主链，避免两套渲染器同时写同名文件互相覆盖。

## D-12 出图规范冻结：不再新增判据（C4）

- **日期**：2026-10-20
- **问题背景与冲突点**：docs/figure_spec.md 已有 15 条判据 + 4 个工具 + 负对照，137 张图三线全 PASS，是全项目最完整子系统；继续加判据会不断触发存量图返工。
- **备选方案对比**：① 继续加判据：边际收益递减、返工成本上升；② 冻结判据，只允许在真实客户投诉或数据错误时例外立项。
- **最终拍板结论**：选 ②，例外必须先在 SPEC_DECISIONS 立项。
- **受影响条款**：§五 出图规范。
- **同步修改文件清单**：无（保持现状）。
- **验证测试名**：tests/figures.test.js、ops/audit_figure_layout.py 负对照。

## D-13 五本台账落点与不可手工删改

- **日期**：2026-10-21
- **问题背景与冲突点**：aims §八 点名五本台账，但其中两本（SPEC_DECISIONS.md、pitfalls_ledger.md）此前只存在于条款文字里，物理文件不存在，防漂移测试红。
- **备选方案对比**：① 改 aims 把落点改指向已有文件（踩坑台账.md、操作台账.md）：省事，但会让条款被实现反向绑架；② 补齐两本新台账并明确与既有台账的分工。
- **最终拍板结论**：选 ②。分工：SPEC_DECISIONS.md 只记裁定（为什么这么定）；pitfalls_ledger.md 只记坑与复盘（坏了怎么修、怎么防复发），与 con_hf/踩坑台账.md（历史长台账，按 #序号）互为索引，新坑先进 pitfalls_ledger.md 拿 P 编号，再按需在踩坑台账追加细节。ops_ledger.md 由同步脚本自动追加，禁止手工编辑历史行。
- **受影响条款**：§八.1 五本核心台账。
- **同步修改文件清单**：con_hf/SPEC_DECISIONS.md（新建）、con_hf/pitfalls_ledger.md（新建）。
- **验证测试名**：tests/aims_drift_guard.test.js §八（台账落点必须物理存在）。

## D-14 桥接守卫改为「本机优先，ssh 兜底」

- **日期**：2026-10-21
- **问题背景与冲突点**：src/bridge_guard.sh 原设计只走 `ssh k40-ubuntu python3 /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py`。但母版本来就跑在计算容器里（任务引擎先 ssh 进 k40-ubuntu 再执行 step），容器内不解析 `k40-ubuntu` 这个主机名 —— 真机首跑 gsva_pathways 实测 `ssh: Could not resolve hostname k40-ubuntu` → exit 255 → `[BRIDGE SKIP]`，四项断言在真实主路径上 100% 空转（与 P-12 同类，只是从提交层搬到执行层）。
- **备选方案对比**：① 给容器加 hosts 记录让它能 ssh 回宿主：改动落在环境侧，换机即失效，且多一跳 ssh；② 守卫改成「本机引擎存在就直接 python3 调用，否则 ssh 兜底」：容器内天然命中本机分支，PC 侧仍能远程校验；③ 干脆去掉 ssh 分支：PC 侧无法校验远端文件，退化为本机专用。
- **最终拍板结论**：选 ②。新增 `BRIDGE_ENGINE_LOCAL`（默认 `/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py`，显式置空可强制 ssh）。MODE 判定顺序：本机引擎存在且 `command -v python3` → local；否则有 ssh → ssh；都没有 → SKIP。OK 文案带 `engine=local|ssh`，日志里能一眼看出走的是哪条路。
- **受影响条款**：§一.2 铁律 2（跨语言桥接四项断言）、§三.3 第 4 维（桥接引擎在位）。
- **同步修改文件清单**：src/bridge_guard.sh（MODE 判定 + local 分支 + 契约 3b）、src/line2_scrna/scripts/gsva_pathways（守卫候选路径列表，P-11 部署布局差一层）、BioanalysDesktop/tests/bridge_guard_local.test.js（新建）、tests/bridge_stage.test.js（runGuardCapture 显式置空 BRIDGE_ENGINE_LOCAL 锁定 ssh 分支）。
- **验证测试名**：tests/bridge_guard_local.test.js（7 条）；真机验证：`cd /tmp/gsva_verify/processed && BIOANALYS_SEED=42 bash /mnt/ssd/bio_data/bin/line2_scrna/gsva_pathways` → `[BRIDGE PASS] all 4 assertions passed` + `engine=local` + exit 0。

## D-15 五维自检第 4 维合并报灯 + 自检 ssh 严格化

- **日期**：2026-10-21
- **问题背景与冲突点**：aims §三.3 第 4 维原文是「跨线隔离、桥接引擎与远端版本一致性灯」—— 三件事共用一盏灯。P11 交付的 SHA256 比对若单独 push 一条 checks，界面会多出一盏 aims 里不存在的灯；反过来若只把哈希结果塞进 detail，判红时说不清是隔离门禁坏还是版本漂移。
- **备选方案对比**：① 新开第 6 盏灯：与条款冲突，前端灯位与文档对不上；② 只取最坏状态、detail 只留一句话：看不出是哪件事坏；③ 两盏子灯分开算、合并成一盏（状态取最坏，value 与 detail 并列）：既守住「一盏灯」，又能点名。
- **最终拍板结论**：选 ③。新增 `worstStatus()`（fail > warn > unknown > pass，unknown 比 pass 重：自检是门禁，没测出来不能算过）与 `mergeIsolationChecks()`，由 server/index.js 第 4 维调用。
- **同时修的既有缺陷（P-16）**：`runRemote` 丢弃 ssh 退出码，链路断时 stdout 为空 → 第 1 维把空串判成「原生 ext4」、第 2 维把空串算成 100% free，自检出现假绿灯。新增 `runSshStrict`（proc.js，退出码非 0 或输出为空即抛错），第 1~4 维全部改走严格版。
- **受影响条款**：§三.3 五维自检、§六 防崩与同步（版本漂移预案）。
- **同步修改文件清单**：server/selfcheck.js（worstStatus / mergeIsolationChecks）、server/proc.js（runSshRaw / runSshStrict）、server/index.js（import + 第 1~4 维严格化 + 第 4 维合并）、tests/selfcheck_isolation_merge.test.js（新建 16 条）。
- **验证测试名**：tests/selfcheck_isolation_merge.test.js、tests/selfcheck_sha256.test.js；真机只读探测：runSha256ParityCheck() → `status=pass, value=4/4 一致`，buildIsolationCommand() → 三线 LINE|*|0 + BRIDGE|present + END|。

## D-16 桥接引擎的失败口径：不可读输入 = 断言失败，不是「引擎不可达」

- **日期**：2026-10-21
- **问题背景与冲突点**：真机探针 `printf notah5ad > /tmp/bad.h5ad` 交给守卫，引擎抛 `OSError: Unable to synchronously open file` 的裸 traceback，守卫只看到「非 0 退出码 + 无结论」，按契约 3 归到「不可达」→ SKIP → exit 0，坏输入被静默放行（比不校验更危险）。
- **备选方案对比**：① 只改守卫（本机模式非 0 即 FAIL）：能挡住，但引擎仍吐 traceback，调用方看不到人话；② 只改引擎（把异常折成 [BRIDGE FAIL]）：守卫仍可能因为别的崩溃形态走 SKIP；③ 两边都改。
- **最终拍板结论**：选 ③。引擎侧：main 里先判 `os.path.exists`，再 `try/except` 包住校验，任何异常都折成 `[BRIDGE FAIL] 引擎无法校验输入（类型: 消息）` 并 exit 1；同时把 stdout/stderr 强制 UTF-8（Windows 宿主默认 cp936 会把中文结论写成乱码，调用方 grep 不到）。守卫侧：新增契约 3c —— 本机模式非 0 退出即 `[BRIDGE FAIL]` 并透传退出码；ssh 分支的 255/超时仍降级 SKIP（K40 离线时母版必须还能跑）。
- **受影响条款**：§一.2 铁律 2、§三.3 第 4 维。
- **同步修改文件清单**：ops/verify_bridge_checkpoint.py（存在性检查 + 异常折行 + UTF-8 输出）、src/bridge_guard.sh（契约 3c 分支）、tests/bridge_stage.test.js（+2 条真跑引擎）、tests/bridge_guard_local.test.js（崩溃改判 FAIL，另加 ssh 255 仍 SKIP）。
- **验证测试名**：tests/bridge_stage.test.js（13 条）、tests/bridge_guard_local.test.js（7 条）；真机验证：`bash /mnt/ssd/bio_data/ops/bridge_guard.sh --input /tmp/bad.h5ad ...` → `[BRIDGE FAIL] 引擎无法校验输入（OSError: ...）` + `GUARD_EXIT=1`。

### D-17 远端有两个落点：`src/`（仓库镜像）与 `bin/`（引擎真正执行）

- **编号**：D-17
- **日期**：2026-10-21
- **问题背景与冲突点**：`ops/sync_and_verify_remote.ps1` 把文件同步到 `$RemoteRoot/src/<线>/scripts/...`
  （保持仓库目录结构），而任务引擎是通过 PATH 执行 `$RemoteRoot/bin/<线>/<步骤名>`（由
  `ops/06_deploy_scripts.ps1` 部署）。两处各写各的：同步成功 ≠ 引擎跑的是新版本。
  2026-10-21 实测 `bin/` 里有 3 个母版落后于仓库（ml_diagnostics、ml_hub_analysis、virtual_knockout），
  而自检第 4 维只比「仓库 vs 镜像」，一盏灯都没亮 —— 这是比哈希不一致更隐蔽的假绿灯。
- **备选方案对比**：① 让同步脚本直接写 `bin/`（把两个落点合成一个）—— 会与 `06_deploy_scripts.ps1`
  的部署契约（同名拒绝、逐文件字节校验、可执行位复核）打架，且镜像就没人维护了；
  ② 在同步脚本末尾加「第 6 步 部署一致性」，只比对不写入，漂移就报出来（选中）；
  ③ 改自检第 4 维去比 `bin/` —— 自检是只读探针，跑一次要对 55 个文件做哈希，代价高且语义混淆。
- **最终拍板结论**：采用 ②。同步脚本第 6 步把「仓库哈希」与「远端 `bin/` 落点哈希」逐文件比对，
  输出 `[ OK ] 部署一致性：仓库与 bin/ 落点 N/N 一致` 或 `[WARN] 部署漂移 K/N`，并写进 manifest
  的 `deploy` 字段与台账的「部署」列；`-FailOnDrift` 时漂移即 exit 1。修复动作固定为
  `pwsh -File ops/06_deploy_scripts.ps1 -Force`。README.md 这类文档不进 `bin/`，不算漂移。
- **受影响条款**：aims §三.3 第 4 维（版本一致性灯的口径）；`ops/README.md` 部署章节。
- **同步修改文件清单**：`ops/sync_and_verify_remote.ps1`（第 6 步 + manifest `deploy` 字段 + 台账列）、
  `BioanalysDesktop/tests/deploy_and_parity_guard.test.js`、`ops/README.md`。
- **验证测试名**：`deploy_and_parity_guard.test.js` 的「sync_and_verify_remote.ps1 含第 6 步部署一致性」
  与「sync manifest 与台账都要带部署一致性结论」。

### D-18 部署通道的校验必须单次 ssh 批量，且「链路失败」≠「文件缺失」

- **编号**：D-18
- **日期**：2026-10-21
- **问题背景与冲突点**：`ops/06_deploy_scripts.ps1` 原本对 58 个文件逐个 `ssh stat`（58 次）+ 逐个
  `ssh chmod`（58 次）。2026-10-21 真机部署时容器在窗口内重启一次，后半段 ssh 全部失败，
  脚本把**已经成功落盘**的文件报成 `MISSING` 并 exit 1（假红灯），而实际 55 个母版全部到位。
- **备选方案对比**：① 加 `Start-Sleep` 重试整个部署 —— 治不了根，窗口还在；② 逐文件 ssh 改成一次
  批量 ssh（选中），并给「ssh 连续两次非 0」单列一档 `校验链路失败`，与「远端明确回 MISSING」分开；
  ③ 干脆去掉校验 —— 直接违背部署通道的存在意义。
- **最终拍板结论**：采用 ②。校验用一条远端命令：`printf` 把路径喂给 `while IFS= read -r p`，
  逐个回 `FILE|<path>|<size>|<exec>` 或 `MISSING|<path>`，PS 侧解析成两张表（size / exec），
  再逐文件比对；可执行位也并入同一次 ssh。chmod 同样合并成一条 `chmod 755 p1 p2 ...`。
  ssh 非 0 先重试一次，仍非 0 才判「校验链路失败（不是文件缺失）」。
- **受影响条款**：部署通道契约（ops/README.md）；M1 DoD「本地远端 SHA256 一致」的取证方式。
- **同步修改文件清单**：`ops/06_deploy_scripts.ps1`（3.5 批量 chmod、第 4 步批量校验、第 5 步可执行位复核）、
  `BioanalysDesktop/tests/deploy_and_parity_guard.test.js`。
- **验证测试名**：`deploy_and_parity_guard.test.js` 的「校验阶段必须是单次 ssh 批量」「链路失败与文件缺失必须分开判定」
  「可执行位一次批量置位」。

## D-19 黑名单二次裁定：由实现侧 27 条吸纳 12 条可用项，定为 20 条

- **编号**：D-19
- **日期**：2026-10-21
- **问题背景与冲突点**：非肿瘤黑名单出现三段沿革：规格正本 8 条 -> 实现侧自行扩充到 27 条（注释仍写"与工作台同源"）
  -> 同日先收敛回 8 条。收敛后用户裁定「以 aims 为准，吸纳 27 条中可用的并对齐」。冲突点在于：27 条里哪些是
  "规格该有的"、哪些只是同义冗余；收敛过头会漏拦（英式拼写 `tumour`、`sarcoma` 等原本拦得住），
  收得太多则条款与实现再次脱钩。
- **备选方案对比**：① 保持 8 条 —— 英式拼写与肉瘤/淋巴瘤/白血病/黑色素瘤等实体瘤会漏拦，违反铁律 1 的初衷；
  ② 全盘恢复 27 条 —— 其中 8 条被父词完全覆盖（`adenocarcinoma` ⊂ `carcinoma`、`癌症` ⊂ `癌`），
  纯属清单噪音，且回到"实现侧单方面定规格"的老路；③ 按三条判据吸纳可用项（选中）。
- **最终拍板结论**：采用 ③。**可用判据**：① 明确属肿瘤或免疫浸润语义；② 不被既有父词覆盖；③ 误伤风险可接受。
  据此吸纳 12 条：`tumour`、`sarcoma`、`lymphoma`、`leukemia`、`leukaemia`、`melanoma`、
  `immune checkpoint`、`PD-L1`、`PD-1`、`CTLA-4`、`oncogene`、`免疫检查点`；
  剔除 8 条冗余项：`adenocarcinoma`、`squamous cell carcinoma`、`tumor microenvironment`、
  `tumour microenvironment`、`tumor suppressor`、`癌症`、`肿瘤微环境`、`癌细胞`。
  最终 **8 + 12 = 20 条**。同时修正 PD 两条的边界：原 `/PD-?L?1/i` 会把 `GPD1`、`SLC40A1`
  当成 PD1 命中（真误伤），改为 `/(?<![A-Za-z0-9])PD-?L1(?![0-9])/i` 与
  `/(?<![A-Za-z0-9])PD-?1(?![0-9])/i`，仍允许省略连字符（`PDL1`/`PD1`）。
- **受影响条款**：aims §一.2 铁律 1（8 条 -> 20 条）、§三.1 模块 A「黑名单确认清单」（整块重写：英文 16 + 中文 4 +
  匹配规则 + 沿革 + 治理纪律）、§九 落点表（20 条正本）。
- **同步修改文件清单**：`aims/aims.txt`、`BioanalysDesktop/server/tumor_blacklist.js`、
  `portal/index.html`（纯前端副本，同序 20 条）、`BioanalysDesktop/tests/tumor_blacklist.test.js`（重写 16 条）、
  `BioanalysDesktop/tests/tumor_blacklist_parity.test.js`（EXPECTED 20 条 + 判定矩阵 + PD 边界）、
  `BioanalysDesktop/tests/portal_inject.test.js`（条数改为与权威实现动态比对）、
  `BioanalysDesktop/tests/aims_drift_guard.test.js`（§一.2 断言 8 -> 20）、
  `docs/delivery_supervisor_prompt.md`（监督方口径）、`项目交付报告.html`（交付材料口径 30 -> 20）。
- **验证测试名**：`tumor_blacklist.test.js` 的「黑名单恰好 20 条，且与 aims 清单逐条同序一致」「PD 边界：
  GPD1 / SLC40A1 等基因符号不许被误伤」「被剔除的 8 条冗余项仍因父词命中」；
  `tumor_blacklist_parity.test.js` 的「权威实现恰好 20 条」「portal 副本逐条与权威实现同源同序」
  「两侧判定矩阵完全一致」；`portal_inject.test.js` 的「注入的 BL_PATTERNS 与权威 20 条同序同源」。
- **遗留**：`con_hf/handoff.md`、`con_hf/操作台账.md`、`con_hf/dispatch/B3_blacklist_report.md`、
  `aims/old/*` 里出现的"8 条"是**历史记录**（描述当时的收敛动作），按台账纪律不回改；
  本条与 `con_hf/dispatch/B3_absorb_report.md` 记录二次裁定结果。
## D-20 任务运行中标记：把「被中断」变成可取证状态

- **日期**：2026-10-21
- **问题背景与冲突点**：`ops/run_throttled_task.sh` 只在任务结束时写台账。任务被容器 abort（P-23）、被 kill、
  或被 OOM 时，`system_logs/` 里**什么都不留** —— 事后无法区分「根本没跑」「跑了被打断」「跑了但脚本崩了」，
  2026-10-21 的 SCENIC 就是这样：跑了 31 分钟被 proot abort，没有台账也没有日志，只能靠外部日志反推。
- **备选方案对比**：① 不处理（现状）：台账语义干净，但中断无痕；② 任务开始就写一条 `status=running` 的正规台账、
  结束时覆盖成 completed/failed：可取证，但 `ops/03_check_logs_remote.sh` 会把 running 条目判成 VIOLATION
  （它按 `system_logs/*.json` 通配逐个校验），且「一条台账被改写两次」破坏审计可追溯性；
  ③ **运行中标记写到 `system_logs/_running/<task_id>.json` 子目录**，正常结束在写完台账后删除，异常终止才留下。
- **最终拍板结论**：采用 ③。理由：子目录天然被 `*.json` 通配排除（不污染台账校验与日志列表）；
  「标记残留」本身就是中断取证，不需要改台账语义；正常路径删除，零额外审计负担。
  配套纪律：① 删除必须排在写完台账之后，且**不许用 `trap`**（SIGTERM 也会带走证据）；
  ② 过期标记（>7 天）在脚本启动时用 `find ... -mtime +7 -delete` 清理，避免永久堆积；
  ③ 标记里记 `wrapper_pid`，便于和 Termux 侧 proot 崩溃时间点对齐。
- **受影响条款**：§三.2 任务下发与台账通道（台账通道新增「运行中标记」档，不改台账字段与校验口径）、
  §一.2 铁律 3 双保险（中断可取证）。
- **同步修改文件清单**：`ops/run_throttled_task.sh`（RUNNING_DIR / RUNNING_JSON / 过期清理 / 结束时 rm）、
  `BioanalysDesktop/tests/wrapper_running_marker.test.js`（新增）。
- **验证测试名**：`wrapper_running_marker.test.js` 的「标记落在 system_logs/_running 子目录（不污染 *.json 台账通配）」
  「标记字段齐全且 status=running」「正常结束在写完台账之后才删标记（标记残留即中断取证）」
  「过期标记（>7 天）在启动时清理」「真跑标记段：JSON 可解析、字段正确、删掉后不再存在」
  「模拟中断（不执行删除）：标记留下且可解析出中断信息」「包装器语法正确且仍是 LF-only」。
- **遗留**：标记不参与自检五维，也不进交付物；若要「中断次数」进运维报表，需另加汇总脚本（未做）。
---

## D-21 引擎下发改走「命令串模式」包装器：母版路径给门禁，命令串给 bash -c

- **日期**：2026-10-21
- **问题背景与冲突点**：`buildTaskScript` 的 throttled 分支把整条 `rawCmd`（含母版路径 + 全部 `--input`）当作
  `ops/run_throttled_task.sh` 的第 5 个参数 `SCRIPT_PATH` 传给包装器。包装器随后以 `bash "$SCRIPT_PATH"` 的方式执行，
  于是**引号、`&&`、管道、重定向全部被当成脚本路径的一部分**：单引号拼出的路径带空格即失败，`|`、`>` 直接语法错误。
  与此同时「走包装器拿线程封顶 / 门禁 / 削峰」又必须保留（`/etc/profile.d/bio_limits.sh` 只在登录 shell 生效，
  而引擎直跑母版不经过登录 shell，OMP 会裸奔到 8 核触发降频）。
- **备选方案对比**：
  ① 保持直跑（不套包装器）：最简单，但丢线程封顶 + 门禁 + 削峰，K40 上实测会掉速 30%；
  ② 修包装器的脚本路径分支，让它对 `$5` 做二次解析（eval / 按空格切）：能跑，但**任何含空格路径、含引号参数、
    含管道的命令都会以难以预料的方式失败**，等于把 shell 词法重新实现一遍，且门禁拿到的 `$5` 仍是拼接串、无法 stat 到真实文件；
  ③ **新增命令串模式**：`buildTaskScript` 只 export `BIO_EXEC_CMD=<shellQuote(rawCmd)>`（原样一条字符串，shellQuote 保证引号安全），
     包装器用 `bash -c "$BIO_EXEC_CMD"` 执行；`$5` 改传母版绝对路径 `binDir/<step>` 供门禁校验，不再承载命令。
- **最终拍板结论**：采用 ③。三条不可回退的契约：
  1. `BIO_EXEC_CMD` 分支必须排在 `EXEC_CMD`（脚本路径模式）之前，旧路径模式只作向后兼容保留；
  2. 第 5 参固定为母版绝对路径，**不许再出现 `self ${rawCmd}`**（门禁要能 stat 到真实文件，审计要能识别母版）；
  3. 台账开关 `BIO_WRAPPER_LEDGER=0` 只包住「写台账」段，`rm -f "$RUNNING_JSON"` 必须留在开关外
     （否则运行中标记永不清理，与 D-20 冲突）。
  附带收益：`run.js` 重试路径与 `index.js` 提交路径现在共用同一条 `buildTaskScript({...task, throttled:true})`，
  不会出现「重试时命令与首次不一致」。
- **受影响条款**：§六.3 任务下发通道（命令构造方式由「参数透传」改为「命令串 + 母版路径」）。
- **同步修改文件清单**：`BioanalysDesktop/server/task.js`（buildTaskScript 的 throttled 分支重写）、
  `BioanalysDesktop/server/run.js:36`（改传 `throttled: true`）、`ops/run_throttled_task.sh`（命令串模式 + 台账开关）、
  `BioanalysDesktop/tests/wrapper_exec_modes.test.js`（新增 9 条）、`BioanalysDesktop/tests/wrapper_wiring.test.js`（新增 8 条）、
  `BioanalysDesktop/tests/target_ko_gene.test.js`（$5 断言同步）。
- **验证测试名**：`wrapper_exec_modes.test.js`（真跑 patched 副本：命令串模式 exit 0 且真的写文件、引号与管道原意生效、
  `exit 7` 透传 + 台账 failed + checkpoint_status=halted、`BIO_WRAPPER_LEDGER=0` 不写台账但标记照删、脚本路径模式向后兼容；
  静态：分支顺序 / 台账开关边界 / D-21 说明 / LF-only+bash -n）；
  `wrapper_wiring.test.js`（run.js 必须 `throttled:true`、两个 export 在包装器之前、`$5`=bin 下母版绝对路径、
  **用真实 bash 解回 BIO_EXEC_CMD 与 rawCmd 逐字符比对**、审计对包装后脚本 allowed、禁止 `self ${rawCmd}` 回潮）。
- **真机验证**：`ops/run_throttled_task.sh` 已部署到 k40-ubuntu（sha256 一致）。命令串模式探针 RC=0 且产物落盘；
  `BIO_EXEC_CMD='exit 7'` 探针 RC=7 且台账 status=failed / checkpoint_status=halted。
- **遗留**：18901 引擎服务当时仍跑旧代码（P13 起的进程无 watch），翻牌后需重启并复验一步真走命令串模式。


### D-22 gmt 缓存目录环境变量化（BIO_GMT_CACHE）

- **日期**：2026-10-21
- **问题背景与冲突点**：6 个母版（src/line2_scrna/scripts/{enrichment,dr_post_analysis,tf_activity,gsva_pathways}、src/line3_spatial/scripts/{enrichment,dr_post_analysis}）把 gmt 缓存目录硬编码为 os.path.join("..", "references", "gmt_cache")（R 侧 list.files("../references/gmt_cache")）。母版 cwd 由 server/task.js 固定为 <项目>/<线>/processed，因此该相对路径恒等于 <项目>/<线>/references/gmt_cache，无法指向公共缓存或多个项目复用同一份下载。
- **备选方案对比**：① 保持硬编码（零改动，但无法跨项目共享，也无法在真机取证时指向已预热的 PRJ_E2E_* 缓存）；② 全仓改默认值（破坏既有部署与 default 项目基线）；③ 增加 BIO_GMT_CACHE 覆盖、默认值保持现路径不变（向后兼容，按需覆盖）。
- **最终拍板结论**：③ Python 侧 CACHE = os.environ.get("BIO_GMT_CACHE", os.path.join("..", "references", "gmt_cache"))、line2 dr_post_analysis 的 gmt_dir 同款、R 侧 GMT_CACHE <- Sys.getenv("BIO_GMT_CACHE", unset = "../references/gmt_cache")；失败文案带上实际目录便于定位。
- **受影响条款**：aims §六.3 部署契约（母版路径解析）；无 aims 条目数字变化。
- **同步修改文件清单**：src/line2_scrna/scripts/{enrichment,dr_post_analysis,tf_activity,gsva_pathways}、src/line3_spatial/scripts/{enrichment,dr_post_analysis}
- **验证测试名**：BioanalysDesktop/tests/gmt_cache_env.test.js（新建）

### D-23 箱线图统计显著性只保留纯水平横线（v3.1 对 aims 名义 D-18 的正式落号）

- **日期**：2026-10-28
- **编号冲突说明**：最新 aims v3.1 将四项新裁定名义编号为 D-18 至 D-21，但本台账已永久占用 D-18 至 D-22。按编号不回收规则，四项裁定正式落号为 D-23 至 D-26，并在条目中保留 aims 名义编号映射。
- **问题背景与冲突点**：`reference/05.可参考出图代码/L1_基础统计图/L1_boxplot_code.R` 与 `_meta/R453_compat/L1_boxplot_code.R` 仍含 `tip.length = 0.01`，会生成端点下折竖线。D-12 已冻结出图判据，本次用户审图反馈构成例外立项条件。
- **备选方案对比**：① 保留 `stat_pvalue_manual()` 与端点，违反用户要求；② 改为自定义 `geom_segment()`，控制力最强但与现有脚本结构差异较大；③ 保留 `stat_pvalue_manual()`，把所有比较统一锁死 `tip.length = 0`，改动最小且直接表达纯水平横线。
- **最终拍板结论**：采用 ③。正式版与 R4.5.3 兼容版必须同批修改，所有显著性标注 `tip.length` 只能为 `0`。母版变化后必须同批重跑 K40 生成新 PNG/PDF，并更新 `source_sha256`、`preview_sha256`、验证报告与预览文件。
- **受影响条款**：D-12 出图判据例外、v3.1 D-18 名义裁定、图模板 G4、图模板注册表防漂移条款。
- **同步修改文件清单**：`reference/05.可参考出图代码/L1_基础统计图/L1_boxplot_code.R`、`reference/05.可参考出图代码/_meta/R453_compat/L1_boxplot_code.R`、`L1_boxplot_README.md`、`L1_boxplot_verified.png`、`L1_boxplot_verified.pdf`、相关验证报告、`BioanalysDesktop/tests/figure_templates_parity.test.js`。
- **验证测试名**：箱线图双源 `tip.length = 0` 静态断言；K40 R4.5.3 实跑 exit 0；PNG 魔数、尺寸、非空白像素与 SHA256 校验；注册表 source/preview 双哈希一致性测试。

### D-24 图模板 ready 必须有真实分析产物映射与双轨预览（v3.1 对 aims 名义 D-19 的正式落号）

- **日期**：2026-10-28
- **问题背景与冲突点**：当前 82 个模板中 `lines`、`produces`、`analysis_output` 字段均为 0，16 个 ready 只有参考示例预览，无法证明其对应真实分析步骤和项目产物。用户要求预览与实际分析出图对应。
- **备选方案对比**：① 继续只展示 `_verified.png` 示例图；② 直接用历史项目图替换所有预览；③ 建立强映射与双轨预览：Canonical 预览由固定 fixture 在 K40 渲染，`sample_project_output` 指向真实项目产物，无映射模板降级。
- **最终拍板结论**：采用 ③。ready 模板必须具备非空 `lines`、`analysis_step`、`produces`、`output_glob` 与 `sample_project_output`。Canonical 预览和真实项目示例都必须可机器校验。无真实映射模板不得进入门户默认可用预览，只能保留在候选图库或标为 `pending_mapping`。
- **受影响条款**：v3.1 D-19 名义裁定、图模板 G1、候选图库与生产模板分离、预览 SHA256 防漂移。
- **同步修改文件清单**：`ops/build_figure_templates.cjs`、`src/figure_templates.json`、`BioanalysDesktop/server/figure_graph.js`、`portal/serve.mjs`、`portal/index.html`、`BioanalysDesktop/tests/figure_templates_parity.test.js`。
- **验证测试名**：16 个 ready 模板强映射非空率 100%；目标产物路径存在；Canonical 与 sample output 哈希一致；无映射模板不得 ready；跨线映射拒绝；门户可用预览过滤测试。

### D-25 选中模板必须在标准分析步骤之后真实执行（v3.1 对 aims 名义 D-20 的正式落号）

- **日期**：2026-10-28
- **问题背景与冲突点**：当前流程只生成并上传 `figures/adapt/` 派生副本，任务仍执行固定 `step`，三线分析脚本不读取模板。用户会看到模板和预览，但实际产出不能保证按模板生成，形成假闭环。
- **备选方案对比**：① 只允许选择固定步骤已经产出的模板；② 让每个模板成为独立前置步骤；③ 在 `analysis_step` 完成后追加真实派生图任务，执行项目私有适配脚本并读取标准中间表。
- **最终拍板结论**：采用 ③。`resolvePlan` 必须生成 `depends_on_step = analysis_step` 的派生任务，把 `figures/adapt/<fig_id>.R/.py` 上传并真实执行，输出 `custom_<fig_id>.png` 到项目对应线图件目录。任务未执行、输出缺失或哈希不符时不得标记完成。
- **受影响条款**：v3.1 D-20 名义裁定、图模板 G2、任务编排、四道闸与交付清单。
- **同步修改文件清单**：`BioanalysDesktop/server/figure_graph.js`、`BioanalysDesktop/server/task.js`、`BioanalysDesktop/server/run.js`、`ops/run_adapted_figure.sh`、图模板执行测试、Playwright 映射标签测试。
- **验证测试名**：派生任务依赖顺序测试；跨项目与跨线 adapt_vars 拒绝；K40 实跑自定义箱线图与火山图；`custom_<fig_id>.png` 回搬存在；任务失败时不产生成功台账。

### D-26 v3.1 工作树收口、项目交接、双端运行与 Final Gate 重验（v3.1 对 aims 名义 D-21 的正式落号）

- **日期**：2026-10-28
- **问题背景与冲突点**：Final Gate 13:31 通过后，工作树已累积 352 个未提交条目，单测增至 949、E2E 增至 15，项目 handoff 仍为空，8787 当前停止。旧 Final Gate 已不能代表当前发布状态。
- **备选方案对比**：① 直接 `git add .` 单次提交；② 保持未提交状态继续开发；③ 按模块边界分四批原子提交，补齐交接和双端运行，在干净工作树重跑 Final Gate v3.1。
- **最终拍板结论**：采用 ③。四批提交边界为：图库扩展与 `/figure-catalog`；模板过滤与门户 E2E；G1 至 G6 缺口修补；Final Gate v3.1 证据。提交前必须补齐 `local_projects/PRJ_AIMS_V3_20261027/handoff.md`，启动 8080 与 8787 双端，完成同步、签名、Sync 和 24 条终验。收口后创建 `release/v3.1` 与标签 `v3.1.0-final-gate`。
- **受影响条款**：v3.1 D-21 名义裁定、G5/G6/G7、发布冻结、双层台账与最终门禁。
- **同步修改文件清单**：项目 `handoff.md`、`ledger/actions.jsonl`、`con_hf/ledger/*.jsonl`、`ops/serve_guard.ps1`、`con_hf/runs/2026-10-28_final_gate_v31/REPORT.md`、Git 提交与标签。
- **验证测试名**：`git status --porcelain` 为空；8080/8787 健康；K40 链路 PASS；`npm test`、tsc、build、Playwright 全绿；`sync_and_verify_remote.ps1 -FailOnDrift` 零漂移；交付验签通过；24/24 Final Gate v3.1 判据通过。

### D-27 当前 module manifest 以 workflows.json 为权威载体

- **日期**：2026-10-28
- **问题背景与冲突点**：aims 00 与 03 用 `src/mods/*/manifest.ts`、`src/core/`、`src/engines/` 描述目标微内核形态，但当前仓库运行时真源是 `src/workflows.json` 加 `server/workflow_graph.js`、`server/figure_graph.js`。仅生成空 `manifest.ts` 让 `tsc` 通过会制造假完成，且与已经通过 K40 和 964 条测试的 JSON 注册表架构重复。
- **备选方案对比**：① 立即迁移完整 TypeScript 微内核，影响 portal、桌面端、ops 与部署链，风险过高；② 新建空 manifest 包装层，违反如实报告与 seam 纪律；③ 在当前 SSOT 上显式声明 JSON module manifest，并补齐跨注册表一致性校验，保留未来迁移空间。
- **最终拍板结论**：采用 ③。`src/workflows.json` 顶层增加 `manifest_version=2` 与 `manifest_kind=workspace_module_registry`，`server/workflow_graph.js` 校验这两个字段。当前 module manifest 的 `pipelineSteps` 语义由三线 `series/stages/mods` 承载，标准输出由每个 mod 的非空 `produces` 声明。ready 图模板的 `input_tables` 必须是绑定 `analysis_step` 对应 mod 的 `produces` 子集。
- **受影响条款**：T-LINES-01 的验收口径、G1 跨注册表一致性、微内核目标形态与当前 JSON 架构的映射说明。
- **同步修改文件清单**：`src/workflows.json`、`BioanalysDesktop/server/workflow_graph.js`、`BioanalysDesktop/server/figure_graph.js`、`ops/build_figure_templates.cjs`、`src/figure_templates.json`、`.gitignore`、`BioanalysDesktop/tests/workflow_graph.test.js`、`BioanalysDesktop/tests/figure_templates_parity.test.js`。
- **验证测试名**：JSON manifest 字段校验；三线所有 mod `produces` 非空；ready 模板 `input_tables ⊆ analysis_step.produces`；坏映射反例拒绝；6 个 ready 母版、预览、真实样例与 27 入口源文件 `git check-ignore` 证明可追踪；Node 全量回归由最终门禁刷新。
- **不能声称完成的部分**：当前不声称 TypeScript 微内核、ModLoader、CapabilityBus、SlotManager 已完成；若未来切换 `manifest.ts`，需要独立 expand-contract 迁移票。

### D-28 工作台编排端口由 8787 迁移至 18787

- **日期**：2026-10-28
- **问题背景与冲突点**：Clash Verge 的 `verge-mihomo.exe` 持有 `0.0.0.0:8787` 的 Bound 套接字，项目 Node 服务无法绑定。用户明确要求迁移到不冲突端口。
- **备选方案对比**：① 调整或停止用户代理，影响外部网络；② 保持 8787 并继续阻塞；③ 将工作台默认端口迁移到实测空闲的 `18787`，保持 `127.0.0.1` 仅环回监听。
- **最终拍板结论**：采用 ③。服务端默认端口、Vite 代理、启动器、守护脚本、Sync 默认地址、部署文档、当前 aims 与测试统一为 `18787`。`8787` 仅保留在历史审计与证据文件中，不再作为运行默认值。
- **受影响条款**：G7 端口门禁、8080 门户单向 Sync、Final Gate 网络判据、启动与守护入口。
- **同步修改文件清单**：`BioanalysDesktop/server/index.js`、`BioanalysDesktop/vite.config.js`、`start_workbench.bat`、`start_all.bat`、`ops/serve_guard.ps1`、`ops/sync_daemon.ps1`、`ops/README.md`、`docs/user_portal_deploy.md`、当前 aims 四卷、端口一致性测试。
- **验证测试名**：工作台端口默认值跨文件一致性；`127.0.0.1:18787` 仅环回监听；`/api/selfcheck` 五维全绿；8080 `/health` 200；端口预检识别 18787 owner 为项目 Node。

## A2A Decisions (namespace: A2A-D-01 ~ A2A-D-10)

最新 `aims/A2A` 四卷沿用 D-01 ~ D-10 名称。现有生信台账已经永久占用 D-01 ~ D-28，
按编号不回收纪律，A2A 增量统一使用 `A2A-D-*` 命名并在文档层保留与 A2A 四卷 D-* 的映射。

- **A2A-D-01**：Codex 侧统一使用 `codex-a2a`，提供本地入站适配器与出站 `a2a_call` 能力。
- **A2A-D-02**：Pi 侧统一使用 `@bacnh85/pi-a2a`，并实现 A2A v1.0 Agent Card、SendMessage、GetTask、CancelTask。
- **A2A-D-03**：Pi 绑定 `0.0.0.0` 前必须有非空高熵 `peerTokens`、`trustedPeers` 与 `allowAllUsers=false`。
- **A2A-D-04**：控制流只能从 Codex 到 Pi，Pi 禁止配置反向 Peer。
- **A2A-D-05**：手机端必须满足 WakeLock、无限制电池、外部供电、tmux 托管和 Phantom Process 豁免。
- **A2A-D-06**：短任务同步执行；长任务使用 GetTask 退避轮询，超时先 CancelTask，禁止盲目重发写操作。
- **A2A-D-07**：跨网仅使用 Tailscale CGNAT 网段，禁止公网暴露 9910，并强制 NO_PROXY。
- **A2A-D-08**：手机工作区仅允许 `$HOME/workspace`，拦截 `/sdcard`、`/storage/emulated` 与路径穿越。
- **A2A-D-09**：任务产物必须提供结构化 Artifact、退出码、相对路径、SHA256 和输出摘要。
- **A2A-D-10**：真实 Token 不入 Git，运行态只从环境变量或忽略文件读取；账本保持追加式 JSONL。
