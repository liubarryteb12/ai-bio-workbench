/**
 * 读取 Fail-Closed 运行时口令文件并打印（本地运维用，5.6 配套）。
 *
 * 口令不进 stderr / 不进日志，只在这个显式命令里出现一次。
 * 5.6 加固（2026-11-01）：读之前先校验文件里记录的 pid 是否存活——
 * 死进程留下的明文口令一律判废并删除，避免强杀/掉电残留被误用。
 *
 * 用法：node server/print_runtime_auth.js
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const file = process.env.BIO_AUTH_RUNTIME_FILE
  || path.join(os.homedir(), '.bioanalys', 'workbench_failclosed.json');

if (!fs.existsSync(file)) {
  console.log('运行时口令文件不存在：' + file);
  console.log('（服务可能由 serve_guard 以固定口令拉起，或正在运行的实例不是 Fail-Closed 模式）');
  process.exit(1);
}

let auth;
try {
  auth = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (cause) {
  console.log('运行时口令文件无法解析，已判废并删除：' + file);
  fs.rmSync(file, { force: true });
  process.exit(2);
}

// pid 存活校验：文件里的 pid 若已死，这份口令属于已崩溃的实例，无效
const pid = Number(auth.pid);
if (Number.isInteger(pid) && pid > 0) {
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { alive = false; }
  if (!alive) {
    console.log('记录的进程 pid=' + pid + ' 已不存在，该口令判废并已删除：' + file);
    fs.rmSync(file, { force: true });
    process.exit(3);
  }
} else {
  console.log('提示：该文件没有 pid 字段（可能是旧版写入），无法判定进程存活，仅作提示不删除。');
}

console.log('user=' + auth.user);
console.log('pass=' + auth.pass);
console.log('pid=' + (auth.pid ?? 'unknown'));
console.log('提示：该文件在服务工作进程退出时自动删除；文件在=服务在跑。');