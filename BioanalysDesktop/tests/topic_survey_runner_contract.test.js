/**
 * 模式 A 调研 runner 的模块图契约。
 *
 * 背景：W8 把 con_hf/topic_survey/ 整体迁到 workspace/handoff/topic_survey/，
 * 文件是 git mv，内容零改动，但相对导入的深度多了一层，
 * 导致 runner 一启动就 ERR_MODULE_NOT_FOUND（表现即"检索工具不可用"）。
 *
 * 判据：不带参数启动时，模块图必须能完整解析并走到用法提示（退出码 2）。
 * 这一路径不触网，跑的是确定性分支。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const RUNNER = path.join(REPO, 'workspace', 'handoff', 'topic_survey', 'survey_run.mjs');

test('调研 runner 的相对导入可解析，无参数时输出用法并退出 2', () => {
  const r = spawnSync(process.execPath, [RUNNER], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr || r.stdout);
  assert.match(r.stdout, /用法：node survey_run\.mjs/);
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND/);
});
