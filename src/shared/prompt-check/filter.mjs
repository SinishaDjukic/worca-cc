// src/shared/prompt-check/filter.mjs — the prompt check's free stages (docs/prompt-check.md). Stage 0 decides which
// texts are never graded (skipReason); Stage 1 counts cheap text signals and guesses a kind (deterministicAssessment).
// The browser runs both before any request and the server re-checks the text-only rules. Browser-safe.
import { hash64 } from '../workspace-map/ids.mjs';
import { checkShape } from '../shape/shape.mjs';
import { normalizeAssessment } from './assessment.mjs';

export const PROMPT_CHECK_DEBOUNCE_MS = 1500;
/** An edit smaller than this share of the text is not re-graded. */
export const SKIP_MIN_CHANGE = 0.15;
export const SHORT_QUESTION_WORDS = 25;
export const SKIP_REASONS = Object.freeze(['small-talk', 'emoji', 'answer', 'short-question', 'logs-or-code', 'same-text', 'small-change']);

const LOGS_OR_CODE_SHARE = 0.6;
const DETERMINISTIC_CONFIDENCE_MAX = 0.7;

const squash = (text) => String(text ?? '').trim().replace(/\s+/g, ' ');

/** FNV-1a 64 over the trimmed, whitespace-collapsed text → 16 hex chars (D6). */
export function textHash(text) {
  return hash64(squash(text));
}

/** 1 − (common prefix + common suffix) / longer length → 0..1 (D6). */
export function changedShare(prev, next) {
  const a = String(prev ?? '');
  const b = String(next ?? '');
  const longer = Math.max(a.length, b.length);
  if (!longer) return 0;
  const shorter = Math.min(a.length, b.length);
  let p = 0;
  while (p < shorter && a[p] === b[p]) p++;
  let s = 0;
  while (s < shorter - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return Math.round((1 - (p + s) / longer) * 1e6) / 1e6;
}

const SMALL_TALK = new Set(['ok', 'okay', 'thanks', 'thank you', 'yes', 'no', 'go',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', 'option a', 'option b', 'option c', 'option d', 'option e']);
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|\s)+$/u;
const FENCE_RE = /^\s*(?:`{3,}|~{3,})/;
const STACK_LINE_RE = /^\s*at\s+\S.*:\d+(?::\d+)?\)?\s*$/;
const LOG_LINE_RE = /^\s*(?:\[?\d{4}-\d\d-\d\d[T ]|\[?\d\d:\d\d:\d\d|\[?(?:INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\]?[\s:]|\w*(?:Error|Exception):)/;
const CODE_LINE_RE = /(?:[;{}]\s*$|^\s*(?:const|let|var|function|import|export|return|def|class|public|private|#include)\b|^\s*(?:if|for|while)\s*\(|^\s*[$>]\s+\S)/;

const wordsOf = (t) => t.split(/\s+/).filter(Boolean);

function smallTalk(t) {
  const plain = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return SMALL_TALK.has(plain);
}

function mostlyLogsOrCode(text) {
  let fenced = null;
  let lines = 0;
  let hits = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    lines++;
    const m = FENCE_RE.exec(line);
    if (fenced || m) {
      hits++;
      if (m) fenced = fenced ? null : m[0].trim();
      continue;
    }
    if (STACK_LINE_RE.test(line) || LOG_LINE_RE.test(line) || CODE_LINE_RE.test(line)) hits++;
  }
  return lines > 0 && hits / lines >= LOGS_OR_CODE_SHARE;
}

/**
 * Why `text` is not graded, or null. `last` is {hash, text} of the previous check on this surface. `forceTask` (a run
 * card brief, the Shaper task) keeps only the same-text and small-change rules.
 * @returns {string|null} a SKIP_REASONS value
 */
export function skipReason(text, { answering = false, last = null, forceTask = false } = {}) {
  const t = String(text ?? '').trim();
  if (last && typeof last === 'object') {
    if (typeof last.hash === 'string' && last.hash === textHash(t)) return 'same-text';
    if (typeof last.text === 'string' && last.text.trim() && changedShare(squash(last.text), squash(t)) < SKIP_MIN_CHANGE) return 'small-change';
  }
  if (forceTask) return null;
  if (!t || smallTalk(t)) return 'small-talk';
  if (EMOJI_ONLY_RE.test(t)) return 'emoji';
  if (answering) return 'answer';
  if (t.endsWith('?') && wordsOf(t).length < SHORT_QUESTION_WORDS) return 'short-question';
  if (mostlyLogsOrCode(t)) return 'logs-or-code';
  return null;
}

const count = (text, re) => (String(text).match(re) || []).length;
const TASK_VERB_LINE_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:add|build|change|fix|make|remove|create|update|implement|write|delete|rename|move|refactor|replace|improve|support|allow|show|hide|let|use)\b/gim;
const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+\S/gm;
const NUMBERED_LINE_RE = /^\s*\d+[.)]\s+\S/gm;
const HEADING_RE = /^#{1,6}\s+\S/gm;

/** Stage 1: hit counts per signal family (each ≥ 0). */
export function signals(text) {
  const t = String(text ?? '');
  const lines = t.split('\n');
  const headings = count(t, HEADING_RE);
  const numbered = count(t, NUMBERED_LINE_RE);
  return {
    task: count(t, TASK_VERB_LINE_RE) + count(t, /\b(?:should|must)\b/gi) + count(t, LIST_LINE_RE),
    bug: count(t, /\b\w*(?:error|exception)s?\b/gi) + count(t, /\bcrash\w*/gi)
      + count(t, /\bexpected\b[\s\S]*?\bactual\b/gi) + lines.filter((l) => STACK_LINE_RE.test(l)).length,
    requirement: count(t, /\bas an? \w+/gi) + count(t, /\bshould be able to\b/gi) + count(t, /\bso that\b/gi),
    implementation: count(t, /`[^`\s]*\/[^`\s]*\.[A-Za-z0-9]+(?::\d+)?`/g) + count(t, /\bchange\b[^\n]{1,80}?\bto\s+\S+/gi),
    plan: (headings >= 2 ? headings : 0) + (numbered >= 5 ? numbered : 0),
    deliverable: count(t, /\b(?:decks?|slides?|doc(?:ument)?s?|videos?)\b/gi),
  };
}

/** Specific families in tie order; a task-like text with none of them is an idea. */
const KIND_ORDER = Object.freeze(['plan', 'bug', 'implementation', 'requirement', 'deliverable']);

/** Stage 1's assessment: a kind from the signals, no model grade (a plan gets the shape check, D15). */
export function deterministicAssessment(text, { forceTask = false } = {}) {
  const t = String(text ?? '');
  const s = signals(t);
  const total = Object.values(s).reduce((a, n) => a + n, 0);
  const ranked = KIND_ORDER.filter((k) => s[k] > 0).sort((a, b) => s[b] - s[a] || KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  let kind;
  let hits;
  if (ranked.length) { kind = ranked[0]; hits = s[kind]; } else if (t.trim().endsWith('?') && !s.task) { kind = 'question'; hits = 0; } else { kind = 'idea'; hits = s.task; }
  const confidence = total ? Math.min(DETERMINISTIC_CONFIDENCE_MAX, hits / total) : 0;
  return normalizeAssessment({
    isTask: kind !== 'question',
    kind,
    minorKinds: ranked.slice(1),
    confidence,
    grade: kind === 'plan' ? (checkShape(t).ok ? 'clear' : 'needs-detail') : null,
    source: 'deterministic',
  }, { forceTask, text: t });
}
