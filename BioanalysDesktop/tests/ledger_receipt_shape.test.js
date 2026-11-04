// 台账回执形态与真实 shell 的一致性（第三十六轮 DCM 基准暴露的绿灯假象）
//
// S26 的修复把远端回执设计成 WROTE '<path>' <bytes>，persistEntry 按带引号形态校验；
// 但远端命令里写的是 echo WROTE '<path>' —— 单引号是 shell 语法，echo 的输出不保留它。
// 2026-11-05 DCM 三线基准实测：每条台账都成功落盘（回执是 WROTE /mnt/... 1167），
// persistEntry 每次仍判「远端未回 WROTE 标记」。既有单测的 mock 一律按带引号形态造回执，
// 所以仓库全绿、真链路必断。本文件用真实 bash 跑一遍写盘+取回执，把两种形态钉死成同一件事。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildLedgerWriteCommand, persistReceiptMarker } from '../server/run.js';

const BASH_CANDIDATES = [process.env.BIO_BASH, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash'];

function findBash() {
  return BASH_CANDIDATES.find((cand) => {
    if (!cand) return false;
    return spawnSync(cand, ['-c', 'true'], { encoding: 'utf8' }).status === 0;
  }) || null;
}

test('persistReceiptMarker 同时接受带引号与不带引号的真实回执', () => {
  const p = '/mnt/ssd/bio_data/system_logs/x.json';
  assert.equal(persistReceiptMarker("WROTE '" + p + "' 1167", p), 1167, '带引号形态（mock/旧契约）应被接受');
  assert.equal(persistReceiptMarker('WROTE ' + p + ' 1167', p), 1167, '不带引号形态（真实 shell 输出）应被接受');
  assert.equal(persistReceiptMarker('WROTE /other/path 1167', p), null, '路径不匹配不得算回执');
  assert.equal(persistReceiptMarker('base64: invalid input', p), null, '无回执时返回 null');
});

test('真实 bash 回环：写盘后回执必须能被 persistReceiptMarker 认出', (t) => {
  const bash = findBash();
  if (!bash) { t.skip('HOST_MISSING_SHELL: 本机无 bash，无法验证真实 shell 的回执形态'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-receipt-'));
  try {
    const posixDir = dir.replace(/\\/g, '/');
    const file = posixDir + '/entry.json';
    const payload = JSON.stringify({ hello: 'world' }, null, 2);
    // 复刻远端命令形态，只把落盘根换成本次独有的临时目录
    const command = "mkdir -p '" + posixDir + "' && base64 -d > '" + file + "'"
      + " && echo WROTE \"'" + file + "'\" $(wc -c < '" + file + "')";
    const r = spawnSync(bash, ['-c', command], {
      input: Buffer.from(payload, 'utf8').toString('base64'),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, 'bash 执行回执命令应成功: ' + (r.stderr || ''));
    const bytes = Buffer.byteLength(payload, 'utf8');
    const found = persistReceiptMarker(r.stdout, file);
    assert.equal(found, bytes, '真实 shell 的回执必须被校验器认出，实际 stdout: ' + JSON.stringify(r.stdout));
    // 落盘内容自校验：回执声称的字节数与磁盘真实字节数一致
    assert.equal(fs.readFileSync(file, 'utf8'), payload);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('回执 echo 参数必须显式带引号：靠 shell 去引号会让校验器与输出形态脱节', () => {
  const entry = {
    start_time: '2026-11-05T00:00:00.000Z',
    line_id: 'line1_bulk',
    step_name: 'deg_limma',
    task_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  };
  const { command, remotePath } = buildLedgerWriteCommand(entry);
  // 命令里必须是 echo WROTE "'<path>'"（双引号包住单引号），而不是 echo WROTE '<path>'
  assert.ok(command.includes('echo WROTE \"' + "'" + remotePath + "'" + '\"'),
    '回执路径必须用双引号包成字面量，让 echo 输出保留单引号；实际命令: ' + command);
});