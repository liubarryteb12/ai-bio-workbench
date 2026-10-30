export interface PortalSyncArtifact {
  readonly modId: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly produces: string;
  readonly analysisStep: string;
}

export interface PortalSyncManifestV1 {
  readonly schema_version: '1.0';
  readonly generated_at: string;
  readonly artifacts: readonly PortalSyncArtifact[];
}
