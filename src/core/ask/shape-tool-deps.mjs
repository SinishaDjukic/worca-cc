// src/core/ask/shape-tool-deps.mjs — the Shaper bundle of propose_changes / route_message (D4): present only while the
// shapeFirst gate is on and the turn has a thread. The rule lives in src/core/shape/changes.mjs (shapeToolCheck), shared
// with the parent's re-check (ui/server.mjs askShapeAction). `live` = the server's runs overlay in relay mode only.
import { shapeFirstEnabled } from '../shape/gate.mjs';
import { shapeToolCheck } from '../shape/changes.mjs';
import { listRunLinks } from './store.mjs';
import { readPrState, findPipelineRowById } from '../artifacts.mjs';
import { readRunTags } from '../run-tags-store.mjs';
import { readRunLabels } from '../run-labels-store.mjs';

export function defaultShapeToolDeps({ threadId = null, live = null } = {}) {
  if (!threadId || !shapeFirstEnabled()) return {};
  const deps = { live: live || undefined, readPrState, findPipelineRowById, readRunTags, readRunLabels };
  const links = () => { try { return listRunLinks(threadId); } catch { return []; } };
  return { shapeTools: {
    follows: () => links().length > 0,
    check: (kind, input) => {
      try { const r = shapeToolCheck(kind, input, links(), deps); return r.ok ? { ok: true } : { ok: false, error: r.error }; }
      catch (err) { return { ok: false, error: `could not read this chat's work: ${err && err.message ? err.message : err}` }; }
    },
  } };
}
