/**
 * 进程执行接缝：本地子进程的唯一出口
 *
 * 存在这一层是为了让测试可以换掉真实执行；也为"本地零算力"红线
 * 提供一个天然的审计点（本地只允许 ssh / scp / adb）。
 */

// 必须走默认导入 + 属性调用：具名导入在链接期就固化了绑定，
// 测试用 mock.method(childProcess, 'spawn'|'spawnSync'|'execFile') 拦不住（2026-10-21 实测：
// P4 切片因此真跑了 scp/ssh，往 K40 raw_data 写了两个探针文件）。
import childProcess from 'node:child_process';
import { existsSync } from 'node:fs';
import { COMPUTE_SCP_TARGET, COMPUTE_SSH_PORT } from './domain.js';

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
 * 计算面适配器：默认 ssh。未知值 fail-closed，mock 只允许在测试环境
 * 或显式 BIO_ALLOW_MOCK_COMPUTE=1 时生效，防止生产进程静默走假算力。
 */
function resolveComputeAdapter() {
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'ssh';
  if (adapter !== 'ssh' && adapter !== 'mock') {
    throw new Error(`BIO_COMPUTE_ADAPTER 仅接受 ssh / mock，当前为 ${adapter}`);
  }
  if (adapter === 'mock'
    && process.env.NODE_TEST_CONTEXT === undefined
    && process.env.BIO_ALLOW_MOCK_COMPUTE !== '1') {
    throw new Error('mock 计算面仅在测试环境或 BIO_ALLOW_MOCK_COMPUTE=1 时允许');
  }
  return adapter;
}

/**
 * mock 覆盖远端传输类程序 ssh 与 scp：两者都是"把活儿交给 K40"的动作，
 * 假算力面必须同时罩住，否则 report.js 的 scp 拉包在 mock 下仍会真连远端。
 * adb 是本地链路工具，不归计算面适配器管。
 */
function resolveMockRemote(program) {
  return resolveComputeAdapter() === 'mock'
    && ['ssh', 'scp'].includes(programBaseName(program));
}

/** ssh 的固定参数段：调用点不再各自拼 '-o BatchMode=yes -o ConnectTimeout=10'。 */
export function sshArgv(target, command) {
  return ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, command];
}

/** scp 直连 adb forward 端口的固定参数段；目标与端口来自 domain.js 拓扑真源（5.9）。 */
export function scpArgv(localPath, remotePath) {
  return ['scp', '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes',
    '-P', String(COMPUTE_SSH_PORT), localPath, `${COMPUTE_SCP_TARGET}:${remotePath}`];
}

function mockRemoteResult() {
  return {
    code: Number(process.env.BIO_COMPUTE_MOCK_EXIT_CODE ?? '0'),
    stdout: process.env.BIO_COMPUTE_MOCK_STDOUT ?? '',
    stderr: process.env.BIO_COMPUTE_MOCK_STDERR ?? '',
    error: null,
  };
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
 *
 * error 字段是启动失败的原文（如 ssh 不存在时的 ENOENT）。任务层要把它当探活原因回传，
 * 只回 -1 会让"进程起不来"和"远端退出码 -1"在台账里长成同一个样子。
 * input 透传给子进程 stdin：reconcile 的探针把产物路径清单 base64 后走 stdin，
 * 不进 ssh argv（路径增多时 argv 会被截断，见 reconcile.js 头部注释）。
 * @param {string[]} argv
 * @param {{cwd?: string, timeoutMs?: number, input?: string}} [options]
 * @returns {{code: number, stdout: string, stderr: string, error: string|null}}
 */
export function runSync(argv, options = {}) {
  assertAllowedProgram(argv);
  if (resolveMockRemote(argv[0] || '')) {
    return mockRemoteResult();
  }
  const result = childProcess.spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    windowsHide: true,
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

/**
 * ssh 远端执行（宽松版）：合并 stdout/stderr，滤掉 ssh 客户端噪声，返回退出码 + 文本。
 *
 * 为什么单独成函数：远端输出解析散落在十几个 handler 里，噪声过滤口径必须只有一份
 * （踩坑台账 P-04 / P-10：known_hosts 提示会顶掉首行，导致哈希/探针解析失效）。
 * @param {string} target ssh 目标（如 k40-ubuntu）
 * @param {string} command 远端命令
 * @param {{timeoutMs?: number}} [options]
 * @returns {{code: number, text: string}}
 */
export function runSshRaw(target, command, options = {}) {
  const result = runSync(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, command],
    { timeoutMs: options.timeoutMs ?? 40000 }
  );
  const text = (result.stdout + '\n' + result.stderr)
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('Warning: Permanently added'))
    .join('\n')
    .trim();
  return { code: result.code, text };
}

/**
 * ssh 远端执行（严格版）：退出码非 0 或输出为空一律抛错，供门禁类调用点使用。
 *
 * 存在的理由（踩坑台账 P-15）：宽松版丢弃退出码，链路断时 ssh 返回 255 且 stdout
 * 为空，五维自检第 1 维会把空串判成"原生 ext4"、第 2 维把空串算成 100% free，
 * 于是自检假绿灯。自检是提交门禁，假绿灯比红灯危险。
 */
export function runSshStrict(target, command, options = {}) {
  const { code, text } = runSshRaw(target, command, options);
  if (code !== 0) throw new Error(`远端命令退出码 ${code}`);
  if (!text) throw new Error('远端命令无输出');
  return text;
}

/**
 * execFile 版远端执行（一次性收集 + 超时兜底），同样过白名单与 mock 短路。
 *
 * 存在的理由（5.1）：run.js 原来直接 childProcess.execFile('ssh', ...) 发 detached
 * 状态探针与停任务命令，主路径不在 BIO_COMPUTE_ADAPTER=mock 罩护范围内。
 * mock 分支必须在这里也生效，「唯一出口」才成立。
 */
export function runExecFile(argv, options = {}) {
  assertAllowedProgram(argv);
  if (resolveMockRemote(argv[0] || '')) {
    const result = mockRemoteResult();
    const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
    queueMicrotask(() => options.callback?.(result.code === 0 ? null : new Error(`mock exit ${result.code}`), result.stdout, result.stderr));
    return text;
  }
  childProcess.execFile(argv[0], argv.slice(1), {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024,
    windowsHide: true,
  }, options.callback ?? (() => {}));
}

/**
 * 流式执行（可写 stdin）：任务下发主路径专用。
 *
 * 与 runStream 的分工：runStream 不暴露 stdin（report.js 拉包用），runExecStream 给
 * 台账 base64 payload 与 detached 包装器 stdin（5.1：run.js 两处直连 spawn 收口到这里）。
 * mock 短路：不起进程，按 BIO_COMPUTE_MOCK_* 回放回调；kill 为 no-op。
 */
export function runExecStream(argv, handlers = {}) {
  assertAllowedProgram(argv);
  if (resolveMockRemote(argv[0] || '')) {
    const result = mockRemoteResult();
    queueMicrotask(() => {
      handlers.onStdout?.(result.stdout);
      handlers.onStderr?.(result.stderr);
      handlers.onExit?.(result.code);
    });
    return { kill: () => {}, stdin: { write() {}, end() {}, on() {} } };
  }
  const child = childProcess.spawn(argv[0], argv.slice(1), {
    cwd: handlers.cwd,
    windowsHide: true,
  });
  child.stdout?.on?.('data', (chunk) => handlers.onStdout?.(chunk.toString()));
  child.stderr?.on?.('data', (chunk) => handlers.onStderr?.(chunk.toString()));
  child.on?.('exit', (code) => handlers.onExit?.(code));
  child.on?.('error', (error) => handlers.onError?.(error));
  // ssh 早退（连接失败）时 stdin 写入会 EPIPE：exit 回调负责按退出码收敛，
  // 这里只兜住 error 事件本身，不让它变成 unhandled 'error' 打死进程
  child.stdin?.on?.('error', () => {});
  return { kill: () => child.kill(), stdin: child.stdin };
}

/**
 * 流式执行：stdout/stderr 逐块回调，用于任务下发时的实时日志。
 * onError 只在真实子进程路径挂：mock 短路没有进程，也就没有启动失败可报。
 * report.js 的门禁靠它把"ssh/scp 起不来"和"远端退出码非 0"分开处理。
 * @param {string[]} argv
 * @param {{cwd?: string, onStdout?: Function, onStderr?: Function, onExit?: Function, onError?: Function}} handlers
 * @returns {{kill: Function}} 可用于中止任务
 */
export function runStream(argv, handlers = {}) {
  assertAllowedProgram(argv);
  if (resolveMockRemote(argv[0] || '')) {
    const result = mockRemoteResult();
    queueMicrotask(() => {
      handlers.onStdout?.(result.stdout);
      handlers.onStderr?.(result.stderr);
      handlers.onExit?.(result.code);
    });
    return { kill: () => {} };
  }
  const child = childProcess.spawn(argv[0], argv.slice(1), {
    cwd: handlers.cwd,
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => handlers.onStdout?.(chunk.toString()));
  child.stderr.on('data', (chunk) => handlers.onStderr?.(chunk.toString()));
  child.on('exit', (code) => handlers.onExit?.(code));
  child.on('error', (error) => handlers.onError?.(error));
  return { kill: () => child.kill() };
}
