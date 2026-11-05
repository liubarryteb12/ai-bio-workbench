import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// P10 内存削峰的静态契约。
// 本机没有 R/Python 分析环境，也不许连 K40，所以这里只读源码做静态断言：
// 断言的是「削峰结构还在、数值口径没被改」，不是运行时内存实测。
// 运行期峰值证据由脚本自己落到输出目录的 memory_peak.tsv（VmHWM，单位 MB）。
const SCRIPT = path.resolve(import.meta.dirname, '../../src/line2_scrna/scripts/virtual_knockout');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

const findIndex = (needle, from = 0) => {
  const at = SOURCE.indexOf(needle, from);
  assert.notEqual(at, -1, '源码里找不到: ' + needle);
  return at;
};

// 三个重内存阶段：装配 expr、建网（10 网 + 张量）、落盘（annot 副本 + out 副本）。
const STAGE_TRIMS = {
  assemble_expr: ['pop_counts', 'norm'],
  after_network: ['scn', 'qc_matrix'],
  write_h5ad: ['out', 'annot', 'dr_out', 'dr_indexed'],
};

test('脚本仍是 LF、无 em dash、shebang 与 set -euo pipefail 保留', () => {
  assert.equal(SOURCE.includes('\r\n'), false, '出现 CRLF（坑 #103）');
  assert.equal(SOURCE.includes('\u2014'), false, '出现 em dash');
  assert.ok(SOURCE.startsWith('#!/usr/bin/env bash\n'), 'shebang 被改动');
  assert.ok(SOURCE.includes('\nset -euo pipefail\n'), 'set -euo pipefail 被删除');
});

test('seed 契约未被破坏：BIOANALYS_SEED 缺失 exit 3，随机源仍只有它', () => {
  const guard = findIndex('if [ "$seed" = "UNSET" ]; then');
  const exit3 = findIndex('exit 3', guard);
  assert.ok(exit3 > guard, 'seed 缺失分支不再 exit 3');
  assert.ok(SOURCE.includes('seed_int = int(seed)'));
  assert.ok(SOURCE.includes('nc_kws={"random_state": seed_int}'));
  assert.ok(SOURCE.includes('td_kws={"random_state": seed_int}'));
});

test('三个重内存阶段各有 del + gc.collect() + record_peak，且 del 在 collect 之前', () => {
  for (const [stage, names] of Object.entries(STAGE_TRIMS)) {
    const at = findIndex('record_peak("' + stage + '")');
    const window = SOURCE.slice(Math.max(0, at - 900), at);
    const delAt = window.lastIndexOf('\ndel ');
    const gcAt = window.lastIndexOf('gc.collect()');
    assert.ok(delAt > -1, stage + ' 之前没有 del');
    assert.ok(gcAt > -1, stage + ' 之前没有 gc.collect()');
    assert.ok(delAt < gcAt, stage + ' 的 del 必须紧接 gc.collect()（先释放再回收）');
    for (const name of names) {
      assert.ok(window.includes('del ' + name + '\n'), stage + ' 没有释放 ' + name);
    }
  }
});

test('建网前有一次强制回收（等价 R 侧 gc(reset = TRUE)），且中途没有提前退出', () => {
  const call = findIndex('scn = st.scTenifoldKnk(');
  const before = SOURCE.slice(0, call);
  const gcAt = before.lastIndexOf('gc.collect()');
  assert.ok(gcAt > -1, '建网前没有 gc.collect()');
  const between = SOURCE.slice(gcAt, call);
  assert.equal(between.includes('fail('), false, '回收与建网之间还有校验分支，回收点没落在建网前');
  assert.ok(between.includes('record_peak("before_network")'), '建网前没有记录峰值');
});

test('memory_peak.tsv 是追加写（不是覆盖写），列顺序 stage/peak_rss_mb/timestamp', () => {
  assert.ok(SOURCE.includes('PEAK_FILE = "memory_peak.tsv"'));
  assert.ok(SOURCE.includes('PEAK_COLUMNS = ("stage", "peak_rss_mb", "timestamp")'));
  assert.ok(SOURCE.includes('open(PEAK_FILE, "a")'), '不是追加模式');
  assert.equal(/open\(\s*PEAK_FILE\s*,\s*"w"/.test(SOURCE), false, '出现覆盖写');
  assert.ok(SOURCE.includes('need_header = not os.path.exists(PEAK_FILE) or os.path.getsize(PEAK_FILE) == 0'),
    '表头会在每行前重复写');
  assert.ok(SOURCE.includes('"\\t".join(PEAK_COLUMNS)'), '表头不是按 PEAK_COLUMNS 生成');
});

test('峰值取自 /proc/self/status 的 VmHWM 并换算成 MB', () => {
  assert.ok(SOURCE.includes('open("/proc/self/status", "r")'));
  assert.ok(SOURCE.includes('line.startswith("VmHWM:")'));
  assert.ok(SOURCE.includes('round(int(line.split()[1]) / 1024.0, 1)'), 'VmHWM 没有换算成 MB');
});

test('峰值写入失败不致命：record_peak 捕获 OSError 且不调用 fail()', () => {
  const body = SOURCE.slice(findIndex('def record_peak(stage):'),
    findIndex('annotated_file = os.environ["ANNOTATED_FILE"]'));
  assert.ok(body.includes('except OSError as exc:'), '没有兜住写失败');
  assert.equal(body.includes('fail('), false, '写失败会把分析打成失败');
  assert.ok(body.includes('不影响分析'));
  const reader = SOURCE.slice(findIndex('def peak_rss_mb():'), findIndex('def record_peak(stage):'));
  assert.ok(reader.includes('except OSError:'), '读 /proc 失败没有兜底');
});

test('gc 调用只允许无参 gc.collect()，不得出现全局开关', () => {
  const calls = [...SOURCE.matchAll(/gc\.\w+\([^)]*\)/g)].map((m) => m[0]);
  assert.ok(calls.length >= 4, 'gc 回收点太少: ' + calls.length);
  for (const call of calls) {
    assert.equal(call, 'gc.collect()', '出现了带参数或非 collect 的 gc 调用: ' + call);
  }
  assert.equal(/\bgc\.(disable|enable|freeze|unfreeze|set_threshold|set_debug)\b/.test(SOURCE), false);
});

test('每个 del 的目标都先有赋值，且删除之后不再被引用（不会 NameError 或用已释放对象）', () => {
  const dels = [...SOURCE.matchAll(/^del (\w+)$/gm)];
  assert.ok(dels.length >= 8, 'del 数量 ' + dels.length);
  for (const m of dels) {
    const name = m[1];
    const at = m.index;
    const assigned = new RegExp('^[ \t]*' + name + '[ \t]*=', 'm').test(SOURCE.slice(0, at));
    assert.ok(assigned, name + ' 在 del 之前没有赋值');
    const tail = SOURCE.slice(at + m[0].length);
    assert.equal(new RegExp('\\b' + name + '\\b').test(tail), false, name + ' 在 del 之后仍被引用');
  }
});

test('数值口径与随机序列未变：常量原文一致、随机源仍只有 seed', () => {
  // 敲除基因已改成四级来源解析（P13），不再写死 TNF，因此不在这张常量表里；
  // 它的解析链路由下一条测试单独盯。
  const constants = [
    'POPULATION = "Psoriasis"', 'N_NETS = 10', 'N_SAMP_CELLS = 500',
    'N_COMP = 3', 'Q_VALUE = 0.9', 'TD_RANK = 3', 'MA_DIMS = 2', 'TOP_N = 20',
    'SIG_LEVEL = 0.05', 'QC_MIN_PERCENT = 0.05',
  ];
  for (const c of constants) {
    assert.ok(SOURCE.includes(c), '常量被改动: ' + c);
  }
  assert.equal(SOURCE.includes('KO_GENE = "TNF"'), false, 'Python 侧不许再把敲除基因写死成 TNF');
  assert.equal(SOURCE.includes('np.random'), false, '新增了 numpy 随机源');
  assert.equal(SOURCE.includes('import random'), false, '新增了 python random');
  assert.equal(SOURCE.includes('random.seed'), false, '新增了 random.seed');
  assert.ok(SOURCE.includes('"seed": seed_int'));
  assert.ok(SOURCE.includes('dr = scn.build()'));
});

test('敲除基因走四级来源解析（--ko-gene > BIO_KO_GENE > project.json > TNF 兜底）', () => {
  // Python 侧只认环境变量，不再写死基因
  assert.ok(SOURCE.includes('KO_GENE = os.environ.get("KO_GENE", "").strip()'), 'Python 侧必须从环境变量取敲除基因');
  assert.ok(SOURCE.includes('KO_GENE_SOURCE = os.environ.get("KO_GENE_SOURCE", "unknown")'), 'Python 侧必须记录来源渠道');
  assert.ok(/if not KO_GENE:\s*\n\s*fail\(/.test(SOURCE), '空基因必须 fail 而不是静默兜底');
  // bash 包装层四级来源齐全
  assert.ok(SOURCE.includes('--ko-gene)'), '缺 --ko-gene 参数');
  assert.ok(SOURCE.includes('BIO_KO_GENE'), '缺 BIO_KO_GENE 环境变量通道');
  assert.ok(SOURCE.includes('biological_priors'), '缺 project.json biological_priors 通道');
  assert.ok(SOURCE.includes('acl_and_output'), '缺 project.json acl_and_output 通道');
  assert.ok(SOURCE.includes('target_ko_gene'), '缺 target_ko_gene 字段');
  assert.ok(SOURCE.includes('fallback:TNF'), '缺 TNF 兜底标记');
  assert.ok(SOURCE.includes('KO_GENE="$ko_gene"'), 'bash 层没有把解析结果传给 Python 侧');
  assert.ok(SOURCE.includes('ko_gene_source'), '台账必须记录基因来源');
});

test('原有产物写入与自校验未删：三个产物文件、fail 分支、uns 键', () => {
  for (const f of ['ko_dr_genes.tsv', 'scrna_knockout.h5ad', 'knockout_report.txt']) {
    assert.ok(SOURCE.includes(f), '产物写入被删: ' + f);
  }
  const fails = [...SOURCE.matchAll(/\bfail\("/g)].length;
  assert.ok(fails >= 20, 'fail 自校验分支变少: ' + fails);
  assert.ok(SOURCE.includes('out.uns["virtual_knockout"] = {'));
  assert.ok(SOURCE.includes('out.var["tenifold_dr_available"]'));
  assert.ok(SOURCE.includes('out.var[dst_col] = dr_indexed[src_col].reindex(var_index).to_numpy()'));
});

test('峰值记录覆盖全流程阶段，顺序与阶段名固定', () => {
  const stages = [...SOURCE.matchAll(/record_peak\("(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(stages, [
    'load_inputs', 'assemble_expr', 'before_network', 'after_network', 'dr_ready', 'write_h5ad', 'done',
  ]);
});

test('其它 line2 母版未被本切片污染：gsva_pathways 等脚本没有 record_peak/memory_peak', () => {
  const dir = path.resolve(import.meta.dirname, '../../src/line2_scrna/scripts');
  const others = fs.readdirSync(dir).filter((name) => {
    if (name === 'virtual_knockout' || name === 'README.md') return false;
    // 只收文件：__pycache__ 之类的目录不是母版，readFileSync 会 EISDIR
    return fs.statSync(path.join(dir, name)).isFile();
  });
  assert.ok(others.includes('gsva_pathways'), '找不到 gsva_pathways，目录结构变了？');
  assert.ok(others.length >= 20, '同级脚本数量异常: ' + others.length);
  for (const name of others) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal(text.includes('record_peak'), false, name + ' 被写入了 record_peak');
    assert.equal(text.includes('memory_peak'), false, name + ' 被写入了 memory_peak');
  }
});
