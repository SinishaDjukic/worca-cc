// src/shared/review/findings.mjs — the finding-disposition contract (#990 slice 3). A role review raises findings; the
// sink that acts on them (a refiner, an implementer) answers each id: fixed, or disputed with a reason. A finding with
// no answer stays open, and is never dropped. Every round carries plain counts. Pure and browser-safe: the
// orchestrator, run.mjs and the plan card import it.
export const DISPOSITIONS_MAX_BYTES = 262144;
const TEXT_MAX = 300;
const ENTRIES_MAX = 500;
const CONFLICTS_MAX = 4;
const CONFLICT_OPTIONS_MAX = 4;
const CHOICE_MAX = 500;
const PICKS_SCAN = CONFLICTS_MAX * 4;
const oneLine = (v, max = Infinity) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, max = ENTRIES_MAX) => (Array.isArray(v) ? v.slice(0, max) : []);
const live = (round) => (Array.isArray(round?.roles) ? round.roles : []).filter((r) => r && !r.skipped);

/** A sink's raw answer → Map(id → { status, reason }). `addressed` ids seed `fixed`; `dispositions` entries win. An
 *  unknown status, or `disputed` without a reason, is no answer: that finding stays open. */
export function normalizeDispositions(raw) {
  const out = new Map();
  for (const id of list(raw?.addressed)) if (oneLine(id)) out.set(oneLine(id), { status: 'fixed', reason: '' });
  for (const d of list(raw?.dispositions)) {
    const id = oneLine(d?.id);
    const reason = oneLine(d?.reason, TEXT_MAX);
    if (!id) continue;
    if (d.status === 'fixed') out.set(id, { status: 'fixed', reason });
    else if (d.status === 'disputed' && reason) out.set(id, { status: 'disputed', reason });
  }
  return out;
}

/** Mark the round's findings fixed / disputed / open (mutates and returns the round, with its counts). Skipped roles
 *  keep the record they carried from the last round. `fixedIn` is set only for a numbered version (a refiner sink). */
export function applyDispositions(round, raw, version = null) {
  const given = normalizeDispositions(raw);
  const v = typeof version === 'number' ? version : null;
  for (const r of live(round)) {
    for (const f of r.findings || []) {
      const d = given.get(f.id);
      delete f.fixedIn; delete f.disputedIn; delete f.reason;
      if (d?.status === 'fixed') { f.status = 'fixed'; if (v !== null) f.fixedIn = v; }
      else if (d?.status === 'disputed') { f.status = 'disputed'; f.disputedIn = v; f.reason = d.reason; }
      else f.status = 'open';
    }
  }
  return withCounts(round);
}

const COUNT_KEYS = ['raised', 'fixed', 'disputed', 'open'];
const validCounts = (c) => !!c && typeof c === 'object' && COUNT_KEYS.every((k) => Number.isInteger(c[k]) && c[k] >= 0);
function derive(findings) {
  const c = { raised: 0, fixed: 0, disputed: 0, open: 0 };
  for (const f of Array.isArray(findings) ? findings : []) {
    c.raised += 1;
    c[f?.status === 'fixed' || f?.status === 'disputed' ? f.status : 'open'] += 1;
  }
  return c;
}
const pick = (c) => Object.fromEntries(COUNT_KEYS.map((k) => [k, c[k]]));

/** One role record's counts: the stored ones when valid, else derived from its findings (any other status is open). */
export const roleCounts = (record) => (validCounts(record?.counts) ? pick(record.counts) : derive(record?.findings));

/** A round's counts: the sum over its non-skipped roles. */
export function reviewCounts(round) {
  const c = { raised: 0, fixed: 0, disputed: 0, open: 0 };
  for (const r of live(round)) { const rc = roleCounts(r); for (const k of COUNT_KEYS) c[k] += rc[k]; }
  return c;
}

/** Stamp derived counts on every non-skipped role and on the round; a skipped role carries none (mutates). */
export function withCounts(round) {
  for (const r of Array.isArray(round?.roles) ? round.roles : []) {
    if (!r) continue;
    if (r.skipped) delete r.counts; else r.counts = derive(r.findings);
  }
  if (round && typeof round === 'object') round.counts = reviewCounts(round);
  return round;
}

/** The old-data reader: a round's stored counts when valid, else derived from its finding statuses. */
export const roundCounts = (round) => (validCounts(round?.counts) ? pick(round.counts) : reviewCounts(round));

/** The finding ids a round raised (its non-skipped roles). */
export const findingIds = (round) => live(round).flatMap((r) => (r.findings || []).map((f) => f.id));

const sectionKey = (s) => oneLine(s).toLowerCase();

/** The sink's `conflicts` → [{ id: 'conflict-n', findings: [a, b], roles: [ka, kb], section, question, options }]. Kept
 *  only for two known findings of the round from two different roles on the same section, a 1–300 character question
 *  and 2–4 distinct options; one per unordered pair, at most 4. */
export function normalizeConflicts(raw, round) {
  const known = new Map(live(round).flatMap((r) => (r.findings || []).map((f) => [String(f.id), { role: r.key, section: f.section }])));
  const out = [];
  const seen = new Set();
  for (const c of list(raw?.conflicts, PICKS_SCAN)) {
    const ids = list(c?.findings, 2).map((x) => oneLine(x));
    const [a, b] = ids.map((id) => known.get(id));
    if (ids.length < 2 || !a || !b || a.role === b.role || sectionKey(a.section) !== sectionKey(b.section)) continue;
    const pair = [...ids].sort().join('\n');
    const question = oneLine(c.question);
    const options = [...new Set(list(c.options).map((o) => oneLine(o, TEXT_MAX)).filter(Boolean))].slice(0, CONFLICT_OPTIONS_MAX);
    if (seen.has(pair) || !question || question.length > TEXT_MAX || options.length < 2) continue;
    seen.add(pair);
    out.push({ id: `conflict-${out.length + 1}`, findings: ids, roles: [a.role, b.role], section: oneLine(a.section), question, options });
    if (out.length === CONFLICTS_MAX) break;
  }
  return out;
}

/** The person's picks → { ok: true, picks: [{ id, choice }] } | { ok: false, error }. Unknown, empty and repeated
 *  ids are dropped; at most 16 raw entries are read. A choice is an option or free text of up to 500 characters. */
export function normalizePicks(rawPicks, conflicts) {
  const ids = new Set((Array.isArray(conflicts) ? conflicts : []).map((c) => c.id));
  const picks = [];
  for (const p of list(rawPicks, PICKS_SCAN)) {
    const id = oneLine(p?.id);
    const choice = typeof p?.choice === 'string' ? oneLine(p.choice) : '';
    if (!ids.has(id) || !choice || picks.some((x) => x.id === id)) continue;
    if (choice.length > CHOICE_MAX) return { ok: false, error: `a decision is over ${CHOICE_MAX} characters` };
    picks.push({ id, choice });
  }
  return { ok: true, picks };
}

/** One Clarifications (Q&A) line per pick, in the plan's Q&A format. */
export function conflictClarifications(conflicts, picks) {
  const byId = new Map((Array.isArray(conflicts) ? conflicts : []).map((c) => [c.id, c]));
  return (Array.isArray(picks) ? picks : []).filter((p) => byId.has(p.id))
    .map((p) => `- **${p.id}** — ${byId.get(p.id).question} → **${oneLine(p.choice)} (decided at plan approval)**`);
}

const CLAR_RE = /^##[ \t]+Clarifications \(Q&A\)[ \t]*$/m;
/** The plan markdown with `lines` added at the end of its "## Clarifications (Q&A)" section (made when missing). The
 *  "No clarifications were required" line is dropped, and a line already in the file is not added again. */
export function withClarifications(markdown, rawLines) {
  const text = String(markdown ?? '');
  const have = new Set(text.split('\n'));
  const lines = (Array.isArray(rawLines) ? rawLines : []).filter((l) => !have.has(l));
  if (!lines.length) return text;
  const m = CLAR_RE.exec(text);
  if (!m) return `${text.replace(/\s*$/, '')}\n\n## Clarifications (Q&A)\n\n${lines.join('\n')}\n`;
  const start = m.index + m[0].length;
  const next = text.slice(start).search(/^##\s/m);
  const end = next === -1 ? text.length : start + next;
  const body = text.slice(start, end).replace(/^- No clarifications were required.*$/m, '').replace(/\s*$/, '');
  return text.slice(0, start) + (body ? `${body}\n` : '\n\n') + `${lines.join('\n')}\n`
    + (end < text.length ? `\n${text.slice(end)}` : '');
}

/** The dispositions file beside a findings file: `x-role-findings-r1.md` → `x-role-findings-r1-dispositions.json`. */
export const dispositionsPathFor = (findingsPath) => `${String(findingsPath).replace(/\.md$/i, '')}-dispositions.json`;

/** The `## Dispositions` section ending every findings file: the one wording every sink sees. */
export function dispositionsBlock(path) {
  return [
    '## Dispositions',
    '',
    'Answer EVERY finding id above in a JSON file at the path on the last line: '
      + '`{ "dispositions": [{ "id": "ux-1-1", "status": "fixed" }, { "id": "qa-1-1", "status": "disputed", "reason": "one line: why" }] }`. '
      + '`fixed` means you changed what it asks; `disputed` needs a one-line `reason`. An id you leave out counts as open.',
    '',
    'When two findings ask for opposite changes to one section, mark both `disputed` with the reason '
      + '"conflict, left to the person", and add `"conflicts": [{ "findings": ["ux-1-1", "qa-1-1"], "question": "the choice to make", '
      + '"options": ["one way", "the other way"] }]` with 2–4 options.',
    '',
    `Dispositions file: ${path}`,
    '',
  ].join('\n');
}
