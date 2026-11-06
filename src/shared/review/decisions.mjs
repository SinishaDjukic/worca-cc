// src/shared/review/decisions.mjs — decisions on an approval hold: the choices a sink leaves to the person (a gap one
// perspective found, a conflict between two), each with a recommended pick. The sink writes them as JSON; the person
// picks on the hold; the picks land in the held document's Clarifications. Pure and browser-safe.

export const DECISIONS_MAX = 8;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 4;
const TEXT_MAX = 300;
const LABEL_MAX = 200;
const VALUE_MAX = 60;
const LIST_MAX = 12;
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? [...new Set(v.slice(0, LIST_MAX).map(oneLine).filter(Boolean))] : []);

function optionOf(raw) {
  if (!isObj(raw)) return null;
  const value = oneLine(raw.value);
  const label = oneLine(raw.label);
  if (!value || value.length > VALUE_MAX || !label || label.length > LABEL_MAX) return null;
  const plain = oneLine(raw.plain);
  return { value, label, ...(plain && plain.length <= LABEL_MAX ? { plain } : {}) };
}

/** One raw entry → a decision without its id, or the reason it is dropped. */
function decisionOf(raw) {
  if (!isObj(raw)) return { error: 'must be an object' };
  const text = oneLine(raw.text);
  if (!text || text.length > TEXT_MAX) return { error: `text must be 1–${TEXT_MAX} characters` };
  const options = Array.isArray(raw.options) ? raw.options.slice(0, OPTIONS_MAX + 1).map(optionOf) : [];
  if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX || options.some((o) => !o)
    || new Set(options.map((o) => o.value)).size !== options.length) {
    return { error: `${OPTIONS_MIN}–${OPTIONS_MAX} options with distinct values` };
  }
  const recommended = oneLine(raw.recommended);
  if (!options.some((o) => o.value === recommended)) return { error: 'recommended must name an option' };
  const plain = oneLine(raw.plain);
  const criteria = strings(raw.criteria);
  const from = strings(raw.from);
  return { decision: {
    text, ...(plain && plain.length <= TEXT_MAX ? { plain } : {}), options, recommended,
    ...(criteria.length ? { criteria } : {}), ...(from.length ? { from } : {}),
  } };
}

/** A sink's decisions file `{ decisions: [...] }` → { decisions, errors }. Kept entries are re-numbered d-1…d-N in
 *  order, at most 8; each dropped entry gives one error line. */
export function normalizeDecisions(raw) {
  if (!isObj(raw)) return { decisions: [], errors: ['decisions must be an object'] };
  const list = Array.isArray(raw.decisions) ? raw.decisions : [];
  const decisions = [];
  const errors = [];
  list.forEach((entry, i) => {
    if (decisions.length >= DECISIONS_MAX) return;
    const { decision, error } = decisionOf(entry);
    if (error) errors.push(`decisions[${i}]: ${error}`);
    else decisions.push({ id: `d-${decisions.length + 1}`, ...decision });
  });
  if (decisions.length >= DECISIONS_MAX && list.length > DECISIONS_MAX) errors.push(`decisions: only the first ${DECISIONS_MAX} are kept`);
  return { decisions, errors };
}

const slug = (s) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, VALUE_MAX) || 'option';

/** Role conflicts (findings.mjs normalizeConflicts) as decisions, numbered after `after` existing ones within the cap.
 *  Option i is roles[i]'s side; when one side is the lead's role, that option is recommended (the lead's final say),
 *  else the first. */
export function conflictDecisions(conflicts, { lead = null, after = 0 } = {}) {
  const out = [];
  for (const c of Array.isArray(conflicts) ? conflicts : []) {
    if (after + out.length >= DECISIONS_MAX) break;
    const labels = (Array.isArray(c?.options) ? c.options : []).map(oneLine).filter(Boolean).slice(0, OPTIONS_MAX);
    if (labels.length < OPTIONS_MIN || !oneLine(c?.question)) continue;
    const used = new Set();
    const options = labels.map((label) => {
      let value = slug(label);
      for (let n = 2; used.has(value); n += 1) value = `${slug(label).slice(0, VALUE_MAX - 3)}-${n}`;
      used.add(value);
      return { value, label };
    });
    const roles = Array.isArray(c.roles) ? c.roles.map(String) : [];
    const side = lead ? roles.indexOf(lead) : -1;
    out.push({
      id: `d-${after + out.length + 1}`, text: oneLine(c.question), options,
      recommended: options[side >= 0 && side < options.length ? side : 0].value, ...(roles.length ? { from: roles } : {}),
    });
  }
  return out;
}

/** The person's picks `{ [id]: value }` against the decisions → { ok, picks } with every decision answered (a missing
 *  pick takes `recommended`), or { ok: false, errors } naming the first bad pick. Unknown ids are ignored. */
export function validateDecisionPicks(rawPicks, decisions) {
  if (rawPicks !== undefined && rawPicks !== null && !isObj(rawPicks)) {
    return { ok: false, errors: [{ path: 'decisions', code: 'invalid', message: 'decisions must be an object of picks' }] };
  }
  const picks = {};
  for (const d of Array.isArray(decisions) ? decisions : []) {
    const raw = rawPicks && Object.hasOwn(rawPicks, d.id) ? rawPicks[d.id] : undefined;
    if (raw === undefined) { picks[d.id] = d.recommended; continue; }
    if (typeof raw !== 'string' || !d.options.some((o) => o.value === raw)) {
      return { ok: false, errors: [{ path: `decisions.${d.id}`, code: 'invalid', message: `pick one of: ${d.options.map((o) => o.value).join(', ')}` }] };
    }
    picks[d.id] = raw;
  }
  return { ok: true, picks };
}

/** One Clarifications (Q&A) line per decision, naming the picked option, for withClarifications. */
export function decisionClarifications(decisions, picks) {
  return (Array.isArray(decisions) ? decisions : []).map((d) => {
    const value = picks?.[d.id] ?? d.recommended;
    const option = d.options.find((o) => o.value === value) || d.options.find((o) => o.value === d.recommended);
    return `- **${d.id}** — ${d.text} → **${option.label} (decided at approval)**`;
  });
}
