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

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function readiness(feature, { turns = [], target = { ok: true } } = {}) {
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

  let assumptionHint = '';
  if (open) assumptionHint = `${open} to decide`;
  else if (unasked.length) assumptionHint = `${unasked.join(', ')} rejected: ask about ${unasked.length === 1 ? 'it' : 'them'}`;

  const mk = (key, ok, label, hint) => ({ key, ok, label, hint: ok ? '' : hint });
  const checks = [
    mk('goal', !!(goal.text && goal.measure), 'Goal with a success measure', goal.text ? 'add a success measure' : 'no goal yet'),
    mk('criteria', criteria.length >= 1,
      criteria.length ? plural(criteria.length, 'acceptance criterion', 'acceptance criteria') : 'No acceptance criteria',
      'add at least one'),
    mk('interview', !!(latest && latest.payload && latest.payload.done === true), 'Interview finished',
      waiting ? `${plural(waiting, 'question', 'questions')} waiting` : 'not finished'),
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

const diffList = (b, a) => ({ added: a.filter((x) => !b.includes(x)), removed: b.filter((x) => !a.includes(x)) });

export function changedSince(before, after) {
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
  return out;
}
