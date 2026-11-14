// ui/public/stillhet/live/projects-map.mjs — Stillhet slice 9 D5: pure. A project page's "How its tasks run" sentences
// (projects/projects.js SETS) against dev's project settings (GET/PATCH /api/projects/:key/settings, the settings
// cascade's ids), and the default tags and Labels answer. Dev's record names are read here and in live-map.mjs only.

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
