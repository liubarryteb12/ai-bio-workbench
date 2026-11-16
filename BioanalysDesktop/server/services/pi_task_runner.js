/**
 * Pi 任务执行器（D4.9 后两步）。
 *
 * 把适配脚本推到算力面，按 adapted task 契约编译并执行，
 * 解析 WROTE 回执，返回调度器需要的 { exitCode, wroteCount, wroteBytes }。
 *
 * 依赖全部注入：prepareTaskFn（run.js prepareAndAuditTask）、
 * runTaskFn（run.js runTask）、pushScriptFn（ADB/scp 上传）。
 */
import path from 'node:path';

export const PI_TASK_MEMORY_GB = 6.5;
export const PI_VALIDATION_MEMORY_GB = 3.5;
export const PI_VALIDATION_TIMEOUT_SEC = 180;

export function summarizeWroteReceipts(text) {
  const lines = String(text || '').split(/\r?\n/);
  let count = 0;
  let bytes = 0;
  for (const line of lines) {
    const match = /^WROTE\s+(?:'[^']*'|\S+)\s+(\d+)\s*$/.exec(line.trim());
    if (!match) continue;
    count += 1;
    bytes += Number(match[1]);
  }
  return { count, bytes };
}

function languageOf(entryPoint) {
  return /\.R$/.test(entryPoint) ? 'r' : 'python';
}

function stepName(modId, entryPoint) {
  const base = String(entryPoint).replace(/\.(R|py)$/, '').replace(/[^A-Za-z0-9._-]/g, '_');
  return `${String(modId).replace(/[^A-Za-z0-9._-]/g, '_')}__${base}`.slice(0, 80);
}

export function createPiTaskRunner({ prepareTaskFn, runTaskFn, pushScriptFn, now = () => Date.now() } = {}) {
  if (!prepareTaskFn || !runTaskFn || !pushScriptFn) {
    throw new Error('任务执行器缺少必填依赖：prepareTaskFn / runTaskFn / pushScriptFn');
  }

  function runAndWait(taskSpec, { timeoutSec = 900, memoryGb = PI_TASK_MEMORY_GB, onStdout = () => {} } = {}) {
    const wrapperTaskId = `pi_task_${now()}_${Math.random().toString(36).slice(2, 10)}`;
    const prepared = prepareTaskFn(taskSpec, { wrapperTaskId });
    if (!prepared?.audit?.allowed) {
      const err = new Error(`任务审计拒绝: ${prepared?.audit?.reason || 'unknown'}`);
      err.code = 'ERR_TASK_AUDIT_DENIED';
      throw err;
    }
    const memoryPrefix = `BIO_TASK_MEM_LIMIT_GB=${memoryGb}${memoryGb === PI_VALIDATION_MEMORY_GB ? ' BIO_VALIDATION_MODE=1' : ''} `;
    const preparedScript = `${memoryPrefix}${prepared.script}`;
    return new Promise((resolve, reject) => {
      let stdout = '';
      let settled = false;
      const startedAt = now();
      let handle = null;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { handle?.kill?.(); } catch { /* 已退出 */ }
        reject(Object.assign(new Error(`任务超时 ${timeoutSec}s`), { code: 'ERR_TASK_TIMEOUT' }));
      }, Math.max(1, timeoutSec) * 1000);
      try {
        handle = runTaskFn({
          ...taskSpec,
          preparedScript,
          preparedWrapperTaskId: wrapperTaskId,
        }, {
          onStdout: (text) => { stdout += String(text || ''); onStdout(text); },
          onStderr: (text) => { stdout += String(text || ''); },
          onExit: (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const wrote = summarizeWroteReceipts(stdout);
            resolve({
              exitCode: Number(code),
              wroteCount: wrote.count,
              wroteBytes: wrote.bytes,
              durationSec: (now() - startedAt) / 1000,
              peakMemoryGb: 0,
              stdoutTail: stdout.slice(-2000),
            });
          },
        });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function runValidationTask({
    projectId, lineId, modId, entryPoint, localScriptPath, memoryGb = PI_VALIDATION_MEMORY_GB,
    timeoutSec = PI_VALIDATION_TIMEOUT_SEC, seed = 20261013,
  }) {
    const pushed = await pushScriptFn({ projectId, lineId, modId, entryPoint, localScriptPath });
    const taskSpec = {
      projectId,
      lineId,
      step: stepName(modId, entryPoint),
      seed: Number(seed) || 20261013,
      inputs: [],
      outputs: [],
      adapted: true,
      directOutputs: true,
      allowEmptyOutputs: true,
      scriptPath: pushed.remotePath,
      language: languageOf(entryPoint),
    };
    const result = await runAndWait(taskSpec, { timeoutSec, memoryGb });
    return { ...result, remotePath: pushed.remotePath, memoryGb };
  }

  async function runDispatchTask({
    projectId, lineId, modId, entryPoint, localScriptPath, memoryGb = PI_TASK_MEMORY_GB,
    timeoutSec = 900, seed = 20261013,
  }) {
    const pushed = await pushScriptFn({ projectId, lineId, modId, entryPoint, localScriptPath });
    const taskSpec = {
      projectId,
      lineId,
      step: stepName(modId, entryPoint),
      seed: Number(seed) || 20261013,
      inputs: [],
      outputs: [],
      adapted: true,
      directOutputs: true,
      allowEmptyOutputs: true,
      scriptPath: pushed.remotePath,
      language: languageOf(entryPoint),
    };
    const result = await runAndWait(taskSpec, { timeoutSec, memoryGb });
    return { ...result, remotePath: pushed.remotePath, memoryGb };
  }

  return { runValidationTask, runDispatchTask, runAndWait };
}
