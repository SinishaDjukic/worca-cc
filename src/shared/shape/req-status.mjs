// src/shared/shape/req-status.mjs — Shaper small runs D3 (D1): THE one requirement status. Every surface (the Ship
// card, the run page's Owns rows, the feature page's Requirements) shows the `word` or `text` computed here, once, on
// the server (ship-ledger.mjs shipLedger's `shown`); none builds a status word itself. Pure and browser-safe; imports
// nothing from ship-ledger.mjs, which imports it.

/** Feature D1 (owner direction): the words of a person's mark on a requirement they confirm. */
export const MARK_WORDS = Object.freeze({ met: 'Met', 'not-met': 'Not met', dropped: 'Dropped' });

const BUILDING = new Set(['running', 'shaping', 'starting']);
const WAITING = new Set(['approval', 'questions', 'stopped', 'error', 'failed', 'missed']);
const said = (word, mark) => ({ word, mark });

/** A run's state (featureView's slice state) as the requirement's word and mark. An open stop question whose answer
 *  is not held for another run's turn waits for you; any state it does not know is `to do`. */
export function runWord(state, stop = null) {
  if (state === 'done') return said('met', 'check');
  if (WAITING.has(state) || (stop && !stop.held)) return said('waiting for you', '?');
  if (BUILDING.has(state)) return said('being built', 'live');
  if (state === 'paused') return said('paused', 'paused');
  return said('to do', 'wait');
}

const list = (v) => (Array.isArray(v) ? v : []);

/**
 * The runs that build a requirement again after its owner: a change (`outline.changes[]`, landing on the added change
 * run when the owner was finished, else on the owner; case `none` lands nowhere) and every Verifier check's gaps (the
 * gap run `gapRuns[i]` of `result.gaps[i]`). Merged by `at`, ties in source order (changes first).
 * @returns {Array<{ id: string, run: number, why: 'change'|'gap', at: string }>}
 */
export function rerunsOf(outline) {
  const o = outline && typeof outline === 'object' ? outline : {};
  const out = [];
  for (const e of list(o.changes)) {
    if (!e || e.case === 'none') continue;
    const run = e.case === 'finished' ? e.added : e.run;
    if (typeof e.id === 'string' && Number.isInteger(run)) out.push({ id: e.id, run, why: 'change', at: String(e.at || '') });
  }
  for (const c of list(o.verify && o.verify.checks)) {
    const gaps = list(c && c.result && c.result.gaps);
    gaps.forEach((g, i) => {
      const run = list(c.gapRuns)[i];
      if (g && typeof g.id === 'string' && Number.isInteger(run)) out.push({ id: g.id, run, why: 'gap', at: String(c.at || '') });
    });
  }
  return out.map((x, i) => [x, i]).sort((a, b) => (a[0].at < b[0].at ? -1 : a[0].at > b[0].at ? 1 : a[1] - b[1])).map(([x]) => x);
}

/** An owned requirement's word: gap accepted first, else the newest rerun of its id, else its owning run's state. */
function ownedWord(entry, stateOf, reruns) {
  if (entry.status === 'gap-accepted') return said('gap accepted', 'x');
  const x = list(reruns).filter((r) => r && r.id === entry.id).at(-1);
  if (!x) return stateOf(entry.run);
  const xs = stateOf(x.run);
  const met = xs.word === 'met';
  if (x.run === entry.run) return said(met ? 'met' : x.why === 'gap' ? 'gap' : 'changed', xs.mark);
  if (x.why === 'gap') return said(met ? `met · fixed by run ${x.run}` : `gap · run ${x.run} fixes it`, xs.mark);
  return said(met ? `met · changed by run ${x.run}` : `changed · run ${x.run} builds it`, xs.mark);
}

/**
 * The status of one ship-ledger entry: an owned one (`{id, run, status}`) or a confirmed one (`{roleLabel, state, mark,
 * reason}`). `runs` = [{index, state, stop}] (the view's slices), `reruns` = rerunsOf(outline).
 * `text` is the whole note; `word` the status alone (the run page, whose head already names the run).
 * @returns {{ owner: string, role: string|null, word: string, text: string, mark: string }}
 */
export function requirementStatus(entry, { runs = [], reruns = [] } = {}) {
  const e = entry || {};
  if (typeof e.roleLabel === 'string') {
    const owner = 'confirmed by a person';
    const role = e.roleLabel;
    // Slice 7 (R-ux-2): the person using the app confirms; the role is a detail. `owner` stays the kind (data-owner).
    if (e.state === 'waiting') { const word = 'waiting for you to confirm'; return { owner, role, word, text: `${word} · ${role}`, mark: 'wait' }; }
    const marked = `Marked ${MARK_WORDS[e.mark] || ''} by you`;
    if (e.state === 'needs-reason') return { owner, role, word: marked, text: marked, mark: 'x' };
    if (e.mark === 'met') { const word = 'confirmed by you'; return { owner, role, word, text: `${word} · ${role}`, mark: 'check' }; }
    return { owner, role, word: marked, text: e.reason ? `${marked} · ${e.reason}` : marked, mark: e.mark === 'dropped' ? 'none' : 'x' };
  }
  // Fail closed (ship-ledger.mjs): no run owns it and no person confirms it.
  if (e.status === 'unowned') return { owner: 'no run', role: null, word: 'confirmed by no person', text: 'owned by no run · confirmed by no person', mark: 'x' };
  const byIndex = new Map(list(runs).filter((r) => r && Number.isInteger(r.index)).map((r) => [r.index, r]));
  const stateOf = (n) => { const r = byIndex.get(n); return r ? runWord(r.state, r.stop || null) : runWord(undefined); };
  const owner = Number.isInteger(e.run) ? `run ${e.run}` : 'a run';
  const { word, mark } = ownedWord(e, stateOf, reruns);
  return { owner, role: null, word, text: `${owner} · ${word}`, mark };
}
