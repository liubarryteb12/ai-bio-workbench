/**
 * AI 管理员编排规格契约。
 *
 * 判据：
 *   1. 用户已裁定的四个方向写进 spec。
 *   2. 单权威租约、actor 留痕、API 端点与错误码可被实现票引用。
 *   3. 产品化规格与裁定台账登记这条受控例外。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SPEC = 'docs/AI_ORCHESTRATION_SPEC.md';
const TICKETS = 'docs/AI_ORCHESTRATION_TICKETS.md';

function read(relative) {
  return fs.readFileSync(path.join(REPO, relative), 'utf8');
}

test('导航指针与 spec、票可达', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /docs\/AI_ORCHESTRATION_SPEC\.md/);
  assert.ok(fs.existsSync(path.join(REPO, SPEC)), `${SPEC} missing`);
  assert.ok(fs.existsSync(path.join(REPO, TICKETS)), `${TICKETS} missing`);
});

test('四项用户裁定与单权威租约写进 spec', () => {
  const spec = read(SPEC);
  for (const token of [
    '后端 API', 'ai_assist', '管理员权限', '全局单权威租约',
    '人工强制接管', 'actor_trace', 'created_by', 'approved_by',
  ]) {
    assert.ok(spec.includes(token), `spec 缺少 ${token}`);
  }
  assert.match(spec, /\/api\/orchestration\/authority\/acquire/);
  assert.match(spec, /\/api\/orchestration\/authority\/takeover/);
  assert.match(spec, /X-Bio-Lease-Id/);
  assert.match(spec, /ERR_AUTHORITY_HELD/);
  assert.match(spec, /ERR_AUTHORITY_REQUIRED/);
});

test('阶段票覆盖身份、留痕、租约、客户端与端到端', () => {
  const tickets = read(TICKETS);
  for (const phase of ['S0', 'S1', 'S2', 'S3', 'S4']) {
    assert.ok(tickets.includes(`## ${phase}`), `票缺少阶段 ${phase}`);
  }
  assert.match(tickets, /红测/);
  assert.match(tickets, /验收/);
  assert.match(tickets, /ai_orchestrator\.mjs/);
  assert.match(tickets, /actor_trace/);
  assert.match(tickets, /authority/i);
});

test('产品化规格与裁定台账登记受控例外', () => {
  const product = read('docs/PRODUCTIZATION_SPEC.md');
  assert.match(product, /AI_ORCHESTRATION_SPEC\.md/);
  const decisions = read('workspace/handoff/SPEC_DECISIONS.md');
  assert.match(decisions, /D-30/);
  assert.match(decisions, /AI 管理员编排/);
  assert.match(decisions, /单权威租约/);
});

test('新增文档保持仓库标点口径', () => {
  for (const relative of [SPEC, TICKETS]) {
    assert.equal(read(relative).includes('—'), false, `${relative} 含 em dash`);
  }
});
