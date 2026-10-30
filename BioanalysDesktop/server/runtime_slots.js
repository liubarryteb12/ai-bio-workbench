import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'ops', 'build_runtime_core.mjs');
const GENERATED_ROOT = path.join(HERE, 'runtime', '.generated');
const MODS_ROOT = path.join(REPO_ROOT, 'src', 'mods');
const DATA_ROOT = path.join(REPO_ROOT, 'local_projects', 'PRJ_K40_SMOKE');
const LEDGER_ROOT = path.join(REPO_ROOT, 'con_hf', 'ledger');

let initialization = null;
let currentSnapshot = null;

function manifestDirectories() {
  return fs.readdirSync(MODS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(MODS_ROOT, name, 'manifest.ts')))
    .sort();
}

function buildRuntimeCore() {
  childProcess.execFileSync(process.execPath, [BUILD_SCRIPT], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
}

function publicSnapshot(manifests, slotManager) {
  return Object.freeze({
    generated_at: new Date().toISOString(),
    source: 'src/mods/*/manifest.ts',
    modules: Object.freeze(manifests.map((manifest) => Object.freeze({
      modId: manifest.modId,
      displayName: manifest.displayName,
      version: manifest.version,
      state: manifest.state,
      stageOrder: manifest.stageOrder,
      plane: manifest.plane,
      slotCount: manifest.slots.length,
      capabilityIds: manifest.capabilitiesProvided.map((item) => item.capabilityId),
    }))),
    slots: Object.freeze(slotManager.renderPlan().map((view) => Object.freeze({
      slotId: view.slotId,
      empty: view.empty,
      contributions: Object.freeze(view.contributions.map((item) => Object.freeze({
        modId: item.modId,
        slotId: item.slotId,
        order: item.order,
        title: item.title,
      }))),
    }))),
  });
}

async function assembleRuntime() {
  buildRuntimeCore();
  const { ModLoader } = await import(
    pathToFileURL(path.join(GENERATED_ROOT, 'core', 'ModLoader.mjs')).href
  );
  const { SlotManager } = await import(
    pathToFileURL(path.join(GENERATED_ROOT, 'core', 'SlotManager.mjs')).href
  );

  const manifests = [];
  for (const modId of manifestDirectories()) {
    const modulePath = path.join(GENERATED_ROOT, 'mods', modId, 'manifest.mjs');
    const loaded = await import(pathToFileURL(modulePath).href);
    if (!loaded.manifest || loaded.manifest.modId !== modId) {
      throw new Error(`ERR_RUNTIME_MANIFEST_INVALID: ${modId}`);
    }
    manifests.push(loaded.manifest);
  }

  const loader = new ModLoader([], {
    dataRoot: DATA_ROOT,
    sourceRoot: REPO_ROOT,
    ledgerRoot: LEDGER_ROOT,
  });
  const verified = loader.loadManifestObjects(manifests);
  const slots = new SlotManager();
  for (const manifest of verified) {
    if (manifest.state === 'ready' && manifest.slots.length > 0) {
      slots.register(manifest.modId, manifest.slots);
    }
  }

  currentSnapshot = publicSnapshot(verified, slots);
  return currentSnapshot;
}

export async function initializeRuntime({ force = false } = {}) {
  if (force) {
    initialization = null;
    currentSnapshot = null;
  }
  if (!initialization) {
    initialization = assembleRuntime().catch((cause) => {
      initialization = null;
      currentSnapshot = null;
      throw cause;
    });
  }
  return initialization;
}

export function getRuntimeSnapshot() {
  if (!currentSnapshot) {
    throw new Error('ERR_RUNTIME_NOT_INITIALIZED');
  }
  return currentSnapshot;
}
