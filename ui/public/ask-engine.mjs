// ui/public/ask-engine.mjs — Ask Worca's engine rules for the panel (cascading-settings-design.md D12, D16, §6). Pure.
/** The engines an Ask chat runs on, in picker order (src/core/model-env.mjs ASK_ENGINES; kept equal by a test). */
export const ASK_CHAT_ENGINES = Object.freeze(['claude', 'codex', 'copilot']);
import { engineChoiceLabel } from '../../src/shared/engine-switch.mjs';
import { runsOn } from '../../src/shared/connections.mjs';
/** A catalog row's engine: the server tags every non-Claude row; an untagged row is Claude. */
export const engineOfEntry = (m) => (m && m.engine) || 'claude';
/** The engine a chat is locked to: its model's, once it has an assistant row; null before (any engine may start it).
 *  `serverEngine` (the thread payload's `engine`) wins: the server knows a model's engine after the catalog drops it. */
export function chatEngineOf(rows, model, catalog, serverEngine = null) {
  if (!Array.isArray(rows) || !rows.some((r) => r && r.role === 'assistant')) return null;
  if (ASK_CHAT_ENGINES.includes(serverEngine)) return serverEngine;
  const hit = catalog && Array.isArray(catalog.models) ? catalog.models.find((m) => m && m.id === model) : null;
  return engineOfEntry(hit);
}
/** The picker's sections: one per engine present (Claude first); a lock keeps only that engine. */
export function pickerGroups(models, { lock = null } = {}) {
  const out = [];
  for (const engine of ASK_CHAT_ENGINES) {
    if (lock && lock !== engine) continue;
    // A model whose connection both harnesses reach (an OpenAI Responses endpoint) is in both sections.
    const own = (Array.isArray(models) ? models : []).filter((m) => m && runsOn(m, engine));
    if (own.length) out.push({ engine, label: engineChoiceLabel(engine), models: own });
  }
  return out;
}
const COPILOT_REFUSED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
/** D16: what a Codex or Copilot chat cannot take, said before upload (Copilot takes no image either). */
export function attachRefusal({ ext, engine }) {
  if (engine === 'codex' && ext === '.pdf') return 'PDFs need a Claude chat';
  if (engine === 'copilot' && COPILOT_REFUSED_EXT.has(ext)) return 'images and PDFs need a Claude chat';
  return null;
}
