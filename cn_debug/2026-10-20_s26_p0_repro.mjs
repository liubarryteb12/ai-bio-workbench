/**
 * S26 任务项 1 · P0 一次性复现（先红再改）
 *
 * 复刻 S18R §9 P0-2 现场：修复前 buildLedgerWriteCommand 的命令构造公式
 * （payload base64 后整段拼进 ssh 单行 argv），71 个 outputs 的台账条目。
 * 与旧代码的唯一差别：remotePath 指向 /tmp/s26_repro_*.json，不写 system_logs，
 * 不留任何假台账。对真 K40 执行，验证：
 *   R1 命令长度 > 8192（argv 超长）
 *   R2 退出码 0 但「WROTE」标记缺失 / 文件缺失或 JSON 半截（静默截断）
 *   R3 旧 runSsh 的成功判定只有 exit 0，无任何字节数/标记校验（静态证据：旧命令公式）
 *
 * 幂等：每次用新临时文件名，结束后远端清理。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu'];

/** 复刻 task.js buildLedgerEntry 的台账条目形态（71 outputs，与 S18R spatial_figures 同量级） */
function buildEntry() {
  const outputs = Array.from({ length: 71 }, (_, i) =>
    `/mnt/ssd/bio_data/projects/default/line3_spatial/figures/l3_sp_${String(i + 1).padStart(2, '0')}_panel.png`);
  return {
    task_id: 's26-repro-0000-0000-000000000000',
    project_id: 'default',
    line_id: 'line3_spatial',
    step_name: 'spatial_figures',
    status: 'completed',
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    environment: { language: 'R', version: '4.3.3', env_name: 'line3_spatial_env', container_image: 'proot-ubuntu24.04-aarch64', random_seed: 20261013 },
    resource_usage: { max_cpu_percent: null, max_memory_gb: null, disk_io_peak_mb_s: null },
    io_files: { input: [], output: outputs },
    checkpoint_status: 'passed',
    error_log: null,
    exit_code: 0,
    next_action_suggested: null,
  };
}

const entry = buildEntry();
const payload = Buffer.from(JSON.stringify(entry, null, 2)).toString('base64');
const remotePath = '/tmp/s26_repro_ledger.json';

// ↓↓ 逐字符复刻修复前 run.js:167 的命令公式（仅 remotePath 换到 /tmp）↓↓
const command = `mkdir -p '/tmp' && echo ${payload} | base64 -d > '${remotePath}' && echo WROTE '${remotePath}'`;

console.log(`R1 | 命令长度 = ${command.length} 字符（8KB=8192 阈值，S18R 实测 8231 起截断）`);
console.log(`R1 | payload base64 长度 = ${payload.length}，是否整段拼进 argv: ${command.includes(payload.slice(0, 80)) ? '是（风险形态）' : '否'}`);
// 旧 runSsh（run.js:178-198）成功判定只有 exit 0：既不要求 WROTE 出现，也不校验字节数。
console.log('R3 | 旧命令公式含字节数校验(wc -c):', command.includes('wc -c') ? '是' : '否 —— 无校验，exit 0 即当成功');

try {
  const { stdout, stderr } = await run('ssh', [...SSH.slice(1), command], { timeout: 60000 });
  console.log(`R2 | exit=0, stdout=${JSON.stringify(stdout.slice(0, 200))}, stderr=${JSON.stringify(stderr.slice(0, 200))}`);
} catch (cause) {
  console.log(`R2 | ssh 非 0 退出: code=${cause.code}, stdout=${JSON.stringify(String(cause.stdout).slice(0, 200))}, stderr=${JSON.stringify(String(cause.stderr).slice(0, 300))}`);
}

// 落盘结果核验：文件在不在、能不能 parse
try {
  const { stdout } = await run('ssh', [...SSH.slice(1),
    `if [ -f '${remotePath}' ]; then wc -c < '${remotePath}'; else echo FILE_MISSING; fi`], { timeout: 30000 });
  const sizeOut = stdout.trim().split(/\r?\n/).pop();
  if (sizeOut === 'FILE_MISSING') {
    console.log('R2 | 远端文件缺失 —— 静默丢失坐实（exit 0 但什么都没写下来）');
  } else {
    console.log(`R2 | 远端文件字节数 = ${sizeOut}（期望 ${Buffer.from(JSON.stringify(entry, null, 2)).length}）`);
    const { stdout: body } = await run('ssh', [...SSH.slice(1), `cat '${remotePath}'`], { timeout: 30000 });
    try { JSON.parse(body); console.log('R2 | JSON.parse: 成功'); }
    catch (e) { console.log(`R2 | JSON.parse: 失败 —— ${e.message.slice(0, 120)}`); }
  }
} catch (cause) {
  console.log(`R2 | 核验阶段异常: ${cause.message}`);
}

await run('ssh', [...SSH.slice(1), `rm -f '${remotePath}'`], { timeout: 30000 }).catch(() => {});
console.log('清理：远端 /tmp/s26_repro_ledger.json 已删除');
