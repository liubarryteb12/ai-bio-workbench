/**
 * 需求单结构唯一真源的契约测试（第二十九轮 ⑥）
 *
 * 守的是「一处定义、多处认同」：客户门户导出、门户服务端落盘、工作台建项，
 * 三边认的必须是同一份字段与同一组枚举。任何一边单独改动都会在这里先红。
 *
 * 不做的事：不引 ajv。本仓库 node 依赖只有 react/react-dom，为一条需求单
 * 引校验库不划算；这里只对 schema 用到的子集（type/required/enum/minItems/
 * minimum/exclusiveMinimum/exclusiveMaximum/maxItems）做递归判定，够守约定。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateRequirement, DATA_TYPE_IDS, DATASET_ROLES, CUTOFF_PROFILES,
  LEGACY_CUTOFF_PROFILES, GROUP_ROLES,
} from '../../shared/requirement_schema.mjs';
import { ANALYSIS_CUTOFFS, LEGACY_CUTOFF_PROFILES as SERVER_LEGACY } from '../server/project.js';
import { DATA_TYPE_IDS as SERVER_DATA_TYPES } from '../server/domain.js';

const REPO = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const SCHEMA_PATH = path.join(REPO, 'shared', 'requirement_schema.json');
const PORTAL = path.join(REPO, 'portal', 'index.html');

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const portalHtml = fs.readFileSync(PORTAL, 'utf8');

/** schema 子集判定器：返回错误串数组，空数组即通过 */
function checkAgainstSchema(value, node, at = '$') {
  const errs = [];
  if (!node || typeof node !== 'object') return errs;
  if (node.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${at} 应为对象`];
    for (const key of node.required || []) {
      if (!(key in value)) errs.push(`${at} 缺少必填字段 ${key}`);
    }
    for (const [key, sub] of Object.entries(node.properties || {})) {
      if (key in value) errs.push(...checkAgainstSchema(value[key], sub, `${at}.${key}`));
    }
  } else if (node.type === 'array') {
    if (!Array.isArray(value)) return [`${at} 应为数组`];
    if (node.minItems !== undefined && value.length < node.minItems) errs.push(`${at} 少于 ${node.minItems} 项`);
    if (node.maxItems !== undefined && value.length > node.maxItems) errs.push(`${at} 多于 ${node.maxItems} 项`);
    if (node.items) value.forEach((v, i) => errs.push(...checkAgainstSchema(v, node.items, `${at}[${i}]`)));
  } else if (node.type === 'string') {
    if (typeof value !== 'string') return [`${at} 应为字符串`];
    if (node.minLength !== undefined && value.length < node.minLength) errs.push(`${at} 长度小于 ${node.minLength}`);
    if (node.maxLength !== undefined && value.length > node.maxLength) errs.push(`${at} 长度超过 ${node.maxLength}`);
    if (node.enum && !node.enum.includes(value)) errs.push(`${at} 不在枚举内: ${JSON.stringify(value)}`);
  } else if (node.type === 'integer' || node.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${at} 应为数字`];
    if (node.type === 'integer' && !Number.isInteger(value)) errs.push(`${at} 应为整数`);
    if (node.minimum !== undefined && value < node.minimum) errs.push(`${at} 小于最小值 ${node.minimum}`);
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) errs.push(`${at} 必须大于 ${node.exclusiveMinimum}`);
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) errs.push(`${at} 必须小于 ${node.exclusiveMaximum}`);
  } else if (node.type === 'boolean') {
    if (typeof value !== 'boolean') errs.push(`${at} 应为布尔`);
  }
  return errs;
}

/** 一份门户现在真实会产出的完整需求单，作正路径基准 */
function goldenRequirement() {
  return {
    manifest_version: '1.0',
    submitted_at: '2026-11-04_120000',
    basicInfo: {
      name: '契约基准项目', description: '正路径', domain: '心脑血管',
      disease: 'Ischemic Stroke', species: 'Homo sapiens', nonTumorVerified: true,
    },
    dataSource: {
      source: 'GEO', dataType: 'microarray', data_source_mode: 'PUBLIC_DB',
      sampleCount: 54,
      tissue: 'Peripheral Blood / Skin',
      datasets: [
        { gse: 'GSE16561', gpl: 'GPL6883', role: 'train', sampleCount: 30, tissue: 'Peripheral Blood' },
        { gse: 'GSE16562', gpl: '', role: 'validation', sampleCount: 24, tissue: 'Skin' },
      ],
    },
    groupingDesign: {
      mode: 'two_group',
      groups: [
        { groupName: 'Control', role: 'reference', stageOrder: 0, colorHex: '#3B4992', sampleIds: ['GSM1', 'GSM2'] },
        { groupName: 'Stroke', role: 'disease_stage', stageOrder: 1, colorHex: '#EE0000', sampleIds: ['GSM3', 'GSM4'] },
      ],
      contrasts: [{ name: 'Stroke_vs_Control', case: 'Stroke', ctrl: 'Control', isPrimary: true }],
    },
    analysisCutoffs: { profile: 'standard', use_adj_p: true, adj_p_threshold: 0.02 },
    plotLayoutConfig: { templateId: 'template_4x3' },
    references: [],
    notes: '契约基准',
  };
}

test('shared/requirement_schema.json 可解析且顶层 required 就是建项三件套', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.required, ['basicInfo', 'dataSource', 'groupingDesign']);
});

test('正路径：门户会产出的完整需求单同时通过 schema 与共享校验器', () => {
  const doc = goldenRequirement();
  assert.deepEqual(checkAgainstSchema(doc, schema), [], 'schema 判定应全过');
  const res = validateRequirement(doc);
  assert.deepEqual(res.errors, [], '共享校验器应全过');
  assert.equal(res.ok, true);
});

test('两边口径一致：dataType / role / profile / 组角色枚举逐项相等', () => {
  const dsProps = schema.properties.dataSource.properties;
  assert.deepEqual([...DATA_TYPE_IDS].sort(), [...SERVER_DATA_TYPES].sort(),
    '门户与工作台的数据类型枚举必须同值');
  assert.deepEqual([...DATASET_ROLES].sort(), [...dsProps.datasets.items.properties.role.enum].sort(),
    '数据集用途枚举：schema 与共享校验器必须同值');
  assert.deepEqual(Object.keys(CUTOFF_PROFILES), [...schema.properties.analysisCutoffs.properties.profile.enum],
    '阈值档位枚举：schema 与共享校验器必须同值');
  assert.deepEqual(Object.keys(CUTOFF_PROFILES).sort(), Object.keys(ANALYSIS_CUTOFFS).sort(),
    '阈值档位：门户侧与工作台建项侧必须同值');
  assert.deepEqual(CUTOFF_PROFILES, ANALYSIS_CUTOFFS,
    '三档阈值数值：门户侧与工作台建项侧必须逐档相等，否则客户看到的口径与落盘口径不一致');
  assert.deepEqual(LEGACY_CUTOFF_PROFILES, SERVER_LEGACY,
    '历史档位名映射必须两边一致，否则历史需求单会在其中一侧被静默改判');
  assert.deepEqual([...GROUP_ROLES].sort(),
    [...schema.properties.groupingDesign.properties.groups.items.properties.role.enum].sort(),
    '分组角色枚举：schema 与共享校验器必须同值');
});

test('schema 声明的数据集行必填字段与门户实际写出的字段集合一致', () => {
  const required = schema.properties.dataSource.properties.datasets.items.required;
  for (const key of ['gse', 'role', 'sampleCount', 'tissue']) {
    assert.ok(required.includes(key), `datasets 行必填应含 ${key}`);
  }
  // 门户必须真的写出这四个字段，不能只在 schema 里声明
  assert.match(portalHtml, /sampleCount:/, '门户 datasets 行必须写 sampleCount');
  assert.match(portalHtml, /tissue:/, '门户 datasets 行必须写 tissue');
});

test('负路径：行级样本数缺一行，schema 与共享校验器都拒', () => {
  const doc = goldenRequirement();
  delete doc.dataSource.datasets[1].sampleCount;
  assert.notDeepEqual(checkAgainstSchema(doc, schema), []);
  const res = validateRequirement(doc);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /sampleCount/.test(e)), res.errors.join('；'));
});

test('负路径：对比对引用了不存在的组名，schema 层不拦但共享校验器必须拦（这条只有校验器能抓）', () => {
  const doc = goldenRequirement();
  doc.groupingDesign.contrasts[0].case = '不存在的组';
  assert.deepEqual(checkAgainstSchema(doc, schema), [], '纯结构 schema 抓不到引用完整性');
  const res = validateRequirement(doc);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /不是已命名的组/.test(e)), res.errors.join('；'));
});

test('负路径：基准组 0 个或 2 个都被拒，且报错点名基准组', () => {
  for (const roles of [['disease_stage', 'disease_stage'], ['reference', 'reference']]) {
    const doc = goldenRequirement();
    doc.groupingDesign.groups[0].role = roles[0];
    doc.groupingDesign.groups[1].role = roles[1];
    const res = validateRequirement(doc);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => /基准组/.test(e)), res.errors.join('；'));
  }
});

test('负路径：档位不在枚举、use_adj_p 缺失、阈值越界都被拒', () => {
  const bad = goldenRequirement();
  bad.analysisCutoffs = { profile: 'super_strict', use_adj_p: true };
  assert.ok(validateRequirement(bad).errors.some((e) => /profile 非法/.test(e)));

  const noFlag = goldenRequirement();
  delete noFlag.analysisCutoffs.use_adj_p;
  assert.ok(validateRequirement(noFlag).errors.some((e) => /use_adj_p 缺失/.test(e)));

  const outOfRange = goldenRequirement();
  outOfRange.analysisCutoffs.adj_p_threshold = 1.5;
  assert.ok(validateRequirement(outOfRange).errors.some((e) => /adj_p_threshold/.test(e)));
});

test('历史需求单（行级全空、只有项目级 sampleCount/tissue）仍放行，不被新规则挡在门外', () => {
  const legacy = goldenRequirement();
  for (const row of legacy.dataSource.datasets) {
    delete row.sampleCount;
    delete row.tissue;
  }
  const res = validateRequirement(legacy);
  assert.deepEqual(res.errors, [], res.errors.join('；'));
});

test('历史档位名（standard_sci / sensitive）在门户侧也认，且映射到新档位', () => {
  for (const [legacyName, target] of Object.entries(LEGACY_CUTOFF_PROFILES)) {
    const doc = goldenRequirement();
    doc.analysisCutoffs.profile = legacyName;
    const res = validateRequirement(doc);
    assert.deepEqual(res.errors, [], `历史档位名 ${legacyName} 应被放行`);
    assert.ok(target in CUTOFF_PROFILES);
  }
});
