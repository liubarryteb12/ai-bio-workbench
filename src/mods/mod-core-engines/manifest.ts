import { provideCapability, type ModManifest } from '../../core/types';

export type { ModManifest } from '../../core/types';

export const manifest: ModManifest = {
  modId: 'mod-core-engines',
  displayName: 'Core Engines Foundation',
  version: '1.0.0',
  state: 'ready',
  dbStores: [],
  stageOrder: 'foundation',
  plane: 'cross-plane',
  enginesRequired: ['security-audit-engine'],
  configPaths: ['configs/a2a/pi-settings.example.json'],
  verificationScripts: ['ops/pi_termux_bootstrap.sh'],
  capabilitiesProvided: [
    provideCapability('workspace_path_guard'),
    provideCapability('settings_security_audit'),
    provideCapability('bootstrap_validation'),
  ],
  capabilitiesConsumed: [],
  slots: [],
  artifacts: [],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
