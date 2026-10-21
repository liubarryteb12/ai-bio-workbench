/**
 * 回归守卫：容器内禁用 ps / pgrep / pkill（会 abort proot，杀掉在跑任务）。
 *
 * 背景（con_hf/pitfalls_ledger.md P-23）：2026-10-21 在 k40-ubuntu 容器里跑
 * `ps -eo ...` / `pgrep -a python3` 三次触发 proot 的
 * `./path/path.c:546: ... assertion "length1 > 0" failed`，
 * proot 收到 SIGABRT 整体退出，容器内正在跑的分析任务（已跑 31 分钟的 SCENIC）全部消失且不留台账。
 *
 * 因此：任何会把命令送进容器的脚本（文件里出现 k40-ubuntu 即视为会送进容器）
 * 都不得出现 guest 侧 ps / pgrep / pkill。判活改用 `echo ALIVE`、台账新增、产物 mtime。
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const GUEST_HOST = 'k40-ubuntu';
// guest 侧进程探针：ps -eo / ps -ef / ps aux / pgrep / pkill
const FORBIDDEN = /(^|[\s"';&|(\`])(pgrep|pkill)\b|\bps\s+-(eo|ef|aux|e|f)\b/;

function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && exts.some((ext) => e.name.endsWith(ext)))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('#') || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function findGuestProbes(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(GUEST_HOST)) return [];
  const hits = [];
  text.split('\n').forEach((line, idx) => {
    if (isCommentLine(line)) return;
    if (FORBIDDEN.test(line)) hits.push(`${path.relative(REPO, file)}:${idx + 1}: ${line.trim().slice(0, 120)}`);
  });
  return hits;
}

test('送进容器的脚本里不得出现 ps / pgrep / pkill（cn_debug）', () => {
  const files = listFiles(path.join(REPO, 'cn_debug'), ['.mjs', '.sh', '.ps1']);
  assert.ok(files.length > 5, `cn_debug 下应扫到多个脚本，实际 ${files.length}`);
  const hits = files.flatMap(findGuestProbes);
  assert.deepEqual(hits, [], `这些行会在容器里 abort proot（P-23）：\n${hits.join('\n')}`);
});

test('送进容器的脚本里不得出现 ps / pgrep / pkill（ops）', () => {
  const files = listFiles(path.join(REPO, 'ops'), ['.ps1', '.sh']);
  assert.ok(files.length > 5, `ops 下应扫到多个脚本，实际 ${files.length}`);
  const hits = files.flatMap(findGuestProbes);
  assert.deepEqual(hits, [], `这些行会在容器里 abort proot（P-23）：\n${hits.join('\n')}`);
});

test('服务端下发的远端命令也不得用 ps / pgrep', () => {
  const files = listFiles(path.join(REPO, 'BioanalysDesktop', 'server'), ['.js']);
  const hits = files.flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').flatMap((line, idx) => (
      !isCommentLine(line) && FORBIDDEN.test(line)
        ? [`${path.relative(REPO, file)}:${idx + 1}: ${line.trim().slice(0, 120)}`]
        : []
    ));
  });
  assert.deepEqual(hits, [], `服务端远端命令里出现进程探针：\n${hits.join('\n')}`);
});

test('line2 全链取证脚本用 echo ALIVE 判活，不再读 proot etime', () => {
  const file = path.join(REPO, 'cn_debug', '2026-10-21_m1_line2_chain.mjs');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(/function containerAlive\(\)/.test(text), '应保留 containerAlive() 探针');
  assert.ok(/ssh\('echo ALIVE'\)/.test(text), '判活必须用 echo ALIVE');
  assert.ok(!/ps -eo/.test(text), '不得残留 ps -eo 探针');
  assert.ok(/P-23/.test(text), '代码里要点明 P-23 出处');
});

test('P-23 台账条目记录了断言原文与禁令', () => {
  const text = fs.readFileSync(path.join(REPO, 'con_hf', 'pitfalls_ledger.md'), 'utf8');
  assert.ok(/### P-23 /.test(text), '缺 P-23 条目');
  assert.ok(/path\.c:546/.test(text), '要留 proot 断言原文定位（path.c:546）');
  assert.ok(/length1 > 0/.test(text), '要留断言原文（length1 > 0）');
  assert.ok(/signal 6 received/.test(text), '要留 SIGABRT 证据');
  assert.ok(/禁用/.test(text) && /pgrep/.test(text), '要写明禁用 ps/pgrep');
  assert.ok(/echo ALIVE|ls -t/.test(text), '要给出替代判活手段');
});

test('P-22 的「容器从不重启」结论已标注作废并指向 P-23', () => {
  const text = fs.readFileSync(path.join(REPO, 'con_hf', 'pitfalls_ledger.md'), 'utf8');
  const p22 = text.slice(text.indexOf('### P-22'), text.indexOf('### P-23'));
  assert.ok(p22.includes('更正') && p22.includes('P-23'), 'P-22 里要更正并指向 P-23');
});

test('ops/README.md 有「容器内禁用 ps / pgrep」小节与替代手段表', () => {
  const text = fs.readFileSync(path.join(REPO, 'ops', 'README.md'), 'utf8');
  assert.ok(text.includes('## 容器内禁用 ps / pgrep'), '缺该小节标题');
  assert.ok(text.includes("ssh k40-ubuntu 'echo ALIVE'"), '缺 echo ALIVE 替代手段');
  assert.ok(text.includes('P-23'), '要指向 P-23');
  assert.ok(text.includes('看不到') && text.includes('guest 进程'), '要提醒宿主 ps 看不到 guest 进程');
});
