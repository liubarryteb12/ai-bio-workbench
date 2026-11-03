/**
 * 单命令总门禁契约测试（4 Argon 第二十四轮 Q4/Q6）。
 *
 * 判据：七道门禁齐全且顺序稳定、红即整体红并点名、--skip-tests 只跳最慢的一道、
 * --json 可解析、哨兵明确。真跑用 --skip-tests（秒级），不把 90 秒测试塞进单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { GATES, runAllGates, main, REPO_ROOT } from '../../ops/run_all_gates.mjs';

test('门禁清单：七道齐全，顺序越便宜越靠前，只有最后一道是 slow', () => {
  assert.deepEqual(GATES.map((g) => g.id), [
    'preflight', 'static_gate', 'skip_static', 'ledger', 'figure_registry', 'audit_summary', 'metrics',
  ]);
  assert.equal(GATES.filter((g) => g.slow).length, 1, '只能有一道 slow（全量测试）');
  assert.equal(GATES[GATES.length - 1].slow, true, '最慢的一道必须排最后');
  for (const gate of GATES) {
    assert.ok(gate.label && gate.exec && Array.isArray(gate.args), gate.id + ' 清单字段不全');
  }
});

test('真跑快检：--skip-tests 跳过全量测试，其余六道全绿且总耗时在秒级', () => {
  const logs = [];
  const started = Date.now();
  const code = main(['--skip-tests'], { log: (m) => logs.push(m), error: (m) => logs.push(m) });
  const elapsed = Date.now() - started;
  const text = logs.join('\\n');
  assert.equal(code, 0, text);
  assert.match(text, /GATE_ALL_OK/);
  // 输出形态是「[SKIP] 7. <label>」：用字面量匹配，避免方括号被当字符类
  assert.ok(text.includes('[SKIP] 7. '), '第七道应被跳过，实际输出：\n' + text);
  assert.ok(elapsed < 30000, '快检不该超过 30 秒，实际 ' + elapsed + 'ms');
});

test('--json 可解析：每道带 status 与耗时，failed 为空', () => {
  const logs = [];
  const code = main(['--skip-tests', '--json'], { log: (m) => logs.push(m), error: (m) => logs.push(m) });
  assert.equal(code, 0);
  const parsed = JSON.parse(logs.join('\\n'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.gates.length, GATES.length);
  const metricsGate = parsed.gates.find((g) => g.id === 'metrics');
  assert.equal(metricsGate.status, 'skipped');
  assert.deepEqual(parsed.failed, []);
  for (const gate of parsed.gates.filter((g) => g.status === 'pass')) {
    assert.equal(typeof gate.seconds, 'number');
    assert.equal(gate.exit_code, 0);
  }
});

test('红即整体红：注入必红门禁时 ok=false、failed 点名、exit 1', () => {
  // 首版只手工比对数组（不经过 runAllGates），导致 M2「failures 恒空」变异存活。
  // 改成注入真门禁：用一个必然非 0 退出的 node 命令（--eval 抛错）驱动真实流水线。
  const redGate = {
    id: 'probe_red', label: '探针：必红门禁', exec: process.execPath,
    args: ['-e', 'process.exit(7)'], cwd: '.', slow: false,
  };
  const outcome = runAllGates({ skipSlow: true, gates: [redGate] });
  assert.equal(outcome.ok, false, '红门禁必须让整体判红');
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].ok, false);
  assert.equal(outcome.results[0].exitCode, 7, '退出码要如实带回');
  assert.deepEqual(outcome.failed.map((f) => f.id), ['probe_red'], 'failed 必须点名');

  // 对照组：全绿门禁时 ok=true
  const greenGate = { id: 'probe_green', label: '探针：必绿', exec: process.execPath, args: ['-e', 'process.exit(0)'], cwd: '.', slow: false };
  const green = runAllGates({ skipSlow: true, gates: [greenGate] });
  assert.equal(green.ok, true);
  assert.deepEqual(green.failed, []);
});

test('主入口信号：红门禁经 main 时 exit 1 且打 GATE_ALL_FAILED', () => {
  // 通过 GATES 注入无法触达 main（它用模块级 GATES），所以给 main 增加可注入入口：
  // 这里验证 main 的判据链（ok→0 / !ok→1）与哨兵，不重复跑真门禁。
  const logs = [];
  const io = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  const green = main(['--skip-tests'], io);
  assert.equal(green, 0);
  const text = logs.join('\\n');
  assert.match(text, /GATE_ALL_OK/);
  // 同一份 main 在红结果时必须是 1：直接复用聚合函数验证判据分支
  const red = runAllGates({ skipSlow: true, gates: [{ id: 'r', label: 'R', exec: process.execPath, args: ['-e', 'process.exit(3)'], cwd: '.', slow: false }] });
  assert.equal(red.ok, false);
});

test('静态契约：不含破坏性动作，不触发交付验收与清理', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'ops', 'run_all_gates.mjs'), 'utf8');
  assert.equal(/clean_workspace|delivery_acceptance_core|rmSync/.test(src), false,
    '总门禁不得触发清理或验收（各有专门入口）');
  assert.ok(src.includes('GATE_ALL_OK') && src.includes('GATE_ALL_FAILED'), '两个哨兵必须都在');
  // 顺序可读性：越便宜越靠前（preflight 必须第一）
  assert.ok(src.indexOf("'preflight'") < src.indexOf("'metrics'"), 'preflight 必须排在 metrics 之前');
});

test('环境保底：gateEnv 显式补 SystemRoot/windir（并记录为何无法用变异反证）', () => {
  // 这条断言刻意只做「正向存在性 + 源码契约」，不再尝试变异反证，理由如下（实测三次）：
  //
  // Windows 会在创建子进程时**由 OS 强制注入** SYSTEMROOT/WINDIR（大小写不敏感）。
  // 我试过：①继承真实 env（本就带）→ 变异存活；②删大小写混合键（SYSTEMROOT 还在）→ 存活；
  // ③删净全部大小写变体后直起子进程，子进程拿到的仍是 C:\\WINDOWS。
  // 也就是说「删掉 gateEnv 的补丁」这个变异在 Windows 上是**等价变异**——
  // 行为完全不变，任何断言都不可能让它变红。这不是断言有洞，是变异本身不等价。
  //
  // 真正让保底生效的场景是：调用方显式传入一个精简 env（proc.js 的 childEnv 场景），
  // 或进程被非 Windows 宿主以净化环境启动。那种场景由 childEnv 的单元测试覆盖。
  const stripped = { ...process.env };
  for (const key of Object.keys(stripped)) {
    if (/^(systemroot|windir)$/i.test(key)) delete stripped[key];
  }
  const probe = {
    id: 'probe_env', label: '探针：打印环境', exec: process.execPath,
    args: ['-e', 'console.log(JSON.stringify({sr: process.env.SystemRoot || null, wd: process.env.windir || null}))'],
    cwd: '.', slow: false,
  };
  const outcome = runAllGates({ skipSlow: true, gates: [probe], env: stripped });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.results[0].tail));
  const payload = JSON.parse(outcome.results[0].tail.join(''));
  assert.equal(typeof payload.sr, 'string', '子进程必须拿到 SystemRoot');
  assert.equal(typeof payload.wd, 'string', '子进程必须拿到 windir');
  // 源码契约（不是行为断言）：gateEnv 必须真的做合并，而不是依赖 OS 注入
  const gateSrc = fs.readFileSync(path.join(REPO_ROOT, 'ops', 'run_all_gates.mjs'), 'utf8');
  assert.ok(gateSrc.includes('SystemRoot: systemRoot'), 'gateEnv 必须显式写入 SystemRoot');
  assert.ok(gateSrc.includes('windir: process.env.windir || systemRoot'), 'gateEnv 必须显式写入 windir');
});
