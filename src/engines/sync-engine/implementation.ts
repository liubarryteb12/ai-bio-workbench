import * as crypto from 'crypto';

import type { SignedPacklet, SyncChunk, SyncEngine } from './interface';

export const DEFAULT_CHUNK_SIZE = 512 * 1024;
export const MAX_CHUNK_SIZE = DEFAULT_CHUNK_SIZE;
const SHA256 = /^[0-9a-f]{64}$/;

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function merkleRootSha256(chunks: readonly SyncChunk[]): string {
  return crypto
    .createHash('sha256')
    .update(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.sha256, 'hex'))))
    .digest('hex');
}

function canonicalManifest(packlet: SignedPacklet): Buffer {
  return Buffer.from(JSON.stringify({
    version: packlet.version,
    algorithm: packlet.algorithm,
    chunkSize: packlet.chunkSize,
    totalBytes: packlet.totalBytes,
    rootSha256: packlet.rootSha256,
    chunks: packlet.chunks.map((chunk) => ({
      index: chunk.index,
      sha256: chunk.sha256,
    })),
  }), 'utf8');
}

function assertPackletShape(packlet: SignedPacklet): void {
  if (!packlet || packlet.version !== 1 || packlet.algorithm !== 'ed25519') {
    throw new Error('ERR_SYNC_PACKLET_HEADER_INVALID');
  }
  if (!Number.isInteger(packlet.chunkSize) || packlet.chunkSize <= 0) {
    throw new Error('ERR_SYNC_CHUNK_SIZE_INVALID');
  }
  if (packlet.chunkSize > MAX_CHUNK_SIZE) {
    throw new Error('ERR_SYNC_CHUNK_SIZE_TOO_LARGE');
  }
  if (!Number.isInteger(packlet.totalBytes) || packlet.totalBytes < 0) {
    throw new Error('ERR_SYNC_TOTAL_BYTES_INVALID');
  }
  if (!SHA256.test(packlet.rootSha256)) {
    throw new Error('ERR_SYNC_ROOT_SHA256_MALFORMED');
  }
  if (!Array.isArray(packlet.chunks) || packlet.chunks.length === 0) {
    throw new Error('ERR_SYNC_CHUNKS_EMPTY');
  }
  packlet.chunks.forEach((chunk, index) => {
    if (!chunk || chunk.index !== index || !SHA256.test(chunk.sha256)) {
      throw new Error(`ERR_SYNC_CHUNK_INVALID: ${index}`);
    }
    if (typeof chunk.dataBase64 !== 'string' || !chunk.dataBase64) {
      throw new Error(`ERR_SYNC_CHUNK_BASE64_INVALID: ${index}`);
    }
    if (Buffer.from(chunk.dataBase64, 'base64').length > packlet.chunkSize) {
      throw new Error(`ERR_SYNC_CHUNK_TOO_LARGE: ${index}`);
    }
  });
  if (typeof packlet.signatureBase64 !== 'string' || !packlet.signatureBase64) {
    throw new Error('ERR_SYNC_SIGNATURE_MISSING');
  }
}

export interface SyncEngineOptions {
  readonly chunkSize?: number;
}

export class SyncEngineImpl implements SyncEngine {
  private readonly chunkSize: number;

  constructor(options: SyncEngineOptions = {}) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    if (!Number.isInteger(this.chunkSize) || this.chunkSize <= 0) {
      throw new Error('ERR_SYNC_ENGINE_CHUNK_SIZE_INVALID');
    }
    if (this.chunkSize > MAX_CHUNK_SIZE) {
      throw new Error('ERR_SYNC_CHUNK_SIZE_TOO_LARGE');
    }
  }

  async packSigned(data: Buffer, privateKeyPem: string): Promise<SignedPacklet> {
    if (!Buffer.isBuffer(data)) {
      throw new Error('ERR_SYNC_DATA_NOT_BUFFER');
    }
    if (data.length === 0) {
      throw new Error('ERR_SYNC_DATA_EMPTY');
    }
    if (!privateKeyPem) {
      throw new Error('ERR_SYNC_PRIVATE_KEY_MISSING');
    }
    const chunks: SyncChunk[] = [];
    for (let offset = 0, index = 0; offset < data.length; offset += this.chunkSize, index += 1) {
      const part = data.subarray(offset, Math.min(offset + this.chunkSize, data.length));
      chunks.push({
        index,
        sha256: sha256(part),
        dataBase64: part.toString('base64'),
      });
    }
    const unsigned: SignedPacklet = {
      version: 1,
      algorithm: 'ed25519',
      chunkSize: this.chunkSize,
      totalBytes: data.length,
      rootSha256: merkleRootSha256(chunks),
      chunks,
      signatureBase64: '',
    };
    const signature = crypto.sign(null, canonicalManifest(unsigned), privateKeyPem);
    return Object.freeze({
      ...unsigned,
      signatureBase64: signature.toString('base64'),
    });
  }

  async unpackVerified(packlet: SignedPacklet, publicKeyPem: string): Promise<Buffer> {
    assertPackletShape(packlet);
    if (!publicKeyPem) {
      throw new Error('ERR_SYNC_PUBLIC_KEY_MISSING');
    }
    const validSignature = crypto.verify(
      null,
      canonicalManifest(packlet),
      publicKeyPem,
      Buffer.from(packlet.signatureBase64, 'base64')
    );
    if (!validSignature) {
      throw new Error('ERR_SYNC_SIGNATURE_INVALID');
    }

    const parts: Buffer[] = [];
    for (const chunk of packlet.chunks) {
      const part = Buffer.from(chunk.dataBase64, 'base64');
      if (sha256(part) !== chunk.sha256) {
        throw new Error(`ERR_SYNC_CHUNK_HASH_MISMATCH: ${chunk.index}`);
      }
      parts.push(part);
    }
    const data = Buffer.concat(parts);
    if (data.length !== packlet.totalBytes) {
      throw new Error(
        `ERR_SYNC_TOTAL_BYTES_MISMATCH: expected=${packlet.totalBytes} actual=${data.length}`
      );
    }
    if (merkleRootSha256(packlet.chunks) !== packlet.rootSha256) {
      throw new Error('ERR_SYNC_ROOT_HASH_MISMATCH');
    }
    return data;
  }
}
