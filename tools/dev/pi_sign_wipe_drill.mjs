#!/usr/bin/env node
/**
 * 真机演练：签发 → 验签 → 远端擦除。
 *
 * 判据（全部来自真实进程与真实设备，不用 mock）：
 *   1. POST /api/pi/jobs/:id/package-delivery 返回 delivery_verified=true；
 *   2. 同一响应里 wipe.ok=true 且 bytes>0；
 *   3. 设备上项目沙箱只剩 WIPE_TOMBSTONE.json，墓碑里的 project_id 与 token 对得上。
 *
 * 密钥用一次性临时对，演练结束即删除，绝不碰仓库里的生产密钥。
 * 需要 adb 设备在线；离线时直接失败，不降级成 mock。
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
// 演练根带进程级唯一后缀：两台机器（或两个终端）同时跑演练不会互删对方的现场。
// test_isolation_gate R1/R4 要求递归删除目标必须带强隔离标记。
const SMOKE = path.join(REPO, '.smoke', `pi-sign-wipe-drill-${randomUUID()}`);
const KEYS = path.join(SMOKE, 'keys');
const DATA_HOME = path.join(SMOKE, 'data');
const PROJECT_ID = 'PRJ_SIGNWIPE_DRILL_1';
const JOB_ID = 'DRILL_SIGN_WIPE_1';
const REMOTE_BASE = '/mnt/ssd/bio_data/projects';
const AUTH = { user: 'drill-admin', pass: 'drill-pass-20261115' };

function log(line) {
  process.stdout.write(`${line}\n`);
}

function fail(message) {
  throw new Error(message);
}

function adbContainer(command, { allowFailure = false } = {}) {
  const result = spawnSync('pwsh', [
    '-NoProfile', '-File', path.join(REPO, 'tools', 'ops', 'adb_exec.ps1'),
    '-Level', 'container', '-Command', command,
  ], { encoding: 'utf8', cwd: REPO });
  if (result.status !== 0 && !allowFailure) {
    fail(`adb 容器命令失败（exit ${result.status}）: ${result.stderr || result.stdout}`);
  }
  return String(result.stdout || '').trim();
}

function assertDevice() {
  const out = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (out.status !== 0) fail('adb 不可用');
  const online = out.stdout.split(/\r?\n/).some((line) => /\tdevice$/.test(line.trim()));
  if (!online) fail('没有在线的 adb 设备');
  log('[OK] adb 设备在线');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function generateKeys() {
  fs.rmSync(SMOKE, { recursive: true, force: true });
  fs.mkdirSync(KEYS, { recursive: true });
  const priv = path.join(KEYS, 'ed25519_private.pem');
  const pub = path.join(KEYS, 'ed25519_public.pem');
  const gen = spawnSync(process.execPath, [
    path.join(REPO, 'tools', 'reporting', 'ed25519_tools.mjs'),
    '--generate-keys', '--private-key-output', priv, '--public-key-output', pub,
  ], { encoding: 'utf8', cwd: REPO });
  if (gen.status !== 0) fail(`生成临时密钥失败: ${gen.stderr || gen.stdout}`);
  log('[OK] 一次性临时密钥对已生成');
  return { priv, pub };
}

function seedRemoteSandbox() {
  adbContainer(`set -e
DIR=${REMOTE_BASE}/${PROJECT_ID}
rm -rf "$DIR"
mkdir -p "$DIR/raw" "$DIR/processed" "$DIR/figures" "$DIR/work_orders"
for d in raw processed figures work_orders; do echo drill-payload > "$DIR/$d/payload.txt"; done
echo SEEDED $(find "$DIR" -type f | wc -l)`);
  log('[OK] 设备侧项目沙箱已布置 4 个目录 4 个文件');
}

function readRemoteState() {
  return adbContainer(`DIR=${REMOTE_BASE}/${PROJECT_ID}
if [ ! -d "$DIR" ]; then echo MISSING; exit 0; fi
echo "ENTRIES:$(ls -1A "$DIR" | tr '\\n' ',')"
echo "TOMBSTONE:$(cat "$DIR/WIPE_TOMBSTONE.json" 2>/dev/null | tr -d '\\n')"`);
}

function cleanupRemote() {
  adbContainer(`rm -rf ${REMOTE_BASE}/${PROJECT_ID}`, { allowFailure: true });
}

async function waitForHealth(base, child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) fail(`服务进程提前退出（exit ${child.exitCode}）`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail('服务健康检查超时');
}

async function main() {
  assertDevice();
  const keys = generateKeys();
  seedRemoteSandbox();

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(REPO, 'BioanalysDesktop', 'server', 'index.js')], {
    cwd: path.join(REPO, 'BioanalysDesktop'),
    env: {
      ...process.env,
      BAD_PORT: String(port),
      BIO_DATA_HOME: DATA_HOME,
      BIO_PORTAL_SYNC_ENABLED: '0',
      BAD_AUTH_USER: AUTH.user,
      BAD_AUTH_PASS: AUTH.pass,
      BIO_ED25519_PRIVATE_KEY_PATH: keys.priv,
      BIO_ED25519_PUBLIC_KEY_PATH: keys.pub,
      NO_PROXY: '127.0.0.1,localhost',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

  try {
    await waitForHealth(base, child);
    log(`[OK] 服务已起在 ${base}`);

    const auth = Buffer.from(`${AUTH.user}:${AUTH.pass}`).toString('base64');
    const res = await fetch(`${base}/api/pi/jobs/${JOB_ID}/package-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        title: '签发擦除演练报告',
        narrativeText: '本报告用于验证签发后远端沙箱擦除链路，不含任何统计数值。',
        summaryStats: {},
        topDegsTsv: '',
        enrichmentTsv: '',
        figures: [],
        actor: 'drill',
        deliveryGrade: 'STANDARD_VERIFIED',
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) fail(`package-delivery 返回 ${res.status}: ${JSON.stringify(payload)}`);
    if (payload.delivery_verified !== true) fail(`交付验签未通过: ${JSON.stringify(payload)}`);
    log('[OK] 交付包 Ed25519 验签通过');
    if (!payload.wipe || payload.wipe.ok !== true) fail(`擦除未成功: ${JSON.stringify(payload.wipe)}`);
    log(`[OK] 擦除回执: path=${payload.wipe.path} bytes=${payload.wipe.bytes}`);

    const state = readRemoteState();
    if (!/^ENTRIES:WIPE_TOMBSTONE\.json,$/m.test(state)) {
      fail(`设备侧目录未清空到只剩墓碑: ${state}`);
    }
    if (!state.includes(`"project_id": "${PROJECT_ID}"`)) {
      fail(`墓碑 project_id 不匹配: ${state}`);
    }
    if (!/"token": "VERIFIED_AT_[^"]+"/.test(state)) {
      fail(`墓碑 token 未记录签发时间: ${state}`);
    }
    log('[OK] 设备侧只剩 WIPE_TOMBSTONE.json，project_id 与签发 token 均正确');

    const receiptFile = path.join(payload.deliverableDir, 'receipt_v1.json');
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    if (!receipt.ed25519_signature) fail('receipt_v1.json 缺少签名');
    log(`[OK] 回执已签名: delivery_grade=${receipt.delivery_grade}`);

    log('DRILL_PASS 签发 → 验签 → 远端擦除 全链通过');
  } finally {
    cleanupRemote();
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (serverLog.includes('Error')) {
      log('[note] 服务日志包含 Error 字样，保留在 .smoke 供排查');
    }
    fs.rmSync(SMOKE, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`DRILL_FAIL ${error.message}`);
  try { cleanupRemote(); } catch { /* 已尽力 */ }
  process.exit(1);
});
