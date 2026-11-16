// 变异门禁的汇总协议契约：SKIP（环境缺依赖）必须与「存活」分开统计，
// 跳过不算防线失守，但必须如实上报，不许混进绿灯。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateOutcomes, runOne } from '../../tools/dev/mutation_gate.mjs';

test('汇总：caught 之外的 skip 不算存活，survived 只收未抓住的', () => {
  const entry = (id, patch = {}) => Object.assign(
    { id, layer: 'infra', greenBaseline: false, redAfterMutation: false, caught: false, detail: '' }, patch,
  );
  const skipped = entry('c', { detail: '基线不绿' });
  skipped.skip = true;
  skipped.skipReason = '缺 git';
  const results = [
    entry('a', { greenBaseline: true, redAfterMutation: true, caught: true }),
    entry('b', { redAfterMutation: false, detail: '仍绿' }),
    skipped,
  ];
  const agg = aggregateOutcomes(results);
  assert.equal(agg.ok, false);
  assert.deepEqual(agg.survived.map((r) => r.id), ['b']);
  assert.deepEqual(agg.skipped.map((r) => r.id), ['c']);
});

test('runOne：守护判据声明 skip 时透传，不计入基线红', async () => {
  const outcome = await runOne({
    id: 'probe_skip',
    target: 'tools/dev/router_gate.mjs',
    guardLabel: 'probe',
    edits: [],
    async guard() {
      const verdict = { reason: '本机形态不具备守护条件' };
      verdict.skip = true;
      return verdict;
    },
  });
  assert.equal(outcome.skip, true);
  assert.equal(outcome.detail, '本机形态不具备守护条件');
});
