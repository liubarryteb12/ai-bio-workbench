/**
 * autonomy_policy/v1 契约测试（D4.1 / 专家裁定 A1，先红后绿首波）。
 *
 * 判据：
 *   1. 默认策略通过校验，终审 C 方案钉死（#1 自动 #2 人工）。
 *   2. 终审红线机器可校验：checkpoint_2 禁止自动放行、降级签名策略禁放宽。
 *   3. 资源红线：验证态 3.5GB / 180s 上限，配置放宽即拒。
 *   4. 降级阶梯白名单：未登记路径拒绝。
 *   5. 未知顶层字段拒绝（additive 演进须先改真源）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTONOMY_POLICY_SCHEMA_VERSION,
  VALIDATION_MEMORY_GB_MAX,
  VALIDATION_TIMEOUT_SEC_MAX,
  ADAPTATION_BUDGET_MAX,
  defaultAutonomyPolicy,
  validateAutonomyPolicy,
  isRegisteredFallback,
  evaluateCheckpoint,
} from '../../shared/autonomy_policy_v1.mjs';

test('默认策略通过校验，终审 C 方案钉死在默认值', () => {
  const policy = defaultAutonomyPolicy();
  const result = validateAutonomyPolicy(policy);
  assert.equal(result.ok, true, result.errors.join(' | '));
  assert.equal(policy.checkpoint.checkpoint_1_mode, 'grace_auto_pass');
  assert.equal(policy.checkpoint.checkpoint_1_grace_sec, 180);
  assert.equal(policy.checkpoint.checkpoint_2_mode, 'manual_hard_gate');
  assert.equal(policy.checkpoint.checkpoint_2_grace_sec, 0, '签发检查点无宽限期');
  assert.equal(policy.delivery_grade.standard, 'STANDARD_VERIFIED');
  assert.equal(policy.delivery_grade.degraded, 'EXPLORATORY_DEGRADED');
});

test('终审红线 1：checkpoint_2 配置为自动放行必须被拒', () => {
  const policy = defaultAutonomyPolicy();
  policy.checkpoint.checkpoint_2_mode = 'grace_auto_pass';
  const result = validateAutonomyPolicy(policy);
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes('ERR_CHECKPOINT_2_FORBIDDEN'));
});

test('终审红线 2：降级签名策略只认 manual_override_only，放宽即拒', () => {
  const policy = defaultAutonomyPolicy();
  policy.delivery_grade.degraded_signature_policy = 'auto_after_grace';
  const result = validateAutonomyPolicy(policy);
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes('ERR_DEGRADED_POLICY'));
});

test('资源红线：验证态内存与超时放宽即拒，收紧放行', () => {
  const relaxed = defaultAutonomyPolicy();
  relaxed.validation.memory_gb = 8.0;
  relaxed.validation.timeout_sec = 600;
  const relaxedResult = validateAutonomyPolicy(relaxed);
  assert.equal(relaxedResult.ok, false);
  assert.ok(relaxedResult.codes.includes('ERR_VALIDATION_MEMORY'));
  assert.ok(relaxedResult.codes.includes('ERR_VALIDATION_TIMEOUT'));
  assert.equal(VALIDATION_MEMORY_GB_MAX, 3.5);
  assert.equal(VALIDATION_TIMEOUT_SEC_MAX, 180);

  const tighter = defaultAutonomyPolicy();
  tighter.validation.memory_gb = 2.0;
  tighter.validation.timeout_sec = 60;
  const tighterResult = validateAutonomyPolicy(tighter);
  assert.equal(tighterResult.ok, true, tighterResult.errors.join(' | '));
});

test('适配预算上限 3（专家裁定 3 次熔断），超限即拒', () => {
  const policy = defaultAutonomyPolicy();
  policy.adaptation.budget_per_step = 5;
  const result = validateAutonomyPolicy(policy);
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes('ERR_BUDGET'));
  assert.equal(ADAPTATION_BUDGET_MAX, 3);
});

test('降级阶梯白名单：登记路径放行，临场发明拒绝', () => {
  const policy = defaultAutonomyPolicy();
  assert.equal(
    isRegisteredFallback(policy, 'l1_batch_singular', 'limma_removeBatchEffect'),
    true,
    'ComBat 奇异时降级 removeBatchEffect 是登记路径',
  );
  assert.equal(
    isRegisteredFallback(policy, 'l1_batch_singular', 'my_clever_new_method'),
    false,
    'AI 临场发明的降级路径必须拒绝',
  );
  assert.equal(isRegisteredFallback(policy, 'unknown_ladder', 'anything'), false);
});

test('未知顶层字段拒绝：additive 演进必须先改真源', () => {
  const policy = defaultAutonomyPolicy();
  policy.sneaky_expansion = {};
  const result = validateAutonomyPolicy(policy);
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes('ERR_UNKNOWN_TOP_KEY'));
});

test('吊销阈值非法值拒绝：比例必须在 (0,1) 开区间', () => {
  const policy = defaultAutonomyPolicy();
  policy.revocation.sample_removal_max_ratio = 1.0;
  const result = validateAutonomyPolicy(policy);
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes('ERR_REVOCATION_RATIO'));
});

test('schema 版本钉死', () => {
  assert.equal(AUTONOMY_POLICY_SCHEMA_VERSION, 'autonomy_policy/v1');
  const policy = defaultAutonomyPolicy();
  policy.schema_version = 'autonomy_policy/v2';
  const result = validateAutonomyPolicy(policy);
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes('ERR_POLICY_VERSION'));
});

test('检查点判定：终审 C 方案，检查点二永远人工（golden 跑批除外）', () => {
  const policy = defaultAutonomyPolicy();
  const cp2 = evaluateCheckpoint(policy, { checkpoint: 2, facts: { allQcPass: true } });
  assert.equal(cp2.mode, 'manual_hard_gate');
  const cp2Golden = evaluateCheckpoint(policy, {
    checkpoint: 2,
    facts: { goldenRegression: true, allQcPass: true },
  });
  assert.equal(cp2Golden.mode, 'golden_regression_pass');
});

test('检查点判定：吊销清单命中即转人工（N<3 / 剔除>15% / 裸P / AUC<0.65）', () => {
  const policy = defaultAutonomyPolicy();
  const lowN = evaluateCheckpoint(policy, { checkpoint: 1, facts: { minValidReplicates: 2 } });
  assert.equal(lowN.mode, 'manual_hard_gate');
  assert.ok(lowN.revocations.includes('LOW_BIOLOGICAL_REPLICATES'));

  const removal = evaluateCheckpoint(policy, { checkpoint: 1, facts: { sampleRemovalRatio: 0.3 } });
  assert.equal(removal.mode, 'manual_hard_gate');
  assert.ok(removal.revocations.includes('EXCESSIVE_SAMPLE_REMOVAL'));

  const rawP = evaluateCheckpoint(policy, { checkpoint: 1, facts: { fdrUsed: false } });
  assert.ok(rawP.revocations.includes('RAW_P_VALUE_INSTEAD_OF_FDR'));

  const lowAuc = evaluateCheckpoint(policy, { checkpoint: 1, facts: { externalAuc: 0.6 } });
  assert.ok(lowAuc.revocations.includes('EXTERNAL_VALIDATION_AUC_LOW'));
});

test('检查点判定：干净工单按 180 秒宽限自动放行，免检白名单即零等待', () => {
  const policy = defaultAutonomyPolicy();
  const normal = evaluateCheckpoint(policy, { checkpoint: 1, facts: { minValidReplicates: 4 } });
  assert.equal(normal.mode, 'grace_auto_pass');
  assert.equal(normal.waitSec, 180);

  const fast = evaluateCheckpoint(policy, {
    checkpoint: 1,
    facts: { adaptationCount: 0, allQcPass: true },
  });
  assert.equal(fast.mode, 'zero_wait_pass');
  assert.equal(fast.waitSec, 0);
});
