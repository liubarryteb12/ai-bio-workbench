export interface SignificanceLine {
  readonly y1: number;
  readonly y2: number;
}

export interface PlotSpec {
  readonly outputPath: string;
  readonly title: string;
  readonly dpi: number;
  readonly significanceLines: readonly SignificanceLine[];
  readonly values?: readonly number[];
}

export interface PlotRenderResult {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  readonly pixelVariance: number;
}

export interface PlotArtifact extends PlotRenderResult {
  readonly sha256: string;
}

export interface PlotAdapter {
  render(spec: PlotSpec): Promise<PlotRenderResult>;
}

export interface PlotEngine {
  renderMatrix(spec: PlotSpec): Promise<PlotArtifact>;
}
