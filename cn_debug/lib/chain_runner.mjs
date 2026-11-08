/**
 * cn_debug/lib/chain_runner.mjs —— line1/line2/line3 全链真机取证的公共机制。
 *
 * 存在理由（第十二轮待办 4）：line1/line2/line3 三份 runner 各自实现了一遍 ssh、台账定位、
 * 输入预检、产物核对，口径靠"抄的时候没抄错"维持。P-25/P-26 两条踩坑都已经修在某一两份里，
 * 另一两份还是旧写法——重复实现等于让修复只覆盖一部分。
 * 本文件收口这些机制，runner 只留「步骤表 + 日志格式」。
 *
 * 设计约束（2026-10-21 踩坑固化，逐条对应踩坑台账编号）：
 *  - P-26：本机进程不得承载远端长任务。line1 每步 3s~2.6min 能撑过进程存活期，
 *    line2 的 scenic_tf 要 20-40 分钟，引擎的 ssh 子进程一旦被 pwsh 退出回收，任务就从
 *    /api/tasks 消失、远端只剩 _running/ 残留标记，取证假失败。
 *    => 长任务一律 setsid nohup 起（launchDetached），本机只轮询；
 *       HTTP 模式（runStepHttp）只用于短步骤，且要求引擎本身是后台常驻进程。
 *  - P-25：台账定位用「提交前快照 + 只认新增文件」。容器是 UTC、本机是 CST，且时钟会漂，
 *    任何 start_time 时间比较都会假失败。
 *  - P-25：台账文件名必须严格正则二次过滤。ls 的 glob "*_enrichment_*.json" 会命中
 *    enrichment_figures（"_enrichment_" 是它的前缀），不过滤会读错步骤的账。
 *  - P-23 / P-24：判活四步 = _running/ 标记、step 日志字节数、system_logs 台账、processed
 *    产物 mtime。loadavg / /api/tasks 一律不作判活依据。
 *  - P-04：ssh 首连接的 known_hosts warning 会写进 stdout，必须逐行滤掉，否则整段锚定解析被顶掉。
 *  - P-29：对容器的高频/并发 ssh 会喂饱 proot 的 15 秒 abort 自我维持环。runner 的轮询
 *    本身就是触发源，所以：轮询间隔下限 60s、重试最多 2 次、判活三信号合成一次往返。
 *
 * 所有函数同步执行（ssh 用 execFileSync，等待用 Atomics.wait 睡眠）：取证脚本是一次性工具，
 * 同步写法让「下发→等→判」的顺序在代码里就是执行顺序，不会出现异步轮询被进程退出打断。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SSH = 'ssh';
export const SSH_OPTS = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=20',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=4',
];
export const TARGET = 'k40-ubuntu';
export const REMOTE_ROOT = '/mnt/ssd/bio_data';
export const WRAPPER = `${REMOTE_ROOT}/ops/run_throttled_task.sh`;
export const BIN = `${REMOTE_ROOT}/bin`;
export const SYSTEM_LOGS = `${REMOTE_ROOT}/system_logs`;
export const RUNNING_DIR = `${SYSTEM_LOGS}/_running`;
/**
 * 默认取证项目改为 `default`（2026-10-23 第十九轮，用户确认废弃 PRJ_E2E_SCRNA）。
 * PRJ_E2E_SCRNA 是 default 跑通之后建的半成品副本（line2 35 产物、line3 空），
 * 已移入 projects/_archive/PRJ_E2E_SCRNA_deprecated_20261023。runner 用 PROJECT_ID 覆盖。
 */
export const PROJECT = process.env.PROJECT_ID || 'default';
export const LINE = process.env.LINE_ID || 'line2_scrna';
export const SEED = process.env.SEED || '20261013';
export const KO_GENE = process.env.KO_GENE || 'TNF';
export const P = `${REMOTE_ROOT}/projects/${PROJECT}/${LINE}`;

/**
 * P-29 轮询间隔下限：60s。
 * 实测（2026-10-23）：10s 间隔的轮询 + 3 次重试会把 proot 的 15 秒 abort 自我维持环
 * 一直喂着，20-40 分钟的重步骤必然被周期性拖死；停掉轮询后 abort 立即归零。
 */
const configuredPollMs = Number(process.env.POLL_INTERVAL_MS || 60000);
export const POLL_INTERVAL_MS = Number.isFinite(configuredPollMs)
  ? Math.max(60000, configuredPollMs)
  : 60000;
export const LONG_STEP_LEDGER_WAIT_MS = 40 * 60 * 1000;
export const DEFAULT_STEP_LEDGER_WAIT_MS = 30 * 60 * 1000;
const LONG_STEP_ALIASES = new Set([
  'l2_tf_scenic',
  'scenic_tf',
  'l2_ko_scrna',
  'virtual_knockout',
]);

export function isLongRunningStep(step) {
  return LONG_STEP_ALIASES.has(String(step));
}

/**
 * P-27：两个计算引擎级长步骤固定 40 分钟档，其余步骤保留显式分钟档。
 * 同时接受注册表 mod id（l2_*）与远端母版名，避免调用层换名后档位失配。
 */
export function ledgerWaitMsForStep(step, explicitMs) {
  if (isLongRunningStep(step)) return LONG_STEP_LEDGER_WAIT_MS;
  const requested = Number(explicitMs);
  return Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_STEP_LEDGER_WAIT_MS;
}

/**
 * P0 残留标记自动清扫（2026-10-23 第十九轮）。
 *
 * wrapper 被杀后 `_running/<task>.json` 永远残留，此前只能人工按 D-20 三条件逐个核对
 * （今天为此手工核了 4 个）。wrapper 落盘时已经写了 `wrapper_pid`，这里把它用起来：
 * 读 pid -> 查 /proc/<pid> -> 不存在即判死 -> 删标记并回报。
 *
 * 只删「pid 已死」的标记。pid 活着的一律不动，避免误删正在跑的任务。
 * @returns {{stale: string[], alive: string[], err: string}}
 */
export function sweepStaleMarkers(markerDir = RUNNING_DIR) {
  const script = [
    'for f in ' + markerDir + '/*.json; do',
    '  [ -e "$f" ] || continue',
    '  pid=$(grep -o \'"wrapper_pid": [0-9]*\' "$f" 2>/dev/null | grep -o \'[0-9]*$\')',
    '  if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then echo "ALIVE $(basename $f .json) $pid"',
    // ${pid:-nopid} 必须留在远端 bash 里展开，不能进 JS 模板字符串
    '  else echo "STALE $(basename $f .json) ${pid:-nopid}"; fi',
    'done',
  ].join('\n');
  const r = ssh(script);
  const stale = [];
  const alive = [];
  for (const line of (r.text || '').split('\n')) {
    const m = /^(ALIVE|STALE)\s+(\S+)\s*(\S*)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'ALIVE') alive.push(`${m[2]} pid=${m[3]}`);
    else stale.push(`${m[2]} pid=${m[3]}`);
  }
  if (stale.length) {
    const rm = stale.map((s) => shellSingle(`${markerDir}/${s.split(' ')[0]}.json`)).join(' ');
    ssh(`rm -f ${rm}`);
  }
  return { stale, alive, err: r.code === 0 ? '' : `ssh exit=${r.code}` };
}

/** 同步 sleep（本库全同步，避免异步轮询被进程退出打断）。 */
export function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 正则字面量转义：step 名进正则前必须转义（虽然现有步骤名都是安全字符，但不赌）。 */
export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 台账文件名形态（BioanalysDesktop/server/run.js:154 buildLedgerFileName）：
 *   YYYY-MM-DD_<project>_<line>_<step>_<taskId 前8位>.json
 * taskId 段是 uuid 前 8 位十六进制，不含下划线，所以 `_[^_/]*` 既能锚住它，
 * 又不会让 enrichment 命中 enrichment_figures（P-25）。
 */
export function ledgerPattern(step, line = LINE) {
  return new RegExp(`_${escapeRegExp(line)}_${escapeRegExp(step)}_[0-9a-f]{8,}\\.json$`);
}

/**
 * 远端执行一条命令。
 * 重试吸收「Connection closed by 127.0.0.1 port 10022」这类偶发断链（P-23）。
 * 输出里以 "Warning: Permanently added" 开头的行必须滤掉，否则整段锚定解析会被顶掉（P-04）。
 * @returns {{code:number, text:string}}
 */
export function ssh(cmd, opts = {}) {
  const argv = [...SSH_OPTS, TARGET, cmd];
  let out = '';
  let code = 0;
  // P-29：默认 2 次。3 次重试在容器 abort 循环里等于每分钟多打一轮连接。
  const requestedRetries = Number(opts.retries);
  const retries = Number.isInteger(requestedRetries) && requestedRetries > 0
    ? Math.min(requestedRetries, 2)
    : 2;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      out = execFileSync(SSH, argv, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: opts.timeoutMs || 90000,
        maxBuffer: 64 * 1024 * 1024,
      });
      code = 0;
      break;
    } catch (err) {
      code = typeof err.status === 'number' ? err.status : -1;
      out = (err.stdout || '') + (err.stderr || '');
      if (attempt === retries) break;
      sleepMs(4000);
    }
  }
  const text = out.split('\n')
    .filter((l) => !l.startsWith('Warning: Permanently added'))
    .join('\n').trim();
  return { code, text };
}


/**
 * 远端路径清单。
 * pattern 为空时把 target 当普通路径用 ls -1d（支持单文件）；否则按目录 + 通配列目录。
 * 不存在返回空数组，不抛（preflight 依赖这个语义）。
 */
export function lsRemote(target, pattern = '') {
  const cmd = pattern ? `ls -1 ${target}/${pattern} 2>/dev/null || true` : `ls -1d ${target} 2>/dev/null || true`;
  const r = ssh(cmd);
  return (r.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * P-29 批量探测：把 N 条远端命令合成**一次** ssh 执行。
 *
 * 为什么不用 ControlMaster：本机 OpenSSH for Windows 9.5 的 ControlMaster 实测不可用
 * （文件形式与命名管道形式的 ControlPath 都报 `getsockname failed: Not a socket`），
 * 所以连接复用这条路在本机走不通。
 *
 * 替代方案就是这个：连接数 = 1，与命令数无关。整段脚本经 base64 传输，
 * 避免 PowerShell 展开 `$`、`<`、引号（这个坑今天踩了三次）。
 * @param {string[]} cmds 远端命令，按序执行
 * @param {{timeoutMs?: number}} [opts]
 * @returns {{code:number, text:string}}
 */
export function sshBatch(cmds, opts = {}) {
  const script = (cmds || []).join('\n') + '\necho __BATCH_DONE__';
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return ssh(`echo ${b64} | base64 -d | bash`, opts);
}

/**
 * P-29 判活单次往返：把「台账列表 + _running 标记 + 日志字节数」合成一条命令。
 * 一次 ssh 拿回三信号，避免三个独立连接把 abort 循环重新喂起来。
 * @returns {{ledgers: string[], markers: string[], logSize: number}}
 */
export function probeLiveness({ step, logPath, markerDir = RUNNING_DIR }) {
  const script = [
    `echo __LEDGERS__`,
    `ls -1 ${SYSTEM_LOGS}/*_${PROJECT}_${LINE}_${step}_*.json 2>/dev/null || true`,
    `echo __MARKERS__`,
    `ls -1 ${markerDir}/*.json 2>/dev/null || true`,
    `echo __LOGSIZE__`,
    `stat -c %s '${logPath}' 2>/dev/null || echo 0`,
  ].join('\n');
  const r = ssh(script);
  const sections = (r.text || '').split(/__(LEDGERS|MARKERS|LOGSIZE)__/);
  const ledgers = (sections[2] || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const markers = (sections[4] || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const logSize = Number((sections[6] || '0').trim()) || 0;
  return { ledgers, markers, logSize };
}

/** 台账文件清单：ls 的 glob 宽匹配 + ledgerPattern 严格二次过滤（P-25）。 */
export function listLedgers(step, project = PROJECT, line = LINE) {
  const all = lsRemote(SYSTEM_LOGS, `*${project}_${line}_${step}_*.json`);
  const re = ledgerPattern(step, line);
  return all.filter((f) => re.test(f));
}

/** 读一份台账 JSON；不存在/解析失败返回 null（ssh 失败与缺失分开由调用方判 code）。 */
export function readLedger(file) {
  const t = ssh(`test -f '${file}' && cat '${file}' || echo __MISSING__`);
  if (!t.text || t.text === '__MISSING__') return null;
  try {
    return JSON.parse(t.text);
  } catch {
    return null;
  }
}

/**
 * 等一份新台账出现（提交前先快照，只认新增文件）。
 * 轮询同时打判活信息：_running/ 标记、日志字节数，便于人工判断是卡死还是在跑。
 * @param {string} step 步骤名
 * @param {string[]|Set<string>} before 提交前的台账文件名集合
 * @param {number} timeoutMs
 * @param {{logPath?: string, markerDir?: string, markerSeen?: boolean, onPoll?: Function}} [watch]
 */
export function waitNewLedger(step, before, timeoutMs, watch = {}) {
  const known = before instanceof Set ? before : new Set(before || []);
  const deadline = Date.now() + timeoutMs;
  let lastLogSize = -1;
  while (Date.now() < deadline) {
    // P-29：一次往返拿三信号；轮询间隔 60s。10s 间隔 = 每分钟 6 次连接，会喂饱 abort 环。
    const probe = probeLiveness({ step, logPath: watch.logPath, markerDir: watch.markerDir });
    const re = ledgerPattern(step);
    const fresh = probe.ledgers.filter((f) => !known.has(f) && re.test(f));
    if (fresh.length) {
      const led = readLedger(fresh[fresh.length - 1]);
      if (led) return { ledger: led, file: fresh[fresh.length - 1] };
    }
    if (watch.logPath) {
      if (probe.logSize === lastLogSize && watch.onPoll) watch.onPoll({ stagnant: true, size: probe.logSize });
      lastLogSize = probe.logSize;
    }
    if (watch.markerDir && watch.markerSeen && probe.markers.length === 0) {
      // 标记消失且没有新台账：wrapper 已经收尾但没写台账，异常
      return { ledger: null, file: null, markerGone: true };
    }
    sleepMs(POLL_INTERVAL_MS);
  }
  return { ledger: null, file: null, timeout: true };
}

/**
 * 远端 setsid nohup 起包装器（命令串模式，台账照写）。
 * 立即返回 wrapper 日志路径；不等待远端进程结束。这是 P-26 的永久修复形态。
 *
 * @param {string} id       wrapper 任务 id（task_<epoch>_<rand6>）
 * @param {string} lineId   线 id
 * @param {string} step     步骤名
 * @param {string} execCmd  母版完整命令（经 BIO_EXEC_CMD 传，避免 $5 二次解析）
 * @param {{projectId?: string, seed?: string}} [opts]
 */
export function launchDetached(id, lineId, step, execCmd, opts = {}) {
  const projectId = opts.projectId || PROJECT;
  const seed = opts.seed || SEED;
  const inner = [
    `cd ${REMOTE_ROOT}/projects/${projectId}/${lineId}/processed`,
    `export BIOANALYS_SEED=${seed}`,
    `export BIO_EXEC_CMD=${shellSingle(execCmd)}`,
    'export BIO_WRAPPER_LEDGER=1',
    `setsid nohup bash ${WRAPPER} ${id} ${lineId} ${shellSingle(step)} self ${BIN}/${lineId}/${step} > ${SYSTEM_LOGS}/${id}.log 2>&1 < /dev/null &`,
    'echo $!',
  ].join('\n');
  const b64 = Buffer.from(inner, 'utf8').toString('base64');
  const r = ssh(`echo ${b64} | base64 -d | bash`, { timeoutMs: 60000 });
  return { pid: (r.text || '').split('\n').pop().trim(), logPath: `${SYSTEM_LOGS}/${id}.log` };
}

/** 单引号安全包裹（远端 bash 用）。 */
export function shellSingle(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/** 生成 wrapper id。 */
export function wrapperId() {
  return `task_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 输入存在性预检：缺文件不下发（下发必 failed，白烧一次远端执行 + 一次容器启动）。
 * 单次 ssh 批量探测，避免逐文件 N 次往返。
 * @returns {{ok: boolean, missing: string[], err: string}}
 */
export function preflight(paths) {
  const list = (paths || []).filter(Boolean);
  if (list.length === 0) return { ok: true, missing: [], err: '' };
  const lines = list.map((file) => `[ -e ${shellSingle(file)} ] || echo MISSING:${file}`);
  const res = ssh(lines.join('\n') + '\necho PREFLIGHT_DONE', { timeoutMs: 60000 });
  if (res.code !== 0) return { ok: false, missing: [], err: `ssh exit=${res.code}` };
  if (!/PREFLIGHT_DONE/.test(res.text)) {
    return { ok: false, missing: [], err: '预检脚本未跑完（远端可能提前退出）: ' + res.text.slice(-200) };
  }
  const missing = res.text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('MISSING:'))
    .map((line) => line.slice('MISSING:'.length));
  return { ok: missing.length === 0, missing, err: '' };
}

/**
 * 产物核对：只看主产物在不在（脚本自校验过了，这里防"exit 0 但产物落别处"）。
 * @returns {{ok: boolean, absent: string[], err: string}}
 */
export function verifyOutputs({ dir, names }) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return { ok: true, absent: [], err: '' };
  const lines = list.map((name) => `[ -e ${shellSingle(`${dir}/${name}`)} ] || echo ABSENT:${name}`);
  const res = ssh(lines.join('\n') + '\necho VERIFY_DONE', { timeoutMs: 60000 });
  if (res.code !== 0) return { ok: false, absent: [], err: `ssh exit=${res.code}` };
  const absent = res.text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ABSENT:'))
    .map((line) => line.slice('ABSENT:'.length));
  return { ok: absent.length === 0, absent, err: '' };
}

/**
 * 构造母版完整命令（命令串模式，P-26）。
 * 只认 --input / --seed / --ko-gene 三个参数位，与母版参数解析契约一致
 * （docs/coding-standards.md：未知参数 exit 2）。
 */
export function buildExecCmd({ step, lineId = LINE, inputs = [], seed = SEED, koGene = '', extra = '' }) {
  const args = (inputs || []).map((p) => `--input ${p}`).join(' ');
  const ko = koGene ? `--ko-gene ${koGene}` : '';
  return `${BIN}/${lineId}/${step} ${args} ${ko} --seed ${seed} ${extra}`.replace(/\s+/g, ' ').trim();
}

/**
 * 单步执行：setsid nohup 包装器模式（P-26 永久修复）。
 *
 * 与 runStepHttp 的区别：不经引擎，因此不经引擎的三道闸（路径预检 / 跨线审计 / 桥接断言）。
 * 用途是「引擎已经放行过的步骤重跑」与「链路取证时不把长任务绑在本机进程树上」。
 * 要验证引擎契约本身，用 runStepHttp。
 *
 * @param {object} spec {step, inputs, outputs, outputsDir, ledgerWaitMs, ko, label}
 * @param {{log?: Function, projectId?: string, lineId?: string, seed?: string, koGene?: string}} [hooks]
 * @returns {{status: string, ledger: object|null, wallSec: number, logPath: string, detail: string}}
 */
export function runStepDetached(spec, hooks = {}) {
  const log = hooks.log || (() => {});
  const lineId = hooks.lineId || LINE;
  const projectId = hooks.projectId || PROJECT;
  const seed = hooks.seed || SEED;
  const label = spec.label || spec.step;
  const ledgerWaitMs = ledgerWaitMsForStep(spec.step, spec.ledgerWaitMs);

  const startedAt = Date.now();
  // 先扫残留标记：上次被 abort 杀掉的 wrapper 会留下死标记，不扫会把本次判活搅乱
  // （waitNewLedger 看到旧标记会误判 markerGone）。只删 pid 已死的，不影响在跑任务。
  const swept = sweepStaleMarkers();
  if (swept.stale.length) log('INFO', `${label} 清扫`, `残留标记 ${swept.stale.join(', ')}`);
  const pre = preflight(spec.inputs);
  if (!pre.ok) {
    return { status: 'skipped', ledger: null, wallSec: 0, logPath: '', detail: pre.missing.length ? `缺输入 ${pre.missing.join(', ')}` : pre.err };
  }

  const execCmd = buildExecCmd({
    step: spec.step, lineId, inputs: spec.inputs, seed,
    koGene: spec.ko ? (hooks.koGene || KO_GENE) : '',
  });
  const wid = wrapperId();
  const launch = launchDetached(wid, lineId, spec.step, execCmd, { projectId, seed });
  log('INFO', `${label} 下发`, `wrapper=${wid} pid=${launch.pid}`);

  // 8s 后标记必须就位：未就绪说明包装器自己没起来（而不是母版跑得慢），此时读日志尾部定位
  ssh(`sleep 8; ls -1 ${RUNNING_DIR}/ 2>/dev/null || true`, { timeoutMs: 30000 });
  const markerUp = lsRemote(RUNNING_DIR, `${wid}.json`).length > 0;
  if (!markerUp) {
    const tail = ssh(`tail -c 800 '${launch.logPath}' 2>/dev/null || echo NO_LOG`);
    return { status: 'launch-failed', ledger: null, wallSec: 8, logPath: launch.logPath, detail: `wrapper 未就绪；log: ${tail.text.slice(-500)}` };
  }

  const before = listLedgers(spec.step, projectId, lineId);
  const res = waitNewLedger(spec.step, before, ledgerWaitMs, { logPath: launch.logPath, markerDir: RUNNING_DIR, markerSeen: true });
  if (res.ledger) {
    const led = res.ledger;
    const ok = led.status === 'completed' && led.exit_code === 0;
    const verify = ok ? verifyOutputs({ dir: `${P}/processed`, names: spec.outputs }) : { ok: true, absent: [], err: '' };
    return {
      status: ok ? (verify.ok ? 'ok' : 'outputs-missing') : 'failed',
      ledger: led, wallSec: Math.round((Date.now() - startedAt) / 1000), logPath: launch.logPath,
      detail: `status=${led.status} exit=${led.exit_code} checkpoint=${led.checkpoint_status}`
        + (verify.ok ? '' : ` 缺产物: ${verify.absent.join(', ')}`),
    };
  }
  const why = res.timeout ? `${Math.round(ledgerWaitMs / 60000)}min 超时仍在运行`
    : res.markerGone ? 'wrapper 标记消失但无台账' : '无台账';
  const tail = ssh(`tail -c 600 '${launch.logPath}' 2>/dev/null || true`);
  return { status: res.timeout ? 'timeout' : 'no-ledger', ledger: null, wallSec: Math.round((Date.now() - startedAt) / 1000), logPath: launch.logPath, detail: `${why}；log tail: ${tail.text.slice(-400)}` };
}

/** 结果表（markdown）。 */
export function renderTable(rows, cols) {
  const head = '| ' + cols.map((c) => c.label).join(' | ') + ' |';
  const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const body = rows.map((r) => '| ' + cols.map((c) => String(r[c.key] === undefined ? '-' : r[c.key])).join(' | ') + ' |');
  return [head, sep].concat(body).join('\n');
}

/**
 * 单步执行：工作台 HTTP 契约模式。
 *
 * 这是 line1 全链 15/15（第九轮）与 line3 runner 用的形态：逐步 POST /api/tasks/submit，
 * 完成判定靠 /api/tasks 列表里 taskId 消失，再读台账判 status / exit_code。
 *
 * 与 runStepDetached 的取舍：
 *  - HTTP 模式会过引擎三道闸（路径预检 / 跨线审计 / 桥接断言），是**验证引擎契约**的唯一方式；
 *  - 但引擎的 ssh 子进程挂在本机进程树下，K40 侧长步骤（scenic_tf 20-40 分钟）会随
 *    本机 shell 退出被回收（P-26）。因此本模式只用于短步骤，且必须确认引擎是后台常驻进程。
 *
 * @param {object} spec {step, inputs, outputs, outputsDir, timeoutMs, ledgerWaitMs, needsKoGene, label, index}
 * @param {object} opts {base, projectId, lineId, seed, koGene, skipPreflight, log}
 * @returns {Promise<{ok: boolean, ledger: object|null, wallSec: number, detail: string}>}
 */
export async function runStepHttp(spec, opts = {}) {
  const base = opts.base || 'http://127.0.0.1:8791';
  const projectId = opts.projectId || PROJECT;
  const lineId = opts.lineId || LINE;
  const seed = opts.seed || SEED;
  const koGene = opts.koGene || KO_GENE;
  const log = opts.log || (() => {});
  const label = spec.label || `${(spec.index ?? 0) + 1}. ${spec.step}`;
  const timeoutMs = isLongRunningStep(spec.step)
    ? LONG_STEP_LEDGER_WAIT_MS
    : (spec.timeoutMs || 45 * 60 * 1000);
  const ledgerWaitMs = ledgerWaitMsForStep(spec.step, spec.ledgerWaitMs || 120000);

  const startedAt = Date.now();

  if (!opts.skipPreflight) {
    const pre = preflight(spec.inputs);
    if (!pre.ok) {
      return { ok: false, ledger: null, wallSec: 0, detail: pre.missing.length ? `缺输入: ${pre.missing.join(', ')}` : pre.err, skipped: true };
    }
  }

  const before = listLedgers(spec.step, projectId, lineId);
  const payload = { projectId, lineId, step: spec.step, inputs: spec.inputs || [], outputs: [], seed };
  if (spec.needsKoGene) payload.targetKoGene = koGene;

  const submit = await fetch(`${base}/api/tasks/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await submit.json().catch(() => ({}));
  if (!submit.ok) {
    return { ok: false, ledger: null, wallSec: Math.round((Date.now() - startedAt) / 1000), detail: body.error || `HTTP ${submit.status}` };
  }
  const taskId = body.taskId;
  if (!taskId) {
    return { ok: false, ledger: null, wallSec: Math.round((Date.now() - startedAt) / 1000), detail: '响应缺 taskId: ' + JSON.stringify(body).slice(0, 200) };
  }
  log('PASS', `${label} 下发`, String(taskId));

  // 完成判定：taskId 从 /api/tasks 消失。注意这不是判活依据（P-24）——
  // 消失只说明本机 ssh 子进程结束；成功与否以台账为准。
  const deadline = Date.now() + timeoutMs;
  let stillRunning = true;
  let pollFailures = 0;
  while (Date.now() < deadline) {
    sleepMs(3000);
    let ids;
    try {
      const res = await fetch(`${base}/api/tasks`, { signal: AbortSignal.timeout(20000) });
      const list = await res.json();
      ids = new Set((list.tasks || []).map((t) => t.taskId));
      pollFailures = 0;
    } catch (cause) {
      pollFailures += 1;
      if (pollFailures >= 5) {
        return { ok: false, ledger: null, wallSec: Math.round((Date.now() - startedAt) / 1000), detail: `轮询 /api/tasks 连续失败: ${cause.message}` };
      }
      continue;
    }
    if (!ids.has(taskId)) { stillRunning = false; break; }
  }
  if (stillRunning) {
    return { ok: false, ledger: null, wallSec: Math.round((Date.now() - startedAt) / 1000), detail: `超时 ${Math.round(timeoutMs / 60000)} 分钟仍在运行（taskId=${taskId}）` };
  }

  sleepMs(1500);
  const found = waitNewLedger(spec.step, before, ledgerWaitMs);
  if (!found.ledger) {
    return { ok: false, ledger: null, wallSec: Math.round((Date.now() - startedAt) / 1000), detail: found.timeout ? `${Math.round(ledgerWaitMs / 1000)}s 内未见新增台账` : '台账读取失败' };
  }
  const ledger = found.ledger;
  const ok = ledger.status === 'completed' && ledger.exit_code === 0;
  log(ok ? 'PASS' : 'FAIL', `${label} 结果`,
    `status=${ledger.status} exit=${ledger.exit_code} checkpoint=${ledger.checkpoint_status}`);

  if (ok) {
    const projectPath = `${REMOTE_ROOT}/projects/${projectId}/${lineId}`;
    const verify = verifyOutputs({
      dir: spec.outputsDir === 'figures' ? `${projectPath}/figures` : `${projectPath}/processed`,
      names: spec.outputs,
    });
    if (!verify.ok) {
      log(spec.strictOutputs ? 'FAIL' : 'WARN', `${label} 产物核对`, `缺主产物: ${verify.absent.join(', ')}`);
      if (spec.strictOutputs) {
        return {
          ok: false,
          ledger,
          wallSec: Math.round((Date.now() - startedAt) / 1000),
          detail: `status=${ledger.status} exit=${ledger.exit_code} 缺产物=${verify.absent.join(', ')}`,
        };
      }
    }
  }
  return { ok, ledger, wallSec: Math.round((Date.now() - startedAt) / 1000), detail: `status=${ledger.status} exit=${ledger.exit_code}` };
}

/**
 * 从 mod 注册表解析「mod id -> 母版名」。
 *
 * 注册表（tools/bio/workflows.json）的 mod.id 用 <系列>_<工序>_<功能> 命名，
 * 而磁盘母版与远端 bin/ 用的是原名（mod.script）。runner 的步骤表写的是母版名，
 * 两边靠这个映射对齐，避免注册表改名后 runner 静默失联。
 * @returns {Map<string,string>} modId -> script
 */
/**
 * 从 mod 注册表解析「mod id -> 母版名」。
 *
 * 注册表（tools/bio/workflows.json）的 mod.id 用 <系列>_<工序>_<功能> 命名，
 * 而磁盘母版与远端 bin/ 用的是原名（mod.script）。runner 的步骤表写的是母版名，
 * 两边靠这个映射对齐，避免注册表改名后 runner 静默失联。
 *
 * 路径从本文件位置向上推（cn_debug/lib/ -> 仓库根），不用 process.cwd()：
 * 测试的 cwd 是 BioanalysDesktop/，runner 也可能从任意目录被调。
 * @returns {Map<string,string>} modId -> script
 */
export function modScriptIndex() {
  const reg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'bio', 'workflows.json');
  const j = JSON.parse(fs.readFileSync(reg, 'utf8'));
  const out = new Map();
  for (const s of j.series) {
    for (const st of s.stages) {
      for (const m of st.mods) out.set(m.id, m.script || m.id);
    }
  }
  return out;
}

/** 反查：母版名 -> mod id。 */
export function modIdIndex() {
  const idx = modScriptIndex();
  const out = new Map();
  for (const [id, script] of idx) out.set(script, id);
  return out;
}
