#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHECKSUMS_NAME = 'CHECKSUMS.sha256';
const SIGNATURE_NAME = 'CHECKSUMS.sig';
const PUBLIC_KEY_NAME = 'ED25519_PUBLIC_KEY.pem';

export function writeChecksums(deliveryDir) {
  const dir = path.resolve(deliveryDir);
  const files = collectFiles(dir)
    .filter((rel) => rel !== CHECKSUMS_NAME && rel !== SIGNATURE_NAME);
  const rows = files.sort().map((rel) => {
    const digest = crypto.createHash('sha256')
      .update(readRawFile(path.join(dir, rel)))
      .digest('hex');
    return `${digest}  ${rel}\n`;
  });
  const checksumsPath = path.join(dir, CHECKSUMS_NAME);
  fs.writeFileSync(checksumsPath, rows.join(''), 'utf8');
  return { path: checksumsPath, count: files.length };
}

export function readPrivateKey(options = {}) {
  const envName = options.privateKeyEnv || 'BIO_ED25519_PRIVATE_KEY';
  const pathEnvName = options.privateKeyPathEnv || 'BIO_ED25519_PRIVATE_KEY_PATH';
  if (options.privateKey) return normalizeKey(options.privateKey);
  if (options.privateKeyPath) return readRawFile(options.privateKeyPath);
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const fromPath = process.env[pathEnvName];
  if (fromPath) return readRawFile(fromPath);
  throw new Error(`private key unavailable: set ${envName} or ${pathEnvName}`);
}

export function readPublicKey(options = {}) {
  const envName = options.publicKeyEnv || 'BIO_ED25519_PUBLIC_KEY';
  const pathEnvName = options.publicKeyPathEnv || 'BIO_ED25519_PUBLIC_KEY_PATH';
  if (options.publicKey) return normalizeKey(options.publicKey);
  // 调用方经常拿到的是「受信公钥路径」本身（server/report.js 的 trustedPublicKeyPath），
  // 不是环境变量名。旧实现只读 publicKeyPathEnv 指向的环境变量，直接传路径会被静默忽略，
  // 最终报“公钥不可用”。这里补上直接路径分支，两个入口语义不再混淆。
  if (options.publicKeyPath) return readRawFile(options.publicKeyPath);
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const fromPath = process.env[pathEnvName];
  if (fromPath) return readRawFile(fromPath);
  throw new Error(`public key unavailable: set ${envName} or ${pathEnvName}`);
}

export function signDelivery(deliveryDir, options = {}) {
  const dir = path.resolve(deliveryDir);
  const manifest = readRawFile(path.join(dir, CHECKSUMS_NAME));
  const privateKey = readPrivateKey(options);
  if (options.required) readPublicKey(options);
  const signature = crypto.sign(null, manifest, privateKey);
  const signaturePath = path.join(dir, SIGNATURE_NAME);
  fs.writeFileSync(signaturePath, signature);
  return { path: signaturePath, bytes: signature.length };
}

export function writeDeliveryPublicKey(deliveryDir, options = {}) {
  const dir = path.resolve(deliveryDir);
  const publicKey = readPublicKey(options);
  const keyPath = path.join(dir, PUBLIC_KEY_NAME);
  fs.writeFileSync(keyPath, publicKey);
  return { path: keyPath, name: PUBLIC_KEY_NAME, bytes: publicKey.length };
}

export function verifyDelivery(deliveryDir, options = {}) {
  const dir = path.resolve(deliveryDir);
  try {
    const manifest = readRawFile(path.join(dir, CHECKSUMS_NAME));
    const signature = fs.readFileSync(path.join(dir, SIGNATURE_NAME));
    const publicKey = readPublicKey(options);
    const signed = crypto.verify(null, manifest, publicKey, signature);
    if (!signed) return { ok: false, reason: 'signature_mismatch' };
    for (const row of parseManifest(manifest)) {
      const file = path.join(dir, row.path);
      const actual = crypto.createHash('sha256').update(readRawFile(file)).digest('hex');
      if (actual !== row.digest) return { ok: false, reason: `hash_mismatch:${row.path}` };
    }
    return { ok: true, count: parseManifest(manifest).length };
  } catch (cause) {
    return { ok: false, reason: `invalid_delivery:${cause.message}` };
  }
}

function collectFiles(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(base).sort()) {
    const full = path.join(base, name);
    if (fs.statSync(full).isDirectory()) out.push(...collectFiles(dir, full));
    else out.push(path.relative(dir, full).replace(/\\/g, '/'));
  }
  return out;
}

function parseManifest(text) {
  return String(text).split('\n').filter(Boolean).map((line) => {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`bad_manifest_line:${line}`);
    const [digest, relPath] = [match[1], match[2]];
    if (unsafeManifestPath(relPath)) throw new Error(`unsafe_manifest_path:${relPath}`);
    return { digest, path: relPath };
  });
}

function readRawFile(file) {
  return fs.readFileSync(file);
}

function normalizeKey(value) {
  if (Buffer.isBuffer(value)) return value;
  const text = String(value).replace(/\r\n/g, '\n').trimEnd();
  return Buffer.from(`${text}\n`, 'utf8');
}

function unsafeManifestPath(value) {
  const rel = String(value ?? '');
  if (!rel || rel.includes('\\') || rel.startsWith('/') || rel.startsWith('\\\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(rel)) return true;
  return rel.split('/').includes('..');
}

export function main(argv = process.argv.slice(2)) {
  const args = argv;
  if (args.includes('--generate-keys')) {
    const privateKeyPath = valueAfter(args, '--private-key-output');
    const publicKeyPath = valueAfter(args, '--public-key-output');
    if (!privateKeyPath || !publicKeyPath) {
      process.stderr.write(
        'usage: --generate-keys requires --private-key-output <file> and --public-key-output <file>\n'
      );
      return 2;
    }
    const pair = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privateKeyPath, normalizeKey(
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
    ));
    fs.writeFileSync(publicKeyPath, normalizeKey(
      pair.publicKey.export({ type: 'spki', format: 'pem' })
    ));
    process.stdout.write(`GENERATED ${privateKeyPath} ${publicKeyPath}\n`);
    return 0;
  }
  const deliveryIndex = args.indexOf('--delivery-dir');
  if (deliveryIndex < 0 || !args[deliveryIndex + 1]) {
    process.stderr.write('usage: node tools/dev/ed25519_tools.mjs --delivery-dir <dir> [--sign | --verify]\n');
    return 2;
  }
  const dir = args[deliveryIndex + 1];
  const mode = args.includes('--sign') ? 'sign' : args.includes('--verify') ? 'verify' : 'sign';
  const required = args.includes('--required');
  if (mode === 'sign') {
    if (required) {
      writeDeliveryPublicKey(dir, {
        publicKeyPathEnv: valueAfter(args, '--public-key'),
      });
    }
    if (!args.includes('--sign-only')) writeChecksums(dir);
    const result = signDelivery(dir, {
      required,
      privateKeyPathEnv: valueAfter(args, '--private-key'),
    });
    process.stdout.write(`SIGNED ${result.path} ${result.bytes}\n`);
    return 0;
  }
  const result = verifyDelivery(dir);
  if (result.ok) {
    process.stdout.write(`VERIFIED ${result.count}\n`);
    return 0;
  }
  process.stderr.write(`VERIFICATION_FAILED ${result.reason}\n`);
  return 1;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = main();
}
