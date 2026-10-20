import test from 'node:test';
import assert from 'node:assert/strict';

import { runTask, buildLedgerFileName, buildLedgerWriteCommand, stripSshNoise } from '../server/run.js';
import { auditCommand } from '../server/audit.js';
import { auditLedgerEntry } from '../server/ledger.js';
import { buildTaskScript, buildLedgerEntry } from '../server/task.js';

test('跨线任务在启动前就被拒，不会真的 ssh 出去', (testContext) => {
  let launched = false;
  const stdout = [];
  const stderr = [];
  let exitCode = null;

  // 用一个必然越界的输入试探：line1 任务引用 line2 的路径
  runTask(
    {
      lineId: 'line1_bulk',
      step: 'deg',
      inputs: ['/mnt/ssd/bio_data/line2_scrna/results/markers.tsv'],
      outputs: [],
      seed: 42,
    },
    {
      onStdout: (text) => stdout.push(text),
      onStderr: (text) => stderr.push(text),
      onExit: (code) => {
        launched = true;
        exitCode = code;
      },
    }
  );

  // onExit 是同步回调（审计不过时立即触发），据此即可判定，不需要等真实 ssh
  assert.equal(launched, true, '审计拒绝时应立即触发 onExit');
  assert.equal(exitCode, -1);
  assert.match(stderr.join(''), /audit/);
  assert.match(stderr.join(''), /line2_scrna/);
  assert.equal(stdout.length, 0, '被拒的任务不该有任何 stdout');
  testContext.diagnostic(`stderr: ${stderr.join('')}`);
});

test('审计文本与真正执行的脚本是同一份（防"审一套跑一套"）', () => {
  const task = {
    lineId: 'line2_scrna',
    step: 'knockout',
    inputs: ['/mnt/ssd/bio_data/line2_scrna/processed/ctrl.h5ad'],
    outputs: ['/mnt/ssd/bio_data/line2_scrna/results/DR_genes.csv'],
    seed: 7,
  };
  // run.js 内部就是用 buildTaskScript 的产物做审计并执行，这里固化这个契约
  const script = buildTaskScript(task);
  const audit = auditCommand(script, task.lineId);
  assert.equal(audit.allowed, true, audit.reason || '');
  assert.ok(script.includes('cd /mnt/ssd/bio_data/projects/default/line2_scrna/processed'));
  assert.ok(script.includes('BIOANALYS_SEED'));
});

test('任务产出的台账必须过自己写的审计（闭环）', () => {
  const task = {
    lineId: 'line3_spatial',
    step: 'deconvolution',
    inputs: ['/mnt/ssd/bio_data/projects/default/line3_spatial/processed/spots.h5ad'],
    outputs: ['/mnt/ssd/bio_data/projects/default/line3_spatial/results/deconv.tsv'],
    seed: 3,
  };
  const entry = buildLedgerEntry({
    lineId: task.lineId,
    step: task.step,
    seed: task.seed,
    inputs: task.inputs,
    outputs: task.outputs,
    status: 'completed',
    checkpointStatus: 'passed',
    exitCode: 0,
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:05:00Z',
  });
  const audit = auditLedgerEntry(entry);
  assert.equal(audit.legal, true, `闭环失败: ${audit.problems.join('; ')}`);
});

test('失败任务的 error_log 必须真的带内容（不能是空串）', () => {
  const entry = buildLedgerEntry({
    lineId: 'line1_bulk',
    step: 'deg',
    seed: 42,
    inputs: ['/mnt/ssd/bio_data/projects/default/line1_bulk/processed/expr.tsv'],
    outputs: [],
    status: 'failed',
    checkpointStatus: 'failed',
    exitCode: 1,
    errorLog: 'Rscript: line 3: object not found',
    startedAt: '2026-10-12T10:00:00Z',
    endedAt: '2026-10-12T10:00:20Z',
  });
  assert.ok(entry.error_log && entry.error_log.trim().length > 0);
  assert.equal(auditLedgerEntry(entry).legal, true);
});

test('台账文件名按用户工作地本地日期归档，不按 UTC 日期', () => {
  // 本地 2026-10-13 00:37（Asia/Shanghai）= UTC 2026-10-12T16:37，账要记在 13 号
  const entry = {
    start_time: '2026-10-12T16:37:00.000Z',
    project_id: 'default',
    line_id: 'line1_bulk',
    step_name: 'smoke_test',
    task_id: '979bf26c-325e-4ec7-b8c3-7438b06afd10',
  };
  const name = buildLedgerFileName(entry);
  assert.match(name, /^2026-10-13_default_line1_bulk_smoke_test_979bf26c\.json$/);
});

test('台账文件名缺 project_id 时退化为 default 段（兼容旧账）', () => {
  const entry = {
    start_time: '2026-10-12T16:37:00.000Z',
    line_id: 'line1_bulk',
    step_name: 'smoke_test',
    task_id: '979bf26c-325e-4ec7-b8c3-7438b06afd10',
  };
  const name = buildLedgerFileName(entry);
  assert.match(name, /^2026-10-13_default_line1_bulk_smoke_test_979bf26c\.json$/);
});

test('error_log 入台账前剥掉 ssh 客户端噪声，只留真实错误', () => {
  const noisy = [
    "Warning: Permanently added '[127.0.0.1]:10022' (ED25519) to the list of known hosts.",
    'bash: line 3: cd: /mnt/ssd/bio_data/line1_bulk/processed: No such file or directory',
    'Warning: Pseudo-terminal will not be allocated',
  ].join('\r\n');
  const cleaned = stripSshNoise(noisy);
  assert.ok(!cleaned.includes('Warning:'), `噪声没剥干净: ${cleaned}`);
  assert.match(cleaned, /cd: \/mnt\/ssd\/bio_data\/line1_bulk\/processed/);
  assert.match(cleaned, /No such file or directory/);
});

// 回归 2026-10-13 崩溃事故：step 名含空格时，台账文件名带空格，
// 落盘命令的 shell 重定向被空格拆断（base64 把后半段当输入文件），
// 且 persistEntry 的 rejection 被 void 丢弃变成 unhandled rejection 打死整个服务。
test('台账文件名对 step_name 做文件名安全化，空格与 shell 元字符不落地', () => {
  const entry = {
    start_time: '2026-10-12T16:37:00.000Z',
    project_id: 'default',
    line_id: 'line1_bulk',
    step_name: 'echo data_plane_ok',
    task_id: '979bf26c-325e-4ec7-b8c3-7438b06afd10',
  };
  const name = buildLedgerFileName(entry);
  // 整个文件名只允许安全字符，任何空格/引号/斜杠/分号都不允许出现
  assert.match(name, /^[A-Za-z0-9._-]+\.json$/, `文件名含不安全字符: ${name}`);
  assert.ok(name.includes('echo_data_plane_ok'), `空格应换成下划线: ${name}`);
});

test('台账文件名对 project_id 做文件名安全化', () => {
  const entry = {
    start_time: '2026-10-12T16:37:00.000Z',
    project_id: 'proj.a',
    line_id: 'line1_bulk',
    step_name: 'deg',
    task_id: '979bf26c-325e-4ec7-b8c3-7438b06afd10',
  };
  const name = buildLedgerFileName(entry);
  assert.match(name, /^[A-Za-z0-9._-]+\.json$/);
  assert.ok(name.includes('proj.a'), `项目段应保留: ${name}`);
});

test('落盘命令对远端路径整体加引号，元字符不会拆断重定向', () => {
  const entry = {
    start_time: '2026-10-12T16:37:00.000Z',
    line_id: 'line1_bulk',
    step_name: 'echo data_plane_ok',
    task_id: '979bf26c-325e-4ec7-b8c3-7438b06afd10',
  };
  const command = buildLedgerWriteCommand(entry).command;
  // 重定向目标必须整体在单引号里，不能出现裸露的 "> /path with space"
  assert.match(command, /> '\/mnt\/ssd\/bio_data\/system_logs\/[^']+'/, '重定向目标没加引号');
  assert.doesNotMatch(command, /> \//, '重定向目标裸露，空格会拆断');
  assert.match(command, /echo WROTE '/, 'WROTE 回显也没加引号');
});

// ───────────── S26 新增（只增不改）─────────────
// 背景（S18R §9 P0-2 + S26 对真 K40 复现）：旧版把 base64 payload 整段拼进
// `ssh k40-ubuntu '<command>'` 单行 argv，71 outputs 条目命令 9,114 字符，
// 实测 8,231 起被远端 shell 静默截断 → 半截 base64 照样 exit 0，无 WROTE 无文件，
// 台账静默丢失。修复后：payload 走 ssh stdin（无 argv 长度限制），远端回执
// `WROTE '<path>' <bytes>`，persistEntry 校验标记与字节数，缺一即 reject。

import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { persistEntry } from '../server/run.js';

/** 假 ssh 子进程垫片：stdin 收集到 finish 后回放 stdoutText 并按 exitCode 退出 */
function fakeSshChild({ stdoutText = '', exitCode = 0, onStdin }) {
  const child = new EventEmitter();
  const chunks = [];
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  child.stdin.on('finish', () => {
    onStdin?.(Buffer.concat(chunks).toString('utf8'));
    if (stdoutText) child.stdout.push(stdoutText);
    child.stdout.push(null);
    child.stderr.push(null);
    // exit 必须 setImmediate 落地：push 进 Readable 的 data 事件是异步投递，
    // 同步发 exit 会让 runSsh 在收 stdout 前就按空输出判成功/失败
    setImmediate(() => child.emit('exit', exitCode, null));
  });
  child.kill = () => child.emit('exit', exitCode, null);
  return child;
}

/** 71 outputs 的台账条目（S18R spatial_figures 同量级，正是被截断丢账的形态） */
function longEntry() {
  const outputs = Array.from({ length: 71 }, (_, i) =>
    `/mnt/ssd/bio_data/projects/default/line3_spatial/figures/l3_sp_${String(i + 1).padStart(2, '0')}_panel.png`);
  return buildLedgerEntry({
    projectId: 'default',
    lineId: 'line3_spatial',
    step: 'spatial_figures',
    seed: 20261013,
    inputs: [],
    outputs,
    status: 'completed',
    checkpointStatus: 'passed',
    exitCode: 0,
    startedAt: '2026-10-20T10:00:00Z',
    endedAt: '2026-10-20T10:05:00Z',
  });
}

test('S26: 长台账（71 outputs）payload 走 stdin，ssh argv 不含 payload', async (t) => {
  const entry = longEntry();
  const expectedBase64 = Buffer.from(JSON.stringify(entry, null, 2), 'utf8').toString('base64');
  const expectedBytes = Buffer.byteLength(JSON.stringify(entry, null, 2), 'utf8');
  const { command, remotePath } = buildLedgerWriteCommand(entry);
  // ssh argv 必须恒定短小（8231 起被远端 shell 静默截断），不随 outputs 数量增长
  assert.ok(command.length < 1024, `ssh argv 应恒定短小，实际 ${command.length} 字符`);
  assert.ok(!command.includes(expectedBase64.slice(0, 64)), 'argv 里不得出现 payload 片段');

  let spawnArgs = null;
  let stdinText = null;
  t.mock.method(childProcess, 'spawn', (cmd, args) => {
    spawnArgs = { cmd, args };
    return fakeSshChild({
      stdoutText: `WROTE '${remotePath}' ${expectedBytes}\n`,
      onStdin: (text) => { stdinText = text; },
    });
  });

  const result = await persistEntry(entry, 'line3_spatial');
  assert.equal(spawnArgs.cmd, 'ssh');
  assert.equal(spawnArgs.args.at(-1), command, '远端命令应作为最后一个 argv 原样下发');
  // payload 必须完整经 stdin 送达，一个字符都不能少
  assert.equal(stdinText, expectedBase64, 'stdin 应收到完整 base64 payload');
  assert.equal(result.path, remotePath);
  assert.match(result.output, /WROTE/);
});

test('S26: 远端未回 WROTE 标记 → persistEntry 必须 reject（不许静默成功）', async (t) => {
  const entry = longEntry();
  // 模拟截断后的形态：exit 0 但没有任何 WROTE 回执（S26 复现的真实症状）
  t.mock.method(childProcess, 'spawn', () => fakeSshChild({ stdoutText: 'base64: invalid input\n' }));
  await assert.rejects(() => persistEntry(entry, 'line3_spatial'), /WROTE/);
});

test('S26: 远端回执字节数与 payload 不符 → persistEntry 必须 reject（疑似半截写入）', async (t) => {
  const entry = longEntry();
  const { remotePath } = buildLedgerWriteCommand(entry);
  const trueBytes = Buffer.byteLength(JSON.stringify(entry, null, 2), 'utf8');
  t.mock.method(childProcess, 'spawn', () =>
    fakeSshChild({ stdoutText: `WROTE '${remotePath}' ${trueBytes - 100}\n` }));
  await assert.rejects(() => persistEntry(entry, 'line3_spatial'), /半截写入/);
});

test('S26: 千级 outputs 命令行仍恒定短小（修一类不修一个，不随 outputs 增长）', () => {
  const outputs = Array.from({ length: 1000 }, (_, i) =>
    `/mnt/ssd/bio_data/projects/default/line3_spatial/figures/l3_sp_${i}_panel.png`);
  const entry = buildLedgerEntry({
    projectId: 'default',
    lineId: 'line3_spatial',
    step: 'spatial_figures',
    seed: 20261013,
    inputs: [],
    outputs,
    status: 'completed',
    checkpointStatus: 'passed',
    exitCode: 0,
    startedAt: '2026-10-20T10:00:00Z',
    endedAt: '2026-10-20T10:05:00Z',
  });
  const { command } = buildLedgerWriteCommand(entry);
  assert.ok(command.length < 1024, `1000 outputs 时 ssh argv 仍应 < 1024 字符，实际 ${command.length}`);
});
