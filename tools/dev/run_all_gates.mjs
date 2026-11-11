#!/usr/bin/env node
/**
 * 单命令总门禁（4 Argon 第二十四轮 Q4/Q6【立即做】）。
 *
 * 存在的理由：门禁此前散在各处，封板前要记十几条命令、看十几份输出。
 * 这里把它们串成一条命令，本地与私有 CI 行为 100% 同构：
 * 任何一道红即整体红，并明确点名是第几道、什么原因。
 *
 * 清单与顺序的唯一真源是下方的 GATES 数组（不在注释里复述，避免注释与实现分叉）。
 * 排序原则：越便宜越靠前（fail fast），全量测试固定最后一道并标记 slow。
 *
 * 依赖远端设备的门禁（如 k40_parity）用 skipExitCodes 声明「本机形态不具备验证条件」
 * 的退出码，主链把它转成带 ALLOWED_SKIP_REASONS 标签的 SKIP 行：离线环境不被拖红，
 * 但少验了什么必须作为事实打印出来。
 *
 * 刻意不含的两项（各有专门入口，不塞进封板门禁）：
 *   - 交付验收 npm run delivery:verify（要具体 tar 路径，不是仓库级门禁）
 *   - 工作区清理 npm run clean:workspace（破坏性动作，绝不能被门禁顺带触发）
 *
 * 用法：
 *   npm run gate:all          # 全量（约 3~4 分钟，含全量测试）
 *   node tools/dev/run_all_gates.mjs --skip-tests   # 跳过全量测试那一道（快速自检，约 15 秒）
 *   node tools/dev/run_all_gates.mjs --json         # 机器读
 * 退出码：0 全绿，1 有红，2 参数错误。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/**
 * 门禁清单。args 是相对仓库根的脚本参数；cwd 决定在哪个目录跑（metrics/build 要进子目录）。
 * slow 标记用于 --skip-tests 时跳过最耗时的一道。
 */
export const GATES = Object.freeze([
  { id: 'preflight', label: '宿主机依赖预检', exec: 'node', args: ['tools/dev/preflight.mjs'], cwd: '.', slow: false },
  // static_gate 默认「缺工具即失败」。开发机长期没有 Rscript（16 个 .R 母版本轮未查），
  // 那边显式降级为警告：降级清单与 [SKIP] 行仍逐条打印，gate:all 的 tail 里看得到「本机少验了 16 个」。
  // CI runner 装齐 pwsh7 / r-base 后走 strict 路径（不带本参数）。
  { id: 'static_gate', label: '静态语言门禁', exec: 'node', args: ['tools/dev/static_gate.mjs', '--allow-missing'], cwd: '.', slow: false },
  // 第 3 道：临时目录隔离（第三十四轮 4 Argon Q4）。同一类并发互删缺陷连续出现两次
  // （wp33 共享父目录、mutation_gate 固定 scope id），上升为机器静态规则：凡含递归删除的
  // 测试/门禁文件必须带 mkdtemp / pid / 随机 隔离标记，调用方拥有的输出目录走冻结豁免清单。
  { id: 'test_isolation', label: '测试与门禁临时目录隔离', exec: 'node', args: ['tools/dev/test_isolation_gate.mjs'], cwd: '.', slow: false },
  // 第 4 道：便携包关键资产同源（第三十五轮 4 Argon Q4 条件同意）。
  // dist/ 存在则逐字节比对 5 个关键资产；不存在（CI 干净 Runner）显式 SKIP_NO_DIST 放行。
  { id: 'dist_parity', label: '便携包关键资产同源', exec: 'node', args: ['tools/dev/dist_parity_gate.mjs'], cwd: '.', slow: false },
  { id: 'skip_static', label: '跳过原因白名单（静态面）', exec: 'node', args: ['tools/dev/skip_reason_gate.mjs'], cwd: '.', slow: false },
  // Q1（第 41 轮，抄 nf-core/modules）：项目层禁止出现与母版同名的完整脚本副本，
  // 有 scripts/ 的项目必须逐条登记 scripts_manifest.json。拔除漂移病根。
  { id: 'project_script', label: '项目层脚本边界（禁母版副本）', exec: 'node', args: ['tools/dev/project_script_gate.mjs'], cwd: '.', slow: false },
  // 项目内容消融：在 .tmp 临时副本上删除旧报告、legacy 图件、组图、旧来源配置
  // 与旧 SSH runner，证明客户端项目发现、图件清单、来源清单接口与出图门禁仍自洽。
  // 它只验证项目内容，不重跑生信分析，放在项目脚本边界之后、受控桥接之前。
  { id: 'project_content_ablation', label: '项目内容消融（旧报告/旧图/来源配置）', exec: 'node', args: ['tools/dev/project_content_ablation_gate.mjs'], cwd: '.', slow: false },
  // 结构化工单编排器：用确定性合成工单验证建项、上传、DAG、完成回执、报告验收与
  // 汇总回执的单入口闭环。全程 mock HTTP，不连接设备，不触发分析计算。
  { id: 'work_order_orchestrator', label: '结构化工单编排闭环', exec: 'node', args: ['tools/dev/work_order_orchestrator_gate.mjs'], cwd: '.', slow: false },
  // SOP 规约资产：skills/stable 下每个 skill.yaml 的字段、引用路径、prompt 配套与
  // 工单 skill 的 exit_criteria 双射。YAML 用内置严格子集解析，本机有 PyYAML 时交叉核对。
  { id: 'skills_contract', label: 'skills 规约资产契约', exec: 'node', args: ['tools/dev/skills_contract_gate.mjs'], cwd: '.', slow: false },
  // 54 模块功能级消融与相邻兼容性矩阵：确定性静态核对，不重跑分析，不连接设备。
  { id: 'module_ablation_matrix', label: '54 模块消融与兼容性矩阵', exec: 'node', args: ['tools/dev/module_ablation_matrix_gate.mjs'], cwd: '.', slow: false },
  // 受控桥接事实源：默认仍禁止跨线读取，只允许 workflows.json 声明的
  // public_references/celltype_signatures/<project_id>/ 冻结签名表。
  { id: 'isolated_bridge', label: '受控桥接事实源', exec: 'node', args: ['tools/dev/isolated_bridge_gate.mjs'], cwd: '.', slow: false },
  // 第 18 道：声明式路由与边界台账一致性（Argon 第 66 轮 Q2b/Q3a 裁定的落地）。
  // 校验两件此前只靠人眼的事：ROUTER.yaml 引用的每个 Mod ID 与 ops 脚本真实存在；
  // SCOPE.md 每条 REJ 的 enforced_by 指向真门禁。填一个不存在的路径必须红。
  { id: 'router', label: '路由与边界台账一致性', exec: 'node', args: ['tools/dev/router_gate.mjs'], cwd: '.', slow: false },
  { id: 'ledger', label: '台账与真源一致', exec: 'node', args: ['tools/dev/ledger_gen.mjs', '--check'], cwd: '.', slow: false },
  { id: 'figure_registry', label: '图件注册表与证据同步', exec: 'node', args: ['tools/dev/build_figure_templates.cjs', '--check'], cwd: '.', slow: false },
  // T1-3 预览溯源（第三十四轮 4 Argon Q3）：T1-2 重渲染已完成，9 条分叉归零
  // （相等 12 / 分叉 0），按裁定同笔转硬阻断。任何 ready 的预览与矩阵产物 sha 再次分叉，
  // 这道门禁当场红——那是「预览来自另一次渲染」的唯一可信判据。
  { id: 'preview_provenance', label: '预览与渲染产物溯源', exec: 'node', args: ['tools/dev/figure_preview_provenance.mjs'], cwd: '.', slow: false },
  // 第 8 道前置：30 条 Ready 模板的实证矩阵（第 41 轮）。
  // 白名单只证明「ID 被封板」，不证明源码与预览还和登记时一致。这道门禁对每条 ready
  // 做真实的 sha256 比对：文件被悄悄改动、预览被重渲染覆盖，都会当场红。
  { id: 'ready_matrix', label: 'Ready 模板实证矩阵（基线由 allowlist 决定）', exec: 'node', args: ['tools/dev/figure_ready_matrix.mjs'], cwd: '.', slow: false },
  // 生信代码专项审核产物：出图溯源诚实性。注册表登记了参考库 source，但出图脚本
  // 从未引用库 —— 本门禁要求每份出图脚本显式声明 DERIVED/INSPIRED/INDEPENDENT，
  // 并抓「声称派生却不引用库」的假溯源。
  { id: 'figure_provenance', label: '出图溯源诚实性', exec: 'node', args: ['tools/dev/figure_source_provenance.mjs'], cwd: '.', slow: false },
  // 生信代码专项审核：母版解释器解析。47 个母版此前硬编码 python3，而 K40 的
  // /usr/bin/python3 没有科学计算栈，真正带依赖的是 /root/venvs/bio-py ——
  // 靠 PATH 里碰巧有 venv 等于把运行环境交给运气。
  { id: 'python_interpreter', label: '母版解释器解析', exec: 'node', args: ['tools/dev/python_interpreter_gate.mjs'], cwd: '.', slow: false },
  // 生信代码专项审核第 4 项：出图规范合规。直接读真实 PNG 的 pHYs 块判 300 DPI，
  // 不靠人眼。产线项目强制，历史项目（figure_spec v2.2 升级前的 150dpi 旧图）只报告。
  { id: 'figure_spec', label: '出图规范合规（300 DPI）', exec: 'node', args: ['tools/dev/figure_spec_gate.mjs'], cwd: '.', slow: false },
  // 第 20 道（Argon 第 76 轮）：出图源码规范门禁，与 Gate 14 产物侧 DPI 校验职责正交。
  // 查源码 C1-C14（字号/后端/配色/plt.close/Agg 顺序），blocking>0 即红，Fail-Closed。
  { id: 'figure_code', label: '出图源码规范（C1-C14 字号/后端/配色）', exec: 'node', args: ['tools/dev/figure_code_gate.mjs'], cwd: '.', slow: false },
  { id: 'audit_summary', label: '交付审计流可解析', exec: 'node', args: ['tools/reporting/audit_summary.mjs'], cwd: '.', slow: false },
  // 第 8 道：变异门禁（T2-6）。它证明的不是「代码对不对」，而是「门禁会不会红」：
  // 对 7 条关键防线各注入一次真实破坏，任一条没让对应判据变红即整道失败。
  // 变异只在 .tmp/mutation_gate/ 的临时副本上做，不碰工作树（并发安全）。
  { id: 'mutation_gate', label: '变异门禁（19 条防线反证）', exec: 'node', args: ['tools/dev/mutation_gate.mjs'], cwd: '.', slow: false },
  // Argon 第 42 轮锁定：Q3 状态机与 Q2 路由表各需 3 条 MUT 反证。
  // 既有 mutation_gate 的 7 条全在 Q4/T3 域，覆盖不到这两块，故单列。
  // K40 脚本同源（第 73 轮回归抓到的真实漂移：17 处不同源，而 18 道门禁全绿）。
  // 这道必须放在主链里，否则「代码侧全绿 + 设备侧落后一个版本」会长期共存。
  // 设备离线时 k40_script_parity 以退出码 2 表达「本轮未校验」，这里转成带标签的 SKIP，
  // 离线环境不会被它拖红，但 [SKIP] 行会明确写出少验了什么。
  { id: 'k40_parity', label: 'K40 脚本同源（设备离线时 SKIP）', exec: 'node', args: ['tools/dev/k40_script_parity.mjs'], cwd: '.', slow: false, skipExitCodes: [2] },
  { id: 'q3q2_mutation', label: 'Q3/Q2 变异反证（6 条）', exec: 'node', args: ['tools/dev/q3q2_mutation_gate.mjs'], cwd: '.', slow: false },
  // 控制面门禁：租约与队列都是「能不能开写」的闸门，放在全量测试之前，
  // 让控制面回归在 20 秒内暴露，不必等三分钟的全量测试。
  { id: 'authority_lease', label: '单权威租约准入（含变异自证）', exec: 'node', args: ['tools/dev/authority_lease_gate.mjs'], cwd: '.', slow: false },
  { id: 'work_order_queue', label: '队列单消费者（含变异自证）', exec: 'node', args: ['tools/dev/work_order_queue_gate.mjs'], cwd: '.', slow: false },
  // metrics 内部跑全量 node --test 的自限是 600 秒。外层必须比它更宽，
  // 否则慢机上外层先动手杀进程，TAP 被截断，出来的红是「假红」而不是用例真挂。
  { id: 'metrics', label: '全量测试 + 运行时 skip + 基线一致', exec: 'node', args: ['tools/dev/metrics_sync.mjs', '--check'], cwd: '.', slow: true, timeoutMs: 900000 },
]);

/** 取子进程环境的保底：Windows 原生 ssh 缺 SystemRoot 会静默 255（proc.js 同款教训）。 */
function gateEnv(extra = {}) {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return { ...process.env, SystemRoot: systemRoot, windir: process.env.windir || systemRoot, ...extra };
}

/**
 * 跑一道门禁。返回 { id, ok, exitCode, seconds, tail }。
 * tail 只留最后几行：门禁红时最重要的是「哪一句红」，不是整篇日志。
 */
export function runGate(gate, { repoRoot = REPO_ROOT, env = gateEnv(), timeoutMs = 300000 } = {}) {
  const started = Date.now();
  // 单道门禁可以声明自己的上限（gate.timeoutMs），缺省沿用 300 秒。
  // 为什么需要：全量测试那道内部自限 600 秒，外层若一律 300 秒截断，
  // TAP 会缺尾部汇总与半截 SKIP 行，metrics 报出的就是假红。
  const limit = Number(gate.timeoutMs) > 0 ? Number(gate.timeoutMs) : timeoutMs;
  const result = spawnSync(gate.exec, gate.args, {
    cwd: path.join(repoRoot, gate.cwd),
    encoding: 'utf8',
    timeout: limit,
    maxBuffer: 64 * 1024 * 1024,
    env,
    windowsHide: true,
  });
  const combined = ((result.stdout || '') + (result.stderr || '')).trim();
  const lines = combined.split(/\r?\n/);
  // skipExitCodes：门禁自己判断「本机形态不具备验证条件」时用特定退出码表达，
  // 而不是伪装成通过。典型场景是依赖远端设备的门禁在离线机器上跑。
  // 跳过必须带 ALLOWED_SKIP_REASONS 里的标签，且原样打印门禁自己的说明，
  // 让 [SKIP] 行能被人复核「它到底少验了什么」。
  const skipExitCodes = Array.isArray(gate.skipExitCodes) ? gate.skipExitCodes : [];
  const skipped = skipExitCodes.includes(result.status);
  return {
    id: gate.id,
    label: gate.label,
    ok: skipped ? true : result.status === 0,
    skipped,
    skipReason: skipped ? (lines.filter((l) => l.trim()).slice(-1)[0] || '') : '',
    exitCode: result.status,
    seconds: (Date.now() - started) / 1000,
    tail: lines.slice(-8),
  };
}

export function runAllGates({ repoRoot = REPO_ROOT, skipSlow = false, env = gateEnv(), gates = GATES } = {}) {
  const results = [];
  for (const gate of gates) {
    if (skipSlow && gate.slow) { results.push({ id: gate.id, label: gate.label, skipped: true }); continue; }
    results.push(runGate(gate, { repoRoot, env }));
  }
  const failed = results.filter((r) => r.skipped !== true && r.ok === false);
  return { ok: failed.length === 0, results, failed };
}

export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const skipSlow = argv.includes('--skip-tests');
  const asJson = argv.includes('--json');
  if (!fs.existsSync(path.join(REPO_ROOT, 'tools', 'dev'))) {
    io.error('不在仓库根（缺 tools/dev/），拒绝猜测路径');
    return 2;
  }
  const total = Date.now();
  const outcome = runAllGates({ skipSlow, env: process.env });
  const elapsed = ((Date.now() - total) / 1000).toFixed(0);
  if (asJson) {
    io.log(JSON.stringify({
      ok: outcome.ok,
      elapsed_seconds: Number(elapsed),
      gates: outcome.results.map((r) => ({
        id: r.id, label: r.label,
        status: r.skipped ? 'skipped' : (r.ok ? 'pass' : 'fail'),
        seconds: r.skipped ? 0 : Number(r.seconds.toFixed(2)),
        exit_code: r.skipped ? null : r.exitCode,
      })),
      failed: outcome.failed.map((r) => r.id),
    }, null, 2));
    return outcome.ok ? 0 : 1;
  }
  io.log('总门禁（' + outcome.results.length + ' 道串联，越便宜越靠前）');
  for (let i = 0; i < outcome.results.length; i += 1) {
    const r = outcome.results[i];
    const tag = r.skipped ? '[SKIP]' : (r.ok ? '[ OK ]' : '[ RED]');
    io.log(tag + ' ' + (i + 1) + '. ' + r.label + (r.skipped ? '' : '（' + r.seconds.toFixed(1) + 's）'));
    if (r.skipped) {
      // 两种跳过要分清：--skip-tests 是主动快检；门禁自己报的 skipExitCode 是环境不具备条件。
      io.log('       → ' + (r.skipReason || '--skip-tests 跳过（含全量测试，日常快检用）'));
      continue;
    }
    if (!r.ok) {
      for (const line of r.tail) io.log('       ' + line);
    }
  }
  if (outcome.ok) {
    io.log('');
    io.log('GATE_ALL_OK ' + outcome.results.length + ' 道全绿（' + elapsed + ' 秒）');
    return 0;
  }
  io.log('');
  io.error('GATE_ALL_FAILED ' + outcome.failed.length + ' 道红：' + outcome.failed.map((r) => r.id).join(', '));
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
