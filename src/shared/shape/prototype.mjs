// src/shared/shape/prototype.mjs — Shaper small runs C1, the Prototype step's pure rules: which requirements are screen
// requirements, the offer per Care position, the skip lines, the persisted record (`shape_stats.prototype`), the remark
// rules, the requirement rewrite and the prompt blocks. Pure and browser-safe: nothing from src/core or ui.
import { CARE_SUBSYSTEMS, careCell, prototypeCare } from './feature-record.mjs';
import { CRITERION_ID_RE, criteriaCheck, criterionIds, criterionMention } from '../review/coverage.mjs';

export const PROTOTYPE_STATES = Object.freeze(['offered', 'building', 'reviewing', 'built', 'matching', 'remark', 'failed', 'confirmed', 'skipped']);
/** R-ux-6: the one line a step that does not run shows, per cause. */
export const SKIP_LINES = Object.freeze({
  'no-screens': 'Prototype skipped · no screen requirements',
  lean: 'Prototype skipped · Lean builds it only when asked',
  'design-off': 'Prototype skipped · Design is turned off',
  person: 'Prototype skipped by you',
});
export const skipLine = (cause) => (typeof cause === 'string' && Object.hasOwn(SKIP_LINES, cause) ? SKIP_LINES[cause] : '');
/** A remark is 1 to REMARK_MAX characters; a proposed text and example 1 to PROPOSAL_MAX each (D10). */
export const REMARK_MAX = 1000;
export const PROPOSAL_MAX = 300;
const TEXT_MAX = 300;
const FINDINGS_MAX = 20;
const FINDING_ROLES = Object.freeze(['design', 'product']);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const nat = (v) => Number.isInteger(v) && v >= 0;
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const idList = (v) => Array.isArray(v) && v.every((id) => typeof id === 'string' && CRITERION_ID_RE.test(id));

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SCREEN_WORDS = CARE_SUBSYSTEMS.find((s) => s.key === 'screens').words;
const SCREEN_RE = new RegExp(`(?<![a-z0-9])(?:${SCREEN_WORDS.map(escapeRe).join('|')})(?![a-z0-9])`, 'i');
const UX_ID_RE = /^R-ux-[1-9]\d*$/;

/** D2: a screen requirement has the `ux` prefix (Design's), or its text names a screen (the Care screen words). */
export function isScreenRequirement(req) {
  if (!isObject(req)) return false;
  return (typeof req.id === 'string' && UX_ID_RE.test(req.id)) || SCREEN_RE.test(typeof req.text === 'string' ? req.text : '');
}

/** The screen requirements of an agreed list, `{id, text}` each, in order. */
export const screenRequirements = (agreed) => (Array.isArray(agreed) ? agreed : [])
  .filter(isScreenRequirement).map((r) => ({ id: r.id, text: typeof r.text === 'string' ? r.text : '' }));

/** D9: the most review rounds a Thorough prototype gets (Thorough's fix cycles). */
export const prototypeReviewRounds = () => Number(careCell('fixCycles', 'thorough'));

/** Step 1: the offer, or the cause it is skipped for (0 screen requirements first, then Design off). `screens` is a
 *  count or a list. `menu` is the other choice, the one the step's ⋯ holds. */
export function prototypeOffer({ position, screens, designOn } = {}) {
  const n = Array.isArray(screens) ? screens.length : Number(screens) || 0;
  if (n < 1) return { skip: 'no-screens' };
  if (designOn !== true) return { skip: 'design-off' };
  const c = prototypeCare(position);
  return { offer: { primary: c.primary, menu: c.primary === 'build' ? 'skip' : 'build', review: c.review } };
}

const finding = (f) => isObject(f) && FINDING_ROLES.includes(f.role) && text(f.text, TEXT_MAX) && typeof f.objection === 'boolean';
const screen = (s) => isObject(s) && typeof s.section === 'string' && s.section && typeof s.name === 'string' && idList(s.ids);
const proposal = (p) => isObject(p) && typeof p.text === 'string' && typeof p.example === 'string' && typeof p.was === 'string';
const remark = (r) => isObject(r) && text(r.text, REMARK_MAX) && (r.id === undefined || (typeof r.id === 'string' && CRITERION_ID_RE.test(r.id)))
  && (r.proposed === undefined || proposal(r.proposed));
const ref = (r) => isObject(r) && typeof r.dir === 'string' && r.dir && nat(r.version) && typeof r.designId === 'string' && r.designId
  && (r.digest === undefined || (typeof r.digest === 'string' && /^[0-9a-f]{64}$/.test(r.digest)));
const optString = (v) => v === undefined || (typeof v === 'string' && v.length > 0);

/** `shape_stats.prototype` as it is stored, or null when anything is malformed. Unknown keys are dropped. */
export function normalizePrototype(raw) {
  if (!isObject(raw) || raw.v !== 1 || !PROTOTYPE_STATES.includes(raw.state)) return null;
  if (raw.cause !== undefined && (raw.state !== 'skipped' || !Object.hasOwn(SKIP_LINES, raw.cause))) return null;
  if (!idList(raw.screenIds) || !optString(raw.designId) || !optString(raw.buildId) || !nat(raw.round)) return null;
  if (raw.version !== undefined && !nat(raw.version)) return null;
  if (!Array.isArray(raw.screens) || !raw.screens.every(screen)) return null;
  if (!Number.isFinite(raw.costUsd) || raw.costUsd < 0) return null;
  if (!Array.isArray(raw.findings) || raw.findings.length > FINDINGS_MAX || !raw.findings.every(finding)) return null;
  if (!nat(raw.reviewRounds) || !nat(raw.remarks) || typeof raw.rebuilt !== 'boolean') return null;
  if (raw.remark !== undefined && !remark(raw.remark)) return null;
  if (raw.ref !== undefined && !ref(raw.ref)) return null;
  if (typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))) return null;
  return {
    v: 1, state: raw.state, ...(raw.cause !== undefined ? { cause: raw.cause } : {}), screenIds: [...raw.screenIds],
    ...(raw.designId !== undefined ? { designId: raw.designId } : {}), ...(raw.buildId !== undefined ? { buildId: raw.buildId } : {}),
    round: raw.round, ...(raw.version !== undefined ? { version: raw.version } : {}),
    screens: raw.screens.map((s) => ({ section: s.section, name: s.name, ids: [...s.ids] })),
    costUsd: raw.costUsd, findings: raw.findings.map((f) => ({ role: f.role, text: f.text, objection: f.objection })),
    reviewRounds: raw.reviewRounds,
    ...(raw.remark !== undefined ? { remark: {
      text: raw.remark.text, ...(raw.remark.id !== undefined ? { id: raw.remark.id } : {}),
      ...(raw.remark.proposed ? { proposed: { text: raw.remark.proposed.text, example: raw.remark.proposed.example, was: raw.remark.proposed.was } } : {}),
    } } : {}),
    remarks: raw.remarks, rebuilt: raw.rebuilt,
    ...(raw.ref !== undefined ? { ref: { dir: raw.ref.dir, version: raw.ref.version, designId: raw.ref.designId, ...(raw.ref.digest ? { digest: raw.ref.digest } : {}) } } : {}),
    at: raw.at,
  };
}

const BRACKET_RE = /\[\s*(R-[a-z]{1,8}-[1-9]\d*(?:\s*,\s*R-[a-z]{1,8}-[1-9]\d*)*)\s*\]/;
const idsIn = (m) => m[1].split(',').map((s) => s.trim()).filter((id) => CRITERION_ID_RE.test(id));

/** One screen per plan section: its name and the requirement ids in brackets ("Template editor [R-ux-1, R-ux-2]"),
 *  read from the section's job, else from its brief (a Design job holds at most 24 characters). No brackets: no ids. */
export function screensOfPlan(sections) {
  const out = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!isObject(s) || typeof s.id !== 'string' || !s.id) continue;
    const job = typeof s.job === 'string' ? s.job : s.id;
    const inJob = BRACKET_RE.exec(job);
    const inBrief = inJob ? null : BRACKET_RE.exec(typeof s.brief === 'string' ? s.brief : '');
    out.push({ section: s.id, name: oneLine(job.replace(BRACKET_RE, '')) || s.id, ids: inJob ? idsIn(inJob) : inBrief ? idsIn(inBrief) : [] });
  }
  return out;
}

/** D10: the one agreed id a remark names, or null (none, or two or more). */
export function remarkTarget(remarkText, agreedIds) {
  const t = typeof remarkText === 'string' ? remarkText : '';
  const named = (Array.isArray(agreedIds) ? agreedIds : []).filter((id) => criterionMention(id).test(t));
  return named.length === 1 ? named[0] : null;
}

/** D10: the remark agent's proposal when it is usable: its id agreed, its text and example 1 to 300 characters. */
export function validRemarkProposal(raw, ids) {
  if (!isObject(raw) || typeof raw.id !== 'string' || !(Array.isArray(ids) && ids.includes(raw.id))) return null;
  const t = oneLine(raw.text);
  const ex = oneLine(raw.example);
  if (!t || !ex || t.length > PROPOSAL_MAX || ex.length > PROPOSAL_MAX) return null;
  return { id: raw.id, text: t, example: ex };
}

const FENCE_RE = /^\s*(```|~~~)/;
const EXAMPLE_LINE_RE = /^(\s+)Example:/;

/** D11: the requirements text with `id`'s item line and its `Example:` line replaced (the example line added under the
 *  item when it has none). null when the id is absent, the text or example is empty, or the result fails criteriaCheck. */
export function rewriteRequirement(markdown, id, { text: t, example } = {}) {
  const newText = oneLine(t);
  const newExample = oneLine(example);
  if (typeof markdown !== 'string' || typeof id !== 'string' || !CRITERION_ID_RE.test(id) || !newText || !newExample) return null;
  const itemRe = new RegExp(`^(\\s*-\\s+(?:\\*\\*${escapeRe(id)}\\*\\*|\\[[ xX]\\]\\s+${escapeRe(id)})(?![0-9])\\s*)(.*)$`);
  const lines = markdown.split('\n');
  let fenced = false;
  let at = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE_RE.test(lines[i])) { fenced = !fenced; continue; }
    if (!fenced && itemRe.test(lines[i])) { at = i; break; }
  }
  if (at < 0) return null;
  const m = itemRe.exec(lines[at]);
  lines[at] = `${m[1].endsWith(' ') ? m[1] : `${m[1]} `}${newText}`;
  const ex = EXAMPLE_LINE_RE.exec(lines[at + 1] ?? '');
  if (ex) lines[at + 1] = `${ex[1]}Example: ${newExample}`;
  else lines.splice(at + 1, 0, `  Example: ${newExample}`);
  const out = lines.join('\n');
  return criteriaCheck(out, { agreed: criterionIds(markdown), requireExamples: true }).ok ? out : null;
}

/** D8: a review round's file, findings by Design and Product only (at most 20); unreadable reads as none. */
export function normalizeReview(raw) {
  const list = isObject(raw) && Array.isArray(raw.findings) ? raw.findings : [];
  const out = [];
  for (const f of list) {
    if (out.length >= FINDINGS_MAX) break;
    if (!isObject(f) || !FINDING_ROLES.includes(f.role)) continue;
    const t = oneLine(f.text).slice(0, TEXT_MAX);
    if (!t) continue;
    out.push({ role: f.role, text: t, objection: f.objection === true,
      sections: (Array.isArray(f.sections) ? f.sections : []).filter((s) => typeof s === 'string' && s).slice(0, 12) });
  }
  return out;
}

/** D14: what every agent node of a run that owns a screen requirement reads. */
export function prototypeBlock({ dir, ids = [] } = {}) {
  return '## Confirmed prototype\n\n'
    + `The person confirmed a clickable prototype of this feature's screens. It is at: ${dir}\n`
    + `Open its index.html. This run's screen requirements: ${ids.join(', ') || 'none'}.\n`
    + 'Build the screens to match it. Where the prototype and a requirement differ, the requirement and its example win.\n\n';
}

const screenLines = (screens) => (Array.isArray(screens) ? screens : [])
  .map((s) => `- ${s.section}: ${s.name}${s.ids?.length ? ` [${s.ids.join(', ')}]` : ''}`).join('\n');

/** D8: one Thorough review round of the built prototype, by Design and Product. */
export function prototypeReviewBlock({ dir, requirements = null, screens = [], out, round = 1, prior = [] } = {}) {
  return '## Review the prototype\n\n'
    + `Design's agents built a clickable prototype of the feature's screens. Open it at: ${dir}\n`
    + (requirements ? `The agreed requirements are at: ${requirements}\n` : '')
    + `\nThis is review round ${round}. Do not change any file. Review it as Design and as Product, each on its own: does `
    + 'each screen do what its requirements and their examples say, and would a person understand it?\n'
    + `\nThe screens (section id: name [requirement ids]):\n${screenLines(screens)}\n`
    + (prior.length ? `\nThe last round objected to:\n${prior.map((p) => `- ${p.role}: ${p.text}`).join('\n')}\n` : '')
    + `\nWrite your findings as JSON to: ${out}\n`
    + '{"findings": [{"role": "design", "text": "…", "objection": true, "sections": ["section-id"]}]}\n'
    + 'Use the roles design and product. An objection must be fixed before the person sees the prototype; name the '
    + 'sections it is about. A role with nothing to say lists no findings.\n\n';
}

/** D10: matching a person's remark on the prototype to one agreed requirement. */
export function prototypeRemarkBlock({ remark: said, requirements = null, ids = [], target = null, out } = {}) {
  return '## Match a remark on the prototype\n\n'
    + `The person looked at the prototype and wrote this remark:\n> ${oneLine(said)}\n\n`
    + (requirements ? `The agreed requirements are at: ${requirements}\n` : '')
    + (target
      ? `The remark names ${target}. Propose that requirement's new text and its new example.\n`
      : `Pick the one requirement the remark changes, from: ${ids.join(', ')}. If it changes none, answer none.\n`)
    + 'Do not change any file except the output.\n'
    + `\nWrite your answer as JSON to: ${out}\n`
    + '{"id": "R-ux-2", "text": "the new requirement text", "example": "the new example"} or {"id": null}\n'
    + `The text and the example are one line of at most ${PROPOSAL_MAX} characters each.\n\n`;
}

/** Step 2: what the card reads of a record (no file paths): the state, the skip cause and its line, the screens, the
 *  cost, the findings, the remark, and the design, build and version the live view follows. null for no record. */
export function prototypeView(rec) {
  const p = normalizePrototype(rec);
  if (!p) return null;
  return {
    state: p.state, ...(p.cause ? { cause: p.cause, line: skipLine(p.cause) } : {}),
    screens: p.screens, screenIds: p.screenIds, costUsd: p.costUsd, findings: p.findings, reviewRounds: p.reviewRounds, remarks: p.remarks,
    rebuilt: p.rebuilt, ...(p.remark ? { remark: p.remark } : {}), ...(p.version !== undefined ? { version: p.version } : {}),
    ...(p.designId ? { designId: p.designId } : {}), ...(p.buildId ? { buildId: p.buildId } : {}),
  };
}

/** D19: Worca's pick for an unattended `prototype` ask (`--yes`, Away mode), from the ask's `prototype` body: the offer's
 *  primary, Confirm when built, Keep on a remark, Build again after the first failure and Skip after the second. */
export function autoPrototypeAnswer(view) {
  const v = isObject(view) ? view : {};
  if (v.moment === 'offered') return { decision: v.offer?.primary === 'skip' ? 'skip' : 'build' };
  if (v.moment === 'built') return { decision: 'confirm' };
  if (v.moment === 'remark') return { decision: 'keep' };
  if (v.moment === 'failed') return { decision: (Number(v.attempt) || 0) >= 2 ? 'skip' : 'build' };
  return null;
}

/** D17: at most this many pieces per screen column of the preview well. */
export const PIECES_MAX = 8;
const PIECE_RE = /<(h[1-6]|p|button|a|label|li|th|td|legend|option|figcaption|summary|input|textarea|select|img)\b([^>]*)>([^<]*)/gi;
const ATTR_RE = (name) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
const attr = (attrs, name) => { const m = ATTR_RE(name).exec(attrs); return m ? (m[2] ?? m[3] ?? '') : ''; };
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** D17: a screen's labelled pieces, read from its HTML text as plain words (never markup): each heading, paragraph,
 *  button, link, label, list item, cell, field or image with its text (a field's placeholder or label, an image's alt),
 *  in order, at most PIECES_MAX. A script or style body is never read. */
export function piecesOf(html) {
  const text = String(html ?? '').replace(/<(script|style)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
  const out = [];
  for (const m of text.matchAll(PIECE_RE)) {
    if (out.length >= PIECES_MAX) break;
    const tag = m[1].toLowerCase();
    const inner = m[3].replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENTITIES[e]).replace(/\s+/g, ' ').trim();
    const label = inner || attr(m[2], 'placeholder') || attr(m[2], 'aria-label') || attr(m[2], 'alt') || attr(m[2], 'value');
    if (label) out.push({ tag, text: label.slice(0, 80) });
  }
  return out;
}
