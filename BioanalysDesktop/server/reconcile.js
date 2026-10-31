/**
 * SSH 链路抖动后的远端任务状态对账。
 *
 * 任务常驻 ssh 断开时，退出码只能说明本地连接断了，不能说明远端任务死了。
 * 本模块只在 child exit 后做一次只读探测：读 _running 标记和产物存在性。
 * 探针不可用一律 unknown，保持原判，绝不把“探不到”升级成“已失败”。
 */

// default 导入 + 属性调用是既有进程接缝，node:test 可以拦 spawnSync。
import childProcess from 'node:child_process';

import { assertAllowedProgram } from './proc.js';
import { SYSTEM_LOGS } from './domain.js';

/** 远端标记目录：wrapper 已固定写入 system_logs/_running/<task_id>.json */
export const RUNNING_DIR = `${SYSTEM_LOGS}/_running`;

/** 探针输出哨兵：防 ssh 丢包或远端命令截断时把空输出误读成成功 */
export const RECONCILE_PROBE_SENTINEL = 'RECONCILE_END';

/** 探针只查文件存在性，不做任务重试，15 秒足够覆盖一次连接建立 */
const PROBE_TIMEOUT_MS = 15000;

/** 五种对账状态是对外契约，顺序即文档口径 */
export const RECONCILE_STATES = [
  'completed',
  'link_lost_still_running',
  'link_lost_output_present',
  'failed',
  'unknown',
];

/**
 * 判定远端真实状态。
 *
 * runningMarkers 必须是当前任务的标记列表；probeRemoteState 已按
 * `<task_id>.json` 精确过滤，这里把非空数组当作“本任务仍在运行”信号。
 * expectedOutputs 是与台账 io_files.output 对齐的存在性列表。
 *
 * @param {{exitCode: number|null, runningMarkers: string[]|null,
 *   expectedOutputs: Array<{path: string, exists: boolean}>|null}} signals
 * @returns {(typeof RECONCILE_STATES)[number]}
 */
export function classifyRemoteState({ exitCode, runningMarkers, expectedOutputs } = {}) {
  // exitCode 是状态分类的前提信号。undefined / 字符串 / 浮点数说明调用方传错了
  // 台账契约，这里显式抛 TypeError；静默归入 unknown 会把“参数错”误诊成“链路不可见”。
  if (exitCode !== null && !Number.isInteger(exitCode)) {
    throw new TypeError(`exitCode 必须是 null 或整数: ${JSON.stringify(exitCode)}`);
  }

  const markerList = Array.isArray(runningMarkers) ? runningMarkers : null;
  const outputList = Array.isArray(expectedOutputs) ? expectedOutputs : null;
  const outputSignalKnown = outputList !== null
    && outputList.every((item) => item
      && typeof item === 'object'
      && typeof item.path === 'string'
      && typeof item.exists === 'boolean');

  const exitZero = exitCode === 0;
  const exitNonZero = exitCode === null
    || (Number.isInteger(exitCode) && exitCode !== 0);

  if (exitZero) return 'completed';
  if (!exitNonZero) return 'unknown';

  // 探针链路失败时两个信号都是 null；此时没有远端事实，不能判失败。
  if (markerList === null || !outputSignalKnown) return 'unknown';
  if (markerList.length > 0) return 'link_lost_still_running';
  if (outputList.length > 0 && outputList.every((item) => item.exists)) {
    return 'link_lost_output_present';
  }
  if (outputList.length > 0 && outputList.some((item) => !item.exists)) return 'failed';
  return 'unknown';
}

/**
 * 把远端探针结果折算成台账修正字段。
 *
 * @param {object} entry 已构造的台账条目
 * @param {{state: 'ok'|'unknown', runningMarkers: string[]|null,
 *   expectedOutputs: Array<{path: string, exists: boolean}>|null}} remoteProbe
 * @returns {{status: string, checkpoint_status: string, reconcile_note: string}|null}
 *   只在 link_lost_* 时返回修正字段；其余返回 null 保持原判。
 */
export function reconcileTask(entry, remoteProbe) {
  const state = remoteProbe?.state === 'unknown'
    ? 'unknown'
    : classifyRemoteState({
      exitCode: entry?.exit_code,
      runningMarkers: remoteProbe?.runningMarkers,
      expectedOutputs: remoteProbe?.expectedOutputs,
    });

  if (state === 'link_lost_still_running') {
    return {
      // 这里保持 failed 是终态：没有人会回来更新这条台账，running 会变成死账。
      // checkpoint 用 skipped 表示“未评估”，而不是把还没结束的任务误判成 checkpoint 失败。
      status: 'failed',
      checkpoint_status: 'skipped',
      reconcile_note: `reconcile: link_lost_still_running; _running 标记存在; 链路丢失，远端仍在运行，需人工确认; exit_code=${entry?.exit_code}; 未重试`,
    };
  }

  if (state !== 'link_lost_output_present') return null;
  if (!signalsMatchEntryOutputs(entry, remoteProbe)) return null;

  const outputs = remoteProbe.expectedOutputs.length;
  // 无种子的完成账不能记 passed；这里按台账可复现性契约降为 skipped。
  const checkpoint = entry?.environment?.random_seed == null ? 'skipped' : 'passed';
  return {
    status: 'completed',
    checkpoint_status: checkpoint,
    reconcile_note: `reconcile: link_lost_output_present; _running 标记消失; ${outputs}/${outputs} 产物存在; 未重试`,
  };
}

/** 产物信号必须和台账声明一一对应，防止调用方拿别条任务的探针结果修正台账 */
function signalsMatchEntryOutputs(entry, remoteProbe) {
  const outputs = entry?.io_files?.output;
  const signals = remoteProbe?.expectedOutputs;
  if (!Array.isArray(outputs) || !Array.isArray(signals)) return false;
  if (outputs.length !== signals.length) return false;
  return outputs.every((path, index) => String(path) === String(signals[index]?.path));
}

/**
 * 同步读取远端任务状态。
 *
 * 输入是 NUL 分隔路径列表，经 base64 走 stdin；远端命令本身不携带输出路径，
 * 避免输出数量增长时 ssh argv 被 shell 截断。命令只查 _running 标记和 -e 存在性。
 * 产物路径只接受绝对路径：相对路径依赖远端 cwd，属于隐性契约，探针直接返回 unknown。
 *
 * @param {string} taskId wrapper 使用的任务 ID
 * @param {string[]} expectedOutputs 与台账 io_files.output 对齐的路径
 * @param {{timeoutMs?: number}} [options]
 * @returns {{state: 'ok'|'unknown', reason: string|null, runningMarkers: string[]|null,
 *   expectedOutputs: Array<{path: string, exists: boolean}>|null, probeExitCode: number|null}}
 */
export function probeRemoteState(taskId, expectedOutputs, options = {}) {
  const fail = (reason, code = null) => ({
    state: 'unknown',
    reason,
    runningMarkers: null,
    expectedOutputs: null,
    probeExitCode: code,
  });

  const safeTaskId = String(taskId ?? '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(safeTaskId)) return fail(`taskId 非法: ${JSON.stringify(taskId)}`);

  const paths = Array.isArray(expectedOutputs) ? expectedOutputs : null;
  if (paths === null) return fail('expectedOutputs 不是数组');
  if (paths.some((path) => typeof path !== 'string'
    || path === ''
    || !path.startsWith('/')
    || path.includes('\0'))) {
    return fail('expectedOutputs 只接受绝对路径；相对路径会依赖远端 cwd，不安全');
  }

  const markerPath = `${RUNNING_DIR}/${safeTaskId}.json`;
  // NUL 分隔让路径里的空格、单引号和多行文件名都能逐条读入；
  // base64 只承载本地已编码的路径清单，不进 ssh argv。
  const command = `if [ -f ${shellQuote(markerPath)} ]; then printf 'RUNNING\\n'; else printf 'NOT_RUNNING\\n'; fi; `
    + `base64 -d | while IFS= read -r -d '' path; do `
    + `if [ -e "$path" ]; then printf 'PRESENT\\n'; else printf 'MISSING\\n'; fi; done; `
    + `printf '${RECONCILE_PROBE_SENTINEL}\\n'`;
  const payload = Buffer.from(paths.map((path) => `${path}\0`).join(''), 'utf8').toString('base64');

  assertAllowedProgram(['ssh']);
  let result;
  try {
    result = childProcess.spawnSync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', command],
      {
        encoding: 'utf8',
        input: payload,
        timeout: options.timeoutMs ?? PROBE_TIMEOUT_MS,
        windowsHide: true,
      }
    );
  } catch (cause) {
    return fail(`探针启动失败: ${cause.message}`);
  }

  const exitCode = result.status ?? -1;
  if (exitCode !== 0) {
    const detail = String(result.stderr ?? '').trim().slice(-300);
    return fail(`探针退出码异常 exit=${exitCode}${detail ? `; ${detail}` : ''}`, exitCode);
  }

  const lines = String(result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const end = lines.indexOf(RECONCILE_PROBE_SENTINEL);
  if (end === -1) return fail('探针输出缺少哨兵', exitCode);

  const signals = lines.slice(0, end);
  if (signals.length !== paths.length + 1) return fail('探针输出行数与期望产物不一致', exitCode);
  const markerLine = signals[0];
  if (markerLine !== 'RUNNING' && markerLine !== 'NOT_RUNNING') {
    return fail(`探针标记信号非法: ${markerLine}`, exitCode);
  }
  if (!signals.slice(1).every((line) => line === 'PRESENT' || line === 'MISSING')) {
    return fail('探针产物信号非法', exitCode);
  }

  return {
    state: 'ok',
    reason: null,
    runningMarkers: markerLine === 'RUNNING' ? [`${safeTaskId}.json`] : [],
    expectedOutputs: paths.map((path, index) => ({
      path,
      exists: signals[index + 1] === 'PRESENT',
    })),
    probeExitCode: exitCode,
  };
}

/** 单引号转义成 '\''，与 task.js 远端命令的同名口径一致 */
function shellQuote(text) {
  return `'${String(text).replace(/'/g, String.raw`'\''`)}'`;
}
