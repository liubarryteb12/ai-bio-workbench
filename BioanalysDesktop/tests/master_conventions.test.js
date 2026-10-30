/**
 * coding-standards.md 第一条铁律的可执行化：Linux 运行面规范。
 *
 * 背景：2026-10-22 全库扫描发现 6 个分析母版里共 9 处 em dash（U+2014），
 * 违反 docs/coding-standards.md “不用 em dash（—）：注释与报告用逗号、冒号、句号、括号”。
 * 其中 ml_diagnostics 那处在字符串字面里里（会进交付报告正文），已改为全角冒号。
 * 本文件把这条规范针在母版范围内，防止再次潓现。
 *
 * 范围只包 src/<line>/scripts/ 下的步骤脚本 + src/bridge_guard.sh：
 * reference/ 是只读参考资料（规范不适用），con_hf/ 是台账，docs/ 是规范本身。
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const EM_DASH = String.fromCharCode(0x2014);

function masterFiles() {
  const out = [];
  for (const line of ['line1_bulk', 'line2_scrna', 'line3_spatial']) {
    const dir = path.join(REPO, 'src', line, 'scripts');
    for (const name of fs.readdirSync(dir)) {
      // README.md 不部署（ops/06_deploy_scripts.ps1 明确排除），不是步骤脚本，不受母版规范约束
      if (name === 'README.md') continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isFile()) out.push(full);
    }
  }
  out.push(path.join(REPO, 'src', 'bridge_guard.sh'));
  return out;
}

/** seed / 参数合约的受检集合：除守卫与冗余桩外的步骤母版 */
function stepMasterFiles() {
  return masterFiles().filter((f) => path.basename(f) !== 'bridge_guard.sh');
}

/**
 * 母版语言分流。
 *
 * task.js 已支持两种母版形态：bash 包装器 + python heredoc，以及纯 R 脚本
 * （RSCRIPT_CALL_RE 与 Rscript 垫片就是为它准备的）。契约按语言分别表述：
 *   bash 母版：set -euo pipefail、seed="${BIOANALYS_SEED:-UNSET}" + exit 3、*) exit 2
 *   R 母版：   quit(status=N)，退出码 2 参数 / 3 种子 / 1 自校验
 * 用 bash 专有正则去量 R 母版会假红（R 写的是 quit(status=3)，不是 exit 3）。
 *
 * 判据是 shebang 里有没有 Rscript，与 task.js 判别母版语言的依据一致。
 */
function languageOf(file) {
  const first = fs.readFileSync(file, 'utf8').split('\n')[0] || '';
  return /Rscript/.test(first) ? 'r' : 'bash';
}
function byLanguage(lang) {
  return stepMasterFiles().filter((f) => languageOf(f) === lang);
}

test('母版不得含 em dash（coding-standards 第一条铁律）', () => {
  const offenders = [];
  for (const file of masterFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const count = text.split(EM_DASH).length - 1;
    if (count > 0) {
      offenders.push(path.relative(REPO, file) + ' 含 ' + count + ' 处 em dash');
    }
  }
  assert.deepEqual(offenders, [], '规范要求注释与报告用逗号/冒号/句号/括号，不用 em dash');
});

test('母版必须 LF-only + shebang + set -euo pipefail', () => {
  const problems = [];
  for (const file of byLanguage('bash')) {
    const rel = path.relative(REPO, file);
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(String.fromCharCode(13))) problems.push(rel + ': 含 CR');
    if (!text.startsWith('#!')) problems.push(rel + ': 缺 shebang');
    if (!/^set -euo pipefail$/m.test(text)) problems.push(rel + ': 缺 set -euo pipefail');
  }
  assert.deepEqual(problems, [], 'docs/coding-standards.md 规定母版必须 shebang + 严格模式 + LF');
});

test('R 母版必须 shebang 指向 Rscript 垫片 + LF-only', () => {
  // R 没有 set -euo pipefail，严格模式由 quit(status=N) 表达，见下一个测试。
  const problems = [];
  for (const file of byLanguage('r')) {
    const rel = path.relative(REPO, file);
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(String.fromCharCode(13))) problems.push(rel + ': 含 CR');
    if (!/^#!.*Rscript/.test(text.split('\n')[0] || '')) {
      problems.push(rel + ': shebang 不是 Rscript 垫片（应为 ops/layout_autoload/bin/Rscript）');
    }
  }
  assert.deepEqual(problems, [], 'R 母版走 Rscript 垫片，见 task.js 的 RSCRIPT_CALL_RE');
});


test('seed 合约：缺失即 exit 3，不给默认种子', () => {
  const problems = [];
  for (const file of byLanguage('bash')) {
    const rel = path.relative(REPO, file);
    const text = fs.readFileSync(file, 'utf8');
    // 两种合法形态，判据统一为「seed 赋值语句里出现 BIOANALYS_SEED，其后紧接 exit 3」：
    //   旧：seed="${BIOANALYS_SEED:-UNSET}"
    //   新：seed_value="${seed_override:-${BIOANALYS_SEED:-}}"，允许 --seed 显式覆盖
    // 之所以不写死 ${BIOANALYS_SEED:-UNSET}：新形态更完善（调用方可显式给种子），
    // 且默认值仍是空串而非数字。把更优实现判成违规，是测试判据落后于实现。
    const m = text.match(/seed(?:_value)?=[^;\n]*BIOANALYS_SEED[^;\n]*[\s\S]{0,300}?exit 3/);
    if (!m) {
      problems.push(rel + ': 缺 seed 缺失检查');
      continue;
    }
    // 哨兵值不能是数字（数字就等于给了默认种子）
    if (/BIOANALYS_SEED:-\d/.test(text)) {
      problems.push(rel + ': seed 默认值是数字，等于静默默认种子');
    }
  }
  assert.deepEqual(problems, [], 'docs/coding-standards.md: BIOANALYS_SEED 必须由引擎注入，缺失即 exit 3');
});

test('R 母版 seed 契约：BIOANALYS_SEED 缺失时 quit(status=3)', () => {
  // R 侧写法是 Sys.getenv("BIOANALYS_SEED", unset="") + quit(status=3)，
  // 不是 bash 的 ${VAR:-UNSET} + exit 3。用 bash 正则量 R 会假红。
  const problems = [];
  for (const file of byLanguage('r')) {
    const rel = path.relative(REPO, file);
    const text = fs.readFileSync(file, 'utf8');
    if (!/BIOANALYS_SEED/.test(text)) {
      problems.push(rel + ': 未读 BIOANALYS_SEED');
      continue;
    }
    // 读环境变量时必须给 unset=""，否则缺失时拿到的是 NULL 而不是空串
    if (!/BIOANALYS_SEED["']?\s*,?\s*unset\s*=\s*["']{2}/.test(text)) {
      problems.push(rel + ': BIOANALYS_SEED 未设 unset=""，缺失时行为不确定');
    }
    // R 母版把三个退出码收进 fail_input / fail_seed / fail_selfcheck 三个函数
    // （quit(status=2/3/1)）。所以断言分两步，不能按文本顺序找 quit：
    //   ① 有函数以 quit(status=3) 收尾，即"种子失败"的出口存在
    //   ② seed 缺失的那一行确实调用了它，而不是 print 一句继续跑
    const hasQuit3 = /quit\([^)]*status\s*=\s*3/.test(text);
    if (!hasQuit3) {
      problems.push(rel + ': 缺 quit(status=3) 出口');
      continue;
    }
    // ② 缺失判断与出口。R 侧形态是：
    //      seed_text <- ... Sys.getenv("BIOANALYS_SEED", unset = "")
    //      if (!nzchar(seed_text)) { fail_seed(...) }
    //    判据取"读到 BIOANALYS_SEED" + "有空值判断" + "fail_seed 出口"三件事都在，
    //    不规定它们的先后顺序，因为 --seed 覆盖与环境变量回落的写法因人而异。
    if (!/BIOANALYS_SEED/.test(text)) {
      problems.push(rel + ': 未读 BIOANALYS_SEED');
    } else if (!/!nzchar\(\s*\w*seed/i.test(text)) {
      problems.push(rel + ': 缺 seed 空值判断（应为 !nzchar(seed_text)）');
    } else if (!/fail_seed\s*\(/.test(text)) {
      problems.push(rel + ': 缺 fail_seed 出口');
    }
    // 不许出现硬编码数字种子当默认值
    if (/set\.seed\(\s*\d{3,}\s*\)/.test(text)) {
      problems.push(rel + ': 出现硬编码 set.seed(数字)，等于隐式默认种子');
    }
  }
  assert.deepEqual(problems, [], 'coding-standards.md 退出码铁律：3 = 种子未注入');
});

test('参数合约：未知参数必须 exit 2', () => {
  const problems = [];
  for (const file of byLanguage('bash')) {
    const rel = path.relative(REPO, file);
    const text = fs.readFileSync(file, 'utf8');
    if (!/^\s*\*\)\s.*exit 2/m.test(text)) {
      // *) 分支与 exit 2 之间允许夹 echo / 帮助文案，只要同一个 case 分支里出现即可
      if (!/^\s*\*\)[\s\S]{0,600}?exit 2/m.test(text)) {
        problems.push(rel + ': 缺 *) 未知参数分支落 exit 2');
      }
    }
  }
  assert.deepEqual(problems, [], 'docs/coding-standards.md: 只认 --input/--output/--seed，其余参数 exit 2');
});

test('R 母版参数契约：未知参数必须 quit(status=2)', () => {
  const problems = [];
  for (const file of byLanguage('r')) {
    const rel = path.relative(REPO, file);
    const text = fs.readFileSync(file, 'utf8');
    // R 侧形态：while 循环里 if (!flag %in% names(map)) fail_input(...)，
    // fail_input 统一 quit(status=2)
    if (!/commandArgs\(trailingOnly/.test(text)) {
      problems.push(rel + ': 未用 commandArgs 解析参数');
    }
    if (!/quit\([^)]*status\s*=\s*2/.test(text)) {
      problems.push(rel + ': 缺 quit(status=2) 分支');
    }
    if (!/--input/.test(text) || !/--output/.test(text)) {
      problems.push(rel + ': 未声明 --input / --output');
    }
  }
  assert.deepEqual(problems, [], 'coding-standards.md 退出码铁律：2 = 参数或输入契约违背');
});


test('bash 包装 + python heredoc 必须闭合（改到母版尾部时的高频故障）', () => {
  const problems = [];
  for (const file of byLanguage('bash')) {
    const rel = path.relative(REPO, file);
    const text = fs.readFileSync(file, 'utf8');
    // 每个 <<'PYSCRIPT' 必须有独占一行的 PYSCRIPT 结束标记
    const opens = (text.match(/<<'PYSCRIPT'/g) || []).length;
    const closers = (text.match(/^PYSCRIPT\s*$/gm) || []).length;
    if (opens !== closers) {
      problems.push(rel + ': PYSCRIPT 开=' + opens + ' 闭=' + closers);
    }
    // 结束标记前不得有非空白内容（因为上一行没有换行）
    if (/[^\s]PYSCRIPT\s*$/.test(text)) {
      problems.push(rel + ': PYSCRIPT 标记前缺换行（上一行将其咬合进来了）');
    }
  }
  assert.deepEqual(problems, [], 'bash 包装的 python heredoc 必须正确闭合，否则整个步骤无法执行');
});


test('出图步骤必须落产物清单 figures_manifest.txt（本轮新增）', () => {
  // 背景：出图步骤以前只把清单打到 stdout，任务重跑与事后核对时清单就沦了。
  // 规范依据：coding-standards.md “自校验内建 + 产物结构对账”，以及 aims §五 出图规范的可核对要求。
  const FIG_STEPS = [
    'src/line1_bulk/scripts/bulk_figures',
    'src/line1_bulk/scripts/enrichment_figures',
    'src/line2_scrna/scripts/enrichment_figures',
    'src/line2_scrna/scripts/scenic_figures',
    'src/line3_spatial/scripts/enrichment_figures',
    'src/line3_spatial/scripts/spatial_figures',
  ];
  const problems = [];
  for (const rel of FIG_STEPS) {
    const text = fs.readFileSync(path.join(REPO, rel), 'utf8');
    if (!text.includes('figures_manifest.txt')) {
      problems.push(rel + ': 缺 figures_manifest.txt 落盘');
    }
    // 落盘必须在 try 里：不让清单写失败把整个出图步骤带走（图已经出好了）
    const manIdx = text.indexOf('figures_manifest.txt');
    const before = text.slice(Math.max(0, manIdx - 400), manIdx);
    if (!/try:\s*$/m.test(before)) {
      problems.push(rel + ': manifest 落盘未放进 try（不该因清单写失败而改变步骤退出码）');
    }
    // 必须记实际字节数（否则“exit 0 但产物落别处”仍然核不出来）
    if (!text.includes('os.path.getsize')) {
      problems.push(rel + ': manifest 未记实际字节数');
    }
  }
  assert.deepEqual(problems, [], '出图步骤必须落一份可核对的产物清单');
});

test('line1 富集出图必须把空 TSV 当作可选输入跳过', () => {
  const file = path.join(
    REPO,
    'src/line1_bulk/scripts/enrichment_figures',
  );
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/def rd\(name\):\n([\s\S]*?)(?=\n\ndef )/);
  assert.ok(match, 'enrichment_figures 必须保留 rd(name) 读取入口');
  const body = match[1];
  assert.match(
    body,
    /pd\.errors\.EmptyDataError/,
    '空 TSV 会触发 EmptyDataError，rd() 必须显式接住并跳过',
  );
  assert.match(
    body,
    /log\(/,
    '跳过空 TSV 时必须在 stdout 留下可审计记录',
  );
});

test('qc_matrix 离群样本必须标记复核，不删除样本且不阻断下游', () => {
  const file = path.join(REPO, 'src/line1_bulk/scripts/qc_matrix');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(
    text,
    /qc_gate=%s/,
    'qc_report.txt 必须写出动态 qc_gate',
  );
  assert.match(
    text,
    /review_required/,
    '检出离群样本时 qc_gate 必须为 review_required',
  );
  assert.match(
    text,
    /outlier_policy=mark_only_not_removed/,
    'qc_report.txt 必须明确记录离群样本只标记不删除',
  );
  assert.doesNotMatch(
    text,
    /if\s*\(length\(outliers\)\s*>\s*0\)\s*\{\s*fail\(/s,
    '检出离群样本不能直接 fail，必须保留样本并交给人工复核',
  );
});

test('ml_hub_analysis 必须从项目主对照解析阳性组，不写死 LS/NLS', () => {
  const file = path.join(REPO, 'src/line1_bulk/scripts/ml_hub_analysis');
  const text = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(
    text,
    /grp\s*==\s*["']LS["']/,
    'R 侧不得把阳性组写死为 LS',
  );
  assert.doesNotMatch(
    text,
    /g\s*==\s*["']LS["']/,
    'Python 侧不得把阳性组写死为 LS',
  );
  assert.match(
    text,
    /_ml_groups\.tsv/,
    'R 与 Python 必须共享项目主对照解析结果',
  );
  assert.match(
    text,
    /contrasts/,
    '分组解析必须读取 project.json 的 contrasts',
  );
});

test('prep_matrix 必须兼容 GSM<TAB>group 两列分组表', () => {
  const file = path.join(REPO, 'src/line1_bulk/scripts/prep_matrix');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(
    text,
    /grepl\("\^GSM\[0-9\]",\s*trimws\(fields\[1\]\)\)/,
    '首列是 GSM 的两列分组表必须走 sample/group 分支',
  );
  assert.match(
    text,
    /grouping_map\[\[grouping_tag\]\]\s*<-\s*c\(/,
    '两列格式必须把同组样本累积到同一个分组键',
  );
});

test('prep_matrix 在 GEO tissue 无分组时必须回退用户分组表并留痕', () => {
  const file = path.join(REPO, 'src/line1_bulk/scripts/prep_matrix');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(
    text,
    /grouping_group_values/,
    'GEO 元数据无法派生分组时必须构造 grouping_group_values',
  );
  assert.match(
    text,
    /group_source/,
    '报告必须记录分组来源，避免把用户分组伪装成 GEO 元数据',
  );
});

test('prep_matrix 芯片路径必须用 GSM 作为稳定样本键', () => {
  const file = path.join(REPO, 'src/line1_bulk/scripts/prep_matrix');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(
    text,
    /sample_labels\s*<-\s*if\s*\(identical\(prep_mode,\s*"counts_rnaseq"\)\)\s*sample_names\s+else\s+gsm_cols/,
    '芯片路径必须使用 series matrix 的 GSM 列名，不能使用可重复的 GEO title',
  );
  assert.doesNotMatch(
    text,
    /sample_labels\s*<-\s*if\s*\(identical\(prep_mode,\s*"counts_rnaseq"\)\)\s*sample_names\s+else\s+title_values/,
    'title 只用于展示，不能作为项目样本主键',
  );
});
