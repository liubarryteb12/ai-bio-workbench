/**
 * 进程执行接缝：本地子进程的唯一出口
 *
 * 存在这一层是为了让测试可以换掉真实执行；也为"本地零算力"红线
 * 提供一个天然的审计点。分析程序白名单仍然只有 ssh / scp / adb；
 * ADB 通道需要 pwsh 作为通道执行器，但它只经 adbRaw 独立入口启动，
 * 不进入 ALLOWED_LOCAL_PROGRAMS，也不允许用来执行分析代码。
 */

// 必须走默认导入 + 属性调用：具名导入在链接期就固化了绑定，
// 测试用 mock.method(childProcess, 'spawn'|'spawnSync'|'execFile') 拦不住（2026-10-21 实测：
// P4 切片因此真跑了 scp/ssh，往 K40 raw_data 写了两个探针文件）。
import childProcess from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPUTE_SCP_TARGET, COMPUTE_SSH_PORT } from './domain.js';

/**
 * 仓库根：adbRaw 的辅助脚本与 CWD 都以它为锚，避免依赖进程启动目录。
 * BioanalysDesktop/server/proc.js 上两级即仓库根。
 */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** ADB 通道辅助脚本（相对仓库根固定），pwsh 只作为该通道的执行器出现 */
export const ADB_EXEC_SCRIPT = path.join(REPO_ROOT, 'tools', 'ops', 'adb_exec.ps1');

/** 过长命令改走临时 .sh，绝不把多行内容塞进 Windows 命令行参数 */
const ADB_INLINE_COMMAND_LIMIT = 8000;

/** 本地允许执行的程序白名单：除此之外一律拒绝。pwsh 不在此列。 */
export const ALLOWED_LOCAL_PROGRAMS = ['ssh', 'scp', 'adb'];

/**
 * 进程组连根强杀（4 Argon 第 74 轮 Q2 终审裁定）。
 * 单纯调用 child.kill() 只能杀掉顶层包装器，派生的子进程会沦为孤儿进程继续消耗系统资源。
 * 在 Windows 平台调用 taskkill /F /T /PID 强杀整棵进程树；
 * 在 POSIX 平台对负 PGID (-child.pid) 发送 SIGKILL。
 *
 * @param {import('node:child_process').ChildProcess} child
 */
export function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      childProcess.spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  }
}

/** adb 的候选位置，与 tools/ops/00_link_check.ps1 保持一致 */
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
 * 子进程环境保底：Windows 原生 ssh.exe 在缺少 SystemRoot 时，连参数都不解析就
 * 静默 exit 255（WSAStartup 找不到 %SystemRoot%/System32/mswsock.dll 与
 * Winsock 传输提供程序）。2026-11-02 实测：调用方传精简 env 后 ssh -V 亦 255，
 * 而同一个二进制在完整环境下正常。把保底放在单接缝出口，调用方怎么传都不会踩雷。
 * @param {Record<string,string>|undefined} overrides 调用点自定义的增量变量
 * @returns {Record<string,string|undefined>} 合并后的环境
 */
export function childEnv(overrides = {}) {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return {
    ...process.env,
    SystemRoot: systemRoot,
    windir: process.env.windir || systemRoot,
    ...overrides,
  };
}

/**
 * 计算面适配器：固定 adb；SSH 通道已封存（见 _archive/ssh_retired_20261111/）；
 * mock 只允许在测试环境或显式 BIO_ALLOW_MOCK_COMPUTE=1 时生效，防止生产进程
 * 静默走假算力。未知值仍由 resolveComputeAdapter 在执行时 fail-closed。
 */

/**
 * 当前计算面模式：'adb' 单通道 / 'mock' 离线演示。
 * 只读、不抛错：调用方（自检路由、前端横幅）要的是「现在是什么模式」，
 * 而不是「配置是否合法」——非法配置由 resolveComputeAdapter 在真正执行时 fail-closed。
 */
export function computeMode() {
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'adb';
  if (adapter === 'mock') return adapter;
  if (adapter === 'ssh') {
    throw new Error('SSH 通道已封存，见 _archive/ssh_retired_20261111/RESTORE.md');
  }
  if (adapter !== 'adb') return 'adb';
  return 'adb';
}

/**
 * 解析并校验计算面适配器。未知值 fail-closed，不静默回落任何通道。
 * @returns {'adb'|'mock'}
 */
export function resolveComputeAdapter() {
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'adb';
  if (adapter === 'ssh') {
    throw new Error('SSH 通道已封存，见 _archive/ssh_retired_20261111/RESTORE.md');
  }
  if (adapter !== 'adb' && adapter !== 'mock') {
    throw new Error(`BIO_COMPUTE_ADAPTER 仅接受 adb / mock，当前为 ${adapter}`);
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
 * adb 的远端执行走 adbRaw，mock 短路在那一层单独处理。
 */
function resolveMockRemote(program) {
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'adb';
  return adapter === 'mock'
    && ['ssh', 'scp'].includes(programBaseName(program));
}

/**
 * 把任意字符串包成一个 POSIX shell 单引号词。
 *
 * 存在的理由（T0-4）：远端命令普遍写成 `if [ -d '${x}' ]`，而 x 一旦来自 URL 参数，
 * 里面的单个 ' 就能闭合引号、用 ; 接上任意命令。单引号段里除 ' 之外没有元字符，
 * 所以把 ' 换成 '\'' 之后就再也无法逃逸。
 *
 * @param {unknown} text 任意值，会被 String() 后转义
 * @returns {string} 形如 'abc' 或 'a'\''b'
 */
export function shellQuote(text) {
  return `'${String(text).replace(/'/g, String.raw`'\''`)}'`;
}

/** ssh 的固定参数段：调用点不再各自拼 '-o BatchMode=yes -o ConnectTimeout=10'。 */
export function sshArgv(target, command) {
  return ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, command];
}

/** scp 直连 adb forward 端口的固定参数段；目标与端口来自 domain.js 拓扑真源（5.9）。 */
export function scpArgv(localPath, remotePath) {
  // accept-new 而非 no：首次连接仍可无人工确认（自动化要求），但主机密钥一旦变更即拒绝，
  // 不再静默接受新身份。已知主机密钥由 hostkey.js 的指纹台账单独核对。
  return ['scp', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
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

function uniqueRemoteScript(prefix) {
  return `/tmp/${prefix}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sh`;
}

function commandFromSshArgv(argv) {
  const marker = argv.findIndex((item) => /k40-ubuntu|k40/.test(String(item)));
  return marker >= 0 ? String(argv[marker + 1] || '') : '';
}

function scpDirection(argv) {
  const values = [];
  for (let index = 1; index < argv.length; index += 1) {
    const item = String(argv[index]);
    if (item === '-o' || item === '-P') { index += 1; continue; }
    if (item.startsWith('-')) continue;
    values.push(item);
  }
  const remoteIndex = values.findIndex((item) => /^[^/\\]+@[^:]+:|^[^:]+:\//.test(String(item)));
  if (remoteIndex < 0) return null;
  const rawRemote = String(values[remoteIndex]);
  const colonAt = rawRemote.indexOf(':');
  const remote = rawRemote.slice(colonAt + 1).replace(/\\/g, '/');
  const local = values.find((item, index) => index !== remoteIndex);
  return remoteIndex === 0
    ? { direction: 'pull', remote, local }
    : { direction: 'push', remote, local };
}

function adbRunner(args, options = {}) {
  const result = childProcess.spawnSync('pwsh', [
    '-NoProfile', '-File', ADB_EXEC_SCRIPT,
    '-Level', 'ubuntu', '-Transport', 'adb', '-RequireAdb',
    '-RemoteScriptPath', uniqueRemoteScript('dsh_adb_bridge'),
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: process.env.BIO_TEST_ADB_TIMEOUT_MS
      ? Number(process.env.BIO_TEST_ADB_TIMEOUT_MS)
      : (options.timeoutMs ?? 900000),
    windowsHide: true,
    env: childEnv(options.env),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function rewriteRemoteArgv(argv, options = {}) {
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'adb';
  if (adapter !== 'adb') return null;
  const base = programBaseName(argv[0] || '');
  if (base === 'ssh') {
    const command = commandFromSshArgv(argv);
    if (!command) return null;
    return () => adbRunner(['-Command', command], options);
  }
  if (base === 'scp') {
    const spec = scpDirection(argv);
    if (!spec) return null;
    if (spec.direction === 'push') {
      const pushed = adbRunner([
        '-PushLocalPath', spec.local,
        '-PushRemotePath', spec.remote,
      ], options);
      return () => pushed;
    }
    const raw = adbRunner([
      '-Command', `sha256sum ${shellQuote(spec.remote)} | cut -d' ' -f1; printf '\\n__B64__\\n'; base64 -w0 ${shellQuote(spec.remote)}`,
    ], options);
    return () => {
      const marker = raw.stdout.lastIndexOf('__B64__');
      const hash = (raw.stdout.match(/[0-9a-f]{64}/) || [])[0] || '';
      const encoded = marker >= 0 ? raw.stdout.slice(marker + '__B64__'.length).replace(/\s+/g, '') : '';
      if (raw.code !== 0 || !hash || !encoded) return { ...raw, code: 1 };
      const buffer = Buffer.from(encoded, 'base64');
      mkdirSync(path.dirname(path.resolve(spec.local)), { recursive: true });
      writeFileSync(spec.local, buffer);
      return { ...raw, stdout: hash };
    };
  }
  return null;
}

/**
 * 流式执行接缝的 ADB 重写。
 *
 * rewriteRemoteArgv 走 spawnSync，只能用于短探针；任务下发与报告构建需要
 * 持续读取 stdout/stderr，因此单独给一条 spawn 形态的 ADB argv。
 * 旧实现漏了这一层，BIO_COMPUTE_ADAPTER=adb 时任务仍直连 ssh，违反
 * 「ADB 主通道、SSH 仅显式特殊开关」的硬规则。
 */
function rewriteRemoteArgvForStream(argv) {
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'adb';
  if (adapter !== 'adb') return null;
  if (process.env.BIO_TEST_PRESERVE_STREAM_ARGV === '1') return null;
  const base = programBaseName(argv[0] || '');
  if (base !== 'ssh') return null;
  const command = commandFromSshArgv(argv);
  if (!command) throw new Error('adb 主通道下 ssh argv 缺少远端命令，拒绝直连 ssh');
  return [
    'pwsh', '-NoProfile', '-File', ADB_EXEC_SCRIPT,
    '-Level', 'ubuntu', '-Transport', 'adb', '-RequireAdb',
    '-RemoteScriptPath', uniqueRemoteScript('dsh_adb_stream'),
    '-Command', command,
  ];
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
  resolveComputeAdapter();
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'adb';
  if (resolveMockRemote(argv[0] || '')) {
    return mockRemoteResult();
  }
  if (process.env.BIO_TEST_PRESERVE_SYNC_ARGV === '1') {
    const preserved = childProcess.spawnSync(argv[0], argv.slice(1), {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 30000,
      windowsHide: true,
      env: childEnv(options.env),
      ...(options.input === undefined ? {} : { input: options.input }),
    });
    return {
      code: preserved.status ?? -1,
      stdout: preserved.stdout ?? '',
      stderr: preserved.stderr ?? '',
      error: preserved.error ? String(preserved.error.message || preserved.error) : null,
    };
  }
  // P-29：ssh/scp argv 是历史调用形态，统一在接缝层改写成 ADB 单通道。
  // 直连会喂出算力端 15 秒 abort 环；这里不启动任何 ssh/scp 子进程。
  const rewrite = rewriteRemoteArgv(argv, options);
  if (rewrite) {
    const result = rewrite();
    return {
      code: result.code,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error ?? null,
    };
  }
  const result = childProcess.spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    windowsHide: true,
    env: childEnv(options.env),
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
 * 异步执行并收集全部输出：不阻塞事件循环的那一半接缝。
 *
 * 存在的理由（T1.5）：`runSync` 用 `spawnSync`，子进程存活期间主线程一个 tick 都不走。
 * 两次 `scp` 的 timeoutMs 都写死 900000（15 分钟），真链路打不回握手时整个后端
 * 会停摆最长 15 分钟：`/api/health`、SSE 日志流、其它上传全部排在它后面。
 * 语义与 `runSync` 逐项对齐（白名单、mock 短路、childEnv 保底、错误原文），
 * 唯一区别是内部换成 `spawn` 并返回 Promise。
 *
 * 与 `runStream` / `runExecStream` 的分工：那两个只为实时日志与 stdin 设计，
 * 退出码走回调、不收集输出；上传链路要的是「一次拿到 code/stdout/stderr」，
 * 所以这里按 `runSync` 的返回形态给，调用点只改 `await` 与函数名。
 *
 * 参数取值必须与 `runSync` 同口径（默认 30000），否则超时行为会在两条路径上分叉。
 * @param {string[]} argv 形如 ['scp', '-o', '...']
 * @param {{cwd?: string, timeoutMs?: number, maxBuffer?: number, env?: Record<string,string>}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string, error: string|null}>}
 */
export function runAsync(argv, options = {}) {
  assertAllowedProgram(argv);
  resolveComputeAdapter();
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'adb';
  if (resolveMockRemote(argv[0] || '')) {
    return Promise.resolve(mockRemoteResult());
  }
  if (process.env.BIO_TEST_PRESERVE_SYNC_ARGV === '1') {
    return Promise.resolve(runSync(argv, options));
  }
  // P-29：与 runSync 同一口径，异步上传/部署链路也不得直连 ssh/scp。
  // adbRunner 本身是 spawnSync，放进微任务里避免把当前请求回调同步按住。
  const rewrite = rewriteRemoteArgv(argv, options);
  if (rewrite) {
    return Promise.resolve().then(() => {
      const result = rewrite();
      return {
        code: result.code,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        error: result.error ?? null,
      };
    });
  }
  const timeoutMs = options.timeoutMs ?? 30000;
  return new Promise((resolve) => {
    let pending = null;
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (pending) clearTimeout(pending);
      resolve(result);
    };
    const child = childProcess.spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      windowsHide: true,
      env: childEnv(options.env),
    });
    pending = setTimeout(() => {
      // 超时口径对齐 spawnSync：kill(SIGTERM) 之后 code 记 -1 并在 error 里留原文，
      // 让台账能区分「超时被杀」与「远端退出码非 0」。
      try { killProcessTree(child); } catch { /* 已经退出则忽略 */ }
      finish({ code: -1, stdout, stderr, error: `超时 ${timeoutMs}ms 未结束，已中止子进程（${programBaseName(argv[0] || '')}）` });
    }, timeoutMs);
    // 与 runExecFile 的 maxBuffer 同口径：超出后停止累积，不把主进程拖成 OOM。
    // 上传链路只解析 stat 的一行数字，正常人远不到上限；命中即视为输出不可信。
    const maxBuffer = options.maxBuffer ?? 2 * 1024 * 1024;
    let overflow = false;
    const append = (target, chunk) => {
      const text = chunk.toString();
      if (target === 'stdout') stdout += text; else stderr += text;
      if (stdout.length + stderr.length > maxBuffer) {
        overflow = true;
        try { killProcessTree(child); } catch { /* 已退出则忽略 */ }
        finish({ code: -1, stdout, stderr, error: `输出超过 ${maxBuffer} 字节，已中止子进程` });
      }
    };
    child.stdout?.on?.('data', (chunk) => append('stdout', chunk));
    child.stderr?.on?.('data', (chunk) => append('stderr', chunk));
    // 启动失败（如 ssh 不存在）走 error 事件：把原文留在 error 字段，与 runSync 同形。
    child.on?.('error', (error) => finish({ code: -1, stdout, stderr, error: String(error.message || error) }));
    child.on?.('close', (code) => {
      if (overflow) return;
      finish({ code: code ?? -1, stdout, stderr, error: null });
    });
  });
}

/**
 * ssh 远端执行（宽松版）的异步出口：合并输出、滤噪口径与 `runSshRaw` 逐字相同。
 *
 * 只多一个 `await`。新增而不是改写 `runSshRaw`，是因为后者有十几个同步调用点
 * （diagnostics、query_views 等），一次性全改会把这轮改造的
 * 半径撑到整个后端；上传链路的字节校验单独走这条异步口即可。
 * @param {string} target ssh 目标（如 k40-ubuntu）
 * @param {string} command 远端命令
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{code: number, text: string}>}
 */
export async function runSshAsync(target, command, options = {}) {
  // 函数名保留兼容既有调用点；内部固定走 ADB，不再产生 SSH 连接流。
  const result = await runAsync(
    sshArgv(target, command),
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
 * 把 ADB 子进程结果收敛成与 runSshRaw 相同的 {code, text}。
 * 保留 stdout、stderr 与启动失败原文，不做 known_hosts 之类的内容过滤。
 */
function adbResultText({ stdout = '', stderr = '', error = null }) {
  return [stdout, stderr, error].filter(Boolean).join('\n').trim();
}

/**
 * ADB 远端执行（宽松版）：经 tools/ops/adb_exec.ps1 在 ubuntu 容器内执行。
 *
 * 通道固定为 `-Transport adb -RequireAdb`：adb 不可用即报错，不回落 ssh。
 * pwsh 只作为通道执行器，因此这里直接走独立 spawnSync，不经过
 * assertAllowedProgram，也不把 pwsh 加进分析程序白名单。
 *
 * 引号策略：短命令用 `-Command`，由 spawnSync 的 argv 数组原样传给 PowerShell，
 * 不经过本地 shell；多行或超长命令先落 .tmp 下的临时 .sh，再用 `-ScriptPath`
 * 传入，绝不把多行内容塞进 Windows 命令行参数。
 *
 * mock 模式仍在进程接缝前短路，与 runSshRaw 口径一致。
 *
 * @param {string} command 远端 shell 命令
 * @param {{timeoutMs?: number, env?: Record<string,string>, level?: 'termux'|'ubuntu'}} [options]
 * @returns {{code: number, text: string}}
 */
export function adbRaw(command, options = {}) {
  const adapter = process.env.BIO_COMPUTE_ADAPTER || 'adb';
  if (adapter === 'mock') {
    const result = mockRemoteResult();
    return { code: result.code, text: adbResultText(result) };
  }
  const text = String(command ?? '');
  if (!text) throw new Error('adbRaw 需要非空远端命令');

  const args = [
    '-NoProfile', '-File', ADB_EXEC_SCRIPT,
    '-Level', options.level ?? 'ubuntu', '-Transport', 'adb', '-RequireAdb',
    '-RemoteScriptPath', `/tmp/dsh_adb_cmd_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sh`,
  ];
  let tempDir = null;
  try {
    if (text.includes('\n') || text.includes('\r') || text.length > ADB_INLINE_COMMAND_LIMIT) {
      mkdirSync(path.join(REPO_ROOT, '.tmp'), { recursive: true });
      tempDir = mkdtempSync(path.join(REPO_ROOT, '.tmp', 'adb-'));
      const scriptPath = path.join(tempDir, 'command.sh');
      writeFileSync(scriptPath, text, 'utf8');
      args.push('-ScriptPath', scriptPath);
    } else {
      args.push('-Command', text);
    }
    const result = childProcess.spawnSync('pwsh', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 40000,
      windowsHide: true,
      env: childEnv(options.env),
    });
    return {
      code: result.status ?? -1,
      text: adbResultText({
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        error: result.error ? String(result.error.message || result.error) : null,
      }),
    };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
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
  // 与 runExecStream 同一条 ADB 重写：detached 状态探针与停任务命令也走主通道，
  // 否则 ADB 模式下会退化成直连 SSH，SSH 不可用时把仍在远端运行的任务误判为失败。
  const effectiveArgv = rewriteRemoteArgvForStream(argv) || argv;
  childProcess.execFile(effectiveArgv[0], effectiveArgv.slice(1), {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024,
    windowsHide: true,
    env: childEnv(options.env),
  }, options.callback ?? (() => {}));
  return '';
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
  resolveComputeAdapter();
  if (resolveMockRemote(argv[0] || '')) {
    const result = mockRemoteResult();
    queueMicrotask(() => {
      handlers.onStdout?.(result.stdout);
      handlers.onStderr?.(result.stderr);
      handlers.onExit?.(result.code);
    });
    return { kill: () => {}, stdin: { write() {}, end() {}, on() {} } };
  }
  const effectiveArgv = rewriteRemoteArgvForStream(argv) || argv;
  const child = childProcess.spawn(effectiveArgv[0], effectiveArgv.slice(1), {
    cwd: handlers.cwd,
    windowsHide: true,
    env: childEnv(handlers.env),
  });
  child.stdout?.on?.('data', (chunk) => handlers.onStdout?.(chunk.toString()));
  child.stderr?.on?.('data', (chunk) => handlers.onStderr?.(chunk.toString()));
  child.on?.('exit', (code) => handlers.onExit?.(code));
  child.on?.('error', (error) => handlers.onError?.(error));
  // ssh 早退（连接失败）时 stdin 写入会 EPIPE：exit 回调负责按退出码收敛，
  // 这里只兜住 error 事件本身，不让它变成 unhandled 'error' 打死进程
  child.stdin?.on?.('error', () => {});
  return { kill: () => killProcessTree(child), stdin: child.stdin };
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
  const effectiveArgv = rewriteRemoteArgvForStream(argv) || argv;
  const child = childProcess.spawn(effectiveArgv[0], effectiveArgv.slice(1), {
    cwd: handlers.cwd,
    windowsHide: true,
    env: childEnv(handlers.env),
  });
  child.stdout.on('data', (chunk) => handlers.onStdout?.(chunk.toString()));
  child.stderr.on('data', (chunk) => handlers.onStderr?.(chunk.toString()));
  child.on('exit', (code) => handlers.onExit?.(code));
  child.on('error', (error) => handlers.onError?.(error));
  return { kill: () => killProcessTree(child) };
}
