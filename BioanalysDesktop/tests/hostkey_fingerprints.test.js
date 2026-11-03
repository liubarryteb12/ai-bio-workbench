import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FINGERPRINT_LEDGER_PATH, FINGERPRINT_SCHEMA,
  ERR_HOSTKEY_ROTATED, ERR_HOSTKEY_LEDGER_MISSING, ERR_HOSTKEY_LEDGER_INVALID, ERR_HOSTKEY_PROBE_UNREADABLE,
  parseFingerprintLine, parseFingerprintLedger, loadFingerprintLedger, compareFingerprint, checkHostKeys,
} from '../server/hostkey.js';
import { resolveLinkOverall } from '../server/link.js';

// ── host key 指纹台账契约（4 Argon 第十九轮 Q3）──
//
// 判据口径：指纹失配不代表链路不可用，所以这里只钉「诊断码怎么产出」，
// 不钉「链路是否判红」。四条诊断码各有用例：ROTATED（真轮换）、PROBE_UNREADABLE
// （探测炸了，绝不能当 pass）、LEDGER_MISSING、LEDGER_INVALID。
//
// 台账文件本身也被断言：两台 host 的 probe 必须各指自己那把钥匙，
// 复制粘贴串行（k40 的 probe 写到容器钥匙路径）在这里就会红。

/** 真机上 ssh-keygen -lf 的原始输出（k40 Termux 侧，2026-11-03 实测） */
const REAL_TERMUX_LINE = '256 SHA256:mKwIdn9qAXN73WVRYnH6aMrRC37LTUkaNl276UpSrKE u0_a283@localhost (ED25519)';

function ledgerObject(overrides = {}) {
  return {
    schema: FINGERPRINT_SCHEMA,
    hosts: [
      {
        host: 'k40', port: 8022, algorithm: 'ED25519', bits: 256,
        key_path: '/data/data/com.termux/files/usr/etc/ssh/ssh_host_ed25519_key.pub',
        probe: 'ssh-keygen -lf /data/data/com.termux/files/usr/etc/ssh/ssh_host_ed25519_key.pub',
        fingerprint: 'SHA256:mKwIdn9qAXN73WVRYnH6aMrRC37LTUkaNl276UpSrKE',
      },
      {
        host: 'k40-ubuntu', port: 10022, algorithm: 'ED25519', bits: 256,
        key_path: '/etc/dropbear/dropbear_ed25519_host_key',
        probe: 'dropbearkey -y -f /etc/dropbear/dropbear_ed25519_host_key | ssh-keygen -lf -',
        fingerprint: 'SHA256:c0Lm97OYp7up92tIKMXJ7lEKW5crWBLELkHZAUUTQ4A',
      },
    ],
    ...overrides,
  };
}

test('parseFingerprintLine 从 ssh-keygen -lf 输出取指纹、位数、算法与注释', () => {
  const parsed = parseFingerprintLine(REAL_TERMUX_LINE);
  assert.equal(parsed.fingerprint, 'SHA256:mKwIdn9qAXN73WVRYnH6aMrRC37LTUkaNl276UpSrKE');
  assert.equal(parsed.bits, 256);
  assert.equal(parsed.algorithm, 'ED25519');
  assert.equal(parsed.comment, 'u0_a283@localhost');
});

test('parseFingerprintLine 跳过前置噪声行（PATH 告警、登录 banner），取第一条指纹', () => {
  const noisy = [
    'bash: warning: setlocale: LC_ALL: cannot change locale',
    'Welcome to Termux',
    '',
    REAL_TERMUX_LINE,
    '256 SHA256:c0Lm97OYp7up92tIKMXJ7lEKW5crWBLELkHZAUUTQ4A root@localhost (ED25519)',
  ].join('\n');
  assert.equal(parseFingerprintLine(noisy).fingerprint, 'SHA256:mKwIdn9qAXN73WVRYnH6aMrRC37LTUkaNl276UpSrKE');
});

test('parseFingerprintLine 没有指纹时返回 null，不返回半成品对象', () => {
  assert.equal(parseFingerprintLine(''), null);
  assert.equal(parseFingerprintLine('dropbearkey: file not found'), null);
  // 只有 MD5 形态时也不算命中（台账只收 SHA256）
  assert.equal(parseFingerprintLine('2048 MD5:aa:bb:cc root@localhost (RSA)'), null);
});

test('compareFingerprint 相同即通过，不同产出 ERR_HOSTKEY_ROTATED 并带出两边指纹', () => {
  const same = compareFingerprint('SHA256:abc', 'SHA256:abc');
  assert.equal(same.ok, true);
  assert.equal(same.code, null);

  const rotated = compareFingerprint('SHA256:abc', 'SHA256:def');
  assert.equal(rotated.ok, false);
  assert.equal(rotated.code, ERR_HOSTKEY_ROTATED);
  assert.match(rotated.detail, /SHA256:abc/);
  assert.match(rotated.detail, /SHA256:def/);
  assert.match(rotated.detail, /known_hosts/);
});

test('compareFingerprint 实际值为空时是 PROBE_UNREADABLE 而不是轮换', () => {
  const r = compareFingerprint('SHA256:abc', '   ');
  assert.equal(r.ok, false);
  assert.equal(r.code, ERR_HOSTKEY_PROBE_UNREADABLE);
});

test('parseFingerprintLedger 校验 schema 与 hosts，不合法立判 LEDGER_INVALID', () => {
  assert.equal(parseFingerprintLedger(ledgerObject()).ok, true);
  assert.equal(parseFingerprintLedger(ledgerObject({ schema: 'v0' })).code, ERR_HOSTKEY_LEDGER_INVALID);
  assert.equal(parseFingerprintLedger(ledgerObject({ hosts: [] })).code, ERR_HOSTKEY_LEDGER_INVALID);
  assert.equal(parseFingerprintLedger('not json').code, ERR_HOSTKEY_LEDGER_INVALID);
});

test('parseFingerprintLedger 对指纹形态与 probe 缺失点名到具体 host', () => {
  const badPrint = ledgerObject();
  badPrint.hosts[1].fingerprint = 'MD5:zz';
  const r1 = parseFingerprintLedger(badPrint);
  assert.equal(r1.code, ERR_HOSTKEY_LEDGER_INVALID);
  assert.match(r1.detail, /k40-ubuntu/);

  const noProbe = ledgerObject();
  noProbe.hosts[0].probe = '  ';
  const r2 = parseFingerprintLedger(noProbe);
  assert.equal(r2.code, ERR_HOSTKEY_LEDGER_INVALID);
  assert.match(r2.detail, /k40/);
});

test('仓库里的台账文件真实可解析，两台 host 的 probe 各指自己的钥匙', () => {
  const loaded = loadFingerprintLedger();
  assert.equal(loaded.ok, true, loaded.detail);
  assert.equal(loaded.entries.length, 2);
  const byHost = Object.fromEntries(loaded.entries.map((entry) => [entry.host, entry]));
  assert.deepEqual(Object.keys(byHost).sort(), ['k40', 'k40-ubuntu']);
  assert.equal(byHost.k40.port, 8022);
  assert.match(byHost.k40.probe, /ssh_host_ed25519_key\.pub/);
  assert.doesNotMatch(byHost.k40.probe, /dropbear/);
  assert.equal(byHost['k40-ubuntu'].port, 10022);
  assert.match(byHost['k40-ubuntu'].probe, /dropbear_ed25519_host_key/);
  assert.doesNotMatch(byHost['k40-ubuntu'].probe, /proot/);
  for (const entry of loaded.entries) assert.match(entry.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}=?$/);
  assert.equal(path.basename(path.dirname(FINGERPRINT_LEDGER_PATH)), 'env_lock');
});

test('loadFingerprintLedger 文件不存在时是 LEDGER_MISSING，不抛异常', () => {
  const r = loadFingerprintLedger(path.join(fileURLToPath(new URL('.', import.meta.url)), 'no_such_ledger.json'));
  assert.equal(r.ok, false);
  assert.equal(r.code, ERR_HOSTKEY_LEDGER_MISSING);
  assert.deepEqual(r.entries, []);
});

test('checkHostKeys 全匹配时 pass，且每台 host 都只探一次自己的 probe', () => {
  const calls = [];
  const output = {
    k40: REAL_TERMUX_LINE,
    'k40-ubuntu': '256 SHA256:c0Lm97OYp7up92tIKMXJ7lEKW5crWBLELkHZAUUTQ4A root@localhost (ED25519)',
  };
  const result = checkHostKeys({
    ledger: parseFingerprintLedger(ledgerObject()),
    run: (args) => { calls.push(args); return { stdout: output[args[args.length - 2]] ?? '', stderr: '' }; },
  });
  assert.equal(result.pass, true);
  assert.equal(result.code, null);
  assert.equal(result.entries.length, 2);
  assert.equal(calls.length, 2);
  for (const args of calls) {
    assert.equal(args[0], 'ssh');
    assert.equal(args[args.length - 2].startsWith('k40'), true, 'host 必须紧跟 probe 之前');
  }
});

test('checkHostKeys 一台指纹变了就产出 ERR_HOSTKEY_ROTATED 并带出新旧值', () => {
  const result = checkHostKeys({
    ledger: parseFingerprintLedger(ledgerObject()),
    run: (args) => {
      const host = args[args.length - 2];
      const line = host === 'k40'
        ? '256 SHA256:BRANDNEWKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx u0_a283@localhost (ED25519)'
        : '256 SHA256:c0Lm97OYp7up92tIKMXJ7lEKW5crWBLELkHZAUUTQ4A root@localhost (ED25519)';
      return { stdout: line, stderr: '' };
    },
  });
  assert.equal(result.pass, false);
  assert.equal(result.code, ERR_HOSTKEY_ROTATED);
  assert.match(result.detail, /k40/);
  const k40 = result.entries.find((entry) => entry.host === 'k40');
  assert.equal(k40.expected, 'SHA256:mKwIdn9qAXN73WVRYnH6aMrRC37LTUkaNl276UpSrKE');
  assert.match(k40.observed, /BRANDNEWKEY/);
});

test('轮换与探测失败并存时优先报轮换（轮换是根因，探测失败多是它或它的后果）', () => {
  const result = checkHostKeys({
    ledger: parseFingerprintLedger(ledgerObject()),
    run: (args) => {
      const host = args[args.length - 2];
      if (host === 'k40') return { stdout: '256 SHA256:BRANDNEWKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx c (ED25519)', stderr: '' };
      return { stdout: 'Connection refused', stderr: '' };
    },
  });
  assert.equal(result.code, ERR_HOSTKEY_ROTATED);
});

test('探测命令抛错或输出无指纹都落 PROBE_UNREADABLE，绝不静默算通过', () => {
  const thrown = checkHostKeys({
    ledger: parseFingerprintLedger(ledgerObject()),
    run: () => { throw new Error('ssh exited with 255'); },
  });
  assert.equal(thrown.pass, false);
  assert.equal(thrown.code, ERR_HOSTKEY_PROBE_UNREADABLE);
  assert.match(thrown.detail, /255/);

  const garbage = checkHostKeys({
    ledger: parseFingerprintLedger(ledgerObject()),
    run: () => ({ stdout: 'bash: ssh-keygen: command not found', stderr: '' }),
  });
  assert.equal(garbage.pass, false);
  assert.equal(garbage.code, ERR_HOSTKEY_PROBE_UNREADABLE);
});
test('链路总判定：指纹侧任何诊断码都抬到 warn，但优先级低于硬失败与服务 down', () => {
  const base = { hardFail: false, serviceDown: false, logCrash: false, hostkeyCode: null };
  assert.equal(resolveLinkOverall(base), 'pass');
  // 指纹轮换：连接可能仍通，只告警
  assert.equal(resolveLinkOverall({ ...base, hostkeyCode: ERR_HOSTKEY_ROTATED }), 'warn');
  // 探测读不到指纹同样要可见，不能因为「没证实轮换」就沉默
  assert.equal(resolveLinkOverall({ ...base, hostkeyCode: ERR_HOSTKEY_PROBE_UNREADABLE }), 'warn');
  assert.equal(resolveLinkOverall({ ...base, hostkeyCode: ERR_HOSTKEY_LEDGER_MISSING }), 'warn');
  // 日志子服务 crash-loop 也是 warn
  assert.equal(resolveLinkOverall({ ...base, logCrash: true }), 'warn');
  // 硬失败优先：有指纹问题也照 fail
  assert.equal(resolveLinkOverall({ ...base, hardFail: true, hostkeyCode: ERR_HOSTKEY_ROTATED }), 'fail');
  assert.equal(resolveLinkOverall({ ...base, serviceDown: true, hostkeyCode: ERR_HOSTKEY_ROTATED }), 'fail');
});
