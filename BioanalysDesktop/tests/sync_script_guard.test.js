/**
 * 同步脚本与进程接缝的防回归断言（静态）。
 *
 * 这些坑都是真机上真踩出来的，修法写在 con_hf/SPEC_DECISIONS.md D-08/D-09 与
 * con_hf/pitfalls_ledger.md P-04/P-07/P-08/P-09/P-10 里。本文件只做静态文本断言，
 * 不执行 PowerShell、不连远端，保证在任何机器上都能跑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC = path.join(ROOT, 'ops', 'sync_and_verify_remote.ps1');
const PROC = path.join(ROOT, 'BioanalysDesktop', 'server', 'proc.js');

const syncText = fs.readFileSync(SYNC, 'utf8');
const procText = fs.readFileSync(PROC, 'utf8');

test('同步脚本存在且是 UTF-8 with BOM（中文 .ps1 铁律）', () => {
  const buf = fs.readFileSync(SYNC);
  assert.ok(buf.length > 3000, '同步脚本过短，可能被截断');
  assert.equal(buf[0], 0xef, '缺 UTF-8 BOM 第 1 字节');
  assert.equal(buf[1], 0xbb, '缺 UTF-8 BOM 第 2 字节');
  assert.equal(buf[2], 0xbf, '缺 UTF-8 BOM 第 3 字节');
});

test('同步脚本自身只用 LF（避免 CRLF 进 git 与远端）', () => {
  assert.equal(syncText.includes('\r\n'), false, '同步脚本出现 CRLF');
});

test('P-08 远端哈希清单必须先 printf 再管道给 xargs', () => {
  const sumLine = syncText.split('\n').find((line) => line.includes('xargs sha256sum'));
  assert.ok(sumLine, '找不到 xargs sha256sum 那一行');
  assert.ok(sumLine.includes('printf'), 'sumCmd 没用 printf 喂路径，shell 会去执行这些脚本');
  // 正解形态：printf '%s\\n' <引号路径清单> | xargs sha256sum
  assert.ok(
    sumLine.includes('[char]92'),
    'printf 的换行必须用 [char]92 拼，JS 模板串会吃掉反引号'
  );
  assert.ok(
    sumLine.indexOf('printf') < sumLine.indexOf('xargs sha256sum'),
    'printf 必须在 xargs 之前，否则 shell 会去执行路径本身'
  );
});

test('P-09 scp 之后必须归一化权限（.sh 755 / 其余 644）', () => {
  assert.ok(syncText.includes('chmod 755'), '缺 .sh 的 chmod 755');
  assert.ok(syncText.includes('chmod 644'), '缺其余文件的 chmod 644');
  const scpIdx = syncText.indexOf('scp -q');
  const chmodIdx = syncText.indexOf('chmod 755');
  assert.ok(scpIdx > 0 && chmodIdx > scpIdx, 'chmod 必须排在 scp 之后');
});

test('P-04 远端调用必须过滤 ssh 的 known_hosts 提示', () => {
  assert.ok(
    syncText.includes('Warning: Permanently added'),
    'Invoke-Remote 没有过滤 Warning 行'
  );
  const invoke = syncText.slice(syncText.indexOf('function Invoke-Remote'));
  assert.ok(
    invoke.slice(0, 800).includes('notmatch'),
    '过滤必须写在 Invoke-Remote 内部，否则每个调用点都要自己防'
  );
});

test('P-10 镜像哈希校验复用逐行解析，不许整段锚定正则', () => {
  const mirror = syncText.slice(syncText.indexOf('$mirrorOk'), syncText.indexOf('$stamp'));
  assert.ok(mirror.includes('Read-RemoteHashes'), '镜像校验没复用 Read-RemoteHashes');
  assert.ok(
    !/\$mirrorHash -match/.test(mirror),
    '镜像校验仍在用整段文本锚定正则（会被 Warning 行顶掉）'
  );
});

test('同步脚本保留 LF 校验与远端预检两个前置步骤', () => {
  assert.ok(syncText.includes('Test-LfOnly'), '缺 LF 校验函数');
  assert.ok(syncText.includes('Test-LfOnly -RelPath'), 'LF 校验函数没被调用');
  assert.ok(syncText.includes('[PRE ]'), '缺远端预检输出（先比后传才能发现漂移）');
});

test('同步脚本把每次同步追加进 con_hf/ops_ledger.md', () => {
  assert.ok(syncText.includes('con_hf/ops_ledger.md'), '缺台账落点');
  assert.ok(
    syncText.includes('AppendAllText') || syncText.includes('Add-Content'),
    '台账不是追加写'
  );
});

test('P-07 进程接缝必须默认导入 child_process', () => {
  assert.ok(
    !/import\s*\{[^}]*\}\s*from\s*'node:child_process'/.test(procText),
    'proc.js 又用具名导入了，测试垫片会再次失效并真连远端'
  );
  assert.ok(
    /import\s+childProcess\s+from\s+'node:child_process'/.test(procText),
    'proc.js 缺默认导入 child_process'
  );
  assert.ok(procText.includes('childProcess.spawnSync('), 'runSync 没用 childProcess.spawnSync');
  assert.ok(procText.includes('childProcess.spawn('), 'runStream 没用 childProcess.spawn');
});

test('P-07 其它 server 模块也不许具名导入 child_process', () => {
  const dir = path.join(ROOT, 'BioanalysDesktop', 'server');
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(
      !/import\s*\{[^}]*\}\s*from\s*'node:child_process'/.test(text),
      name + ' 用了具名导入 child_process，测试垫片会失效'
    );
  }
});

test('P-07 所有用 childProcess 垫片的测试文件都走默认导入', () => {
  const dir = path.join(ROOT, 'BioanalysDesktop', 'tests');
  let shimFiles = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.test.js')) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    if (!/mock\.method\(\s*childProcess/.test(text)) continue;
    shimFiles += 1;
    assert.ok(
      /import\s+childProcess\s+from\s+'node:child_process'/.test(text),
      name + ' 用 childProcess 垫片但没默认导入，垫片拦不住真实 spawn'
    );
  }
  assert.ok(shimFiles >= 5, '垫片文件数异常偏少：' + shimFiles);
});

test('.gitattributes 把同步脚本钉成 LF，且规则排在 *.ps1 之后', () => {
  // 没有这条，fresh clone 时 *.ps1 text eol=crlf 会把脚本 checkout 成 CRLF，
  // 上一条断言在别人的机器上必红（而本机恰好是 LF，最容易漏）。
  const attrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8').split('\n');
  const ps1At = attrs.findIndex((line) => /^\*\.ps1\s+text\s+eol=crlf/.test(line));
  const pinAt = attrs.findIndex((line) =>
    /^ops\/sync_and_verify_remote\.ps1\s+text\s+eol=lf/.test(line)
  );
  assert.ok(ps1At >= 0, '缺 *.ps1 eol=crlf 规则');
  assert.ok(pinAt >= 0, '缺 ops/sync_and_verify_remote.ps1 eol=lf 例外规则');
  assert.ok(pinAt > ps1At, '例外规则必须排在 *.ps1 之后，否则被后面的规则覆盖');
});

test('同步脚本声明了三种退出码语义', () => {
  for (const code of ['exit 0', 'exit 1', 'exit 2']) {
    assert.ok(syncText.includes(code), '缺退出码约定：' + code);
  }
});
