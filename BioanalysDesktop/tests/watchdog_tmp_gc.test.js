/**
 * P-28 防回归：容器 /tmp 堆积是 proot 15 秒 abort 循环的根因，watchdog 必须周期清理。
 *
 * 背景（2026-10-22 实测）：容器 rootfs/tmp 堆积 873 项 / 4.9G，proot 的 --link2symlink
 * 在逐层解析这些路径时触发 path/path.c:546 compare_paths2 断言，造成
 * 严格 15 秒周期的 SIGABRT（共 514 次）。proot 容器没有 systemd，/tmp 永远不会自动清。
 * 规范依据：con_hf/pitfalls_ledger.md P-28。
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WATCHDOG = path.join(REPO, 'tools', 'ops', 'bio_watchdog.sh');
const TEXT = fs.readFileSync(WATCHDOG, 'utf8');
const NL = String.fromCharCode(10);
const codeLines = TEXT.split(NL).filter((l) => {
  const t = l.trim();
  return !t.startsWith('#');
});

test('P-28: watchdog 必须含容器 /tmp 清琏函数', () => {
  assert.match(TEXT, /CONTAINER_TMP=/, '必须定义 CONTAINER_TMP');
  assert.match(TEXT, /gc_container_tmp\(\)/, '必须定义 gc_container_tmp()');
  assert.match(TEXT, /proot-distro\/containers\/ubuntu\/rootfs\/tmp/,
    'CONTAINER_TMP 必须指向容器 rootfs 下的 tmp（不是 Termux 自己的 tmp）');
});

test('P-28: 清理只删 24 小时以前，且只删一层（不能动正在跑的任务）', () => {
  assert.match(TEXT, /-mmin \+1440/, '必须用 -mmin +1440（24 小时，粒度比 -mtime 细）');
  assert.match(TEXT, /-mindepth 1 -maxdepth 1/, '必须限一层，否则会把子目录里的活跃产物一起删掉');
  assert.match(TEXT, /-exec rm -rf \{\} \+/, '必须用 -exec rm -rf \{\} \+（批量，避免 xargs 的 123 退出码问题，P-21）');
});

test('P-28: 清理周期是 6 小时，且结果写日志', () => {
  assert.match(TEXT, /TMP_GC_EVERY=360/, '周期必须是 360 次循环（60s 一次 = 6 小时）');
  assert.match(TEXT, /tmp_gc_tick/, '必须有计数器，否则每分钟都执行会造成 IO 风暴');
  assert.match(TEXT, /container \/tmp GC/, '必须把清理结果写入 watchdog 日志（否则无法证明它在工作）');
});

test('P-28: 不能因为清理失败而影响其余 watchdog 职责', () => {
  // gc_container_tmp 内部所有可能失败的命令都必须 2>/dev/null 或 || true；
  // set -e 下一个失败就会让整个 watchdog 退出，服务自愈也就残了。
  const fn = TEXT.slice(TEXT.indexOf('gc_container_tmp()'), TEXT.indexOf('while true'));
  const risky = fn.split(NL).filter((l) => /find|rm|du/.test(l) && !l.trim().startsWith('#') && !/2>\/dev\/null|\|\|/.test(l));
  assert.deepEqual(risky, [], 'gc_container_tmp 里有未加防护的命令：' + NL + risky.join(NL));
});

test('P-28: watchdog 仍然 LF-only 且语法正确', () => {
  assert.equal(TEXT.includes(String.fromCharCode(13)), false, '不得出现 CRLF');
  assert.ok(TEXT.startsWith('#!'), '缺 shebang');
});
