// 临时探针：用 Node 自己的时钟量「spawn 到端口可连」，避开 PowerShell 进程创建开销。
import { spawn } from 'node:child_process';
import net from 'node:net';
import { performance } from 'node:perf_hooks';

const port = 19000 + Math.floor(Math.random() * 500);
const t0 = performance.now();
const child = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, BAD_PORT: String(port), BIO_ALLOW_DEV_NOAUTH: '1', NO_PROXY: 'localhost,127.0.0.1' },
  stdio: 'ignore',
});

await new Promise((resolve) => {
  const attempt = () => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', () => { socket.destroy(); setTimeout(attempt, 2); });
  };
  attempt();
});

console.log(`node_probe_boot_ms=${Math.round(performance.now() - t0)}`);
child.kill();
process.exit(0);
