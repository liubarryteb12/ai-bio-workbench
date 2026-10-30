import { provideCapability, type ModManifest } from '../../core/types';

export const manifest: ModManifest = {
  modId: 'mod-a2a-codex-client',
  displayName: 'Codex A2A Client',
  version: '1.0.0',
  state: 'ready',
  dbStores: [],
  stageOrder: 'supporting',
  plane: 'pc-codex',
  enginesRequired: ['a2a-rpc-engine', 'transport-keepalive-engine', 'security-audit-engine'],
  configPaths: ['.env.a2a.example'],
  verificationScripts: [
    'ops/codex_a2a_launcher.sh',
    'ops/codex_a2a_compat.ps1',
    'tests/test_codex_a2a_compat.py',
  ],
  capabilitiesProvided: [
    provideCapability('a2a_call_bridge'),
    provideCapability('codex_a2a_serve'),
  ],
  capabilitiesConsumed: ['a2a_server', 'peer_token_auth', 'transport_keepalive'],
  slots: [],
  artifacts: [],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
