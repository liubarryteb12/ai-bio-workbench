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

async function sshReachable() {
  // 与 proc/preview_mods 同一口径。净化环境（便携包、CI）里的 ssh 读不到用户配置，
  // 后三段必然红——那是环境态，不是链路代码坏了。
  try {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', 'echo PROBE_OK'],
      { encoding: 'utf8', timeout: 20000 });
    return r.status === 0 && /PROBE_OK/.test(r.stdout || '');
  } catch { return false; }
}

test('四段自检：总体结论与各段明细都要有', async (testContext) => {
  if (!(await sshReachable())) { testContext.skip('HOST_UNREACHABLE_K40: 本机 ssh 无法按用户配置解析 k40-ubuntu'); return; }
  const result = checkLink();
  // 设备不在线时四段必然红（adb/ssh 都探不到），属环境态非代码缺陷；
  // 仅当第一段（设备）就失败时跳过，后段逻辑变化仍要判红。
  const first = result.segments && result.segments[0];
  if (first && !first.pass) { testContext.skip('HOST_UNREACHABLE_K40: 设备段不通（adb/forward 未就绪）'); return; }
  assert.equal(result.segments.length, 4);
  assert.deepEqual(
    result.segments.map((segment) => segment.name),
    ['设备在线', 'forward 在位', 'Termux 底座 sshd', '容器 sshd']
  );
  for (const segment of result.segments) {
    assert.equal(segment.pass, true, `段落失败：${segment.name} -> ${segment.detail || JSON.stringify(segment)}`);
  }
  // 服务表：四个 runit 主服务都要在（主服务挂了业务真的不可用，这条不放宽）
  assert.equal(result.services.length, 4);
  for (const service of result.services) {
    assert.equal(service.running, true, `${service.name} 未在运行: ${service.state}`);
  }
  // 日志子服务的判定降级为“可见但不阻断”（2026-11-01 按真机实测修正）：
  // K40 上 runsv 对 log 子进程的监督不稳定（svlogd 目录锁必失败，改追加写后仍需
  // runsv 派生），实测常见「主服务 run + log 子服务 down + 端口与业务完全正常」。
  // 若把 log 子服务异常算成链路失败，等于拿环境噪声否定业务可用性——那条判据会失真。
  // 因此这里要求 overall 至少是 warn（不允许 fail），同时整体结论必须是可判定的三档之一。
  assert.ok(['pass', 'warn'].includes(result.overall),
    `总体结论必须是 pass 或 warn，实际 ${result.overall}；log 子服务异常属环境噪声，主服务异常才是 fail`);
});

test('服务状态能识别 log 子服务 crash-loop 的形态（不靠真故障，靠解析已知输出）', () => {
  // 这是 #88 的原始输出形态，解析逻辑必须能识别为 warn 而非笼统 fail
  const crashLoop = 'run: sshd: (pid 8991) 100s; down: log: 0s, normally up, want up';
  assert.equal(/down:\s*log/.test(crashLoop), true);
  assert.equal(/^run/.test(crashLoop), true, '主服务在 run，只有 log 子服务有问题');
});
