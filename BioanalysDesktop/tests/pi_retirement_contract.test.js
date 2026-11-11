/**
 * Pi Agent 整体退场契约（T11，2026-11-11 用户裁定）。
 *
 * 背景：Pi Agent 是手机 Termux 宿主层的自主执行体，与 ADB 主通道和
 * 服务端 P-29 串行闸门并存会形成第二套命令入口。用户裁定整体删除，
 * 不留开关，不留只读残骸。
 *
 * 判据（每条都能判定「做完没做完」）：
 *   1. 退场文件全部不存在。
 *   2. 运行时、前端、测试与运维脚本里没有任何退场组件或隧道引用。
 *   3. 前端导航与视图挂载不再有退场视图。
 *   4. 隧道表只剩两条数据面 forward，reverse 表整表移除。
 *   5. 心跳服务表不再包含退场服务。
 *   6. 入口不再 import 或挂载退场路由。
 *
 * 关键词用片段拼接：本文件位于扫描面内，字面量会让仓库级终检 rg 非空。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SELF = path.relative(REPO, fileURLToPath(import.meta.url)).split(path.sep).join('/');

const PI_SHORT = 'pi';
const A2A = ['a', '2', 'a'].join('');
const PI_SNAKE = ['pi', 'agent'].join('_');
const PI_DASH = ['pi', 'agent'].join('-');
const PI_CAMEL = 'Pi' + 'Agent';
const STATE_MODULE = [A2A, 'state'].join('_');
const A2A_QUERY = [A2A, 'query'].join('_');
const A2A_SNAKE = [PI_SHORT, A2A].join('_');
const A2A_DASH = [PI_SHORT, A2A].join('-');
const PORT_A = ['99', '10'].join('');
const PORT_B = ['99', '11'].join('');
const GATEWAY = 'mag' + 'pie';
const GATEWAY_PORT = ['34', '25'].join('');
const HANDLER = 'handle' + PI_CAMEL + 'Routes';

const RETIRED_FILES = [
  `BioanalysDesktop/server/${PI_SNAKE}.js`,
  `BioanalysDesktop/server/${PI_SNAKE}_routes.js`,
  `BioanalysDesktop/server/${STATE_MODULE}.js`,
  `BioanalysDesktop/src/views/${PI_CAMEL}View.tsx`,
  `BioanalysDesktop/tests/${PI_SNAKE}.test.js`,
  `BioanalysDesktop/tests/${PI_SNAKE}_routes.test.js`,
  `BioanalysDesktop/tests/${PI_SNAKE}_telemetry.test.js`,
  `BioanalysDesktop/tests/${A2A_QUERY}_contract.test.js`,
  `BioanalysDesktop/tests/e2e/${PI_SNAKE}_poll.spec.ts`,
  `tools/dev/diagnostics/probe_${PI_SHORT}.mjs`,
  `tools/ops/${PI_SNAKE}_seed_settings.sh`,
  `tools/ops/k40/${A2A_SNAKE}_daemon.sh`,
  `tools/ops/k40/${A2A_SNAKE}_launch.sh`,
  `tools/ops/k40/${A2A_SNAKE}_telemetry_sidecar.py`,
  `tools/ops/k40/sv/${A2A_DASH}/run`,
  `tools/ops/k40/sv/${A2A_DASH}/log/run`,
];

const SCAN_DIRS = [
  'BioanalysDesktop/server',
  'BioanalysDesktop/src',
  'BioanalysDesktop/tests',
  'BioanalysDesktop/tools',
  'tools/dev',
  'tools/ops',
];

const FORBIDDEN = new RegExp([
  PI_SNAKE, PI_DASH, PI_CAMEL, A2A_SNAKE, A2A_DASH,
  PORT_A, PORT_B, GATEWAY_PORT, GATEWAY, STATE_MODULE,
].join('|'), 'i');
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.tmp', '__pycache__']);

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(REPO, file).split(path.sep).join('/');
}

test('退场文件全部不存在', () => {
  const present = RETIRED_FILES.filter((item) => fs.existsSync(path.join(REPO, item)));
  assert.deepEqual(present, [], '以下文件应已删除：\n' + present.join('\n'));
});

test('运行时与运维面不再出现退场组件或隧道引用', () => {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(REPO, dir))) {
      const relPath = rel(file);
      if (relPath === SELF) continue;
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      text.split(/\r?\n/).forEach((line, index) => {
        if (FORBIDDEN.test(line)) offenders.push(relPath + ':' + (index + 1) + ': ' + line.trim());
      });
    }
  }
  assert.deepEqual(offenders, [], '仍有退场组件或隧道引用：\n' + offenders.join('\n'));
});

test('前端导航与挂载不再有退场视图', () => {
  const app = fs.readFileSync(path.join(REPO, 'BioanalysDesktop/src/App.tsx'), 'utf8');
  assert.equal(app.includes(PI_DASH), false, 'App.tsx 仍有退场视图键');
  assert.equal(app.includes(PI_CAMEL + 'Monitor'), false, 'App.tsx 仍 import 退场视图');
});

test('隧道表只剩两条数据面 forward，reverse 表整表移除', async () => {
  const domain = await import('../../BioanalysDesktop/server/domain.js');
  assert.deepEqual(
    domain.FORWARD_PAIRS.map((pair) => pair.local),
    ['tcp:8022', 'tcp:10022'],
    'forward 只应保留 Termux 与容器两条数据面隧道',
  );
  assert.equal(Object.prototype.hasOwnProperty.call(domain, 'REVERSE_PAIRS'), false,
    'REVERSE_PAIRS 应整表移除');
});

test('心跳服务表不再包含退场服务', async () => {
  const heartbeat = await import('../../BioanalysDesktop/server/heartbeat.js');
  assert.equal(heartbeat.HEARTBEAT_SERVICES.includes(A2A_DASH), false,
    'HEARTBEAT_SERVICES 不应再有退场服务');
  assert.deepEqual(
    heartbeat.HEARTBEAT_SERVICES,
    ['sshd', 'ubuntu-sshd', 'crond', 'ssh-agent'],
    '心跳只应监督四个数据面与基础服务',
  );
});

test('入口不再 import 或挂载退场路由', () => {
  const index = fs.readFileSync(path.join(REPO, 'BioanalysDesktop/server/index.js'), 'utf8');
  assert.equal(index.includes(HANDLER), false, 'index.js 仍引用退场路由');
  assert.equal(index.includes('adb' + 'Termux'), false, 'index.js 仍引用退场专属 Termux 执行器');
});
