import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// P13 pseudotime 不可达判据的静态契约。
// 背景（真 bug）：原自校验用「细胞类型白名单」UNREACHABLE_CELLTYPES 判定 dpt=inf 是否合法，
// 白名单只对某一份数据成立；本 E2E 项目 4587 细胞在 harmony kNN 图上分成 3 个连通分量，
// 免疫分量里含 T_cell/NK_ILC 与 16 个 mitotic 细胞，于是合法 inf 被误报成异常，链在第 12 步失败。
// 判据改为「inf 集合必须与根所在连通分量之外的细胞集合严格等价」，这是 scanpy DPT 的数学性质。
// 本机没有 scanpy 环境、也不许连 K40，所以这里只读源码做静态断言。
const SCRIPT = path.resolve(import.meta.dirname, '../../tools/bio/line2_scrna/scripts/pseudotime');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

const findIndex = (needle, from = 0) => {
  const at = SOURCE.indexOf(needle, from);
  assert.notEqual(at, -1, '源码里找不到: ' + needle);
  return at;
};

test('脚本仍是 LF、无 em dash、shebang 与 set -euo pipefail 保留', () => {
  assert.equal(SOURCE.includes('\r\n'), false, '出现 CRLF（坑 #103）');
  assert.equal(SOURCE.includes('\u2014'), false, '出现 em dash');
  assert.ok(SOURCE.startsWith('#!/usr/bin/env bash\n'), 'shebang 被改动');
  assert.ok(SOURCE.includes('\nset -euo pipefail\n'), 'set -euo pipefail 被删除');
});

test('不可达判据改为连通分量：用 obsp[connectivities] 算分量，再取根所在分量', () => {
  assert.ok(SOURCE.includes('from scipy.sparse.csgraph import connected_components'),
    '连通分量改用手写实现或换了库（scipy 已在环境里，零新依赖）');
  const call = findIndex('connected_components(adata.obsp["connectivities"], directed=False)');
  const rootComp = findIndex('root_comp = int(comp_labels[root_cell])', call);
  assert.ok(rootComp > call, '根所在分量必须在算完分量标签之后取');
  assert.ok(SOURCE.includes('off_comp = comp_labels != root_comp'), '缺少「非根分量」掩码');
});

test('双向判据：根分量内不许有 inf，分量外不许有有限值', () => {
  const offComp = findIndex('off_comp = comp_labels != root_comp');
  const wrongInf = findIndex('wrong_inf = int((inf_mask & ~off_comp).sum())', offComp);
  const wrongFinite = findIndex('wrong_finite = int((~inf_mask & off_comp).sum())', wrongInf);
  assert.ok(wrongFinite > wrongInf, '两个方向的反例统计顺序不对');
  assert.ok(findIndex('根连通分量内出现 dpt=inf', wrongInf) > wrongInf, '缺少「根分量内出现 inf」的 fail');
  assert.ok(findIndex('根分量外出现有限 dpt', wrongFinite) > wrongFinite, '缺少「分量外出现有限值」的 fail');
});

test('细胞类型豁免白名单已彻底移除，不许以任何形式回归', () => {
  assert.equal(SOURCE.includes('UNREACHABLE_CELLTYPES'), false, '白名单常量又回来了（只对单份数据成立）');
  assert.equal(SOURCE.includes('unreachable_celltypes'), false, '台账/报告里又写回了白名单键名');
  assert.ok(SOURCE.includes('unreachable_rule'), '缺少 unreachable_rule 说明（口径要写进 uns）');
});

test('谱系类型只做「整类全不可达」判定，部分细胞落到别的分量允许', () => {
  const loop = findIndex('for celltype in sorted(LINEAGE_CELLTYPES):');
  const whole = findIndex('if int((~np.isfinite(dpt[type_mask])).sum()) == int(type_mask.sum()):', loop);
  assert.ok(whole > loop, '谱系检查必须逐个类型比对「整类全 inf」');
  assert.ok(findIndex('的全部细胞 dpt=inf', whole) > whole, '缺少整类不可达的 fail 文案');
});

test('数值与随机口径未被顺手改动', () => {
  assert.ok(SOURCE.includes('N_DCS = 15'));
  assert.ok(SOURCE.includes('N_DPT_DCS = 10'));
  assert.ok(SOURCE.includes('ROOT_CELLTYPE = os.environ.get("BIO_PSEUDO_ROOT", "progenitor_keratinocyte")'),
    '根细胞类型必须可由 BIO_PSEUDO_ROOT 覆盖');
  assert.ok(SOURCE.includes('ROOT_DPT_TOL = 1e-6'));
  assert.ok(SOURCE.includes('MAX_DPT_TOL = 1e-4'));
  assert.ok(SOURCE.includes('sc.tl.dpt(adata, n_dcs=N_DPT_DCS, n_branchings=0, min_group_size=0.01)'));
  assert.ok(SOURCE.includes('if [ "$seed" = "UNSET" ]; then'));
  assert.ok(SOURCE.includes('exit 3'));
  assert.ok(SOURCE.includes('random_state=seed_int'), '随机源必须仍由 BIOANALYS_SEED 注入');
});

test('台账与报告写清连通分量，且分量统计在写 uns 之前完成', () => {
  const check = findIndex('log("components=%d root_comp=%d off_comp_cells=%d"');
  const unsWrite = findIndex('adata.uns["pseudotime"] = {');
  assert.ok(unsWrite > check, '先算分量并自校验，再写台账');
  const unsBlock = SOURCE.slice(unsWrite, findIndex('adata.uns["seed"] = seed_int', unsWrite));
  for (const key of ['"n_components"', '"root_component"', '"off_component_cells"']) {
    assert.ok(unsBlock.includes(key), 'uns[pseudotime] 缺少 ' + key);
  }
  assert.ok(SOURCE.includes('graph_components=%d（root_comp=%d）'), '报告行没写连通分量结论');
  assert.ok(SOURCE.includes('= 非根连通分量细胞数'), '报告行没把 dpt_inf 与非根分量细胞数对上');
});

test('注释里不出现小写 python3 裸词（会漂移 task_comment_strip 的调用计数）', () => {
  const CALL_RE = /(^|[\s;&|])python3?(?=[\s"']|$)/;
  const offenders = SOURCE.split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter((item) => /^\s*#/.test(item.line) && CALL_RE.test(item.line))
    .map((item) => item.no + ': ' + item.line.trim());
  assert.deepEqual(offenders, [], '注释里的 python3 会被 strip 删掉，导致计数漂移（见 task_comment_strip.test.js）');
});
