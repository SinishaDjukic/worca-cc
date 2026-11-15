// src/shared/prompt-check/perspectives.mjs — the run card's proposed perspectives (flag proposedPerspectives,
// docs/prompt-check.md "Perspectives"): Product plus 2–4 more, from the assessment's kind and the brief's content.
// Pure, deterministic and browser-safe: no model call. Reasons are fixed strings and never echo the prompt text.
import { DEFAULT_PERSPECTIVES, COMPLIANCE_KEY, FIT_KEY, perspectiveByKey } from '../shape/perspectives.mjs';

/** The signals read at most this many characters of the brief (linear regexes, bounded input). */
export const SIGNAL_TEXT_MAX = 8000;
const PROPOSAL_MAX = 5;
const REASON_MAX = 160;

const PLAIN = Object.freeze(['product', 'architect', 'qa']);
/** The start set per kind: 3 keys, Product first. A null or unknown kind starts with DEFAULT_PERSPECTIVES. */
export const KIND_START = Object.freeze({
  requirement: PLAIN,
  implementation: PLAIN,
  plan: PLAIN,
  'run-change': PLAIN,
  bug: Object.freeze(['product', 'qa', 'architect']),
  idea: Object.freeze(['product', 'ux', 'devil']),
  deliverable: Object.freeze(['product', 'ux', 'devil']),
});

/** The fixed reason of a start-set key, per kind ('*' for every kind not named). */
const START_REASONS = Object.freeze({
  product: Object.freeze({ '*': 'Every task: the problem, the goal and what done means.' }),
  architect: Object.freeze({ bug: 'A bug fix: where the fix belongs in the code.', '*': 'Building something: where it goes in the code and what it changes.' }),
  qa: Object.freeze({ bug: 'A bug: a test that reproduces it first.', '*': 'Building something: acceptance checks you can test.' }),
  ux: Object.freeze({ '*': 'An idea or a deliverable: what people see and do with it.' }),
  devil: Object.freeze({ '*': 'An idea or a deliverable: the strongest case against the approach.' }),
});
const startReason = (key, kind) => START_REASONS[key][kind] || START_REASONS[key]['*'];

const words = (list) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');
/** Content signals in priority order. `compliance` applies only with the option. */
export const SIGNALS = Object.freeze([
  Object.freeze({ key: 'security', reason: 'The brief touches sign-in, secrets or permissions.',
    re: words(['auth\\w*', 'sign-?in', 'tokens?', 'secrets?', 'passwords?', 'permissions?', 'xss', 'csrf', 'injection', 'encrypt\\w*']) }),
  Object.freeze({ key: COMPLIANCE_KEY, reason: 'The brief touches personal data, consent, retention or licences.',
    re: words(['personal data', 'pii', 'e-?mail address(?:es)?', 'consent', 'gdpr', 'retention', 'licen[cs]es?']) }),
  Object.freeze({ key: 'release', reason: 'The brief mentions a migration, a flag or a rollout.',
    re: words(['migrations?', 'feature flags?', 'rollouts?', 'rollbacks?', 'releases?']) }),
  Object.freeze({ key: 'devops', reason: 'The brief touches CI, deployment or infrastructure.',
    re: words(['ci', 'pipelines?', 'docker', 'deploy\\w*', 'kubernetes', 'terraform', 'github actions', 'monitoring', 'alerts?']) }),
  Object.freeze({ key: 'ux', reason: 'The brief changes what people see on screen.',
    re: words(['screens?', 'pages?', 'buttons?', 'layout', 'ui', 'accessibility', 'mobile', 'modals?']) }),
  Object.freeze({ key: 'devil', reason: 'The brief replaces an approach: worth arguing against.',
    re: words(['rewrite', 'replace', 'migrate to', 'new framework', 'instead of']) }),
]);

const clip = (s) => s.trim().slice(0, REASON_MAX);

/**
 * The proposed perspectives for a graded brief: the kind's start set, then each matching signal not yet present, then
 * the assessment's own perspectives; Project fit never, Compliance only with the option. 3 to 5 entries, Product
 * first. Never throws.
 * @param {{kind?:string|null, perspectives?:{id:string,reason:string}[]}|null} assessment
 * @param {string} text
 * @param {{compliance?:boolean}} [opts]
 * @returns {{id:string, reason:string}[]}
 */
export function proposePerspectives(assessment, text, { compliance = false } = {}) {
  const a = assessment && typeof assessment === 'object' ? assessment : {};
  const kind = typeof a.kind === 'string' && Object.hasOwn(KIND_START, a.kind) ? a.kind : null;
  const start = kind ? KIND_START[kind] : DEFAULT_PERSPECTIVES;
  const out = start.map((id) => ({ id, reason: startReason(id, kind) }));
  const has = (id) => out.some((e) => e.id === id);
  const allowed = (id) => id !== FIT_KEY && (compliance || id !== COMPLIANCE_KEY) && !!perspectiveByKey(id);
  const body = (typeof text === 'string' ? text : '').slice(0, SIGNAL_TEXT_MAX);
  for (const s of SIGNALS) {
    if (allowed(s.key) && !has(s.key) && s.re.test(body)) out.push({ id: s.key, reason: s.reason });
  }
  for (const p of Array.isArray(a.perspectives) ? a.perspectives : []) {
    const id = p && typeof p.id === 'string' ? p.id : null;
    if (!id || !allowed(id) || has(id)) continue;
    const reason = typeof p.reason === 'string' && p.reason.trim() ? clip(p.reason) : perspectiveByKey(id).help;
    out.push({ id, reason });
  }
  return out.slice(0, PROPOSAL_MAX);
}
