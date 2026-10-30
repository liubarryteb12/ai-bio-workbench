import { provideCapability, type ModManifest } from '../../core/types';

export const manifest: ModManifest = {
  modId: 'mod-a2a-pi-server',
  displayName: 'Pi A2A Server',
  version: '1.0.0',
  state: 'ready',
  dbStores: [],
  stageOrder: 'foundation',
  plane: 'mobile-termux',
  enginesRequired: ['security-audit-engine'],
  configPaths: ['configs/a2a/pi-settings.example.json'],
  verificationScripts: [
    'ops/pi_a2a_daemon.sh',
    'ops/pi_a2a_launch.sh',
    'tests/test_pi_a2a_launcher.py',
  ],
  capabilitiesProvided: [
    provideCapability('a2a_server'),
    provideCapability('peer_token_auth'),
    provideCapability('child_transcripts'),
  ],
  capabilitiesConsumed: ['workspace_path_guard', 'settings_security_audit'],
  slots: [],
  artifacts: [],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
