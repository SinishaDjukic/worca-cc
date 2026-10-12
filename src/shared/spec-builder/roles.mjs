// src/shared/spec-builder/roles.mjs
// The ONE list of Spec Builder roles and the spec sections they write (plans/spec-builder — §3.1, §3.2).
// Read by the wizard, the Ask prompt, the propose_spec validator, the estimator and the Auto guard:
// adding a role is one entry here. Browser-safe: no imports.

/** Sections in their §3.1 order. `always` sections appear whatever roles are picked. */
export const SECTIONS = Object.freeze([
  Object.freeze({ key: 'problem', title: 'Problem and goal', always: true }),
  Object.freeze({ key: 'decisions', title: 'Decisions' }),
  Object.freeze({ key: 'screens', title: 'Screens and states' }),
  Object.freeze({ key: 'layout', title: 'Code layout' }),
  Object.freeze({ key: 'threats', title: 'Threats' }),
  Object.freeze({ key: 'infra', title: 'Infrastructure and CI/CD' }),
  Object.freeze({ key: 'testing', title: 'Testing', always: true }),      // QA writes it in full; else a short default
  Object.freeze({ key: 'rollout', title: 'Rollout and rollback' }),
  Object.freeze({ key: 'outOfScope', title: 'Out of scope', always: true }),
  Object.freeze({ key: 'openQuestions', title: 'Open questions', always: true }),
]);

const role = (r) => Object.freeze({ ...r, sections: Object.freeze([...r.sections]), effect: Object.freeze({ stages: [], signals: [], ...r.effect }) });

/** `effect.stages` = workflow stages the role adds; `effect.signals` = classifier signals it adds (D5). */
export const ROLES = Object.freeze([
  role({ key: 'product', label: 'Product', icon: 'P', locked: true, help: 'Problem, goal, users, success criteria, out of scope.', sections: ['problem', 'outOfScope'], effect: {} }),
  role({ key: 'architect', label: 'Architect', icon: 'A', help: 'Decisions table, code layout with real paths, data and API changes.', checklist: 'arch', checklistHint: 'decisions kept', sections: ['decisions', 'layout'], effect: {} }),
  role({ key: 'qa', label: 'QA', icon: 'Q', help: 'Acceptance criteria as testable checks, a test plan with file names.', checklist: 'qa', checklistHint: 'behaviours, each one testable', sections: ['testing'], effect: {} }),
  role({ key: 'ux', label: 'UX', icon: 'U', help: 'Screens, states (empty, loading, error), levels, accessibility.', checklist: 'ux', checklistHint: 'states shown', sections: ['screens'], effect: { stages: ['manualTestsChecklist', 'manualWebUiTesting'] } }),
  role({ key: 'security', label: 'Security', icon: 'S', help: 'Trust boundaries, inputs, secrets, permissions, abuse cases.', checklist: 'sec', checklistHint: 'threats handled', sections: ['threats'], effect: { signals: ['risky'] } }),
  role({ key: 'devops', label: 'DevOps and infrastructure', icon: 'D', help: 'Environments, CI/CD changes, infrastructure as code, monitoring and alerts. Adds no stage.', checklist: 'ops', checklistHint: 'CI and infra changes', sections: ['infra'], effect: {} }),
  role({ key: 'release', label: 'Release', icon: 'R', help: 'Migration, feature flag, rollout, rollback.', checklist: 'rel', checklistHint: 'flag wired, rollback works', sections: ['rollout'], effect: {} }),
]);

export const ROLE_KEYS = Object.freeze(ROLES.map((r) => r.key));
const BY_KEY = new Map(ROLES.map((r) => [r.key, r]));
export const roleByKey = (key) => BY_KEY.get(key) || null;

/** The sections a spec with these roles carries, in §3.1 order, numbered from 1. Product is always on. */
export function sectionsFor(roles) {
  const picked = new Set(['product', ...(Array.isArray(roles) ? roles : [])]);
  const want = new Set(SECTIONS.filter((s) => s.always).map((s) => s.key));
  for (const k of picked) for (const s of roleByKey(k)?.sections || []) want.add(s);
  return SECTIONS.filter((s) => want.has(s.key)).map((s, i) => ({ key: s.key, title: s.title, n: i + 1 }));
}

const HEADING_RE = /^##[ \t]+(?:\d+\.[ \t]*)?(.+?)[ \t]*$/gm;

/** Titles of the sections `roles` need that `markdown` has no `## [n.] Title` heading for. */
export function missingSections(markdown, roles) {
  const have = new Set();
  for (const m of String(markdown || '').matchAll(HEADING_RE)) have.add(m[1].toLowerCase());
  return sectionsFor(roles).filter((s) => !have.has(s.title.toLowerCase())).map((s) => s.title);
}

const SECTION_BY_TITLE = new Map(SECTIONS.map((s) => [s.title.toLowerCase(), s.key]));
const H2_LINE_RE = /^##[ \t]+(?:\d+\.[ \t]*)?(.+?)[ \t]*$/;

/** The Markdown with every line inside a ``` / ~~~ fence blanked (line count kept), so headings, tables
 *  and paths quoted in code never count as the spec's own. */
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

/** The picked roles that own section `key` — the role tag on a `##` heading (V10). Product owns the
 *  always-on Problem and Out of scope; Testing belongs to QA only when QA is picked. */
export function ownersOf(key, roles) {
  const picked = new Set(['product', ...(Array.isArray(roles) ? roles : [])]);
  return ROLES.filter((r) => picked.has(r.key) && r.sections.includes(key)).map((r) => r.key);
}
