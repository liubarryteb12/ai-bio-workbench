import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadEnvFile, loadLocalEnv } from '../server/env.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bio-env-'));
}

test('loadEnvFile 解析键值、引号与注释，且不覆盖已有变量', () => {
  const dir = tempDir();
  const file = path.join(dir, '.env.local');
  fs.writeFileSync(file, [
    'A=1',
    'B="two words"',
    '# comment',
    'export C=3',
    'A=9',
  ].join('\n'));
  const env = { A: 'keep' };
  const loaded = loadEnvFile(file, env);
  assert.equal(env.A, 'keep');
  assert.equal(env.B, 'two words');
  assert.equal(env.C, '3');
  assert.deepEqual(loaded, ['B', 'C']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadLocalEnv 先读 .env.local，后读 .env，先到的值优先', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, '.env.local'), 'BIO_COMPUTE_ADAPTER=adb\n');
  fs.writeFileSync(path.join(dir, '.env'), 'BIO_COMPUTE_ADAPTER=mock\nBIO_REMOTE_DATA_ROOT=/data\n');
  const env = {};
  const loaded = loadLocalEnv(dir, env);
  assert.equal(env.BIO_COMPUTE_ADAPTER, 'adb');
  assert.equal(env.BIO_REMOTE_DATA_ROOT, '/data');
  assert.deepEqual(loaded, ['BIO_COMPUTE_ADAPTER', 'BIO_REMOTE_DATA_ROOT']);
  fs.rmSync(dir, { recursive: true, force: true });
});
