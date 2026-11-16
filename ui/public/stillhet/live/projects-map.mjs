// ui/public/stillhet/live/projects-map.mjs — Stillhet slice 9 D5: pure. A project page's "How its tasks run" sentences
// (projects/projects.js SETS) against dev's project settings (GET/PATCH /api/projects/:key/settings, the settings
// cascade's ids), and the default tags and Labels answer. Dev's record names are read here and in live-map.mjs only.
// B4.5: the page's facts in the mapped shapes projects.js and the demo seeds share: readiness, team metrics and team
// policy, the done/stopped split of its tasks, and the early record drawn before the store loads.
import { projectOf } from './live-map.mjs';
import { engineLabel } from '../../../../src/shared/engine-switch.mjs';

// sentence id → dev's setting id and its words ↔ values, in the sentence's own order
export const SET_KEYS = Object.freeze({
  pr: Object.freeze({ id: 'pr.open', words: Object.freeze([['create a PR ready for review', 'ready'], ['create a draft PR', 'draft'], ['open no PR', 'none']]) }),
  engine: Object.freeze({ id: 'run.engine', words: Object.freeze([['Claude Code', 'claude'], ['Codex', 'codex'], ['Gemini CLI', 'gemini']]) }),
  cap: Object.freeze({ id: 'pipelineCostLimitUsd', words: Object.freeze([['$20', 20], ['$50', 50], ['$100', 100], ['no cap', null]]) }),
  memory: Object.freeze({ id: 'memory.team', words: Object.freeze([['its own notes', false], ['its own and the team\'s notes', true], ['the team\'s notes', 'only']]) }),
  setup: Object.freeze({ id: 'runUserClaudeSettings', words: Object.freeze([['on', true], ['off', false]]) }),
});

const wordOf = (setId, v) => {
  const hit = SET_KEYS[setId].words.find(([, x]) => x === v);
  if (hit) return hit[0];
  if (setId === 'cap' && typeof v === 'number') return `$${v}`;
  return v == null ? SET_KEYS[setId].words.at(-1)[0] : String(v);
};
const inherited = (l = {}) => (l.user !== undefined ? l.user : l.team !== undefined ? l.team : l.default);

/** dev's settings state → per sentence { value: its word now, yours: the word it would inherit, own: the project set it }.
 *  With team memory off, a project value naming the team's notes reads as its own notes (nothing else is offered). */
export function setsOf(state = {}, teamOn = false) {
  const out = {};
  for (const [setId, { id }] of Object.entries(SET_KEYS)) {
    const eff = state?.effective?.[id], layers = state?.layers?.[id] || {};
    let value = eff ? eff.value : inherited(layers);
    if (setId === 'memory' && !teamOn && value) value = false;
    out[setId] = { value: wordOf(setId, value), yours: wordOf(setId, inherited(layers)), own: eff?.source === 'project' };
  }
  return out;
}

/** A picked word → the PATCH body for it ({ settingId: value }). Throws on a sentence or word dev has no value for. */
export function patchOf(setId, word) {
  const row = SET_KEYS[setId];
  if (!row) throw new Error(`no such setting: ${setId}`);
  const hit = row.words.find(([w]) => w === word);
  if (!hit) throw new Error(`${setId} has no "${word}"`);
  return { [row.id]: hit[1] };
}

/** GET/PUT …/tags/defaults (and a workspace's …/defaults) → { tags, labels }, each [] when absent. A tag reads in the
 *  design's `key: value` form (dev stores `key:value`; it takes either back). */
export function defaultsOf(answer) {
  const list = (x) => (Array.isArray(x) ? x.filter((t) => typeof t === 'string') : []);
  return { tags: list(answer?.tags).map((t) => t.replace(/^([^:]+):\s*/, '$1: ')), labels: list(answer?.labels) };
}

// ---- B4.5 (F-6-15): readiness, GET /api/projects/:key/readiness (src/core/repo-readiness/report.mjs) ----
// classic's words: ui/public/readiness-chip.mjs CHIP_WORDS and LEVEL_WORDS
const LEVEL_WORD = { ready: 'Agent-ready', partial: 'Partly ready', 'not-ready': 'Not agent-ready', unknown: 'Not judged yet' };
const TOOL_WORD = { ready: 'Ready', partial: 'Partly ready', 'not-ready': 'Not ready' };
const GROUP_OF = { blocker: 'must', warn: 'should', info: 'advice' };
const count = (v) => (Number.isFinite(v) ? v : 0);
const obj = (v) => (v && typeof v === 'object' ? v : null);

/** dev's readiness answer → null (no answer), { off } (switched off on this Worca), { none } (not judged), or the
 *  report: its level and word, counts, the used tools (the run engine first), the tools not judged and the failing
 *  repository checks by severity. Strings stay raw; the caller escapes them. */
export function readinessOf(answer) {
  if (!obj(answer)) return null;
  if (answer.disabled === true) return { off: true };
  const rep = obj(answer.readiness);
  if (!rep) return { none: true };
  const level = LEVEL_WORD[rep.level] ? rep.level : 'unknown';
  const engines = Object.entries(obj(rep.engines) || {}).filter(([, e]) => obj(e));
  const runs = (e) => (Array.isArray(e.reasons) ? e.reasons : []).some((r) => r?.kind === 'run-engine');
  const used = engines.filter(([, e]) => e.used === true).sort(([, a], [, b]) => Number(runs(b)) - Number(runs(a)));
  const failing = { must: [], should: [], advice: [] };
  for (const c of Array.isArray(rep.checks) ? rep.checks : []) {
    const g = GROUP_OF[c?.severity];
    if (g && c.scope === 'repository' && c.status === 'fail' && typeof c.title === 'string') failing[g].push({ title: c.title, fix: typeof c.fix === 'string' ? c.fix : '' });
  }
  const n = obj(rep.counts) || {};
  return { level, word: LEVEL_WORD[level], mustFix: count(n.mustFix), shouldFix: count(n.shouldFix), passed: count(n.passed), applicable: count(n.applicable),
    tools: used.map(([name, e]) => ({ name: engineLabel(name), word: TOOL_WORD[e.level] || TOOL_WORD['not-ready'] })),
    notJudged: engines.filter(([, e]) => e.used !== true && !e.locked && e.level !== 'locked').map(([name]) => engineLabel(name)),
    failing, checkedAt: typeof rep.checkedAt === 'string' ? rep.checkedAt : null };
}

/** The Readiness row's summary line: "Partly ready · 2 must fix, 3 should fix"; none failing, "Agent-ready · 5 of 9
 *  checks pass" (classic's chipTooltip counts); '' when readiness is off. */
export function readinessLine(r) {
  if (!r || r.off) return '';
  if (r.none) return LEVEL_WORD.unknown;
  const parts = [r.mustFix && `${r.mustFix} must fix`, r.shouldFix && `${r.shouldFix} should fix`].filter(Boolean);
  return `${r.word} · ${parts.length ? parts.join(', ') : `${r.passed} of ${r.applicable} checks pass`}`;
}

// ---- B4.5 (F-6-15): team metrics, GET /api/projects/:key/team-metrics → { status } ----
// re-implemented from ui/public/team-metrics-surfaces.mjs projectTmState / projectTmSummary.short (not imported: classic)
const tmState = (s) => (s.hasOrigin === false ? 'no-origin' : !s.enabled ? 'off' : s.delegateTo && s.delegateState === 'invalid' ? 'delegate-invalid'
  : s.blocked ? 'blocked' : s.lastError && s.pending > 0 ? 'rejected' : s.pending > 0 ? 'pending' : s.delegateTo ? 'delegated' : 'on');
/** dev's team-metrics status → { state, word, scope, lastPush }; null for no status. */
export function metricsOf(status) {
  const s = obj(status);
  if (!s) return null;
  const state = tmState(s), excluded = s.record === false, runs = Number.isFinite(s.runs) ? `${s.runs} task${s.runs === 1 ? '' : 's'}` : '';   // a run is a task in every word a person reads
  const word = { 'no-origin': 'not available', off: 'off', 'delegate-invalid': 'delegate invalid', blocked: 'on · not recording', rejected: 'push failed', pending: `on · ${s.pending} pending push`,
    delegated: excluded ? `via ${s.delegateTo} · yours excluded` : `via ${s.delegateTo}`, on: excluded ? 'on · yours excluded' : runs ? `on · ${runs}` : 'on' }[state];
  const scope = ['no-origin', 'off'].includes(state) ? '' : s.delegateTo ? `via ${s.delegateTo}` : 'this project';
  return { state, word, scope, lastPush: typeof s.lastSyncAt === 'string' && s.lastSyncAt ? s.lastSyncAt : null };
}

// ---- B4.5 (F-6-15): team policy, GET /api/policy/scopes → { projects: [projectPolicyStatus] } ----
// re-implemented from ui/public/team-policy-view.mjs projectTpState / projectTpSummary.short (not imported: classic)
const tpState = (s) => (s.hasOrigin === false ? 'no-origin' : !s.present ? (s.unread ? 'blocked' : 'off') : s.unknownSchema ? 'unsupported'
  : s.delegateTo && s.delegateState === 'invalid' ? 'delegate-invalid' : s.blocked ? 'blocked' : s.delegateTo ? 'follows' : 'home');
/** The project's row of dev's policy scopes → { state, word, scope, updatedAt }; null when the scopes do not list it. */
export function policyOf(scopes, key) {
  const s = (Array.isArray(scopes?.projects) ? scopes.projects : []).find((x) => obj(x) && x.key === key);
  if (!s) return null;
  const state = tpState(s);
  const word = { 'no-origin': 'not available', off: 'off', unsupported: 'needs a newer Worca', 'delegate-invalid': 'follow invalid',
    blocked: s.delegateCode === 'DOC_UNKNOWN' || s.blocked === 'DOC_UNKNOWN' ? 'on · not read yet' : 'on · unresolved', follows: `follows ${s.home || s.delegateTo}`, home: 'home' }[state];
  return { state, word, scope: ['no-origin', 'off'].includes(state) ? '' : s.home || s.delegateTo || '', updatedAt: typeof s.updatedAt === 'string' && s.updatedAt ? s.updatedAt : null };
}

// ---- B4.5 (F-6-15): the done/stopped split, by run-state id (design-system run-state.mjs) ----
// noproject: dev's done with no branch left (live-map.mjs CALM_CASE finished-nogit), the commonest done of all
const DONE = new Set(['ready', 'approved', 'merged', 'kept', 'labelled', 'noproject']), STOPPED = new Set(['stopped', 'discarded']), FAILED = new Set(['failed']);
/** State ids → { done, stopped, failed }; any other id is not ended. */
export function endsOf(stateIds = []) {
  const out = { done: 0, stopped: 0, failed: 0 };
  for (const id of stateIds) { if (DONE.has(id)) out.done += 1; else if (STOPPED.has(id)) out.stopped += 1; else if (FAILED.has(id)) out.failed += 1; }
  return out;
}

// ---- B4.5 (F-6-19): the record a project page draws before the store loads ----
/** GET /api/projects → the project's early record (no sync read yet: origin `reading`, which has no word and no
 *  action), or null when the answer does not list the key. */
export function knownOf(answer, key) {
  const row = (Array.isArray(answer?.projects) ? answer.projects : []).find((p) => obj(p) && p.key === key);
  if (!row) return null;
  const p = projectOf(row, null);
  return { ...p, origin: p.origin === 'missing' || p.origin === 'folder' ? p.origin : 'reading', needs: false, early: true };
}

/** A moment in relative words, for the last push: "just now", "15 min ago", "2 h ago", "3 days ago". live-map.mjs
 *  timeOf says a clock time or a weekday instead, which reads as a time of day, not how long ago. */
export function timeWord(iso, now) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const min = Math.floor(Math.max(0, now - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}
