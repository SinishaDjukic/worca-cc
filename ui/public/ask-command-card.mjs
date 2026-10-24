// ui/public/ask-command-card.mjs
// Ask agent mode (#574): one command Ask ran, live in the chat. A pure DOM factory (doc injected), like
// ask-run-card.mjs: the panel owns hydration (GET …/commands/:blockId) and the ask-command frames.
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

/** A command long enough that the 3-line clamp may cut it (jsdom cannot measure, so this is a length test). */
export function longCommand(cmd) {
  const s = String(cmd || '');
  return s.split('\n').length > 3 || s.length > 180;
}

/** `expanded` / `onToggle`: the output's fold, held by the panel per blockId so it outlives a rebuild of the card.
 *  `keepInPlace(control, change)`: a click folds or unfolds inside it, so the host can keep the toggle where it was
 *  on screen (a transcript pinned to its end would otherwise follow the opened output). */
export function createCommandCard({ doc, card, onStop, onShow = () => {}, expanded = false, onToggle = () => {}, keepInPlace = (control, change) => change() }) {
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
