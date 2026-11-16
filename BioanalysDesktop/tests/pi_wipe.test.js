import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  wipeProjectSandbox,
  readPendingWipes,
  retryPendingWipes,
} from '../server/services/pi_wipe.js';

function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi_wipe_'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('擦除成功返回 WIPE_VERIFIED 回执并清空重试队列', (t) => {
  const dataRoot = tempRoot(t);
  const result = wipeProjectSandbox('PRJ_WIPE_1', {
    dataRoot,
    runRemote: () => "WIPE_VERIFIED '/mnt/ssd/bio_data/projects/PRJ_WIPE_1' 180",
  });
  assert.equal(result.ok, true);
  assert.equal(result.bytes, 180);
  assert.deepEqual(readPendingWipes(dataRoot), []);
});

test('擦除失败入 pending_remote_wipes，重试仍失败则保留', (t) => {
  const dataRoot = tempRoot(t);
  const result = wipeProjectSandbox('PRJ_WIPE_2', {
    dataRoot,
    runRemote: () => { throw new Error('adb offline'); },
  });
  assert.equal(result.ok, false);
  const pending = readPendingWipes(dataRoot);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].project_id, 'PRJ_WIPE_2');
  assert.equal(pending[0].status, 'PENDING_RETRY');

  const retry = retryPendingWipes({
    dataRoot,
    runRemote: () => { throw new Error('still offline'); },
  });
  assert.equal(retry.remaining, 1);
  assert.equal(readPendingWipes(dataRoot)[0].attempts, 1);
});

test('非法 project_id 直接拒绝，不调远端', (t) => {
  const dataRoot = tempRoot(t);
  let called = false;
  const result = wipeProjectSandbox('../etc', {
    dataRoot,
    runRemote: () => { called = true; return ''; },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /WIPE_PROJECT_ID_INVALID/);
  assert.equal(called, false);
});
