// src/core/exec-env/sweep.mjs
// Orphan sandboxes, per backend: tagged with this worca instance's tag but owned by no resumable run.
// Paused/interrupted runs keep theirs (they expire on their own provider timeout, or reconnect).
import { getDb } from '../db.mjs';
import { worcaHome } from '../projects.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { instanceTag } from './policy.mjs';
import { e2bClient } from './backends/e2b.mjs';
import { getExecBackend } from './registry.mjs';

const TERMINAL = new Set(['done', 'error', 'stopped']);

export async function sweepOrphans({ client, instance, keepRun, dryRun = false, all = false }) {
  const killed = []; const kept = [];
  for (const item of await client.list({ worca: '1', worcaInstance: instance })) {
    const runId = item.tags?.worcaRunId || null;
    if (!all && runId && keepRun(runId)) { kept.push({ sandboxId: item.id, runId }); continue; }
    if (!dryRun) await client.remove(item.id).catch(() => false);
    killed.push({ sandboxId: item.id, runId });
  }
  return { killed, kept };
}
/** e2b compat (test/exec-env-sweep.test.mjs). */
export const sweepOrphanSandboxes = ({ sdk, conn, ...rest }) => sweepOrphans({ client: e2bClient(sdk, conn), ...rest });
export const countRunningSandboxes = (sdk, conn) => e2bClient(sdk, conn).countRunning();

/** Keep a sandbox while its run row exists and is not terminal. */
export function keepRunFromDb(runId) {
  const row = getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(runId);
  return !!row && !TERMINAL.has(row.status);
}

/** bootMaintenance (every backend) + `worca e2b sweep`. A no-op when the backend is not configured (never in mock). */
export async function sweepBackend(backend, { dryRun = false, all = false, env = process.env, timeoutMs = 30_000 } = {}) {
  if (mockEnabled() || !backend.configured(env)) return { skipped: true, killed: [], kept: [] };
  const work = (async () => sweepOrphans({ client: await backend.open({ env }), instance: instanceTag(worcaHome()), keepRun: keepRunFromDb, dryRun, all }))();
  return Promise.race([work, new Promise((_, rej) => setTimeout(() => rej(new Error(`${backend.name} sweep timed out`)), timeoutMs).unref?.())]);
}
export const sweepConfiguredSandboxes = (o) => sweepBackend(getExecBackend('e2b'), o);
