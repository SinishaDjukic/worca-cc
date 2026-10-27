// ui/public/ask-engine.mjs — Ask Worca's engine rules for the panel (cascading-settings-design.md D12, D16, §6). Pure.
import { engineChoiceLabel, CHAT_ENGINE_NAMES, chatAttachRefusal } from '../../src/shared/engine-switch.mjs';
/** The engines an Ask chat runs on, in picker order (engine-switch.mjs `chat`, as src/core/model-env.mjs ASK_ENGINES). */
export const ASK_CHAT_ENGINES = CHAT_ENGINE_NAMES;
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
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
/** D16: what a chat's engine cannot take, said before upload (engine-switch.mjs chatAttachRefusal: Codex and Goose chats
 *  no PDF, a Copilot chat no image or PDF). */
export function attachRefusal({ ext, engine }) {
  const pdf = ext === '.pdf';
  if (!pdf && !IMAGE_EXT.has(ext)) return null;
  return chatAttachRefusal({ engine, kind: pdf ? 'binary' : 'image', pdf });
}
/** A notice that an engine is not ready for a chat: the turn flags it `<engine>Setup` (its chat descriptor's
 *  notReady.flag, src/core/engines/chat-descriptor.mjs), and the panel opens its setup docs in a new tab. */
export function isEngineSetupNotice(b) {
  return !!b && ASK_CHAT_ENGINES.some((e) => e !== 'claude' && b[`${e}Setup`] === true);
}
