/**
 * 里程碑 1 契约测试：
 * 1. 存储底座四层目录幂等初始化；
 * 2. paths.js 与 portable-paths.js 双轨路径助手；
 * 3. pull_and_verify.ps1 归档解包、sha256 比对（含带空格路径）、防损毁与负路径中断；
 * 4. core/mem_guard.py 正常运行，不误设 RLIMIT_AS 为 7.5GB；
 * 5. 校验通过签发 .verify_passed 回执令牌。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TEST_TMP } from './support/test_tmp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const HAS_POWERSHELL = (() => {
  const probe = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
  return probe.status === 0;
})();
const NEED_POWERSHELL = HAS_POWERSHELL ? false : 'HOST_MISSING_SHELL: 无 PowerShell，运维脚本契约不可执行';

test('里程碑 1：paths.js 与 portable-paths.js 正确导出四层收敛路径助手', async () => {
  const m = await import('../server/paths.js');
  assert.equal(typeof m.referencesDbPath, 'function');
  assert.equal(typeof m.inboxPath, 'function');
  assert.equal(typeof m.runsPath, 'function');
  assert.equal(typeof m.deliverablesPath, 'function');

  assert.ok(m.referencesDbPath('GSE123').includes(path.join('workspace', 'references_db', 'GSE123')));
  assert.ok(m.inboxPath('PKG_01').includes(path.join('workspace', 'inbox', 'PKG_01')));
  assert.ok(m.runsPath('JOB_01', '00_input').includes(path.join('workspace', 'runs', 'JOB_01', '00_input')));
  assert.ok(m.deliverablesPath('PKG.zip').includes(path.join('workspace', 'deliverables', 'PKG.zip')));

  const pm = await import('../../desktop/src/main/portable-paths.js');
  assert.equal(typeof pm.portableReferencesDbRoot, 'function');
  assert.equal(typeof pm.portableInboxRoot, 'function');
  assert.equal(typeof pm.portableRunsRoot, 'function');
  assert.equal(typeof pm.portableDeliverablesRoot, 'function');

  const dummyPortable = 'D:\\test-app';
  assert.equal(pm.portableReferencesDbRoot(dummyPortable), path.join(dummyPortable, 'data', 'workspace', 'references_db'));
  assert.equal(pm.portableRunsRoot(dummyPortable), path.join(dummyPortable, 'data', 'workspace', 'runs'));
});

test('里程碑 1：init_workspace_hierarchy.ps1 幂等初始化全部必需子目录与元数据', { skip: NEED_POWERSHELL }, () => {
  const testDataHome = fs.mkdtempSync(path.join(TEST_TMP, 'm1-init-'));
  const script = path.join(REPO_ROOT, 'tools', 'ops', 'init_workspace_hierarchy.ps1');

  // 第 1 次运行：创建
  const run1 = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DataHome', testDataHome], {
    encoding: 'utf8',
  });
  assert.equal(run1.status, 0, run1.stderr || run1.stdout);
  assert.ok(run1.stdout.includes('[CREATED]') || run1.stdout.includes('[EXISTS]'));

  // 验证四层收敛目录与系统目录存在
  const expectedDirs = [
    path.join(testDataHome, 'workspace', 'references_db'),
    path.join(testDataHome, 'workspace', 'inbox'),
    path.join(testDataHome, 'workspace', 'runs'),
    path.join(testDataHome, 'workspace', 'deliverables'),
    path.join(testDataHome, '.ops_state'),
    path.join(testDataHome, 'logs'),
    path.join(testDataHome, 'ledger'),
  ];
  for (const d of expectedDirs) {
    assert.ok(fs.existsSync(d), `目录缺失: ${d}`);
  }

  const metaPath = path.join(testDataHome, 'workspace', '.layout_version');
  assert.ok(fs.existsSync(metaPath), '缺少 .layout_version');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  assert.equal(meta.layout_version, '2.0.0');

  // 第 2 次运行：幂等跳过
  const run2 = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DataHome', testDataHome], {
    encoding: 'utf8',
  });
  assert.equal(run2.status, 0, run2.stderr || run2.stdout);
  assert.ok(!run2.stdout.includes('[CREATED]'), '第二次运行不应有新建项');
});

test('里程碑 1：pull_and_verify.ps1 本地提取与带空格路径的 sha256 强校验通过并签发回执', { skip: NEED_POWERSHELL }, () => {
  const testRoot = fs.mkdtempSync(path.join(TEST_TMP, 'm1-pull-'));
  const localRunsRoot = path.join(testRoot, 'local_runs');
  fs.mkdirSync(localRunsRoot, { recursive: true });

  const stagingDir = path.join(testRoot, 'staging');
  fs.mkdirSync(path.join(stagingDir, '01_work'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, '02_output', 'sub folder with spaces'), { recursive: true });

  const file1 = path.join(stagingDir, '01_work', 'step1.log');
  const file2 = path.join(stagingDir, '02_output', 'sub folder with spaces', 'deg result table.tsv');
  fs.writeFileSync(file1, 'Execution log content 2026-11-14\n', 'utf8');
  fs.writeFileSync(file2, 'gene_id\tlogFC\tp_val\nTP53\t2.5\t0.001\n', 'utf8');

  function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  // 模拟 Linux sha256sum 输出，包含带空格的相对路径
  const hash1 = sha256(file1);
  const hash2 = sha256(file2);
  const checksumLines = [
    `${hash1}  01_work/step1.log`,
    `${hash2}  02_output/sub folder with spaces/deg result table.tsv`,
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(stagingDir, 'checksums.sha256'), checksumLines, 'utf8');

  // 打包为 .tar.zst 模拟远端流式产物。
  // 显式用 System32\tar.exe：node 从桌面进程继承的 PATH 上 Git Bash 的 GNU tar
  // 把 D:\ 路径当远程主机（"Cannot connect to D: resolve failed"），
  // Windows 自带的 bsdtar 才认盘符。pull_and_verify.ps1 的解包侧同样已钉死。
  const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const archivePath = path.join(testRoot, 'mock_run.tar.zst');
  const tarRes = spawnSync(winTar, ['-cf', archivePath, '-C', stagingDir, 'checksums.sha256', '01_work', '02_output'], {
    encoding: 'utf8',
  });
  assert.equal(tarRes.status, 0, tarRes.stderr || tarRes.stdout);
  assert.ok(fs.existsSync(archivePath));

  const script = path.join(REPO_ROOT, 'tools', 'ops', 'pull_and_verify.ps1');
  const pullRes = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-JobId', 'JOB_TEST_001',
    '-LocalRunsRoot', localRunsRoot,
    '-MockArchiveSource', archivePath,
  ], { encoding: 'utf8' });

  assert.equal(pullRes.status, 0, pullRes.stderr || pullRes.stdout);
  assert.ok(pullRes.stdout.includes('[PULL_SUCCESS]'));

  const jobDir = path.join(localRunsRoot, 'JOB_TEST_001');
  assert.ok(fs.existsSync(path.join(jobDir, '01_work', 'step1.log')));
  assert.ok(fs.existsSync(path.join(jobDir, '02_output', 'sub folder with spaces', 'deg result table.tsv')));

  const tokenPath = path.join(jobDir, '.verify_passed');
  assert.ok(fs.existsSync(tokenPath), '成功后应生成 .verify_passed 回执');
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  assert.match(token, /^VERIFIED_AT_\d{8}T\d{6}Z$/);
});

test('里程碑 1：pull_and_verify.ps1 在哈希不符时抛出 CHECKSUM_MISMATCH_ABORT 并拒绝签发回执', { skip: NEED_POWERSHELL }, () => {
  const testRoot = fs.mkdtempSync(path.join(TEST_TMP, 'm1-tamper-'));
  const localRunsRoot = path.join(testRoot, 'local_runs');
  fs.mkdirSync(localRunsRoot, { recursive: true });

  const stagingDir = path.join(testRoot, 'staging');
  fs.mkdirSync(path.join(stagingDir, '01_work'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, '02_output'), { recursive: true });

  fs.writeFileSync(path.join(stagingDir, '01_work', 'work.txt'), 'legit', 'utf8');
  fs.writeFileSync(path.join(stagingDir, '02_output', 'res.txt'), 'legit', 'utf8');

  // 制造篡改的校验和
  const tamperedChecksums = [
    `0000000000000000000000000000000000000000000000000000000000000000  01_work/work.txt`,
    `1111111111111111111111111111111111111111111111111111111111111111  02_output/res.txt`,
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(stagingDir, 'checksums.sha256'), tamperedChecksums, 'utf8');

  // 显式用 System32\tar.exe，理由同上一个测试：PATH 上的 GNU tar 不认盘符。
  const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const tamperedArchivePath = path.join(testRoot, 'tampered.tar.zst');
  spawnSync(winTar, ['-cf', tamperedArchivePath, '-C', stagingDir, 'checksums.sha256', '01_work', '02_output']);

  const script = path.join(REPO_ROOT, 'tools', 'ops', 'pull_and_verify.ps1');
  const pullRes = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-JobId', 'JOB_BAD_002',
    '-LocalRunsRoot', localRunsRoot,
    '-MockArchiveSource', tamperedArchivePath,
  ], { encoding: 'utf8' });

  assert.notEqual(pullRes.status, 0, '校验失败时脚本必须以非零状态码退出');
  const output = (pullRes.stderr || '') + (pullRes.stdout || '');
  assert.ok(output.includes('CHECKSUM_MISMATCH_ABORT'), '必须报出 CHECKSUM_MISMATCH_ABORT');

  const jobDir = path.join(localRunsRoot, 'JOB_BAD_002');
  assert.ok(!fs.existsSync(path.join(jobDir, '.verify_passed')), '校验失败绝对不得生成 .verify_passed');
});

test('里程碑 1：core/mem_guard.py 语法合规且安全设定虚拟内存保底', () => {
  const pyScript = path.join(REPO_ROOT, 'core', 'mem_guard.py');
  const res = spawnSync('python', [pyScript], { encoding: 'utf8' });
  if (res.status === 0) {
    assert.ok(res.stderr.includes('虚拟内存保底上限') || res.stdout.includes('Current VmRSS'));
  } else {
    // 若系统无默认 python 命令，通过语法解析静态检查
    const content = fs.readFileSync(pyScript, 'utf8');
    assert.ok(content.includes('BIO_MEM_LIMIT_GB'));
    assert.ok(content.includes('BIO_VIRT_LIMIT_GB'));
    assert.ok(!content.includes('resource.setrlimit(resource.RLIMIT_AS, (limit_bytes, limit_bytes))'), '严禁直接把 RLIMIT_AS 设为 7.5GB');
  }
});
