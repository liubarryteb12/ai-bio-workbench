// 作业中心三处状态变更调用必须携带单权威租约头（AI_ORCHESTRATION_SPEC 第三节）。
// 2026-11-14 便携包 GUI 实测：租约闸门上线后前端没有引导，点「一键分析并排队」
// 必然 409 缺少有效租约，全流程在最后一步断掉。本测试把修复钉死在源码面。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

test('作业中心：三处状态变更调用都带租约头（create / run / from-package）', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'views', 'WorkOrderCenterView.tsx'), 'utf8');
  assert.match(src, /ensureAuthorityLeaseId/, '视图必须先引导租约再发状态变更请求');
  assert.match(src, /X-BIO-LEASE-ID/, '请求头必须带 X-BIO-LEASE-ID');
  // 三处调用统一走 postJsonWithLease（定义 1 处 + 调用 3 处），头部集中一处便于 409 重试
  const hits = src.match(/postJsonWithLease[<(]/g) || [];
  assert.ok(hits.length >= 4, 'postJsonWithLease 定义加三处调用，实际 ' + hits.length + ' 处');
  const helper = src.match(/async function postJsonWithLease[\s\S]*?\n\}/) || [''];
  assert.match(helper[0], /X-BIO-LEASE-ID/, '集中头必须带租约');
});

test('租约引导模块：先读现状、缺失时 acquire、内存缓存', () => {
  const src = fs.readFileSync(path.join(REPO, 'src', 'lib', 'authorityLease.ts'), 'utf8');
  assert.match(src, /orchestration\/authority/, '必须访问租约接口');
  assert.match(src, /\/acquire/, '缺失时必须 acquire');
  assert.match(src, /cachedLeaseId/, '必须内存缓存避免每请求一次往返');
});
