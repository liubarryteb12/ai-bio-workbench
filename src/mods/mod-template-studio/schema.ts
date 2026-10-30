import type { PlotArtifact } from '../../engines/plot-engine/interface';

export interface TemplateRenderRequest {
  readonly templateId: string;
  readonly projectId: string;
  readonly title: string;
  readonly values: readonly number[];
  readonly outputPath: string;
  readonly seed: number;
}

export interface TemplateRenderResult {
  readonly templateId: string;
  readonly masterSha256: string;
  readonly adaptedPath: string;
  readonly artifact: PlotArtifact;
}
