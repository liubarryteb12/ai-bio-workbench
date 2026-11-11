/**
 * Spec 到阶段 TODO 到 Goal 的运行契约。
 *
 * 判据：
 *   1. 导航指针可达，运行契约文档存在。
 *   2. 模板含目标、阶段、票、验收、停机、预授权六个字段或锚点。
 *   3. 现有红线与终态命令仍以既有真源为准。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DOC = 'docs/AFK_SPEC_TODO_GOAL.md';

function read(relative) {
  return fs.readFileSync(path.join(REPO, relative), 'utf8');
}

test('导航指针指向可读取的 AFK 契约', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /docs\/AFK_SPEC_TODO_GOAL\.md/);
  assert.ok(fs.existsSync(path.join(REPO, DOC)), `${DOC} missing`);
});

test('AFK 契约含 spec 字段、Goal 模板、终态与停机条件', () => {
  const doc = read(DOC);
  for (const token of [
    '`objective`', '`stages`', '`tickets`', '`acceptance`',
    '`blocked_policy`', '`decisions`', '## Goal 启动模板',
    '## 自动完成的终态', '## 停机条件',
  ]) {
    assert.ok(doc.includes(token), `契约缺少 ${token}`);
  }
});

test('AFK 契约引用既有验收命令与审核红线', () => {
  const doc = read(DOC);
  assert.match(doc, /node tools\/dev\/run_all_gates\.mjs --skip-tests/);
  assert.match(doc, /node tools\/dev\/dist_parity_gate\.mjs/);
  assert.match(doc, /PRODUCTIZATION_RECEIPT_OK/);
  assert.match(doc, /require_admin_review=false/);
  assert.match(doc, /remote_channel_policy\.md/);
  assert.match(doc, /PRODUCTIZATION_SPEC\.md/);
});
