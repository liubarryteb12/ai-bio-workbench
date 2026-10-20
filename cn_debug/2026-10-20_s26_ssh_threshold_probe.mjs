/** S26 · ssh 命令长度阈值梯度探测（真 K40，验证截断行为与 S18R 记录是否一致） */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu'];

async function tryLen(len) {
  const filler = 'x'.repeat(len);
  const command = `echo ${filler} | wc -c`;
  try {
    const { stdout } = await run('ssh', [...SSH, command], { timeout: 30000 });
    return `exit=0 wc=${stdout.trim()}`;
  } catch (cause) {
    return `exit=${cause.code ?? '?'} err=${String(cause.stderr || cause.message).trim().slice(0, 80)}`;
  }
}

for (const len of [1000, 4000, 6000, 8000, 8231, 9000, 9114]) {
  console.log(`len=${String(len).padStart(5)} -> ${await tryLen(len)}`);
}
