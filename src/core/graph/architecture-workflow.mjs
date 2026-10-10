// src/core/graph/architecture-workflow.mjs
// The shipped Architecture (C4) workflow. Seeded by schema V54 as a v2 row (INSERT OR IGNORE), so a
// user who edits or deletes it keeps their choice; refreshed on later bumps only while the stored
// shape is one worca shipped (ARCHITECTURE_SHIPPED_FINGERPRINTS), exactly like the Presentation seed.
//
//   Task ─┬─▶ c4Discover ──found──▶ architectSetup ──answers──▶ architect ──model──▶ c4Check ──checked──▶ c4Render ─▶ End
//         │        └──────────────────found─────────────────────▲    ▲ fix (≤2) ◀── review ┘
//         └───────────────────────────task──────────────────────┘
import { deepFreeze } from './builtin-workflows.mjs';
import { presentationGraphFingerprint } from './presentation-workflow.mjs';

export const ARCHITECTURE_WORKFLOW_ID = 'wf_architecture_c4';

export const GRAPH_ARCHITECTURE_WORKFLOW = deepFreeze({
  id: ARCHITECTURE_WORKFLOW_ID,
  name: 'Architecture (C4)',
  version: 2,
  domain: 'architecture',
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_discover', kind: 'script', key: 'c4Discover', x: 300, y: 200, config: {} },
    { id: 'n_setup', kind: 'agent', key: 'architectSetup', x: 560, y: 200, config: {} },
    // awaitAll: the first run waits for the task, the setup answers AND discovery; a fix cycle
    // re-fires on the `fix` loop token alone.
    { id: 'n_architect', kind: 'agent', key: 'architect', x: 840, y: 200, config: { awaitAll: true } },
    { id: 'n_check', kind: 'script', key: 'c4Check', x: 1120, y: 200, config: {} },
    { id: 'n_render', kind: 'script', key: 'c4Render', x: 1400, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1680, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_discover', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_setup', port: 'task' } },
    { id: 'w3', from: { node: 'n_discover', port: 'found' }, to: { node: 'n_setup', port: 'found' } },
    { id: 'w4', from: { node: 'n_task', port: 'task' }, to: { node: 'n_architect', port: 'task' } },
    { id: 'w5', from: { node: 'n_setup', port: 'answers' }, to: { node: 'n_architect', port: 'setup' } },
    { id: 'w6', from: { node: 'n_discover', port: 'found' }, to: { node: 'n_architect', port: 'found' } },
    { id: 'w7', from: { node: 'n_architect', port: 'model' }, to: { node: 'n_check', port: 'model' } },
    { id: 'w8', from: { node: 'n_check', port: 'review' }, to: { node: 'n_architect', port: 'fix' }, config: { maxCycles: 2 } },
    { id: 'w9', from: { node: 'n_check', port: 'checked' }, to: { node: 'n_render', port: 'checked' } },
    { id: 'w10', from: { node: 'n_render', port: 'renders' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** Same structural fingerprint as the Presentation seed: sorted node ids + sorted wire ids. */
export const architectureGraphFingerprint = presentationGraphFingerprint;

/** Every shape this workflow has been SHIPPED as before the current one, newest last. Empty: the
 *  first shape is the constant above. When the shape changes, append the OUTGOING fingerprint here
 *  and bump SCHEMA_VERSION (the procedure is the one presentation-workflow.mjs documents). */
export const ARCHITECTURE_SHIPPED_FINGERPRINTS = Object.freeze([]);
