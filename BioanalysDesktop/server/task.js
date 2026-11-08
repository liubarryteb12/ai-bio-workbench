/**
 * 任务下发：把一次步骤执行变成"可下发命令 + 可归档台账"
 *
 * 两条铁律在这里收口：
 *   1. 命令只触及本线，含其他线 line_id 的一律不出这道门（audit.js 是兜底，这里是构造时就保证）；
 *   2. 台账必须能被 ledger.js 自己判合法，否则写出去的账自己就违规，成了讽刺。
 */

import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LINES, DEFAULT_PROJECT, projectLineDir, binDir, sanitizeProjectId, SYSTEM_LOGS,
} from './domain.js';
import { runSync } from './proc.js';
import { modToScriptMap, scriptToModMap } from './workflow_graph.js';
import { buildAdaptedFigureSource } from './figure_adapters.js';
import { atomicWriteFileSync } from './atomic_write.js';

/** 主节点温度熔断阈值，与 server/selfcheck.js 的 TEMP_FAIL_C 对齐 */
export const NODE_TEMP_FAIL_C = 95;
/** 主节点不可用后，新任务必须在 10 秒内切到备用节点 */
export const NODE_FAILOVER_LIMIT_MS = 10000;

const DEFAULT_COMPUTE_NODES = Object.freeze([
  Object.freeze({ id: 'k40-ubuntu', host: 'k40-ubuntu', primary: true }),
]);

const DEFAULT_ACTION_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ledger', 'actions.jsonl',
);

const SSH_TARGET_RE = /^[A-Za-z0-9._@:-]+$/;
const NODE_HEALTH_END = 'NODE_HEALTH_END';

/**
 * 解析算力节点池。
 * @param {string|null} rawJson 默认读 BIO_COMPUTE_NODES；未配置时只启用 K40
 * @returns {Array<{id: string, host: string, primary: boolean}>}
 */
export function parseComputeNodes(rawJson = process.env.BIO_COMPUTE_NODES) {
  if (!rawJson) return [...DEFAULT_COMPUTE_NODES];
  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('BIO_COMPUTE_NODES 必须是非空节点数组');
  }
  const normalized = parsed.map((node) => {
    if (!node || typeof node !== 'object' || !/^[A-Za-z0-9._-]+$/.test(node.id ?? '')) {
      throw new Error('算力节点缺少合法 id');
    }
    const host = String(node.host || node.id);
    if (!SSH_TARGET_RE.test(host)) {
      throw new Error(`算力节点 SSH 目标非法: ${host}`);
    }
    return {
      id: String(node.id),
      host,
      primary: node.primary === true,
    };
  });
  const primaries = normalized.filter((node) => node.primary);
  if (primaries.length !== 1 || primaries[0].id !== 'k40-ubuntu') {
    throw new Error('BIO_COMPUTE_NODES 必须且只能把 k40-ubuntu 配置为主节点');
  }
  if (new Set(normalized.map((node) => node.id)).size !== normalized.length) {
    throw new Error('BIO_COMPUTE_NODES 节点 id 不得重复');
  }
  return normalized;
}

/**
 * 单节点健康判定：SSH 离线或温度达到熔断阈值时不可用。
 * 温度不可读不算失败，避免缺传感器就误切备用节点。
 * @param {{id: string}} node
 * @param {{reachable?: boolean, tempC?: number|null}} [health]
 */
export function evaluateNode(node, health = {}) {
  const reachable = health.reachable !== false;
  const tempC = Number(health.tempC);
  const hot = Number.isFinite(tempC) && tempC >= NODE_TEMP_FAIL_C;
  const available = reachable && !hot;
  const reason = !reachable ? 'offline' : hot ? 'temperature_threshold' : null;
  return { ...node, available, reason };
}

/**
 * 单节点健康探针命令。温度不可读时仍会输出结束哨兵，避免把缺传感器误判成离线。
 */
export function buildNodeHealthCommand() {
  return [
    `(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1 | sed 's/^/TEMP|/')`,
    `echo '${NODE_HEALTH_END}'`,
  ].join('; ');
}

/**
 * 解析节点健康探针输出。毫摄氏度与摄氏度都接受，口径与 selfcheck.js 一致。
 * @param {string} text
 * @returns {{tempC: number|null, sawEnd: boolean}}
 */
export function parseNodeHealthOutput(text) {
  let tempMilli = null;
  let sawEnd = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === NODE_HEALTH_END) {
      sawEnd = true;
      continue;
    }
    if (line.startsWith('TEMP|')) {
      const value = Number(line.slice('TEMP|'.length));
      if (Number.isFinite(value)) tempMilli = value;
    }
  }
  return {
    tempC: tempMilli === null
      ? null
      : (tempMilli > 1000 ? Math.round(tempMilli / 1000) : Math.round(tempMilli)),
    sawEnd,
  };
}

/**
 * 通过 SSH 读取单个节点健康状态。SSH 非零退出视为离线，温度读不到仍视为可达。
 */
export function probeNodeHealth(node, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 4500));
  let result;
  try {
    result = runSync(
      [
        'ssh',
        '-o', 'BatchMode=yes',
        '-o', `ConnectTimeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}`,
        node.host,
        buildNodeHealthCommand(),
      ],
      { timeoutMs },
    );
  } catch (cause) {
    return { reachable: false, tempC: null, reason: cause.message };
  }
  if (result.error || result.code !== 0) {
    return {
      reachable: false,
      tempC: null,
      reason: result.error || String(result.stderr || 'ssh_offline').trim(),
    };
  }
  return {
    reachable: true,
    ...parseNodeHealthOutput(result.stdout),
    reason: null,
  };
}

/**
 * 按池序探活，出现首个健康节点即停止，避免主节点正常时产生多余 SSH。
 * 默认单节点最多 4.5 秒，整体截止时间锁死在 10 秒故障转移预算内。
 */
export function probeComputeNodes(nodes, options = {}) {
  const now = options.now || Date.now;
  const deadline = Number(options.deadline || (now() + NODE_FAILOVER_LIMIT_MS));
  const healthByNodeId = {};
  for (const node of nodes) {
    const remaining = deadline - Number(now());
    if (remaining <= 0) {
      healthByNodeId[node.id] = { reachable: false, tempC: null, reason: 'failover_timeout' };
      continue;
    }
    const health = probeNodeHealth(node, {
      timeoutMs: Math.min(Number(options.nodeTimeoutMs || 4500), remaining),
    });
    healthByNodeId[node.id] = health;
    if (evaluateNode(node, health).available) break;
  }
  return healthByNodeId;
}

/**
 * 按池序选择第一个健康节点。健康数据缺失时走 online + 无温度的保守路径。
 * @param {Array<{id: string, host: string, primary: boolean}>} nodes
 * @param {Record<string, {reachable?: boolean, tempC?: number|null}>} healthByNodeId
 * @param {number} [now] 可注入时钟，测试用它确认切换耗时
 */
export function selectComputeNode(nodes, healthByNodeId = {}, now = Date.now()) {
  const clock = typeof now === 'function' ? now : () => Number(now);
  const startedAt = Number(clock());
  for (const node of nodes) {
    const evaluated = evaluateNode(node, healthByNodeId[node.id] || {});
    if (evaluated.available) {
      return {
        ...evaluated,
        elapsedMs: Number(clock()) - startedAt,
      };
    }
  }
  return null;
}

/**
 * 构造一条 failover 动作记录。
 * @param {{fromNodeId: string, toNodeId: string, reason: string, taskId?: string, now?: number}} params
 */
export function buildFailoverAction(params = {}) {
  const now = Number(params.now || Date.now());
  const elapsedMs = Number(params.elapsedMs || 0);
  const timestamp = new Date(now).toISOString();
  return {
    id: params.id || `FAN-${now}-${randomUUID().slice(0, 8)}`,
    ts: timestamp,
    timestamp,
    type: 'action',
    kind: 'failover',
    task_id: params.taskId || null,
    from_node_id: params.fromNodeId,
    to_node_id: params.toNodeId,
    reason: params.reason,
    elapsed_ms: elapsedMs,
    within_10s: elapsedMs <= NODE_FAILOVER_LIMIT_MS,
  };
}

/**
 * 把 failover 动作追加为 JSONL 台账。
 * @param {string} filePath
 * @param {object} action
 */
export function appendAction(filePath, action) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(action)}\n`, 'utf8');
}

/**
 * 算力池路由接缝：调用方传入健康快照与真实执行器，task.js 只负责选择与落账。
 * @param {object} task
 * @param {{
 *   nodes?: Array<{id: string, host: string, primary: boolean}>,
 *   healthByNodeId?: Record<string, object>,
 *   executor: Function,
 *   now?: Function,
 *   actionPath?: string|null,
 *   logAction?: Function,
 * }} options
 */
export async function routeTask(task, options = {}) {
  const now = options.now || Date.now;
  const nodes = options.nodes || parseComputeNodes();
  const startedAt = Number(now());
  const healthByNodeId = options.healthByNodeId
    || (nodes.length === 1
      ? {}
      : await (options.healthProbe || probeComputeNodes)(nodes, {
        now,
        deadline: startedAt + NODE_FAILOVER_LIMIT_MS,
      }));
  const selected = selectComputeNode(nodes, healthByNodeId, now);
  if (!selected) {
    throw new Error('算力节点池无可用节点');
  }
  const primary = nodes.find((node) => node.primary) || nodes[0];
  if (selected.id !== primary.id && options.actionPath !== null) {
    const primaryHealth = healthByNodeId[primary.id] || {};
    const primaryEvaluation = evaluateNode(primary, primaryHealth);
    const action = buildFailoverAction({
      fromNodeId: primary.id,
      toNodeId: selected.id,
      reason: primaryEvaluation.reason || 'unavailable',
      taskId: task.taskId,
      elapsedMs: Number(now()) - startedAt,
      now: now(),
    });
    if (options.logAction) options.logAction(action);
    else appendAction(options.actionPath || process.env.BIO_ACTIONS_LEDGER || DEFAULT_ACTION_FILE, action);
  }
  const executor = options.executor || (async () => ({ ok: true }));
  const result = await executor(task, selected);
  return { ...result, nodeId: selected.id, elapsedMs: selected.elapsedMs };
}

/**
 * 把调用方给的步骤标识归一成**母版名**。
 *
 * 为什么需要：mod 化后客户端与 pipeline_dag 都用 mod id（l2_tf_scenic），
 * 而远端 bin/<line>/ 下部署的是母版名（scenic_tf）。下发时若不翻一层，
 * 会在 bin/ 下找不到文件，任务起不来。
 * 母版名原样返回（历史调用方与 runner 直跑不受影响）。
 * @param {string} step mod id 或母版名
 * @returns {string} 母版名
 */
export function resolveStepName(step) {
  const raw = String(step || '').trim();
  if (!raw) return raw;
  // 新命名形态 l<数字>_<工序>_<功能> 才需要翻；母版名（scenic_tf 等）直接返回
  if (!/^l\d_[a-z][a-z0-9_]*$/.test(raw)) return raw;
  // modToScriptMap 是 mod id -> 母版名；scriptToModMap 是反的，别拿错
  return modToScriptMap().get(raw) || raw;
}

/** 本地母版根：src/<line>/scripts/<step>（src 是母版，远端 bin 是部署产物） */
const SRC_SCRIPTS_ROOT = process.env.BIOANALYS_SRC_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'bio');
/** 图模板派生副本读取母版时的仓库根，生产路径随安装位置解析 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIGURE_MASTER_ROOT = path.resolve(REPO_ROOT, 'reference', '05.可参考生信代码', '可用代码预筛选', '源码');

/** 桥接四项断言引擎（aims §一.3 钦定；ops/ 属另一会话域，只调用不修改） */
export const BRIDGE_ENGINE_REMOTE = '/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py';
/** 桥接校验必须使用带 anndata 的分析 venv，避免系统 python3 缺包造成假红 */
export const BRIDGE_PYTHON_REMOTE = '/mnt/ssd/bio_data/ops/layout_autoload/bin/python3';

/** 桥接校验 ssh 同步超时：引擎内部 RDS 分支自带 120s，h5ad 大文件读取留足余量 */
export const BRIDGE_SSH_TIMEOUT_MS = 300000;

/**
 * 需要"敲除靶基因"的步骤（aims:185「勾选虚拟敲除强制弹出 target_ko_gene 必填框」）。
 *
 * 为什么写死这张表而不是从 PIPELINE_STEP_META 里按关键词猜：步骤名就是远端命令名
 * （src/<line>/scripts/ 下的母版文件名），它是稳定契约；而 note 里的【需指定
 * target_ko_gene】是给人看的说明文字，随时可能被改文案，拿它当判据会在改文案时静默失效。
 */
export const KNOCKOUT_STEPS = ['virtual_knockout', 'spatial_knockout'];
export const LONG_RUNNING_STEPS = ['scenic_tf', 'virtual_knockout'];

export function isLongRunningStep(step) {
  const raw = String(step || '').trim();
  const resolved = resolveStepName(step);
  return LONG_RUNNING_STEPS.includes(resolved) || raw === 'l2_ko_scrna';
}

/**
 * 靶基因符号的合法形态：首字符必须是字母或数字，其余为字母数字与 . _ -，总长 1..32。
 *
 * 为什么要卡首字符：靶基因会被写进远端环境变量，母版再拿去查 HVG/取表达；
 * 以 - 或 . 开头（如 "-x"、"../etc"）在下游任何按 argv 解析的实现里都会被当成
 * 选项或相对路径，是注入与误读的常见入口。合法基因符号本身也不会这么开头。
 */
export const KO_GENE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** 该步骤是否必须带靶基因（提交层与脚本构造层共用同一张表，避免两处判据分叉） */
export function requiresKoGene(stepName) {
  return KNOCKOUT_STEPS.includes(String(stepName ?? ''));
}

/** 靶基因符号是否合法（纯函数，零依赖；提交层用它出 400，母版契约里写明同名环境变量） */
export function isValidKoGene(value) {
  return typeof value === 'string' && KO_GENE_PATTERN.test(value);
}

/** 桥接检查命令构建失败（stepName/lineId 非法等），调用方应转 400 */
export class BridgeCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BridgeCheckError';
  }
}

/** 命令位的 Rscript 或显式 shim 变量调用（行首或分隔符后） */
const RSCRIPT_CALL_RE = /(^|[\s;&|"])(?:\$RSCRIPT_BIN|\$\{RSCRIPT_BIN\}|Rscript)(?=[\s"']|$)/;
/** 命令位的 python/python3 调用（heredoc 首行 `python3 - <<'PYSCRIPT'` 即此形态） */
const PYTHON_CALL_RE = /(^|[\s;&|])python3?(?=[\s"']|$)/;
/** 母版内部是否调用了桥接守卫（core/bridge_guard.sh，task-10） */
const GUARD_CALL_RE = /bridge_guard\.sh/;

/**
 * 剥掉 shell / R / Python 的注释，只留可执行代码（aims §三.2、todo 2.1）。
 *
 * 为什么必须剥：inspectBridgeNeed 用正则数命令位的 Rscript / python 调用数，
 * 注释里出现 "python3" 或 "Rscript" 字样会被当成真调用，把单语言母版误判成
 * bilingual 并强行触发桥接四项断言（ml_diagnostics 的注释踩过这个坑）。
 *
 * 规则（纯函数、零依赖、不改换行）：
 *   1. 行首（可选空白）后是 # 的整行注释清空；#! shebang 行原样保留。
 *   2. 引号外的 # 起行尾注释；引号内的 # 是字面量（'...' 与 "..." 都算引号）。
 *   3. 反斜杠转义的 \# 不当注释；$#（位置参数数）、${var#prefix} 这类紧随非空白字符的
 *      # 也不当注释（shell 里只有词首的 # 才起注释，这条规则让 $# 与参数展开不被误伤）。
 *   4. 只删注释本身与注释前的空白，代码字节与换行符（含 CRLF）原样保留。
 *
 * @param {string} rawText 母版原文
 * @returns {string} 剥离注释后的文本
 */
export function stripShellAndCodeComments(rawText) {
  const text = String(rawText ?? '');
  // split 捕获分隔符：偶数位是行内容，奇数位是原始换行符（\n 或 \r\n），join 回去换行不变
  const parts = text.split(/(\r?\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = stripLineComments(parts[i]);
  }
  return parts.join('');
}

/** 单行剥离：规则见 stripShellAndCodeComments 的注释 */
function stripLineComments(line) {
  if (line.trimStart().startsWith('#!')) return line; // shebang 必须保留
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === '\\') { i += 1; continue; } // 引号内反斜杠转义下一字符
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') { i += 1; continue; } // 转义的 \# 不当注释
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch !== '#') continue;
    const prev = i === 0 ? '' : line[i - 1];
    // shell 语义：只有词首的 # 才起注释，词中的 # 是字面量（$#、${v#p}、a#b）
    const atWordStart = prev === '' || /[\s;&|()]/.test(prev);
    if (!atWordStart) continue;
    return line.slice(0, i).replace(/\s+$/, '');
  }
  return line;
}

/**
 * 检查一个步骤是否需要过桥接四项断言，并给出可观测的判定依据。
 *
 * 判定依据只能来自仓库事实：读 src/<line>/scripts/<stepName> 本地母版，
 * 统计命令位的 Rscript 与 python 调用数，两者都 ≥1 才是跨语言步骤（单语言不过桥）。
 * 母版不存在时 bilingual=false，调用方必须 warn（不许静默当"不需要"，也不许阻断提交）。
 *
 * @returns {{bilingual: boolean, masterExists: boolean, masterPath: string|null,
 *            rCount: number, pCount: number, guardWired: boolean, reason: string}}
 */
export function inspectBridgeNeed(lineId, stepName) {
  const base = { bilingual: false, masterExists: false, masterPath: null, rCount: 0, pCount: 0, guardWired: false, reason: '' };
  if (!LINES.includes(lineId) || !/^[A-Za-z0-9._-]+$/.test(String(stepName ?? ''))) {
    return { ...base, reason: 'lineId 或 stepName 非法，无法定位母版' };
  }
  const masterPath = path.join(SRC_SCRIPTS_ROOT, lineId, 'scripts', String(stepName));
  if (!fs.existsSync(masterPath)) {
    return { ...base, masterPath, reason: `母版不存在: ${masterPath}` };
  }
  const content = fs.readFileSync(masterPath, 'utf8');
  // 计数只看可执行代码：注释里提到 python3 / Rscript 不算调用（aims §三.2）
  const code = stripShellAndCodeComments(content);
  const lines = code.split(/\r?\n/);
  const rCount = lines.filter((line) => RSCRIPT_CALL_RE.test(line)).length;
  const pCount = lines.filter((line) => PYTHON_CALL_RE.test(line)).length;
  return {
    bilingual: rCount >= 1 && pCount >= 1,
    masterExists: true,
    masterPath,
    rCount,
    pCount,
    // guardWired 也只看可执行代码：注释里提 bridge_guard.sh 不算接线（P3 遗留的假阳性）
    guardWired: GUARD_CALL_RE.test(code),
    reason: '',
  };
}

/**
 * needsBridgeCheck：桥接判定的布尔门（specs 指定的纯函数签名）。
 * 判定依据与 warn 信息用 inspectBridgeNeed 取。
 */
export function needsBridgeCheck(lineId, stepName) {
  const need = inspectBridgeNeed(lineId, stepName);
  return need.bilingual;
}

/**
 * 构造桥接四项断言的远端执行命令。
 *
 * 引擎 CLI 契约（tools/reporting/verify_bridge_checkpoint.py）要求 --input 指向一个真实存在的
 * .h5ad/.rds 文件，因此 inputs 必须参与构造：提交层拿到的就是本次任务声明的输入，
 * 不是编造：取第一个 .h5ad/.rds 输入；相对路径按该项目该线 processed/ 解析。
 * --from/--to 按引擎自身语义定：check_h5ad 用 anndata（Python 产物）、check_rds 用 R（R 产物）。
 *
 * @param {string} lineId
 * @param {string} stepName
 * @param {{inputs?: string[], projectId?: string}} [options]
 * @returns {{command: string, remoteScript: string, inputFile: string, fromLang: string, toLang: string, reason: string|null}}
 *          command 与 remoteScript 同值（契约字段）；无可校验输入时两者为 null + reason
 * @throws {BridgeCheckError} lineId 非法，或 stepName 含 shell 元字符（拒绝，不消毒放行）
 */
export function buildBridgeCheckCommand(lineId, stepName, { inputs = [], projectId = DEFAULT_PROJECT } = {}) {
  if (!LINES.includes(lineId)) {
    throw new BridgeCheckError(`line_id 非法: ${lineId}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(String(stepName ?? ''))) {
    throw new BridgeCheckError(`step 含 shell 元字符或非法字符，拒绝进入桥接命令: ${stepName}`);
  }
  const list = Array.isArray(inputs) ? inputs : [];
  const raw = list.find((item) => /\.(h5ad|rds)$/i.test(String(item)));
  if (raw === undefined) {
    return {
      command: null, remoteScript: null, inputFile: null, fromLang: null, toLang: null,
      reason: 'inputs 中没有 .h5ad/.rds（桥接引擎仅支持这两种格式），无法构造校验命令',
    };
  }
  const inputPath = String(raw).startsWith('/')
    ? String(raw)
    : `${projectLineDir(projectId, lineId)}/processed/${raw}`;
  const isH5ad = /\.h5ad$/i.test(inputPath);
  const fromLang = isH5ad ? 'Python' : 'R';
  const toLang = isH5ad ? 'R' : 'Python';
  // 末尾 2>&1：引擎 fail() 把 [BRIDGE FAIL] 原因写 stderr，而真链实测（K40 高负载时）
  // ssh 回传的 stderr 通道会间歇性丢失，导致提交层 400 error 里点不了断言项。
  // 把 stderr 并入 stdout 单通道后，[BRIDGE FAIL]/[BRIDGE OK] 一律走 stdout 稳定回传；
  // shellQuote 对 --input 的单引号转义不变，命令结构其余不变。
  const remoteScript = `${BRIDGE_PYTHON_REMOTE} ${BRIDGE_ENGINE_REMOTE} --input ${shellQuote(inputPath)} --from ${fromLang} --to ${toLang} 2>&1`;
  return { command: remoteScript, remoteScript, inputFile: inputPath, fromLang, toLang, reason: null };
}

/**
 * 同步执行桥接校验（照 run.js 的 ssh 范式：BatchMode + ConnectTimeout）。
 * 返回 { code, stdout, stderr, durationMs }；spawnSync 超时/启动失败时 code 为 -1。
 * 只在 index.js 提交层调用（同步阻塞在请求回调里，失败必须有明确 HTTP 回应）。
 */
export function runBridgeCheckSync(plan) {
  const startedAt = Date.now();
  // 走 proc.js 单 seam：白名单与 BIO_COMPUTE_ADAPTER 都在那一层收口，
  // 本地此处不再自带 ssh 直连分支（2026-11-01 P3-03 第一刀）。
  const result = runSync(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', plan.remoteScript],
    { timeoutMs: BRIDGE_SSH_TIMEOUT_MS },
  );
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * 项目元数据文件路径。任务脚本要把 project.json 的位置告诉出图模板外挂，
 * 它才能读到客户选的 plot_layout_config。
 */
function projectMetaPath(projectId) {
  const id = sanitizeProjectId(projectId) || DEFAULT_PROJECT;
  return `/mnt/ssd/bio_data/projects/${id}/project.json`;
}

/** 单引号转义成 '\''，保证远端 shell 不把命令拆断 */
function shellQuote(text) {
  return `'${String(text).replace(/'/g, String.raw`'\''`)}'`;
}

/** 图模板派生副本的固定文件名，模板 id 已是安全段，不在这里重建命名规则 */
function adaptFileName(template) {
  const extension = template.language === 'python' ? '.py' : '.R';
  return `adapt_${template.id}${extension}`;
}

/** 本地项目根可由测试重定向；生产默认仍是仓库 workspace/projects/ */
export function localAdaptPath(root = process.env.BIO_LOCAL_PROJECTS || REPO_ROOT, projectId, templateId, language = 'r') {
  const safeProject = sanitizeProjectId(projectId);
  if (!safeProject) throw new Error(`project_id 非法: ${projectId}`);
  return path.resolve(
    String(root),
    'workspace/projects',
    safeProject,
    'figures',
    'adapt',
    adaptFileName({ id: templateId, language }),
  );
}

function adaptManifestPath(root = process.env.BIO_LOCAL_PROJECTS || REPO_ROOT, projectId) {
  const safeProject = sanitizeProjectId(projectId);
  if (!safeProject) throw new Error(`project_id 非法: ${projectId}`);
  return path.resolve(String(root), 'workspace/projects', safeProject, 'figures', 'adapt', 'manifest.json');
}

function readManifest(manifestFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 复制 ready 母版并生成项目私有适配副本。
 *
 * 母版只读，头部带回 Master-Source 与 Master-SHA256；adapt_vars 写成语言级
 * ADAPT_VARS 声明，不修改 source 的可执行逻辑。manifest 是后续交付对账的窄接口。
 */
export function deriveAdaptedFigure({
  root = process.env.BIO_LOCAL_PROJECTS || REPO_ROOT,
  projectId,
  lineId,
  templateId,
  template,
  adaptVars = {},
}) {
  const errors = [];
  const safeProject = sanitizeProjectId(projectId);
  if (!safeProject) errors.push(`project_id 非法: ${projectId}`);
  if (!LINES.includes(lineId)) errors.push(`line_id 非法: ${lineId}`);
  if (template?.id !== templateId || typeof template?.source !== 'string') {
    errors.push(`templateId 与 template 不匹配: ${templateId}`);
  }
  if (template?.deps_status !== 'ready' || template?.verified !== true) {
    errors.push(`图模板 ${templateId} 不是 ready 状态`);
  }
  if (errors.length > 0) return { ok: false, errors, template: null, local_path: null };

  const master = path.resolve(REPO_ROOT, template.source);
  const masterRelative = path.relative(FIGURE_MASTER_ROOT, master);
  if (!masterRelative || masterRelative === '..' || masterRelative.startsWith(`..${path.sep}`)
    || path.isAbsolute(masterRelative)) {
    errors.push('模板 source 不在仓库 reference/05. 内');
    return { ok: false, errors, template, local_path: null };
  }
  if (!fs.existsSync(master)) {
    return { ok: false, errors: [`母版不存在: ${template.source}`], template, local_path: null };
  }
  const masterBytes = fs.readFileSync(master);
  const masterSha = createHash('sha256').update(masterBytes).digest('hex');
  if (template.source_sha256 !== masterSha) {
    return { ok: false, errors: [`母版 SHA256 漂移: ${templateId}`], template, local_path: null };
  }

  const safeLine = LINES.includes(lineId) ? lineId : null;
  const adaptDir = path.resolve(String(root), 'workspace/projects', safeProject, 'figures', 'adapt');
  fs.mkdirSync(adaptDir, { recursive: true });
  const localPath = path.join(adaptDir, adaptFileName(template));
  let adapted;
  try {
    adapted = buildAdaptedFigureSource({
      template: { ...template, source_sha256: masterSha },
      masterSource: masterBytes.toString('utf8'),
      inputPath: adaptVars.input_data,
      projectId: safeProject,
      lineId: safeLine,
      adaptVars,
    });
  } catch (cause) {
    return {
      ok: false,
      errors: [cause instanceof Error ? cause.message : String(cause)],
      template,
      local_path: null,
    };
  }
  const header = adapted.split('\n')[0];
  atomicWriteFileSync(localPath, adapted, 'utf8');

  const manifestFile = adaptManifestPath(root, safeProject);
  const entries = readManifest(manifestFile).filter((item) => item.template_id !== templateId);
  const entry = {
    template_id: templateId,
    project_id: safeProject,
    line_id: safeLine,
    master_source: template.source,
    master_sha256: masterSha,
    derived_sha256: createHash('sha256').update(fs.readFileSync(localPath)).digest('hex'),
    adapt_vars: adaptVars,
    local_path: path.resolve(localPath),
    remote_path: `/mnt/ssd/bio_data/projects/${safeProject}/${safeLine}/scripts/${adaptFileName(template)}`,
  };
  entries.push(entry);
  atomicWriteFileSync(manifestFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    errors: [],
    template,
    selected_template: template.id,
    adapt_vars: adaptVars,
    local_path: localPath,
    remote_path: entry.remote_path,
    adapt_header: header,
    master_sha256: masterSha,
    manifest_path: manifestFile,
    manifest_entry: entry,
  };
}

/**
 * 生成远端执行脚本。
 *
 * 工作目录固定在该项目该线的 processed/（项目隔离，命令不会跑到别的项目去）。
 * PATH 里注入本线的全局 bin/：步骤脚本由部署通道（tools/ops/06_deploy_scripts.ps1）从本地
 * src/<line>/scripts/ 落到服务器 bin/<line>/ 并置可执行位，step 名即可执行文件名。
 * bin 全局一份，所有项目共用（代码本体不随项目复制）。
 * 没有这一行，服务器上找不到命令，一切 step 都是 command not found。
 *
 * @param {{projectId?: string, lineId: string, step: string, inputs: string[], outputs: string[], seed?: number, throttled?: boolean, targetKoGene?: string, detached?: boolean, wrapperTaskId?: string}} task
 * @returns {string}
 */
export function buildTaskScript(task) {
  const {
    projectId = DEFAULT_PROJECT, lineId, step, inputs = [], outputs = [], seed, throttled = false,
    targetKoGene, detached = false, wrapperTaskId = '', scriptPath = '', language = '',
    canonicalOutput = '', adapted = false,
  } = task;
  if (!LINES.includes(lineId)) {
    throw new Error(`line_id 非法: ${lineId}`);
  }
  // mod id -> 母版名。调用方（客户端 / pipeline_dag）可能给 l2_tf_scenic，
  // 而远端 bin/<line>/ 与本地 src/<line>/scripts/ 都是母版名。这里统一翻一层，
  // 下游所有使用点（母版路径、bin 路径、wrapper 参数）就都拿到母版名了。
  const stepName = resolveStepName(step);
  if (!stepName) {
    throw new Error('step 不能为空');
  }

  const lineDir = projectLineDir(projectId, lineId);
  const outputList = Array.isArray(outputs) ? outputs : [];
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `cd ${lineDir}/processed`,
    `SEED=${Number(seed) || 0}`,
  ];

  if (seed !== undefined && seed !== null) {
    // 写进环境而不是塞进命令行，是为了让 R/Python 侧读取方式统一
    lines.push('export BIOANALYS_SEED="$SEED"');
  }

  // P14 / aims:185：虚拟敲除的靶基因从提交层透传到母版，注入方式与种子一致（环境变量）。
  // 选环境变量而不是命令行参数的原因：
  //   1. 母版是 Python（virtual_knockout）与 Python（spatial_knockout），读 os.environ 一处口径；
  //   2. 参数位已被 --input/--output/--seed 占用，加位置参数会破坏既有母版解析；
  //   3. export 出来的变量是子进程继承的，tools/ops/run_throttled_task.sh 只是 bash 子进程
  //      （内部再 nice/ionice 起解释器），不吞环境，变量能一路到母版。
  // 非敲除步骤即使传了 targetKoGene 也不注入：一张表（requiresKoGene）管到底，语义是"忽略"。
  // 缺基因就抛错而不是退回 TNF 兜底：母版兜底只用于直连 K40 手工跑（stderr 留痕），
  // 提交层是唯一全知"这次敲的是谁"的地方，静默跑 TNF 会产出与用户预期不符的结论。
  if (requiresKoGene(stepName)) {
    if (!isValidKoGene(targetKoGene)) {
      throw new Error(
        `虚拟敲除步骤必须指定合法 target_ko_gene（字母数字与 . _ -，长度 1..32）: ${JSON.stringify(targetKoGene ?? null)}`
      );
    }
    lines.push(`export BIO_KO_GENE=${shellQuote(targetKoGene)}`);
  }

  // R 端还需要一个 Rscript 垫片：母版 R 脚本统一写 `Rscript --vanilla`，
  // 而 --vanilla 会跳过 R_PROFILE_USER，模板挂载会静默失效（踩坑 #169）。
  // 垫片把 --vanilla 降级为等价组合并保留 user profile，必须排在 PATH 最前。
  lines.push('export PATH="/mnt/ssd/bio_data/ops/layout_autoload/bin:${PATH}"');
  lines.push(`export PATH="${binDir(lineId)}:$PATH"`);

  // 出图模板注入：客户在需求单选的 plot_layout_config 必须真的生效。
  // 母版脚本按"绝对只读"不能改，所以把模板应用做成解释器启动时的外挂：
  //   Python → PYTHONPATH 里有 layout_autoload/，sitecustomize 自动加载
  //   R      → R_PROFILE_USER 指向 layout_autoload/Rprofile
  // 两者都只在 BIOANALYS_PROJECT_JSON 存在时介入，非出图步骤零影响。
  lines.push(`export BIOANALYS_PROJECT_JSON="${projectMetaPath(projectId)}"`);
  lines.push('export BIOANALYS_LAYOUT_LIB="/mnt/ssd/bio_data/bin"');
  lines.push('export PYTHONPATH="/mnt/ssd/bio_data/ops/layout_autoload:${PYTHONPATH:-}"');
  lines.push('export R_PROFILE_USER="/mnt/ssd/bio_data/ops/layout_autoload/Rprofile"');

  // inputs/outputs 必须是数组；调用方传了裸字符串时归一化为空数组而不是抛 TypeError
  // （TypeError 会顺着事件回调打死整个 Node 进程，2026-10-19 实测踩到）。
  const inputList = Array.isArray(inputs) ? inputs : [];
  const inputArgs = inputList.map((path) => `--input ${shellQuote(path)}`).join(' ');
  const outputArgs = outputList.map((path) => `--output ${shellQuote(path)}`).join(' ');
  const seedArgs = seed === undefined || seed === null ? '' : `--seed ${Number(seed)}`;

  // 构建原始 step 命令
  let rawCmd;
  let gatePath = `${binDir(lineId)}/${stepName}`;
  if (adapted) {
    const adaptedScript = String(scriptPath || '');
    const expectedPrefix = `/mnt/ssd/bio_data/projects/${projectId}/${lineId}/scripts/adapt_`;
    if (!adaptedScript.startsWith(expectedPrefix) || !/\.(R|py)$/.test(adaptedScript)) {
      throw new Error(`adapted scriptPath 非法: ${adaptedScript}`);
    }
    if (!canonicalOutput || outputList.length !== 1) {
      throw new Error('adapted 任务必须提供一个 canonicalOutput 和一个 output');
    }
    const scriptDir = path.posix.dirname(adaptedScript);
    const outputPath = outputList[0];
    const candidates = [path.posix.join(scriptDir, canonicalOutput)];
    if (!canonicalOutput.startsWith('figures/')) {
      candidates.push(path.posix.join(scriptDir, 'figures', canonicalOutput));
    }
    const runner = language === 'python'
      ? `python3 ${shellQuote(adaptedScript)}`
      : `Rscript --vanilla ${shellQuote(adaptedScript)}`;
    const copyBranches = candidates.map((candidate, index) => {
      const prefix = index === 0 ? 'if' : 'elif';
      return `${prefix} [ -f ${shellQuote(candidate)} ]; then cp ${shellQuote(candidate)} ${shellQuote(outputPath)};`;
    }).join(' ');
    rawCmd = [
      `cd ${shellQuote(scriptDir)}`,
      `mkdir -p ${shellQuote(path.posix.dirname(outputPath))}`,
      `rm -f ${shellQuote(outputPath)}`,
      runner,
      `${copyBranches} else echo ${shellQuote(`adapted output missing: ${canonicalOutput}`)} >&2; exit 1; fi`,
    ].join(' && ');
    gatePath = adaptedScript;
  } else {
    rawCmd = [
      shellQuote(stepName),
      inputArgs,
      outputArgs,
      seedArgs,
    ].filter(Boolean).join(' ');
  }

  if (throttled) {
    // 走 tools/ops/run_throttled_task.sh：nice/ionice 降权 + 存储水位与跨线门禁 + 线程封顶（aims §六.3）。
    // 用**命令串模式**（BIO_EXEC_CMD），$5 只给门禁做跨线静态扫描，传母版绝对路径。
    // 2026-10-21 之前这里把整条 rawCmd 当 $5 传，包装器随后执行 "$SCRIPT_PATH"：那是一个
    // 含空格的文件名，必然 ENOENT，所以 throttled 分支长期不可用，引擎（run.js）只能
    // throttled=false 绕过包装器直跑，降权/门禁/线程封顶对工作台下发的任务全部失效（D-21）。
    const resolvedWrapperTaskId = wrapperTaskId
      || `task_$(date +%s)_${Math.random().toString(36).slice(2, 8)}`;
    if (detached && !/^[A-Za-z0-9._-]+$/.test(resolvedWrapperTaskId)) {
      throw new Error(`wrapperTaskId 非法: ${resolvedWrapperTaskId}`);
    }
    // 命令串要整串再套一层单引号：里面本来就含 '--input' 这类单引号，shellQuote 负责 ''' 转义
    lines.push(`export BIO_EXEC_CMD=${shellQuote(rawCmd)}`);
    // 引擎自己有权威台账（server/run.js persistEntry，字段含 project_id/seed），
    // 包装器再写一份精简台账就成了双账，故关掉包装器台账（D-21）
    lines.push(`export BIO_WRAPPER_LEDGER=${detached ? '1' : '0'}`);
    // 盲点一（2026-11-01）：detached 任务里包装器经 setsid 成为组长，置位标记让
    // 包装器退出时对整个进程组收尾（防孤儿 R/Python 吃满算力，见 run_throttled_task.sh）。
    lines.push(`export BIO_DETACHED=${detached ? '1' : '0'}`);
    if (detached) {
      lines.push(`export BIO_WRAPPER_LEDGER_PATH="/tmp/${resolvedWrapperTaskId}_ledger.json"`);
    }
    const wrapperCommand = `bash /mnt/ssd/bio_data/ops/run_throttled_task.sh ${resolvedWrapperTaskId} ${lineId} ${shellQuote(stepName)} self ${shellQuote(gatePath)}`;
    if (detached) {
      lines.push(
        `setsid nohup ${wrapperCommand} > ${SYSTEM_LOGS}/${resolvedWrapperTaskId}.wrapper.log 2>&1 < /dev/null &`,
      );
      lines.push(`echo ${shellQuote(resolvedWrapperTaskId)}`);
    } else {
      lines.push(wrapperCommand);
    }
  } else {
    lines.push(rawCmd);
  }

  return lines.join('\n');
}

/**
 * 构造一条任务台账 JSON（字段见 docs/ledger-schema.md）。
 *
 * environment 四字段由调用方从 src/<line>/envs/manifest.txt 读后传入（manifest.js），
 * 这里的默认值只是 manifest 缺失时的退化路径，正常台账不写死。
 *
 * @param {object} params
 * @returns {object} 台账对象
 */
export function buildLedgerEntry(params) {
  const {
    projectId = DEFAULT_PROJECT,
    lineId,
    step,
    seed,
    inputs = [],
    outputs = [],
    status,
    checkpointStatus = 'skipped',
    exitCode,
    errorLog = null,
    startedAt,
    endedAt,
    language = 'R',
    version = '4.5.3',
    envName = `${lineId}_env`,
    containerImage = 'proot-ubuntu24.04-aarch64',
  } = params;

  if (!LINES.includes(lineId)) {
    throw new Error(`line_id 非法: ${lineId}`);
  }
  // step_name 一律记母版名：61 条历史台账都是母版名，混用会让台账巡检与审计失配。
  // 调用方传的是 mod id 时，额外记一个 mod_id 字段保留客户视角追溯。
  const stepName = resolveStepName(step);
  const modId = /^l\d_[a-z][a-z0-9_]*$/.test(String(step || '').trim())
    ? String(step).trim()
    // 键必须带 lineId：enrichment_figures 等母版名跨线同名，不带线会反查错线
    : (scriptToModMap(lineId).get(`${lineId}:${stepName}`) || null);
  if (!sanitizeProjectId(projectId)) {
    throw new Error(`project_id 非法: ${projectId}`);
  }
  if (status === 'failed' && !errorLog) {
    // 失败的账不带 error_log 等于白记，这里直接拒绝而不是放它出去
    throw new Error('status=failed 必须提供 errorLog');
  }

  return {
    task_id: randomUUID(),
    project_id: projectId,
    line_id: lineId,
    step_name: stepName,
    // 客户视角的 mod id（母版名调用时为 null）。双列并存：
    // 台账巡检与历史对账认 step_name，客户报告与组合追溯认 mod_id。
    mod_id: modId,
    status,
    start_time: startedAt || new Date().toISOString(),
    end_time: endedAt || new Date().toISOString(),
    environment: {
      language,
      version,
      env_name: envName,
      container_image: containerImage,
      random_seed: seed ?? null,
    },
    resource_usage: {
      max_cpu_percent: null,
      max_memory_gb: null,
      disk_io_peak_mb_s: null,
    },
    io_files: {
      input: inputs,
      output: outputs,
    },
    checkpoint_status: checkpointStatus,
    error_log: errorLog,
    exit_code: exitCode ?? null,
    next_action_suggested: null,
  };
}
