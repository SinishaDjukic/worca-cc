// ui/public/ask-engine.mjs — Ask Worca's engine rules for the panel (cascading-settings-design.md D12, D16, §6). Pure.
export const ASK_ENGINE_LABEL = Object.freeze({ claude: 'Claude', codex: 'Codex' });
/** A catalog row's engine: the server tags Codex rows; every other row is Claude. */
export const engineOfEntry = (m) => (m && m.engine === 'codex' ? 'codex' : 'claude');
/** The engine a chat is locked to: its model's, once it has an assistant row; null before (any engine may start it).
 *  `serverEngine` (the thread payload's `engine`) wins: the server knows a model's engine after the catalog drops it. */
export function chatEngineOf(rows, model, catalog, serverEngine = null) {
  if (!Array.isArray(rows) || !rows.some((r) => r && r.role === 'assistant')) return null;
  if (serverEngine === 'claude' || serverEngine === 'codex') return serverEngine;
  const hit = catalog && Array.isArray(catalog.models) ? catalog.models.find((m) => m && m.id === model) : null;
  return engineOfEntry(hit);
}
/** The picker's sections: one per engine present (Claude first); a lock keeps only that engine. */
export function pickerGroups(models, { lock = null } = {}) {
  const out = [];
  for (const engine of ['claude', 'codex']) {
    if (lock && lock !== engine) continue;
    const own = (Array.isArray(models) ? models : []).filter((m) => engineOfEntry(m) === engine);
    if (own.length) out.push({ engine, label: ASK_ENGINE_LABEL[engine], models: own });
  }
  return out;
}
/** D16: what a Codex chat cannot take, said before upload. */
export function attachRefusal({ ext, engine }) { return engine === 'codex' && ext === '.pdf' ? 'PDFs need a Claude chat' : null; }
