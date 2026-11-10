// src/core/requirements/ready.mjs
// Readiness, displayed state and changes since a start (A2 D1, D2, D4, D11). Pure: no I/O.
import { LIST_SECTIONS } from './spec.mjs';

export const OVERRIDABLE = Object.freeze(['goal', 'criteria', 'interview', 'openQuestions', 'assumptions']);

const turnIds = (p) => (p && Array.isArray(p.ids) ? p.ids : (p && p.id != null ? [p.id] : []));

/** Ids of rejected assumptions no round has asked about since their latest rejection (D4). A round after
 *  that rejection asked about it when it is a follow-up round naming it (`payload.followUp`), whatever its
 *  questions: "done" with none means nothing was left to ask; or when it is an ordinary round that asked at
 *  least one question. An ordinary round with no questions (a final round) asked nothing. */
export function unaskedRejections(spec, turns = []) {
  const list = Array.isArray(turns) ? turns : [];
  const rounds = list.filter((t) => t && t.kind === 'round' && t.payload);
  const out = [];
  for (const a of (spec && spec.assumptions) || []) {
    if (a.status !== 'rejected') continue;
    let rej = -Infinity;
    for (const t of list) {
      if (t && t.kind === 'assumption' && t.payload && t.payload.status === 'rejected'
        && turnIds(t.payload).includes(a.id) && t.id > rej) rej = t.id;
    }
    const asked = rej !== -Infinity && rounds.some((t) => t.id > rej
      && (Array.isArray(t.payload.followUp) ? t.payload.followUp.includes(a.id) : (t.payload.questions?.length || 0) > 0));
    if (!asked) out.push(a.id);
  }
  return out;
}

/** A8 D8: the files no round has asked about since they were last added or replaced (ids). A round asked about a file
 *  only when its prompt carried the file's text (its payload `files`, recorded by runRound): a round that ran while the
 *  file was still being read listed it by name only. A file still being read counts; one that failed or that the budget
 *  stopped does not (the interview lists it by name only). After a start there are none: a change then counts as a
 *  change since the start. A6.1 D10: a file still being downloaded counts as one being read. */
export function unaskedFiles(files = [], turns = []) {
  const list = Array.isArray(turns) ? turns : [];
  if (list.some((t) => t && t.kind === 'start')) return [];
  const rounds = list.filter((t) => t && t.kind === 'round' && t.payload);
  const out = [];
  for (const f of files || []) {
    if (!f || (f.status !== 'reading' && f.status !== 'downloading' && f.status !== 'done')) continue;
    let changed = -Infinity;
    for (const t of list) {
      if (t && t.kind === 'file' && t.payload && t.payload.id === f.id && (t.payload.action === 'added' || t.payload.action === 'replaced') && t.id > changed) changed = t.id;
    }
    const asked = rounds.some((t) => t.id > changed && Array.isArray(t.payload.files) && t.payload.files.includes(f.id));
    if (changed !== -Infinity && !asked) out.push(f.id);
  }
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function readiness(feature, { turns = [], target = { ok: true }, files = [] } = {}) {
  const spec = (feature && feature.spec) || {};
  const goal = spec.goal || {};
  const criteria = spec.criteria || [];
  const assumptions = spec.assumptions || [];
  const openQ = (spec.openQuestions || []).length;
  let latest = null;
  for (const t of turns || []) if (t && t.kind === 'round' && (!latest || t.id > latest.id)) latest = t;
  const waiting = feature && feature.pending && feature.pending.questions ? feature.pending.questions.length : 0;
  const open = assumptions.filter((a) => a.status === 'open').length;
  const unasked = unaskedRejections(spec, turns);
  const unaskedF = unaskedFiles(files, turns);   // A8 D8: a file added or replaced after the interview fails "Interview finished"
  const nameOf = (id) => ((files || []).find((x) => x && x.id === id) || {}).name || id;
  // A file to ask about that is still being read: the follow-up waits for the read, and the check says so in the
  // page's reading words (A8 D2), not "to ask about" yet (A6.1: a ticket file still downloading too).
  const readingF = unaskedF.filter((id) => ['reading', 'downloading'].includes(((files || []).find((x) => x && x.id === id) || {}).status));

  let assumptionHint = '';
  if (open) assumptionHint = `${open} to decide`;
  else if (unasked.length) assumptionHint = `${unasked.join(', ')} rejected: ask about ${unasked.length === 1 ? 'it' : 'them'}`;

  const mk = (key, ok, label, hint) => ({ key, ok, label, hint: ok ? '' : hint });
  const checks = [
    mk('goal', !!(goal.text && goal.measure), 'Goal with a success measure', goal.text ? 'add a success measure' : 'no goal yet'),
    mk('criteria', criteria.length >= 1,
      criteria.length ? plural(criteria.length, 'acceptance criterion', 'acceptance criteria') : 'No acceptance criteria',
      'add at least one'),
    mk('interview', !!(latest && latest.payload && latest.payload.done === true) && !unaskedF.length, 'Interview finished',
      waiting ? `${plural(waiting, 'question', 'questions')} waiting`
        : readingF.length ? `Reading ${plural(readingF.length, 'file', 'files')}…`
          : unaskedF.length === 1 ? `${nameOf(unaskedF[0])} to ask about`
            : unaskedF.length ? `${unaskedF.length} files to ask about` : 'not finished'),
    mk('openQuestions', openQ === 0, 'No open questions', `${openQ} open`),
    mk('assumptions', !open && !unasked.length, 'Every assumption decided', assumptionHint),
    mk('target', !!(target && target.ok), (target && target.label) || 'Project or workspace exists',
      (target && target.hint) || 'the project or workspace is missing'),
  ];
  const passed = checks.filter((c) => c.ok).length;
  const ok = passed === checks.length;
  return { ok, passed, total: 6, checks, overridable: !ok && checks.every((c) => c.ok || OVERRIDABLE.includes(c.key)) };
}

export function displayState(feature, { ready, starts = [] } = {}) {
  const status = feature && feature.status;
  if (status === 'archived') return 'archived';
  if (status === 'looking' || status === 'thinking' || (feature && feature.busy)) {
    return status === 'looking' || (feature && feature.busy === 'looking') ? 'looking' : 'thinking';
  }
  if (starts && starts.length > 0) return 'started';
  if (status === 'your_turn') return 'your_turn';
  return ready && ready.ok ? 'ready' : 'decide';
}

/** The lines a whole list gains and loses (A2 D11's changes since a start; A3 D8's proposal cards). */
export const diffList = (b, a) => ({ added: a.filter((x) => !b.includes(x)), removed: b.filter((x) => !a.includes(x)) });

/** The changes since a start (A2 D11), and with the files lists (A8 D14) the files the start sent against the ones it
 *  would send now: one line for a file added to the list, one left out of it (its switch off, or removed), one replaced
 *  (another sha256). Without both lists, no file lines. */
export function changedSince(before, after, { filesBefore = null, filesNow = null } = {}) {
  const b = before || {}, a = after || {};
  const out = [];
  for (const field of ['text', 'measure']) {
    const x = (b.goal && b.goal[field]) || '', y = (a.goal && a.goal[field]) || '';
    if (x !== y) out.push({ kind: 'goal', field, before: x, after: y });
  }
  for (const section of LIST_SECTIONS) {
    const { added, removed } = diffList(b[section] || [], a[section] || []);
    if (added.length || removed.length) out.push({ kind: 'section', section, added, removed });
  }
  const bc = new Map((b.criteria || []).map((c) => [c.id, c]));
  const ac = new Map((a.criteria || []).map((c) => [c.id, c]));
  for (const [id, c] of ac) {
    if (!bc.has(id)) out.push({ kind: 'criterion', id, change: 'added', after: c.text });
    else if (bc.get(id).text !== c.text) out.push({ kind: 'criterion', id, change: 'edited', before: bc.get(id).text, after: c.text });
  }
  for (const [id, c] of bc) if (!ac.has(id)) out.push({ kind: 'criterion', id, change: 'removed', before: c.text });
  const ba = new Map((b.assumptions || []).map((x) => [x.id, x]));
  const aa = new Map((a.assumptions || []).map((x) => [x.id, x]));
  for (const [id, x] of aa) {
    if (!ba.has(id)) out.push({ kind: 'assumption', id, change: 'added', after: x.text });
    else if (ba.get(id).status !== x.status) out.push({ kind: 'assumption', id, change: 'status', before: ba.get(id).status, after: x.status });
  }
  if (Array.isArray(filesBefore) && Array.isArray(filesNow)) {
    const was = new Map(filesBefore.map((x) => [x.id, x]));
    const now = new Map(filesNow.map((x) => [x.id, x]));
    for (const [id, x] of now) {
      if (!was.has(id)) out.push({ kind: 'file', change: 'added', name: x.name });
      else if (was.get(id).sha256 !== x.sha256) out.push({ kind: 'file', change: 'replaced', name: x.name });
    }
    for (const [id, x] of was) if (!now.has(id)) out.push({ kind: 'file', change: 'removed', name: x.name });
  }
  return out;
}
