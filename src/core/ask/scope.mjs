// src/core/ask/scope.mjs — P4 chat scope (CONTRACT §4): the pure rules. No imports besides ./tools.mjs.
// A chat's scope is No project (null), a project ({projectKey}) or a workspace ({workspaceId}).
export { scopeRefusalText, targetInScope } from './tools.mjs';

export const SCOPE_REASON_MAX = 200;
const TARGET_KEYS = ['projectDir', 'projectKey', 'workspaceId', 'projectSource'];
const nonEmpty = (v) => typeof v === 'string' && v !== '';
const isObj = (v) => !!v && typeof v === 'object';

/** The scope a context names: pinned:false → null (No project); else its projectKey, else its workspaceId, else null. */
export function chatScopeOf(context) {
  if (!isObj(context) || context.pinned === false) return null;
  if (nonEmpty(context.projectKey)) return { projectKey: context.projectKey };
  if (nonEmpty(context.workspaceId)) return { workspaceId: context.workspaceId };
  return null;
}

/** The context a chat stores: page fields kept, the 4 target keys dropped, then `pinned` plus the scope's one key. */
export function withChatScope(context, scope) {
  const out = isObj(context) ? { ...context } : {};
  for (const k of TARGET_KEYS) delete out[k];
  out.pinned = !!scope;
  if (scope && scope.projectKey) out.projectKey = scope.projectKey;
  else if (scope && scope.workspaceId) out.workspaceId = scope.workspaceId;
  return out;
}

export function sameScope(a, b) {
  if (!a || !b) return !a && !b;
  return (a.projectKey || null) === (b.projectKey || null) && (a.workspaceId || null) === (b.workspaceId || null);
}

export function scopeBody(scope) {
  if (scope && scope.projectKey) return { pinned: true, projectKey: scope.projectKey };
  if (scope && scope.workspaceId) return { pinned: true, workspaceId: scope.workspaceId };
  return { pinned: false };
}

/** Every projectKey on any scope-switch card of the thread, any state, each key once. */
export function scopeCardKeys(messages) {
  const keys = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    for (const b of isObj(m) && Array.isArray(m.blocks) ? m.blocks : []) {
      if (!isObj(b) || b.kind !== 'card' || !isObj(b.card) || b.card.type !== 'scope-switch') continue;
      for (const c of Array.isArray(b.card.candidates) ? b.card.candidates : []) {
        if (isObj(c) && nonEmpty(c.projectKey) && !keys.includes(c.projectKey)) keys.push(c.projectKey);
      }
    }
  }
  return keys;
}

export function validateScopeSwitch(input, { scope = null, projects = [], asked = [] } = {}) {
  if (scope) return { ok: false, errors: ['this chat already has a scope — never ask to switch it; the user changes it in the scope pill'] };
  const src = isObj(input) ? input : {};
  const errors = [];
  const keys = [];
  for (const c of Array.isArray(src.candidates) ? src.candidates : []) {
    const k = typeof c === 'string' ? c.trim() : '';
    if (k && !keys.includes(k)) keys.push(k);
  }
  if (keys.length < 1 || keys.length > 3) errors.push('candidates must list 1 to 3 project keys (2–3 only when it is genuinely one of those)');
  const reason = typeof src.reason === 'string' ? src.reason.replace(/\s+/g, ' ').trim() : '';
  if (!reason || reason.length > SCOPE_REASON_MAX) errors.push(`reason is required: one line of at most ${SCOPE_REASON_MAX} characters`);
  const rows = Array.isArray(projects) ? projects : [];
  const prior = Array.isArray(asked) ? asked : [];
  const candidates = [];
  for (const k of keys) {
    const p = rows.find((r) => isObj(r) && r.key === k);
    if (!p) { errors.push(`unknown projectKey "${k}" — use list_projects`); continue; }
    if (p.exists === false) { errors.push(`project ${k} is missing on disk — do not offer it`); continue; }
    if (prior.includes(k)) { errors.push(`this chat already had a card about ${k} — continue in No project and never ask about it again here`); continue; }
    const c = { projectKey: k, name: p.name, path: p.path, vcs: p.vcs === 'none' ? 'none' : 'git' };
    if (nonEmpty(p.displayPath)) c.displayPath = p.displayPath;
    candidates.push(c);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, card: { type: 'scope-switch', reason, summary: candidates.map((c) => c.name).join(' / '), candidates } };
}

function quote(t, n = 160) {
  const s = String(t ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** The [worca event] line that continues the user's message after a scope card is answered. */
export function scopeEventPrompt({ cardId, state, projectKey, name, keys = [], userText } = {}) {
  const q = quote(userText);
  const begins = q ? ` — it begins "${q}" —` : '';
  if (state === 'switched') {
    return `[worca event] scope card ${cardId} switched: this chat's scope is now project ${projectKey} "${quote(name, 120)}" (the context block's project: line). Continue the user's message that led to the card${begins} now, in that project; do not ask which project again.`;
  }
  return `[worca event] scope card ${cardId} declined: the chat stays in No project. Continue the user's message that led to the card${begins} now, without a project, and never ask about ${(Array.isArray(keys) ? keys : []).join(', ')} again in this chat.`;
}

export function scopeNoticeText({ state, name } = {}) {
  return state === 'switched' ? `Switched to ${name}` : 'Continued without project';
}

/** SEAMS S35: open_worktree / run_command on a No-project run — it has no folder and no branch, only run artifacts. */
export const noProjectRunText = (runId) => `run ${runId} has no project and no branch — its files are its run artifacts: read them with list_run_artifacts and read_run_artifact`;
