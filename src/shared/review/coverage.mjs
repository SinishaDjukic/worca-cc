// src/shared/review/coverage.mjs — keyed acceptance criteria (`R-po-1`, `R-sec-2`, …) as data: the list a requirements
// file holds, the check that list must pass before it is agreed, and which criteria a plan covers. Deterministic: a
// line either names an id or it does not; no model is ever asked. The Check shape is the one buildCheckRows reads.
// Pure and browser-safe.

export const CRITERION_ID_RE = /^R-[a-z]{1,8}-[1-9]\d*$/;
/** Criteria one perspective may hold: its plan checklist takes them plus the planner's own, under the cap of 8. */
export const CRITERIA_MAX_PER_PREFIX = 6;

const ITEM_RE = /^\s*-\s+(?:\*\*(R-[a-z]{1,8}-\d+)\*\*|\[[ xX]\]\s+(R-[a-z]{1,8}-\d+))\s*(.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const EXCLUDED_SECTIONS = new Set(['clarifications (q&a)', 'out of scope', 'open questions']);
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const bareTitle = (t) => oneLine(t).replace(/^\d+(?:\.\d+)*\.?\s+/, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The non-fenced lines of a markdown text, each with the heading stack it sits under. */
function* walk(markdown) {
  let fenced = false;
  for (const line of String(markdown ?? '').split('\n')) {
    if (FENCE_RE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    yield line;
  }
}

/** `- **R-x-n** text` and `- [ ] R-x-n text` lines, in source order; the first of two duplicate ids wins. */
export function criteriaList(markdown) {
  const out = [];
  const seen = new Set();
  for (const line of walk(markdown)) {
    const m = ITEM_RE.exec(line);
    const id = m && (m[1] || m[2]);
    if (!id || !CRITERION_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text: oneLine(m[3]) });
  }
  return out;
}

export const criterionIds = (markdown) => criteriaList(markdown).map((c) => c.id);

const prefixOf = (id) => id.split('-')[1];
const checkOf = (items, extra = {}) => {
  const passed = items.filter((i) => i.pass).length;
  return { ok: passed === items.length, passed, total: items.length, items, ...extra };
};

/** A requirements file's own check: a row per criterion, plus a failing row per agreed id it lost, per repeated id
 *  and per criterion past the 6th of one perspective. */
export function criteriaCheck(markdown, { agreed = [] } = {}) {
  const criteria = criteriaList(markdown);
  const items = criteria.map((c) => ({ id: c.id, label: c.text ? `${c.id} · ${c.text}` : c.id, pass: true }));
  const have = new Set(criteria.map((c) => c.id));
  for (const id of agreed) if (!have.has(id)) items.push({ id, label: `${id} · agreed in the spec but missing`, pass: false });
  const counted = new Set();
  for (const line of walk(markdown)) {
    const m = ITEM_RE.exec(line);
    const id = m && (m[1] || m[2]);
    if (!id || !CRITERION_ID_RE.test(id)) continue;
    if (counted.has(id)) items.push({ id, label: `${id} · listed twice`, pass: false });
    counted.add(id);
  }
  const perPrefix = new Map();
  for (const c of criteria) {
    const n = (perPrefix.get(prefixOf(c.id)) || 0) + 1;
    perPrefix.set(prefixOf(c.id), n);
    if (n > CRITERIA_MAX_PER_PREFIX) items.push({ id: c.id, label: `${c.id} · more than ${CRITERIA_MAX_PER_PREFIX} for one perspective`, pass: false });
  }
  return checkOf(items, { criteria });
}

/** Which criteria a plan covers. A criterion is covered by the first non-fenced line naming its id, outside every
 *  `### Checklist` block and outside the Clarifications, Out of scope, Risks… and Open questions sections (a mention
 *  there is not delivery). `opts.texts` maps an id to its criterion text, shown on a row that is not covered. */
export function coverageOf(ids, planMarkdown, { texts = {} } = {}) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && CRITERION_ID_RE.test(id)))];
  if (!list.length) return { ok: true, passed: 0, total: 0, items: [] };
  const found = new Map();                              // id -> { line, heading }
  const res = list.map((id) => [id, new RegExp(`(?<![A-Za-z0-9-])${escapeRe(id)}(?![0-9])`)]);
  let heading = '';
  let skipUntil = 0;                                     // skip lines until a heading of this level or higher (0: none)
  for (const line of walk(planMarkdown)) {
    const h = HEADING_RE.exec(line);
    if (h) {
      const level = h[1].length;
      if (skipUntil && level <= skipUntil) skipUntil = 0;
      heading = bareTitle(h[2]);
      const title = heading.toLowerCase();
      if (!skipUntil && level === 3 && title === 'checklist') skipUntil = 3;
      if (!skipUntil && level <= 2 && (EXCLUDED_SECTIONS.has(title) || title.startsWith('risks'))) skipUntil = level;
      continue;
    }
    if (skipUntil) continue;
    for (const [id, re] of res) if (!found.has(id) && re.test(line)) found.set(id, { line, heading });
  }
  const items = list.map((id) => {
    const hit = found.get(id);
    if (!hit) return { id, label: `${id} · not covered by any step`, pass: false, detail: oneLine(texts[id]) };
    const step = /\bStep (\d+)\b/.exec(hit.line) || /\bStep (\d+)\b/.exec(hit.heading);
    return { id, label: `${id} · covered by ${step ? `Step ${step[1]}` : hit.heading}`, pass: true, section: hit.heading };
  });
  return checkOf(items);
}
