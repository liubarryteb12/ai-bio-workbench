#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, '.tmp', 'transport-keepalive-probe');
const DEFAULT_REPORT = path.join(
  ROOT,
  'con_hf',
  'runs',
  '2026-10-28_a2a_v1_2',
  'TRANSPORT_KEEPALIVE.json',
);

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function compileEngine() {
  const tsc = path.join(ROOT, 'BioanalysDesktop', 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tsc)) {
    throw new Error(`ERR_TYPESCRIPT_MISSING: ${tsc}`);
  }
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  execFileSync(
    process.execPath,
    [
      tsc,
      '--target', 'ES2022',
      '--module', 'ESNext',
      '--moduleResolution', 'Bundler',
      '--strict',
      '--skipLibCheck',
      '--rootDir', ROOT,
      '--outDir', BUILD_DIR,
      '--typeRoots', path.join(ROOT, 'BioanalysDesktop', 'node_modules', '@types'),
      '--types', 'node',
      path.join(ROOT, 'src', 'engines', 'transport-keepalive-engine', 'interface.ts'),
      path.join(ROOT, 'src', 'engines', 'transport-keepalive-engine', 'implementation.ts'),
      path.join(ROOT, 'src', 'engines', 'transport-keepalive-engine', 'adapters.ts'),
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  fs.writeFileSync(
    path.join(BUILD_DIR, 'package.json'),
    '{"type":"module"}\n',
    'utf8',
  );
}

async function main() {
  const phoneHost = argument('--phone-host', process.env.PI_TAILSCALE_IP ?? '').trim();
  const sshHost = argument('--ssh-host', process.env.PI_SSH_HOST ?? 'k40').trim();
  const attempts = positiveInteger(
    argument('--attempts', process.env.PI_TRANSPORT_ATTEMPTS ?? '10'),
    10,
  );
  const timeoutMs = positiveInteger(
    argument('--timeout-ms', process.env.PI_TRANSPORT_TIMEOUT_MS ?? '10000'),
    10000,
  );
  const androidSerial = argument(
    '--android-serial',
    process.env.PI_TRANSPORT_ANDROID_SERIAL ?? '',
  ).trim();
  const reportPath = path.resolve(
    ROOT,
    argument('--report', DEFAULT_REPORT),
  );

  if (!phoneHost) {
    console.error('usage: node ops/check_transport_keepalive.mjs --phone-host <100.x.y.z>');
    return 2;
  }

  compileEngine();
  const implementationUrl = pathToFileURL(
    path.join(
      BUILD_DIR,
      'src',
      'engines',
      'transport-keepalive-engine',
      'implementation.js',
    ),
  ).href;
  const adaptersUrl = pathToFileURL(
    path.join(
      BUILD_DIR,
      'src',
      'engines',
      'transport-keepalive-engine',
      'adapters.js',
    ),
  ).href;
  const { TransportKeepaliveEngineImpl } = await import(implementationUrl);
  const { ChildProcessTransportCommandAdapter } = await import(adaptersUrl);
  const adapter = new ChildProcessTransportCommandAdapter();
  const engine = new TransportKeepaliveEngineImpl(adapter);
  const noProxy = `127.0.0.1,localhost,100.64.0.0/10,${phoneHost}`;
  const startedAt = new Date().toISOString();
  const outcome = await engine.probe({
    phoneHost,
    sshHost,
    attempts,
    timeoutMs,
    noProxy,
    androidSerial: androidSerial || undefined,
  });
  const report = {
    generated_at: startedAt,
    transport: 'tailscale',
    phone_host: phoneHost,
    ssh_host: sshHost,
    ...outcome,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  return outcome.exitCode;
}

try {
  process.exitCode = await main();
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
}
