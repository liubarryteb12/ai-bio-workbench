#!/usr/bin/env node
/**
 * T1-3 preview 溯源门禁（第三十三轮 4 Argon Q3 裁定）：
 *   有矩阵证据的 ready 强制 preview_sha256 === 同 runner 产物 sha；
 *   无矩阵证据的显式标 render_evidence: null 并输出清单，不阻断（避免击穿 ready 基线）。
 *
 * 为什么用 script_plot_matrix.json 而不是 r453_verification_report.json：
 * 实测（.tmp/probe_t13b.mjs）证明 report 的 artifacts[] 只有 file 与 runner，**没有 sha256**，
 * 拿 report 做恒等断言只能比文件名，等于什么都没验。matrix 的 artifacts[].sha256 才是真值。
 *
 * 用法：
 *   node tools/dev/figure_preview_provenance.mjs            # 检查，不通过 exit 1
 *   node tools/dev/figure_preview_provenance.mjs --json     # 机器可读输出
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIG_ROOT = path.join(REPO, 'references', '05.可参考生信代码', '可用代码预筛选', '源码');
const MATRIX = path.join(FIG_ROOT, '_meta', 'script_plot_matrix.json');
const REGISTRY = path.join(REPO, 'tools', 'bio', 'figure_templates.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** matrix 里所有 png artifact，按 basename 索引。 */
function matrixArtifacts() {
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  const out = new Map();
  for (const entry of matrix.entries || []) {
    for (const art of entry.artifacts || []) {
      const rel = art.relative_path;
      if (!rel || !rel.endsWith('.png')) continue;
      out.set(rel, {
        sha256: art.sha256, width: art.width, height: art.height,
        runner: entry.script_path, entry: entry.entry_id, ok: art.ok,
      });
    }
  }
  return out;
}

export function checkPreviewProvenance() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const templates = Array.isArray(registry) ? registry : (registry.templates || registry.entries || []);
  const ready = templates.filter((t) => t.deps_status === 'ready' && t.verified);
  const artifacts = matrixArtifacts();

  const equal = [];
  const diverged = [];
  const noEvidence = [];
  const diskDrift = [];
  // Argon 第 75 轮 MUT-FIG-C：draft 模板严禁携带预览实证字段（防半成品冒充交付预览）。
  const draftTaint = [];
  for (const t of templates) {
    const isDraft = t.status === 'draft' || (t.deps_status !== 'ready' && !t.verified);
    if (isDraft && (t.preview_sha256 || t.render_evidence)) {
      draftTaint.push({ id: t.id, reason: 'draft 携带 preview_sha256/render_evidence 实证字段' });
    }
  }

  for (const t of ready) {
    const previewBase = path.basename(t.preview || '');
    const previewFile = path.join(REPO, t.preview || '');
    if (!fs.existsSync(previewFile)) {
      diskDrift.push({ id: t.id, reason: 'preview 文件缺失', path: t.preview });
      continue;
    }
    const diskSha = sha256(previewFile);
    if (diskSha !== t.preview_sha256) {
      diskDrift.push({ id: t.id, reason: '磁盘 sha 与注册表 preview_sha256 不等', registry: t.preview_sha256, disk: diskSha });
    }
    const art = artifacts.get(previewBase);
    if (!art) { noEvidence.push({ id: t.id, preview: previewBase }); continue; }
    if (art.sha256 === t.preview_sha256) equal.push({ id: t.id, preview: previewBase, sha: art.sha256.slice(0, 8) });
    else diverged.push({ id: t.id, preview: previewBase, registry: t.preview_sha256.slice(0, 8), artifact: art.sha256.slice(0, 8), runner: art.runner });
  }

  return { ready: ready.length, equal, diverged, noEvidence, diskDrift, draftTaint };
}

function main() {
  const asJson = process.argv.includes('--json');
  /**
   * --info-only：把「预览与产物分叉」降级为 INFO，仍然 exit 0。
   *
   * 存在的理由（第三十三轮）：T1-3 门禁与 T1-2 重渲染有先后依赖。门禁先落地时,
   * 实测 9 条 ready 的预览来自另一次渲染，那是欠 T1-2 的账，不是新缺陷。
   * 直接用阻断模式挂进 gate:all，会让整个仓库从落地那一刻起 permanent red，
   * 团队很快就会习惯性绕过它，那比不装门禁更糟。
   * 所以先以 info 挂入把欠账显式化（每次 gate:all 都打印 9 条清单），
   * T1-2 重渲染完成、preview 回写之后，去掉这个开关即自动转为硬阻断。
   *
   * 磁盘漂移（preview 文件本身与注册表不符）不受该开关影响，始终阻断：
   * 那种情况说明有人手改了预览文件却没更新注册表，是必须当场修的错误。
   */
  const infoOnly = process.argv.includes('--info-only');
  const result = checkPreviewProvenance();
  const diskOk = result.diskDrift.length === 0;
  const provenanceOk = result.diverged.length === 0;
  const draftOk = (result.draftTaint || []).length === 0;
  const ok = (infoOnly ? diskOk : (diskOk && provenanceOk)) && draftOk;

  if (asJson) {
    console.log(JSON.stringify({ ok, ...result }, null, 2));
    return ok ? 0 : 1;
  }

  console.log(`preview 溯源：ready ${result.ready} 条，有矩阵证据 ${result.equal.length + result.diverged.length} 条，`
    + `无证据 ${result.noEvidence.length} 条`);
  console.log(`  相等 ${result.equal.length} / 分叉 ${result.diverged.length} / 磁盘漂移 ${result.diskDrift.length}`);

  if (result.noEvidence.length > 0) {
    console.log('\n[INFO] 以下 ready 无矩阵证据，render_evidence 记 null（不阻断）：');
    for (const item of result.noEvidence) console.log(`  - ${item.id}  (${item.preview})`);
  }
  if (result.diverged.length > 0) {
    console.log('\n[FAIL] 以下 ready 的 preview 与矩阵产物 sha 不等（预览来自另一次渲染）：');
    for (const item of result.diverged) {
      console.log(`  - ${item.id}  registry=${item.registry} artifact=${item.artifact} runner=${item.runner}`);
    }
  }
  if (result.diskDrift.length > 0) {
    console.log('\n[FAIL] 以下 ready 的 preview 磁盘字节与注册表不符：');
    for (const item of result.diskDrift) console.log(`  - ${item.id}  ${item.reason}`);
  }
  if ((result.draftTaint || []).length > 0) {
    console.log('\n[FAIL] 以下 draft 模板伪造实证字段（MUT-FIG-C）：');
    for (const item of result.draftTaint) console.log(`  - ${item.id}  ${item.reason}`);
  }

  if (infoOnly && provenanceOk === false) {
    console.log('\n[INFO] --info-only: ' + result.diverged.length + ' 条分叉记为欠账，等待 T1-2 重渲染回写。');
  }
  console.log(ok ? '\npreview 溯源通过' : '\npreview 溯源失败');
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
