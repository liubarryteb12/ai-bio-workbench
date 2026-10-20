#!/usr/bin/env node
/**
 * S28 收尾归因 probe v2：直接用子进程跑同一个 ssh 命令（不经服务器模块），
 * 多次重复失败路径，看 stderr 是否稳定被捕获。
 * 用法：node cn_debug/_s28_probe_bridge_output.mjs
 */
import { spawnSync, spawn } from 'node:child_process';

function sshSync(remoteCmd, label) {
  const r = spawnSync('ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', remoteCmd],
    { encoding: 'utf8', timeout: 300000, windowsHide: true });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim();
  console.log(`---- ${label}: code=${r.status} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);
  console.log(`     bridgeOutput(拼后) = ${JSON.stringify(out)}`);
  return r;
}

async function sshAsync(remoteCmd, label) {
  return new Promise((resolve) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'k40-ubuntu', remoteCmd],
      { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('exit', (code) => {
      console.log(`---- ${label}: code=${code} stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
      resolve();
    });
    child.on('error', (e) => {
      console.log(`---- ${label}: spawn error ${String(e)}`);
      resolve();
    });
  });
}

const BAD = "python3 /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py --input /tmp/s28_bad_bridge.h5ad --from Python --to R";
const GOOD = "python3 /mnt/ssd/bio_data/ops/verify_bridge_checkpoint.py --input /mnt/ssd/bio_data/projects/default/line2_scrna/processed/scrna_annotated.h5ad --from Python --to R";
const MAKE_BAD =
  "rm -f /tmp/s28_bad_bridge.h5ad && python3 - <<'PYEOF'\n"
  + "import anndata as ad, numpy as np\n"
  + "a = ad.AnnData(X=np.ones((12, 10)))\n"
  + "a.var_names = [str(i) for i in range(10)]\n"
  + "a.obs_names = ['GSM%d' % i for i in range(12)]\n"
  + "a.write('/tmp/s28_bad_bridge.h5ad')\n"
  + "print('MADE')\n"
  + "PYEOF";

const adb = spawn('adb', ['forward', 'tcp:10022', 'tcp:10022'], { windowsHide: true });
await new Promise((r) => adb.on('exit', r));

console.log('==== 造坏 h5ad ====');
await sshAsync(MAKE_BAD, 'mk');

console.log('==== spawnSync 失败路径 ×6（间歇性复现测试）====');
for (let i = 1; i <= 6; i++) {
  sshSync(BAD, `sync-fail-${i}`);
}

console.log('==== 原生 spawn 失败路径 ×3（对照）====');
for (let i = 1; i <= 3; i++) {
  await sshAsync(BAD, `async-fail-${i}`);
}

console.log('==== spawnSync 正路径 ×2（对照）====');
for (let i = 1; i <= 2; i++) {
  sshSync(GOOD, `sync-good-${i}`);
}

process.exit(0);
