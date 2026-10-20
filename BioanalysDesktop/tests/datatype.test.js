/**
 * 数据类型 → 分析线映射的单元测试。
 *
 * 这是用户端（portal）与工作台两端选线的共同依据，判定错就会跑错线，
 * 所以单独锁一份。纯函数，不依赖网络与手机。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LINES, DATA_TYPES, DATA_TYPE_IDS, DATATYPE_TO_LINE, resolveLineFromDataType,
} from '../server/domain.js';

test('四种数据类型都能解析到分析线', () => {
  assert.equal(resolveLineFromDataType('microarray'), 'line1_bulk');
  assert.equal(resolveLineFromDataType('bulk_rnaseq'), 'line1_bulk');
  assert.equal(resolveLineFromDataType('scrna'), 'line2_scrna');
  assert.equal(resolveLineFromDataType('spatial'), 'line3_spatial');
});

test('芯片与 bulk RNA-seq 同线但类型不合并（预处理路径不同）', () => {
  assert.notEqual(DATATYPE_TO_LINE.microarray, undefined);
  assert.notEqual(DATATYPE_TO_LINE.bulk_rnaseq, undefined);
  assert.ok(DATA_TYPE_IDS.includes('microarray') && DATA_TYPE_IDS.includes('bulk_rnaseq'));
});

test('缺失、空白与非法类型一律返回空串（交调用方回退推断）', () => {
  for (const bad of ['', '  ', 'bulk', 'RNA', undefined, null, 'line1_bulk']) {
    assert.equal(resolveLineFromDataType(bad), '', `应不解析: ${String(bad)}`);
  }
  assert.equal(resolveLineFromDataType('  spatial  '), 'line3_spatial', '应容忍首尾空白');
});

test('映射到的线必须都是合法分析线（防枚举漂移）', () => {
  for (const dt of DATA_TYPES) {
    assert.ok(LINES.includes(dt.line), `${dt.id} 映射到非法线: ${dt.line}`);
    assert.ok(dt.label && dt.id, '每条都要有 id 与 label');
  }
  assert.equal(DATA_TYPES.length, DATA_TYPE_IDS.length);
});
