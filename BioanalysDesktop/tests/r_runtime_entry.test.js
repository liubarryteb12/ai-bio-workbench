import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readRepoFile = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const shim = readRepoFile('tools/ops/layout_autoload/bin/Rscript');
const rprofile = readRepoFile('tools/ops/layout_autoload/Rprofile');
const linkCheck = readRepoFile('tools/ops/00_link_check.ps1');
const linkModule = readRepoFile('BioanalysDesktop/server/link.js');

test('Rscript shim 固定使用 R 4.5.3 并注入模板 profile', () => {
  assert.match(shim, /REAL_RSCRIPT="\/opt\/R\/4\.5\.3\/bin\/Rscript"/);
  assert.match(shim, /export R_LIBS_USER=\/opt\/R\/4\.5\.3-site-library/);
  assert.match(
    shim,
    /export R_PROFILE_USER=\/mnt\/ssd\/bio_data\/ops\/layout_autoload\/Rprofile/
  );
  assert.doesNotMatch(shim, /REAL_RSCRIPT="\/usr\/bin\/Rscript"/);
});

test('Rprofile 在模板调用期间清理 NA x 轴标签', () => {
  assert.match(rprofile, /labels\[is\.na\(labels\)\] <- ""/);
  assert.match(rprofile, /plot <- apply_layout_safely\(plot, spec\)/);
});

test('Rprofile 把缺失的 ggsave 尺寸归一化为 NA', () => {
  assert.match(rprofile, /if \(length\(value\) == 0L\) return\(NA_real_\)/);
  assert.match(rprofile, /cur_w <- as_optional_number\(override\$width\)/);
  assert.match(rprofile, /cur_h <- as_optional_number\(override\$height\)/);
});

test('链路探针统一调用 layout_autoload shim', () => {
  const shimPath = '/mnt/ssd/bio_data/ops/layout_autoload/bin/Rscript';
  assert.ok(linkCheck.includes(shimPath));
  assert.match(linkModule, /ADB 单通道/);
  assert.ok(!linkCheck.includes('/usr/bin/Rscript'));
  assert.ok(!linkModule.includes('/usr/bin/Rscript'));
});
