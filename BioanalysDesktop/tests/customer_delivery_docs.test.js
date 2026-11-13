/**
 * 陌生用户交付文档契约（Ticket 5 + Ticket 2，4 Argon 第二十一轮 Q5）。
 *
 * 两份文件都回答「交给一个不认识我们的人」：
 *   HOW_TO_VERIFY.txt —— 在他自己机器上验包（随包走，受 CHECKSUMS 保护）
 *   docs/RUNBOOK_COMPUTE_NODE.md —— 给使用者搭环境/恢复
 * 断言只钉「可执行性」与「真源指针」，不复制正文：文档里写死的命令必须真能跑，
 * 引用的文档必须存在，且不能出现「参见某个不存在的文件」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BIOANALYS_DIR = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(BIOANALYS_DIR, '..');
const RUNBOOK = path.join(REPO, 'docs', 'RUNBOOK_COMPUTE_NODE.md');
const PACKAGER = path.join(REPO, 'tools', 'reporting', 'build_client_report.py');
const CORE = path.join(REPO, 'tools', 'reporting', 'delivery_acceptance_core.mjs');

test('RUNBOOK 存在且一页式（控制在 120 行内，超了就拆文档）', () => {
  assert.ok(fs.existsSync(RUNBOOK), 'docs/RUNBOOK_COMPUTE_NODE.md 缺失');
  const text = fs.readFileSync(RUNBOOK, 'utf8');
  const lines = text.split('\n').length;
  assert.ok(lines <= 120, 'RUNBOOK 过长（' + lines + ' 行），一页式目标要求 <= 120');
  assert.ok(lines >= 40, 'RUNBOOK 过短，像是没写完：' + lines);
});

test('RUNBOOK 的每一处文档引用都真实存在（不许指向不存在的文件）', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8');
  // 引用既可能裸写，也可能被反引号包住；两种都要抓（首版只认裸写，漏了全部反引号引用）
  const refs = [...text.matchAll(/`?(docs\/[A-Za-z0-9_.-]+)`?/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, '引用过少，RUNBOOK 应指向真源：' + refs.length);
  for (const ref of new Set(refs)) {
    assert.ok(fs.existsSync(path.join(REPO, ref)), 'RUNBOOK 引用了不存在的文档：' + ref);
  }
});

test('RUNBOOK 的四条命令入口都真实存在（脚本路径可执行）', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8');
  const scripts = [
    'tools/ops/adb_exec.ps1',
    'tools/dev/preflight.mjs',
    'docs/COMPUTE_INTERFACE.md',
    'docs/remote_channel_policy.md',
    'docs/directories.md',
    'docs/coding-standards.md',
    'docs/isolation.md',
  ];
  for (const rel of scripts) {
    assert.ok(text.includes(rel), 'RUNBOOK 缺关键入口：' + rel);
    assert.ok(fs.existsSync(path.join(REPO, rel)), '入口不存在：' + rel);
  }
});

test('RUNBOOK 不写易变事实（版本号/测试条数这类会自己过期的数字）', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8');
  // 允许 Node 版本下限这类「判据」，禁止当前实测值（如 1304 tests / v24.19.0）
  assert.equal(/\b\d{3,4} tests\b/.test(text), false, 'RUNBOOK 不得写测试条数（会过期）');
  assert.equal(/v\d+\.\d+\.\d+/.test(text), false, 'RUNBOOK 不得写具体版本号（会过期）');
});

test('HOW_TO_VERIFY 由打包器在 CHECKSUMS 之前生成（因此自身受哈希保护）', () => {
  const src = fs.readFileSync(PACKAGER, 'utf8');
  const howtoAt = src.indexOf('HOW_TO_VERIFY_NAME');
  const checksumsAt = src.indexOf('checksums = write_checksums(delivery)');
  assert.ok(howtoAt > 0, '打包器必须定义 HOW_TO_VERIFY_NAME');
  assert.ok(checksumsAt > 0, '打包器必须生成 CHECKSUMS');
  assert.ok(howtoAt < checksumsAt, 'HOW_TO_VERIFY 必须在 CHECKSUMS 之前落盘，否则自身不被签名覆盖');
  assert.match(src, /open\(os\.path\.join\(delivery, HOW_TO_VERIFY_NAME\), "w"[^)]*\) as fh/, '打包器必须真的写这个文件');
  assert.ok(src.includes('fh.write(how_to_verify('), '必须调用 how_to_verify 生成正文');
});

test('HOW_TO_VERIFY 第 4 步给出可直接复制的单行 openssl 验签命令（真包实测过的形态）', () => {
  // Argon 第二十二轮 Q4：Ed25519 是纯 EdDSA，签名时对原始消息哈希两次，不支持预哈希，
  // 所以必须用 pkeyutl -rawin；用 dgst -sha256 -verify 会直接报错。这一行在真包上实测
  // 输出 Signature Verified Successfully（exit 0），客户复制即可。
  const src = fs.readFileSync(PACKAGER, 'utf8');
  const start = src.indexOf('def how_to_verify(');
  const end = src.indexOf('def write_checksums(');
  const body = src.slice(start, end);
  const line = body.split('\\n').find((seg) => seg.includes('openssl pkeyutl'));
  assert.ok(line, '缺 openssl 验签命令');
  for (const flag of ['pkeyutl', '-verify', '-pubin', '-inkey', 'ED25519_PUBLIC_KEY.pem',
    '-rawin', '-in', 'CHECKSUMS.sha256', '-sigfile', 'CHECKSUMS.sig']) {
    assert.ok(line.includes(flag), '验签命令缺参数：' + flag);
  }
  // 必须是单行（可复制）：不允许尾部续行反斜杠或裸换行把命令拆开
  assert.equal(/\\\\(?=\")/.test(line), false, '验签命令不得用续行反斜杠（客户复制会断）');
  assert.ok(line.indexOf('-rawin') > 0, '-rawin 必须在命令里');
  assert.ok(body.includes('Signature Verified Successfully'), '必须写明期望输出');
  assert.ok(body.includes('dgst'), '必须点名 dgst 写法是错的（防客户照旧习惯踩坑）');
});

test('HOW_TO_VERIFY 文本覆盖四步验收且给出失败回传清单', () => {
  const src = fs.readFileSync(PACKAGER, 'utf8');
  const start = src.indexOf('def how_to_verify(');
  const end = src.indexOf('def write_checksums(');
  assert.ok(start > 0 && end > start, '找不到 how_to_verify 定义');
  const body = src.slice(start, end);
  for (const need of ['第 1 步', '第 2 步', '第 3 步', '第 4 步', 'sha256sum -c', 'certutil']) {
    assert.ok(body.includes(need), 'HOW_TO_VERIFY 缺关键内容：' + need);
  }
  assert.ok(body.includes('不对时把什么发回来'), '必须给出失败时的回传清单');
  assert.ok(body.includes('本文件自身也在 CHECKSUMS'), '必须写明自身也受哈希保护');
});

test('验收白名单放行 HOW_TO_VERIFY.txt（真包实测过：不放行会报幽灵私货）', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  assert.ok(core.includes("'HOW_TO_VERIFY.txt'"), 'allowedUnlistedFiles 必须含 HOW_TO_VERIFY.txt');
  assert.match(core, /allowedUnlistedFiles = \[[^\]]*README\.md[^\]]*HOW_TO_VERIFY\.txt[^\]]*\]/,
    'README 与 HOW_TO_VERIFY 必须同在白名单（两者都是包根说明，无业务分类）');
});

test('两批票的自动化入口已接进 package.json（人不必记长命令）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BIOANALYS_DIR, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  assert.ok(scripts['preflight'], '缺 preflight 脚本入口');
  assert.equal(scripts.preflight.includes('preflight.mjs'), true);
});
