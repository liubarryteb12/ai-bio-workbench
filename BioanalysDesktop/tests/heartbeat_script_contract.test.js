import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// ── tools/ops/k40/heartbeat.sh 设备侧脚本契约（2026-11-03）──
//
// 这条脚本跑在 K40 上，Windows 侧测不了它的运行结果，但它的两条判据都踩过假红/假绿：
//   1. runsvdir 计数只认 ' -P <SVDIR>' 子串：健康设备上 runsvdir 会改写 argv 把 -P 去掉，
//      于是数到 0、整盏灯报 ERR_STAGE_RUNSV（2026-11-03 实测，端口与服务其实全好）。
//   2. supervise/stat 只截逗号前一段：'run, got TERM, want down' 会被洗成正常的 run，
//      恰好掩盖「sv down 请求被 proot 吞掉、进程不走」。
// 所以这里钉的是判据形态，不是逐行快照。

const SOURCE = new URL('../../tools/ops/k40/heartbeat.sh', import.meta.url);

async function code() {
  const raw = await readFile(SOURCE, 'utf8');
  // 只留代码行：注释里同样会出现 ' -P ' 与 want down 这些字面量，混进来会造出假绿
  return raw.split(/\r?\n/).filter((line) => !line.trim().startsWith('#')).join('\n');
}

test('设备侧脚本：shebang 用 Termux 绝对路径、set -eu、不经 ssh', async () => {
  const raw = await readFile(SOURCE, 'utf8');
  assert.ok(raw.startsWith('#!/data/data/com.termux/files/usr/bin/sh'), 'shebang 必须是 Termux sh 绝对路径');
  assert.match(raw, /^set -eu$/m);
  // 注释里会提到 ssh（解释为什么不用它），只在代码行上断言
  const src = await code();
  assert.equal(src.includes('ssh '), false, '这条通道的存在理由就是不依赖 ssh');
});

test('runsvdir 计数认两种真实 argv 形态，且不靠整行子串匹配', async () => {
  const src = await code();
  assert.equal(src.includes('index($0, " -P " sv)'), false, '整行子串匹配会在 argv 被改写时数到 0');
  assert.ok(src.includes('$2 == "runsvdir" || $2 ~ /\\/bin\\/runsvdir$/'), '命令名要认基名与完整路径两种形态');
  assert.ok(src.includes('$3 == "-P" && $4 == sv'), '未改写形态：-P <SVDIR>');
  assert.ok(src.includes('$3 == sv'), '已改写形态：argv 里只剩 <SVDIR>');
  assert.ok(src.includes('if ($3 ~ /\\/runsvdir$/) next'), '野生态（argv0 被复制）必须跳过，否则会数成 2');
});

test('svc_stat 把 want down 归一化成 down_pending，want up 仍按 run 算', async () => {
  const src = await code();
  assert.ok(src.includes('*"want down"*) first=down_pending'), 'TERM 被吞时不得报成正常 run');
  assert.equal(src.includes('want up'), false, '重启过程中的 want up 不能降级成异常');
  // 逗号截断仍要保留：stat 的主体状态在逗号前
  assert.ok(src.includes('first="${state%%,*}"'), '逗号前那一段才是当前状态');
});

test('输出行是 schema v2、十个字段齐全，--write 走临时文件再 mv 的原子写', async () => {
  const src = await code();
  for (const field of ['"schema":"k40_heartbeat/v2"', '"runsvdir_count"', '"sshd_8022_listen"',
    '"dropbear_10022_listen"', '"ssd_writable"', '"svc_sshd"', '"svc_ubuntu_sshd"', '"svc_crond"', '"svc_ssh_agent"']) {
    assert.ok(src.includes(field), '缺字段 ' + field);
  }
  assert.ok(src.includes('> "$tmp"'), '先写临时文件');
  assert.ok(src.includes('mv -f "$tmp" "$LOG_PATH"'), '再原子替换');
  assert.equal(/rm -f|sv restart|sv up|sv down/.test(src), false, '设备侧只记录，绝不自己重启服务');
});