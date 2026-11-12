/**
 * 队列顺序契约（2026-11-12）：乱序批准时，出队顺序必须跟批准序走。
 *
 * 背景（2026-11-12 模拟实测）：排序键是 created_at 时，乱序批准 003→001→004→002，
 * 泵实际执行仍是 001→002→003→004，人看到的批准序与执行序不一致。
 * 排序键改为 approved_at 后，批准序优先，创建序兜底。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listQueue } from '../server/services/work_order.service.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wo-queue-order-'));
}

function writeMeta(baseDir, projectId, workOrderId, createdOffsetMs, approvedOffsetMs) {
  // readAllMeta 的目录结构是 <baseDir>/<projectId>/work_orders/*.meta.json，
  // 与真实磁盘布局一致（projectsRoot(baseDir) = baseDir/workspace/projects）。
  const dir = path.join(baseDir, 'workspace', 'projects', projectId, 'work_orders');
  fs.mkdirSync(dir, { recursive: true });
  const approved = approvedOffsetMs !== null;
  const meta = {
    work_order_id: workOrderId,
    project_id: projectId,
    line_id: 'line1_bulk',
    status: 'queued',
    created_at: new Date(2026, 10, 12, 10, 0, createdOffsetMs).toISOString(),
    approved: approved,
    approved_at: approved ? new Date(2026, 10, 12, 11, 0, approvedOffsetMs).toISOString() : null,
  };
  fs.writeFileSync(path.join(dir, `${workOrderId}.meta.json`), JSON.stringify(meta), 'utf8');
}

test('乱序批准时，队列顺序跟批准序走（approved_at 优先）', () => {
  const root = tempRoot();
  // 创建序 A→B→C→D（offset 0..3），批准序 C→A→D→B（approved offset 0..3）
  writeMeta(root, 'PRJ_ORDER', 'WO-C-003', 2, 0);
  writeMeta(root, 'PRJ_ORDER', 'WO-A-001', 0, 1);
  writeMeta(root, 'PRJ_ORDER', 'WO-D-004', 3, 2);
  writeMeta(root, 'PRJ_ORDER', 'WO-B-002', 1, 3);

  const queue = listQueue(root, 'PRJ_ORDER');
  const ids = queue.map((row) => row.work_order_id);
  assert.deepEqual(ids, ['WO-C-003', 'WO-A-001', 'WO-D-004', 'WO-B-002'],
    '出队顺序必须跟批准序走，不跟创建序');
  const positions = queue.map((row) => row.position);
  assert.deepEqual(positions, [1, 2, 3, 4], 'position 从 1 起连续');
});

test('未批准的 queued（approved_at 缺失）按创建序兜底，排在已批准之后', () => {
  const root = tempRoot();
  writeMeta(root, 'PRJ_MIX', 'WO-APPROVED', 5, 0);
  writeMeta(root, 'PRJ_MIX', 'WO-PENDING', 0, null);

  const queue = listQueue(root, 'PRJ_MIX');
  const ids = queue.map((row) => row.work_order_id);
  // listQueue 只含 approved === true 的 queued 作业；未批准的（approved=false）
  // 被过滤掉，不进队列。排序键是 approved_at，已批准的都在队列里。
  assert.deepEqual(ids, ['WO-APPROVED'],
    '未批准的作业被 listQueue 过滤，队列里只有已批准的');
});
