// ui/public/ask-engine.mjs — Chat's engine rules for the panel (cascading-settings-design.md D12, D16, §6; #943). Pure.
import { engineChoiceLabel, engineLabel, CHAT_ENGINE_NAMES, chatAttachRefusal } from '../../src/shared/engine-switch.mjs';
/** The engines an Ask chat runs on, in picker order (engine-switch.mjs `chat`, as src/core/model-env.mjs ASK_ENGINES). */
export const ASK_CHAT_ENGINES = CHAT_ENGINE_NAMES;
import { runsOn } from '../../src/shared/connections.mjs';
/** A catalog row's engine: the server tags every non-Claude row; an untagged row is Claude. */
export const engineOfEntry = (m) => (m && m.engine) || 'claude';
/** The engine a chat runs on now: its stored engine once it has an assistant row; null before (any engine may start
 *  it). `serverEngine` (the thread payload's `engine`) wins: the server knows it after a switch (#943) and after the
 *  catalog drops a model. The panel offers every engine and moves the chat; the extension and the Workflows chat keep
 *  their picker to this one. */
export function chatEngineOf(rows, model, catalog, serverEngine = null) {
  if (!Array.isArray(rows) || !rows.some((r) => r && r.role === 'assistant')) return null;
  if (ASK_CHAT_ENGINES.includes(serverEngine)) return serverEngine;
  const hit = catalog && Array.isArray(catalog.models) ? catalog.models.find((m) => m && m.id === model) : null;
  return engineOfEntry(hit);
}
/** The picker's sections: one per engine present (Claude first); `lock` keeps only that engine; `active` (the chat's
 *  engine) is labelled "· this chat". */
export function pickerGroups(models, { lock = null, active = null } = {}) {
  const out = [];
  for (const engine of ASK_CHAT_ENGINES) {
    if (lock && lock !== engine) continue;
    // A model whose connection both harnesses reach (an OpenAI Responses endpoint) is in both sections.
    const own = (Array.isArray(models) ? models : []).filter((m) => m && runsOn(m, engine));
    const label = engine === active ? `${engineChoiceLabel(engine)} · this chat` : engineChoiceLabel(engine);
    if (own.length) out.push({ engine, label, models: own });
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

// ---- engine switch (#943) -------------------------------------------------------------------------------------------
/** This browser's last model and effort per chat engine: `{ <engine>: { model, effort } }`. */
export const ENGINE_PICKS_KEY = 'worca-cc.ask.enginePicks';
/** The remembered picks; {} when none, unreadable or damaged. */
export function readEnginePicks(storage) {
  try {
    const v = JSON.parse(storage.getItem(ENGINE_PICKS_KEY) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
/** Remember `pick` as the last one on `engine` (a chat engine; anything else is ignored). */
export function rememberEnginePick(storage, engine, pick) {
  if (!ASK_CHAT_ENGINES.includes(engine) || !pick || typeof pick.model !== 'string' || !pick.model || typeof pick.effort !== 'string') return;
  const all = readEnginePicks(storage);
  all[engine] = { model: pick.model, effort: pick.effort };
  try { storage.setItem(ENGINE_PICKS_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
}
/** The model a move to another engine offers first: the one last used there, else that engine's default, when listed
 *  and pickable (the picker leaves out a hidden model and one whose provider needs a sign-in). */
export function engineLead(models, last, def) {
  const list = Array.isArray(models) ? models : [];
  const find = (id) => (typeof id === 'string' && id ? list.find((m) => m && m.id === id && !m.hidden && !m.needsSignIn) || null : null);
  return find(last && last.model) || find(def && def.model);
}
/** The effort a move to `engine` on model `m` takes: the last one used there, else the engine default's, when `m`
 *  offers it; else 'medium', else the model's first. */
export function switchEffort(m, engine, picks, defaults) {
  const efforts = m && Array.isArray(m.efforts) ? m.efforts : [];
  const last = picks && picks[engine];
  if (last && efforts.includes(last.effort)) return last.effort;
  const d = defaults && defaults[engine];
  if (d && efforts.includes(d.effort)) return d.effort;
  return efforts.includes('medium') ? 'medium' : (efforts[0] || 'medium');
}
/** The confirm (app.js confirmModal options) for a switch the server previewed (POST /api/ask/threads/:id/engine with
 *  dryRun): what stays, what changes, what the new engine will not see. Dropped turns make it a danger confirm.
 *  `noEffort`: the model takes no effort (the button hides it), so none is named. */
export function engineSwitchConfirm(plan, modelLabel, { noEffort = false } = {}) {
  const to = engineLabel(plan.to);
  const lead = `Your next message runs on ${to} with ${modelLabel}${noEffort ? '' : ` (${plan.effort})`}. This chat keeps its messages, attachments, cards and runs. ${to} starts a fresh session with the transcript as its context, and nothing from earlier turns runs again. Its tools, skills, security limits, context window and pricing can differ from ${engineLabel(plan.from)}'s.`;
  const bullets = (Array.isArray(plan.changes) ? plan.changes : []).map((c) => c.text);
  const cx = plan.context || {};
  if (Number.isFinite(cx.from) && Number.isFinite(cx.to) && cx.from !== cx.to) bullets.push(`Context window: ${tokensLabel(cx.from)} → ${tokensLabel(cx.to)} tokens.`);
  const lost = Array.isArray(plan.mcpLost) ? plan.mcpLost : [];
  if (lost.length) bullets.push(`These MCP servers will not start on ${to}: ${lost.join(', ')}.`);
  const atts = Array.isArray(plan.attachments) ? plan.attachments : [];
  if (atts.length) bullets.push(`${to} cannot view ${atts.map((a) => a.name).join(', ')}: it gets only the name${atts.length > 1 ? 's' : ''}.`);
  const t = plan.transcript || {};
  if (t.droppedTurns > 0) bullets.push(`The transcript does not fit ${to}'s context: the ${t.droppedTurns} oldest of ${t.totalTurns} turns are left out, and ${to} will not see their text.`);
  return {
    title: `Switch this chat to ${to}?`,
    message: bullets.length ? `${lead}\n\nWhat changes:\n${bullets.map((b) => `• ${b}`).join('\n')}` : lead,
    confirmLabel: `Switch to ${to}`,
    ...(t.droppedTurns > 0 ? { danger: true } : {}),
  };
}
/** A context window for the confirm: 1000000 → '1M', 200000 → '200k'. */
function tokensLabel(n) {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}
/** The engine name a model button shows (#943; Chat and the extension): the engine the next message runs on, whenever
 *  the catalog offers more than one chat engine; '' when it offers one, as the picker then shows no engine headings. */
export function pickerEngineName(models, engine) {
  return pickerGroups(models).length > 1 ? engineLabel(engine) : '';
}
