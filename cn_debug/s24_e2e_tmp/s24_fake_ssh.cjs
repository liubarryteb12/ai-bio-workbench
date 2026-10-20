
const cp = require('node:child_process');
const origSync = cp.spawnSync.bind(cp);
const FAKE_SSD = "D:\\00.AIagent\\codespace\\AI辅助生信分析流程工作台\\cn_debug\\s24_e2e_tmp\\ssd";
cp.spawnSync = function (cmd, args, opts) {
  if (cmd === 'ssh') {
    // ssh -o .. -o .. <host> '<command>'：最后一个参数是远端命令
    const command = args[args.length - 1];
    const rewritten = command.split('/mnt/ssd/bio_data').join(FAKE_SSD);
    const r = origSync('bash', ['-c', rewritten], { encoding: 'utf8', timeout: 30000 });
    return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
  }
  if (cmd === 'scp') {
    // 本验证不含数据文件部署路径；若意外走到 scp 直接报失败，不留静默
    return { status: 1, stdout: '', stderr: 's24-e2e-shim: scp not expected' };
  }
  return origSync(cmd, args, opts);
};
