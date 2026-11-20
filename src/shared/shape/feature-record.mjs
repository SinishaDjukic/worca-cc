// src/shared/shape/feature-record.mjs — Shaper small runs A2: what a feature records about how carefully it is built
// (its Care position) and what kind each agreed requirement is (owned by a run, or confirmed by a role). The words, the
// write validators (they refuse, with a code) and the readers (they fall back, and never throw). Pure and browser-safe.
import { CRITERION_ID_RE } from '../review/coverage.mjs';

export const CARE_POSITIONS = Object.freeze(['lean', 'balanced', 'thorough']);
export const CARE_LABELS = Object.freeze({ lean: 'Lean', balanced: 'Balanced', thorough: 'Thorough' });
export const CARE_CHOSEN_BY = Object.freeze(['default', 'person']);
export const CARE_DEFAULT = Object.freeze({ position: 'balanced', chosenBy: 'default', worcaPick: null });

/** The 7 roles that can confirm a requirement. Their own list: not the Shaper perspectives, and never part of an R-id. */
export const CONFIRM_ROLES = Object.freeze([
  { key: 'product', label: 'Product' }, { key: 'engineering', label: 'Engineering' }, { key: 'design', label: 'Design' },
  { key: 'devops', label: 'DevOps' }, { key: 'security', label: 'Security' }, { key: 'compliance', label: 'Compliance' },
  { key: 'qa', label: 'QA' },
].map((r) => Object.freeze(r)));
export const REQUIREMENT_KINDS = Object.freeze(['owned', 'confirmed']);

const ROLE_ECHO_MAX = 60;
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const refuse = (code, error) => ({ ok: false, code, error });
const roleNames = () => `${CONFIRM_ROLES.slice(0, -1).map((r) => r.label).join(', ')} or ${CONFIRM_ROLES.at(-1).label}`;

/** A role's stored key (`'Compliance'` and `' compliance '` are `compliance`), or null when it is not one of the 7. */
function roleKey(role) {
  const k = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return CONFIRM_ROLES.some((r) => r.key === k) ? k : null;
}

/** A feature's Care choice as it is stored. Nothing passed is the default.
 *  @returns {{ok: true, care: {position, chosenBy, worcaPick}} | {ok: false, code: string, error: string}} */
export function normalizeCare(raw) {
  if (raw === null || raw === undefined) return { ok: true, care: CARE_DEFAULT };
  if (!isObject(raw) || !CARE_POSITIONS.includes(raw.position)) return refuse('CARE_POSITION_UNKNOWN', 'Care must be Lean, Balanced or Thorough.');
  const chosenBy = raw.chosenBy ?? CARE_DEFAULT.chosenBy;
  if (!CARE_CHOSEN_BY.includes(chosenBy)) return refuse('CARE_CHOSEN_BY_UNKNOWN', 'Care is chosen by default or by a person.');
  const worcaPick = raw.worcaPick ?? null;
  if (worcaPick !== null && !CARE_POSITIONS.includes(worcaPick)) return refuse('CARE_PICK_UNKNOWN', "Worca's pick must be Lean, Balanced, Thorough or none.");
  return { ok: true, care: { position: raw.position, chosenBy, worcaPick } };
}

/** The kind of every agreed requirement as it is stored: one entry per id of `agreedIds`, in that order. An id `raw`
 *  does not name is owned. The first refusal wins.
 *  @returns {{ok: true, kinds: Record<string, {kind: 'owned'} | {kind: 'confirmed', role: string}>} | {ok: false, code: string, error: string}} */
export function normalizeRequirementKinds(raw, agreedIds) {
  const ids = Array.isArray(agreedIds) ? agreedIds : [];
  const given = raw ?? {};
  if (!isObject(given)) return refuse('REQUIREMENT_KIND_UNKNOWN', 'A requirement is owned by a run or confirmed by a person.');
  const named = {};
  for (const [id, entry] of Object.entries(given)) {
    if (!CRITERION_ID_RE.test(id) || !ids.includes(id)) return refuse('REQUIREMENT_UNKNOWN', `${id} is not an agreed requirement of this feature.`);
    if (!isObject(entry) || !REQUIREMENT_KINDS.includes(entry.kind)) {
      return refuse('REQUIREMENT_KIND_UNKNOWN', `${id}: a requirement is owned by a run or confirmed by a person.`);
    }
    if (entry.kind === 'owned') { named[id] = { kind: 'owned' }; continue; }
    const role = roleKey(entry.role);
    if (!role) {
      const said = typeof entry.role === 'string' ? entry.role.trim().slice(0, ROLE_ECHO_MAX) : '';
      return refuse('REQUIREMENT_ROLE_NOT_ALLOWED', `${id}: "${said}" cannot confirm a requirement. Pick ${roleNames()}.`);
    }
    named[id] = { kind: 'confirmed', role };
  }
  return { ok: true, kinds: Object.fromEntries(ids.map((id) => [id, named[id] || { kind: 'owned' }])) };
}

/** A `shape_features` row's Care values; an unknown or missing value reads as the default. Never throws. */
export function careOfRow(row) {
  const r = isObject(row) ? row : {};
  return {
    position: CARE_POSITIONS.includes(r.care) ? r.care : CARE_DEFAULT.position,
    chosenBy: CARE_CHOSEN_BY.includes(r.care_chosen_by) ? r.care_chosen_by : CARE_DEFAULT.chosenBy,
    worcaPick: CARE_POSITIONS.includes(r.care_worca_pick) ? r.care_worca_pick : CARE_DEFAULT.worcaPick,
  };
}

/** One entry per agreed requirement of `outline`, in order: `{id, kind: 'owned', run}` (the first run that lists the
 *  id, 1-based; null when no run does) or `{id, kind: 'confirmed', role}`. `stored` is the parsed `requirement_kinds`
 *  value; an entry that is not a valid confirmed one reads as owned. Never throws. */
export function requirementKindsOf(stored, outline) {
  const agreed = Array.isArray(outline?.agreed) ? outline.agreed : [];
  const slices = Array.isArray(outline?.slices) ? outline.slices : [];
  const kinds = isObject(stored) ? stored : {};
  const out = [];
  for (const a of agreed) {
    const id = typeof a?.id === 'string' ? a.id : '';
    if (!id) continue;
    const entry = Object.hasOwn(kinds, id) ? kinds[id] : null;
    const role = isObject(entry) && entry.kind === 'confirmed' ? roleKey(entry.role) : null;
    if (role) { out.push({ id, kind: 'confirmed', role }); continue; }
    const at = slices.findIndex((s) => Array.isArray(s?.requirements) && s.requirements.includes(id));
    out.push({ id, kind: 'owned', run: at < 0 ? null : at + 1 });
  }
  return out;
}
