// ui/public/ask-command-card.mjs
// Ask agent mode (#574): one command Ask ran, live in the chat. A pure DOM factory (doc injected), like
// ask-run-card.mjs: the panel owns hydration (GET …/commands/:blockId) and the ask-command frames.
import { paintStatusDot } from './status-dot.mjs';
import { RUN_STATES } from '../../src/shared/run-model.mjs';
import { iconSvg } from './icons.mjs';
import { fmtCmdDur, elapsedMs } from './ask-command-group.mjs';

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

/** A command that ended with a non-zero exit code. */
export function isFailed(v) { return !!v && v.status === 'done' && v.exitCode != null && v.exitCode !== 0; }

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

/** The quiet mono copy button (as branch names copy, app.js copyBranchToClipboard): `.copied` for 1200 ms. */
function copyButton(doc, text) {
  const btn = h(doc, 'button', 'btn btn-sm btn-quiet mono ask-cmd-copy');
  btn.type = 'button';
  btn.title = 'Copy command';
  btn.setAttribute('aria-label', 'Copy command');
  const label = h(doc, 'span', 'ask-cmd-copy-text', text);
  btn.append(label);
  btn.insertAdjacentHTML('beforeend', iconSvg('copy', 14).replace('<svg', '<svg class="ico-copy"')
    + iconSvg('check', 14).replace('<svg', '<svg class="ico-check"'));
  let timer = null;
  btn.addEventListener('click', () => {
    const win = doc.defaultView;
    const done = (ok) => {
      btn.classList.toggle('copied', ok);
      btn.title = ok ? 'Copied' : 'Copy failed';
      clearTimeout(timer);
      timer = setTimeout(() => { btn.classList.remove('copied'); btn.title = 'Copy command'; }, 1200);
    };
    const clip = win && win.navigator && win.navigator.clipboard;
    if (!clip) { done(false); return; }
    clip.writeText(text).then(() => done(true), () => done(false));
  });
  return btn;
}

/** `expanded` / `onToggle`: the output's fold, held by the panel per blockId so it outlives a rebuild of the card.
 *  `keepInPlace(control, change)`: a click folds or unfolds inside it, so the host can keep the toggle where it was
 *  on screen (a transcript pinned to its end would otherwise follow the opened output).
 *  `summarise` (#911): the one-line row. `rowOpen`: the person's open choice (undefined = none: a failure opens
 *  itself once); `onRowToggle(open)` reports a click or that auto-open so the panel keeps it across a rebuild.
 *  `now`: the clock (tests pass a fake). */
export function createCommandCard({ doc, card, onStop, onShow = () => {}, expanded = false, onToggle = () => {},
  keepInPlace = (control, change) => change(), summarise = false, rowOpen, onRowToggle = () => {}, now = () => Date.now(), onTick = () => {} }) {
  if (summarise) return createCommandRow({ doc, card, onStop, onShow, expanded, onToggle, keepInPlace, rowOpen, onRowToggle, now, onTick });
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
  folder.addEventListener('click', () => onShow(card.sessionId));
  head.append(h(doc, 'span', 'ask-cmd-kicker', 'Command'), pill, folder, h(doc, 'span', 'ask-rc-spacer'), stop);
  const line = h(doc, 'div', 'ask-cmd-line', `$ ${card.command}`);
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
  el.append(head, line, warning, toggle, out);
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
    /** The full card never joins a group (#911): a no-op, so the panel calls it in either mode. */
    setGroup() {},
    get view() { return view; },
    destroy() { el.remove(); },
  };
}

function createCommandRow({ doc, card, onStop, onShow, expanded, onToggle, keepInPlace, rowOpen, onRowToggle, now, onTick }) {
  const el = h(doc, 'div', 'ask-card ask-cmd is-sum');
  el.dataset.blockId = card.blockId;
  const ghead = h(doc, 'div', 'ask-cmd-ghead');
  ghead.hidden = true;
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
  // The detail: the exact command (copy), the folder, the output fold — today's toggle and <pre>.
  const detail = h(doc, 'div', 'ask-cmd-detail');
  const line = h(doc, 'div', 'ask-cmd-line');
  line.append(h(doc, 'span', 'ask-cmd-dollar', '$ '), copyButton(doc, card.command));
  const folder = h(doc, 'button', 'ask-cmd-folder', card.folder || '');
  folder.type = 'button';
  folder.title = 'Show in the terminal';
  folder.addEventListener('click', () => onShow(card.sessionId));
  const toggle = h(doc, 'button', 'ask-cmd-toggle');
  toggle.type = 'button';
  toggle.hidden = true;
  const tchev = h(doc, 'span', 'ask-cmd-chev', '›');
  tchev.setAttribute('aria-hidden', 'true');
  const toggleLabel = h(doc, 'span', 'ask-cmd-toggle-label', '');
  toggle.append(tchev, toggleLabel);
  const out = h(doc, 'pre', 'ask-cmd-out');
  out.hidden = true;
  detail.append(line, folder, toggle, out);
  const warning = h(doc, 'div', 'ask-cmd-warning', card.warning || '');
  warning.hidden = !card.warning;
  el.append(ghead, row, detail, warning);

  let view = null;
  let open = !!expanded;          // the output fold
  let rowIsOpen = rowOpen === true;
  // A choice already made (a click, or an earlier auto-open the panel recorded): a failure no longer opens itself.
  let chosen = rowOpen === true || rowOpen === false;
  const win = doc.defaultView;
  let ticker = null;              // one 1 s interval while the command runs (D17)
  const text = card.summary || card.command;
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
    const has = !!out.textContent;
    toggle.hidden = !has;
    toggle.setAttribute('aria-expanded', String(open));
    out.hidden = !has || !open;
    if (!out.hidden) out.scrollTop = out.scrollHeight;
  }
  row.addEventListener('click', (e) => {
    if (e.target.closest('.ask-cmd-stop')) return;
    keepInPlace(row, () => { rowIsOpen = !rowIsOpen; chosen = true; paint(); });
    onRowToggle(rowIsOpen);
  });
  toggle.addEventListener('click', () => {
    keepInPlace(toggle, () => { open = !open; paint(); });
    onToggle(open);
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
      out.textContent = v && v.tail ? v.tail : '';
      toggleLabel.textContent = out.textContent ? outputLabel(v) : '';
      if (!chosen && isFailed(v)) {
        // A failure opens itself, with its output, ONCE (D12); reported so later frames and rebuilds keep the person's folds.
        chosen = true; rowIsOpen = true; open = true;
        onRowToggle(true); onToggle(true);
      }
      el.classList.toggle('is-live', live);
      paint();
    },
    /** `{ role: 'first'|'mid'|'last', head? }` or null: this row's place in a group of consecutive commands. */
    setGroup(g) {
      el.classList.toggle('in-group', !!g);
      el.classList.toggle('is-g-first', !!g && g.role === 'first');
      el.classList.toggle('is-g-last', !!g && g.role === 'last');
      ghead.hidden = !(g && g.role === 'first' && g.head);
      ghead.textContent = g && g.role === 'first' && g.head ? g.head : '';
    },
    get view() { return view; },
    destroy() { setTicker(false); el.remove(); },
  };
}
