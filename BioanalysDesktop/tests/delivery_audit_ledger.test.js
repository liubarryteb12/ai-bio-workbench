/**
 * 生产脱敏审计流契约测试（Argon 第二十一轮 Q2，2026-11-03）。
 *
 * 裁定要求三个硬点，缺一不可：
 *   1. 生产回执绝不往 git 跟踪的 tools/ops/delivery_acceptance/records/ 自动写（污染工作区 +
 *      泄漏项目号与交付节奏）；
 *   2. 代理侧留一份 append-only 的脱敏总账（删掉旧包后仍能追溯历史交付）；
 *   3. 审计行不含宿主机绝对路径、不含明文项目号（只留哈希）。
 * 本测试用临时目录跑真写，不碰仓库任何受控区。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendAuditEntry, readAuditLedger, hashedProjectId, auditPathFor,
  AUDIT_LEDGER_NAME, writeReceipt, acceptDelivery,
} from '../../tools/reporting/delivery_acceptance_core.mjs';
import { buildMiniDeliveryPackage } from './support/delivery_fixture.js';
import crypto from 'node:crypto';

function tmpRoot(tag) {
  const base = path.join(path.resolve(import.meta.dirname, '..', '..'), '.tmp', 'audit-' + tag + '-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function greenVerdict(tarSha256 = 'a'.repeat(64)) {
  // coverageOk 是 T2-2 接进审计流的真实字段：审计行不再无条件写 coverage_ok: true，
  // 而是如实记录验收结论。夹具必须带这个字段，否则测的是「字段缺失时写出了什么」。
  return { ok: true, tarSha256, verifiedCount: 112, failures: [], coverageOk: true };
}

test('审计流命名与路径：acceptance_audit.jsonl，落调用方指定目录', () => {
  assert.equal(AUDIT_LEDGER_NAME, 'acceptance_audit.jsonl');
  assert.equal(auditPathFor('/tmp/x'), path.join('/tmp/x', 'acceptance_audit.jsonl'));
});

test('脱敏：项目号只以 sha256 前缀出现，审计行不含宿主绝对路径与明文 id', () => {
  const root = tmpRoot('redact');
  try {
    const projectId = 'PRJ_AIMS_V3_20261027';
    const result = appendAuditEntry({
      projectId,
      verdict: greenVerdict(),
      verifiedAt: '2026-11-03T00:00:00.000Z',
      auditPath: path.join(root, 'acceptance_audit.jsonl'),
    });
    const raw = fs.readFileSync(result.path, 'utf8');
    assert.equal(raw.includes(projectId), false, '审计流不得出现明文项目号');
    assert.equal(raw.includes(root), false, '审计流不得出现宿主绝对路径');
    assert.equal(raw.includes('/mnt/'), false, '审计流不得出现远端绝对路径');
    const entry = JSON.parse(raw.trim());
    assert.equal(entry.project_id_sha256, hashedProjectId(projectId));
    assert.match(entry.project_id_sha256, /^[0-9a-f]{16}$/);
    assert.equal(entry.tar_sha256, 'a'.repeat(64));
    assert.equal(entry.verified_count, 112);
    assert.equal(entry.coverage_ok, true);
    assert.equal(entry.verifier_version.startsWith('delivery-acceptance-core/'), true);
    // 字段白名单必须精确：多一个字段就等于多一条可能泄漏的信息通道。
    // （首版只有「不含 root 绝对路径」的松散断言，给审计行塞 host_path 的变异存活了，
    //   所以这里改成字段集合精确恒等。）
    assert.deepEqual(Object.keys(entry).sort(), [
      'at', 'coverage_ok', 'project_id_sha256', 'schema_version', 'tar_sha256',
      'verified_count', 'verifier_version',
    ].sort(), '审计行字段集合必须精确锁死');
    for (const [key, value] of Object.entries(entry)) {
      const primitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
      assert.equal(primitive, true, '审计字段 ' + key + ' 必须是原始值，嵌套结构会藏路径');
    }
    // 体积守约（排空间）：一行 400B 量级，超了说明把不该留的东西写进来了
    assert.ok(raw.length < 600, '单行审计体积异常：' + raw.length);
    // 同一个项目号稳定同一哈希（可追溯但不可枚举明文）
    assert.equal(hashedProjectId(projectId), hashedProjectId(projectId));
    assert.notEqual(hashedProjectId(projectId), hashedProjectId('PRJ_OTHER'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('append-only：多次交付逐行累积，读回顺序与条数正确，坏行不连坐', () => {
  const root = tmpRoot('append');
  try {
    const auditPath = path.join(root, 'acceptance_audit.jsonl');
    for (let i = 0; i < 3; i += 1) {
      appendAuditEntry({ projectId: 'PRJ_RUN_' + i, verdict: greenVerdict(String(i).repeat(64)),
        verifiedAt: '2026-11-03T00:0' + i + ':00.000Z', auditPath });
    }
    fs.appendFileSync(auditPath, '{bad json\n', 'utf8');
    const rows = readAuditLedger(auditPath);
    assert.equal(rows.length, 3, '坏行应被跳过，不连坐前三条');
    assert.deepEqual(rows.map((r) => r.entry.tar_sha256.slice(0, 1)), ['0', '1', '2']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('红 verdict 拒绝写审计流（与回执同一条守卫）', () => {
  const root = tmpRoot('red');
  try {
    assert.throws(() => appendAuditEntry({
      projectId: 'PRJ_RED',
      verdict: { ok: false, failures: ['[signature] 验签失败'] },
      auditPath: path.join(root, 'acceptance_audit.jsonl'),
    }), /禁止写审计流/);
    assert.equal(fs.existsSync(path.join(root, 'acceptance_audit.jsonl')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('缺路径即拒绝（不许静默丢审计）', () => {
  const saved = process.env.BIO_DELIVERY_AUDIT_PATH;
  delete process.env.BIO_DELIVERY_AUDIT_PATH;
  try {
    assert.throws(() => appendAuditEntry({ projectId: 'PRJ_X', verdict: greenVerdict() }), /审计流路径缺失/);
  } finally {
    if (saved !== undefined) process.env.BIO_DELIVERY_AUDIT_PATH = saved;
  }
});

test('writeReceipt 双落点：回执落 recordsDir，同时追加一行审计流（真包验收链路）', () => {
  const root = tmpRoot('receipt');
  const keys = crypto.generateKeyPairSync('ed25519');
  try {
    const fx = buildMiniDeliveryPackage({
      root,
      projectId: 'PRJ_AUDIT',
      publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
    const pubFile = path.join(root, 'pub.pem');
    fs.writeFileSync(pubFile, keys.publicKey.export({ type: 'spki', format: 'pem' }));
    const verdict = acceptDelivery({ tarPath: fx.tarPath, publicKeyPath: pubFile });
    assert.equal(verdict.ok, true, verdict.failures.join('；'));
    const records = path.join(root, 'records');
    const out = writeReceipt({ projectId: 'PRJ_AUDIT', verdict, recordsDir: records });
    assert.ok(fs.existsSync(out.file), '回执必须落 recordsDir');
    assert.ok(out.audit && fs.existsSync(out.audit.path), '审计流必须同时落盘');
    const rows = readAuditLedger(out.audit.path);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entry.tar_sha256, verdict.tarSha256);
    assert.equal(rows[0].entry.verified_count, verdict.verifiedCount);
    assert.equal(fs.readFileSync(out.audit.path, 'utf8').includes('PRJ_AUDIT'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('服务端审计落点是 deliverables 根，不是 acceptance/ 子目录（真包实测过的落点）', () => {
  // 首版服务端把审计流放进了 <deliverables>/acceptance/（与回执同目录），真包实测
  // 一行落在子目录里才发现与「代理侧独立总账」的语义不符：clean:workspace 清掉回执目录
  // 就会连带清掉审计历史。这里同时钉住落点形态与 writeReceipt 的显式 auditPath 能力。
  const root = tmpRoot('auditroot');
  try {
    const recordsDir = path.join(root, 'deliverables', 'acceptance');
    const explicitAudit = path.join(root, 'deliverables', AUDIT_LEDGER_NAME);
    const out = writeReceipt({ projectId: 'PRJ_PLACE', verdict: greenVerdict(), recordsDir, auditPath: explicitAudit });
    assert.equal(path.basename(out.file), 'PRJ_PLACE.receipt.json');
    assert.equal(out.file.startsWith(recordsDir), true, '回执仍落 recordsDir');
    assert.equal(out.audit.path, explicitAudit, '显式 auditPath 必须原样生效（不回落到 recordsDir）');
    assert.equal(path.dirname(out.audit.path), path.join(root, 'deliverables'), '审计流落在 deliverables 根');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('静态契约：服务端审计落点在 deliverables（gitignore 区），不是受控 records 目录', () => {
  const server = fs.readFileSync(path.join(path.resolve(import.meta.dirname, '..'), 'server', 'report.js'), 'utf8');
  assert.match(server, /function serverAuditPath\(safe\)[\s\S]{0,400}auditPathFor\(localDeliverDir\(safe\)\)/,
    '服务端审计流必须落在 localDeliverDir（deliverables/，gitignore 区）');
  assert.ok(server.includes('BIO_DELIVERY_AUDIT_PATH'), '必须支持环境变量覆盖（测试与抽检隔离）');
  const gitignore = fs.readFileSync(path.join(path.resolve(import.meta.dirname, '..', '..'), '.gitignore'), 'utf8');
  assert.match(gitignore, /workspace\/projects\/\*\/deliverables\//, 'deliverables 必须在 gitignore 内');
});
