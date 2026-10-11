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
  role({ key: 'architect', label: 'Architect', icon: 'A', help: 'Decisions table, code layout with real paths, data and API changes.', sections: ['decisions', 'layout'], effect: {} }),
  role({ key: 'qa', label: 'QA', icon: 'Q', help: 'Acceptance criteria as testable checks, a test plan with file names.', sections: ['testing'], effect: {} }),
  role({ key: 'ux', label: 'UX', icon: 'U', help: 'Screens, states (empty, loading, error), levels, accessibility.', sections: ['screens'], effect: { stages: ['manualTestsChecklist', 'manualWebUiTesting'] } }),
  role({ key: 'security', label: 'Security', icon: 'S', help: 'Trust boundaries, inputs, secrets, permissions, abuse cases.', sections: ['threats'], effect: { signals: ['risky'] } }),
  role({ key: 'devops', label: 'DevOps and infrastructure', icon: 'D', help: 'Environments, CI/CD changes, infrastructure as code, monitoring and alerts. Adds no stage.', sections: ['infra'], effect: {} }),
  role({ key: 'release', label: 'Release', icon: 'R', help: 'Migration, feature flag, rollout, rollback.', sections: ['rollout'], effect: {} }),
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
