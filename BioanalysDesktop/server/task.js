/**
 * 任务下发：把一次步骤执行变成"可下发命令 + 可归档台账"
 *
 * 两条铁律在这里收口：
 *   1. 命令只触及本线，含其他线 line_id 的一律不出这道门（audit.js 是兜底，这里是构造时就保证）；
 *   2. 台账必须能被 ledger.js 自己判合法，否则写出去的账自己就违规，成了讽刺。
 */

import { randomUUID } from 'node:crypto';
// default 导入而非具名导入：ESM 具名导入是链接期快照，测试拦截不到（见 run.js 同款注释）。
// 桥接校验的同步 ssh 执行必须可在进程内被测试垫片替换。
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINES, DEFAULT_PROJECT, projectLineDir, binDir, sanitizeProjectId } from './domain.js';
import { assertAllowedProgram } from './proc.js';

/** 本地母版根：src/<line>/scripts/<step>（src 是母版，远端 bin 是部署产物） */
const SRC_SCRIPTS_ROOT = process.env.BIOANALYS_SRC_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** 桥接四项断言引擎（aims §一.3 钦定；ops/ 属另一会话域，只调用不修改） */
export const BRIDGE_ENGINE_REMOTE = '/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py';

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

/** 命令位的 Rscript 调用（行首或分隔符后；`BIOANALYS_SEED=x Rscript`、`["Rscript"` 也算） */
const RSCRIPT_CALL_RE = /(^|[\s;&|"])Rscript(?=[\s"']|$)/;
/** 命令位的 python/python3 调用（heredoc 首行 `python3 - <<'PYSCRIPT'` 即此形态） */
const PYTHON_CALL_RE = /(^|[\s;&|])python3?(?=[\s"']|$)/;
/** 母版内部是否调用了桥接守卫（src/bridge_guard.sh，task-10） */
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
 * 引擎 CLI 契约（ops/verify_bridge_checkpoint.py）要求 --input 指向一个真实存在的
 * .h5ad/.rds 文件，因此 inputs 必须参与构造——提交层拿到的就是本次任务声明的输入，
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
  const remoteScript = `python3 ${BRIDGE_ENGINE_REMOTE} --input ${shellQuote(inputPath)} --from ${fromLang} --to ${toLang} 2>&1`;
  return { command: remoteScript, remoteScript, inputFile: inputPath, fromLang, toLang, reason: null };
}

/**
 * 同步执行桥接校验（照 run.js 的 ssh 范式：BatchMode + ConnectTimeout）。
 * 返回 { code, stdout, stderr, durationMs }；spawnSync 超时/启动失败时 code 为 -1。
 * 只在 index.js 提交层调用（同步阻塞在请求回调里，失败必须有明确 HTTP 回应）。
 */
export function runBridgeCheckSync(plan) {
  assertAllowedProgram(['ssh']);
  const startedAt = Date.now();
  const result = childProcess.spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', plan.remoteScript],
    { encoding: 'utf8', timeout: BRIDGE_SSH_TIMEOUT_MS, windowsHide: true },
  );
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
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

/**
 * 生成远端执行脚本。
 *
 * 工作目录固定在该项目该线的 processed/（项目隔离，命令不会跑到别的项目去）。
 * PATH 里注入本线的全局 bin/：步骤脚本由部署通道（ops/06_deploy_scripts.ps1）从本地
 * src/<line>/scripts/ 落到服务器 bin/<line>/ 并置可执行位，step 名即可执行文件名。
 * bin 全局一份，所有项目共用（代码本体不随项目复制）。
 * 没有这一行，服务器上找不到命令，一切 step 都是 command not found。
 *
 * @param {{projectId?: string, lineId: string, step: string, inputs: string[], outputs: string[], seed?: number, throttled?: boolean, targetKoGene?: string}} task
 * @returns {string}
 */
export function buildTaskScript(task) {
  const {
    projectId = DEFAULT_PROJECT, lineId, step, inputs = [], outputs = [], seed, throttled = false,
    targetKoGene,
  } = task;
  if (!LINES.includes(lineId)) {
    throw new Error(`line_id 非法: ${lineId}`);
  }

  const lineDir = projectLineDir(projectId, lineId);
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
  //   3. export 出来的变量是子进程继承的，ops/run_throttled_task.sh 只是 bash 子进程
  //      （内部再 nice/ionice 起解释器），不吞环境，变量能一路到母版。
  // 非敲除步骤即使传了 targetKoGene 也不注入：一张表（requiresKoGene）管到底，语义是"忽略"。
  // 缺基因就抛错而不是退回 TNF 兜底：母版兜底只用于直连 K40 手工跑（stderr 留痕），
  // 提交层是唯一全知"这次敲的是谁"的地方，静默跑 TNF 会产出与用户预期不符的结论。
  if (requiresKoGene(step)) {
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
  const outputList = Array.isArray(outputs) ? outputs : [];
  const inputArgs = inputList.map((path) => `--input ${shellQuote(path)}`).join(' ');
  const outputArgs = outputList.map((path) => `--output ${shellQuote(path)}`).join(' ');
  const seedArgs = seed === undefined || seed === null ? '' : `--seed ${Number(seed)}`;

  // 构建原始 step 命令
  const rawCmd = [
    shellQuote(step),
    inputArgs,
    outputArgs,
    seedArgs,
  ].filter(Boolean).join(' ');

  if (throttled) {
    // 通过 ops/run_throttled_task.sh 包装：默认不绑核（EAS 动态调度，2026-10-20 契约变更，实测更快）+ nice/ionice 降权 + 门禁 + 台账 JSON
    const taskId = `task_$(date +%s)_${Math.random().toString(36).slice(2, 8)}`;
    lines.push(
      `bash /mnt/ssd/bio_data/ops/run_throttled_task.sh ${taskId} ${lineId} ${shellQuote(step)} self ${rawCmd}`
    );
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
    version = '4.3.3',
    envName = `${lineId}_env`,
    containerImage = 'proot-ubuntu24.04-aarch64',
  } = params;

  if (!LINES.includes(lineId)) {
    throw new Error(`line_id 非法: ${lineId}`);
  }
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
    step_name: step,
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
