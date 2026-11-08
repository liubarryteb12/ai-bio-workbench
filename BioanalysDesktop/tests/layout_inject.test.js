/**
 * 出图模板注入契约测试。
 *
 * 背景：客户在需求单选的 `plot_layout_config` 此前从未生效——母版脚本只做
 * 最低合规收口（layout guard），不读 project.json。修法是在任务脚本里注入
 * 解释器级外挂（Python sitecustomize / R R_PROFILE_USER）。
 *
 * 这些环境变量一旦漏注入，出图不会报错，只会静默按默认模板出——
 * 客户以为选了 Cell 宽幅，拿到的是 Nature 侧边。所以逐条锁死。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTaskScript } from '../server/task.js';

const base = {
  projectId: 'PRJ_001',
  lineId: 'line1_bulk',
  step: 'bulk_figures',
  inputs: [],
  outputs: [],
  seed: 20261013,
};

test('任务脚本注入 BIOANALYS_PROJECT_JSON 指向本项目 project.json', () => {
  const script = buildTaskScript(base);
  assert.match(script, /export BIOANALYS_PROJECT_JSON="\/mnt\/ssd\/bio_data\/projects\/PRJ_001\/project\.json"/);
});

test('Python 端：PYTHONPATH 包含 layout_autoload 目录', () => {
  const script = buildTaskScript(base);
  assert.match(script, /export PYTHONPATH="\/mnt\/ssd\/bio_data\/ops\/layout_autoload:/);
  // 保留原有 PYTHONPATH，避免覆盖掉别处注入的路径
  assert.match(script, /\$\{PYTHONPATH:-\}/);
});

test('R 端：R_PROFILE_USER 指向 layout_autoload/Rprofile', () => {
  const script = buildTaskScript(base);
  assert.match(script, /export R_PROFILE_USER="\/mnt\/ssd\/bio_data\/ops\/layout_autoload\/Rprofile"/);
});

test('R 端：BIOANALYS_LAYOUT_LIB 指向 bin/', () => {
  const script = buildTaskScript(base);
  assert.match(script, /export BIOANALYS_LAYOUT_LIB="\/mnt\/ssd\/bio_data\/bin"/);
});

test('R 端：Rscript 垫片排在 PATH 最前（母版脚本用 --vanilla 会跳过 profile）', () => {
  const script = buildTaskScript(base);
  const shimLine = script.indexOf('export PATH="/mnt/ssd/bio_data/ops/layout_autoload/bin:${PATH}"');
  const binLine = script.indexOf('export PATH="/mnt/ssd/bio_data/bin/line1_bulk:$PATH"');
  assert.ok(shimLine >= 0, '缺少 Rscript 垫片 PATH');
  assert.ok(binLine >= 0, '缺少本线 bin PATH');
  assert.ok(shimLine < binLine, '垫片必须在 PATH 注入顺序里排在前面');
});

test('项目 ID 非法时直接抛错，不生成任何路径（防注入/穿越）', () => {
  assert.throws(
    () => buildTaskScript({ ...base, projectId: '../evil' }),
    /项目 ID 非法/
  );
});

test('三条线都注入（不因 line 不同而漏）', () => {
  for (const lineId of ['line1_bulk', 'line2_scrna', 'line3_spatial']) {
    const script = buildTaskScript({ ...base, lineId, step: 'x_figures' });
    assert.match(script, /BIOANALYS_PROJECT_JSON=/, lineId);
    assert.match(script, /R_PROFILE_USER=/, lineId);
  }
});

test('注入不影响既有约定：cd 到本线 processed、PATH 注入本线 bin', () => {
  const script = buildTaskScript(base);
  assert.match(script, /cd \/mnt\/ssd\/bio_data\/projects\/PRJ_001\/line1_bulk\/processed/);
  assert.match(script, /export PATH="\/mnt\/ssd\/bio_data\/bin\/line1_bulk:\$PATH"/);
  assert.match(script, /export BIOANALYS_SEED="\$SEED"/);
});

test('非限流模式下同样注入（模板不依赖是否绑核）', () => {
  const throttled = buildTaskScript({ ...base, throttled: true });
  const plain = buildTaskScript({ ...base, throttled: false });
  for (const script of [throttled, plain]) {
    assert.match(script, /BIOANALYS_PROJECT_JSON=/);
    assert.match(script, /PYTHONPATH=/);
    assert.match(script, /R_PROFILE_USER=/);
  }
});
