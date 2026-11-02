/**
 * 台账自省门禁（2026-11-01，技术债 5.7 收口，4 Argon 给出的最小垂直切块）
 *
 * 守护的核心契约：docs/generated/SYSTEM_LEDGER.json 必须与代码实态**字节级一致**。
 * 改了 workflows.json 或 figure_templates.json 却忘了重跑生成器，这里就判红，
 * 并且提示准确的修复命令。
 *
 * 关键实现选择（Argon 明确要求）：
 *   - **不在测试里 spawn git**（既慢，又会被 proc_seam_guard 拦下）；
 *   - 直接在内存里调用 ledger_gen.mjs 导出的纯函数 computeSystemLedger()，
 *     与磁盘文件做字符串严格比对。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeSystemLedger } from '../../ops/ledger_gen.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LEDGER_FILE = path.join(REPO, 'docs', 'generated', 'SYSTEM_LEDGER.json');

/** 与生成器一致的确定性序列化（键按字典序，2 空格缩进，末尾换行） */
function stableStringify(value) {
  const sortValue = (v) => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === 'object') {
      const out = {};
      for (const key of Object.keys(v).sort()) out[key] = sortValue(v[key]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sortValue(value), null, 2) + '\n';
}

test('台账与代码实态字节级一致（改了真源必须重跑生成器）', () => {
  assert.equal(fs.existsSync(LEDGER_FILE), true,
    '缺少 docs/generated/SYSTEM_LEDGER.json；运行 node ops/ledger_gen.mjs --write 生成');
  const diskRaw = fs.readFileSync(LEDGER_FILE, 'utf8');
  const freshRaw = stableStringify(computeSystemLedger());
  assert.equal(freshRaw, diskRaw,
    '台账与代码实态脱节，请运行 node ops/ledger_gen.mjs --write');
});

test('54 个 Mod 的母版引用零断链', () => {
  const fresh = computeSystemLedger();
  assert.equal(fresh.workflows.totalSeries, 3, '应为三条分析线');
  assert.equal(fresh.workflows.totalMods, 54, 'workflows.json 应登记 54 个 Mod');
  assert.deepEqual(fresh.workflows.missingScripts, [],
    'workflows.json 存在指向不存在母版脚本的断链');
});

test('82 个图件模板的就绪基线不退化（只许增加不许倒退）', () => {
  const fresh = computeSystemLedger();
  assert.equal(fresh.figureTemplates.total, 82, 'figure_templates.json 应登记 82 个模板');
  // 基线锁定在 2026-11-01 实测值：16 就绪。只许增加，不许倒退。
  // 补齐 pending 模板后把这个数字一起抬高（同时要重跑 ledger_gen --write）。
  assert.ok(fresh.figureTemplates.readyCount >= 16,
    '模板就绪数从基线 16 倒退了：' + fresh.figureTemplates.readyCount);
  assert.equal(
    fresh.figureTemplates.readyCount + fresh.figureTemplates.pendingCount,
    fresh.figureTemplates.total,
    '就绪 + pending 必须等于总数，不允许有模板被漏判',
  );
});

test('台账不含任何易变噪声（时间戳 / SHA / 行数会制造假红）', () => {
  const diskRaw = fs.readFileSync(LEDGER_FILE, 'utf8');
  for (const banned of ['generatedAt', 'generated_at', 'sloc', 'SLOC', 'commit', 'sha256']) {
    assert.ok(!diskRaw.includes(banned),
      '台账不得包含易变量 "' + banned + '"（来自 metrics_sync 的循环依赖教训）');
  }
});
