// src/shared/flags/registry.mjs — the ONE list of feature flags (docs/feature-flags.md).
// Browser-safe: no node builtins, no imports. Served at /src/shared, so the server, the UI, the
// tests and the docs all read this same module (D1). Nothing is a flag unless it is listed here.
//
// Entry fields: key (camelCase), title, description (one line), stage (experimental | beta |
// retiring), default (experimental: always false; beta: may be true; retiring: the value it is
// forced to), owner (GitHub handle), since (version), added (YYYY-MM-DD), reviewBy (YYYY-MM-DD, at
// most FLAG_REVIEW_DAYS after added — or after extendedOn, which needs an extendReason), docs
// (optional docs/*.md), requires (optional: other flag keys that must be on).

export const FLAG_STAGES = Object.freeze(['experimental', 'beta', 'retiring']);
export const FLAG_KEY_RE = /^[a-z][a-zA-Z0-9]{2,40}$/;
export const FLAG_REVIEW_DAYS = 90;

const entry = (f) => Object.freeze({ ...f, requires: Object.freeze([...(f.requires || [])]) });

export const FLAGS = Object.freeze([
  // Proves the system end to end until a real feature uses it; the first real flag's PR removes it.
  entry({
    key: 'flagsDemo',
    title: 'Flags demo',
    description: 'Shows a note on this tab. It proves Labs switches work; the first real Labs feature replaces it.',
    stage: 'experimental',
    default: false,
    owner: 'e-angelov',
    since: '1.11.0',
    added: '2026-10-11',
    reviewBy: '2027-01-09',
  }),
  entry({
    key: 'keepAwake',
    title: 'Keep awake',
    description: 'Stops the computer from sleeping on its idle timer while agents are working. The display may still turn off.',
    stage: 'beta',
    default: true,
    owner: 'e-angelov',
    since: '1.11.0',
    added: '2026-10-12',
    extendedOn: '2026-10-19',
    extendReason: 'moved to beta, default on locally, with a switch in Settings › Runs (UI/UX review F)',
    reviewBy: '2027-01-15',
    docs: 'docs/feature-flags.md',
  }),
  entry({
    key: 'shapeFirst',
    title: 'Shaper',
    description: 'Shape a task in Chat before it runs: a few questions, a plan you approve, and large tasks cut into slices.',
    stage: 'experimental',
    default: false,
    owner: 'e-angelov',
    since: '1.11.0',
    added: '2026-10-15',
    reviewBy: '2027-01-13',
    docs: 'docs/shape-it-first.md',
  }),
  entry({
    key: 'runTags',
    title: 'Cost tags',
    description: 'Cost tags (client:acme, team:web) on the New run form, run pages, Runs list, Statistics and Team metrics, with optional tag dimensions from team policy or Settings.',
    stage: 'experimental',
    default: false,
    owner: 'e-angelov',
    since: '1.11.0',
    added: '2026-10-15',
    reviewBy: '2027-01-13',
    docs: 'docs/feature-flags.md',
  }),
  entry({
    key: 'runPresets',
    title: 'Run presets',
    description: 'Save a New run setup (workflow, engine, guardrails, agents, loops, branches, Away mark, opt-outs) as a named preset, then start a run, a schedule, `worca run --preset` or a Chat proposal from it.',
    stage: 'beta',
    default: true,
    owner: 'e-angelov',
    since: '1.11.0',
    added: '2026-10-16',
    extendedOn: '2026-10-17',
    extendReason: 'moved to beta once schedules, the CLI and Chat start from presets (#712 slice 3)',
    reviewBy: '2027-01-15',
    docs: 'docs/run-presets.md',
  }),
  entry({
    key: 'runLabels',
    title: 'Run labels',
    description: 'Free-word labels on runs (hotfix, needs demo): chips on the Runs list, run pages and chat run cards, a Label filter and a Label action for selected runs. Labels never affect cost, policy or reports.',
    stage: 'experimental',
    default: false,
    owner: 'e-angelov',
    since: '1.11.0',
    added: '2026-10-20',
    reviewBy: '2027-01-18',
    docs: 'docs/feature-flags.md',
  }),
  entry({
    key: 'requirements',
    title: 'Requirements',
    description: 'A Requirements page where a product owner turns an idea into a testable feature spec through a short interview with Worca, before any run starts.',
    stage: 'experimental',
    default: false,
    owner: 'TomicaB',
    since: '1.12.0',
    added: '2026-10-19',
    reviewBy: '2027-01-16',
    docs: 'docs/requirements.md',
  }),
]);

const BY_KEY = new Map(FLAGS.map((f) => [f.key, f]));
/** The registry entry for `key`, or null. */
export function flagByKey(key) { return BY_KEY.get(key) || null; }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 'YYYY-MM-DD' → whole UTC days since the epoch; NaN for anything that is not a real date. */
function dayNum(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return NaN;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s ? NaN : t / 86400000;
}

/**
 * Every problem with a registry list, as human-readable lines ([] = healthy). Pure: `today`
 * (YYYY-MM-DD) is passed in, so the "past its review date" rule is testable; omit it to skip that rule.
 * @param {ReadonlyArray<object>} list
 * @param {{today?:string}} [o]
 * @returns {string[]}
 */
export function registryProblems(list, { today } = {}) {
  const out = [];
  const byKey = new Map(list.map((f) => [f && f.key, f]));
  const seen = new Set();
  for (const f of list) {
    const k = f && f.key;
    const p = (m) => out.push(`${JSON.stringify(k)}: ${m}`);
    if (typeof k !== 'string' || !FLAG_KEY_RE.test(k)) p('key must be camelCase, 3 to 41 letters and digits');
    if (seen.has(k)) p('duplicate key');
    seen.add(k);
    for (const field of ['title', 'description', 'owner', 'since']) {
      if (typeof f[field] !== 'string' || !f[field].trim()) p(`${field} is required`);
    }
    if (!FLAG_STAGES.includes(f.stage)) p(`stage must be one of ${FLAG_STAGES.join(', ')}`);
    if (typeof f.default !== 'boolean') p('default must be true or false');
    else if (f.stage === 'experimental' && f.default) p('an experimental flag defaults to false');
    const added = dayNum(f.added);
    const review = dayNum(f.reviewBy);
    if (Number.isNaN(added)) p('added must be a YYYY-MM-DD date');
    if (Number.isNaN(review)) p('reviewBy must be a YYYY-MM-DD date');
    let from = added;
    if (f.extendedOn !== undefined) {
      from = dayNum(f.extendedOn);
      if (Number.isNaN(from) || from < added) p('extendedOn must be a YYYY-MM-DD date on or after added');
      if (typeof f.extendReason !== 'string' || !f.extendReason.trim()) p('extendedOn needs an extendReason');
    }
    if (!Number.isNaN(review) && !Number.isNaN(added) && review < added) p('reviewBy is before added');
    if (!Number.isNaN(review) && !Number.isNaN(from) && review - from > FLAG_REVIEW_DAYS) {
      p(`reviewBy is more than ${FLAG_REVIEW_DAYS} days after ${f.extendedOn !== undefined ? 'extendedOn' : 'added'}`);
    }
    if (today && !Number.isNaN(review) && review < dayNum(today)) {
      p(`past its review date ${f.reviewBy}: graduate it (delete the flag and its uses), move it on a stage, `
        + 'extend it (extendedOn + extendReason) or remove it');
    }
    if (f.docs !== undefined && !(typeof f.docs === 'string' && /^docs\/[\w./-]+\.md$/.test(f.docs))) p('docs must be a docs/*.md path');
    for (const r of f.requires || []) {
      if (r === k) p('requires itself');
      else if (!byKey.has(r)) p(`requires unknown flag ${JSON.stringify(r)}`);
      else if (byKey.get(r).stage === 'retiring') p(`requires retiring flag ${JSON.stringify(r)}`);
    }
  }
  const state = new Map();   // key -> 1 visiting | 2 done
  const visit = (k, path) => {
    if (state.get(k) === 2) return;
    if (state.get(k) === 1) { out.push(`requires cycle: ${[...path.slice(path.indexOf(k)), k].join(' → ')}`); return; }
    state.set(k, 1);
    for (const r of byKey.get(k)?.requires || []) if (r !== k && byKey.has(r)) visit(r, [...path, k]);
    state.set(k, 2);
  };
  for (const f of list) if (f && typeof f.key === 'string') visit(f.key, []);
  return out;
}
