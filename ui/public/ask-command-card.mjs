// ui/public/ask-command-card.mjs
// Ask agent mode (#574): one command Ask ran, live in the chat. A pure DOM factory (doc injected), like
// ask-run-card.mjs: the panel owns hydration (GET …/commands/:blockId) and the ask-command frames.
import { paintStatusDot } from './status-dot.mjs';
import { RUN_STATES } from '../../src/shared/run-model.mjs';
import { iconSvg } from './icons.mjs';
import { copyButton, copyFromButton } from './copy-button.mjs';
import { fmtCmdDur, elapsedMs, isFailed, groupHeadParts, groupOpen } from './ask-command-group.mjs';
export { isFailed };

export const COMMAND_CARD_TYPE = 'command';

function h(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

export function pillOf(v) {
  if (!v || v.status === 'running') return { text: 'running', family: 'peach' };
  if (v.status === 'stopped') return { text: v.stoppedBy === 'ask:cap' ? 'stopped (30-min cap)' : 'stopped', family: 'amber' };
  if (v.status === 'interrupted') return { text: 'interrupted', family: 'amber' };
  if (v.exitCode == null) return { text: 'ended', family: 'amber' };
  return { text: `exit ${v.exitCode}`, family: v.exitCode === 0 ? 'green' : 'red' };
}

/** The output toggle's words: how many lines the tail holds ("last N" when the server clipped it). */
function outputLabel(v) {
  const n = String(v.tail).replace(/\n+$/, '').split('\n').length;
  return `Output · ${v.truncated ? 'last ' : ''}${n} line${n === 1 ? '' : 's'}`;
}

const DONE_DOT = Object.freeze({ state: 'done', word: 'Done', dot: 'green', pulse: false, symbol: null });
const ENDED_DOT = Object.freeze({ ...RUN_STATES.stopped, state: 'ended', word: 'Ended' });

/** The runs status dot for a command view (#911): the same states and colours the Runs list draws. */
export function dotOf(v) {
  if (!v || v.status === 'running') return { ...RUN_STATES.working, state: 'working' };
  if (v.status === 'stopped' || v.status === 'interrupted') return { ...RUN_STATES.stopped, state: 'stopped' };
  if (v.exitCode == null) return ENDED_DOT;
  return v.exitCode === 0 ? DONE_DOT : { ...RUN_STATES.failed, state: 'failed' };
}

/** The row's right-hand words: the time, with pillOf's words in front when the command did not pass. */
export function metaOf(v, now = Date.now()) {
  const dur = fmtCmdDur(elapsedMs(v, now));
  if (!v || v.status === 'running' || (v.status === 'done' && v.exitCode === 0)) return dur;
  return `${pillOf(v).text} · ${dur}`;
}

const OPS = ['&&', '||', '|', ';'];

/** #911: the command cut for light colour (D10). `cmd`: each segment's first word; `op`: |, &&, || and ;; `flag`: -x, --x;
 *  `str`: a word opening with a quote; `text`: the rest, spaces included. Joined, the tokens are the command again. */
export function commandTokens(cmd) {
  const s = String(cmd || '');
  const out = [];
  const push = (t, text) => {
    const last = out[out.length - 1];
    if (t === 'text' && last && last.t === 'text') last.s += text; else out.push({ t, s: text });
  };
  let i = 0;
  let head = true;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      if (c === '\n' && s[i - 1] !== '\\') head = true;          // a new line is a new command, unless continued
      push('text', c); i += 1; continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) { push('op', op); i += op.length; head = true; continue; }
    let j = i;
    while (j < s.length && !/[\s|;]/.test(s[j]) && !s.startsWith('&&', j)) {
      if (s[j] === '"' || s[j] === "'") {                          // a quoted span stays in its word
        const q = s[j];
        j += 1;
        while (j < s.length && s[j] !== q) j += s[j] === '\\' && q === '"' ? 2 : 1;
      }
      j += 1;
    }
    j = Math.min(j, s.length);
    const word = s.slice(i, j);
    const t = word[0] === '"' || word[0] === "'" ? 'str' : head ? 'cmd' : /^--?[^-\s]/.test(word) ? 'flag' : 'text';
    push(t, word);
    head = false;
    i = j;
  }
  return out;
}

/** The tokens as DOM: text nodes and `span.ask-cmd-tk-*`, always via textContent (never HTML). */
export function commandSpans(doc, cmd) {
  return commandTokens(cmd).map((k) => (k.t === 'text' ? doc.createTextNode(k.s) : h(doc, 'span', `ask-cmd-tk-${k.t}`, k.s)));
}

/** The card's copy button (copy-button.mjs): an icon square named `name`; `read()` gives the text at click time. */
function cardCopyButton(doc, read, name) {
  const btn = copyButton(doc, { name, cls: 'ask-cmd-copy' });
  btn.addEventListener('click', () => { void copyFromButton(btn, read()); });
  return btn;
}

/** A click that shows the command's terminal tab. `show()` resolving false means its shell has closed (idle, or Worca
 *  restarted): the control says so and stops offering it, instead of a click that does nothing. */
const SHELL_CLOSED = 'This command\'s shell has closed (it was idle, or Worca restarted). Its output stays here.';
function showOrSayClosed(control, show, relabel = () => {}) {
  Promise.resolve(show()).then((shown) => {
    if (shown !== false) return;
    control.disabled = true;
    control.title = SHELL_CLOSED;
    relabel();
  }, () => {});
}

/** A command long enough that the 3-line clamp may cut it (jsdom cannot measure, so this is a length test). */
export function longCommand(cmd) {
  const s = String(cmd || '');
  return s.split('\n').length > 3 || s.length > 180;
}

/** `expanded` / `onToggle`: the full card's output fold, held by the panel per blockId so it outlives a rebuild of the
 *  card. The summary row ignores them: its open state is its output's (one fold).
 *  `keepInPlace(control, change)`: a click folds or unfolds inside it, so the host can keep the toggle where it was
 *  on screen (a transcript pinned to its end would otherwise follow the opened output).
 *  `summarise` (#911): the one-line row. `rowOpen`: the person's open choice (undefined = none: a failure opens
 *  itself once); `onRowToggle(open)` reports a click or that auto-open so the panel keeps it across a rebuild.
 *  `now`: the clock (tests pass a fake). */
export function createCommandCard({ doc, card, onStop, onShow = () => {}, expanded = false, onToggle = () => {},
  keepInPlace = (control, change) => change(), summarise = false, rowOpen, onRowToggle = () => {}, now = () => Date.now(), onTick = () => {} }) {
  if (summarise) return createCommandRow({ doc, card, onStop, onShow, keepInPlace, rowOpen, onRowToggle, now, onTick });
  const el = h(doc, 'div', 'ask-card ask-cmd');
  el.dataset.blockId = card.blockId;
  const head = h(doc, 'div', 'ask-cmd-head');
  const pill = h(doc, 'span', 'ask-cmd-pill st-peach', 'running');
  const stop = h(doc, 'button', 'btn btn-sm btn-danger ask-cmd-stop', 'Stop');
  stop.type = 'button';
  stop.setAttribute('aria-label', 'Stop this command');
  stop.addEventListener('click', () => { stop.disabled = true; onStop(card.sessionId); });
  // The folder names the terminal the command runs in: a click shows that tab in the terminal pane.
  const folder = h(doc, 'button', 'ask-cmd-folder', card.folder || '');
  folder.type = 'button';
  folder.title = 'Show in the terminal';
  folder.addEventListener('click', () => showOrSayClosed(folder, () => onShow(card.sessionId)));
  head.append(h(doc, 'span', 'ask-cmd-kicker', 'Command'), pill, folder, h(doc, 'span', 'ask-rc-spacer'), stop);
  const line = h(doc, 'div', 'ask-cmd-line', `$ ${card.command}`);
  // A long command is clamped to 3 lines (style.css); Show all opens it in place.
  const more = h(doc, 'button', 'btn btn-sm btn-quiet ask-cmd-more', 'Show all');
  more.type = 'button';
  more.hidden = !longCommand(card.command);
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => keepInPlace(more, () => {
    const opened = line.classList.toggle('is-open');
    more.textContent = opened ? 'Show less' : 'Show all';
    more.setAttribute('aria-expanded', String(opened));
  }));
  const warning = h(doc, 'div', 'ask-cmd-warning', card.warning || '');
  warning.hidden = !card.warning;
  // The tail is folded behind this toggle (the head and the command line are the card); no output, no toggle.
  const toggle = h(doc, 'button', 'ask-cmd-toggle');
  toggle.type = 'button';
  toggle.hidden = true;
  const chev = h(doc, 'span', 'ask-cmd-chev', '›');
  chev.setAttribute('aria-hidden', 'true');
  const toggleLabel = h(doc, 'span', 'ask-cmd-toggle-label', '');
  toggle.append(chev, toggleLabel);
  const out = h(doc, 'pre', 'ask-cmd-out');
  out.hidden = true;
  el.append(head, line, more, warning, toggle, out);
  let view = null;
  let open = !!expanded;
  function paintOutput() {
    const has = !!out.textContent;
    toggle.hidden = !has;
    toggle.setAttribute('aria-expanded', String(open));
    out.hidden = !has || !open;
    if (!out.hidden) out.scrollTop = out.scrollHeight;
  }
  toggle.addEventListener('click', () => {
    keepInPlace(toggle, () => { open = !open; paintOutput(); });
    onToggle(open);
  });
  return {
    el,
    update(v) {
      view = v;
      const p = pillOf(v);
      pill.textContent = p.text;
      pill.className = `ask-cmd-pill st-${p.family}`;
      const live = !v || v.status === 'running';
      stop.hidden = !live;
      if (!live) stop.disabled = false;
      out.textContent = v && v.tail ? v.tail : '';
      toggleLabel.textContent = out.textContent ? outputLabel(v) : '';
      paintOutput();
      el.classList.toggle('is-live', live);
    },
    get view() { return view; },
    destroy() { el.remove(); },
  };
}

function createCommandRow({ doc, card, onStop, onShow, keepInPlace, rowOpen, onRowToggle, now, onTick }) {
  const el = h(doc, 'div', 'ask-card ask-cmd is-sum');
  el.dataset.blockId = card.blockId;
  const row = h(doc, 'div', 'ask-cmd-row');
  const btn = h(doc, 'button', 'ask-cmd-row-btn');
  btn.type = 'button';
  const dot = h(doc, 'span');
  const sum = h(doc, 'span', `ask-cmd-sum${card.summary ? '' : ' is-raw'}`, card.summary || card.command);
  sum.title = card.command;
  const meta = h(doc, 'span', 'ask-cmd-meta', '');
  btn.append(dot, sum, meta);
  const stop = h(doc, 'button', 'btn btn-sm btn-danger ask-cmd-stop', 'Stop');
  stop.type = 'button';
  stop.setAttribute('aria-label', 'Stop this command');
  stop.addEventListener('click', () => { stop.disabled = true; onStop(card.sessionId); });
  const chev = h(doc, 'span', 'ask-cmd-chev', '›');
  chev.setAttribute('aria-hidden', 'true');
  row.append(btn, stop, chev);
  // The detail (#911): the whole command (light colour, copy), its folder and Show in terminal, then the output.
  // Opening the row shows the output: one fold.
  const detail = h(doc, 'div', 'ask-cmd-detail');
  const cmdBox = h(doc, 'div', 'ask-cmd-cmd');
  const code = h(doc, 'code', 'ask-cmd-code');
  code.append(h(doc, 'span', 'ask-cmd-dollar', '$ '), ...commandSpans(doc, card.command));
  cmdBox.append(code, cardCopyButton(doc, () => card.command, 'Copy command'));
  const where = h(doc, 'div', 'ask-cmd-ctx');
  const dir = h(doc, 'span', 'ask-cmd-dir', card.folder || '');
  dir.hidden = !card.folder;
  const show = h(doc, 'button', 'btn btn-sm btn-quiet ask-cmd-show');
  show.type = 'button';
  show.insertAdjacentHTML('beforeend', iconSvg('terminal', 14));
  const showLabel = h(doc, 'span', null, 'Show in terminal');
  show.append(showLabel);
  show.addEventListener('click', () => showOrSayClosed(show, () => onShow(card.sessionId), () => { showLabel.textContent = 'Shell closed'; }));
  where.append(dir, h(doc, 'span', 'ask-rc-spacer'), show);
  const out = h(doc, 'pre', 'ask-cmd-out');
  const outBox = h(doc, 'div', 'ask-cmd-outbox');
  outBox.hidden = true;
  const outHead = h(doc, 'div', 'ask-cmd-outhead');
  const outLabel = h(doc, 'span', 'ask-cmd-outlabel', '');
  outHead.append(outLabel, h(doc, 'span', 'ask-rc-spacer'), cardCopyButton(doc, () => out.textContent, 'Copy output'));
  outBox.append(outHead, out);
  detail.append(cmdBox, where, outBox);
  const warning = h(doc, 'div', 'ask-cmd-warning', card.warning || '');
  warning.hidden = !card.warning;
  el.append(row, detail, warning);

  let view = null;
  let rowIsOpen = rowOpen === true;
  // A choice already made (a click, or an earlier auto-open the panel recorded): a failure no longer opens itself.
  let chosen = rowOpen === true || rowOpen === false;
  let stick = true;               // the output follows its newest line until the person scrolls up
  const win = doc.defaultView;
  let ticker = null;              // one 1 s interval while the command runs (D17)
  const given = !!card.summary;                    // #911 slice 2: a chat-given summary is never replaced
  let text = card.summary || card.command;
  function paintDot(v) {
    const m = dotOf(v);
    paintStatusDot(dot, m);
    // The row button speaks the state (D18), so the dot is decoration even when it draws "!".
    dot.removeAttribute('role'); dot.removeAttribute('aria-label'); dot.setAttribute('aria-hidden', 'true');
    return m;
  }
  function paintMeta() {
    const m = dotOf(view);
    meta.textContent = metaOf(view, now());
    btn.setAttribute('aria-label', `${m.word}: ${text}, ${meta.textContent}`);
  }
  function setTicker(live) {
    // Each tick also tells the panel, which repaints the group head's live total (#911).
    if (live && !ticker && win) ticker = win.setInterval(() => { paintMeta(); onTick(); }, 1000);
    if (!live && ticker) { win.clearInterval(ticker); ticker = null; }
  }
  function paint() {
    detail.hidden = !rowIsOpen;
    btn.setAttribute('aria-expanded', String(rowIsOpen));
    el.classList.toggle('is-open', rowIsOpen);
    outBox.hidden = !out.textContent;
    if (rowIsOpen && stick) out.scrollTop = out.scrollHeight;
  }
  out.addEventListener('scroll', () => { stick = out.scrollHeight - out.scrollTop - out.clientHeight < 8; });
  row.addEventListener('click', (e) => {
    if (e.target.closest('.ask-cmd-stop')) return;
    keepInPlace(row, () => { rowIsOpen = !rowIsOpen; chosen = true; paint(); });
    onRowToggle(rowIsOpen);
  });
  paintDot(null);
  paintMeta();
  paint();
  return {
    el,
    update(v) {
      view = v;
      paintDot(v);
      paintMeta();
      const live = !v || v.status === 'running';
      setTicker(!!v && live);
      stop.hidden = !live;
      if (!live) stop.disabled = false;
      const top = out.scrollTop;
      out.textContent = v && v.tail ? v.tail : '';
      outLabel.textContent = out.textContent ? outputLabel(v) : '';
      if (!stick) out.scrollTop = top;               // scrolled up: the new tail does not pull the person down
      if (!chosen && isFailed(v)) {
        // A failure opens itself, its output with it, ONCE (D12); reported so later frames and rebuilds keep the person's fold.
        chosen = true; rowIsOpen = true;
        onRowToggle(true);
      }
      el.classList.toggle('is-live', live);
      el.classList.toggle('is-failed', isFailed(v));
      paint();
    },
    /** #911 slice 2: the Command summaries helper job's line, for a row the chat gave no summary. In place. */
    setSummary(s) {
      const line = typeof s === 'string' ? s.trim() : '';
      if (!line || given) return;
      text = line;
      sum.textContent = line;
      sum.classList.remove('is-raw');
      paintMeta();
    },
    get view() { return view; },
    destroy() { setTicker(false); el.remove(); },
  };
}

let groupSeq = 0;

/** #911: a group of 2+ consecutive commands: one quiet disclosure head over ONE card (`body`); the panel moves the rows'
 *  elements into `body`. `choice`: the recorded fold (a click, or a failure's one auto-open; undefined = none);
 *  `onToggle(open)` reports either, so the panel keeps it across a rebuild (D3, D4). */
export function createCommandGroup({ doc, choice, onToggle = () => {}, keepInPlace = (control, change) => change() }) {
  const el = h(doc, 'div', 'ask-cmd-group');
  const head = h(doc, 'button', 'ask-cmd-ghead');
  head.type = 'button';
  const words = h(doc, 'span', 'ask-cmd-gwords');
  const chev = h(doc, 'span', 'ask-cmd-chev', '›');
  chev.setAttribute('aria-hidden', 'true');
  head.append(words, chev);
  const body = h(doc, 'div', 'ask-cmd-gbody');
  groupSeq += 1;
  body.id = `ask-cmd-g${groupSeq}`;
  head.setAttribute('aria-controls', body.id);
  el.append(head, body);
  let views = [];
  let live = false;
  let chosen = choice === true || choice === false ? choice : undefined;
  let open = false;
  function paint() {
    open = groupOpen(views, chosen, live);
    head.setAttribute('aria-expanded', String(open));
    // An auto-fold must not drop the keyboard focus on <body> (e.g. Stop or a row button was focused): it moves to the head.
    if (!open && !body.hidden && body.contains(doc.activeElement)) head.focus();
    body.hidden = !open;
  }
  head.addEventListener('click', () => {
    keepInPlace(head, () => { chosen = !open; paint(); });
    onToggle(chosen);
  });
  return {
    el,
    body,
    /** The member views (null: not loaded yet); `live`: this message is the live turn (D5). */
    update(vs, { now = Date.now(), live: isLive = false } = {}) {
      views = vs;
      live = isLive;
      const p = groupHeadParts(vs, now, live);
      const parts = [doc.createTextNode(p.lead)];
      if (p.failed) parts.push(doc.createTextNode(' · '), h(doc, 'span', 'ask-cmd-gfail', `${p.failed} failed`));
      parts.push(doc.createTextNode(` · ${p.dur}`));
      words.replaceChildren(...parts);
      if (chosen === undefined && p.failed) { chosen = true; onToggle(true); }   // a failure opens its group ONCE (D12)
      paint();
    },
    get open() { return open; },
  };
}
