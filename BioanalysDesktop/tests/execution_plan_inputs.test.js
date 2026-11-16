/**
 * 执行计划输入角色解析：注册表写角色名，运行时必须落成真实文件路径。
 *
 * 2026-11-15 真机冒烟回归：门户上传的 counts 矩阵是 .csv，旧正则只认 txt/tsv，
 * 结果 series_matrix 角色解析不到，prep_matrix 只收到 grouping 就退出 2。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTaskInputs } from '../server/services/execution_plan.service.js';

test('counts.csv 能解析到 series_matrix 角色，grouping.txt 同步解析', () => {
  const rawFiles = [
    'train_matrix__GSE99002__counts.csv',
    'group_map__grouping.txt',
  ];
  const resolved = resolveTaskInputs(
    'PRJ_TEST',
    'line1_bulk',
    ['series_matrix', 'gpl', 'grouping.txt'],
    rawFiles,
  );
  assert.deepEqual(resolved, [
    '/mnt/ssd/bio_data/projects/PRJ_TEST/line1_bulk/raw_data/train_matrix__GSE99002__counts.csv',
    '/mnt/ssd/bio_data/projects/PRJ_TEST/line1_bulk/raw_data/group_map__grouping.txt',
  ]);
});

test('txt 与 tsv 矩阵仍按原规则解析，不被 csv 扩容破坏', () => {
  const rawFiles = ['GSE1_counts.tsv', 'grouping.txt'];
  const resolved = resolveTaskInputs(
    'PRJ_TEST',
    'line1_bulk',
    ['series_matrix', 'grouping.txt'],
    rawFiles,
  );
  assert.deepEqual(resolved, [
    '/mnt/ssd/bio_data/projects/PRJ_TEST/line1_bulk/raw_data/GSE1_counts.tsv',
    '/mnt/ssd/bio_data/projects/PRJ_TEST/line1_bulk/raw_data/grouping.txt',
  ]);
});
