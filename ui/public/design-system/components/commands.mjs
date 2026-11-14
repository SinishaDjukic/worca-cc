// Commands in a conversation (docs/rail/panels.md › panel.conversation-rail; dev's ask-command-group.mjs and
// ask-command-card.mjs on Rail's rail): commands run one after another are one group, folded to its head; each command is a
// row with no mark, its words saying how it went (done quiet ink, failed quiet red, running counting); one fold opens the
// command (with Copy), where it ran (Show in terminal) and its output (with Copy).
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { button } from './button.mjs';
import { copyButton } from './copy-button.mjs';

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * A group's head, dev's words: "Ran 3 commands · 1 failed · 5.4s"; while one runs, its summary leads ("Running the
 * billing tests · 3 commands · 2.1s").
 * @param {object} o
 * @param {number} o.count
 * @param {number} [o.failed]
 * @param {string} [o.dur]
 * @param {boolean} [o.running]
 * @param {string} [o.current]   the running command's summary
 * @returns {string} markup
 */
export function commandHead({ count, failed = 0, dur = '', running = false, current = '' }) {
  const lead = running && current ? current : `${running ? 'Running' : 'Ran'} ${plural(count, 'command')}`;
  return [`<b>${esc(lead)}</b>`, running && current ? esc(plural(count, 'command')) : '', failed ? `<span class="cmd-failed">${failed} failed</span>` : '', esc(dur)].filter(Boolean).join(' · ');
}

/** A command line: `$`, then the command, its operators (&&, ||, |, ;) dimmed. */
export function commandLine(cmd) {
  return `<span class="cmd-d">$ </span>${esc(cmd).replace(/(\|\||&amp;&amp;|\||;)/g, '<span class="cmd-op">$1</span>')}`;
}

/**
 * CommandRow: one command on the rail. Its summary in plain words (the command itself in its tooltip), then its time, or
 * "exit 1 · 4.2s" when it failed, or its seconds and Stop while it runs. Open: the command with Copy, where it ran with Show
 * in terminal, its output with Copy.
 * @param {object} o
 * @param {string} o.summary
 * @param {string} o.cmd
 * @param {'ok'|'fail'|'run'|'stopped'} [o.state]
 * @param {string} [o.end]      its time, or its exit code and time
 * @param {boolean} [o.open]
 * @param {string} [o.dir]      where it ran
 * @param {string} [o.out]      its output (text)
 * @param {boolean} [o.last]    the output is the tail of a longer one
 * @param {object} [o.hooks]    { toggle, stop, terminal }: each control's attributes
 * @param {object} [o.attrs]    the row's own (a running row's start time, so its seconds count)
 */
export function commandRow({ summary, cmd, state = 'ok', end = '', open = false, dir = '', out = '', last = false, hooks = {}, attrs: a = {} }) {
  const n = out ? out.split('\n').length : 0;
  const line = `<button type="button" class="tr-line"${attrs({ 'aria-expanded': String(open), title: cmd, ...(hooks.toggle || {}) })}><span class="tr-mark"></span><span class="tr-text"><span class="cmd-s">${esc(summary)}</span></span><span class="tr-end"><span class="cmd-s think-t">${esc(end)}</span>${icon(open ? 'chevron' : 'chevR', 12)}</span></button>`;
  const stop = state === 'run' ? button({ label: 'Stop', kind: 'quiet', cls: 'is-danger', attrs: { title: 'Stops this command', ...(hooks.stop || {}) } }) : '';
  const detail = open ? `<div class="cmd-detail"><div class="cmd-code">${commandLine(cmd)}${copyButton({ text: cmd, label: 'Copy command' })}</div>`
    + `${dir || hooks.terminal ? `<div class="cmd-where"><span>${dir ? `in ${esc(dir)}` : ''}</span>${button({ label: 'Show in terminal', kind: 'quiet', attrs: hooks.terminal || {} })}</div>` : ''}`
    + `${out ? `<div class="cmd-out"><div class="cmd-out-h"><span>Output · ${last ? 'last ' : ''}${plural(n, 'line')}</span>${copyButton({ text: out, label: 'Copy output' })}</div><pre>${esc(out)}</pre></div>` : ''}</div>` : '';
  return `<div class="turn-row cmd-row is-${state}${open ? ' is-open' : ''}"${attrs(a)}><div class="cmd-line">${line}${stop}</div>${detail}</div>`;
}

/**
 * CommandGroup: commands run one after another, one row folded to its head (commandHead); a failure opens it. While one
 * runs, Stop sits on the head.
 * @param {object} o
 * @param {string} o.head       commandHead's markup
 * @param {boolean} [o.open]
 * @param {string} [o.rows]     CommandRows (markup)
 * @param {boolean} [o.running]
 * @param {object} [o.hooks]    { toggle, stop }
 */
export function commandGroup({ head, open = false, rows = '', running = false, hooks = {}, attrs: a = {} }) {
  const line = `<button type="button" class="tr-line"${attrs({ 'aria-expanded': String(open), ...(hooks.toggle || {}) })}><span class="tr-mark">${icon(open ? 'chevron' : 'chevR', 14)}</span><span class="tr-text">${head}</span><span class="tr-end"></span></button>`;
  const stop = running ? button({ label: 'Stop', kind: 'quiet', cls: 'is-danger', attrs: { title: 'Stops the running command', ...(hooks.stop || {}) } }) : '';
  return `<div class="turn-row cmd-group${open ? ' is-open' : ''}"${attrs(a)}><div class="cmd-line">${line}${stop}</div>${open ? `<div class="cmd-rows">${rows}</div>` : ''}</div>`;
}
