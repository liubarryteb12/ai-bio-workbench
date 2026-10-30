import { provideCapability, type ModManifest } from '../../core/types';
import { workspaceSlot, inspectorSlot } from './slots/AlphaSlots';

export const manifest: ModManifest = {
  modId: 'mod-biz-alpha',
  displayName: 'Business Alpha',
  version: '1.0.0',
  state: 'ready',
  dbStores: ['alpha_daily_plans', 'alpha_ledger_entries'],
  stageOrder: 'feature',
  plane: 'cross-plane',
  enginesRequired: ['plot-engine', 'sync-engine'],
  configPaths: [],
  verificationScripts: ['tests/test_biz_alpha.py'],
  capabilitiesProvided: [provideCapability('bizAlpha.getConsumptionSummary')],
  capabilitiesConsumed: [],
  slots: [workspaceSlot, inspectorSlot],
  artifacts: [{
    lines: ['src/mods/mod-biz-alpha/implementation.ts:1-220'],
    analysis_step: 'biz_alpha.reconcile_consumption_structure',
    produces: 'RECONCILED_CENTS_REPORT',
    output_glob: 'data/alpha-reports/reconciled-*.json',
    source_sha256: '8f04a484a59dddf0cf2691cb2019c19e335389ced8e0b85ce3451e5c2a4b8687',
    preview_sha256: 'a1d396b8300dc1ed111208764f8f64d15f8413220c5677b421eea0d887afacbf',
    sample_project_output: 'data/alpha-reports/reconciled-baseline.json',
  }],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
