import test from 'node:test';
import assert from 'node:assert/strict';

import { checkDevice, checkForwards, checkLink } from '../server/link.js';
import { FORWARD_PAIRS } from '../server/domain.js';

test('设备探测：本机 adb 在位时应判 pass，且 detail 含序列号', () => {
  const result = checkDevice();
  assert.equal(result.pass, true, '链路应通；若此测试红，先查 adb 与 USB');
  assert.match(result.detail, /3a3e1f52/);
});

test('forward 探测：两条隧道都应在位（缺则脚本自动补）', () => {
  const result = checkForwards();
  assert.equal(result.pass, true, `forward 未在位: ${JSON.stringify(result.entries)}`);
  for (const entry of result.entries) {
    assert.equal(entry.pass, true);
    assert.ok(['在位', '已重建'].includes(entry.action));
  }
  // 形状：每条 forward 都要能说出用途，界面上直接展示
  assert.deepEqual(
    result.entries.map((entry) => entry.local),
    FORWARD_PAIRS.map((pair) => pair.local)
  );
});

test('四段自检：总体结论与各段明细都要有', () => {
  const result = checkLink();
  assert.equal(result.segments.length, 4);
  assert.deepEqual(
    result.segments.map((segment) => segment.name),
    ['设备在线', 'forward 在位', 'Termux 底座 sshd', '容器 sshd']
  );
  for (const segment of result.segments) {
    assert.equal(segment.pass, true, `段落失败：${segment.name} -> ${segment.detail || JSON.stringify(segment)}`);
  }
  // 服务表：四个 runit 服务都要在，且 log 子服务不 crash-loop
  assert.equal(result.services.length, 4);
  for (const service of result.services) {
    assert.equal(service.running, true, `${service.name} 未在运行: ${service.state}`);
    assert.equal(service.logCrashLoop, false, `${service.name} 的 log 子服务 crash-loop（坑#88 复发）`);
  }
  assert.equal(result.overall, 'pass');
});

test('服务状态能识别 log 子服务 crash-loop 的形态（不靠真故障，靠解析已知输出）', () => {
  // 这是 #88 的原始输出形态，解析逻辑必须能识别为 warn 而非笼统 fail
  const crashLoop = 'run: sshd: (pid 8991) 100s; down: log: 0s, normally up, want up';
  assert.equal(/down:\s*log/.test(crashLoop), true);
  assert.equal(/^run/.test(crashLoop), true, '主服务在 run，只有 log 子服务有问题');
});
