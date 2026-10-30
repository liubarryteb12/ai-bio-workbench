import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { formatFloat17 } from '../../engines/bridge-engine/implementation';
import type {
  BetaAnalysisDigest,
  BetaAnalysisResult,
  BetaTranscriptomicsJobSpec,
} from './schema';

const JOB_ID = /^[A-Za-z0-9._-]+$/;
const SCOPES = new Set(['GEO_STANDARD', 'SCRNA_SEQ', 'SPATIAL_TRANSCRIPTOMICS', 'FRAMEWORK_RESERVED']);
const N_PERMUTATIONS = 64;

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values: number[], random: () => number): number[] {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

function meanDiff(values: number[], sampleIndices: number[]): number {
  const half = Math.floor(values.length / 2);
  const mean = (indices: number[]) => indices.reduce((sum, i) => sum + values[i], 0) / indices.length;
  const control = sampleIndices.slice(0, half);
  const disease = sampleIndices.slice(half);
  return mean(disease) - mean(control);
}

interface GeneSeedStats {
  readonly gene: string;
  readonly diff: number;
  readonly pValues: number[];
}

export class BizBetaAdapter {
  private readonly digests = new Map<string, BetaAnalysisDigest>();

  constructor(
    private readonly dataRoot: string,
    private readonly outputRoot = dataRoot
  ) {}

  async executeTranscriptomicsPipeline(
    spec: Readonly<BetaTranscriptomicsJobSpec>
  ): Promise<BetaAnalysisResult> {
    if (!spec?.jobId || !JOB_ID.test(spec.jobId) || spec.jobId.includes('..')) {
      return { exitCode: 2, error: 'ERR_BETA_JOB_ID_INVALID' };
    }
    if (!SCOPES.has(spec.scope)) {
      return { exitCode: 2, error: 'ERR_BETA_SCOPE_INVALID' };
    }
    if (!spec.seeds || spec.seeds.length === 0) {
      return { exitCode: 3, error: 'ERR_BETA_SEEDS_MISSING' };
    }
    if (spec.seeds.some((seed) => !Number.isSafeInteger(seed) || seed <= 0)) {
      return { exitCode: 2, error: 'ERR_BETA_SEEDS_INVALID' };
    }
    if (!Number.isInteger(spec.expectedSamples) || spec.expectedSamples < 4
      || !Number.isInteger(spec.expectedGenes) || spec.expectedGenes <= 0) {
      return { exitCode: 2, error: 'ERR_BETA_DIMENSIONS_DECLARED_INVALID' };
    }
    const matrixPath = this.resolveInput(spec.inputMatrixRelPath);
    if (!matrixPath) {
      return { exitCode: 2, error: 'ERR_BETA_INPUT_PATH_INVALID' };
    }
    if (!fs.existsSync(matrixPath) || !fs.statSync(matrixPath).isFile()) {
      return { exitCode: 1, error: 'ERR_BETA_INPUT_MISSING' };
    }

    const lines = fs.readFileSync(matrixPath, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      return { exitCode: 1, error: 'ERR_BETA_MATRIX_EMPTY' };
    }
    const header = lines[0].split('\t');
    if (header[0] !== 'gene' || header.length - 1 !== spec.expectedSamples) {
      return { exitCode: 1, error: 'ERR_BETA_SAMPLE_DIMENSION_MISMATCH' };
    }
    if (lines.length - 1 !== spec.expectedGenes) {
      return { exitCode: 1, error: 'ERR_BETA_GENE_DIMENSION_MISMATCH' };
    }

    const genes: string[] = [];
    const matrix: number[][] = [];
    for (const line of lines.slice(1)) {
      const fields = line.split('\t');
      if (fields.length !== header.length || !fields[0]) {
        return { exitCode: 1, error: 'ERR_BETA_ROW_INVALID' };
      }
      const values = fields.slice(1).map(Number);
      if (values.some((value) => !Number.isFinite(value))) {
        return { exitCode: 1, error: 'ERR_BETA_MATRIX_NON_FINITE' };
      }
      genes.push(fields[0]);
      matrix.push(values);
    }
    if (new Set(genes).size !== genes.length) {
      return { exitCode: 1, error: 'ERR_BETA_GENE_DUPLICATE' };
    }

    const sampleIndices = Array.from({ length: spec.expectedSamples }, (_, index) => index);
    const perSeedSelected: Set<string>[] = [];
    const stats = new Map<string, GeneSeedStats>();
    for (const seed of spec.seeds) {
      const selected = new Set<string>();
      const candidates: Array<{ gene: string; diff: number; p: number }> = [];
      for (let geneIndex = 0; geneIndex < genes.length; geneIndex += 1) {
        const values = matrix[geneIndex];
        const observed = meanDiff(values, sampleIndices);
        let extreme = 0;
        for (let perm = 0; perm < N_PERMUTATIONS; perm += 1) {
          const random = mulberry32(seed + perm * 7919 + geneIndex * 104729);
          const permuted = shuffle(sampleIndices, random);
          if (Math.abs(meanDiff(values, permuted)) >= Math.abs(observed)) extreme += 1;
        }
        const p = (extreme + 1) / (N_PERMUTATIONS + 1);
        const gene = genes[geneIndex];
        const current = stats.get(gene);
        if (current) current.pValues.push(p);
        else stats.set(gene, { gene, diff: observed, pValues: [p] });
        if (p <= 0.05) candidates.push({ gene, diff: observed, p });
      }
      candidates.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.gene.localeCompare(b.gene));
      for (const candidate of candidates.slice(0, 20)) selected.add(candidate.gene);
      perSeedSelected.push(selected);
    }

    const robust = [...perSeedSelected[0]].filter((gene) =>
      perSeedSelected.every((selected) => selected.has(gene))
    ).sort();
    if (robust.length === 0) {
      return { exitCode: 1, error: 'ERR_BETA_ROBUST_INTERSECTION_EMPTY' };
    }

    const rows = robust.map((gene) => {
      const stat = stats.get(gene)!;
      const pMax = Math.max(...stat.pValues);
      return `${gene}\t${formatFloat17(stat.diff)}\t${formatFloat17(pMax)}\t${spec.seeds!.length}`;
    });
    const outputRelative = `beta-outputs/robust-biomarkers-${spec.jobId}.tsv`;
    const outputPath = path.join(this.outputRoot, outputRelative);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.tmp`;
    const content = `gene\tmean_diff_17g\tp_value_max_17g\tseeds_hit\n${rows.join('\n')}\n`;
    try {
      fs.writeFileSync(temporary, content, 'utf8');
      fs.renameSync(temporary, outputPath);
    } catch {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
      try { fs.rmSync(outputPath, { force: true }); } catch { /* best effort */ }
      return { exitCode: 1, error: 'ERR_BETA_OUTPUT_WRITE_FAILED' };
    }
    const outputSha256 = sha256(fs.readFileSync(outputPath));
    const formattedMetrics17g: Record<string, string> = {};
    for (const gene of robust) {
      const stat = stats.get(gene)!;
      formattedMetrics17g[`${gene}.mean_diff`] = formatFloat17(stat.diff);
      formattedMetrics17g[`${gene}.p_value_max`] = formatFloat17(Math.max(...stat.pValues));
    }
    const digest: BetaAnalysisDigest = Object.freeze({
      jobId: spec.jobId,
      scope: spec.scope,
      seedsUsed: Object.freeze([...spec.seeds]),
      robustBiomarkerSymbols: Object.freeze(robust),
      formattedMetrics17g: Object.freeze(formattedMetrics17g),
      outputTsvRelPath: outputRelative,
      outputSha256,
    });
    this.digests.set(spec.jobId, digest);
    return { exitCode: 0, digest };
  }

  getAnalysisDigest(jobId: string): BetaAnalysisDigest {
    const digest = this.digests.get(jobId);
    if (!digest) throw new Error(`ERR_BETA_DIGEST_NOT_FOUND: ${jobId}`);
    return digest;
  }

  private resolveInput(relative: string): string | null {
    if (!relative || relative.startsWith('/') || relative.includes('..') || relative.includes('\\')) {
      return null;
    }
    const root = path.resolve(this.dataRoot);
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) return null;
    return target;
  }
}
