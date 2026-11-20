// src/shared/shape/acceptance.mjs — Shaper requirements s3 (D7): the acceptance ledger of a feature with agreed
// requirements. Before the PR, every agreed R-* is marked met, not met (with where it moved) or dropped (with a
// reason). Stored as `outline.acceptance`. Pure and browser-safe: the server's ship gate and the ship card use it.

export const ACCEPTANCE_MARKS = ['met', 'not-met', 'dropped'];
export const ACCEPTANCE_TEXT_MAX = 300;

const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, ACCEPTANCE_TEXT_MAX).trim() : '');
const agreedIds = (agreed) => (Array.isArray(agreed) ? agreed : []).map((a) => a.id);

/** One entry's problem, or ''. */
function markError(id, mark, target, reason) {
  if (!ACCEPTANCE_MARKS.includes(mark)) return `${id}: the mark must be met, not-met or dropped`;
  if (mark === 'not-met' && !target) return `${id}: not met needs where it moved`;
  if (mark === 'dropped' && !reason) return `${id}: dropped needs a reason`;
  return '';
}

/** The person's marks → { ok:true, entries } in agreed order (ids may be missing) | { ok:false, error }. */
export function normalizeAcceptance(raw, agreed) {
  if (!Array.isArray(raw)) return { ok: false, error: 'entries must be a list' };
  const ids = agreedIds(agreed);
  const byId = new Map();
  for (const e of raw) {
    const id = String(e?.id ?? '');
    if (!ids.includes(id)) return { ok: false, error: `${id} is not an agreed requirement` };
    if (byId.has(id)) return { ok: false, error: `${id} is marked twice` };
    const target = text(e.target);
    const reason = text(e.reason);
    const error = markError(id, e.mark, target, reason);
    if (error) return { ok: false, error };
    byId.set(id, { id, mark: e.mark, ...(e.mark === 'not-met' ? { target } : {}), ...(e.mark === 'dropped' ? { reason } : {}) });
  }
  return { ok: true, entries: ids.filter((id) => byId.has(id)).map((id) => byId.get(id)) };
}

/** The stored entry of each agreed id when its mark is valid. Entries for ids no longer agreed are ignored. */
function validMarks(agreed, entries) {
  const out = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const id = String(e?.id ?? '');
    if (out.has(id) || markError(id, e.mark, text(e.target), text(e.reason))) continue;
    out.set(id, e);
  }
  return new Map(agreedIds(agreed).filter((id) => out.has(id)).map((id) => [id, out.get(id)]));
}

/** The ship gate: ready once every agreed id carries a valid mark. */
export function acceptanceGate(agreed, entries) {
  const ids = agreedIds(agreed);
  const marks = validMarks(agreed, entries);
  const missing = ids.filter((id) => !marks.has(id));
  return { ready: missing.length === 0, marked: ids.length - missing.length, total: ids.length, missing };
}

const STATE_WORDS = { met: 'met', 'not-met': 'not met', dropped: 'dropped' };

/** The ledger as a check for buildCheckRows: one item per agreed id. A marked item passes (not met keeps its ✕
 *  through `state`); `editing` (the ready phase, where a picker shows the mark) drops the state words. */
export function ledgerCheck(agreed, entries, covered = [], { editing = false } = {}) {
  const marks = validMarks(agreed, entries);
  const cov = new Set(covered || []);
  const items = (Array.isArray(agreed) ? agreed : []).map(({ id, text: what }) => {
    const e = marks.get(id);
    const why = e?.mark === 'not-met' ? `moved to ${text(e.target)}` : e?.mark === 'dropped' ? text(e.reason) : '';
    const word = e ? STATE_WORDS[e.mark] : 'not marked';
    const label = [id, what, ...(editing ? [] : [word]), ...(why ? [why] : [])].filter(Boolean).join(' · ');
    return { id, label, pass: !!e, ...(e && e.mark !== 'met' ? { state: e.mark } : {}), ariaLabel: word,
      detail: cov.has(id) ? 'covered by the diff' : '' };
  });
  return { items, passed: items.filter((i) => i.pass).length, total: items.length };
}

/** The Changes-after-ship prompt block (D14): the agreed requirements as criterion lines, which the requirements
 *  drafter treats as agreed, and how each was marked before the PR. */
export function changesRequirementsBlock(agreed, entries) {
  const list = Array.isArray(agreed) ? agreed : [];
  if (!list.length) return '';
  const marks = validMarks(agreed, entries);
  const said = [...marks.values()].map((e) => (e.mark === 'met' ? `${e.id} met`
    : e.mark === 'not-met' ? `${e.id} not met, moved to ${text(e.target)}` : `${e.id} dropped (${text(e.reason)})`));
  return '## Agreed requirements\n\n' +
    'The shipped feature agreed these requirements. Update them for this change before the plan: keep, change or ' +
    'drop each, and add what the change needs.\n\n' +
    `${list.map((a) => `- **${a.id}** ${a.text}`).join('\n')}\n` +
    (said.length ? `\nMarked before the PR: ${said.join('; ')}.\n` : '');
}
