// src/shared/prompt-check/write-out.mjs — Shaper ask screens: the contract of Guide's "Write it out"
// (POST /api/shape/guide/write). The request validator, the fill cleaner, the line separator Add also uses, and the
// composer of the written text: the person's prompt unchanged, then one "<label>: <fill> (suggested)" line per filled
// gap in the checks' order. The model never returns the prompt, so the prompt is always the exact start of the output.
// Pure and browser-safe.
import { GUIDE_CHECK_IDS, GUIDE_CHECK_LABELS, assertGuideCheckInput } from './assessment.mjs';

export const SUGGESTED = '(suggested)';
export const GUIDE_FILL_MAX = 200;

const refusal = (code, status, message) => Object.assign(new Error(message), { code, status });

/** The request body → `{ text, role, gaps }` (gaps in GUIDE_CHECK_IDS order). The check's refusals come first. */
export function assertGuideWriteInput(body) {
  const { text, role } = assertGuideCheckInput(body);
  const gaps = body.gaps;
  const ok = Array.isArray(gaps) && gaps.length > 0 && new Set(gaps).size === gaps.length
    && gaps.every((g) => typeof g === 'string' && GUIDE_CHECK_IDS.includes(g));
  if (!ok) throw refusal('GUIDE_BAD_GAPS', 400, 'Guide needs the gaps to fill.');
  return { text, role, gaps: GUIDE_CHECK_IDS.filter((id) => gaps.includes(id)) };
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TRAILING_SUGGESTED = /\s*\(suggested\)\s*$/i;

/** One line: control characters dropped, whitespace runs to one space, trimmed, a trailing "(suggested)" removed
 *  (in any case, repeated), at most GUIDE_FILL_MAX characters. '' for a non-string. */
export function cleanFill(value) {
  if (typeof value !== 'string') return '';
  let s = value.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  while (TRAILING_SUGGESTED.test(s)) s = s.replace(TRAILING_SUGGESTED, '').trim();
  return s.slice(0, GUIDE_FILL_MAX).trim();
}

/** The prompt with `line` appended: nothing in front of an empty prompt or after a line break, else one line break. */
export function appendAnswer(value, line) {
  if (value === '' || value.endsWith('\n')) return `${value}${line}`;
  return `${value}\n${line}`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The written text and the filled ids. Only asked gaps with a usable own fill are added. Never throws. */
export function composeWrittenOut({ text, register, gaps, fills }) {
  const reg = register === 'plain' ? 'plain' : 'technical';
  const asked = Array.isArray(gaps) ? gaps : [];
  const own = isObject(fills) ? fills : {};
  let out = String(text ?? '');
  const filled = [];
  for (const id of GUIDE_CHECK_IDS) {
    if (!asked.includes(id) || !Object.hasOwn(own, id)) continue;
    const fill = cleanFill(own[id]);
    if (!fill) continue;
    out = appendAnswer(out, `${GUIDE_CHECK_LABELS[reg][id]}: ${fill} ${SUGGESTED}`);
    filled.push(id);
  }
  return { text: out, filled };
}
