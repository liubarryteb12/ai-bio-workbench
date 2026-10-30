import { provideCapability, type ModManifest } from '../../core/types';
import { exportSlot } from './slots/exportSlot';

export const manifest: ModManifest = {
  modId: 'mod-portal-sync',
  displayName: 'Portal Sync',
  version: '1.0.0',
  state: 'ready',
  dbStores: ['sync_manifests', 'sync_chunks'],
  stageOrder: 'feature',
  plane: 'cross-plane',
  enginesRequired: ['sync-engine', 'security-audit-engine'],
  configPaths: [],
  verificationScripts: ['ops/deploy-k40-termux.sh', 'tests/test_portal_sync.py'],
  capabilitiesProvided: [provideCapability('portalSync.getLastBundleInfo')],
  capabilitiesConsumed: [
    'bizAlpha.getConsumptionSummary',
    'bizBeta.getAnalysisDigest',
  ],
  slots: [exportSlot],
  artifacts: [{
    lines: ['src/mods/mod-portal-sync/implementation.ts:1-150'],
    analysis_step: 'portal_sync.export_signed_deliverable',
    produces: 'SIGNED_PACKLET',
    output_glob: 'data/portal-sync/signed-*.packlet.json',
    source_sha256: '0e5dc478c2c49cb86c003a76edba0ed9d718d395b03fc31643738b5d1732a300',
    preview_sha256: 'ce756edc68feac3de3ca6885d6ec9ab2277ea1aec1af6d030e6a01e1feb72046',
    sample_project_output: 'data/portal-sync/signed-baseline.packlet.json',
  }],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
