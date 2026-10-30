import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { PathGuard } from '../../core/PathGuard';
import type { ComputeEngine } from '../../engines/compute-engine/interface';
import type { PlotArtifact, PlotRenderResult } from '../../engines/plot-engine/interface';
import { PlotEngineImpl } from '../../engines/plot-engine/implementation';
import { RenderedFilePlotAdapter } from '../../engines/plot-engine/adapters';
import type { TemplateRenderRequest, TemplateRenderResult } from './schema';

const TEMPLATE_ID = /^[A-Za-z0-9._-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export interface TemplateStudioOptions {
  readonly python?: string;
  readonly pathGuard?: Pick<PathGuard, 'assertWithinProjectRoot'>;
}

export class TemplateStudioAdapter {
  private readonly python: string;
  private readonly pathGuard: Pick<PathGuard, 'assertWithinProjectRoot'>;

  constructor(
    private readonly masterDir: string,
    private readonly adaptDir: string,
    private readonly computeEngine: ComputeEngine,
    options: TemplateStudioOptions = {}
  ) {
    this.python = options.python ?? 'python3';
    this.pathGuard = options.pathGuard ?? new PathGuard();
  }

  async renderTemplate(request: TemplateRenderRequest): Promise<TemplateRenderResult> {
    if (!request.templateId || !TEMPLATE_ID.test(request.templateId)
      || request.templateId.includes('..') || request.templateId.startsWith('.')) {
      throw new Error(`ERR_TEMPLATE_ID_INVALID: ${request.templateId}`);
    }
    if (typeof request.projectId !== 'string' || !request.projectId.trim()) {
      throw new Error('ERR_TEMPLATE_PROJECT_ID_MISSING');
    }
    let safeOutputPath: string;
    try {
      safeOutputPath = this.pathGuard.assertWithinProjectRoot(request.outputPath, request.projectId);
    } catch (cause) {
      throw new Error(cause instanceof Error ? cause.message : String(cause));
    }
    if (!safeOutputPath.toLowerCase().endsWith('.png')) {
      throw new Error('ERR_TEMPLATE_OUTPUT_MUST_PNG');
    }
    const masterPath = path.join(this.masterDir, `${request.templateId}.py`);
    if (!fs.existsSync(masterPath)) {
      throw new Error(`ERR_TEMPLATE_MASTER_MISSING: ${masterPath}`);
    }
    const masterSha256 = sha256File(masterPath);
    if (!SHA256.test(masterSha256)) {
      throw new Error('ERR_TEMPLATE_MASTER_SHA256_INVALID');
    }
    try { fs.chmodSync(masterPath, 0o444); } catch { /* platform best effort */ }

    fs.mkdirSync(this.adaptDir, { recursive: true });
    const adaptedPath = path.join(this.adaptDir, `adapt_${request.templateId}.py`);
    const specPath = path.join(this.adaptDir, `adapt_${request.templateId}.json`);
    for (const target of [adaptedPath, specPath]) {
      if (fs.existsSync(target)) {
        try { fs.chmodSync(target, 0o644); } catch { /* best effort */ }
      }
    }
    const masterText = fs.readFileSync(masterPath, 'utf8');
    fs.writeFileSync(
      adaptedPath,
      `# Master-SHA256: ${masterSha256}\n${masterText}`,
      'utf8'
    );
    fs.writeFileSync(specPath, `${JSON.stringify({
      title: request.title,
      values: request.values,
    })}\n`, 'utf8');
    try { fs.chmodSync(adaptedPath, 0o444); fs.chmodSync(specPath, 0o444); } catch { /* best effort */ }
    fs.mkdirSync(path.dirname(safeOutputPath), { recursive: true });

    const outcome = await this.computeEngine.runTask({
      taskId: `template-${request.templateId}`,
      lineId: 'line1_bulk',
      step: 'template_studio_render',
      argv: [
        this.python,
        adaptedPath,
        '--spec', specPath,
        '--out', safeOutputPath,
      ],
      seed: request.seed,
      mode: 'interactive',
    });
    if (outcome.exitCode !== 0) {
      throw new Error(`ERR_TEMPLATE_RENDER_FAILED: ${outcome.stderr || outcome.stdout}`);
    }
    let metadata: PlotRenderResult;
    try {
      metadata = JSON.parse(outcome.stdout.trim()) as PlotRenderResult;
    } catch {
      throw new Error(`ERR_TEMPLATE_RENDER_BAD_JSON: ${outcome.stdout.trim()}`);
    }
    const artifact: PlotArtifact = await new PlotEngineImpl(
      new RenderedFilePlotAdapter(metadata)
    ).renderMatrix({
      outputPath: safeOutputPath,
      title: request.title,
      dpi: 300,
      significanceLines: [{ y1: 40, y2: 40 }],
      values: request.values,
    });
    if (sha256File(masterPath) !== masterSha256) {
      throw new Error('ERR_TEMPLATE_MASTER_MUTATED_DURING_RUN');
    }
    return Object.freeze({
      templateId: request.templateId,
      masterSha256,
      adaptedPath,
      artifact,
    });
  }
}
