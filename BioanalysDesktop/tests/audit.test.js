import test from 'node:test';
import assert from 'node:assert/strict';

import { auditCommand, AuditError } from '../server/audit.js';
import { buildRemoteCommand } from '../server/ssh.js';

// 用例按"外部行为"设计：给一段命令文本，看它是否被拒绝以及拒绝原因。
// 不测内部实现。

test('合法命令：只涉及本线，通过', () => {
  const cmd = "cd /mnt/ssd/bio_data/line1_bulk/processed && Rscript deg.R";
  const result = auditCommand(cmd, 'line1_bulk');
  assert.equal(result.allowed, true);
});

test('跨线引用：命令里出现其他线的 line_id，拒绝', () => {
  const cmd = "cp /mnt/ssd/bio_data/line2_scrna/results/markers.tsv /tmp/x";
  const result = auditCommand(cmd, 'line1_bulk');
  assert.equal(result.allowed, false);
  assert.match(result.reason, /line2_scrna/);
  assert.ok(result instanceof AuditError || result.reason, '有拒绝原因');
});

test('跨线引用：reverse 方向也拦（line1 内容出现在 line3 的命令里）', () => {
  const cmd = "ls /mnt/ssd/bio_data/line1_bulk/results/";
  const result = auditCommand(cmd, 'line3_spatial');
  assert.equal(result.allowed, false);
  assert.match(result.reason, /line1_bulk/);
});

test('本线 line_id 自身可以出现', () => {
  const cmd = "ls /mnt/ssd/bio_data/line2_scrna/processed/";
  const result = auditCommand(cmd, 'line2_scrna');
  assert.equal(result.allowed, true);
});

test('共享区与台账区允许被任何线引用', () => {
  const cmd = "cp /mnt/ssd/bio_data/public_references/hg38.gtf /tmp/ && ls /mnt/ssd/bio_data/system_logs/";
  for (const line of ['line1_bulk', 'line2_scrna', 'line3_spatial']) {
    const result = auditCommand(cmd, line);
    assert.equal(result.allowed, true, `${line} 应允许引用共享区与台账区`);
  }
});

test('行级审计：多行命令里只要有一行跨线，整条拒绝', () => {
  const cmd = [
    'cd /mnt/ssd/bio_data/line1_bulk/processed',
    'cp /mnt/ssd/bio_data/line3_spatial/results/spots.tsv .',
    'Rscript deg.R',
  ].join('\n');
  const result = auditCommand(cmd, 'line1_bulk');
  assert.equal(result.allowed, false);
  assert.match(result.reason, /line3_spatial/);
});

test('大小写与路径分隔符变体也要拦', () => {
  const cmd = 'ls /mnt/ssd/bio_data\\LINE2_SCRNA\\results\\';
  const result = auditCommand(cmd, 'line1_bulk');
  assert.equal(result.allowed, false, 'Windows 风格分隔符与大写变体同样属于跨线引用');
});

test('非法的 line_id 直接拒绝', () => {
  assert.throws(() => auditCommand('ls', 'line4_nope'), AuditError);
});

test('buildRemoteCommand：计算命令走容器，底座命令走 Termux', () => {
  const viaCompute = buildRemoteCommand('Rscript x.R', 'compute');
  assert.match(viaCompute, /k40-ubuntu/);
  const viaBase = buildRemoteCommand('ls /sdcard', 'base');
  assert.match(viaBase, /\bk40\b/);
  assert.doesNotMatch(viaBase, /k40-ubuntu/);
});

test('buildRemoteCommand：含单引号的命令要正确转义，不被 shell 拆断', () => {
  const cmd = "echo 'line1_bulk ok'";
  const wrapped = buildRemoteCommand(cmd, 'compute');
  // 转义后的字符串必须让内层单引号闭合，否则远端 shell 会语法错误
  const quoteCount = (wrapped.match(/'/g) || []).length;
  assert.equal(quoteCount % 2, 0, '单引号必须成对');
});
