export interface SyncChunk {
  readonly index: number;
  readonly sha256: string;
  readonly dataBase64: string;
}

export interface SignedPacklet {
  readonly version: 1;
  readonly algorithm: 'ed25519';
  readonly chunkSize: number;
  readonly totalBytes: number;
  readonly rootSha256: string;
  readonly chunks: readonly SyncChunk[];
  readonly signatureBase64: string;
}

export interface PackletStore {
  write(id: string, packlet: SignedPacklet): Promise<void>;
  read(id: string): Promise<SignedPacklet>;
}

export interface SyncEngine {
  packSigned(data: Buffer, privateKeyPem: string): Promise<SignedPacklet>;
  unpackVerified(packlet: SignedPacklet, publicKeyPem: string): Promise<Buffer>;
}
