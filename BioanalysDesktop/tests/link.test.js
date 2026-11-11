/**
 * ADB 单通道链路探测契约（2026-11-11 P-29 收口）。
 *
 * 旧的四段自检会直连 sshd、重建 forward、逐台查 host key，均属算力端
 * abort 冲突源。这里只验证兼容导出与返回形状，不发起任何 SSH 连接。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkDevice, checkForwards, checkServices, checkTermux, checkLink, resolveLinkOverall } from '../server/link.js';

test('端口转发与服务探活已封存，保留兼容返回形状', () => {
  const forwards = checkForwards();
  assert.equal(forwards.pass, true);
  assert.deepEqual(forwards.entries, []);
  assert.equal(checkServices().services.length, 0);
  assert.match(checkTermux().detail, /P-29/);
});

test('总体结论判定保持三档，且硬失败优先', () => {
  assert.equal(resolveLinkOverall({ hardFail: true, serviceDown: false, logCrash: false, hostkeyCode: null }), 'fail');
  assert.equal(resolveLinkOverall({ hardFail: false, serviceDown: true, logCrash: false, hostkeyCode: null }), 'fail');
  assert.equal(resolveLinkOverall({ hardFail: false, serviceDown: false, logCrash: true, hostkeyCode: null }), 'warn');
  assert.equal(resolveLinkOverall({ hardFail: false, serviceDown: false, logCrash: false, hostkeyCode: 'X' }), 'warn');
  assert.equal(resolveLinkOverall({ hardFail: false, serviceDown: false, logCrash: false, hostkeyCode: null }), 'pass');
});

test('设备探测返回形状稳定（不依赖真机）', () => {
  const result = checkDevice('adb', 'SERIAL_TEST');
  assert.equal(typeof result.pass, 'boolean');
  assert.equal(typeof result.detail, 'string');
});

test('checkLink 只暴露两段 ADB 判据与封存标记', () => {
  const result = checkLink();
  assert.deepEqual(result.segments.map((segment) => segment.name), ['设备在线', 'ADB 容器内执行']);
  assert.deepEqual(result.services, []);
  assert.equal(result.hostkeys.code, 'SSH_RETIRED');
});
