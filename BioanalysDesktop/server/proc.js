/**
 * 进程执行接缝：本地子进程的唯一出口
 *
 * 存在这一层是为了让测试可以换掉真实执行；也为"本地零算力"红线
 * 提供一个天然的审计点（本地只允许 ssh / scp / adb）。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** 本地允许执行的程序白名单：除此之外一律拒绝 */
export const ALLOWED_LOCAL_PROGRAMS = ['ssh', 'scp', 'adb'];

/** adb 的候选位置，与 ops/00_link_check.ps1 保持一致 */
const ADB_CANDIDATES = [
  'C:/adb/platform-tools/adb.exe',
];

/**
 * 定位 adb 可执行：约定路径优先，其次 Android SDK，最后退回 PATH。
 * 用 existsSync 而不是 which，因为 Windows 下 PATH 里的 adb 可能被别的工具遮蔽。
 */
export function findAdb() {
  const fromEnv = [
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`,
    process.env.USERPROFILE && `${process.env.USERPROFILE}/AppData/Local/Android/Sdk/platform-tools/adb.exe`,
  ].filter(Boolean);
  for (const candidate of [...ADB_CANDIDATES, ...fromEnv]) {
    if (existsSync(candidate)) return candidate;
  }
  return 'adb';
}

/**
 * 取程序名做白名单比对。
 * 入参可能是 `adb`、`adb.exe`、`C:/adb/platform-tools/adb.exe` 或反斜杠形式，
 * 统一取最后一段并去掉扩展名，避免把合法工具误判成越界。
 */
function programBaseName(program) {
  const unified = String(program).replace(/\\/g, '/');
  const lastSegment = unified.split('/').pop() || '';
  return lastSegment.toLowerCase().replace(/\.exe$/, '');
}

/**
 * 断言命令只使用白名单程序。
 * @param {string[]} argv 形如 ['ssh', '-o', '...']
 * @throws {Error} 非白名单程序
 */
export function assertAllowedProgram(argv) {
  const base = programBaseName(argv[0] || '');
  if (!ALLOWED_LOCAL_PROGRAMS.includes(base)) {
    throw new Error(
      `本地禁止执行 ${argv[0]}：本地零算力，只允许 ${ALLOWED_LOCAL_PROGRAMS.join(' / ')}`
    );
  }
}

/**
 * 同步执行并收集全部输出。
 * @param {string[]} argv
 * @param {{cwd?: string, timeoutMs?: number}} [options]
 * @returns {{code: number, stdout: string, stderr: string}}
 */
export function runSync(argv, options = {}) {
  assertAllowedProgram(argv);
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    windowsHide: true,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * 流式执行：stdout/stderr 逐块回调，用于任务下发时的实时日志。
 * @param {string[]} argv
 * @param {{cwd?: string, onStdout?: Function, onStderr?: Function, onExit?: Function}} handlers
 * @returns {{kill: Function}} 可用于中止任务
 */
export function runStream(argv, handlers = {}) {
  assertAllowedProgram(argv);
  const child = spawn(argv[0], argv.slice(1), {
    cwd: handlers.cwd,
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => handlers.onStdout?.(chunk.toString()));
  child.stderr.on('data', (chunk) => handlers.onStderr?.(chunk.toString()));
  child.on('exit', (code) => handlers.onExit?.(code));
  return { kill: () => child.kill() };
}
