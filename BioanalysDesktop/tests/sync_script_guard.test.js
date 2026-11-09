/**
 * 同步脚本与进程接缝的防回归断言（静态）。
 *
 * 这些坑都是真机上真踩出来的，修法写在 workspace/handoff/SPEC_DECISIONS.md D-08/D-09 与
 * ledger/pitfalls_ledger.md P-04/P-07/P-08/P-09/P-10 里。本文件只做静态文本断言，
 * 不执行 PowerShell、不连远端，保证在任何机器上都能跑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC = path.join(ROOT, 'tools', 'ops', 'sync_and_verify_remote.ps1');
const PROC = path.join(ROOT, 'BioanalysDesktop', 'server', 'proc.js');

const syncText = fs.readFileSync(SYNC, 'utf8');
const procText = fs.readFileSync(PROC, 'utf8');

test('同步脚本存在且是 UTF-8 无 BOM（当前仓库铁律）', () => {
  const buf = fs.readFileSync(SYNC);
  assert.ok(buf.length > 3000, '同步脚本过短，可能被截断');
  assert.notDeepEqual(Array.from(buf.subarray(0, 3)), [0xef, 0xbb, 0xbf], '不应出现 UTF-8 BOM');
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

test('重构后默认同步面跟随 tools/ops 与 tools/reporting，不再读取已退场的 ops/', () => {
  assert.ok(syncText.includes("Get-ChildItem -Path 'tools/ops'"), '默认同步面没跟上 tools/ops');
  assert.ok(syncText.includes("Get-ChildItem -Path 'tools/reporting'"), '默认同步面没跟上 tools/reporting');
  assert.equal(syncText.includes("Get-ChildItem -Path 'ops'"), false, '仍在读取已退场的 ops/');
});

test('tools/ops 在远端拍平到 ops/，其余目录保持仓库相对路径', () => {
  assert.ok(syncText.includes('function Get-RemoteRel'), '缺仓库到远端路径映射函数');
  assert.ok(
    syncText.includes("if ($RelPath -like 'tools/ops/*') { return ('ops/' + $RelPath.Substring('tools/ops/'.Length)) }"),
    'tools/ops 没有拍平到远端 ops/',
  );
  assert.ok(syncText.includes('function Get-RemoteAbs'), '缺远端绝对路径构造');
  assert.ok(syncText.includes('$remoteRel = Get-RemoteRel $rel'), '预检没走路径映射');
  assert.ok(syncText.includes('$got = $after[(Get-RemoteRel $rel)]'), '对账没走路径映射');
});

test('桥接校验脚本保持远端 ops/ 运行时路径', () => {
  assert.ok(
    syncText.includes("if ($RelPath -eq 'tools/reporting/verify_bridge_checkpoint.py') { return 'ops/verify_bridge_checkpoint.py' }"),
    '桥接校验脚本没有映射回远端 ops/',
  );
});

test('同步脚本用 $PSScriptRoot 推导仓库根，-File 相对路径调用不会落到 tools/', () => {
  assert.ok(
    syncText.includes('$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)'),
    '仓库根必须用 $PSScriptRoot 推导',
  );
  assert.equal(
    syncText.includes('Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)'),
    false,
    '仍在用相对路径的 $MyInvocation.MyCommand.Path 推导仓库根',
  );
});

test('同步脚本把每次同步追加进 ledger/ops_ledger.md', () => {
  assert.ok(syncText.includes('ledger/ops_ledger.md'), '缺台账落点');
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

/** P3-03 已迁入 proc.js 接缝的模块。每迁一个切片就往这里加一行。 */
const SEAM_MIGRATED_MODULES = ['task.js', 'selfcheck.js', 'reconcile.js', 'report.js'];

test('P3-03 已迁移模块不得绕过 proc 接缝直接起子进程', () => {
  for (const name of SEAM_MIGRATED_MODULES) {
    const text = fs.readFileSync(path.join(ROOT, 'BioanalysDesktop', 'server', name), 'utf8');
    assert.ok(
      !/\bchildProcess\.(spawnSync|spawn)\(/.test(text),
      name + ' 仍在直接起子进程，BIO_COMPUTE_ADAPTER=mock 罩不住它'
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

test('.gitattributes 把所有 PowerShell 脚本钉成 LF', () => {
  const attrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8').split('\n');
  assert.ok(
    attrs.some((line) => /^\*\.ps1\s+text\s+eol=lf/.test(line)),
    '缺 *.ps1 text eol=lf 规则',
  );
});

test('同步脚本声明了三种退出码语义', () => {
  for (const code of ['exit 0', 'exit 1', 'exit 2']) {
    assert.ok(syncText.includes(code), '缺退出码约定：' + code);
  }
});
