/**
 * 客户需求单的唯一校验器（第二十九轮 ⑥）
 *
 * 三处必须共用同一份规则，否则「门户导出 → 服务端建项」这条链就会在客户看不见的地方塌：
 *   - portal/serve.mjs 落盘前（本模块）
 *   - BioanalysDesktop/server/project.js 建项前（同一套字段与档位）
 *   - shared/requirement_schema.json 是给人看与给外部工具读的声明面
 *
 * 这里手写而不是引 ajv：本仓库的 node 依赖只有 react/react-dom，
 * 为一条需求单一 schema 引一个校验库不划算，且手写才能给出中文的人话报错。
 */

/** 分析数据类型枚举（与 BioanalysDesktop/server/domain.js、portal/index.html 同值） */
export const DATA_TYPE_IDS = ['microarray', 'bulk_rnaseq', 'scrna', 'spatial'];

/** 数据集用途枚举 */
export const DATASET_ROLES = ['train', 'validation'];

/**
 * 差异基因筛选档位。数值改动必须三处同步：
 * BioanalysDesktop/server/project.js 的 ANALYSIS_CUTOFFS、portal/index.html 的 CUTOFF_PROFILES、
 * 以及 shared/requirement_schema.json 的 analysisCutoffs.profile.description。
 */
export const CUTOFF_PROFILES = {
  loose: { log2fc: 0.5, p: 0.1 },
  standard: { log2fc: 1.0, p: 0.05 },
  strict: { log2fc: 2.0, p: 0.05 },
};

/** 历史档位名（2026-11-04 之前的门户产出），导入历史需求单时必须仍能认 */
export const LEGACY_CUTOFF_PROFILES = { standard_sci: 'standard', sensitive: 'loose', strict: 'strict' };

/** 分组角色：reference = 基准组（恰好 1 个），disease_stage = 变化组 */
export const GROUP_ROLES = ['reference', 'disease_stage'];

/**
 * 研究领域枚举（与 BioanalysDesktop/server/domain.js 的 DOMAIN_ENUM、portal/index.html 领域下拉同值）。
 * 服务端建项一直按这份枚举硬拒，之前共享校验器不查，于是门户与工单能把非法值送到建项才炸。
 * 同值由 BioanalysDesktop/tests/requirement_schema_contract.test.js 钉住。
 */
export const DOMAIN_ENUM = ['心脑血管', '神经退行', '代谢', '纤维化', '发育', '免疫', '其他非肿瘤'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
const isOdd = (v) => Number.isFinite(v) && v > 0 && v < 1;

/**
 * 校验一份需求单。返回 { ok, errors[] }，errors 是中文人话。
 * 只校验「建项能不能立起来」的硬条件，风格类问题不在这里拦。
 */
export function validateRequirement(payload) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (!isPlainObject(payload)) return { ok: false, errors: ['需求单必须是一个 JSON 对象'] };

  // ── basicInfo ────────────────────────────────────────────
  if (!isPlainObject(payload.basicInfo)) {
    push('缺少 basicInfo（项目基本信息）');
  } else if (typeof payload.basicInfo.name !== 'string' || !payload.basicInfo.name.trim()) {
    push('basicInfo.name 不能为空（项目名是建项主键）');
  }
  // domain 单独查：上面的 else if 链只管 name，name 合法时 domain 不会被看到。
  // 空串与非法值都在这里拒掉，与 server/project.js 建项口径一致（R11 点名的脏值）。
  if (isPlainObject(payload.basicInfo)) {
    const domain = String(payload.basicInfo.domain ?? '').trim();
    if (!DOMAIN_ENUM.includes(domain)) {
      push(`basicInfo.domain 非法: ${JSON.stringify(payload.basicInfo.domain ?? null)}，只能是 ${DOMAIN_ENUM.join(' / ')} 之一`);
    }
  }

  // ── dataSource ───────────────────────────────────────────
  const ds = payload.dataSource;
  if (!isPlainObject(ds)) {
    push('缺少 dataSource（数据来源）');
  } else {
    if (typeof ds.source !== 'string' || !ds.source.trim()) {
      push('dataSource.source 不能为空（数据来源是需求单的必填声明）');
    }
    if (!DATA_TYPE_IDS.includes(ds.dataType)) {
      push(`dataSource.dataType 非法: ${JSON.stringify(ds.dataType ?? null)}，应为 ${DATA_TYPE_IDS.join(' / ')} 之一`);
    }
    const rows = ds.datasets;
    if (!Array.isArray(rows) || !rows.length) {
      push('dataSource.datasets 至少需要一组（每行一个 GSE 与 GPL 的配对）');
    } else {
      const hasRowCount = (r) => isPlainObject(r) && r.sampleCount !== undefined && r.sampleCount !== null && r.sampleCount !== '';
      const hasRowTissue = (r) => isPlainObject(r) && typeof r.tissue === 'string' && r.tissue.trim() !== '';
      const anyRowCount = rows.some(hasRowCount);
      const anyRowTissue = rows.some(hasRowTissue);
      rows.forEach((row, i) => {
        const at = `第 ${i + 1} 组数据集`;
        if (!isPlainObject(row)) return push(`${at} 不是对象`);
        if (typeof row.gse !== 'string' || !row.gse.trim()) push(`${at} 缺少 GSE 编号`);
        if (row.role !== undefined && !DATASET_ROLES.includes(row.role)) {
          push(`${at} 的 role 非法: ${JSON.stringify(row.role)}，应为 train / validation`);
        }
        // 行级样本数/组织来源是权威值：合入多个 GSE 时两者常不同，项目级单值会把不准的数字写进台账。
        // 全部留空视为 2026-11-04 之前的历史需求单，此时回落到项目级字段（与 server/domain.js 同一继承规则）；
        // 只要有一行填了，就必须每行都填，半填会让下游拿不准哪一行是真值。
        if (anyRowCount && !isPositiveInt(row.sampleCount)) {
          push(`${at} 的 sampleCount 缺失或非法: ${JSON.stringify(row.sampleCount ?? null)}（必须是 >=1 的整数）`);
        }
        if (anyRowTissue && !hasRowTissue(row)) {
          push(`${at} 的 tissue（组织来源）缺失`);
        }
      });
      if (!anyRowCount) {
        if (!isPositiveInt(ds.sampleCount)) {
          push('dataSource.sampleCount 缺失：逐数据集都没填样本数时，项目级 sampleCount 必须给出（>=1 的整数）');
        }
      } else if (rows.every(hasRowCount)) {
        // 顶层派生值必须与行级合计一致，否则下游读哪个都能读出不同答案
        const sum = rows.reduce((a, r) => a + Number(r.sampleCount), 0);
        if (ds.sampleCount !== undefined && ds.sampleCount !== sum) {
          push(`dataSource.sampleCount 与逐数据集合计不一致：顶层 ${JSON.stringify(ds.sampleCount)}，行级合计 ${sum}。行级是权威值，顶层应由行级派生`);
        }
      }
      if (!anyRowTissue && (typeof ds.tissue !== 'string' || !ds.tissue.trim())) {
        push('dataSource.tissue 缺失：逐数据集都没填组织来源时，项目级 tissue 必须给出');
      }
    }
  }

  // ── groupingDesign ───────────────────────────────────────
  const gd = payload.groupingDesign;
  if (!isPlainObject(gd)) {
    push('缺少 groupingDesign（分组设计）');
  } else {
    if (typeof gd.mode !== 'string' || !gd.mode.trim()) {
      push('groupingDesign.mode 不能为空（分组模式是需求单的必填声明）');
    }
    const groups = Array.isArray(gd.groups) ? gd.groups : [];
    if (groups.length < 2) push(`groupingDesign.groups 至少 2 组，当前 ${groups.length} 组`);
    const names = [];
    groups.forEach((g, i) => {
      const at = `第 ${i + 1} 组`;
      if (!isPlainObject(g)) return push(`${at} 不是对象`);
      if (typeof g.groupName !== 'string' || !g.groupName.trim()) push(`${at} 缺少 groupName`);
      else names.push(g.groupName);
      if (!GROUP_ROLES.includes(g.role)) {
        push(`${at}（${g.groupName ?? '未命名'}）的 role 非法: ${JSON.stringify(g.role)}，应为 reference（基准组）/ disease_stage（变化组）`);
      }
      if (!Array.isArray(g.sampleIds)) {
        push(`${at}（${g.groupName ?? '未命名'}）的 sampleIds 必须是数组`);
      }
    });
    const refs = groups.filter((g) => isPlainObject(g) && g.role === 'reference');
    if (groups.length >= 2 && refs.length !== 1) {
      push(`基准组（role=reference）必须有且只有 1 个，当前 ${refs.length} 个`);
    }
    const contrasts = Array.isArray(gd.contrasts) ? gd.contrasts : [];
    if (!contrasts.length) push('groupingDesign.contrasts 至少需要 1 条（必须显式写明谁与谁比较）');
    contrasts.forEach((c, i) => {
      const at = `第 ${i + 1} 条对比对`;
      if (!isPlainObject(c)) return push(`${at} 不是对象`);
      if (!names.includes(c.case)) push(`${at} 的 case（变化组）${JSON.stringify(c.case ?? null)} 不是已命名的组`);
      if (!names.includes(c.ctrl)) push(`${at} 的 ctrl（基准组）${JSON.stringify(c.ctrl ?? null)} 不是已命名的组`);
      if (typeof c.name !== 'string' || !c.name.trim()) push(`${at} 缺少对比名称 name`);
      if (typeof c.isPrimary !== 'boolean') push(`${at} 的 isPrimary 必须是布尔`);
    });
    if (contrasts.length) {
      const primary = contrasts.filter((c) => isPlainObject(c) && c.isPrimary === true);
      if (primary.length !== 1) push(`主对比（isPrimary=true）必须有且只有 1 条，当前 ${primary.length} 条`);
    }
  }

  // ── analysisCutoffs（可缺省，缺省走标准档） ────────────────
  const ac = payload.analysisCutoffs;
  if (ac !== undefined) {
    if (!isPlainObject(ac)) {
      push('analysisCutoffs 必须是对象');
    } else {
      if (ac.profile === undefined) {
        push('analysisCutoffs.profile 缺失');
      } else if (!(ac.profile in CUTOFF_PROFILES) && !(ac.profile in LEGACY_CUTOFF_PROFILES)) {
        push(`analysisCutoffs.profile 非法: ${JSON.stringify(ac.profile)}，只能是 ${Object.keys(CUTOFF_PROFILES).join(' / ')}`);
      }
      if (ac.use_adj_p === undefined) {
        push('analysisCutoffs.use_adj_p 缺失：必须显式标示是否用 adj.P 判定显著性，缺省值会让判据不可复现');
      } else if (typeof ac.use_adj_p !== 'boolean') {
        push('analysisCutoffs.use_adj_p 必须是布尔');
      }
      if (ac.log2fc_threshold !== undefined && !(Number.isFinite(ac.log2fc_threshold) && ac.log2fc_threshold > 0)) {
        push('analysisCutoffs.log2fc_threshold 必须是正数');
      }
      for (const key of ['p_threshold', 'adj_p_threshold', 'padj_threshold']) {
        if (ac[key] !== undefined && !isOdd(ac[key])) {
          push(`analysisCutoffs.${key} 必须是 (0,1) 之间的小数`);
        }
      }
      // 勾了 adj.P 却只给名义 p 阈值：判据自相矛盾，宁可当场拒绝也别让下游猜
      if (ac.use_adj_p === true && ac.p_threshold != null && ac.adj_p_threshold == null && ac.padj_threshold == null) {
        push('勾选了「用 adj.P 判定显著性」却只填 p_threshold：请填 adj_p_threshold，或留空沿用档位默认值');
      }
    }
  }

  // ── biologicalPriors（可缺省；门户当前只产出 focusGenes） ──
  if (payload.biologicalPriors !== undefined) {
    if (!isPlainObject(payload.biologicalPriors)) {
      push('biologicalPriors 必须是对象');
    } else {
      const focusGenes = payload.biologicalPriors.focusGenes;
      if (focusGenes !== undefined) {
        if (!Array.isArray(focusGenes)) {
          push('biologicalPriors.focusGenes 必须是字符串数组');
        } else {
          if (focusGenes.length > 5) {
            push(`核心研究基因最多 5 个，当前 ${focusGenes.length} 个`);
          }
          focusGenes.forEach((gene, i) => {
            if (typeof gene !== 'string' || !gene.trim()) {
              push(`核心研究基因第 ${i + 1} 项为空`);
            } else if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(gene.trim())) {
              push(`核心研究基因第 ${i + 1} 项格式非法: ${JSON.stringify(gene)}（应为英文基因符号）`);
            }
          });
        }
      }
    }
  }

  // ── 软上限 ───────────────────────────────────────────────
  if (payload.references !== undefined) {
    if (!Array.isArray(payload.references)) push('references 必须是数组');
    else if (payload.references.length > 5) push(`参考文献最多 5 篇，当前 ${payload.references.length} 篇`);
  }
  if (payload.notes !== undefined) {
    if (typeof payload.notes !== 'string') push('notes 必须是字符串');
    else if (payload.notes.length > 4000) push(`备注过长（${payload.notes.length} 字，上限 4000）`);
  }

  return { ok: errors.length === 0, errors };
}
