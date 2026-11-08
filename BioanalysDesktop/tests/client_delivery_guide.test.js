/**
 * 客户版《交付包使用与验真指南》契约（4 Argon 第二十四轮 Q2 / 第二十五轮 Q2）。
 *
 * 裁定三要点：
 *   1. 随包自动生成，不由人手工拷（必须接进打包主流程）；
 *   2. 写在 write_checksums 之前，因此自身受 CHECKSUMS 与签名保护；
 *   3. 按「四准四不准」口径：准写结构/图表对应/四步验真/版本区间，
 *      严禁出现硬件细节、研发过程词汇、未激活功能、内部路径与脚本名。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BIOANALYS_DIR = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(BIOANALYS_DIR, '..');
const PACKAGER = path.join(REPO, 'tools', 'reporting', 'build_client_report.py');
const CORE = path.join(REPO, 'tools', 'reporting', 'delivery_acceptance_core.mjs');

test('打包器在 CHECKSUMS 之前生成指南（因此受哈希与签名保护）', () => {
  const src = fs.readFileSync(PACKAGER, 'utf8');
  // 实际写法是 os.path.join(delivery, CLIENT_GUIDE_NAME), "w" ... as fh
  const guideAt = src.indexOf('os.path.join(delivery, CLIENT_GUIDE_NAME)');
  const checksumsAt = src.indexOf('checksums = write_checksums(delivery)');
  assert.ok(guideAt > 0, '打包器必须真的写指南文件');
  assert.ok(checksumsAt > 0);
  assert.ok(guideAt < checksumsAt, '指南必须在 CHECKSUMS 之前落盘，否则自身不被签名覆盖');
  assert.ok(src.includes('CLIENT_GUIDE_NAME = "CLIENT_DELIVERY_GUIDE.md"'), '文件名必须锁死');
});

test('四准：结构说明 / 图表对应 / 四步验真 / 版本区间 全部覆盖', () => {
  const src = fs.readFileSync(PACKAGER, 'utf8');
  const start = src.indexOf('def client_delivery_guide(');
  const end = src.indexOf('def write_checksums(');
  assert.ok(start > 0 && end > start, '找不到指南生成函数');
  const body = src.slice(start, end);
  for (const need of ['包里有什么', '图件与结果表怎么对应', '零依赖验真四步', '复现所需的标准运行时']) {
    assert.ok(body.includes(need), '缺准写章节：' + need);
  }
  // 四步验真必须包含四条命令要素
  for (const cmd of ['sha256sum -c', 'tar -xzf', 'CHECKSUMS.sha256', 'openssl pkeyutl', '-rawin']) {
    assert.ok(body.includes(cmd), '缺验真要素：' + cmd);
  }
  // 版本必须是区间表述，不得出现精确 patch 号
  assert.ok(body.includes('4.5.x'), 'R 版本必须是区间（4.5.x）');
  assert.match(body, /3\.10 或以上/, 'Python 版本必须是区间表述');
  // 精确 patch 号（如 4.5.3）不允许出现：把 4.5.x 挖掉后不应再有 4.5.<数字>
  const stripped = body.split('4.5.x').join('');
  assert.equal(/4\.5\.\d/.test(stripped), false, '不得出现精确 patch 号');
});

test('四不准：模板文本不含硬件细节/研发词汇/未激活功能/内部路径', () => {
  const src = fs.readFileSync(PACKAGER, 'utf8');
  const start = src.indexOf('def client_delivery_guide(');
  const end = src.indexOf('def write_checksums(');
  const body = src.slice(start, end);
  const forbidden = [
    'K40', 'Termux', 'proot', '安卓', '手机算力', '变异反证', '技术债', '幽灵',
    'pending', '第 2 轮', '第 X 轮', '/mnt/', 'proc.js', 'ledger_gen', 'run_all_gates',
  ];
  for (const word of forbidden) {
    assert.equal(body.includes(word), false, '客户版指南不得出现内部词：' + word);
  }
  assert.ok(body.includes('标准隔离计算环境'), '硬件必须用统一表述替代');
});

test('动态渲染：像 HOW_TO_VERIFY 一样用项目元数据，不是静态文案', () => {
  const src = fs.readFileSync(PACKAGER, 'utf8');
  assert.ok(src.includes('client_delivery_guide(meta, copied, manifest)'),
    '必须传项目元数据动态渲染（与当前包一致）');
  const start = src.indexOf('def client_delivery_guide(');
  const end = src.indexOf('def write_checksums(');
  const body = src.slice(start, end);
  for (const key of ['meta[\"project_id\"]', 'meta[\"project_name\"]', 'meta[\"generated_at\"]']) {
    assert.ok(body.includes(key), '指南必须渲染 ' + key);
  }
  assert.ok(body.includes('counts.get(\"figures\"'), '图件数必须来自实际计数');
});

test('验收白名单放行指南（真包实测：不放行会报幽灵私货）', () => {
  const core = fs.readFileSync(CORE, 'utf8');
  assert.ok(core.includes("'CLIENT_DELIVERY_GUIDE.md'"), 'allowedUnlistedFiles 必须含指南');
  assert.match(core, /allowedUnlistedFiles = \[[^\]]*HOW_TO_VERIFY\.txt[^\]]*CLIENT_DELIVERY_GUIDE\.md[^\]]*\]/,
    '两份客户文档必须同在白名单（都进 CHECKSUMS 但无业务分类）');
});
