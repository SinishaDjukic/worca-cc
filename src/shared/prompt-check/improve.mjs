// src/shared/prompt-check/improve.mjs — Improve (docs/prompt-check.md, "Improve"): the kind's template, the normaliser
// of the model's rewrite, the text form `Use this` writes, and the backticked paths a rewrite cites. The model replies
// with sections and gaps only; every gap mark is built here, so a section the prompt does not state always carries one.
// Browser-safe: relative src/shared imports only.
import { KIND_RUBRICS, PROMPT_KINDS } from './assessment.mjs';
import { PERSPECTIVES, PERSPECTIVE_KEYS, SECTIONS } from '../shape/perspectives.mjs';

export const SECTION_TEXT_MAX = 2000;
export const DECIDE_MAX = 160;
export const GAPS_MAX = 3;
export const CITED_PATHS_MAX = 50;

/** Per rubric id: the section label, the perspective that decides it, and the default question (Worca's words). */
const ITEMS = {
  requirement: {
    who: ['Who', 'product', 'who uses it?'],
    problem: ['Problem', 'product', 'what problem does it solve?'],
    outcome: ['Outcome', 'product', 'what changes for them when it ships?'],
    'done-when': ['Done when', 'qa', 'how do we know it is done?'],
    scope: ['Scope', 'product', 'what is in and what is out?'],
    constraints: ['Constraints', 'architect', 'what must it respect?'],
  },
  implementation: {
    change: ['Change', 'architect', 'what exactly changes?'],
    where: ['Where', 'architect', 'which files or modules?'],
    tests: ['Tests', 'qa', 'which tests prove it?'],
    'done-when': ['Done when', 'qa', 'how do we know it is done?'],
  },
  bug: {
    steps: ['Steps', 'qa', 'how do we reproduce it?'],
    expected: ['Expected', 'product', 'what should happen?'],
    actual: ['Actual', 'qa', 'what happens instead?'],
    where: ['Where', 'architect', 'where does it happen?'],
    logs: ['Logs', 'qa', 'which error or log shows it?'],
    frequency: ['Frequency', 'qa', 'how often does it happen?'],
  },
  plan: {
    problem: [null, 'product', 'what is the problem and the goal?'],
    testing: [null, 'qa', 'how is it tested?'],
    outOfScope: [null, 'product', 'what is left out?'],
    openQuestions: [null, 'product', 'what is still open?'],
  },
  idea: { goal: ['Goal', 'product', 'what is the goal?'] },
  'run-change': { change: ['Change', 'product', 'what should the run do differently?'] },
  deliverable: {
    audience: ['Audience', 'product', 'who is it for?'],
    purpose: ['Purpose', 'product', 'what should it achieve?'],
    length: ['Length', 'product', 'how long should it be?'],
    sources: ['Sources', 'product', 'which sources should it use?'],
  },
};

/** A plan's template: the Shaper's `always` sections, titled as its `## ` headings. */
const PLAN_IDS = SECTIONS.filter((s) => s.always).map((s) => s.key);
const SECTION_TITLE = Object.fromEntries(SECTIONS.map((s) => [s.key, s.title]));

const templateOf = (kind) => (kind === 'plan' ? PLAN_IDS : KIND_RUBRICS[kind]).map((id) => {
  const [label, perspective, ask] = ITEMS[kind][id];
  return Object.freeze({ id, label: label ?? SECTION_TITLE[id], perspective, ask });
});

/** `{kind: [{id, label, perspective, ask}]}` for the 7 kinds; non-plan ids are the kind's rubric ids, in order. */
export const KIND_TEMPLATES = Object.freeze(Object.fromEntries(PROMPT_KINDS.map((k) => [k, Object.freeze(templateOf(k))])));

const PERSPECTIVE_LABEL = Object.fromEntries(PERSPECTIVES.map((p) => [p.key, p.label]));
const PERSPECTIVE_SET = new Set(PERSPECTIVE_KEYS);

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const plain = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const gapOf = (perspective, decide) => ({ perspective, label: PERSPECTIVE_LABEL[perspective], decide });

/** "Product · decide: who uses it?" */
export function gapLabel(gap) {
  const label = gap?.label || PERSPECTIVE_LABEL[gap?.perspective] || '';
  return `${label} · decide: ${gap?.decide ?? ''}`;
}

/**
 * The model's reply → `{kind, sections:[{id, label, text, gaps:[{perspective, label, decide}]}]}` with every template
 * section, in template order; null when `kind` is not a prompt kind or `raw` has no `sections` array. Never throws.
 */
export function normalizeRewrite(raw, kind) {
  if (!PROMPT_KINDS.includes(kind) || !isObject(raw) || !Array.isArray(raw.sections)) return null;
  const byId = new Map();
  for (const s of raw.sections) if (isObject(s) && typeof s.id === 'string' && !byId.has(s.id)) byId.set(s.id, s);
  const sections = KIND_TEMPLATES[kind].map((t) => {
    const r = byId.get(t.id) || {};
    const text = plain(r.text, SECTION_TEXT_MAX);
    const gaps = (Array.isArray(r.gaps) ? r.gaps : []).filter(isObject).slice(0, GAPS_MAX).map((g) => gapOf(
      typeof g.perspective === 'string' && PERSPECTIVE_SET.has(g.perspective) ? g.perspective : t.perspective,
      plain(g.decide, DECIDE_MAX) || t.ask,
    ));
    if (!text && !gaps.length) gaps.push(gapOf(t.perspective, t.ask));
    return { id: t.id, label: t.label, text, gaps };
  });
  return { kind, sections };
}

const bracketed = (gaps) => gaps.map((g) => `[${gapLabel(g)}]`).join(' ');
const body = (s) => [s.text, bracketed(s.gaps)].filter(Boolean).join(' ');

/** The text `Use this` writes: `Label: text [gap]` per section; a plan's sections as `## Title` headings. */
export function rewriteText(rewrite) {
  const sections = Array.isArray(rewrite?.sections) ? rewrite.sections : [];
  if (rewrite?.kind === 'plan') return sections.map((s) => `## ${s.label}\n${body(s)}`).join('\n\n');
  return sections.map((s) => `${s.label}: ${body(s)}`).join('\n');
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OPEN_GAP = new RegExp(`\\[(?:${PERSPECTIVES.map((p) => escapeRe(p.label)).join('|')}) · decide: [^\\]\\n]*\\]`);

/** True while `text` still holds a bracketed gap mark `Use this` wrote (`[Product · decide: who uses it?]`). */
export function hasOpenGaps(text) {
  return OPEN_GAP.test(String(text ?? ''));
}

const LINE_SUFFIX = /:\d+(?:-\d+)?$/;
const PATHLIKE = /\/|\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/** Backticked path-like tokens of `text` (a `:line` suffix stripped), de-duplicated, at most 50. */
export function citedPaths(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/`([^`\n]+)`/g)) {
    const tok = m[1].replace(LINE_SUFFIX, '');
    if (!tok || /\s/.test(tok) || tok.includes('://') || !PATHLIKE.test(tok) || out.includes(tok)) continue;
    out.push(tok);
    if (out.length >= CITED_PATHS_MAX) break;
  }
  return out;
}
