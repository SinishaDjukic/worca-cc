// src/shared/shape/perspectives.mjs
// The ONE list of Shape it first perspectives and the plan sections they own (spec D4). Browser-safe: no imports.

/** Sections in their §3.1 order. `always` sections appear whatever perspectives are picked. */
export const SECTIONS = Object.freeze([
  Object.freeze({ key: 'problem', title: 'Problem and goal', always: true }),
  Object.freeze({ key: 'decisions', title: 'Decisions' }),
  Object.freeze({ key: 'screens', title: 'Screens and states' }),
  Object.freeze({ key: 'layout', title: 'Code layout' }),
  Object.freeze({ key: 'fit', title: 'Fit' }),                           // Project fit: reused vs new, each with a reason
  Object.freeze({ key: 'threats', title: 'Threats' }),
  Object.freeze({ key: 'infra', title: 'Infrastructure and CI/CD' }),
  Object.freeze({ key: 'testing', title: 'Testing', always: true }),      // QA writes it in full; else a short default
  Object.freeze({ key: 'rollout', title: 'Rollout and rollback' }),
  Object.freeze({ key: 'outOfScope', title: 'Out of scope', always: true }),
  Object.freeze({ key: 'openQuestions', title: 'Open questions', always: true }),
]);

/** The Project fit perspective (slice 3): its reviewer is the only agent that reads the house brief. */
export const FIT_KEY = 'fit';
/** R-fit-1..5, in this order: the Planner writes exactly these items, the fit reviewer judges them. */
export const FIT_RULES = Object.freeze([
  'No second component where one exists: every part the plan adds reuses the component the house brief lists for it.',
  'No new engine state unless an open spec names it.',
  'Wording matches the existing surfaces (labels, statuses, button text).',
  'No known bug from the house brief is repeated.',
  'No conflict with an open spec in plans/.',
]);

const perspective = (p) => Object.freeze({ ...p, sections: Object.freeze([...p.sections]), effect: Object.freeze({ stages: [], signals: [], ...p.effect }) });

/** `effect.stages` = workflow stages the perspective adds; `effect.signals` = classifier signals it adds (D5). */
export const PERSPECTIVES = Object.freeze([
  perspective({ key: 'product', label: 'Product', icon: 'P', locked: true, help: 'Problem, goal, users, success criteria, out of scope.', sections: ['problem', 'outOfScope'], effect: {} }),
  perspective({ key: 'architect', label: 'Architect', icon: 'A', help: 'Decisions table, code layout with real paths, data and API changes.', checklist: 'arch', checklistHint: 'decisions kept', sections: ['decisions', 'layout'], effect: {} }),
  perspective({ key: 'qa', label: 'QA', icon: 'Q', help: 'Acceptance criteria as testable checks, a test plan with file names.', checklist: 'qa', checklistHint: 'behaviours, each one testable', sections: ['testing'], effect: {} }),
  perspective({ key: 'ux', label: 'UX', icon: 'U', help: 'Screens, states (empty, loading, error), levels, accessibility.', checklist: 'ux', checklistHint: 'states shown', sections: ['screens'], effect: { stages: ['manualTestsChecklist', 'manualWebUiTesting'] } }),
  perspective({ key: 'security', label: 'Security', icon: 'S', help: 'Trust boundaries, inputs, secrets, permissions, abuse cases.', checklist: 'sec', checklistHint: 'threats handled', sections: ['threats'], effect: { signals: ['risky'] } }),
  perspective({ key: 'devops', label: 'DevOps and infrastructure', icon: 'D', help: 'Environments, CI/CD changes, infrastructure as code, monitoring and alerts. Adds no stage.', checklist: 'ops', checklistHint: 'CI and infra changes', sections: ['infra'], effect: {} }),
  perspective({ key: 'release', label: 'Release', icon: 'R', help: 'Migration, feature flag, rollout, rollback.', checklist: 'rel', checklistHint: 'flag wired, rollback works', sections: ['rollout'], effect: {} }),
  perspective({ key: FIT_KEY, label: 'Project fit', icon: 'F', help: 'What the plan reuses and what it adds, each with a reason, checked against the house brief.', checklist: 'fit', checklistHint: 'fits the house brief', sections: ['fit'], rules: FIT_RULES, effect: {} }),
]);

export const PERSPECTIVE_KEYS = Object.freeze(PERSPECTIVES.map((p) => p.key));
const BY_KEY = new Map(PERSPECTIVES.map((p) => [p.key, p]));
export const perspectiveByKey = (key) => BY_KEY.get(key) || null;

/** The sections a plan with these perspectives carries, in §3.1 order, numbered from 1. Product is always on. */
export function sectionsFor(perspectives) {
  const picked = new Set(['product', ...(Array.isArray(perspectives) ? perspectives : [])]);
  const want = new Set(SECTIONS.filter((s) => s.always).map((s) => s.key));
  for (const k of picked) for (const s of perspectiveByKey(k)?.sections || []) want.add(s);
  return SECTIONS.filter((s) => want.has(s.key)).map((s, i) => ({ key: s.key, title: s.title, n: i + 1 }));
}

const HEADING_RE = /^##[ \t]+(?:\d+\.[ \t]*)?(.+?)[ \t]*$/gm;

/** Titles of the sections `perspectives` need that `markdown` has no `## [n.] Title` heading for. */
export function missingSections(markdown, perspectives) {
  const have = new Set();
  for (const m of String(markdown || '').matchAll(HEADING_RE)) have.add(m[1].toLowerCase());
  return sectionsFor(perspectives).filter((s) => !have.has(s.title.toLowerCase())).map((s) => s.title);
}

const SECTION_BY_TITLE = new Map(SECTIONS.map((s) => [s.title.toLowerCase(), s.key]));
const H2_LINE_RE = /^##[ \t]+(?:\d+\.[ \t]*)?(.+?)[ \t]*$/;

/** The Markdown with every line inside a ``` / ~~~ fence blanked (line count kept), so headings, tables
 *  and paths quoted in code never count as the plan's own. */
export function blankFences(md) {
  let fence = null;
  return String(md || '').split('\n').map((line) => {
    const m = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return '';
    }
    if (m) { fence = m[1]; return ''; }
    return line;
  }).join('\n');
}

/** The body split at its `## [n.] Title` headings. `key` is the SECTIONS key (null for an unknown title and for
 *  the preamble before the first heading); `text` excludes the heading line; `start` is its 0-based line. */
export function splitSections(body) {
  const out = [];
  let cur = { key: null, title: '', start: 0, lines: [] };
  blankFences(body).split('\n').forEach((line, i) => {
    const m = H2_LINE_RE.exec(line);
    if (!m) { cur.lines.push(line); return; }
    out.push(cur);
    cur = { key: SECTION_BY_TITLE.get(m[1].toLowerCase()) || null, title: m[1], start: i, lines: [] };
  });
  out.push(cur);
  return out.map((s) => ({ key: s.key, title: s.title, start: s.start, text: s.lines.join('\n') }));
}

/** The picked perspectives that own section `key` — the perspective tag on a `##` heading (V10). Product owns the
 *  always-on Problem and Out of scope; Testing belongs to QA only when QA is picked. */
export function ownersOf(key, perspectives) {
  const picked = new Set(['product', ...(Array.isArray(perspectives) ? perspectives : [])]);
  return PERSPECTIVES.filter((p) => picked.has(p.key) && p.sections.includes(key)).map((p) => p.key);
}

/** Picked when a shaped run names none (spec D4 fallback: Architect and QA; Product is always on). */
export const DEFAULT_PERSPECTIVES = Object.freeze(['product', 'architect', 'qa']);

/** The proposal's perspectives (slice 3): Project fit ticked when the project has a house brief, dropped without one
 *  (no chip, no error). Keys stay in PERSPECTIVES order. */
export function withProjectFit(perspectives, hasBrief) {
  const keys = new Set((Array.isArray(perspectives) ? perspectives : []).filter((k) => k !== FIT_KEY));
  return PERSPECTIVE_KEYS.filter((k) => (k === FIT_KEY ? hasBrief === true : keys.has(k)));
}

/** The chips a card does not offer: Project fit only where the proposal or the run already has it. */
export const chipsHiddenFor = (picked) => ((Array.isArray(picked) && picked.includes(FIT_KEY)) ? [] : [FIT_KEY]);

const SECTION_TITLE = new Map(SECTIONS.map((s) => [s.key, s.title]));

/**
 * Validate a request's perspective keys (POST /api/run `shape.perspectives`).
 * @returns {{ok:true, perspectives:string[]}|{ok:false, error:string}} keys in PERSPECTIVES order, Product first,
 *   duplicates collapsed
 */
export function normalizePerspectives(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: 'shape.perspectives must be an array of perspective keys' };
  const unknown = raw.filter((k) => typeof k !== 'string' || !BY_KEY.has(k));
  if (unknown.length) {
    return { ok: false, error: `unknown perspective(s): ${unknown.map(String).join(', ')} — known: ${PERSPECTIVE_KEYS.join(', ')}` };
  }
  const picked = new Set(['product', ...raw]);
  return { ok: true, perspectives: PERSPECTIVE_KEYS.filter((k) => picked.has(k)) };
}

/**
 * The Perspectives block of the Planner/Refine prompt (spec D5). '' for an invalid list, so a malformed
 * resume point can never break a prompt. Every rule here is one the shape check (shape.mjs) enforces.
 * @param {string[]} perspectives
 * @param {{refiner?:boolean}} [opts]
 */
export function perspectivesBlock(perspectives, { refiner = false } = {}) {
  const n = normalizePerspectives(perspectives);
  if (!n.ok) return '';
  const picked = n.perspectives;
  const label = (k) => perspectiveByKey(k).label;
  const sections = sectionsFor(picked).map((s) => {
    const owners = ownersOf(s.key, picked).map(label);
    return `${s.n}. ${s.title}${owners.length ? ` (${owners.join(', ')})` : ''}`;
  });
  const lists = picked.map(perspectiveByKey).filter((p) => p.checklist).map((p) =>
    `- ${p.label}: \`R-${p.checklist}-1\`, \`R-${p.checklist}-2\`, … (${p.checklistHint}), at the end of ` +
    p.sections.map((k) => `"${SECTION_TITLE.get(k)}"`).join(' or ') +
    (p.rules
      ? `. Write exactly these ${p.rules.length} items, in this order:\n` +
        p.rules.map((r, i) => `  - \`R-${p.checklist}-${i + 1}\` ${r}`).join('\n')
      : ''));
  const hasDecisions = sectionsFor(picked).some((s) => s.key === 'decisions');
  return '## Perspectives\n\n' +
    `This plan is written for these perspectives: ${picked.map(label).join(', ')}. A deterministic shape check ` +
    'reads the plan before a person approves it, so follow these rules exactly.\n\n' +
    'Use these `##` headings with exactly these titles, in this order (a number prefix such as `## 2. Decisions` ' +
    'is fine). Add other `##` sections between them where the plan needs them (for example the step-by-step ' +
    'implementation), and keep "## Clarifications (Q&A)" last:\n\n' +
    sections.join('\n') + '\n\n' +
    (lists.length
      ? 'End each perspective\'s own section with a `### Checklist` heading and 1–8 items, each ' +
        '`- [ ] R-<prefix>-<n> <one verifiable statement>`, numbered from 1 per prefix:\n\n' + lists.join('\n') +
        '\n\nProduct needs no checklist.\n\n'
      : '') +
    'Also:\n' +
    '- Every list item under "Problem and goal" and "Testing" states a measurable condition (a number, a named ' +
    'value, or a verb such as returns, shows, rejects, lists).\n' +
    (hasDecisions
      ? '- "Decisions" is a Markdown table with a "Decision" column, one row per decision, each stating one choice ' +
        '(never "TBD", "maybe" or "consider"); each row cites a backticked repo path or says (new).\n'
      : '') +
    (picked.includes(FIT_KEY)
      ? '- "Fit" has two lists, "Reused" and "New": each item names a backticked repo path and one reason.\n'
      : '') +
    '- Cite repo paths in backticks (`src/…`, `ui/…`, `test/…`, `docs/…`, optionally with `:line`); write (new) on ' +
    'the same line for a path that does not exist yet.\n' +
    '- "Testing" names the test files (`test/…`); each new code file in "Code layout" has a test whose file name ' +
    'contains that file\'s name.\n' +
    '- No TODO, TBD or `<…>` placeholders outside code and outside "Open questions".\n' +
    (refiner
      ? '\nAs the refiner, check the plan against these rules too. Fix every broken rule in your refined plan and ' +
        'report it as a minor issue: the person sees the shape check on the plan before approving it.\n'
      : '') +
    '\n';
}
