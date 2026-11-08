// T1-3 preview 溯源门禁自身的红测（第三十三轮 4 Argon Q3 裁定）。
//
// 判据三条：
//   1) 门禁必须把 ready 分成三桶：相等 / 分叉 / 无矩阵证据，且三桶之和等于 ready 数；
//   2) 分叉的必须让门禁退出码非 0（当前实测 9 条分叉，所以现在是红的）；
//   3) 无证据的只进 INFO 清单，不许阻断（否则会击穿 ready 基线）。
//
// 这条红测现在应当红：实测 EQ=3 / NEQ=9 / 无证据=18。
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPreviewProvenance } from '../../ops/figure_preview_provenance.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('门禁把 ready 分三桶且三桶之和等于 ready 数', () => {
  const r = checkPreviewProvenance();
  assert.equal(r.equal.length + r.diverged.length + r.noEvidence.length, r.ready,
    `三桶之和 ${r.equal.length}+${r.diverged.length}+${r.noEvidence.length} 不等于 ready ${r.ready}`);
  assert.equal(r.ready, 39, `ready 必须是 39，实际 ${r.ready}`);
});

test('分叉条目必须被单列出来并能定位到 runner（不许只报个数）', () => {
  const r = checkPreviewProvenance();
  for (const item of r.diverged) {
    assert.ok(item.id, '分叉条目必须有 id');
    assert.ok(item.registry && item.artifact, `${item.id} 必须同时给出 registry 与 artifact 的 sha`);
    assert.ok(item.runner, `${item.id} 必须给出来源 runner，否则无法定位该重渲染哪个母版`);
  }
});

test('磁盘预览必须与注册表逐字节一致（这一条现在应当是绿的）', () => {
  const r = checkPreviewProvenance();
  assert.deepEqual(r.diskDrift, [], '磁盘 preview 与注册表 sha 不符: ' + JSON.stringify(r.diskDrift.slice(0, 5)));
});

test('无矩阵证据的条目只能进 INFO，不许进分叉桶', () => {
  const r = checkPreviewProvenance();
  const noEvidenceIds = new Set(r.noEvidence.map((x) => x.id));
  const both = r.diverged.filter((x) => noEvidenceIds.has(x.id));
  assert.deepEqual(both, [], '同一条不能既算无证据又算分叉: ' + JSON.stringify(both));
});
test('注册表每条 ready 都必须显式声明 render_evidence（null 也是声明）', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure_templates.json'), 'utf8'));
  const templates = Array.isArray(reg) ? reg : (reg.templates || reg.entries || []);
  const ready = templates.filter((t) => t.deps_status === 'ready' && t.verified);
  const missing = ready.filter((t) => t.render_evidence === undefined);
  assert.deepEqual(missing.map((t) => t.id), [],
    '以下 ready 既没证据也没显式 null，欠账报不准: ' + missing.map((t) => t.id).join(', '));
  const withEvidence = ready.filter((t) => t.render_evidence);
  for (const t of withEvidence) {
    assert.ok(t.render_evidence.entry_id, `${t.id}: render_evidence 必须带 entry_id`);
    assert.match(t.render_evidence.sha256, /^[0-9a-f]{64}$/, `${t.id}: render_evidence.sha256 形态不对`);
    assert.equal(typeof t.render_evidence.matches_preview, 'boolean', `${t.id}: 必须显式声明是否与预览相等`);
  }
});

test('matches_preview=false 的条数与门禁分叉桶必须一一对应（两处口径不许漂移）', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src', 'figure_templates.json'), 'utf8'));
  const templates = Array.isArray(reg) ? reg : (reg.templates || reg.entries || []);
  const regFalse = new Set(templates
    .filter((t) => t.deps_status === 'ready' && t.render_evidence && t.render_evidence.matches_preview === false)
    .map((t) => t.id));
  const gate = checkPreviewProvenance();
  const gateDiverged = new Set(gate.diverged.map((x) => x.id));
  assert.deepEqual([...regFalse].sort(), [...gateDiverged].sort(),
    '注册表的 matches_preview=false 与门禁的 diverged 桶不一致：'
    + `registry-only=${[...regFalse].filter((x) => !gateDiverged.has(x))} `
    + `gate-only=${[...gateDiverged].filter((x) => !regFalse.has(x))}`);
});
