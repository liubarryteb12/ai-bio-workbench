// 便携包内基线行与打包机计数天然不同（开发期未跟踪测试文件不进包）。
// metrics 在包上下文（MANIFEST.sha256 在位）必须跳过基线对账，不许拿母版基线误红包内门禁。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

test('metrics：包上下文跳过基线对账（MANIFEST 判定）', () => {
  const src = fs.readFileSync(path.join(REPO, 'tools', 'dev', 'metrics_sync.mjs'), 'utf8');
  assert.match(src, /MANIFEST\.sha256/, '必须用 MANIFEST.sha256 识别包上下文');
  assert.match(src, /便携包上下文/, '跳过时必须显式说明职责归属');
});
