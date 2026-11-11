/**
 * 第 4 维 SHA256 一致性比对的离线测试（aims §三.3，SPEC_DECISIONS D-07）。
 *
 * 为什么不连 K40：ssh 走的是 server/selfcheck.js 里默认导入的
 * childProcess.spawnSync（D-08 接缝），这里用 mock.method 垫片返回伪造的
 * sha256sum 输出，断言的是判据本身；真链路是否通由运维侧
 * tools/ops/sync_and_verify_remote.ps1 负责。
 *
 * 覆盖：命令构造（MISSING 分支 + 哨兵）、逐行解析（含 Warning 行混入）、
 * 一致 pass / 不一致 fail / 远端缺失 warn / 不可达 unknown / 缺哨兵 unknown /
 * 空输出 unknown / 本地缺失 unknown / 优先级 fail > warn / 四档名字不漂移。
 */

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import childProcess from 'node:child_process';

import {
  CORE_SYNC_FILES,
  SHA256_SENTINEL,
  SELFCHECK_STATUSES,
  buildSha256Command,
  parseSha256Output,
  collectLocalSha256,
  evaluateSha256Parity,
  runSha256ParityCheck,
} from '../server/selfcheck.js';

/** 假哈希：64 位 hex，便于断言前 12 位 */
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

const TARGETS = [
  { repo: 'core/bridge_guard.sh', remote: '/mnt/ssd/bio_data/core/bridge_guard.sh' },
  { repo: 'core/bridge_guard.sh', remote: '/mnt/ssd/bio_data/ops/bridge_guard.sh' },
  { repo: 'tools/ops/check_storage_and_isolation.sh', remote: '/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh' },
  { repo: 'tools/reporting/verify_bridge_checkpoint.py', remote: '/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py' },
];

/** 四个远端路径全部回读为给定哈希 */
function hashesForAll(hash = HASH_A) {
  const map = new Map();
  for (const target of TARGETS) map.set(target.remote, hash);
  return map;
}

function localForAll(hash = HASH_A) {
  const map = new Map();
  for (const target of TARGETS) map.set(target.repo, hash);
  return map;
}

function parsedAll(hash = HASH_A) {
  return { hashes: hashesForAll(hash), missing: [], sawSentinel: true };
}

test('CORE_SYNC_FILES：守卫母版与 ops 镜像都在清单里，远端路径带部署根', () => {
  const remotes = CORE_SYNC_FILES.map((item) => item.remote);
  assert.ok(remotes.includes('/mnt/ssd/bio_data/core/bridge_guard.sh'), '缺守卫母版远端路径');
  assert.ok(remotes.includes('/mnt/ssd/bio_data/ops/bridge_guard.sh'), '缺守卫镜像远端路径');
  assert.ok(CORE_SYNC_FILES.some((item) => item.repo === 'tools/ops/check_storage_and_isolation.sh'));
  assert.ok(CORE_SYNC_FILES.some((item) => item.repo === 'tools/reporting/verify_bridge_checkpoint.py'));
});

test('buildSha256Command：逐文件 -f 判断，缺失打印 MISSING，结尾带哨兵', () => {
  const command = buildSha256Command(TARGETS);
  for (const target of TARGETS) {
    assert.ok(command.includes("if [ -f '" + target.remote + "' ]"), '缺 -f 判断：' + target.remote);
    assert.ok(command.includes("sha256sum '" + target.remote + "'"), '缺 sha256sum：' + target.remote);
    assert.ok(command.includes('MISSING ' + target.remote), '缺 MISSING 分支：' + target.remote);
  }
  assert.ok(command.endsWith("echo '" + SHA256_SENTINEL + "'"), '命令结尾必须是哨兵');
  // P-08：路径清单不许直接管道给 xargs（会被 shell 当命令执行）
  assert.ok(!command.includes('| xargs'), '命令里不许出现 | xargs');
});

test('parseSha256Output：逐行解析 64 位 hex + 两空格 + 路径，MISSING 单独收集', () => {
  const text = [
    HASH_A + '  /mnt/ssd/bio_data/core/bridge_guard.sh',
    HASH_B + '  /mnt/ssd/bio_data/ops/bridge_guard.sh',
    'MISSING /mnt/ssd/bio_data/ops/check_storage_and_isolation.sh',
    SHA256_SENTINEL,
  ].join('\n');
  const parsed = parseSha256Output(text);
  assert.equal(parsed.hashes.size, 2);
  assert.equal(parsed.hashes.get('/mnt/ssd/bio_data/core/bridge_guard.sh'), HASH_A);
  assert.equal(parsed.hashes.get('/mnt/ssd/bio_data/ops/bridge_guard.sh'), HASH_B);
  assert.deepEqual(parsed.missing, ['/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh']);
  assert.equal(parsed.sawSentinel, true);
});

test('parseSha256Output：混入 ssh Warning 行仍能解析（P-04 / P-10）', () => {
  const text = [
    'Warning: Permanently added \'10.0.0.5\' (ED25519) to the list of known hosts.',
    HASH_A + '  /mnt/ssd/bio_data/core/bridge_guard.sh',
    HASH_B + '  /mnt/ssd/bio_data/ops/bridge_guard.sh',
    SHA256_SENTINEL,
  ].join('\n');
  const parsed = parseSha256Output(text);
  assert.equal(parsed.hashes.size, 2, 'Warning 行不应破坏逐行解析');
  assert.equal(parsed.hashes.get('/mnt/ssd/bio_data/core/bridge_guard.sh'), HASH_A);
  assert.equal(parsed.sawSentinel, true);
});

test('evaluateSha256Parity：本地与远端全一致 → pass', () => {
  const light = evaluateSha256Parity({
    targets: TARGETS,
    localHashes: localForAll(HASH_A),
    parsed: parsedAll(HASH_A),
    sshExitCode: 0,
  });
  assert.equal(light.status, 'pass');
  assert.equal(light.value, '4/4 一致');
  assert.match(light.detail, /一致/);
});

test('evaluateSha256Parity：哈希不一致 → fail，reason 带两个哈希前 12 位', () => {
  const localHashes = localForAll(HASH_A);
  localHashes.set('tools/reporting/verify_bridge_checkpoint.py', HASH_A);
  const parsed = parsedAll(HASH_A);
  parsed.hashes.set('/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py', HASH_B);
  const light = evaluateSha256Parity({ targets: TARGETS, localHashes, parsed, sshExitCode: 0 });
  assert.equal(light.status, 'fail');
  assert.match(light.detail, /不一致/);
  assert.ok(light.detail.includes(HASH_A.slice(0, 12)), 'reason 缺本地哈希前 12 位');
  assert.ok(light.detail.includes(HASH_B.slice(0, 12)), 'reason 缺远端哈希前 12 位');
  assert.equal(light.value, '3/4 一致');
});

test('evaluateSha256Parity：远端文件不存在 → warn，reason 写 MISSING', () => {
  const parsed = parsedAll(HASH_A);
  parsed.hashes.delete('/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh');
  parsed.missing = ['/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh'];
  const light = evaluateSha256Parity({ targets: TARGETS, localHashes: localForAll(HASH_A), parsed, sshExitCode: 0 });
  assert.equal(light.status, 'warn');
  assert.match(light.detail, /MISSING/);
});

test('evaluateSha256Parity：ssh 非 0 退出 → unknown，reason 写 UNREACHABLE，绝不判 fail', () => {
  const light = evaluateSha256Parity({
    targets: TARGETS,
    localHashes: localForAll(HASH_A),
    parsed: { hashes: new Map(), missing: [], sawSentinel: false },
    sshExitCode: 255,
  });
  assert.equal(light.status, 'unknown');
  assert.match(light.detail, /UNREACHABLE/);
  assert.notEqual(light.status, 'fail');
});

test('evaluateSha256Parity：输出缺哨兵 → unknown，reason 写 NO_SENTINEL', () => {
  const parsed = parsedAll(HASH_A);
  parsed.sawSentinel = false;
  const light = evaluateSha256Parity({ targets: TARGETS, localHashes: localForAll(HASH_A), parsed, sshExitCode: 0 });
  assert.equal(light.status, 'unknown');
  assert.match(light.detail, /NO_SENTINEL/);
});

test('parseSha256Output + evaluateSha256Parity：空输出 → unknown', () => {
  const parsed = parseSha256Output('');
  assert.equal(parsed.sawSentinel, false);
  const light = evaluateSha256Parity({ targets: TARGETS, localHashes: localForAll(HASH_A), parsed, sshExitCode: 0 });
  assert.equal(light.status, 'unknown');
  assert.match(light.detail, /NO_SENTINEL/);
});

test('evaluateSha256Parity：本地核心文件缺失 → unknown，reason 写 LOCAL_MISSING', () => {
  const localHashes = localForAll(HASH_A);
  localHashes.set('core/bridge_guard.sh', null);
  const light = evaluateSha256Parity({ targets: TARGETS, localHashes, parsed: parsedAll(HASH_A), sshExitCode: 0 });
  assert.equal(light.status, 'unknown');
  assert.match(light.detail, /LOCAL_MISSING/);
});

test('evaluateSha256Parity：同时有不一致与缺失 → fail（已测出的坏优先）', () => {
  const localHashes = localForAll(HASH_A);
  localHashes.set('tools/reporting/verify_bridge_checkpoint.py', HASH_A);
  const parsed = parsedAll(HASH_A);
  parsed.hashes.set('/mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py', HASH_B);
  parsed.hashes.delete('/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh');
  parsed.missing = ['/mnt/ssd/bio_data/ops/check_storage_and_isolation.sh'];
  const light = evaluateSha256Parity({ targets: TARGETS, localHashes, parsed, sshExitCode: 0 });
  assert.equal(light.status, 'fail');
});

test('runSha256ParityCheck：mock spawnSync 后一致 → pass，命令走 ADB 单接缝且带哨兵', () => {
  const local = collectLocalSha256(CORE_SYNC_FILES);
  const stdout = CORE_SYNC_FILES.map((item) => local.get(item.repo) + '  ' + item.remote).join('\n')
    + '\n' + SHA256_SENTINEL + '\n';
  const spy = mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout, stderr: '' }));
  try {
    const light = runSha256ParityCheck();
    assert.equal(light.id, 'isolation_sha256');
    assert.equal(light.status, 'pass');
    assert.equal(light.value, CORE_SYNC_FILES.length + '/' + CORE_SYNC_FILES.length + ' 一致');
    assert.equal(spy.mock.calls.length, 1, '必须只调一次 spawnSync');
    const [command, args] = spy.mock.calls[0].arguments;
    assert.equal(command, 'pwsh');
    assert.ok(args.some((item) => String(item).includes('adb_exec.ps1')), '必须走 ADB helper');
    assert.ok(args[args.length - 1].includes(SHA256_SENTINEL), '远端命令必须带哨兵');
    assert.ok(args[args.length - 1].includes('sha256sum'), '远端命令必须跑 sha256sum');
  } finally {
    mock.restoreAll();
  }
});

test('runSha256ParityCheck：mock 远端哈希被改 → fail（端到端判据）', () => {
  const local = collectLocalSha256(CORE_SYNC_FILES);
  const lines = CORE_SYNC_FILES.map((item) => {
    const hash = item.repo === 'core/bridge_guard.sh' && item.remote.endsWith('/ops/bridge_guard.sh')
      ? HASH_D
      : local.get(item.repo);
    return hash + '  ' + item.remote;
  });
  lines.push(SHA256_SENTINEL);
  const spy = mock.method(childProcess, 'spawnSync', () => ({ status: 0, stdout: lines.join('\n'), stderr: '' }));
  try {
    const light = runSha256ParityCheck();
    assert.equal(light.status, 'fail');
    assert.match(light.detail, /ops\/bridge_guard\.sh/);
    assert.equal(spy.mock.calls.length, 1);
  } finally {
    mock.restoreAll();
  }
});

test('runSha256ParityCheck：mock ssh 不可达 → unknown（不是 fail）', () => {
  const spy = mock.method(childProcess, 'spawnSync', () => ({ status: 255, stdout: '', stderr: 'ssh: connect to host k40-ubuntu port 22: Connection timed out' }));
  try {
    const light = runSha256ParityCheck();
    assert.equal(light.status, 'unknown');
    assert.match(light.detail, /UNREACHABLE/);
    assert.equal(spy.mock.calls.length, 1);
  } finally {
    mock.restoreAll();
  }
});

test('四档名字不漂移：所有判定结果都落在 pass/warn/fail/unknown', () => {
  assert.deepEqual([...SELFCHECK_STATUSES], ['pass', 'warn', 'fail', 'unknown']);
  const scenarios = [
    evaluateSha256Parity({ targets: TARGETS, localHashes: localForAll(HASH_A), parsed: parsedAll(HASH_A), sshExitCode: 0 }),
    evaluateSha256Parity({ targets: TARGETS, localHashes: localForAll(HASH_A), parsed: { hashes: new Map(), missing: ['/mnt/ssd/bio_data/core/bridge_guard.sh'], sawSentinel: true }, sshExitCode: 0 }),
    evaluateSha256Parity({ targets: TARGETS, localHashes: localForAll(HASH_A), parsed: parsedAll(HASH_B), sshExitCode: 0 }),
    evaluateSha256Parity({ targets: TARGETS, localHashes: localForAll(HASH_A), parsed: { hashes: new Map(), missing: [], sawSentinel: false }, sshExitCode: 1 }),
  ];
  for (const light of scenarios) {
    assert.ok(SELFCHECK_STATUSES.includes(light.status), '出现新状态名：' + light.status);
  }
});
