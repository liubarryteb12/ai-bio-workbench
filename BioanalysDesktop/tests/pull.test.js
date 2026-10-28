import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 本地存档根指向临时目录：测试不得写真实 outputs/
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bio_pull_'));
process.env.BIO_LOCAL_OUTPUTS = TMP_ROOT;

const {
  parseRemoteFileList, planPull, localLineDir, pullLineOutputs,
  readLocalFigures, localFigurePath, localDataDir, LOCAL_OUTPUTS_ROOT, PULL_SUBDIRS,
} = await import('../server/pull.js');
const { LINES, projectLineDir } = await import('../server/domain.js');

test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

test('本地项目根可被 BIO_LOCAL_OUTPUTS 覆盖（测试不污染真实 local_projects）', () => {
  assert.equal(LOCAL_OUTPUTS_ROOT, path.resolve(TMP_ROOT));
});

test('parseRemoteFileList：解析名称与字节数', () => {
  const list = parseRemoteFileList('l1_01.png|1234\nl1_02.png|5678\n');
  assert.deepEqual(list, [
    { name: 'l1_01.png', size: 1234 },
    { name: 'l1_02.png', size: 5678 },
  ]);
});

test('parseRemoteFileList：带路径或空行一律剔除（防远端输出把路径带进落点）', () => {
  const list = parseRemoteFileList('\n/abs/l1_01.png|10\n..\\evil.png|20\nl1_02.png|30\n');
  assert.deepEqual(list, [{ name: 'l1_02.png', size: 30 }]);
});

test('planPull：本地同大小跳过，大小不同重拉', () => {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'plan_'));
  fs.writeFileSync(path.join(dir, 'same.png'), '1234');
  fs.writeFileSync(path.join(dir, 'diff.png'), '1');
  const { pull, skip } = planPull(dir, [
    { name: 'same.png', size: 4 },
    { name: 'diff.png', size: 10 },
    { name: 'new.png', size: 7 },
  ]);
  assert.deepEqual(skip.map((f) => f.name), ['same.png']);
  assert.deepEqual(pull.map((f) => f.name), ['diff.png', 'new.png']);
});

test('planPull：force=true 时全部重拉', () => {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'force_'));
  fs.writeFileSync(path.join(dir, 'same.png'), '1234');
  const { pull, skip } = planPull(dir, [{ name: 'same.png', size: 4 }], { force: true });
  assert.equal(skip.length, 0);
  assert.equal(pull.length, 1);
});

test('localLineDir：图件落点固定在 local_projects/<项目>/figures/<线>', () => {
  for (const line of LINES) {
    assert.equal(localLineDir('PRJ_X', line), path.join(TMP_ROOT, 'PRJ_X', 'figures', line));
    assert.equal(localDataDir('PRJ_X', line, 'results'),
      path.join(TMP_ROOT, 'PRJ_X', 'data', line, 'results'));
  }
});

test('localLineDir：非法 project / line 抛错', () => {
  assert.throws(() => localLineDir('../x', 'line1_bulk'), /project_id 非法/);
  assert.throws(() => localLineDir('PRJ_X', 'line9_x'), /line_id 非法/);
});

test('pullLineOutputs：ssh 列文件 + scp 落本地并校验字节数', () => {
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    if (argv[0] === 'ssh') {
      const cmd = argv[argv.length - 1];
      // figures/ 有图，results/ 为空：验证按子目录分别处理
      return { code: 0, stdout: cmd.includes('/figures') ? 'l1_01.png|5\nl1_02.png|3\n' : '', stderr: '' };
    }
    // 模拟 scp：把源文件名写到本地目录，内容长度等于远端 size
    const localDir = argv[argv.length - 1];
    const sizes = { 'l1_01.png': 5, 'l1_02.png': 3 };
    for (const src of argv.filter((arg) => arg.startsWith('k40-ubuntu:'))) {
      const name = src.split('/').pop();
      fs.writeFileSync(path.join(localDir, name), 'x'.repeat(sizes[name]));
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const result = pullLineOutputs('PRJ_PULL', 'line1_bulk', { run });
  assert.equal(result.pulled, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  // 只回搬 figures/ + results/，processed/ 的大检查点不默认拉
  assert.deepEqual(PULL_SUBDIRS, ['figures', 'results']);
  const sshCmd = calls.find((argv) => argv[0] === 'ssh').join(' ');
  assert.ok(sshCmd.includes(projectLineDir('PRJ_PULL', 'line1_bulk')));
  const scp = calls.find((argv) => argv[0] === 'scp');
  assert.equal(scp[scp.length - 1], path.join(TMP_ROOT, 'PRJ_PULL', 'figures', 'line1_bulk'));
});

test('pullLineOutputs：scp 成功但本地字节数不符时计失败', () => {
  const run = (argv) => {
    if (argv[0] === 'ssh') {
      const cmd = argv[argv.length - 1];
      return { code: 0, stdout: cmd.includes('/figures') ? 'l1_01.png|5\n' : '', stderr: '' };
    }
    const localDir = argv[argv.length - 1];
    fs.writeFileSync(path.join(localDir, 'l1_01.png'), 'xx'); // 只写 2 字节
    return { code: 0, stdout: '', stderr: '' };
  };
  const result = pullLineOutputs('PRJ_BAD', 'line1_bulk', { run });
  assert.equal(result.pulled, 0);
  assert.equal(result.failed, 1);
});

test('readLocalFigures：无本地副本返回 null（调用方回落远端）', () => {
  assert.equal(readLocalFigures('PRJ_NONE', 'line1_bulk'), null);
});

test('readLocalFigures：读到本地图件并过滤非图像', () => {
  const dir = localLineDir('PRJ_LOCAL', 'line1_bulk');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'l1_01.png'), 'png');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const local = readLocalFigures('PRJ_LOCAL', 'line1_bulk');
  assert.ok(local);
  assert.deepEqual(local.figures.map((f) => f.name), ['l1_01.png']);
  assert.ok(localFigurePath('PRJ_LOCAL', 'line1_bulk', 'l1_01.png'));
  assert.equal(localFigurePath('PRJ_LOCAL', 'line1_bulk', 'notes.txt'), null);
});
