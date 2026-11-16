/**
 * autonomy_policy/v1 运行时校验与默认策略（D4.1 / 专家裁定 A1）。
 *
 * 三层自主模型：L3 全权自主 / L2 通知宽限 / L1 红线提案。
 * 本模块是纯函数真源：不读文件、不调接口，policy 文件的加载与热更新
 * 由消费方（pi_supervisor / mem_guard 包装层）负责。
 *
 * 校验失败返回 { ok:false, errors[], codes[] }，风格与 work_order_v2 一致。
 */

export const AUTONOMY_POLICY_SCHEMA_VERSION = 'autonomy_policy/v1';
export const AUTONOMY_TIERS = Object.freeze(['L3', 'L2', 'L1']);

/** 验证态资源红线（专家裁定：3.5GB / 180 秒，配置可收紧不可放宽越过此文件默认值） */
export const VALIDATION_MEMORY_GB_MAX = 3.5;
export const VALIDATION_TIMEOUT_SEC_MAX = 180;
/** 单步适配预算与熔断（D4 终审：3 次预算，超限挂起人工） */
export const ADAPTATION_BUDGET_MAX = 3;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function errorCode(line) {
  const index = line.indexOf(':');
  return index > 0 ? line.slice(0, index) : line;
}

function pushError(list, code, message) {
  list.push(`${code}: ${message}`);
}

/**
 * 默认策略：专家裁定 2026-11-15 值 + 用户终审 C 方案。
 * 三条降级阶梯是白名单：AI 只能按登记路径降级，不得临场发明。
 */
export function defaultAutonomyPolicy() {
  return {
    schema_version: AUTONOMY_POLICY_SCHEMA_VERSION,
    tiers: {
      L3: {
        label: '自主层',
        actions: ['schema_normalization', 'id_mapping', 'matrix_contract_conversion', 'in_distribution_grid_tuning', 'light_retry'],
      },
      L2: {
        label: '通知层',
        actions: ['model_space_reduction', 'batch_correction_insertion', 'signature_bridge_injection'],
      },
      L1: {
        label: '红线层',
        actions: ['master_script_patch_proposal', 'crossline_merge_attempt', 'heavy_algorithm_request', 'skip_acceptance_attempt'],
      },
    },
    checkpoint: {
      checkpoint_1_mode: 'grace_auto_pass',
      checkpoint_1_grace_sec: 180,
      checkpoint_2_mode: 'manual_hard_gate',
      checkpoint_2_grace_sec: 0,
      golden_regression_key: 'golden_regression',
    },
    validation: {
      memory_gb: 3.5,
      timeout_sec: 180,
      sample_conservation_required: true,
      gene_coverage_min_ratio: 0.8,
      quantile_summary_required: true,
    },
    adaptation: {
      budget_per_step: 3,
      max_proposals_per_mod: 2,
      node_retry_max: 2,
      circuit_breaker_minutes: 20,
      fallback_ladder: [
        {
          id: 'l1_batch_singular',
          primary: 'sva_combat',
          fallbacks: ['limma_removeBatchEffect', 'batch_covariate_model_matrix'],
        },
        {
          id: 'l1_wgcna_not_scalefree',
          primary: 'pearson_power_network',
          fallbacks: ['bicor_maxPOutliers_0.05', 'spearman_module_cluster_warn'],
        },
        {
          id: 'l2_tenifold_memory',
          primary: 'full_population_grn',
          fallbacks: ['downsample_1500_cells_seed_fixed_top1500_hvg'],
        },
        {
          id: 'l3_nnls_residual_high',
          primary: 'top20_fine_markers',
          fallbacks: ['merge_to_coarse_major_celltypes_nnls'],
        },
      ],
    },
    revocation: {
      min_valid_biological_replicates: 3,
      sample_removal_max_ratio: 0.15,
      probe_loss_max_ratio: 0.2,
      require_fdr_not_raw_p: true,
      external_validation_auc_min: 0.65,
    },
    delivery_grade: {
      standard: 'STANDARD_VERIFIED',
      degraded: 'EXPLORATORY_DEGRADED',
      degraded_signature_policy: 'manual_override_only',
    },
  };
}

/**
 * 校验一份策略文件（对象形态）。缺失字段回落默认值（additive 演进），
 * 但已给出的字段非法必须报错，禁静默丢弃。
 */
export function validateAutonomyPolicy(policy) {
  const errors = [];
  const codes = [];
  const push = (code, message) => {
    codes.push(code);
    pushError(errors, code, message);
  };

  if (!isPlainObject(policy)) {
    push('ERR_POLICY_SHAPE', '策略必须是 JSON 对象');
    return { ok: false, errors, codes };
  }
  if (policy.schema_version !== AUTONOMY_POLICY_SCHEMA_VERSION) {
    push('ERR_POLICY_VERSION', `schema_version 必须是 ${AUTONOMY_POLICY_SCHEMA_VERSION}，当前 ${JSON.stringify(policy.schema_version ?? null)}`);
  }

  const defaults = defaultAutonomyPolicy();

  if (policy.checkpoint !== undefined) {
    const cp = policy.checkpoint;
    if (!isPlainObject(cp)) {
      push('ERR_CHECKPOINT_SHAPE', 'checkpoint 必须是对象');
    } else {
      if (cp.checkpoint_1_mode !== undefined && !['grace_auto_pass', 'manual_hard_gate'].includes(cp.checkpoint_1_mode)) {
        push('ERR_CHECKPOINT_1_MODE', `checkpoint_1_mode 非法：${JSON.stringify(cp.checkpoint_1_mode)}`);
      }
      if (cp.checkpoint_2_mode !== undefined && !['grace_auto_pass', 'manual_hard_gate'].includes(cp.checkpoint_2_mode)) {
        push('ERR_CHECKPOINT_2_MODE', `checkpoint_2_mode 非法（终审 C 方案默认 manual_hard_gate）：${JSON.stringify(cp.checkpoint_2_mode)}`);
      }
      for (const key of ['checkpoint_1_grace_sec', 'checkpoint_2_grace_sec']) {
        if (cp[key] !== undefined && (!isFiniteNumber(cp[key]) || cp[key] < 0 || cp[key] > 3600)) {
          push('ERR_CHECKPOINT_GRACE', `${key} 必须是 0 到 3600 的有限数字`);
        }
      }
      if (cp.checkpoint_2_mode === 'grace_auto_pass') {
        push('ERR_CHECKPOINT_2_FORBIDDEN', '终审 C 方案：报告签发检查点禁止配置为自动放行');
      }
    }
  }

  if (policy.validation !== undefined) {
    const val = policy.validation;
    if (!isPlainObject(val)) {
      push('ERR_VALIDATION_SHAPE', 'validation 必须是对象');
    } else {
      if (val.memory_gb !== undefined) {
        if (!isFiniteNumber(val.memory_gb) || val.memory_gb <= 0 || val.memory_gb > VALIDATION_MEMORY_GB_MAX) {
          push('ERR_VALIDATION_MEMORY', `validation.memory_gb 必须 > 0 且不超过 ${VALIDATION_MEMORY_GB_MAX}（REJ-006 生产上限 8.0 之内的验证态紧缩）`);
        }
      }
      if (val.timeout_sec !== undefined) {
        if (!Number.isInteger(val.timeout_sec) || val.timeout_sec <= 0 || val.timeout_sec > VALIDATION_TIMEOUT_SEC_MAX) {
          push('ERR_VALIDATION_TIMEOUT', `validation.timeout_sec 必须是正整数且不超过 ${VALIDATION_TIMEOUT_SEC_MAX}`);
        }
      }
      if (val.gene_coverage_min_ratio !== undefined) {
        if (!isFiniteNumber(val.gene_coverage_min_ratio) || val.gene_coverage_min_ratio < 0 || val.gene_coverage_min_ratio > 1) {
          push('ERR_GENE_COVERAGE', 'gene_coverage_min_ratio 必须在 [0,1]');
        }
      }
    }
  }

  if (policy.adaptation !== undefined) {
    const ad = policy.adaptation;
    if (!isPlainObject(ad)) {
      push('ERR_ADAPTATION_SHAPE', 'adaptation 必须是对象');
    } else {
      if (ad.budget_per_step !== undefined) {
        if (!Number.isInteger(ad.budget_per_step) || ad.budget_per_step < 1 || ad.budget_per_step > ADAPTATION_BUDGET_MAX) {
          push('ERR_BUDGET', `budget_per_step 必须是 1 到 ${ADAPTATION_BUDGET_MAX}（专家裁定 3 次熔断）`);
        }
      }
      if (ad.max_proposals_per_mod !== undefined) {
        if (!Number.isInteger(ad.max_proposals_per_mod) || ad.max_proposals_per_mod < 1 || ad.max_proposals_per_mod > 5) {
          push('ERR_PROPOSAL_BUDGET', 'max_proposals_per_mod 必须是 1 到 5 的整数（Gemini 裁定默认 2）');
        }
      }
      if (ad.fallback_ladder !== undefined) {
        if (!Array.isArray(ad.fallback_ladder)) {
          push('ERR_FALLBACK_SHAPE', 'fallback_ladder 必须是数组（白名单：AI 只能按登记路径降级）');
        } else {
          ad.fallback_ladder.forEach((entry, index) => {
            if (!isPlainObject(entry) || !entry.id || !entry.primary || !Array.isArray(entry.fallbacks)) {
              push('ERR_FALLBACK_ENTRY', `fallback_ladder[${index}] 需要 id、primary、fallbacks 三字段`);
            } else if (entry.fallbacks.length === 0) {
              push('ERR_FALLBACK_EMPTY', `fallback_ladder[${index}] (${entry.id}) 至少登记一条降级路径`);
            }
          });
        }
      }
    }
  }

  if (policy.revocation !== undefined) {
    const rv = policy.revocation;
    if (!isPlainObject(rv)) {
      push('ERR_REVOCATION_SHAPE', 'revocation 必须是对象');
    } else {
      for (const key of ['sample_removal_max_ratio', 'probe_loss_max_ratio']) {
        if (rv[key] !== undefined && (!isFiniteNumber(rv[key]) || rv[key] <= 0 || rv[key] >= 1)) {
          push('ERR_REVOCATION_RATIO', `${key} 必须在 (0,1) 开区间`);
        }
      }
      if (rv.external_validation_auc_min !== undefined) {
        if (!isFiniteNumber(rv.external_validation_auc_min) || rv.external_validation_auc_min <= 0 || rv.external_validation_auc_min >= 1) {
          push('ERR_AUC_MIN', 'external_validation_auc_min 必须在 (0,1) 开区间');
        }
      }
      if (rv.min_valid_biological_replicates !== undefined) {
        if (!Number.isInteger(rv.min_valid_biological_replicates) || rv.min_valid_biological_replicates < 1) {
          push('ERR_MIN_REPLICATES', 'min_valid_biological_replicates 必须是正整数');
        }
      }
    }
  }

  if (policy.delivery_grade !== undefined) {
    const dg = policy.delivery_grade;
    if (!isPlainObject(dg)) {
      push('ERR_DELIVERY_GRADE_SHAPE', 'delivery_grade 必须是对象');
    } else {
      if (dg.degraded_signature_policy !== undefined && dg.degraded_signature_policy !== 'manual_override_only') {
        push('ERR_DEGRADED_POLICY', '终审红线 2：降级签名策略固定为 manual_override_only，禁止放宽');
      }
    }
  }

  const knownTopKeys = new Set(['schema_version', 'tiers', 'checkpoint', 'validation', 'adaptation', 'revocation', 'delivery_grade']);
  for (const key of Object.keys(policy)) {
    if (!knownTopKeys.has(key)) {
      push('ERR_UNKNOWN_TOP_KEY', `未知顶层字段 ${key}（additive 演进须先改本真源）`);
    }
  }

  return { ok: codes.length === 0, errors, codes, defaults, merged: { ...defaults, ...policy } };
}

/**
 * 判定一次降级路径是否在登记白名单内。AI 临场发明的路径一律拒绝。
 */
export function isRegisteredFallback(policy, ladderId, fallbackId) {
  const ladder = policy?.adaptation?.fallback_ladder;
  if (!Array.isArray(ladder)) return false;
  const entry = ladder.find((item) => item && item.id === ladderId);
  if (!entry) return false;
  return Array.isArray(entry.fallbacks) && entry.fallbacks.includes(fallbackId);
}

/**
 * 检查点放行判定（终审 C 方案 + 专家吊销清单）。
 *
 * 输入 facts（全部可选，缺省按「不能证明安全」处理）：
 *   minValidReplicates, sampleRemovalRatio, probeLossRatio,
 *   fdrUsed, externalAuc, goldenRegression, reRunOfVerifiedWo,
 *   adaptationCount, allQcPass
 *
 * 规则：
 *   1. checkpoint 2 永远人工硬闸门（唯一的 golden_regression 豁免留给 CI 跑批）。
 *   2. checkpoint 1：golden_regression 或零等待白名单 -> 直接放行；
 *      命中任一吊销条件 -> 人工；否则按策略宽限倒计时自动放行。
 */
export function evaluateCheckpoint(policy, { checkpoint, facts = {} } = {}) {
  const cfg = policy?.checkpoint || {};
  const rv = policy?.revocation || {};
  const revocations = [];

  if (Number.isFinite(facts.minValidReplicates)
    && facts.minValidReplicates < Number(rv.min_valid_biological_replicates ?? 3)) {
    revocations.push('LOW_BIOLOGICAL_REPLICATES');
  }
  if (Number.isFinite(facts.sampleRemovalRatio)
    && facts.sampleRemovalRatio > Number(rv.sample_removal_max_ratio ?? 0.15)) {
    revocations.push('EXCESSIVE_SAMPLE_REMOVAL');
  }
  if (Number.isFinite(facts.probeLossRatio)
    && facts.probeLossRatio > Number(rv.probe_loss_max_ratio ?? 0.2)) {
    revocations.push('EXCESSIVE_PROBE_LOSS');
  }
  if (facts.fdrUsed === false && rv.require_fdr_not_raw_p !== false) {
    revocations.push('RAW_P_VALUE_INSTEAD_OF_FDR');
  }
  if (Number.isFinite(facts.externalAuc)
    && facts.externalAuc < Number(rv.external_validation_auc_min ?? 0.65)) {
    revocations.push('EXTERNAL_VALIDATION_AUC_LOW');
  }

  const golden = facts.goldenRegression === true;
  if (checkpoint === 2) {
    // 终审 C：报告签发保留人工；唯一豁免是内部黄金回归跑批且全绿。
    if (golden && facts.allQcPass === true) {
      return { mode: 'golden_regression_pass', waitSec: 0, revocations, reason: 'golden_regression' };
    }
    return {
      mode: 'manual_hard_gate',
      waitSec: 0,
      revocations,
      reason: revocations.length > 0 ? 'revoked' : 'report_signing_requires_human',
    };
  }

  if (golden) {
    return { mode: 'golden_regression_pass', waitSec: 0, revocations, reason: 'golden_regression' };
  }
  const zeroWait = facts.reRunOfVerifiedWo === true
    || (facts.adaptationCount === 0 && facts.allQcPass === true);
  if (revocations.length > 0) {
    return { mode: 'manual_hard_gate', waitSec: 0, revocations, reason: 'revoked' };
  }
  if (zeroWait) {
    return { mode: 'zero_wait_pass', waitSec: 0, revocations, reason: 'fast_track' };
  }
  return {
    mode: 'grace_auto_pass',
    waitSec: Number(cfg.checkpoint_1_grace_sec ?? 180),
    revocations,
    reason: 'grace_period',
  };
}
