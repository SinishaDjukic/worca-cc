// src/shared/spec-builder/messages.mjs — the markers, the pane's follow-up messages on a Spec Builder thread and its
// title. Each message starts with its own marker: the offline engine sees only the current message under --resume
// (R13). The markers live here (browser-safe, no imports) so engines/mock.mjs can read them without importing
// spec-builder-prompt.mjs → agent-registry.mjs → claude-runner.mjs, which imports the mock engine (an import cycle).
export const SPEC_BUILDER_MARKER = '[worca spec-builder]';
export const ANSWERS_MARKER = '[worca spec-builder answers]';
export const FIX_MARKER = '[worca spec-builder fix]';
export const THREAD_TITLE_MAX = 120;   // = POST /api/ask/threads title cap

/** "Spec: ‹first line›" — the first non-empty line, Markdown heading/list marks dropped. */
export function specThreadTitle(idea) {
  const line = String(idea || '').split('\n').map((l) => l.replace(/^[ \t]*(?:#{1,6}|[-*+]|\d+[.)])?[ \t]*/, '').trim()).find(Boolean) || 'Untitled';
  return `Spec: ${line}`.slice(0, THREAD_TITLE_MAX);
}

/** @param {Array<{id,text}>} questions @param {Record<string,string>} answers */
export function answersMessage(questions, answers) {
  return [ANSWERS_MARKER, 'My answers:',
    ...questions.map((q) => `- ${q.id} — ${q.text} → ${String(answers[q.id] || '').trim() || '(no answer: pick the sensible default and say so in the spec)'}`),
    '', 'Now write the spec and call propose_spec with the whole markdown.'].join('\n');
}

/** @param {Array<{id,label,detail}>} items the failing shape checks to fix */
export function fixMessage(items) {
  return [FIX_MARKER, 'The spec fails these shape checks. Fix exactly these, keep everything else, and call propose_spec again with the whole corrected markdown:',
    ...items.map((i) => `- ${i.id} — ${i.label}${i.detail ? `: ${i.detail}` : ''}`)].join('\n');
}
