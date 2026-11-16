/**
 * 打包冒烟：检查运行时目录完整性、敏感文件泄漏，并真正启动一次后端。
 *
 * 用法：node scripts/verify-package.mjs
 * 退出码：0 通过，1 失败。
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, '..');
const RUNTIME = path.join(DESKTOP_ROOT, 'release', 'runtime');

const REQUIRED = [
  'node/node.exe',
  'app-index.json',
  'BioanalysDesktop/server/index.js',
  'BioanalysDesktop/server/paths.js',
  'BioanalysDesktop/server/schema_gateway_fallback.mjs',
  'BioanalysDesktop/dist/index.html',
  'BioanalysDesktop/node_modules/better-sqlite3/prebuilds/win32-x64.node',
  'shared/work_order_v2.mjs',
  'schemas/schema_gateway.py',
  'tools/ops/adb_exec.ps1',
  'tools/bin/pi-wrapper.js',
  'picli/agent/models.json',
  'picli/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js',
  'tools/bio/workflows.json',
  'tools/bio/figure_templates.json',
  'tools/bio/figure_project_examples.json',
  'tools/reporting/delivery_acceptance_core.mjs',
  'references/05.可参考生信代码/library/catalog.json',
];

const VENV_PYTHON = path.join(DESKTOP_ROOT, 'release', 'venv', 'Scripts', 'python.exe');

const FORBIDDEN = [
  '.env.local',
  '.env',
  '_private',
  'node_modules/.cache',
  'playwright.config.ts',
  'BioanalysDesktop/tests',
  'BioanalysDesktop/test-results',
  'picli/agent/auth.json',
];

function fail(message) {
  console.error(`[verify] FAIL: ${message}`);
  process.exitCode = 1;
}

function checkRequired() {
  for (const relative of REQUIRED) {
    const full = path.join(RUNTIME, relative);
    if (!fs.existsSync(full)) fail(`缺少必需文件: ${relative}`);
  }
}

function scanForbidden(dir, relative = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (FORBIDDEN.includes(entry.name) || FORBIDDEN.includes(rel)) {
      fail(`运行时目录含禁入项: ${rel}`);
      continue;
    }
    if (entry.isDirectory()) scanForbidden(path.join(dir, entry.name), rel);
  }
}

function scanSecrets() {
  const envFile = path.join(RUNTIME, '.env.local');
  if (fs.existsSync(envFile)) fail('运行时包含 .env.local');
  const manifestPath = path.join(RUNTIME, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail('缺少 manifest.json');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.file_count || !Array.isArray(manifest.files)) fail('manifest.json 结构不完整');
}

/**
 * 索引新鲜度校验（需求 4）：重算磁盘清单与 app-index.json 比对，
 * 新增/删除/内容漂移一律红。禁止修改本判据来迁就漂移。
 */
function checkIndexFreshness() {
  const indexPath = path.join(RUNTIME, 'app-index.json');
  if (!fs.existsSync(indexPath)) {
    fail('缺少 app-index.json');
    return;
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const actual = new Map();
  const selfPath = 'app-index.json';
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { visit(full); continue; }
      const relative = path.relative(RUNTIME, full).split(path.sep).join('/');
      if (relative === selfPath) continue;
      actual.set(relative, fs.statSync(full).size);
    }
  };
  visit(RUNTIME);
  const indexed = new Map((index.entries || []).map(item => [item.path, item.bytes]));
  for (const [relative, bytes] of actual) {
    if (!indexed.has(relative)) fail(`索引缺少文件（新增未更新索引）: ${relative}`);
    else if (indexed.get(relative) !== bytes) fail(`索引内容漂移: ${relative}`);
  }
  for (const relative of indexed.keys()) {
    if (relative === selfPath) continue;
    if (!actual.has(relative)) fail(`索引多余文件（删除未更新索引）: ${relative}`);
  }
  if (!Array.isArray(index.relations) || index.relations.length === 0) {
    fail('app-index.json 缺少 relations（引用关系必须成索引）');
  }
}

async function checkSchemaFallback() {
  const modulePath = path.join(RUNTIME, 'BioanalysDesktop', 'server', 'schema_gateway_fallback.mjs');
  const mod = await import(pathToFileURL(modulePath).href);
  const allowed = mod.validateWithFallback('run_task', {
    lineId: 'line1_bulk',
    step: 'qc',
    projectId: 'PRJ_SMOKE',
    inputs: [],
  });
  if (!allowed.allowed) fail(`Schema 回退网关拒绝合法载荷: ${JSON.stringify(allowed.errors)}`);
  const denied = mod.validateWithFallback('run_task', {
    lineId: 'line9_unknown',
    step: 'qc',
    projectId: 'PRJ_SMOKE',
  });
  if (denied.allowed) fail('Schema 回退网关放行了非法 lineId');
  const project = mod.validateWithFallback('project', {
    project_id: 'PRJ_SMOKE',
    project_name: '冒烟项目',
    pipeline: 'line1_bulk',
  });
  if (!project.allowed) fail(`Schema 回退网关拒绝合法 project: ${JSON.stringify(project.errors)}`);
}

/**
 * Pi CLI 包内解析：不依赖全局 pi，也不依赖开发态路径。
 * 这是"便携包内置 Pi CLI"的唯一功能判据，缺文件或路径算错都会红。
 */
async function checkPiRuntime() {
  const wrapperPath = path.join(RUNTIME, 'tools', 'bin', 'pi-wrapper.js');
  const mod = await import(pathToFileURL(wrapperPath).href);
  const resolved = mod.resolvePiCli({ env: {}, packageRoot: RUNTIME });
  if (!resolved) {
    fail('包内 Pi CLI 无法解析（runtime/picli 布局不匹配）');
    return;
  }
  if (!fs.existsSync(resolved.cli)) fail(`解析出的 Pi CLI 不存在: ${resolved.cli}`);
  if (!resolved.agentDir || !fs.existsSync(resolved.agentDir)) {
    fail(`Pi agent 配置目录不可用: ${resolved.agentDir || '<null>'}`);
    return;
  }
  const run = spawnSync(process.execPath, [wrapperPath, '--version'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    env: { ...process.env, PI_CODING_AGENT_DIR: resolved.agentDir },
  });
  if (run.status !== 0) {
    fail(`包内 Pi CLI 启动失败: ${run.stderr || run.stdout}`);
    return;
  }
  console.log(`[verify] Pi CLI 包内解析并启动通过: ${String(run.stdout).trim()}`);
}

function checkVenv() {
  if (!fs.existsSync(VENV_PYTHON)) {
    fail(`缺少 venv 解释器: ${VENV_PYTHON}`);
    return;
  }
  const result = spawnSync(VENV_PYTHON, ['-c', 'import pydantic; print(pydantic.__version__)'], {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(`venv pydantic 导入失败: ${result.stderr || result.stdout}`);
    return;
  }
  console.log(`[verify] venv pydantic ${String(result.stdout).trim()}`);
}

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(0));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function smokeStart() {
  // 冒烟数据目录放在 release 内：部分构建机对 %TEMP% 有额外的受限令牌，
  // 与产品运行面无关；release 内可写性才是打包契约要验证的东西。
  const smokeRoot = path.join(DESKTOP_ROOT, 'release', '.smoke-data');
  fs.rmSync(smokeRoot, { recursive: true, force: true });
  const dataHome = fs.mkdtempSync(`${smokeRoot}-`);
  for (const relative of ['workspace/projects', 'portal/inbox', '.uploads', '.ops_state', '.tmp', 'ledger']) {
    fs.mkdirSync(path.join(dataHome, relative), { recursive: true });
  }
  const port = await freePort();
  const nodeExe = path.join(RUNTIME, 'node', 'node.exe');
  const serverEntry = path.join(RUNTIME, 'BioanalysDesktop', 'server', 'index.js');
  const child = spawn(nodeExe, [serverEntry], {
    cwd: dataHome,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      BAD_PORT: String(port),
      BIO_ALLOW_DEV_NOAUTH: '1',
      BIO_ASSET_ROOT: RUNTIME,
      BIO_DATA_HOME: dataHome,
      BIO_UPLOAD_ROOT: path.join(dataHome, '.uploads'),
      BIO_COMPUTE_ADAPTER: 'mock',
      BIO_ALLOW_MOCK_COMPUTE: '1',
      BIO_ALLOW_SCHEMA_GATEWAY_FALLBACK: '1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  let healthy = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) { healthy = true; break; }
    } catch {}
    await sleep(250);
  }
  if (!healthy) {
    fail(`后端未通过健康检查。日志：\n${output.slice(-4000)}`);
  } else {
    for (const endpoint of ['/api/projects/list', '/api/figures/templates', '/api/selfcheck']) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) fail(`${endpoint} 返回 ${response.status}`);
      } catch (cause) {
        fail(`${endpoint} 请求失败: ${cause.message}`);
      }
    }
  }

  if (healthy) {
    for (const relative of ['portal/inbox', '.uploads', '.ops_state']) {
      if (!fs.existsSync(path.join(dataHome, relative))) fail(`数据目录缺少初始化项: ${relative}`);
    }
  }

  let exited = child.exitCode !== null;
  if (!exited) {
    try {
      if (child.connected) child.send({ type: 'shutdown' });
    } catch {}
    exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
  }
  if (!exited && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
  }
  if (!exited) fail('后端未在超时内退出');
}

async function main() {
  if (!fs.existsSync(RUNTIME)) {
    fail(`运行时目录不存在: ${RUNTIME}，先执行 npm run stage`);
    return;
  }
  checkRequired();
  scanForbidden(RUNTIME);
  scanSecrets();
  await checkSchemaFallback();
  await checkPiRuntime();
  checkVenv();
  checkIndexFreshness();
  await smokeStart();
  if (process.exitCode) {
    console.error('[verify] 未通过');
  } else {
    console.log('[verify] 通过：运行时完整、无敏感文件、后端冒烟成功');
  }
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
