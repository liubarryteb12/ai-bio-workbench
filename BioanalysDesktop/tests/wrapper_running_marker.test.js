/**
 * 运行中标记（可观测性）：任务被容器 abort / 被 kill 时不会留下台账，只留一个标记文件。
 *
 * 背景：2026-10-21 SCENIC 跑到 31 分钟时 proot 被 abort（P-23），容器里所有进程一起死，
 * run_throttled_task.sh 没走到写台账那一步，system_logs/ 里什么都没有 —— 事后无法区分
 * 「没跑」「跑了被打断」「跑了但脚本崩了」。标记文件补上这一档。
 *
 * 约束（本测试守住）：
 * 1. 标记必须放在 system_logs/_running/ 子目录，不能混进 system_logs/*.json
 *    （ops/03_check_logs_remote.sh 按该通配逐个校验台账，混进去会被判 VIOLATION）；
 * 2. 正常结束时必须在**写完台账之后**才删标记，异常终止才留证据；
 * 3. 过期标记（>7 天）在脚本启动时清理，避免永久堆积。
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WRAPPER = path.join(REPO, 'ops', 'run_throttled_task.sh');
const CHECKER = path.join(REPO, 'ops', '03_check_logs_remote.sh');
const TEST_ROOT = path.join(REPO, 'artifacts', 'wrapper_running_marker_tests');
// 定位 bash：Git for Windows 自带 D:\Git\bin\bash.exe，PATH 里通常没有 bash（与其它真跑测试同口径）。
const BASH = [process.env.BIO_BASH, 'D:\\Git\\bin\\bash.exe', 'D:\\Git\\usr\\bin\\bash.exe', 'bash']
  .find((cand) => {
    if (!cand) return false;
    try {
      execFileSync(cand, ['-c', 'true'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
assert.ok(BASH, '找不到可用的 bash（可设 BIO_BASH 指向 Git 的 bash.exe）');
test.after(() => fs.rmSync(TEST_ROOT, { recursive: true, force: true }));

const src = fs.readFileSync(WRAPPER, 'utf8');

function markerBlock() {
  const start = src.indexOf('# --- 运行中标记');
  assert.ok(start > 0, 'run_throttled_task.sh 里找不到运行中标记段');
  const endMark = src.indexOf('echo "[wrapper] 运行中标记已落盘');
  assert.ok(endMark > start, '标记段缺少落盘回显');
  const end = src.indexOf('\n', endMark);
  return src.slice(start, end);
}

function stripStaleCleanup(block) {
  return block.replace(/\nnow_epoch=\$\(date \+%s\)\n[\s\S]*?\ndone\n/, '\n');
}

function toBashPath(value) {
  const text = path.resolve(value).replace(/\\/g, '/');
  const match = /^([A-Za-z]):\/(.*)$/.exec(text);
  return match ? `/${match[1].toLowerCase()}/${match[2]}` : text;
}

test('标记落在 system_logs/_running 子目录（不污染 *.json 台账通配）', () => {
  assert.match(src, /RUNNING_DIR="\/mnt\/ssd\/bio_data\/system_logs\/_running"/);
  assert.match(src, /RUNNING_JSON="\$RUNNING_DIR\/\$\{TASK_ID\}\.json"/);
  // 校验脚本按 $LOGS_DIR/*.json 通配，子目录天然被排除
  const checker = fs.readFileSync(CHECKER, 'utf8');
  assert.match(checker, /json_files=\("\$LOGS_DIR"\/\*\.json\)/);
  assert.ok(!/\*\*\/\*\.json|recursive/.test(checker), '校验脚本不得递归扫子目录');
});

test('标记字段齐全且 status=running', () => {
  const block = markerBlock();
  for (const field of ['task_id', 'line_id', 'step_name', 'status', 'start_time', 'wrapper_pid']) {
    assert.ok(block.includes('"' + field + '"'), '标记缺少字段 ' + field);
  }
  assert.match(block, /"status": "running"/);
  assert.ok(block.includes('$$'), '要记 wrapper 的 pid，便于对照容器 abort 时间点');
});

test('正常结束在写完台账之后才删标记（标记残留即中断取证）', () => {
  const ledgerAt = src.indexOf('cat <<EOF > "$LEDGER_JSON"');
  const rmAt = src.indexOf('rm -f "$RUNNING_JSON"');
  assert.ok(ledgerAt > 0, '找不到写台账的位置');
  assert.ok(rmAt > ledgerAt, '删标记必须排在写台账之后');
  assert.ok(!/trap\s+[^\n]*RUNNING_JSON/.test(src), '不许用 trap 删标记：SIGTERM 也会带走证据');
});

test('过期标记（>7 天）在启动时清理', () => {
  assert.match(src, /for stale_marker in "\$RUNNING_DIR"\/\*\.json; do/);
  assert.match(src, /stat -c %Y "\$stale_marker"/);
  assert.match(src, /rm -f -- "\$stale_marker"/);
  assert.doesNotMatch(src, /(^|\s)find\s/);
});

test('真跑标记段：JSON 可解析、字段正确、删掉后不再存在', () => {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(TEST_ROOT, 'running-marker-'));
  const block = stripStaleCleanup(markerBlock())
    .replace(/RUNNING_DIR="[^"]*"/, 'RUNNING_DIR="' + toBashPath(tmp) + '"');
  const script = 'set -e\nTASK_ID=PRJ_X-line2_scrna-123\nLINE_ID=line2_scrna\nSTEP_NAME=scenic_tf\n'
    + 'START_TIME=2026-10-21T13:00:49Z\n' + block + '\nrm -f "$RUNNING_JSON"\n';
  const scriptPath = path.join(tmp, 'block.sh');
  fs.writeFileSync(scriptPath, script);
  execFileSync(BASH, [scriptPath], { stdio: 'pipe' });

  const marker = path.join(tmp, 'PRJ_X-line2_scrna-123.json');
  assert.ok(!fs.existsSync(marker), '正常路径应删除标记');
});

test('模拟中断（不执行删除）：标记留下且可解析出中断信息', () => {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(TEST_ROOT, 'running-marker-abort-'));
  const block = stripStaleCleanup(markerBlock())
    .replace(/RUNNING_DIR="[^"]*"/, 'RUNNING_DIR="' + toBashPath(tmp) + '"');
  const script = 'set -e\nTASK_ID=PRJ_X-line2_scrna-999\nLINE_ID=line2_scrna\nSTEP_NAME=scenic_tf\n'
    + 'START_TIME=2026-10-21T12:26:00Z\n' + block + '\nexit 137\n';
  const scriptPath = path.join(tmp, 'block_abort.sh');
  fs.writeFileSync(scriptPath, script);
  try {
    execFileSync(BASH, [scriptPath], { stdio: 'pipe' });
  } catch (cause) {
    assert.equal(cause.status, 137, '模拟中断应以 137 退出');
  }
  const marker = path.join(tmp, 'PRJ_X-line2_scrna-999.json');
  assert.ok(fs.existsSync(marker), '中断后标记必须留下');
  const parsed = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.equal(parsed.status, 'running');
  assert.equal(parsed.step_name, 'scenic_tf');
  assert.equal(parsed.line_id, 'line2_scrna');
  assert.ok(String(parsed.note).includes('P-23'), '标记要指向 P-23 说明');
});

test('包装器语法正确且仍是 LF-only', () => {
  execFileSync(BASH, ['-n', WRAPPER], { stdio: 'pipe' });
  const bytes = fs.readFileSync(WRAPPER);
  assert.equal(bytes.includes(13), false, 'run_throttled_task.sh 不得含 CR（CRLF 会让 awk 数值比较退化，坑 #103）');
});
