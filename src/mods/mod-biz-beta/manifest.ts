import { provideCapability, type ModManifest } from '../../core/types';
import { sidebarSlot, workspaceSlot } from './slots/BetaSlots';

export const manifest: ModManifest = {
  modId: 'mod-biz-beta',
  displayName: 'Business Beta',
  version: '1.0.0',
  state: 'ready',
  dbStores: ['beta_geo_runs', 'beta_lasso_intersections'],
  stageOrder: 'feature',
  plane: 'cross-plane',
  enginesRequired: ['compute-engine', 'bridge-engine', 'plot-engine'],
  configPaths: [],
  verificationScripts: ['tests/test_biz_beta.py'],
  capabilitiesProvided: [provideCapability('bizBeta.getAnalysisDigest')],
  capabilitiesConsumed: [],
  slots: [sidebarSlot, workspaceSlot],
  artifacts: [{
    lines: ['src/mods/mod-biz-beta/implementation.ts:1-260'],
    analysis_step: 'biz_beta.geo_lasso_robust_intersection',
    produces: 'BIT_EXACT_17G_DEG_LASSO_TSV',
    output_glob: 'data/beta-outputs/robust-biomarkers-*.tsv',
    source_sha256: '429e8aae84ef127db377ead8dc53c884a5f667efb46909869bd386b2569dc28d',
    preview_sha256: '7cadc101db6e4b8ffb4f4ac5000240fbf67664e9b6f1982632beb691453f42f8',
    sample_project_output: 'data/beta-outputs/robust-biomarkers-baseline.tsv',
  }],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
