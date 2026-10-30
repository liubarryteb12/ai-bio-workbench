import { provideCapability, type ModManifest } from '../../core/types';
import { previewSlot, selfcheckSlot } from './slots/PiObservabilitySlots';

export const manifest: ModManifest = {
  modId: 'mod-pi-observability',
  displayName: 'Pi Agent Observability',
  version: '1.0.0',
  state: 'ready',
  dbStores: [],
  stageOrder: 'feature',
  plane: 'cross-plane',
  enginesRequired: ['a2a-rpc-engine', 'security-audit-engine'],
  configPaths: ['configs/a2a/pi-settings.example.json'],
  verificationScripts: [
    'BioanalysDesktop/tests/pi_agent.test.js',
    'BioanalysDesktop/tests/pi_agent_routes.test.js',
    'tests/test_mod_pi_observability.py',
    'ops/pi_telemetry_sidecar.py',
  ],
  capabilitiesProvided: [
    provideCapability('piObservability.overview'),
    provideCapability('piObservability.modelControl'),
    provideCapability('piObservability.logStream'),
    provideCapability('piObservability.usageAccounting'),
  ],
  capabilitiesConsumed: ['a2a_server', 'peer_token_auth', 'child_transcripts'],
  slots: [selfcheckSlot, previewSlot],
  artifacts: [],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
