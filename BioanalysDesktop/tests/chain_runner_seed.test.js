import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FILES = [
  'cn_debug/2026-10-21_m1_line1_chain.mjs',
  'cn_debug/2026-10-21_m1_line2_chain.mjs',
  'cn_debug/2026-10-21_m1_line3_chain.mjs',
  'cn_debug/lib/chain_runner.mjs',
];

test('三线主链 runner 默认使用 v3.1 固定种子 20261013', () => {
  for (const relative of FILES) {
    const text = fs.readFileSync(path.join(REPO, relative), 'utf8');
    assert.match(text, /SEED\s*=\s*(?:Number\()?\s*process\.env\.SEED\s*\|\|\s*['"]?20261013['"]?/,
      `${relative}: default seed drift`);
    assert.doesNotMatch(text, /20261021/, `${relative}: historical seed remains`);
  }
});
