/**
 * 后端守护：启动、健康检查、日志汇聚、优雅停机与进程树清理。
 *
 * 安全口径：
 * - 只监听 127.0.0.1，端口由主进程挑选的空闲端口决定；
 * - 每次启动生成随机 Basic 口令，经 Electron login 事件注入渲染层；
 * - 用户看不到控制台窗口，日志进入内存环与数据目录 logs/。
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { venvPython } from './portable-paths.js';

const MAX_LOG_LINES = 4000;
const HEALTH_TIMEOUT_MS = 30000;
const AUTO_RESTART_LIMIT = 3;
const AUTO_RESTART_WINDOW_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickFreePort(preferred = 18787) {
  const tryPort = (port) => new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(0));
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address()?.port || 0;
      server.close(() => resolve(actual));
    });
  });
  const preferredPort = await tryPort(preferred);
  if (preferredPort) return preferredPort;
  return tryPort(0);
}

export function createBackend({
  app, loadConfig, resolveDataDir, resolveRawDataDir, portableRoot,
  logsDir, devRepoRoot, onLog, onStatus,
}) {
  let child = null;
  let port = 0;
  let authUser = '';
  let authPass = '';
  let status = 'stopped';
  let lastError = '';
  let startedAt = 0;
  let intentionalStop = false;
  let restartTimes = [];
  let restartTimer = null;
  const ring = [];

  function pushLine(stream, text) {
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim()) continue;
      const entry = { at: new Date().toISOString(), stream, line };
      ring.push(entry);
      if (ring.length > MAX_LOG_LINES) ring.splice(0, ring.length - MAX_LOG_LINES);
      try {
        fs.appendFileSync(path.join(logsDir, `backend-${new Date().toISOString().slice(0, 10)}.log`), `[${entry.at}] [${stream}] ${line}\n`, 'utf8');
      } catch {}
      onLog?.(entry);
    }
  }

  function setStatus(next, error = '') {
    status = next;
    lastError = error;
    onStatus?.(getStatus());
  }

  function getStatus() {
    return {
      state: status,
      port,
      pid: child?.pid || null,
      startedAt: startedAt || null,
      lastError: lastError || '',
      uptimeMs: startedAt ? Date.now() - startedAt : 0,
    };
  }

  function getAuth() {
    return { user: authUser, pass: authPass, port };
  }

  function getRecentLogs() {
    return ring.slice();
  }

  function resolveRuntime() {
    const devMode = !app.isPackaged;
    if (devMode) {
      const repoRoot = path.resolve(devRepoRoot || path.resolve(process.cwd(), '..'));
      return {
        devMode,
        assetRoot: repoRoot,
        nodeExe: process.env.BIO_DEV_NODE || 'node',
        serverEntry: path.join(repoRoot, 'BioanalysDesktop', 'server', 'index.js'),
        runtimeRoot: repoRoot,
        useElectronAsNode: false,
      };
    }
    const runtimeRoot = path.join(process.resourcesPath, 'runtime');
    const bundledNode = path.join(runtimeRoot, 'node', 'node.exe');
    const serverEntry = path.join(runtimeRoot, 'BioanalysDesktop', 'server', 'index.js');
    const hasBundledNode = fs.existsSync(bundledNode);
    return {
      devMode,
      assetRoot: runtimeRoot,
      nodeExe: hasBundledNode ? bundledNode : process.execPath,
      serverEntry,
      runtimeRoot,
      useElectronAsNode: !hasBundledNode,
    };
  }

  function buildEnv(config, dataDir, runtime) {
    const rawDataDir = resolveRawDataDir ? resolveRawDataDir() : path.join(dataDir, 'raw_data');
    fs.mkdirSync(rawDataDir, { recursive: true });
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      BAD_PORT: String(port),
      BAD_AUTH_USER: authUser,
      BAD_AUTH_PASS: authPass,
      BIO_ASSET_ROOT: runtime.assetRoot,
      BIO_DATA_HOME: dataDir,
      BIO_UPLOAD_ROOT: rawDataDir,
      // 干净 Windows 没有 Python 时，Schema 网关走同口径 JS 回退，保持核心流程可用。
      BIO_ALLOW_SCHEMA_GATEWAY_FALLBACK: '1',
    };
    if (runtime.useElectronAsNode) env.ELECTRON_RUN_AS_NODE = '1';

    const compute = config.compute || {};
    if (compute.adapter) env.BIO_COMPUTE_ADAPTER = compute.adapter;
    if (compute.adapter === 'mock') env.BIO_ALLOW_MOCK_COMPUTE = '1';
    if (compute.serial) env.BIO_ADB_SERIAL = compute.serial;
    if (compute.remoteDataRoot) env.BIO_REMOTE_DATA_ROOT = compute.remoteDataRoot;
    if (compute.remoteHome) env.BIO_REMOTE_HOME = compute.remoteHome;
    if (compute.containerName) env.BIO_CONTAINER_NAME = compute.containerName;
    if (compute.memLimitGb) env.BIO_MEM_LIMIT_GB = String(compute.memLimitGb);

    const adbCandidates = [
      compute.adbPath,
      path.join(runtime.runtimeRoot, 'platform-tools', 'adb.exe'),
      path.join(dataDir, 'platform-tools', 'adb.exe'),
    ].filter(Boolean);
    const adb = adbCandidates.find((candidate) => fs.existsSync(candidate));
    if (adb) env.BIO_ADB_PATH = adb;

    const pythonCandidates = [
      portableRoot ? venvPython(portableRoot) : '',
      path.join(runtime.runtimeRoot, 'python', 'python.exe'),
      path.join(runtime.runtimeRoot, 'python', 'python'),
    ].filter(Boolean);
    const python = pythonCandidates.find((candidate) => fs.existsSync(candidate));
    if (python) env.BIO_PYTHON_PATH = python;

    const pathParts = [
      portableRoot ? path.join(portableRoot, 'venv', 'Scripts') : '',
      path.join(runtime.runtimeRoot, 'node'),
      path.join(runtime.runtimeRoot, 'python'),
      path.join(runtime.runtimeRoot, 'platform-tools'),
      env.PATH || '',
    ].filter(Boolean);
    env.PATH = pathParts.join(path.delimiter);
    return env;
  }

  async function waitHealthy(timeoutMs = HEALTH_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    const url = `http://127.0.0.1:${port}/api/health`;
    const headers = {
      Authorization: `Basic ${Buffer.from(`${authUser}:${authPass}`).toString('base64')}`,
    };
    while (Date.now() < deadline) {
      if (status === 'failed') return false;
      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(1500) });
        if (response.ok) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  }

  async function start() {
    if (child) return getStatus();
    const config = loadConfig();
    const dataDir = resolveDataDir(config);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    const runtime = resolveRuntime();
    if (!fs.existsSync(runtime.serverEntry)) {
      setStatus('failed', `后端入口不存在: ${runtime.serverEntry}`);
      return getStatus();
    }
    port = await pickFreePort(18787);
    authUser = 'desktop';
    authPass = crypto.randomBytes(24).toString('base64url');
    intentionalStop = false;
    setStatus('starting');
    const env = buildEnv(config, dataDir, runtime);
    // TICKET-D0-01：stdin 保持打开但永不写入；Electron 被强杀时管道断开，
    // 后端收到 end 事件后自杀，避免孤儿进程占 SQLite 写锁与 ADB 轮询。
    env.BIO_DEATH_PIPE = '1';
    const args = [runtime.serverEntry];
    pushLine('system', `启动后端: ${runtime.nodeExe} ${args.join(' ')}`);
    pushLine('system', `数据目录: ${dataDir}`);
    pushLine('system', `监听端口: 127.0.0.1:${port}`);
    child = spawn(runtime.nodeExe, args, {
      cwd: dataDir,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    child.stdout?.on('data', (chunk) => pushLine('stdout', chunk.toString()));
    child.stderr?.on('data', (chunk) => pushLine('stderr', chunk.toString()));
    child.once('error', (error) => {
      setStatus('failed', `后端启动失败: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      const pid = child?.pid;
      child = null;
      startedAt = 0;
      if (intentionalStop) {
        setStatus('stopped');
        return;
      }
      setStatus('failed', `后端意外退出: code=${code} signal=${signal || '-'} pid=${pid || '-'}`);
      scheduleAutoRestart();
    });
    const ok = await waitHealthy();
    if (!ok) {
      if (status !== 'failed') setStatus('failed', '后端在 30 秒内未通过健康检查');
      const failure = lastError;
      await stop();
      setStatus('failed', failure);
      return getStatus();
    }
    startedAt = Date.now();
    setStatus('ready');
    return getStatus();
  }

  function scheduleAutoRestart() {
    const now = Date.now();
    restartTimes = restartTimes.filter((time) => now - time < AUTO_RESTART_WINDOW_MS);
    if (restartTimes.length >= AUTO_RESTART_LIMIT) {
      pushLine('system', '后端连续异常退出达到上限，停止自动重启。请手动重启服务。');
      return;
    }
    restartTimes.push(now);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      pushLine('system', '自动重启后端...');
      void start();
    }, 1500);
  }

  async function stop() {
    intentionalStop = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    const current = child;
    if (!current) {
      setStatus('stopped', lastError);
      return;
    }
    pushLine('system', '请求后端优雅停机...');
    try {
      current.send?.({ type: 'shutdown' });
    } catch {}
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      current.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited && current.pid) {
      pushLine('system', '优雅停机超时，强制清理进程树...');
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(current.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        try { process.kill(-current.pid, 'SIGKILL'); } catch { try { current.kill('SIGKILL'); } catch {} }
      }
    }
    child = null;
    startedAt = 0;
    setStatus('stopped', lastError);
  }

  async function restart() {
    await stop();
    return start();
  }

  return { start, stop, restart, getStatus, getAuth, getRecentLogs, pushLine };
}
