// src/shared/shape/req-change.mjs — Shaper small runs C4: a requirement change mid-build. The case table (where the run
// that owns the requirement is), the fold's three rows, and every word of the notice, the log row and the re-plan
// feedback. Pure and browser-safe: the change path (src/core/shape/changes.mjs), the feature card, the stop card and the
// chat card all read their words here.
import { CRITERION_ID_RE } from '../review/coverage.mjs';

export const CHANGE_CASES = Object.freeze(['not-started', 'waiting', 'running', 'finished', 'none']);
/** The newest change entries kept in `outline.changes`. */
export const CHANGES_MAX = 32;
/** A requirement's new text, at most. */
export const CHANGE_TEXT_MAX = 300;

const CASE_OF = {
  planned: 'not-started', missed: 'not-started', held: 'not-started',
  stopped: 'waiting', error: 'waiting', failed: 'waiting', paused: 'waiting', interrupted: 'waiting', approval: 'waiting', questions: 'waiting',
  starting: 'running', shaping: 'running', running: 'running',
  done: 'finished',
};

/** featureView's slice state of the owner → its change case. canceled, or no owner at all → none. */
export const changeCaseOf = (sliceState) => CASE_OF[sliceState] || 'none';

export const CHANGE_RULE_LINE = 'How a change lands · by where the run that owns the requirement is';

const RULES = [
  ['Not started', 'plans from the new text'],
  ['Running', 'stops, re-plans from the new text, continues · told, not asked'],
  ['Finished', 'a new small change run is added, takes the next turn; the finished run and its PR stay as they are'],
];
const MARKED_ROW = { 'not-started': 'Not started', waiting: 'Not started', running: 'Running', finished: 'Finished' };

/** The fold's three check items (buildCheckRows): the case name in the id column, one `check` mark on this change's row. */
export function changeRuleRows(caseKey) {
  return RULES.map(([id, label]) => {
    const on = MARKED_ROW[caseKey] === id;
    return { id, idCol: true, label, pass: true, mark: on ? 'check' : 'none', ariaLabel: on ? 'this change' : 'not this change' };
  });
}

const HEAD_STATE = { 'not-started': 'has not started', waiting: 'is waiting', running: 'was running', finished: 'is finished' };

/** The notice's head: the requirement, the owner and its state, once. */
export function reqChangeHead(entry) {
  const st = HEAD_STATE[entry && entry.case];
  return st && Number.isInteger(entry.run) ? `${entry.id} changed · run ${entry.run} ${st}` : `${entry.id} changed`;
}

/** A requirement's text on one line: every whitespace run (newlines included) is one space; '' for a non-string. */
export const oneLineText = (t) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '');

const clip = (t, n) => { const s = oneLineText(String(t || '')); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

function sourceText(entry) {
  const src = entry.source || {};
  if (src.kind !== 'run' || !Number.isInteger(src.run)) return 'Changed in chat';
  // The asker is the owner: the head already names its run.
  return src.run === entry.run ? 'Changed from its own review' : `Changed from run ${src.run}'s review`;
}

function landing(entry) {
  switch (entry.case) {
    case 'not-started': return 'It plans from the new text.';
    case 'waiting':
      if (entry.self) return 'It re-plans from the new text now.';
      return entry.closedAsk ? 'Its open question was closed; it plans from the new text when it resumes.' : 'It plans from the new text when it resumes.';
    case 'running': return 'It stopped, re-plans from the new text and continues.';
    case 'finished': return `Run ${entry.added}, a small change run, takes the next turn.`;
    default: return '';
  }
}

/** The notice's one line. `time` is the caller's clock text (15:03). */
export function reqChangeNotice(entry, { time = '' } = {}) {
  const l = landing(entry);
  return `${sourceText(entry)}${time ? ` at ${time}` : ''}: “${clip(entry.to, 120)}”. ${l ? `${l} ` : ''}You are told, not asked.`;
}

/** The feature log's row for a change that is not (or no longer) on the notice. */
export function reqChangeLogText(entry) {
  const head = `${entry.id} changed`;
  if (!Number.isInteger(entry.run)) return head;
  if (entry.case === 'finished') return Number.isInteger(entry.added) ? `${head} · run ${entry.added} added: a small change run` : head;
  if (entry.case === 'running' || (entry.case === 'waiting' && entry.self)) return `${head} · run ${entry.run} re-planned from the new text`;
  if (entry.case === 'not-started' || entry.case === 'waiting') return `${head} · run ${entry.run} plans from the new text`;
  return head;
}

/** The asking run's re-plan feedback. `changeRun`: the run that builds the change, for an asker that does not own it. */
export function requirementChangedFeedback(change, { changeRun = null } = {}) {
  const lines = (Array.isArray(change) ? change : []).map((c) => `${c.id} now reads: ${c.to}`);
  return `## Requirement changed\n\n${lines.join('\n')}\n`
    + (Number.isInteger(changeRun) ? `\nRun ${changeRun} builds this change; plan your own requirements against the new text.\n` : '');
}

/** One change as a person or a reviewer proposed it → {ok:true, change:{id, from, to}} | {ok:false, code}. */
export function normalizeChange(raw) {
  const id = raw && typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!CRITERION_ID_RE.test(id)) return { ok: false, code: 'INVALID_ID' };
  // One line: a newline in the text would add a criterion line or a prompt line wherever the text is spliced in.
  const to = oneLineText(raw.to);
  if (!to || to.length > CHANGE_TEXT_MAX) return { ok: false, code: 'INVALID_TEXT' };
  const from = typeof raw.from === 'string' ? raw.from : '';
  if (to === from) return { ok: false, code: 'UNCHANGED' };
  return { ok: true, change: { id, from, to } };
}
