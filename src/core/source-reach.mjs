// src/core/source-reach.mjs — why a task source could not be reached, in product words (plans/requirements-a6-design.md D11).
// Shared by Requirements' export and the Ticket updates routes (plans/ticket-updates-design.md §5); requirements/export.mjs
// re-exports both functions.

/** Kinds whose message is the connector's own sentence ("Jira unreachable: fetch failed.", "Jira refused the request: …"). */
const SENTENCE_KINDS = new Set(['network', 'rate-limit', 'plugin']);
/** Not product copy: more than one line, a stack frame, a path or URL scheme of a file, the shim's own words, a JS error. */
const NOT_COPY = /[\r\n]|\bat\s+\S+\s+\(|\b(?:file|node):|[A-Za-z]:\\|(?:^|[\s'"(=])\/[\w.-]+\/|^plugin "|^\w*Error\b|^Cannot read propert|is not (?:a function|defined)/;
const isSentence = (m) => typeof m === 'string' && !!m.trim() && m.length <= 300 && !NOT_COPY.test(m);
/** The limit a shim timeout names ("… exceeded 30000ms (child killed)") in words; 60 s or none named read "a minute" (A6). */
function limitWords(message) {
  const ms = Number((/exceeded (\d+)ms/.exec(String(message || '')) || [])[1]);
  if (!ms || ms === 60000) return 'a minute';
  const s = Math.max(1, Math.round(ms / 1000));
  return s === 1 ? '1 second' : `${s} seconds`;
}

/** D11: why a tracker could not be reached, in product words. A message that is not product copy (a connector that crashed,
 *  an answer the shim could not read, a kind the host does not know) becomes a fixed phrase; callers log the first line of the raw text. */
export function reachReason(err, name) {
  const kind = err && err.kind;
  const message = err && err.message;
  const plugin = name ? `the ${name} plugin` : "the tracker's plugin";
  if (kind === 'auth') return 'the API token was refused';
  if (kind === 'timeout') return `it did not answer within ${limitWords(message)}`;
  if (kind === 'protocol') return `${plugin} gave an answer Worca could not read`;
  if (kind && !(SENTENCE_KINDS.has(kind) && isSentence(message))) return `${plugin} stopped unexpectedly`;
  return String(message || 'it did not answer').trim().replace(/\.+$/, '');
}
export const reachSentence = (name, err) => `Worca could not reach ${name || 'the tracker'}: ${reachReason(err, name)}.`;
