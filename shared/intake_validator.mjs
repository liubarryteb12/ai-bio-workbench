/**
 * shared/intake_validator.mjs
 * 客户填单端与前置强校验网关的唯一真源校验器。
 * 
 * 职责：
 *   1. 双模式分流：自有矩阵上传（模式 A）与 GEO/公共库编号提单（模式 B）；
 *   2. 生信专属格式拦截：首列基因名 Excel 日期污染拦截（如 1-Mar、44256）；
 *   3. 样本名 R 语言安全拦截：禁止数字开头（防 make.names 自动加 X 偏移）；
 *   4. 分线样本重复数门槛断言：Bulk 每组 >= 3，单细胞/空间 >= 1；
 *   5. 纯函数设计，浏览器端（前 200 行切片）与服务端（流式全量）100% 同构复用。
 */

export const EXCEL_DATE_REGEX = /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
export const EXCEL_SERIAL_REGEX = /^(3[0-9]{4}|4[0-9]{4}|5[0-9]{4})$/; // 对应 1982~2036 年的 Excel 序列日
export const SAMPLE_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export const GENE_SYMBOL_REGEX = /^[A-Za-z0-9_.-]+$/;

export const GSE_REGEX = /^GSE\d+$/i;
export const GPL_REGEX = /^GPL\d+$/i;
export const GSM_REGEX = /^GSM\d+$/i;

/**
 * 校验基因符号（第一列行名）。
 * 返回 { ok: boolean, error?: string }
 */
export function checkGeneIdentifier(geneId) {
  const text = String(geneId || '').trim();
  if (!text) {
    return { ok: false, error: '基因名不能为空' };
  }
  // 1. 显式拦截 Excel 自动日期转换污染
  if (EXCEL_DATE_REGEX.test(text)) {
    return {
      ok: false,
      error: `检测到 Excel 自动转换导致的日期格式污染基因名: '${text}' (如 1-Mar 常见于 MARCH 家族)，请将 Excel 该列设为纯文本重新导出`,
    };
  }
  if (EXCEL_SERIAL_REGEX.test(text)) {
    return {
      ok: false,
      error: `检测到疑似 Excel 序列号日期污染纯数字基因名: '${text}' (如 44256 对应 MARCH1)，请将该列设为纯文本重新导出`,
    };
  }
  // 2. 字符集校验（允许连字符、点、下划线，兼容 HLA-DRA、RP11-34P13.7 等）
  if (!GENE_SYMBOL_REGEX.test(text)) {
    return {
      ok: false,
      error: `基因名包含非法字符: '${text}'，仅允许字母、数字、点(.)、下划线(_)与连字符(-)`,
    };
  }
  return { ok: true };
}

/**
 * 校验样本列名（表头）。
 * 返回 { ok: boolean, error?: string }
 */
export function checkSampleColumnName(sampleName) {
  const text = String(sampleName || '').trim();
  if (!text) {
    return { ok: false, error: '样本列名不能为空' };
  }
  // 首字符不能为数字（防 R 语言 make.names 自动加 X 导致分组表失配）
  if (/^[0-9]/.test(text)) {
    return {
      ok: false,
      error: `样本名 '${text}' 不能以数字开头（会导致 R 语言自动增加 'X' 前缀引发失配），请改为英文字母或下划线开头（如 'S_${text}'）`,
    };
  }
  if (!SAMPLE_NAME_REGEX.test(text)) {
    return {
      ok: false,
      error: `样本名 '${text}' 包含非法字符，仅允许字母、数字、点(.)、下划线(_)与连字符(-)，且必须字母/下划线开头`,
    };
  }
  return { ok: true };
}

/**
 * 校验矩阵头部片段（支持浏览器切片读取前 2MB / 前 200 行，或服务端整文本）。
 * @param {string} text - 表格文本内容
 * @param {string} delimiter - 分隔符 ('\t' 或 ',')
 */
export function validateMatrixHeaderSnippet(text, delimiter = '\t') {
  const errors = [];
  if (!text || typeof text !== 'string') {
    return { ok: false, errors: ['矩阵内容为空或不是文本'], samples: [] };
  }

  // 剔除可能存在的 UTF-8 BOM
  const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const lines = cleanText.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  if (lines.length < 2) {
    return { ok: false, errors: ['矩阵至少需要 1 行表头和至少 1 行数据'], samples: [] };
  }

  // 1. 表头行校验
  const headerCols = lines[0].split(delimiter).map((c) => c.trim());
  if (headerCols.length < 2) {
    return {
      ok: false,
      errors: [`矩阵首行解析到的列数为 ${headerCols.length}，请确认是否使用正确的制表符 (TSV) 或逗号 (CSV) 分隔`],
      samples: [],
    };
  }

  const sampleCols = headerCols.slice(1);
  const seenSamples = new Set();
  for (let i = 0; i < sampleCols.length; i += 1) {
    const sName = sampleCols[i];
    const check = checkSampleColumnName(sName);
    if (!check.ok) {
      errors.push(`第 ${i + 2} 列表头: ${check.error}`);
    }
    if (seenSamples.has(sName)) {
      errors.push(`矩阵表头存在重复样本名: '${sName}'`);
    }
    seenSamples.add(sName);
  }

  // 2. 检查前 N 行（最多 200 行采样）数据行
  const sampleRowCount = Math.min(lines.length - 1, 200);
  for (let r = 1; r <= sampleRowCount; r += 1) {
    const rowCols = lines[r].split(delimiter).map((c) => c.trim());
    if (rowCols.length !== headerCols.length) {
      errors.push(`第 ${r + 1} 行列数 (${rowCols.length}) 与表头列数 (${headerCols.length}) 不一致`);
      if (errors.length >= 10) break;
      continue;
    }
    const geneId = rowCols[0];
    const geneCheck = checkGeneIdentifier(geneId);
    if (!geneCheck.ok) {
      errors.push(`第 ${r + 1} 行基因名错误: ${geneCheck.error}`);
      if (errors.length >= 10) break;
    }
    // 检查前 5 个数值单元格纯度
    for (let c = 1; c < Math.min(rowCols.length, 6); c += 1) {
      const val = rowCols[c];
      if (val === '' || val === 'NA' || val === 'null' || val === 'NaN') {
        errors.push(`第 ${r + 1} 行样本 '${sampleCols[c - 1]}' 发现空值或 NaN: '${val}'`);
        break;
      }
      if (Number.isNaN(Number(val))) {
        errors.push(`第 ${r + 1} 行样本 '${sampleCols[c - 1]}' 表达值不是有效数值: '${val}'`);
        break;
      }
    }
    if (errors.length >= 10) break;
  }

  return {
    ok: errors.length === 0,
    errors,
    samples: sampleCols,
    sampledRows: sampleRowCount,
  };
}

/**
 * 校验分组映射表（Group Table）。
 * 要求至少具备 sample_id 与 group 字段。
 */
export function validateGroupMapping(groups, pipeline = 'line1_bulk') {
  const errors = [];
  if (!Array.isArray(groups) || groups.length === 0) {
    return { ok: false, errors: ['分组映射表 (Group Table) 为空或不是数组'], groupStats: {} };
  }

  const sampleIds = new Set();
  const groupCounts = {};

  for (let i = 0; i < groups.length; i += 1) {
    const row = groups[i];
    if (!row || typeof row !== 'object') {
      errors.push(`第 ${i + 1} 行分组记录格式不合法`);
      continue;
    }
    const sid = String(row.sample_id || row.sample || '').trim();
    const grp = String(row.group || row.condition || '').trim();

    if (!sid) {
      errors.push(`第 ${i + 1} 行缺少 sample_id`);
      continue;
    }
    if (sampleIds.has(sid)) {
      errors.push(`分组表中样本 ID 重复: '${sid}'`);
    }
    sampleIds.add(sid);

    if (!grp) {
      errors.push(`样本 '${sid}' 缺少分组名称 (group)`);
      continue;
    }
    groupCounts[grp] = (groupCounts[grp] || 0) + 1;
  }

  const groupNames = Object.keys(groupCounts);
  if (groupNames.length < 2) {
    errors.push(`分析需要至少 2 个对比分组 (当前仅检测到: ${groupNames.join(', ') || '无'})`);
  }

  // 检查是否具备合理的对照与实验组定义
  const hasRef = groupNames.some((g) => /control|ctrl|normal|healthy|ref|wt/i.test(g));
  const hasTreat = groupNames.some((g) => /treat|case|disease|tumor|kd|ko/i.test(g));
  if (!hasRef || !hasTreat) {
    // 允许宽松形式，但记录警告建议
    if (groupNames.length < 2) {
      errors.push('必须明确标出对照组 (Control/Normal) 与实验组 (Treat/Disease)');
    }
  }

  // 分线生物学重复数门槛
  if (pipeline === 'line1_bulk' || pipeline === 'microarray' || pipeline === 'bulk_rnaseq') {
    for (const [gName, count] of Object.entries(groupCounts)) {
      if (count < 3) {
        errors.push(`Bulk 线生物学重复门槛未达标: 分组 '${gName}' 仅有 ${count} 个样本 (每组至少需要 3 例)`);
      }
    }
  } else {
    // scRNA-seq 或 Spatial
    for (const [gName, count] of Object.entries(groupCounts)) {
      if (count < 1) {
        errors.push(`分组 '${gName}' 样本数不可为 0`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    sampleIds: Array.from(sampleIds),
    groupStats: groupCounts,
  };
}

/**
 * 校验公共库 GEO 编号提单模式（模式 B）。
 */
export function validateGeoSubmission(payload) {
  const errors = [];
  const gse = String(payload.gse || '').trim().toUpperCase();
  const gpl = String(payload.gpl || '').trim().toUpperCase();
  const pipeline = payload.pipeline || 'line1_bulk';

  if (!gse) {
    errors.push('GEO 模式必须提供 GSE 编号 (如 GSE277173)');
  } else if (!GSE_REGEX.test(gse)) {
    errors.push(`GSE 编号格式非法: '${gse}'，应符合 '^GSE\\d+$' 格式`);
  }

  if (gpl && !GPL_REGEX.test(gpl)) {
    errors.push(`GPL 编号格式非法: '${gpl}'，应符合 '^GPL\\d+$' 格式`);
  }

  // 样本分组映射校验
  const groups = payload.groups || payload.group_mapping || [];
  const groupCheck = validateGroupMapping(groups, pipeline);
  if (!groupCheck.ok) {
    errors.push(...groupCheck.errors);
  } else {
    // 校验每个样本 ID 是否符合 GSM 规范
    for (const sid of groupCheck.sampleIds) {
      if (!GSM_REGEX.test(sid)) {
        errors.push(`GEO 模式下样本 ID 应符合 GSM 编号规范: '${sid}' (应形如 GSM1234567)`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    facts: {
      submission_mode: 'geo_accession',
      requires_external_download: true,
      gse,
      gpl: gpl || null,
      pipeline,
      groupStats: groupCheck.groupStats,
    },
  };
}

/**
 * 统一双模式总校验器。
 */
export function validateIntakeSubmission(payload, matrixSnippet = null) {
  const submissionMode = payload.submission_mode || (payload.gse ? 'geo_accession' : 'own_matrix');

  if (submissionMode === 'geo_accession') {
    return validateGeoSubmission(payload);
  }

  // 模式 A: 自有矩阵模式
  const errors = [];
  const pipeline = payload.pipeline || 'line1_bulk';
  const groups = payload.groups || payload.group_mapping || [];

  const groupCheck = validateGroupMapping(groups, pipeline);
  if (!groupCheck.ok) {
    errors.push(...groupCheck.errors);
  }

  let matrixSamples = [];
  if (matrixSnippet) {
    const matCheck = validateMatrixHeaderSnippet(matrixSnippet, payload.delimiter || '\t');
    if (!matCheck.ok) {
      errors.push(...matCheck.errors);
    } else {
      matrixSamples = matCheck.samples;
      // 双向 100% 对齐校验
      const groupSampleSet = new Set(groupCheck.sampleIds);
      const matrixSampleSet = new Set(matrixSamples);

      for (const ms of matrixSamples) {
        if (!groupSampleSet.has(ms)) {
          errors.push(`表达矩阵中的样本 '${ms}' 在分组设计表中不存在`);
        }
      }
      for (const gs of groupCheck.sampleIds) {
        if (!matrixSampleSet.has(gs)) {
          errors.push(`分组设计表中的样本 '${gs}' 在表达矩阵表头中不存在`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    facts: {
      submission_mode: 'own_matrix',
      requires_external_download: false,
      pipeline,
      sampleCount: matrixSamples.length || groupCheck.sampleIds?.length || 0,
      groupStats: groupCheck.groupStats || {},
    },
  };
}
