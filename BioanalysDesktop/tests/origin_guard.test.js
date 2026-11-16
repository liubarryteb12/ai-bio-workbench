import test from 'node:test';
import assert from 'node:assert/strict';

import { isLoopbackOriginAllowed } from '../server/origin_guard.js';

test('同源 UI 与非浏览器客户端放行', () => {
  assert.equal(isLoopbackOriginAllowed({ 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(isLoopbackOriginAllowed({}), true);
  assert.equal(isLoopbackOriginAllowed({ 'sec-fetch-site': 'none' }), true);
});

test('跨源与同站请求拒绝', () => {
  assert.equal(isLoopbackOriginAllowed({ 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(isLoopbackOriginAllowed({ 'sec-fetch-site': 'same-site' }), false);
});
