import { provideCapability, type ModManifest } from '../../core/types';

export const manifest: ModManifest = {
  modId: 'mod-a2a-network-keepalive',
  displayName: 'A2A Network Keepalive',
  version: '1.0.0',
  state: 'ready',
  dbStores: [],
  stageOrder: 'supporting',
  plane: 'mobile-termux',
  enginesRequired: ['transport-keepalive-engine'],
  configPaths: [],
  verificationScripts: [
    'ops/pi_a2a_daemon.sh',
    'ops/check_transport_keepalive.mjs',
    'tests/test_transport_keepalive.py',
  ],
  capabilitiesProvided: [
    provideCapability('wake_lock'),
    provideCapability('tmux_keepalive'),
    provideCapability('network_keepalive'),
  ],
  capabilitiesConsumed: ['a2a_server'],
  slots: [],
  artifacts: [],
  initialize: async () => 0,
  teardown: async () => 0,
};

export default manifest;
