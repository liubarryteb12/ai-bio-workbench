import { spawn } from 'child_process';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

import type {
  PlotAdapter,
  PlotRenderResult,
  PlotSpec,
} from './interface';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
  'base64'
);

export class MockPlotAdapter implements PlotAdapter {
  constructor(private readonly variance = 1) {}

  async render(spec: PlotSpec): Promise<PlotRenderResult> {
    fs.writeFileSync(spec.outputPath, TINY_PNG);
    return {
      path: spec.outputPath,
      width: 1,
      height: 1,
      dpi: spec.dpi,
      pixelVariance: this.variance,
    };
  }
}

export class BlankPlotAdapter extends MockPlotAdapter {
  constructor() {
    super(0);
  }
}

export class RenderedFilePlotAdapter implements PlotAdapter {
  constructor(private readonly result: PlotRenderResult) {}

  async render(spec: PlotSpec): Promise<PlotRenderResult> {
    if (spec.outputPath !== this.result.path) {
      throw new Error('ERR_PLOT_RENDERED_PATH_MISMATCH');
    }
    return this.result;
  }
}

export interface PillowPlotOptions {
  readonly python?: string;
  readonly blank?: boolean;
}

export class PillowPlotAdapter implements PlotAdapter {
  constructor(private readonly options: PillowPlotOptions = {}) {}

  render(spec: PlotSpec): Promise<PlotRenderResult> {
    const helper = fileURLToPath(new URL('./pillow_render.py', import.meta.url));
    const args = [
      helper,
      '--output', spec.outputPath,
      '--title', spec.title,
      '--dpi', String(spec.dpi),
      '--values', JSON.stringify(spec.values ?? []),
    ];
    if (this.options.blank) args.push('--blank');
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.python ?? 'python3', args, {
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('ERR_PLOT_RENDER_TIMEOUT'));
      }, 30000);
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (cause) => {
        clearTimeout(timer);
        reject(cause);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`ERR_PLOT_RENDER_FAILED: ${stderr || stdout}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as PlotRenderResult);
        } catch (cause) {
          reject(new Error(`ERR_PLOT_RENDER_BAD_JSON: ${stdout.trim()}`));
        }
      });
    });
  }
}
