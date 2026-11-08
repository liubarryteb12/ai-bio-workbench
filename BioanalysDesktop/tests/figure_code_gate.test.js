/**
 * 第 20 道门禁 figure_code_gate 契约（Argon 第 76 轮，MUT-FIGCODE-B 单测面）。
 * 真源全绿 + 夹具违规必拦 + 审计器缺失 Fail-Closed。探针走进程隔离临时目录（REJ-010）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFigureCode, BLOCKING_KINDS } from '../../ops/figure_code_gate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIT = path.join(REPO, 'cn_debug', 'figure_code_audit.py');

function makeProbe(t, masterBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `figcode-test-${process.pid}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'cn_debug'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'line1_bulk', 'scripts'), { recursive: true });
  fs.copyFileSync(AUDIT, path.join(root, 'cn_debug', 'figure_code_audit.py'));
  if (masterBody !== null) {
    fs.writeFileSync(path.join(root, 'src', 'line1_bulk', 'scripts', 'probe_fig'), masterBody);
  }
  return root;
}

const COMPLIANT = '#!/usr/bin/env bash\nset -euo pipefail\npython3 - <<\'PYSCRIPT\'\nimport matplotlib\nmatplotlib.use("Agg")\nimport matplotlib.pyplot as plt\nplt.rcParams.update({"savefig.dpi": 300, "font.size": 8})\nfig = plt.figure()\nfig.savefig("figures/x.png", dpi=300)\nplt.close("all")\nPYSCRIPT\n';

test('真源出图源码规范全绿（blocking=0）', () => {
  const res = checkFigureCode(REPO);
  assert.equal(res.ok, true, JSON.stringify(res.byKind));
  assert.equal(res.blocking, 0);
});

test('MUT-FIGCODE-B 夹具：fontsize=6 必须被拦（ok=false, C4 blocking>0）', (t) => {
  const bad = COMPLIANT.replace('fig.savefig', 'fig.text(0.01, -0.02, "x", fontsize=6)\nfig.savefig');
  const root = makeProbe(t, bad);
  const res = checkFigureCode(root);
  assert.equal(res.ok, false, JSON.stringify(res.byKind));
  assert.ok(res.blocking > 0);
  assert.ok(res.byKind.C4_TINY_FONT >= 1);
});

test('合规探针放行（blocking=0）', (t) => {
  const root = makeProbe(t, COMPLIANT);
  const res = checkFigureCode(root);
  assert.equal(res.ok, true, JSON.stringify(res.byKind));
});

test('Fail-Closed：审计器缺失判失败而非静默放行', (t) => {
  const root = makeProbe(t, COMPLIANT);
  fs.rmSync(path.join(root, 'cn_debug', 'figure_code_audit.py'));
  const res = checkFigureCode(root);
  assert.equal(res.ok, false);
  assert.ok(res.errors.length > 0);
});

test('C13 探针：缺 plt.close 必须被硬阻断', (t) => {
  const root = makeProbe(t, COMPLIANT.replace('plt.close("all")\n', ''));
  const res = checkFigureCode(root);
  assert.equal(res.ok, false);
  assert.ok(res.byKind.C13_NO_CLOSE >= 1);
  assert.ok(BLOCKING_KINDS.has('C13_NO_CLOSE'));
});

test('C15 探针：图例放轴框下方必须被硬阻断', (t) => {
  const bad = COMPLIANT.replace(
    'fig.savefig',
    'ax = fig.add_subplot(111)\nax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.09))\nfig.savefig'
  );
  const root = makeProbe(t, bad);
  const res = checkFigureCode(root);
  assert.equal(res.ok, false, JSON.stringify(res.byKind));
  assert.ok(res.byKind.C15_LEGEND_BOTTOM >= 1);
  assert.ok(BLOCKING_KINDS.has('C15_LEGEND_BOTTOM'));
});
