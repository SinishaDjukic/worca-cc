// src/shared/away-mode/labels.mjs — the plain words for every Away mode setting and state.
// Zero imports: served to the browser at /src/shared. Copy: plans/away-mode-wording.md §3.

export const KIND_LABELS = Object.freeze({
  clarify: 'Clarifying questions before planning',
  questions: 'Questions an agent asks mid-step',
  form: 'Input forms',
  gate: 'Fix again or continue, in a review loop',
  workflow: 'Approving a proposed workflow',
  recovery: 'A step failed: retry or give up',
  'cost-cap': "Continuing past the team's cost cap",   // a record kind only (run-harness.mjs), not in NIGHT_KINDS
});
export const kindLabel = (k) => KIND_LABELS[k] || String(k);

/** The answers list's caption for one ask (run page, History run page). */
export const KIND_SHORT = Object.freeze({
  clarify: 'Clarifying questions',
  questions: 'Questions mid-step',
  form: 'Input form',
  gate: 'Review loop',
  workflow: 'Proposed workflow',
  recovery: 'Failed step',
  'cost-cap': "Team's cost cap",
});
export const kindShort = (k) => KIND_SHORT[k] || String(k);

// What a rule-based answer did, in words (the stored choice is the payload's value).
const OUTCOMES = Object.freeze({
  gate: { continue: 'Continued', another: 'One more fix round' },
  workflow: { accept: 'Accepted' },
  recovery: { retry: 'Retried', pause: 'Stopped retrying' },
  'cost-cap': { continue: 'Continued past the cap' },
});
const LIMITS = Object.freeze({ maxDecisions: 'Paused: answer limit reached', spendCap: 'Paused: spending cap reached' });
const sentence = (s) => {
  const t = String(s ?? '').trim().replace(/\.$/, '');
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : '';
};
// A row stored before the question's words were kept reads its id: "feature-scope" → "Feature scope".
const fromId = (id) => {
  const s = String(id ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_\s]+/g, ' ').trim();
  const n = /^q(\d+)$/i.exec(s);
  if (n) return `Question ${n[1]}`;
  return s ? `${s[0].toUpperCase()}${s.slice(1).toLowerCase()}` : 'Question';
};

/** Did the review (the nightDecider) give this question's answer? Judged per question: an ask's
 *  `strategy` joins its questions' ('weights+analysis'). A review that failed leaves the answer
 *  with no confidence (strategies.mjs decideQuestion), and the agent's own answer is 'weights'. */
const reviewAnswered = (x) => x.strategy === 'analysis' && Number.isFinite(x.confidence);

/** The rows one stored answer shows: one per question it answered, else one outcome.
 *  `q` = what was asked (null for an ask without questions), `a` = the answer, `why` = the reason
 *  ('' when there is none), `check` = worca was not sure. A limit row is a pause: never one to check.
 *  `by` (only on an answer the review gave, on a record that names its model) = the model id it ran
 *  on, null for the CLI's default model.
 *  @returns {{q: string|null, a: string, why: string, check: boolean, by?: string|null}[]} */
export function awayAnswerRows(d) {
  const rec = d && typeof d === 'object' ? d : {};
  if (rec.choice == null) return [{ q: null, a: LIMITS[rec.guardrail] || 'Paused', why: sentence(rec.rationale), check: false }];
  const qs = Array.isArray(rec.questions) ? rec.questions.filter((x) => x && typeof x === 'object') : [];
  if (qs.length) {
    // A flagged ask none of whose questions is marked (a form that fell back to its defaults): mark them all.
    const all = rec.flagged === true && !qs.some((x) => x.flagged === true);
    // Records stored before the model was kept have no `model` key: they show none.
    const model = rec.model === undefined ? undefined : (typeof rec.model === 'string' && rec.model ? rec.model : null);
    return qs.map((x) => ({
      q: typeof x.question === 'string' && x.question.trim() && x.question !== x.id ? x.question.trim() : fromId(x.id),
      a: x.choice == null || x.choice === '' ? 'No answer' : String(x.choice),
      why: sentence(x.rationale),
      check: all || x.flagged === true,
      ...(model !== undefined && reviewAnswered(x) ? { by: model } : {}),
    }));
  }
  const check = rec.flagged === true;
  if (rec.strategy === 'auto') return [{ q: null, a: 'Default answer', why: sentence(rec.rationale), check }];
  if (rec.kind === 'form') return [{ q: null, a: 'Default values', why: '', check }];
  const said = OUTCOMES[rec.kind] && OUTCOMES[rec.kind][rec.choice];
  return [{ q: null, a: said || String(rec.choice), why: sentence(rec.rationale), check }];
}

export const METHOD_OPTIONS = Object.freeze([
  { value: 'mixed', label: 'Trust the agent when it is sure, otherwise weigh the options', hint: '' },
  { value: 'weights', label: "Always trust the agent's recommendation", hint: '' },
  { value: 'analysis', label: 'Always weigh the options', hint: 'A separate read-only review scores each option.' },
]);

export const CRITERIA_LABELS = Object.freeze({
  matchesMemory: 'Matches what you decided before',
  reversible: 'Easy to undo',
  smallestScope: 'Changes the least',
  codebaseConventions: "Follows the codebase's conventions",
  cost: 'Costs the least',
});

export const FIELD_LABELS = Object.freeze({
  enabled: { label: 'Which runs', hint: '' },   // the radio options carry the hints; registry.mjs needs its own non-empty help
  window: { label: 'Away hours', hint: 'During these hours you count as away. worca answers on the runs allowed below.' },
  timeZone: { label: 'Time zone', hint: "Hours are read in this zone. Empty = this computer's zone." },
  graceMinutes: { label: 'Marked runs by day', hint: 'Outside away hours, a marked run is still answered once a question has waited this long. Unmarked runs are never answered by day.' },
  strategy: { label: 'Method', hint: 'Answers below the bar are still given, but flagged for you.' },
  minConfidence: { label: 'Trust the agent only if it is at least', hint: 'Below this, worca weighs the options instead (or flags the answer).' },
  minMargin: { label: '…and its choice leads the next one by', hint: 'A close call is not trusted.' },
  criteria: { label: 'What matters when weighing options', hint: '0 = ignore, 10 = decisive' },
  neverDecide: { label: 'Always wait for me on…', hint: 'Ticked kinds are never answered by worca, even while you are away. The run pauses on them.' },
  spendCapUsd: { label: 'Pause everything at', hint: 'Counted from the start of the current away stretch, across all projects. Not set = no cap.' },
  maxDecisions: { label: 'Pause a run after', hint: 'When worca has answered this many times on one run, the run pauses and waits for you.' },
  maxExtraCycles: { label: 'Extra fix rounds in a review loop', hint: 'When critical or major issues remain, worca may ask for this many more fix rounds. After that it continues and flags it.' },
  allowCostCapOverride: { label: "May exceed the team's cost cap", hint: "Off: a run pauses at the team's soft cost cap while you are away. On: worca keeps going and flags it." },
  deciderModel: { label: 'Decided by', hint: 'The model worca uses when it weighs the options.' },
  deciderEffort: { label: 'Effort', hint: 'How hard that model thinks while it weighs the options. Higher costs more. Not set = medium.' },
});

/** The "Decided by" effort choices: model-env.mjs EFFORTS (test/night-decider-model.test.mjs pins them equal). */
export const DECIDER_EFFORTS = Object.freeze(['medium', 'high', 'xhigh', 'max']);
/** The words around the "Decided by" picker and the answers list. */
export const DECIDER_WORDS = Object.freeze({
  sameAsRun: 'Same as the run',          // deciderModel not set: the run's model
  runModel: "the run's model",           // …inside "Same as my settings (…)" on the project tab
  defaultEffort: 'medium',               // deciderEffort not set
  notInstalled: 'not installed',         // a stored model that left the catalog
  defaultModel: 'the default model',     // the review ran with no model named (the CLI's own)
});
/** The "Decided by" picker's option groups: the Settings title-model picker's (app.js buildTitleModelOptions). */
/** The answers list's small line under an answer the review gave: "Decided by Opus 5.5". */
export const decidedByText = (label) => `Decided by ${label || DECIDER_WORDS.defaultModel}`;

// How an ask was answered when no review ran (one stored strategy word, or several joined by '+').
const NO_REVIEW = Object.freeze({ rule: 'rule', weights: "agent's pick", defaults: 'defaults', auto: 'defaults' });
/** The answers list's caption after "kind · time", per ASK (one review answers every question of it):
 *  - a review ran (`reviewId`/`reviewStatus`, or a booked `costUsd`): [the model it ran on, what it cost];
 *    one stopped before its result (`reviewStatus 'stopped'`, `costUsd` null) reads 'review stopped',
 *    then its lower bound and 'not in total' when `fmtFloor` prints one — never '$0.00';
 *  - no review call (a rule, the agent's own pick, default values): [how, fmtUsd(0)];
 *  - a pause (strategy 'guardrail'), a review stored before its cost was kept, or one whose call never
 *    reached the API: [] (nothing invented).
 *  `modelLabel(id)` → the catalog label (or null); a review with no model ran on the CLI's default.
 *  `fmtFloor(floorUsd)` → '≥$x' or '' (the app passes Task 6's floorText; this module keeps zero imports).
 *  @returns {string[]} */
export function awayAskCaption(d, { fmtUsd, modelLabel = () => null, fmtFloor = () => '' } = {}) {
  const rec = d && typeof d === 'object' ? d : {};
  if (rec.reviewId || rec.reviewStatus || Number.isFinite(rec.costUsd)) {
    const model = (typeof rec.model === 'string' && rec.model && modelLabel(rec.model)) || DECIDER_WORDS.defaultModel;
    if (rec.reviewStatus !== 'stopped' && Number.isFinite(rec.costUsd)) return [model, fmtUsd(rec.costUsd)];
    const floor = fmtFloor(rec.floorUsd);
    return floor ? [model, 'review stopped', floor, 'not in total'] : [model, 'review stopped'];
  }
  const parts = String(rec.strategy || '').split('+');
  if (parts.includes('analysis')) return [];
  const how = parts.map((p) => NO_REVIEW[p]).find(Boolean);
  return how ? [how, fmtUsd(0)] : [];
}

export const WHICH_RUNS_OPTIONS = Object.freeze([
  { value: false, label: 'Only runs I marked', hint: 'Mark a run when you start it (New run → "Mark this run", or --night). Other runs wait for you.' },
  { value: true, label: 'All runs', hint: 'Every run is answered while you are away, marked or not.' },
]);

export const RUN_SWITCH_OPTIONS = Object.freeze([
  { value: 'auto', label: 'As set up', tip: 'Follows Settings and whether you marked this run.' },
  { value: 'on', label: 'Answer for me now', tip: "worca answers this run's questions from now on, at any hour, even if away mode is paused." },
  { value: 'off', label: 'Never on this run', tip: 'worca never answers on this run, whatever the settings.' },
]);
export const RUN_SWITCH_TIP = 'Overrides Settings › Away mode for this run only.';

export const STATUS_ACTIONS = Object.freeze({
  auto: [
    { mode: 'on', label: "I'm away now", tip: 'worca answers on every run from now until you click "I\'m back".' },
    { mode: 'off', label: 'Pause away mode', tip: 'worca answers nothing, on any run, until you turn it back on. Your away hours are kept.' },
  ],
  // "I'm back" = "I'm here": here even inside the away hours; the next stretch applies by itself.
  on: [{ mode: 'here', label: "I'm back", tip: 'You count as here again, even inside your away hours. The next away hours apply by themselves.' }],
  off: [{ mode: 'auto', label: 'Turn away mode back on', tip: 'Go back to following your away hours.' }],
});

// With no away hours set, a tip never mentions them (keyed "<status>:<mode>").
const NO_HOURS_TIPS = Object.freeze({
  'auto:off': 'worca answers nothing, on any run, until you turn it back on.',
  'on:here': 'You count as here again.',
  'off:auto': 'worca answers again when you say you are away.',
});
/** The status buttons for `toggle`; `hours: false` = no away hours are set. */
export function statusActions(toggle, { hours = true } = {}) {
  const list = STATUS_ACTIONS[toggle] || STATUS_ACTIONS.auto;
  return hours ? list : list.map((a) => ({ ...a, tip: NO_HOURS_TIPS[`${toggle}:${a.mode}`] ?? a.tip }));
}

/** "Marked runs by day" when no away hours are set: there is no day, only "until you say you are away". */
export const GRACE_NO_HOURS = Object.freeze({
  label: 'Marked runs', hint: 'A marked run is answered once a question has waited this long. Unmarked runs wait for you.',
  never: 'Never', neverHint: 'Marked runs wait for you, like every other run.',
});

/** Run page pill: `now` | `wait` | `after` | `never`. */
export function pillText(state, minutes = 0) {
  switch (state) {
    case 'now': return 'answering';
    case 'after': return `answers after ${Math.max(1, Math.round(minutes))} min`;
    case 'never': return 'never';
    default: return 'waiting for you';
  }
}

/** How many answers the answers list shows for these stored records, and how many of them are to
 *  check: one per answered question (awayAnswerRows), never one per stored ask. A pause is not an answer. */
export function awayAnswerCounts(records) {
  let answers = 0;
  let checks = 0;
  for (const d of Array.isArray(records) ? records : []) {
    if (!d || typeof d !== 'object' || d.choice == null) continue;
    for (const row of awayAnswerRows(d)) {
      answers += 1;
      if (row.check) checks += 1;
    }
  }
  return { answers, checks };
}

/** The rows to check first, each side in its own order (the answers list, per ask). */
export const checksFirst = (rows) => [...rows.filter((r) => r.check), ...rows.filter((r) => !r.check)];

/** The end-of-run line every existing channel uses (chat, CLI, run pages): "5 answers while you were
 *  away — 2 to check", or null when Away mode gave no answer. `night` = the run's counters: the
 *  per-question {answers, checks} (awayAnswerCounts) when the run has them, else the per-ask
 *  {decisions, flagged} a run recorded before them. */
export function awayAnswersSummary(night) {
  const perQuestion = night && night.answers != null;
  const n = Math.max(0, Number(night && (perQuestion ? night.answers : night.decisions)) || 0);
  if (!n) return null;
  const m = Math.min(n, Math.max(0, Number(perQuestion ? night.checks : night.flagged) || 0));
  return `${n} answer${n === 1 ? '' : 's'} while you were away — ${m ? `${m} to check` : 'nothing to check'}`;
}
