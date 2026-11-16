// src/core/executor/gates.mjs
// What a remote executor cannot do yet, refused up front with a reason instead of at the first
// spawn. Bridged models: a catalog entry with `upstream` is served by the controller's own
// loopback bridge (src/core/bridge), which a worker in another container cannot reach.
import { isRemoteExecutor, executorKind } from './index.mjs';
import { findBridgedEntry } from '../bridge/registry.mjs';

/** The bridged ids among `modelIds`, or [] (always [] under the local executor). */
export function bridgedModelsFor(modelIds) {
  if (!isRemoteExecutor()) return [];
  const out = [];
  for (const id of modelIds || []) {
    const s = typeof id === 'string' ? id.trim() : '';
    if (!s) continue;
    let bridged = null;
    try { bridged = findBridgedEntry(s); } catch { bridged = null; }
    if (bridged && !out.includes(s)) out.push(s);
  }
  return out;
}

/** A refusal sentence when any of `modelIds` is bridged under a remote executor, else null. */
export function bridgedModelRefusal(modelIds) {
  const ids = bridgedModelsFor(modelIds);
  if (!ids.length) return null;
  return `${ids.join(', ')} ${ids.length === 1 ? 'is a bridged model' : 'are bridged models'} (an entry with \`upstream\`), served by this server's loopback bridge, which agents in worker containers cannot reach yet (WORCA_EXECUTOR=${executorKind()}). Pick a model with a direct endpoint, or run with the local executor.`;
}
