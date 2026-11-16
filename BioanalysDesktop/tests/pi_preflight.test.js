import test from 'node:test';
import assert from 'node:assert/strict';

import {
  K40_FILES,
  localFileSha256,
  checkK40Preflight,
} from '../server/services/pi_preflight.js';

function outputWith({ limma = true, mutateFirst = false } = {}) {
  const lines = K40_FILES.map((item, index) => {
    const hash = localFileSha256(item.local);
    return `${mutateFirst && index === 0 ? '0'.repeat(64) : hash}  ${item.remote}`;
  });
  if (limma) lines.push('LIMMA_OK');
  return lines.join('\n');
}

test('哈希同源且 limma 可加载时通过', () => {
  const result = checkK40Preflight({ runRemote: () => outputWith() });
  assert.equal(result.ok, true);
  assert.equal(result.limma_ok, true);
  assert.deepEqual(result.mismatches, []);
});

test('脚本哈希漂移时失败并点名', () => {
  const result = checkK40Preflight({ runRemote: () => outputWith({ mutateFirst: true }) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [K40_FILES[0].remote]);
});

test('limma 探活失败时失败', () => {
  const result = checkK40Preflight({ runRemote: () => outputWith({ limma: false }) });
  assert.equal(result.ok, false);
  assert.equal(result.limma_ok, false);
});

test('ADB 未就绪时返回 PREFLIGHT_ADB_UNAVAILABLE，不误报哈希漂移', () => {
  const result = checkK40Preflight({ runRemote: () => '' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'PREFLIGHT_ADB_UNAVAILABLE');
  assert.deepEqual(result.mismatches, []);
});
