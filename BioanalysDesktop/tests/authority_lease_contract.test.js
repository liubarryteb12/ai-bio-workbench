/**
 * 单权威租约契约：获取、冲突、过期、续租、释放、人工接管与写端点准入。
 *
 * 判据来自 docs/AI_ORCHESTRATION_SPEC.md 第三节与第九节。
 * 全部用临时库文件，不碰 .ops_state 下的真实租约。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  acquireAuthority,
  assertAuthority,
  closeAuthorityDatabase,
  heartbeatAuthority,
  readAuthority,
  releaseAuthority,
  takeoverAuthority,
} from '../server/services/authority.service.js';
import { resolvePrincipal, makeActor } from '../server/auth_principal.js';
import { createReceiptV1, appendActorTrace } from '../server/receipt_v1.js';

const HUMAN = Object.freeze({ kind: 'human', id: 'admin', role: 'admin' });
const AI = Object.freeze({ kind: 'ai_assist', id: 'ai-orchestrator', role: 'admin' });

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-authority-'));
  return { file: path.join(dir, 'authority.sqlite'), dir };
}

function withDb(fn) {
  const { file, dir } = tempFile();
  try {
    return fn({ file, dir });
  } finally {
    closeAuthorityDatabase(file);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('acquire：空闲时拿到 lease_id，读取可复现', () => withDb(({ file }) => {
  const result = acquireAuthority(AI, { file });
  assert.match(result.lease_id, /^AUTH-\d{8}-\d{4}$/);
  assert.equal(result.created, true);
  assert.equal(result.authority.holder.kind, 'ai_assist');
  assert.equal(readAuthority({ file }).lease_id, result.lease_id);
}));

test('acquire：被其他主体持有时 409 ERR_AUTHORITY_HELD', () => withDb(({ file }) => {
  acquireAuthority(AI, { file });
  assert.throws(
    () => acquireAuthority(HUMAN, { file }),
    (cause) => cause.code === 'ERR_AUTHORITY_HELD' && cause.status === 409,
  );
}));

test('acquire：同一主体重复获取按续期处理，acquired_at 不变', () => withDb(({ file }) => {
  const first = acquireAuthority(AI, { file });
  const second = acquireAuthority(AI, { file, ttlSeconds: 300 });
  assert.notEqual(second.lease_id, first.lease_id);
  assert.equal(second.authority.acquired_at, first.authority.acquired_at);
  assert.equal(second.created, false);
}));

test('acquire：过期租约可被其他主体接手', () => withDb(({ file }) => {
  const past = new Date(Date.now() - 10 * 60 * 1000);
  acquireAuthority(AI, { file, now: past, ttlSeconds: 60 });
  const taken = acquireAuthority(HUMAN, { file, ttlSeconds: 60 });
  assert.equal(taken.authority.holder.kind, 'human');
  assert.equal(taken.created, true);
}));

test('heartbeat：持有者可续租，其他主体 409 ERR_AUTHORITY_REQUIRED', () => withDb(({ file }) => {
  const { lease_id: leaseId } = acquireAuthority(AI, { file });
  const renewed = heartbeatAuthority(AI, leaseId, { file, ttlSeconds: 300 });
  assert.ok(Date.parse(renewed.authority.expires_at) > Date.now());
  assert.throws(
    () => heartbeatAuthority(HUMAN, leaseId, { file }),
    (cause) => cause.code === 'ERR_AUTHORITY_REQUIRED',
  );
}));

test('release：持有者释放后无租约，旧 lease_id 立即失效', () => withDb(({ file }) => {
  const { lease_id: leaseId } = acquireAuthority(AI, { file });
  releaseAuthority(AI, leaseId, { file });
  assert.equal(readAuthority({ file }), null);
  assert.throws(() => assertAuthority(leaseId, { file }), (cause) => cause.code === 'ERR_AUTHORITY_REQUIRED');
}));

test('takeover：人工可强制接管并记录来源，AI 调用返回 403', () => withDb(({ file }) => {
  acquireAuthority(AI, { file });
  const result = takeoverAuthority(HUMAN, { file, reason: '客户要求人工复核' });
  assert.equal(result.authority.holder.kind, 'human');
  assert.equal(result.takeover_from, 'ai_assist:ai-orchestrator');
  assert.equal(result.authority.reason, '客户要求人工复核');
  assert.throws(
    () => takeoverAuthority(AI, { file }),
    (cause) => cause.code === 'ERR_AUTHORITY_TAKEOVER_DENIED' && cause.status === 403,
  );
}));

test('assertAuthority：缺 header 与不匹配都拒绝，过期单独报错', () => withDb(({ file }) => {
  const { lease_id: leaseId } = acquireAuthority(AI, { file });
  assert.throws(() => assertAuthority('', { file }), (cause) => cause.code === 'ERR_AUTHORITY_REQUIRED');
  assert.throws(() => assertAuthority('AUTH-19700101-9999', { file }), (cause) => cause.code === 'ERR_AUTHORITY_REQUIRED');
  assert.equal(assertAuthority(leaseId, { file }).lease_id, leaseId);

  const past = new Date(Date.now() - 10 * 60 * 1000);
  closeAuthorityDatabase(file);
  fs.rmSync(file, { force: true });
  acquireAuthority(AI, { file, now: past, ttlSeconds: 60 });
  assert.throws(() => assertAuthority(leaseId, { file }), (cause) => cause.code === 'ERR_AUTHORITY_EXPIRED');
}));

test('接管后旧 lease_id 不能再变更状态', () => withDb(({ file }) => {
  const { lease_id: leaseId } = acquireAuthority(AI, { file });
  takeoverAuthority(HUMAN, { file, reason: '接管' });
  assert.throws(() => assertAuthority(leaseId, { file }), (cause) => cause.code === 'ERR_AUTHORITY_REQUIRED');
}));

test('principal：AI 与人工凭证各自映射，未认证时不给主体', () => {
  const config = { humanUser: 'admin', humanPass: 'hp', aiUser: 'ai', aiPass: 'ap', devNoAuth: false };
  const basic = (user, pass) => ({ headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } });
  assert.equal(resolvePrincipal(basic('ai', 'ap'), config).actor.kind, 'ai_assist');
  assert.equal(resolvePrincipal(basic('admin', 'hp'), config).actor.kind, 'human');
  assert.equal(resolvePrincipal(basic('admin', 'wrong'), config).actor, null);
  assert.equal(resolvePrincipal({ headers: {} }, config).actor, null);
  assert.equal(resolvePrincipal({ headers: {} }, { ...config, devNoAuth: true }).actor.kind, 'local_dev');
});

test('receipt/v1：actors 与 actor_trace 追加写，旧回执字段不变', () => {
  const base = {
    workOrderDigest: 'a'.repeat(64),
    workOrderId: 'WO-1',
    projectId: 'PRJ_1',
    lineId: 'line1_bulk',
    startedAt: '2026-11-11T00:00:00.000Z',
  };
  const legacy = createReceiptV1(base);
  assert.equal(legacy.actors, undefined);
  assert.equal(legacy.actor_trace, undefined);

  const receipt = createReceiptV1({ ...base, actors: { created_by: makeActor('ai_assist', 'ai-orchestrator') } });
  appendActorTrace(receipt, {
    action: 'work_order.created',
    actor: makeActor('ai_assist', 'ai-orchestrator'),
    at: '2026-11-11T00:00:00.000Z',
    lease_id: 'AUTH-20261111-0001',
    request_id: 'REQ-1',
  });
  appendActorTrace(receipt, {
    action: 'work_order.status_changed',
    actor: makeActor('human', 'admin'),
    at: '2026-11-11T00:01:00.000Z',
  });
  assert.equal(receipt.actor_trace.length, 2);
  assert.equal(receipt.actors.created_by.kind, 'ai_assist');
  assert.equal(receipt.actors.last_updated_by.kind, 'human');
  assert.equal(receipt.actor_trace[0].lease_id, 'AUTH-20261111-0001');
  assert.equal(receipt.actor_trace[1].lease_id, null);
});
