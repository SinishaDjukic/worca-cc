// src/core/ask-projection.mjs
// The two caps every non-web ask surface shares, and the one helper that renders a
// PERSISTED form ask's answer as text (spec D9, §9).
//
// The ask BODY is never formatted here: that is src/shared/forms/project.mjs's
// projectForm(). What lives here is what a pure, browser-safe module may not know —
// how many characters a chat message or an assistant read may spend — plus the
// values line, which is the named destination for the crude projection
// readPriorAnswers carries today.
import { promptFields, projectForm } from '../shared/forms/project.mjs';

/** Cap for Ask Worca's get_run_progress: an assistant read pays tokens per character. */
export const PROMPT_PROJECTION_MAX = 2000;
/** Cap for ONE chat message: Discord's 2000-char limit is the tightest shipped channel. */
export const CHAT_PROJECTION_MAX = 1400;

/** One answer VALUE as text. A review-list row is `<id>: <verdict> (<note>)`; nothing
 *  reaches String() as a bare object. */
function valueText(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) {
    const rows = v.some((x) => x && typeof x === 'object' && !Array.isArray(x));
    return v.map(valueText).join(rows ? '; ' : ', ');
  }
  if (typeof v === 'object') {
    const id = v.id === undefined || v.id === null ? '' : String(v.id);
    const verdict = v.verdict === undefined || v.verdict === null ? '' : String(v.verdict);
    const note = v.note !== undefined && v.note !== null && String(v.note).trim()
      ? ` (${String(v.note).trim()})` : '';
    return `${id}${id && verdict ? ': ' : ''}${verdict}${note}`;
  }
  return String(v);
}

/**
 * A persisted form ask (ruling X3) as the two strings Ask Worca's get_run_progress
 * reports (ruling X17): the text projection, capped at PROMPT_PROJECTION_MAX, and the
 * answered values. null for a legacy round, whose questions/answers arrays carry
 * everything as they always have. Unredacted — the tool applies its own `redact`,
 * because free text from an agent is DATA, never instructions. A projection that
 * cannot be built (a junk persisted row) degrades to the title, never throws.
 * @param {object|null} ask
 * @returns {{projection: string, values: string}|null}
 */
export function askProgress(ask) {
  if (!ask || typeof ask !== 'object' || ask.kind !== 'form') return null;
  let projection = '';
  try { projection = projectForm(ask, { maxChars: PROMPT_PROJECTION_MAX }); } catch { projection = String(ask.title || ask.form || ''); }
  return { projection, values: askValuesText(ask) };
}

/**
 * The answered values of a PERSISTED form ask (P2 E13: the resolved ask with `values`
 * merged in), as `Label: value` lines in promptFields order. Keys promptFields does not
 * know — a value left over from an older version of the form — are printed last by
 * their field name rather than dropped. Always a string; '' when nothing was answered.
 * @param {object|null} ask
 * @returns {string}
 */
export function askValuesText(ask) {
  const values = ask && typeof ask === 'object' && ask.values && typeof ask.values === 'object'
    ? ask.values : null;
  if (!values) return '';
  let fields = [];
  try { fields = promptFields(ask); } catch { fields = []; }
  const labels = new Map(fields.map((f) => [f.field, f.label || f.field]));
  const ordered = fields.map((f) => f.field).filter((k) => Object.hasOwn(values, k));
  const rest = Object.keys(values).filter((k) => !labels.has(k));
  const keys = [...ordered, ...rest];
  if (!keys.length) return '';
  return keys.map((k) => `${labels.get(k) || k}: ${valueText(values[k])}`).join('\n');
}
