/**
 * 工作区清理契约测试（Ticket 4，4 Argon 第二十二轮 Q5）。
 *
 * 这是唯一会删东西的脚本，所以每条护栏都要有正反两问：
 *   默认演练不动盘 / --execute 才删 / 黑名单熔断 / 白名单不外扩 / 幂等可重复。
 * 全部在临时目录里真跑，绝不碰仓库真实路径。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  assertNotSacred, scanTargets, executeTargets, main,
  SACRED_PATTERNS, SACRED_PATH_CODE, DEFAULT_KEEP_DAYS,
} from '../../ops/clean_workspace.mjs';

const BIOANALYS_DIR = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(BIOANALYS_DIR, '..');

function tmpRoot(tag) {
  const base = path.join(REPO, '.tmp', 'clean-' + tag + '-' + Date.now());
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function seedWorkspace(root) {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, '.tmp', 'a.txt'), 'x'.repeat(100), 'utf8');
  fs.mkdirSync(path.join(root, 'BioanalysDesktop', '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'BioanalysDesktop', '.tmp', 'b.txt'), 'y'.repeat(50), 'utf8');
  const del = path.join(root, 'local_projects', 'PRJ_X', 'deliverables');
  fs.mkdirSync(path.join(del, 'unpacked', 'inner'), { recursive: true });
  fs.writeFileSync(path.join(del, 'unpacked', 'inner', 'c.bin'), 'z'.repeat(20), 'utf8');
  // 受保护的审计流必须留在原地
  fs.writeFileSync(path.join(del, 'acceptance_audit.jsonl'), '{"a":1}\\n', 'utf8');
  fs.mkdirSync(path.join(del, 'acceptance'), { recursive: true });
  fs.writeFileSync(path.join(del, 'acceptance', 'PRJ_X.receipt.json'), '{}', 'utf8');
  // 旧日志与新日志各一条
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  const oldLog = path.join(root, 'logs', 'old.log');
  fs.writeFileSync(oldLog, 'old', 'utf8');
  const past = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  fs.utimesSync(oldLog, past, past);
  fs.writeFileSync(path.join(root, 'logs', 'new.log'), 'new', 'utf8');
}

test('黑名单：命中即抛 ERR_SACRED_PATH_PROTECTED，覆盖裁定点名的全部路径', () => {
  // 期望集用程序拼出反斜杠字面量：手写 \\ 转义在源码里极易多一层，
  // 这条断言曾因转义写错而假红两次（产品行为本身是对的）。
  const backslash = String.fromCharCode(92);
  const expectedPatterns = [
    'deliverables/acceptance_audit.jsonl',
    'ops/', 'src/', 'server/', 'docs/', '.git/',
    'backup/k40_cold',
    'd:' + backslash + 'backup' + backslash + 'k40_cold',
  ];
  assert.deepEqual([...SACRED_PATTERNS].sort(), expectedPatterns.sort());
  const bad = [
    'D:\\proj\\deliverables\\acceptance_audit.jsonl',
    '/repo/ops/tool.mjs',
    '/repo/src/main.js',
    '/repo/server/report.js',
    '/repo/docs/a.md',
    '/repo/.git/config',
    'D:\\Backup\\k40_cold\\snapshot.tar',
  ];
  for (const target of bad) {
    assert.throws(() => assertNotSacred(target), (error) => {
      assert.equal(error.code, SACRED_PATH_CODE);
      return true;
    }, '未拦住：' + target);
  }
  // 正常目标不得误伤
  assertNotSacred('/repo/.tmp/x.txt');
  assertNotSacred('/repo/local_projects/PRJ_X/deliverables/unpacked');
});

test('扫描面：只挑白名单三类，且跳过受保护文件', () => {
  const root = tmpRoot('scan');
  try {
    seedWorkspace(root);
    const targets = scanTargets({ root });
    const kinds = targets.map((t) => t.kind).sort();
    assert.ok(kinds.includes('tmp'), '必须选中工作区 .tmp');
    assert.ok(kinds.includes('unpack'), '必须选中 unpacked');
    assert.ok(kinds.includes('log'), '必须选中过期日志');
    for (const t of targets) {
      assert.equal(t.path.includes('acceptance_audit.jsonl'), false, '受保护审计流不得进候选');
      assert.equal(t.path.includes(path.join('deliverables', 'acceptance')), false, '回执目录不在白名单');
    }
    const logNames = targets.filter((t) => t.kind === 'log').map((t) => path.basename(t.path));
    assert.deepEqual(logNames, ['old.log'], '新日志不该入选（保留期内）');
    const total = targets.reduce((s, t) => s + t.bytes, 0);
    assert.ok(total > 0, '应算出可释放字节');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('默认第 2 类护栏：不传 --execute 时磁盘零改动', () => {
  const root = tmpRoot('dry');
  try {
    seedWorkspace(root);
    const logs = [];
    const io = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
    const code = main(['--root', root], io);
    assert.equal(code, 0);
    const text = logs.join('\\n');
    assert.match(text, /CLEAN_DRY_RUN/);
    assert.equal(text.includes('CLEAN_OK'), false, '演练模式不得报 CLEAN_OK');
    assert.ok(fs.existsSync(path.join(root, '.tmp', 'a.txt')), '演练必须不动盘');
    assert.ok(fs.existsSync(path.join(root, 'local_projects', 'PRJ_X', 'deliverables', 'unpacked')));
    assert.ok(fs.existsSync(path.join(root, 'logs', 'old.log')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--execute 真删：白名单目标被删，受保护审计流与回执目录原样保留', () => {
  const root = tmpRoot('exec');
  try {
    seedWorkspace(root);
    const logs = [];
    const io = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
    const code = main(['--root', root, '--execute'], io);
    assert.equal(code, 0, logs.join('\\n'));
    assert.match(logs.join('\\n'), /CLEAN_OK/);
    assert.equal(fs.existsSync(path.join(root, '.tmp')), false, '.tmp 应被删');
    assert.equal(fs.existsSync(path.join(root, 'BioanalysDesktop', '.tmp')), false);
    assert.equal(fs.existsSync(path.join(root, 'local_projects', 'PRJ_X', 'deliverables', 'unpacked')), false);
    assert.equal(fs.existsSync(path.join(root, 'logs', 'old.log')), false, '过期日志应被删');
    assert.ok(fs.existsSync(path.join(root, 'logs', 'new.log')), '保留期内日志不该被删');
    assert.ok(fs.existsSync(path.join(root, 'local_projects', 'PRJ_X', 'deliverables', 'acceptance_audit.jsonl')),
      '审计流必须原样保留（这是裁定点名的神圣路径）');
    assert.ok(fs.existsSync(path.join(root, 'local_projects', 'PRJ_X', 'deliverables', 'acceptance', 'PRJ_X.receipt.json')),
      '回执目录不在白名单，不该被删');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('幂等：--execute 连跑两次都成功，第二次无可清理项', () => {
  const root = tmpRoot('idem');
  try {
    seedWorkspace(root);
    const io1 = { log: () => {}, error: () => {} };
    assert.equal(main(['--root', root, '--execute'], io1), 0);
    const logs = [];
    const code = main(['--root', root, '--execute'], { log: (m) => logs.push(m), error: (m) => logs.push(m) });
    assert.equal(code, 0);
    assert.match(logs.join('\\n'), /CLEAN_OK 无可清理项/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('executeTargets：删除入口再断言一次黑名单（双重保险）', () => {
  const root = tmpRoot('guard');
  try {
    // path.join 在 Windows 用反斜杠：黑名单比较前已归一成 /，必须真能命中
    const protectedPath = path.join(root, 'deliverables', 'acceptance_audit.jsonl');
    fs.mkdirSync(path.dirname(protectedPath), { recursive: true });
    fs.writeFileSync(protectedPath, '{}', 'utf8');
    assert.throws(() => executeTargets([{ kind: 'log', path: protectedPath, bytes: 1, reason: 'probe' }]),
      (error) => error.code === SACRED_PATH_CODE, '删除函数入口必须熔断');
    assert.ok(fs.existsSync(protectedPath), '熔断后审计流必须还在');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('参数与出口：--json 可解析、坏 --keep-days 返回 2、默认保留期 7 天', () => {
  const root = tmpRoot('cli');
  try {
    seedWorkspace(root);
    assert.equal(DEFAULT_KEEP_DAYS, 7);
    const logs = [];
    const code = main(['--root', root, '--json'], { log: (m) => logs.push(m), error: (m) => logs.push(m) });
    assert.equal(code, 0);
    const parsed = JSON.parse(logs.join('\\n'));
    assert.equal(parsed.mode, 'dry-run');
    assert.ok(Array.isArray(parsed.targets));
    assert.ok(parsed.totalBytes_estimate > 0);
    assert.equal(parsed.deleted, 0);
    const bad = main(['--root', root, '--keep-days', '-1'], { log: () => {}, error: () => {} });
    assert.equal(bad, 2, '非法保留期必须 exit 2');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('静态契约：全仓通扫不存在（白名单目标硬编码在这一个文件里）', () => {
  const src = fs.readFileSync(path.join(REPO, 'ops', 'clean_workspace.mjs'), 'utf8');
  assert.ok(src.includes("path.join(root, '.tmp')"), '必须显式指向工作区 .tmp');
  assert.ok(src.includes('_unpacked_'), '必须显式认过期解包目录前缀');
  assert.ok(src.includes('assertNotSacred(full)'), '扫描阶段必须熔断');
  assert.ok(src.includes('assertNotSacred(target.path)'), '删除入口必须再熔断');
  assert.equal(/rmSync\(root/.test(src), false, '禁止整根删除');
});
