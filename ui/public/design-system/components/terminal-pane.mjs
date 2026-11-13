// TerminalPane (docs/rail/panels.md › panel.terminal): a command's shell, opened under its card by Show in terminal. Its
// output is LogLines (a polite live log), one input line is a Field, and Stop and Close are Buttons; it has no state and
// no words beyond the rule's. Closed (the shell ended or was gone when opened), its last line says "Shell closed" and
// the input is off with dev's reason (ui/public/ask-command-card.mjs).
import { logLines } from './log-lines.mjs';
import { field } from './field.mjs';
import { button } from './button.mjs';
import { attrs } from './html.mjs';

/** Dev's tip for a command whose shell has closed, word for word. */
export const SHELL_CLOSED = 'This command\'s shell has closed (it was idle, or Worca restarted). Its output stays here.';

/**
 * @param {object} o
 * @param {string} o.title          the command, as its card names it
 * @param {{t:string, from?:string, text:string, lvl?:string}[]} o.lines   the session's output
 * @param {boolean} [o.closed]
 * @param {string} [o.input]        what is typed on the input line
 * @param {{stop?:object, close?:object, send?:object}} [o.hooks]
 */
export function terminalPane({ title, lines = [], closed = false, input = '', hooks = {} }) {
  const out = closed ? [...lines, { t: '', text: 'Shell closed' }] : lines;
  const log = logLines({ label: `Terminal · ${title}`, lines: out, attrs: { role: 'log', 'aria-live': 'polite' } });
  const line = field({ id: `term-${(hooks.send && Object.values(hooks.send)[0]) || 'in'}`, label: 'Type a command', quietLabel: true, value: input, placeholder: closed ? 'Shell closed' : 'Type, then Enter', attrs: { ...(hooks.send || {}), disabled: closed ? true : null, title: closed ? SHELL_CLOSED : null, autocomplete: 'off', spellcheck: 'false' } });
  const acts = (closed ? '' : button({ label: 'Stop', kind: 'quiet', cls: 'is-danger', attrs: hooks.stop || {} })) + button({ label: 'Close', kind: 'quiet', attrs: { title: 'Hides the terminal; the shell keeps running', ...(hooks.close || {}) } });
  return `<div class="tp-term"${attrs({ role: 'group', 'aria-label': `Terminal · ${title}` })}>${log}${line}<div class="tp-term-acts">${acts}</div></div>`;
}
