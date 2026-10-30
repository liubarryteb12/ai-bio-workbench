export type ActiveBioScope =
  | 'GEO_STANDARD'
  | 'SCRNA_SEQ'
  | 'SPATIAL_TRANSCRIPTOMICS'
  | 'FRAMEWORK_RESERVED';

export interface BetaTranscriptomicsJobSpec {
  readonly jobId: string;
  readonly scope: ActiveBioScope;
  readonly inputMatrixRelPath: string;
  readonly expectedSamples: number;
  readonly expectedGenes: number;
  readonly seeds?: readonly number[];
}

export interface BetaAnalysisDigest {
  readonly jobId: string;
  readonly scope: ActiveBioScope;
  readonly seedsUsed: readonly number[];
  readonly robustBiomarkerSymbols: readonly string[];
  readonly formattedMetrics17g: Readonly<Record<string, string>>;
  readonly outputTsvRelPath: string;
  readonly outputSha256: string;
}

export interface BetaAnalysisResult {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly digest?: BetaAnalysisDigest;
  readonly error?: string;
}
