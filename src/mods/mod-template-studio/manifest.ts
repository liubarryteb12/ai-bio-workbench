import { provideCapability, type ModManifest } from '../../core/types';
import { workspaceSlot, inspectorSlot } from './slots/TemplateSlots';

export const manifest: ModManifest = {
  modId: 'mod-template-studio',
  displayName: 'Template Studio',
  version: '1.0.0',
  state: 'ready',
  dbStores: ['studio_templates', 'studio_derivatives'],
  stageOrder: 'feature',
  plane: 'cross-plane',
  enginesRequired: ['compute-engine', 'plot-engine'],
  configPaths: [],
  verificationScripts: ['tests/test_template_studio.py'],
  capabilitiesProvided: [provideCapability('templateStudio.listVerifiedOutputs')],
  capabilitiesConsumed: [
    'bizAlpha.getConsumptionSummary',
    'bizBeta.getAnalysisDigest',
  ],
  slots: [workspaceSlot, inspectorSlot],
  artifacts: [{
    lines: ['src/mods/mod-template-studio/implementation.ts:1-130'],
    analysis_step: 'template_studio.render_template',
    produces: 'SCIENTIFIC_PNG_300DPI',
    output_glob: 'data/template-outputs/bar-*.png',
    source_sha256: 'e6cfdac18e18ef4e230e608ec1831de029000464da81eb8c62ee1067ce6cfc35',
    preview_sha256: '95f13b8e8b66fbc6f41f9d8dece7c5e1d1129555c7b6eb63a5b9129bd5af4cba',
    sample_project_output: 'data/template-outputs/bar-baseline.png',
  }],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
