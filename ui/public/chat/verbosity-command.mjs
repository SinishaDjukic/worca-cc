// ui/public/chat/verbosity-command.mjs — the composer's /verbosity command and the reply-style picker's label (#1230).
// Pure, no DOM: ask-panel.mjs intercepts the command before a send, so it is never posted as a message.
import { VERBOSITY_LEVELS, VERBOSITY_LABELS, isVerbosity } from '../../../src/shared/chat-verbosity.mjs';

const COMMAND_RE = /^\/verbosity(?=\s|$)/i;
const CLEAR_WORDS = new Set(['default', 'reset', 'auto']);

/**
 * `/verbosity <level>` sets this chat's reply style; `default` / `reset` / `auto` clear it; no argument shows it.
 * @returns {null | {kind:'set', level:string} | {kind:'clear'} | {kind:'show'} | {kind:'error', message:string}}
 *   null = not the command: the text is a normal message.
 */
export function parseVerbosityCommand(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  const m = COMMAND_RE.exec(t);
  if (!m) return null;
  const arg = t.slice(m[0].length).trim();
  if (!arg) return { kind: 'show' };
  const word = arg.toLowerCase();
  if (VERBOSITY_LEVELS.includes(word)) return { kind: 'set', level: word };
  if (CLEAR_WORDS.has(word)) return { kind: 'clear' };
  return { kind: 'error', message: `Unknown style "${arg}". Use /verbosity ${VERBOSITY_LEVELS.join(' | ')} | default.` };
}

/** The composer picker's label: "Style · Default" with no override, else "Style · <Label>". */
export function verbosityButtonLabel(override) {
  return `Style · ${isVerbosity(override) ? VERBOSITY_LABELS[override] : 'Default'}`;
}
