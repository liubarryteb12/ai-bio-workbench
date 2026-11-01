const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const tmpDir = path.join(root, '.tmp', 'tmpfix');
fs.mkdirSync(tmpDir, { recursive: true });
try {
  const out = execSync('node --test --test-concurrency=1 tests/*.test.js', {
    cwd: root,
    env: { ...process.env, TMP: tmpDir, TEMP: tmpDir, TMPDIR: tmpDir },
    timeout: 300000,
    maxBuffer: 20 * 1024 * 1024,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  fs.writeFileSync(path.join(tmpDir, 'f4-execSync.log'), out, 'utf8');
  console.log('stdout length:', out.length);
} catch (e) {
  const allOutput = (e.stdout || '') + (e.stderr || '');
  fs.writeFileSync(path.join(tmpDir, 'f4-execSync.log'), allOutput, 'utf8');
  console.log('exit code:', e.status);
  console.log('output length:', allOutput.length);
}
