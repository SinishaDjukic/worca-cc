// src/shared/shape/feature-record.mjs — Shaper small runs A2: what a feature records about how carefully it is built
// (its Care position) and what kind each agreed requirement is (owned by a run, or confirmed by a role). The words, the
// write validators (they refuse, with a code) and the readers (they fall back, and never throw). Pure and browser-safe.
import { CRITERION_ID_RE } from '../review/coverage.mjs';
import { CHALLENGER_KEY } from './perspectives.mjs';

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

/** THE one mapping between the Shaper perspective keys and the CONFIRM_ROLES keys (small runs B3). */
export const ROLE_OF_PERSPECTIVE = Object.freeze({
  product: 'product', architect: 'engineering', ux: 'design', qa: 'qa', security: 'security', devops: 'devops', compliance: 'compliance',
});
const PERSPECTIVE_OF_ROLE = Object.freeze(Object.fromEntries(Object.entries(ROLE_OF_PERSPECTIVE).map(([p, r]) => [r, p])));
/** The CONFIRM_ROLES key of a perspective (`architect` is `engineering`); null for one with no role (`release`, `fit`). */
export const roleOfPerspective = (key) => (typeof key === 'string' && Object.hasOwn(ROLE_OF_PERSPECTIVE, key) ? ROLE_OF_PERSPECTIVE[key] : null);
/** The perspective key of a CONFIRM_ROLES key (`design` is `ux`); null for an unknown role. */
export const perspectiveOfRole = (role) => (typeof role === 'string' && Object.hasOwn(PERSPECTIVE_OF_ROLE, role) ? PERSPECTIVE_OF_ROLE[role] : null);

const ROLE_ECHO_MAX = 60;
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const refuse = (code, error) => ({ ok: false, code, error });
export const roleNames = () => `${CONFIRM_ROLES.slice(0, -1).map((r) => r.label).join(', ')} or ${CONFIRM_ROLES.at(-1).label}`;

/** A role's stored key (`'Compliance'` and `' compliance '` are `compliance`), or null when it is not one of the 7. */
export function roleKey(role) {
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

/** The kinds an approved outline's `confirmed` list asks for, as normalizeRequirementKinds takes them (it maps the role
 *  labels to keys and refuses a bad one); `{}` for any other shape. Never throws. */
export function confirmedKindsOf(outline) {
  const list = Array.isArray(outline?.confirmed) ? outline.confirmed : [];
  return Object.fromEntries(list.filter((c) => isObject(c) && typeof c.id === 'string' && c.id).map((c) => [c.id, { kind: 'confirmed', role: c.role }]));
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

// ---- Shaper small runs B2: the Start step's Care pick, its facts and the Care table ----

const fact = (key, label, words) => Object.freeze({ key, label, words: Object.freeze(words) });
/** What makes Worca pick Thorough: one hit of any word (whole word, any case). */
export const CARE_TRIGGERS = Object.freeze([
  fact('accounts', 'sign-in or accounts', ['sign-in', 'sign in', 'signin', 'login', 'log in', 'logout', 'account', 'accounts', 'password', 'passwords', 'auth', 'authentication', 'oauth', 'sso']),
  fact('personalData', 'personal data', ['personal data', 'pii', 'gdpr', 'privacy', 'user data', 'email address', 'email addresses', 'phone number', 'phone numbers']),
  fact('payments', 'payments', ['payment', 'payments', 'billing', 'invoice', 'invoices', 'checkout', 'refund', 'refunds', 'subscription', 'subscriptions', 'credit card']),
  fact('security', 'security or compliance requirements', ['security', 'compliance', 'soc 2', 'soc2', 'hipaa', 'iso 27001', 'encryption', 'encrypt', 'secret', 'secrets', 'vulnerability', 'audit log']),
  fact('migration', 'a data migration', ['migration', 'migrations', 'migrate', 'backfill', 'schema change']),
]);
/** The parts of a product a feature can touch; `screens` also means the feature has a screen. */
export const CARE_SUBSYSTEMS = Object.freeze([
  fact('screens', 'the screens', ['screen', 'screens', 'page', 'pages', 'ui', 'button', 'buttons', 'dialog', 'modal', 'form', 'layout', 'css', 'sidebar', 'menu']),
  fact('server', 'the server', ['server', 'api', 'endpoint', 'endpoints', 'route', 'routes', 'http', 'backend']),
  fact('store', 'the store', ['database', 'db', 'sqlite', 'table', 'tables', 'storage', 'column', 'columns', 'schema']),
  fact('engine', 'the engine', ['engine', 'orchestrator', 'pipeline', 'scheduler', 'workflow', 'workflows']),
  fact('cli', 'the CLI', ['cli', 'command line', 'command-line', 'terminal']),
]);
/** The requirement count each Shaper size stands for (the prototype's "Large · about 16 requirements"). */
export const CARE_SIZE_REQUIREMENTS = Object.freeze({ small: 3, medium: 8, large: 16 });

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsRe = (words) => new RegExp(`(?<![a-z0-9])(?:${words.map(escapeRe).join('|')})(?![a-z0-9])`, 'i');
const TRIGGER_RES = CARE_TRIGGERS.map((t) => [t.key, wordsRe(t.words)]);
const SUBSYSTEM_RES = CARE_SUBSYSTEMS.map((s) => [s.key, wordsRe(s.words)]);
const SIZES = Object.keys(CARE_SIZE_REQUIREMENTS);
const LEAN_MAX_REQUIREMENTS = 3;

/** The facts Worca's pick reads, from the planning run's prompt and its Shaper size. Never throws. */
export function careFactsOf({ prompt, size } = {}) {
  const text = typeof prompt === 'string' ? prompt : '';
  const known = SIZES.includes(size) ? size : null;
  const subsystems = SUBSYSTEM_RES.filter(([, re]) => re.test(text)).map(([k]) => k);
  return {
    touches: TRIGGER_RES.filter(([, re]) => re.test(text)).map(([k]) => k),
    requirements: known ? CARE_SIZE_REQUIREMENTS[known] : null,
    subsystems,
    screens: subsystems.includes('screens'),
    size: known,
  };
}

const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const labelsOf = (list, keys) => list.filter((x) => keys.includes(x.key)).map((x) => x.label);

/** Worca's Care pick and its reason: any trigger is Thorough; a small feature in at most one part with no screen is
 *  Lean (an unknown size never is); everything else is Balanced. */
export function worcaCarePick(facts) {
  const f = isObject(facts) ? facts : {};
  const touches = Array.isArray(f.touches) ? f.touches : [];
  const subsystems = Array.isArray(f.subsystems) ? f.subsystems : [];
  const req = Number.isInteger(f.requirements) ? f.requirements : null;
  const unknown = req === null ? ', and its size is not known' : '';
  if (touches.length) {
    return { position: 'thorough', reason: `Worca picks Thorough: it touches ${andList(labelsOf(CARE_TRIGGERS, touches))}${unknown}` };
  }
  if (req !== null && req <= LEAN_MAX_REQUIREMENTS && subsystems.length <= 1 && !f.screens) {
    const part = subsystems.length ? ` in one part (${labelsOf(CARE_SUBSYSTEMS, subsystems)[0]})` : ', nothing sensitive';
    return { position: 'lean', reason: `Worca picks Lean: about ${req} requirements${part}, no screen` };
  }
  const parts = subsystems.length ? andList(labelsOf(CARE_SUBSYSTEMS, subsystems)) : 'nothing sensitive';
  const more = req !== null && req > LEAN_MAX_REQUIREMENTS ? `, about ${req} requirements` : '';
  return { position: 'balanced', reason: `Worca picks Balanced: it touches ${parts}${more}${unknown}` };
}

const row = (key, label, text, rank) => Object.freeze({ key, label, text: Object.freeze(text), rank: Object.freeze(rank) });
const RANKED = { lean: 0, balanced: 1, thorough: 2 };
/** The build brief's Care table. A row's rank orders its positions; equal ranks give nothing up. The Models texts carry
 *  `{everyday}`, `{strong}` and `{second}`, filled from the install's model settings (never a model name here). */
export const CARE_TABLE = Object.freeze([
  row('requirements', 'Requirements', { lean: 'the asker role plus one challenge round', balanced: 'all picked roles add and challenge once', thorough: 'roles challenge until no objection, at most 3 rounds' }, RANKED),
  row('prototype', 'Prototype', { lean: 'only when asked for', balanced: 'when there are screen requirements', thorough: 'when there are screen requirements, reviewed by Design and Product' }, RANKED),
  row('runSize', 'Run size', { lean: 'up to 3 requirements', balanced: 'up to 3 requirements', thorough: 'up to 2 requirements' }, { lean: 0, balanced: 0, thorough: 1 }),
  row('build', 'Build approach', { lean: 'tests first, by the Implementer', balanced: 'tests first, by a separate Test writer', thorough: 'tests first, by a separate Test writer' }, { lean: 0, balanced: 1, thorough: 1 }),
  row('reviewers', 'Reviewers', { lean: 'Product and one more role', balanced: "the run's roles", thorough: "the run's roles, each on its own" }, RANKED),
  row('challenger', 'Challenger', { lean: 'off', balanced: 'at the split', thorough: 'at the split and on each plan' }, RANKED),
  row('models', 'Models', { lean: '{everyday} for every agent', balanced: '{strong} plans and reviews, {everyday} builds', thorough: '{strong} plans and reviews; Product reviews on {second}' }, RANKED),
  row('fixCycles', 'Fix cycles', { lean: '1', balanced: '2', thorough: '3' }, RANKED),
]);
const ROLE_WORDS = Object.freeze({ everyday: 'the everyday model', strong: 'the strong model', second: 'a second model' });

/** A table cell for `position`, with the model tokens filled (an unset name keeps its role words). */
export function careCell(rowKey, position, names = {}) {
  const r = CARE_TABLE.find((x) => x.key === rowKey);
  const n = isObject(names) ? names : {};
  const text = r && CARE_POSITIONS.includes(position) ? r.text[position] : '';
  return text.replace(/\{(everyday|strong|second)\}/g, (_, k) => (typeof n[k] === 'string' && n[k] ? n[k] : ROLE_WORDS[k]));
}

/** Feature C1 (D3): the Prototype step's offer for `position`, read from the `prototype` row's ranks: its lowest rank
 *  ("only when asked for") makes skipping Worca's pick, its highest ("reviewed by Design and Product") adds the review.
 *  An unknown position reads as the default. */
export function prototypeCare(position) {
  const r = CARE_TABLE.find((x) => x.key === 'prototype');
  const pos = CARE_POSITIONS.includes(position) ? position : CARE_DEFAULT.position;
  const ranks = Object.values(r.rank);
  return { primary: r.rank[pos] === Math.min(...ranks) ? 'skip' : 'build', review: r.rank[pos] === Math.max(...ranks) };
}

/** One line on what `position` does: the Requirements, Challenger and Fix cycles rows. */
export function careDescription(position, names = {}) {
  const req = careCell('requirements', position, names);
  const cycles = Number(careCell('fixCycles', position, names));
  return `${req.charAt(0).toUpperCase()}${req.slice(1)}; Challenger ${careCell('challenger', position, names)}; ${cycles} fix cycle${cycles === 1 ? '' : 's'}`;
}

/** What picking `picked` gives up against Worca's `pick`: one line per row where it ranks lower. */
export function careGivesUp(picked, pick, names = {}) {
  if (!CARE_POSITIONS.includes(picked) || !CARE_POSITIONS.includes(pick)) return [];
  return CARE_TABLE.filter((r) => r.rank[picked] < r.rank[pick])
    .map((r) => `${r.label}: ${careCell(r.key, picked, names)} instead of ${careCell(r.key, pick, names)}`);
}

const GIVES_UP_REVIEWERS = Object.freeze({ lean: 'Product and one more role review each run instead of every role', balanced: 'every role reviews together instead of each on its own' });
const GIVES_UP_CHALLENGER = Object.freeze({ lean: 'no Challenger', balanced: 'Challenger at the split only, not on each plan' });

/** The Gives up row's one sentence: what `picked` checks less than Worca's `pick`, from the Reviewers, Challenger and
 *  Fix cycles rows that rank lower (the full list is careGivesUp). '' at or above the pick. */
export function careGivesUpSentence(picked, pick) {
  if (!CARE_POSITIONS.includes(picked) || !CARE_POSITIONS.includes(pick)) return '';
  const lower = (key) => { const r = CARE_TABLE.find((x) => x.key === key); return r.rank[picked] < r.rank[pick]; };
  const parts = [];
  if (lower('reviewers')) parts.push(GIVES_UP_REVIEWERS[picked]);
  if (lower('challenger')) parts.push(GIVES_UP_CHALLENGER[picked]);
  if (lower('fixCycles')) {
    const a = Number(careCell('fixCycles', picked));
    parts.push(`${a} fix cycle${a === 1 ? '' : 's'} instead of ${careCell('fixCycles', pick)}`);
  }
  if (!parts.length) return '';
  const s = parts.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** The model-role fill a Care position asks of resolveGraph (`opts.roleFill.roles`): Lean runs every agent on the
 *  everyday role's model; Balanced and Thorough keep each node's own role. */
export function careModelRoles(position) {
  return position === 'lean' ? { deep: 'everyday', everyday: 'everyday', quick: 'quick' } : { deep: 'deep', everyday: 'everyday', quick: 'quick' };
}

/** Small runs C2 (D1): what a Care position asks of one slice run, read from CARE_TABLE's rows the way prototypeCare
 *  reads them. `testWriter`: the Build approach row above its lowest rank; `challenger` and `secondOpinion`: the
 *  Challenger and Models rows at their highest rank; `fixCycles`: the Fix cycles cell. The plan reviewers come from the
 *  run's own roles (`runRoles`, Product first): Lean takes Product plus the lead when it is one of them, else the first
 *  other role; Balanced takes them all; Thorough adds the Challenger. Never empty. An unknown position reads as the
 *  default. Pure; never throws. */
export function careRunPlan(position, opts = {}) {
  const { runRoles = ['product'], lead = null } = isObject(opts) ? opts : {};
  const pos = CARE_POSITIONS.includes(position) ? position : CARE_DEFAULT.position;
  const rankOf = (key) => {
    const r = CARE_TABLE.find((x) => x.key === key);
    const ranks = Object.values(r.rank);
    return { above: r.rank[pos] > Math.min(...ranks), top: r.rank[pos] === Math.max(...ranks) };
  };
  const challenger = rankOf('challenger').top;
  const roles = [...new Set(['product', ...(Array.isArray(runRoles) ? runRoles : []).filter((k) => typeof k === 'string' && k && k !== CHALLENGER_KEY)])];
  let planReviewers = roles;
  if (pos === 'lean') {
    const others = roles.filter((k) => k !== 'product');
    const second = others.includes(lead) ? lead : others[0];
    planReviewers = second ? ['product', second] : ['product'];
  }
  return {
    position: pos,
    testWriter: rankOf('build').above,
    planReviewers: challenger ? [...planReviewers, CHALLENGER_KEY] : planReviewers,
    challenger,
    secondOpinion: rankOf('models').top ? 'product' : null,
    fixCycles: Number(careCell('fixCycles', pos)),
    modelRoles: careModelRoles(pos),
  };
}

/** The Care choice in words: "Balanced · Worca's pick", or "Careful · your choice · Worca recommended Balanced". A
 *  person who kept Worca's pick reads as Worca's pick (the position is the recommendation, whoever chose it). */
export function careChoiceText(care) {
  const c = isObject(care) ? care : {};
  const label = CARE_LABELS[c.position] || CARE_LABELS[CARE_DEFAULT.position];
  if (c.chosenBy === 'person' && c.position !== c.worcaPick) return `${label} · your choice${CARE_LABELS[c.worcaPick] ? ` · Worca recommended ${CARE_LABELS[c.worcaPick]}` : ''}`;
  return `${label} · Worca's pick`;
}

/** The fixed fact a feature's Care reads as after Start. */
export function careRecordLine(care) {
  return `Care: ${careChoiceText(care)}`;
}

const REASON_MAX = 200;
const factsValid = (f) => isObject(f)
  && Array.isArray(f.touches) && f.touches.every((k) => CARE_TRIGGERS.some((t) => t.key === k))
  && (f.requirements === null || (Number.isInteger(f.requirements) && f.requirements >= 0))
  && Array.isArray(f.subsystems) && f.subsystems.every((k) => CARE_SUBSYSTEMS.some((s) => s.key === k))
  && typeof f.screens === 'boolean' && (f.size === null || SIZES.includes(f.size));

/** The Care a Start step saves on its planning run: normalizeCare's three fields plus the reason, the facts and when.
 *  @returns {{ok: true, care: object} | {ok: false, code: string, error: string}} */
export function normalizeStartCare(raw) {
  if (!isObject(raw)) return refuse('CARE_POSITION_UNKNOWN', 'Care must be Lean, Balanced or Thorough.');
  const base = normalizeCare(raw);
  if (!base.ok) return base;
  if (typeof raw.reason !== 'string' || raw.reason.length > REASON_MAX || !factsValid(raw.facts)
    || typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) {
    return refuse('CARE_FACTS_INVALID', "The Care record's reason, facts or time is not valid.");
  }
  const f = raw.facts;
  return { ok: true, care: { ...base.care, reason: raw.reason, facts: { touches: [...f.touches], requirements: f.requirements, subsystems: [...f.subsystems], screens: f.screens, size: f.size }, at: raw.at } };
}
