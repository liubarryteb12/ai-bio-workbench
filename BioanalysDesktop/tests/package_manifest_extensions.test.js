/**
 * package_manifest 增强字段契约测试（D4.2 / A2）。
 *
 * 判据：
 *   1. format_hint 与 autonomy_grants 合法值归一化通过。
 *   2. 未知键拒绝（演进先改真源）。
 *   3. retries 上限 3（与 autonomy_policy 预算一致）。
 *   4. 旧包无新字段时 normalized 为空、ok=true（legacy 放行不变）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeFormatHint,
  normalizeAutonomyGrants,
  validateManifestExtensions,
} from '../../shared/package_manifest_v1.mjs';

test('format_hint 合法值归一化通过', () => {
  const errors = [];
  const hint = normalizeFormatHint({
    delimiter: '\t', gene_id_type: 'auto_detect', is_log_transformed: false,
  }, 'manifest.data_files[0]', errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(hint, { delimiter: '\t', gene_id_type: 'auto_detect', is_log_transformed: false });
});

test('format_hint 未知键拒绝，演进须先改真源', () => {
  const errors = [];
  normalizeFormatHint({ delimiter: '\t', magic_key: 1 }, 'x', errors);
  assert.ok(errors.some((message) => message.startsWith('ERR_FORMAT_HINT_KEY')));
});

test('format_hint 类型错误拒绝', () => {
  const errors = [];
  normalizeFormatHint({ is_log_transformed: 'yes' }, 'x', errors);
  assert.ok(errors.some((message) => message.startsWith('ERR_FORMAT_HINT_LOG')));
});

test('autonomy_grants 合法值归一化通过', () => {
  const errors = [];
  const grants = normalizeAutonomyGrants({
    allow_l3_data_adaptation: true,
    allow_l2_grace_auto_pass: true,
    max_adaptation_retries: 3,
  }, errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(grants, {
    allow_l3_data_adaptation: true,
    allow_l2_grace_auto_pass: true,
    max_adaptation_retries: 3,
  });
});

test('autonomy_grants retries 超 3 拒绝（与策略预算一致）', () => {
  const errors = [];
  normalizeAutonomyGrants({ max_adaptation_retries: 5 }, errors);
  assert.ok(errors.some((message) => message.startsWith('ERR_GRANTS_RETRIES')));
});

test('autonomy_grants 未知授权字段拒绝', () => {
  const errors = [];
  normalizeAutonomyGrants({ allow_arbitrary_shell: true }, errors);
  assert.ok(errors.some((message) => message.startsWith('ERR_GRANTS_KEY')));
});

test('旧包无新字段：ok 且归一化为空（legacy 放行不变）', () => {
  const result = validateManifestExtensions({
    package_dir: 'PKG_X',
    data_files: [{ role: 'train_matrix', size: 1, sha256: 'a'.repeat(64) }],
    references: [],
  });
  assert.equal(result.ok, true, result.errors.join(' | '));
  assert.deepEqual(result.normalized.formatHints, [undefined]);
  assert.equal(result.normalized.autonomyGrants, undefined);
});

test('含新字段的整包校验通过且对齐 data_files 下标', () => {
  const result = validateManifestExtensions({
    package_dir: 'PKG_X',
    data_files: [
      { role: 'train_matrix', sha256: 'a'.repeat(64), format_hint: { delimiter: ',' } },
      { role: 'sample_metadata', sha256: 'b'.repeat(64) },
    ],
    autonomy_grants: { allow_l3_data_adaptation: true, max_adaptation_retries: 2 },
  });
  assert.equal(result.ok, true, result.errors.join(' | '));
  assert.deepEqual(result.normalized.formatHints[0], { delimiter: ',' });
  assert.equal(result.normalized.formatHints[1], undefined);
  assert.deepEqual(result.normalized.autonomyGrants, { allow_l3_data_adaptation: true, max_adaptation_retries: 2 });
});

test('非对象 manifest 直接拒', () => {
  const result = validateManifestExtensions('not-an-object');
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes('ERR_PACKAGE_SHAPE'));
});
