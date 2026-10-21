
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const cwd = 'D:/00.AIagent/codespace/AI辅助生信分析流程工作台/BioanalysDesktop';
const root = path.join(cwd, '.uploads');
fs.mkdirSync(root, { recursive: true });
const d = path.join(root, 'up-quota-active');
fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(d, '0.part'), Buffer.alloc(100));

const child = spawn(process.execPath, ['server/index.js'], {
  cwd, env: { ...process.env, BAD_PORT: '18896', BIO_UPLOAD_QUOTA_BYTES: '1' }, stdio: ['ignore','pipe','pipe'],
});
let out = '';
child.stdout.on('data', (b) => { out += b.toString(); });
child.stderr.on('data', (b) => { out += b.toString(); });
await new Promise((r) => setTimeout(r, 3000));
try {
  const res = await fetch('http://127.0.0.1:18896/api/upload/init', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lineId: 'line1_bulk', filename: 'y.tsv', size: 10, lastModified: 1 }),
  });
  const text = await res.text();
  console.log('STATUS=' + res.status);
  console.log('BODY=' + text.replace(/\s+/g, ' '));
} finally {
  child.kill('SIGKILL');
  fs.rmSync(d, { recursive: true, force: true });
  console.log('LEFTOVER=' + fs.readdirSync(root).length);
  if (out.trim()) console.log('SERVER_LOG_TAIL=' + out.trim().split('\n').slice(-3).join(' | '));
}
