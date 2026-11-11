/**
 * 点点点跑分析的入口契约。
 *
 * 判据：
 *   1. 源码启动器与便携包生成器都自动打开浏览器，并保留本地免鉴权口径。
 *   2. 收件箱列表透出客户已选的 Mod ID，管理员无需手输步骤名。
 *   3. 作业中心生成工单后能直接带确认入队。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(REPO, relative), 'utf8');
}

test('三个启动器自动打开对应的本地页面', () => {
  assert.match(read('start_workbench.bat'), /start\s+""\s+"http:\/\/127\.0\.0\.1:18787\/"/);
  assert.match(read('start_portal.bat'), /start\s+""\s+"http:\/\/127\.0\.0\.1:8080\/"/);
  assert.match(read('start_all.bat'), /start\s+""\s+"http:\/\/127\.0\.0\.1:18787\/"/);
  assert.match(read('start_all.bat'), /start\s+""\s+"http:\/\/127\.0\.0\.1:8080\/"/);
});

test('便携包启动器自动打开页面并沿用本地免鉴权口径', () => {
  const builder = read('tools/dev/build_portable_package.mjs');
  assert.match(builder, /BIO_ALLOW_DEV_NOAUTH=1/);
  assert.match(builder, /start "" "http:\/\/127\.0\.0\.1:18787\/"/);
  assert.match(builder, /start-workbench\.cmd/);
});

test('收件箱列表透出客户已选的 Mod ID', () => {
  assert.match(read('BioanalysDesktop/server/portal_inbox.js'), /modIds:/);
  const view = read('BioanalysDesktop/src/views/WorkOrderCenterView.tsx');
  assert.match(view, /modIds\?: string\[\]/);
  assert.match(view, /item\.summary\?\.modIds/);
});

test('作业中心把生成工单与确认入队收成一次点击', () => {
  const view = read('BioanalysDesktop/src/views/WorkOrderCenterView.tsx');
  assert.match(view, /一键分析并排队/);
  assert.match(view, /\/api\/work-orders\/from-package/);
  assert.match(view, /`\/api\/work-orders\/\$\{encodeURIComponent\(workOrderId\)\}\/run`/);
  assert.match(view, /confirm:\s*true/);
});
