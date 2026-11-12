/**
 * 工单示例契约（2026-11-12）：仓库里的示例工单必须能被当前校验器接受。
 *
 * 2026-11-12 模拟时发现官方示例的 inputs 是空数组，真实调用方只能靠试错猜字段。
 * 补了带 inputs 的示例后，用这道断言防止它与校验器漂移。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeWorkOrderV2 } from '../../shared/work_order_v2.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLES = path.join(REPO, 'tools', 'examples');

function readExample(name) {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLES, name), 'utf8'));
}

test('示例 work_order_v2.example.json 能通过当前校验器', () => {
  const result = normalizeWorkOrderV2(readExample('work_order_v2.example.json'));
  assert.equal(result.ok, true, '官方示例不应被校验器拒绝：' + JSON.stringify(result.errors));
});

test('带 inputs 的示例能通过校验器，且 inputs 字段完整保留', () => {
  const draft = readExample('work_order_v2.inputs.example.json');
  const result = normalizeWorkOrderV2(draft);
  assert.equal(result.ok, true, '带 inputs 的示例不应被拒绝：' + JSON.stringify(result.errors));
  const normalized = result.workOrder || result.value || result;
  const inputs = normalized.inputs || [];
  assert.equal(inputs.length, draft.inputs.length, 'inputs 不应被静默丢弃');
  for (const [index, item] of inputs.entries()) {
    assert.ok(item.role, `inputs[${index}].role 必须保留`);
    assert.ok(item.filename, `inputs[${index}].filename 必须保留`);
    assert.equal(typeof item.size, 'number', `inputs[${index}].size 必须是数字`);
    assert.match(item.sha256, /^[0-9a-f]{64}$/, `inputs[${index}].sha256 必须是 64 位十六进制`);
  }
});

test('反证：只写 path 不写 role/filename 的 inputs 必须被拒', () => {
  const draft = readExample('work_order_v2.inputs.example.json');
  draft.inputs = [{ path: 'deg_sig.tsv', size: 10, sha256: '0'.repeat(64) }];
  const result = normalizeWorkOrderV2(draft);
  assert.equal(result.ok, false, '缺 role / filename 时应被拒');
  const codes = result.codes || [];
  assert.ok(codes.includes('ERR_INPUTS_SHAPE'), '应给出 ERR_INPUTS_SHAPE，实际 ' + JSON.stringify(codes));
});
