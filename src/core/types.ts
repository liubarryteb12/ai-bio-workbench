export type ExitCode = 0 | 1 | 2 | 3;

export type ReadinessState = 'ready' | 'degraded' | 'disabled' | 'error';

export type StageOrder = 'foundation' | 'supporting' | 'feature';

export type ModulePlane = 'pc-codex' | 'mobile-termux' | 'cross-plane';

export const SLOT_IDS = [
  'topbar.action',
  'sidebar.nav',
  'workspace.main',
  'inspector.panel',
  'workbench.selfcheck-cards',
  'workbench.studio-preview',
] as const;

export type SlotId = (typeof SLOT_IDS)[number];

export interface SlotContribution {
  readonly slotId: SlotId;
  readonly order: number;
  readonly title: string;
  readonly renderAdapter: () => unknown;
}

export interface ArtifactQuadruple {
  readonly lines: readonly string[];
  readonly analysis_step: string;
  readonly produces: string;
  readonly output_glob: string;
  readonly source_sha256: string;
  readonly preview_sha256: string;
  readonly sample_project_output: string;
}

export interface CapabilityContract<
  TRequest extends Record<string, unknown> = Record<string, unknown>,
  TResponse = unknown,
> {
  readonly capabilityId: string;
  readonly version: string;
  readonly executeReadOnly: (
    request: Readonly<TRequest>
  ) => Promise<Readonly<TResponse>>;
}

export function provideCapability(
  capabilityId: string,
  version = '1.0.0',
): CapabilityContract {
  return Object.freeze({
    capabilityId,
    version,
    executeReadOnly: async () => Object.freeze({ available: true }),
  });
}

export interface ModManifest {
  readonly modId: string;
  readonly displayName: string;
  readonly version: string;
  readonly state: ReadinessState;
  readonly dbStores: readonly string[];
  readonly stageOrder: StageOrder;
  readonly plane: ModulePlane;
  readonly enginesRequired: readonly string[];
  readonly configPaths: readonly string[];
  readonly verificationScripts: readonly string[];
  readonly capabilitiesProvided: readonly CapabilityContract[];
  readonly capabilitiesConsumed: readonly string[];
  readonly slots: readonly SlotContribution[];
  readonly artifacts: readonly ArtifactQuadruple[];
  readonly initialize: () => Promise<ExitCode>;
  readonly teardown: () => Promise<ExitCode>;
}
