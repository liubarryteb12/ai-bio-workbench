import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const VERIFY = path.join(ROOT, 'ops', 'verify_delivery_signature.mjs');

import { signDelivery, verifyDelivery, writeChecksums } from '../../ops/ed25519_tools.mjs';

function delivery() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-signature-'));
  fs.writeFileSync(path.join(dir, 'report.html'), '<html></html>', 'utf8');
  return dir;
}

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

test('Ed25519 签名后客户端验签通过', () => {
  const dir = delivery();
  writeChecksums(dir);
  const keys = keypair();
  signDelivery(dir, { privateKey: keys.privateKey });
  const result = verifyDelivery(dir, { publicKey: keys.publicKey });
  assert.equal(result.ok, true);
});

test('二进制 PNG 按原始字节哈希，不走 UTF-8 文本读取', () => {
  const dir = delivery();
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0xff, 0x00, 0x80, 0xfe,
  ]);
  fs.writeFileSync(path.join(dir, 'binary.png'), png);
  const { count } = writeChecksums(dir);
  const expected = crypto.createHash('sha256').update(png).digest('hex');
  const manifest = fs.readFileSync(path.join(dir, 'CHECKSUMS.sha256'), 'utf8');
  assert.match(manifest, new RegExp(`${expected}  binary\\.png`));
  assert.equal(count, 2);

  const keys = keypair();
  signDelivery(dir, { privateKey: keys.privateKey });
  assert.equal(verifyDelivery(dir, { publicKey: keys.publicKey }).ok, true);
});

test('required 模式缺公钥时明确失败，不静默生成或跳过', () => {
  const dir = delivery();
  writeChecksums(dir);
  const keys = keypair();
  const savedPublic = process.env.BIO_ED25519_PUBLIC_KEY;
  const savedPublicPath = process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  delete process.env.BIO_ED25519_PUBLIC_KEY;
  delete process.env.BIO_ED25519_PUBLIC_KEY_PATH;
  try {
    assert.throws(
      () => signDelivery(dir, { privateKey: keys.privateKey, required: true }),
      /public key unavailable/,
    );
  } finally {
    if (savedPublic !== undefined) process.env.BIO_ED25519_PUBLIC_KEY = savedPublic;
    if (savedPublicPath !== undefined) process.env.BIO_ED25519_PUBLIC_KEY_PATH = savedPublicPath;
  }
});

test('verify_delivery_signature CLI 拒绝签名缺失与清单越界路径', () => {
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-sign-required-'));
  fs.writeFileSync(path.join(missing, 'CHECKSUMS.sha256'), '0'.repeat(64) + '  report.html\n', 'utf8');
  const missingResult = spawnSync(process.execPath, [
    VERIFY, '--delivery-dir', missing,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BIO_ED25519_PRIVATE_KEY: '',
      BIO_ED25519_PUBLIC_KEY: '',
      BIO_ED25519_PRIVATE_KEY_PATH: '',
      BIO_ED25519_PUBLIC_KEY_PATH: '',
    },
  });
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /VERIFICATION_FAILED/);

  const traversal = fs.mkdtempSync(path.join(os.tmpdir(), 'bio-sign-traversal-'));
  fs.writeFileSync(path.join(traversal, 'report.html'), '<html></html>', 'utf8');
  const digest = crypto.createHash('sha256').update('report.html').digest('hex');
  fs.writeFileSync(path.join(traversal, 'CHECKSUMS.sha256'), `${digest}  ../outside.txt\n`, 'utf8');
  const keys = keypair();
  signDelivery(traversal, { privateKey: keys.privateKey });
  const result = spawnSync(process.execPath, [
    VERIFY, '--delivery-dir', traversal,
  ], { encoding: 'utf8', env: { ...process.env, BIO_ED25519_PUBLIC_KEY: keys.publicKey } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe_manifest_path|\.\.\//);
});

test('篡改文件会被清单校验拦截', () => {
  const dir = delivery();
  writeChecksums(dir);
  const keys = keypair();
  signDelivery(dir, { privateKey: keys.privateKey });
  fs.appendFileSync(path.join(dir, 'report.html'), 'tampered', 'utf8');
  const result = verifyDelivery(dir, { publicKey: keys.publicKey });
  assert.equal(result.ok, false);
});

test('替换 CHECKSUMS.sha256 会被签名校验拦截', () => {
  const dir = delivery();
  writeChecksums(dir);
  const keys = keypair();
  signDelivery(dir, { privateKey: keys.privateKey });
  fs.writeFileSync(path.join(dir, 'CHECKSUMS.sha256'), 'not a manifest\n', 'utf8');
  const result = verifyDelivery(dir, { publicKey: keys.publicKey });
  assert.equal(result.ok, false);
});
