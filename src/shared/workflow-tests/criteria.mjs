// src/shared/workflow-tests/criteria.mjs — Part 4 (plans/workflow-tests-part4-plan.md D86, D87, D95): an example's criteria and
// its checking model, checked; the key two criteria compare by and trust is kept by. Pure and browser-safe.
import { normText } from './checks.mjs';

export const CRITERIA_MAX = 12;
export const CRITERION_MIN = 3;
export const CRITERION_MAX = 300;
const CRIT_ID_RE = /^k_[a-z0-9]{1,24}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

/** The words as shown: single spaces, trimmed. */
export const criterionText = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
/** How two criteria compare, and what trust is kept by (D95): normText without a closing full stop or exclamation mark. */
export const criterionKey = (s) => normText(criterionText(s)).replace(/[.!]+$/, '').trim();

/**
 * D86. An empty row (the editor's new line left blank) is dropped; a criterion without an id gets `newId()`.
 * @param {unknown} raw the request's list (missing = none)
 * @param {() => string} newId
 * @returns {{criteria: Array<{id: string, text: string}>|null, error: string|null}}
 */
export function normaliseCriteria(raw, newId) {
  if (raw === undefined || raw === null) return { criteria: [], error: null };
  if (!Array.isArray(raw)) return { criteria: null, error: 'criteria must be a list' };
  const out = [];
  const seen = new Set();
  for (const c of raw) {
    const text = criterionText(c && typeof c === 'object' ? c.text : c);
    if (!text) continue;
    if (text.length < CRITERION_MIN || text.length > CRITERION_MAX) {
      return { criteria: null, error: `each criterion must be ${CRITERION_MIN} to ${CRITERION_MAX} characters` };
    }
    const key = criterionKey(text);
    if (seen.has(key)) return { criteria: null, error: `"${text}" is there twice` };
    seen.add(key);
    out.push({ id: c && typeof c === 'object' && CRIT_ID_RE.test(String(c.id || '')) ? c.id : newId(), text });
  }
  if (out.length > CRITERIA_MAX) return { criteria: null, error: `at most ${CRITERIA_MAX} criteria` };
  return { criteria: out, error: null };
}

/** D87: `{ model }` or null. Whether the model is one of the catalog's Claude models is the server's check (judge-models.mjs). */
export function normaliseJudge(raw) {
  if (raw === undefined || raw === null || raw === '') return { judge: null, error: null };
  const model = raw && typeof raw === 'object' ? String(raw.model || '').trim() : '';
  if (!MODEL_RE.test(model)) return { judge: null, error: 'pick the AI model that checks your criteria' };
  return { judge: { model }, error: null };
}
