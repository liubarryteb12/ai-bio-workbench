import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ENSURE = path.join(REPO, 'ops', 'k40', 'ensure_runsvdir.sh');
const SELFTEST = path.join(REPO, 'ops', 'k40', 'ensure_runsvdir_selftest.sh');

// ── ensure_runsvdir.sh 的静态契约（2026-11-03 事故后）──
//
// 事故形态（实测，2026-11-03 16:48）：自测脚本用 `SELFTEST_SOURCE_ONLY=1` + `. <脚本>`
// 加载函数，但守卫没挡住，破坏性主流程照跑，把 runsvdir 与全部 runsv 杀掉，8022 掉线，
// 只能靠 adb 进 Termux app 域手工点火救回。所以主流程必须整段留在 main() 里，任何
// 「加载即执行」的路径都不允许存在。
//
// 第二类失败（同轮实测）：端口探活读 /proc/net/tcp 在 Android app uid 恒 Permission denied，
// 于是 healthy() 永远为假，快判从不短路、每次调用都重建监督树。端口探活只能走 /dev/tcp。
//
// 第三类失败（同轮实测）：判据要求 argv 含 " -P <SVDIR>"，但 runsvdir 启动后会改写 argv、
// -P 被吃掉，健康实例被当成野生态（--status 报「实例数 0」而四服务全 run）。

const read = (p) => fs.readFileSync(p, 'utf8');
// 注释里的说明不算契约：剥掉整行注释再断言，避免「文档写了 = 代码有」的假绿
const codeOnly = (text) => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
// 取一个函数体的真实范围：从 "name() {" 到紧随其后的独占一行 "}"。
// 不能用固定窗口（+900 字符）——窗口会溢出到下一个函数，把邻居的代码算成自己的契约（实测假绿）。
const sliceFn = (code, name) => {
  const start = idx(code, name + '() {');
  const end = code.indexOf('\n}\n', start);
  assert.ok(end > start, name + ' 函数体缺少收尾的 }');
  return code.slice(start, end);
};
const idx = (text, needle, from = 0) => {
  const i = text.indexOf(needle, from);
  assert.ok(i >= 0, '缺片段：' + needle);
  return i;
};

test('主流程整段在 main() 内：source 加载不会触发任何点火或回收', () => {
  const text = read(ENSURE);
  const code = codeOnly(text);
  const mainDef = idx(code, 'main() {');
  const guard = idx(code, 'if [ "${SELFTEST_SOURCE_ONLY:-}" = 1 ]; then');
  const call = idx(code, 'main "$@"');
  assert.ok(mainDef < guard, '守卫必须排在 main() 定义之后（否则函数还没定义完就被 return 打断是另一种坑）');
  assert.ok(guard < call, '守卫必须在 main 调用之前');
  // 破坏性动作全部要在 main() 之后：这是「source 只加载函数」的机械证据
  for (const danger of ['setsid flock', 'kill -TERM "$pid"', 'rm -f "$SVDIR"/*/supervise/lock']) {
    assert.ok(idx(code, danger) > mainDef, danger + ' 必须落在 main() 之内');
  }
  const codeLines = code.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.equal(codeLines[codeLines.length - 1], 'main "$@"', 'main "$@" 必须是最后一个代码行');
  assert.equal((code.match(/^main "\$@"$/gm) || []).length, 1, 'main 只能被调用一次');
  // 退路：守卫行失效时也不能靠「加载后 return」的旧写法
  assert.ok(!/^\( return 0 2>\/dev\/null \) \|\| exit 0$/m.test(code), '不许退回旧的 source 守卫写法');
});

test('端口探活只走 /dev/tcp：/proc/net/tcp 在 app uid 恒不可读', () => {
  const code = codeOnly(read(ENSURE));
  assert.ok(!code.includes('/proc/net/tcp'), '代码里不许再出现 /proc/net/tcp（恒 Permission denied）');
  assert.ok(code.includes('port_listening() {'), '缺 port_listening 函数');
  assert.equal((code.match(/\/dev\/tcp\/127\.0\.0\.1\//g) || []).length, 2,
    '/dev/tcp 探活必须恰好两处：port_listening 与死人开关');
  // 死人开关的语义是「15 秒后仍无监听才裸起 sshd」，管道与 sshd 必须挂在同一条命令链上
  const deadman = code.split('\n').filter((l) => l.includes('sleep 15'))[0];
  assert.ok(deadman && deadman.includes('/dev/tcp/127.0.0.1/8022') && deadman.includes('$PREFIX/bin/sshd'),
    '死人开关必须在 /dev/tcp 探测失败后才起 sshd');
});

test('runsvdir 判据认三种形态：-P 监督、argv 改写后的监督、重复启动的野生态', () => {
  const code = codeOnly(read(ENSURE));
  assert.ok(code.includes('is_duplicated_runsvdir_argv() {'), '缺「argv 里 runsvdir 出现两次」判据');
  assert.ok(code.includes("case \"${first##*/}\" in runsvdir) return 0 ;; *) return 1 ;; esac"),
    '野生态判据必须看第二个 token 的基名是否为 runsvdir');
  assert.ok(code.includes("supervises_svdir() {"), '缺 SVDIR 归属判据');
  const classify = code.slice(idx(code, 'classify_runsvdir_argv() {'), idx(code, 'count_supervising_runsvdir() {'));
  assert.ok(classify.includes('echo other'), '非 runsvdir 进程必须归为 other');
  assert.ok(classify.includes('echo stray'), '分类器必须能给出 stray');
  assert.ok(classify.includes('echo supervising'), '分类器必须能给出 supervising');
  // 三个计数器必须同源：任一直接判 supervises_svdir 就会把野生态算成监督实例
  for (const fn of ['count_supervising_runsvdir', 'count_stray_runsvdir', 'stray_pids']) {
    assert.ok(sliceFn(code, fn).includes('classify_runsvdir_argv'), fn + ' 必须复用 classify_runsvdir_argv');
  }
  assert.ok(sliceFn(code, 'count_supervising_runsvdir').includes('= supervising ] || continue'),
    '监督计数必须按 classify 的 supervising 判定');
  assert.ok(sliceFn(code, 'count_stray_runsvdir').includes('= stray ] || continue'),
    '野生态计数必须按 classify 的 stray 判定');
});

test('healthy() 只认同一个监督实例 + 8022 在听 + 容器面在 run，野生态不影响判定', () => {
  const code = codeOnly(read(ENSURE));
  const body = code.slice(idx(code, 'healthy() {'), idx(code, 'main() {'));
  assert.ok(body.includes('count_supervising_runsvdir'), 'healthy 必须按监督实例判定');
  assert.ok(!/count_runsvdir\b/.test(body), 'healthy 不能把野生态算进来');
  assert.ok(!body.includes('count_stray_runsvdir'), '野生态不该让 healthy 判假（它不影响链路）');
  assert.ok(body.includes('port_listening 8022'), 'healthy 必须探 8022');
  assert.ok(body.includes('ubuntu-sshd'), 'healthy 必须要求容器面在 run');
  assert.ok(!/pkill/.test(code), '脚本不许出现 pkill（会杀掉承载会话的 sshd）');
  assert.ok(!/rm -rf .*supervise/.test(code), 'supervise 目录不能删（mkfifo 在 run-as 域建不回来）');
});

test('自身 pid 守卫与 --reap-stray 整词匹配', () => {
  const code = codeOnly(read(ENSURE));
  assert.ok(code.includes('[ "$pid" = "$$" ] && continue'), '缺自身 pid 守卫');
  assert.ok(!code.includes('$$$'), '不许再出现三美元自比较（永不相等，守卫形同虚设）');
  // 静态断言若用 grep '--reap-stray' 会命中 --reap-strayX（实测假绿），所以这里钉整词：
  assert.ok(code.includes("[ \"${1:-}\" = '--reap-stray' ]"), '--reap-stray 必须整词比较');
  const reap = code.slice(idx(code, "[ \"${1:-}\" = '--reap-stray' ]"));
  assert.ok(reap.includes('kill -TERM "$pid"') && reap.includes('kill -KILL "$pid"'),
    '回收野生态必须先 TERM 后 KILL');
});

test('自测脚本存在且带哨兵、临时目录、mktemp 判红', () => {
  assert.ok(fs.existsSync(SELFTEST), 'ops/k40/ensure_runsvdir_selftest.sh 缺失');
  const text = read(SELFTEST);
  assert.ok(text.includes('SELFTEST_PASS ok='), '缺带计数的成功哨兵');
  assert.ok(text.includes('SELFTEST_FAIL'), '缺失败哨兵');
  assert.ok(text.includes('SELFTEST_SOURCE_ONLY=1'), '自测必须以只加载模式 source');
  for (const s of ['setsid', 'flock', 'sshd']) {
    assert.ok(text.includes('sentinel_' + s), '缺哨兵 shim：' + s);
  }
  assert.ok(text.includes('mktemp -d'), '自测必须用临时目录');
  assert.ok(text.includes('mktemp -d 不可用'), 'mktemp 失败必须判红，不许降级到固定路径');
  assert.ok(text.includes('PROC_DIR='), '自测必须把 PROC_DIR 指向 fixture');
});