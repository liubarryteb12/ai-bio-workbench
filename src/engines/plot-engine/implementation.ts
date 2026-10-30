import * as crypto from 'crypto';
import * as fs from 'fs';

import type {
  PlotAdapter,
  PlotArtifact,
  PlotEngine,
  PlotRenderResult,
  PlotSpec,
} from './interface';

export class PlotValidationError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'PlotValidationError';
  }
}

function fail(code: string, message?: string): never {
  throw new PlotValidationError(code, message);
}

function assertSpec(spec: PlotSpec): void {
  if (!spec?.outputPath?.toLowerCase().endsWith('.png')) {
    fail('ERR_PLOT_OUTPUT_MUST_PNG');
  }
  if (spec.dpi !== 300) {
    fail('ERR_PLOT_DPI_NOT_300', String(spec.dpi));
  }
  if (!spec.title?.trim()) {
    fail('ERR_PLOT_TITLE_MISSING');
  }
  if (!Array.isArray(spec.significanceLines)) {
    fail('ERR_PLOT_SIGNIFICANCE_NOT_ARRAY');
  }
  for (const line of spec.significanceLines) {
    if (!Number.isFinite(line?.y1) || !Number.isFinite(line?.y2)) {
      fail('ERR_PLOT_SIGNIFICANCE_INVALID');
    }
    if (Math.abs(line.y1 - line.y2) > 1e-12) {
      fail('ERR_PLOT_SIGNIFICANCE_NOT_HORIZONTAL', `${line.y1} != ${line.y2}`);
    }
  }
}

function verifyRender(spec: PlotSpec, result: PlotRenderResult): string {
  if (result.path !== spec.outputPath) {
    fail('ERR_PLOT_OUTPUT_PATH_MISMATCH', `${result.path} != ${spec.outputPath}`);
  }
  if (!fs.existsSync(result.path)) {
    fail('ERR_PLOT_FILE_MISSING', result.path);
  }
  const stat = fs.statSync(result.path);
  if (!stat.isFile() || stat.size <= 0) {
    fail('ERR_PLOT_FILE_EMPTY', result.path);
  }
  if (result.dpi !== 300) {
    fail('ERR_PLOT_RENDERED_DPI_NOT_300', String(result.dpi));
  }
  if (!Number.isFinite(result.width) || !Number.isFinite(result.height)
    || result.width <= 0 || result.height <= 0) {
    fail('ERR_PLOT_DIMENSIONS_INVALID');
  }
  if (!Number.isFinite(result.pixelVariance) || result.pixelVariance <= 0) {
    fail('ERR_PLOT_VARIANCE_ZERO', String(result.pixelVariance));
  }
  return crypto.createHash('sha256').update(fs.readFileSync(result.path)).digest('hex');
}

export class PlotEngineImpl implements PlotEngine {
  constructor(private readonly adapter: PlotAdapter) {}

  async renderMatrix(spec: PlotSpec): Promise<PlotArtifact> {
    try {
      assertSpec(spec);
      const result = await this.adapter.render(spec);
      const sha256 = verifyRender(spec, result);
      return Object.freeze({ ...result, sha256 });
    } catch (cause) {
      if (spec?.outputPath) {
        try { fs.rmSync(spec.outputPath, { force: true }); } catch { /* best effort */ }
      }
      throw cause;
    }
  }
}
