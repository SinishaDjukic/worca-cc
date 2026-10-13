// extension/src/sidebar/sidebar-view.mjs — the sidebar's DOM, built with Ask Worca's own structure and classes
// (ui/public/ask-panel.mjs) inside worca's Chat page shell (.chat-page > .chat-convo, style.css "Chat P1: shell"), so
// the CSS cut from style.css styles it unchanged. test/extension-sidebar-markup.test.mjs pins it against makePanel.
import { parseQuotedMessage } from '../../../ui/public/pinpoint-model.mjs';

/** The send glyph — the same path as ask-panel.mjs ICONS.send (the markup test reads it from that file). */
export const SEND_ICON_PATH = 'M12 19V5M6 11l6-6 6 6';

/** Every class this module (and sidebar.mjs) puts on an element that style.css or sidebar.css must style.
 *  test/extension-css.test.mjs asserts each has a rule in the generated sidebar CSS. */
export const SIDEBAR_CLASSES = Object.freeze([
  'chat-page', 'chat-convo', 'chat-head', 'chat-dock', 'chat-composer-lead',
  'ask-transcript', 'ask-transcript-col', 'ask-msg', 'ask-user-bubble', 'ask-user-quote', 'ask-user-quote-h', 'ask-user-quote-t',
  'extras-pills', 'extra-pill', 'ask-attachment-pill', 'extra-pill-name', 'ask-answer', 'ask-answer-plain', 'ask-md', 'ask-error-line', 'ask-notice',
  'ask-composer', 'ask-composer-box', 'ask-chips', 'ask-chip', 'ask-chip-quote', 'ask-chip-quote-m', 'ask-chip-quote-k', 'ask-chip-quote-t', 'ask-chip-x',
  'ask-input', 'ask-composer-msg', 'ask-composer-row', 'ask-composer-spacer', 'ask-send', 'ask-stop',
  'wx-app', 'wx-select', 'wx-page-chip', 'wx-sends', 'wx-card', 'wx-card-t', 'wx-card-k', 'wx-state', 'wx-state-t', 'wx-state-k', 'wx-code',
  'wx-state-actions', 'wx-settings',
]);

export function make(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function svgIcon(doc, d, size, stroke) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p);
  return svg;
}

/** Same structure as ask-panel.mjs buildQuoteChip (:570). */
export function buildQuoteChip(doc, q, onRemove) {
  const chip = make(doc, 'div', 'ask-chip ask-chip-quote');
  chip.setAttribute('role', 'group');
  chip.setAttribute('aria-label', 'Quoted text');
  const m = make(doc, 'div', 'ask-chip-quote-m');
  m.append(make(doc, 'div', 'ask-chip-quote-k', q.src ? `From ${q.src}` : 'Quoting'), make(doc, 'div', `ask-chip-quote-t${q.code ? ' mono' : ''}`, q.text));
  const x = make(doc, 'button', 'ask-chip-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Remove quote');
  x.addEventListener('click', onRemove);
  chip.append(m, x);
  return chip;
}

export function buildPageChip(doc, { title, readable, on }, onToggle) {
  const b = make(doc, 'button', `ask-chip wx-page-chip${on ? ' is-on' : ''}`);
  b.type = 'button';
  b.disabled = !readable;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = readable ? 'Send the readable text of this page with the next message' : 'Worca cannot read this page';
  b.append(make(doc, 'span', 'ask-chip-name', `${on ? 'Page text: on' : 'Page text: off'} · ${title || 'this page'}`));
  b.addEventListener('click', onToggle);
  return b;
}

/** "The user must see what is sent": one line in the composer's lead row. */
export function buildSendsNote(doc, tab, withText, hasQuote) {
  if (!tab || (!tab.readable && !tab.url)) return make(doc, 'div', 'wx-sends', tab && tab.reason ? tab.reason : 'No page context: Worca cannot read this page.');
  const parts = tab.readable ? ['page URL', 'title', 'your selection'] : ['page URL', 'title'];
  if (withText && tab.readable) parts.push('the page text');
  if (hasQuote) parts.push('the quoted passage');
  return make(doc, 'div', 'wx-sends', `Sends with your message: ${parts.join(', ')}.`);
}

/** ask-panel.mjs fitInput (:377): one line minimum, 120px maximum. Every programmatic write to the value must call it
 *  (an assignment fires no input event). */
export function fitInput(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight || 0, 120)}px`;
}

/** ask-panel.mjs appendToComposer (:1209): append on a new line, never replace (Pinpoint Use this / Discuss / Go deeper). */
export function appendDraftText(cur, add) {
  const a = String(add ?? '').trim();
  if (!a) return String(cur ?? '');
  const c = String(cur ?? '');
  return c ? `${c.replace(/\s*$/, '')}\n${a}` : a;
}

// ---- the thread list (review M1) -------------------------------------------------------------------------------------
// Pure, so the head's <select> is a function of (list, open thread) and a jsdom test can pin it.

/** The list with `t` in it: an existing entry is updated in place (title, updatedAt); a new one goes first. */
export const THREAD_LIST_MAX = 50;   // a long sidebar session does not grow the select without bound
export function upsertThread(list, t) {
  if (!t || typeof t.id !== 'string') return list;
  const i = list.findIndex((x) => x.id === t.id);
  if (i === -1) return [{ id: t.id, title: t.title ?? null, updatedAt: t.updatedAt ?? null }, ...list].slice(0, THREAD_LIST_MAX);
  const next = list.slice();
  next[i] = { ...list[i], title: t.title ?? list[i].title ?? null, updatedAt: t.updatedAt ?? list[i].updatedAt ?? null };
  return next;
}

/** An ask-title frame: the thread's new title, or the list unchanged when the thread is not in it. */
export function retitleThread(list, id, title) {
  const i = list.findIndex((x) => x.id === id);
  if (i === -1) return list;
  const next = list.slice();
  next[i] = { ...list[i], title: title ?? null };
  return next;
}

/** A thread the server no longer has (404 on load). */
export const dropThread = (list, id) => list.filter((x) => x.id !== id);

/** The head select's options: "New chat" first (selected when no thread is open), then every thread, the open one
 *  selected. The open thread is always listed, so choosing "New chat" is always a real change. */
export function threadOptions(list, openId) {
  const rows = openId && !list.some((t) => t.id === openId) ? [{ id: openId, title: null }, ...list] : list;
  return [
    { value: '', label: 'New chat', selected: !openId },
    ...rows.map((t) => ({ value: t.id, label: t.title || 'Untitled chat', selected: t.id === openId })),
  ];
}

/** The messages route echoes {id,name,bytes,kind,mime}; ask-model reads attKind (ask-panel.mjs:975). */
export function echoAttachments(stored) {
  return (Array.isArray(stored) ? stored : []).map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, attKind: a.kind ?? 'text', mime: a.mime ?? null }));
}

/** The composer — built ONCE per paired session (M4). Same skeleton as ask-panel.mjs buildComposer (:997). */
export function buildComposer(doc, { placeholder, onInput, onSend, onStop }) {
  const wrap = make(doc, 'div', 'ask-composer');
  const box = make(doc, 'div', 'ask-composer-box');
  const lead = make(doc, 'div', 'chat-composer-lead');
  lead.setAttribute('data-chat-composer-lead', '');
  const chips = make(doc, 'div', 'ask-chips');
  chips.hidden = true;
  const input = doc.createElement('textarea');
  input.className = 'ask-input';
  input.rows = 1;
  input.placeholder = placeholder;
  input.addEventListener('input', () => { fitInput(input); onInput(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onSend(); } });
  const msg = make(doc, 'div', 'ask-composer-msg');
  msg.hidden = true;
  const row = make(doc, 'div', 'ask-composer-row');
  const spacer = make(doc, 'span', 'ask-composer-spacer');
  const send = make(doc, 'button', 'ask-send');
  send.type = 'button';
  send.setAttribute('data-ask-send', '');
  send.setAttribute('aria-label', 'Send');
  send.appendChild(svgIcon(doc, SEND_ICON_PATH, 15, 2.2));
  send.addEventListener('click', onSend);
  const stop = make(doc, 'button', 'ask-stop');
  stop.type = 'button';
  stop.setAttribute('data-ask-stop', '');
  stop.setAttribute('aria-label', 'Stop');
  stop.hidden = true;
  const sq = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // The Ask panel's exact glyph (ask-panel.mjs:1122-1131), for pixel parity.
  sq.setAttribute('width', '10'); sq.setAttribute('height', '10'); sq.setAttribute('viewBox', '0 0 24 24');
  sq.setAttribute('fill', 'currentColor'); sq.setAttribute('aria-hidden', 'true');
  const r = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  r.setAttribute('x', '6'); r.setAttribute('y', '6'); r.setAttribute('width', '12'); r.setAttribute('height', '12'); r.setAttribute('rx', '2');
  sq.appendChild(r);
  stop.appendChild(sq);
  stop.addEventListener('click', onStop);
  row.append(spacer, send, stop);
  box.append(lead, chips, input, msg, row);
  wrap.appendChild(box);
  return { el: wrap, lead, chips, input, msg, send, stop };
}

/** Same as ask-panel.mjs renderAnswerInto (:4976): live rows read model.live().text, md vs plain classes. */
export function renderAnswerInto(div, text, renderer, { live = false } = {}) {
  const out = renderer.render(text);
  if (out.kind === 'md') {
    div.classList.add('ask-md');
    div.classList.remove('ask-answer-plain');
    div.replaceChildren(out.frag);
    if (!live && typeof renderer.highlight === 'function') renderer.highlight(div);
  } else {
    div.classList.add('ask-answer-plain');
    div.classList.remove('ask-md');
    div.textContent = text;
  }
}

/** ask-panel.mjs buildAttachmentPill's text branch (:2648). Images are pills here too: an <img> cannot send the token. */
export function buildAttachmentPill(doc, b) {
  const pill = make(doc, 'span', 'extra-pill ask-attachment-pill');
  pill.appendChild(make(doc, 'span', 'extra-pill-name', b.name || '(attachment)'));
  return pill;
}

/**
 * One transcript row, ask-panel.mjs buildMessage (:5025) minus the activity/thinking rows and live cards.
 * @param {{text:(row)=>string, live:(row)=>boolean, renderer:object, sentQuote?:object|null, openInWorca:()=>void}} o
 * → { el, answer } (answer: the .ask-answer element to patch on ask-delta, or null)
 */
export function buildRow(doc, row, { text, live, renderer, sentQuote = null, openInWorca }) {
  const wrap = make(doc, 'div', `ask-msg ask-msg-${row.role}`);
  if (row.role === 'user') {
    const parsed = parseQuotedMessage(row.text || '');
    // A sidebar message's quote rides page-quote.md (M1); this session shows it as the quote card it was sent with.
    const quote = parsed.quote || sentQuote;
    const rest = parsed.quote ? parsed.rest : (row.text || '');
    if (quote) {
      const card = make(doc, 'div', 'ask-user-quote');
      card.append(make(doc, 'div', 'ask-user-quote-h', quote.src ? `From ${quote.src}` : 'Quoted'), make(doc, 'div', 'ask-user-quote-t', quote.text));
      wrap.appendChild(card);
    }
    if (!quote || rest) wrap.appendChild(make(doc, 'div', 'ask-user-bubble', rest));
    const atts = (row.blocks || []).filter((b) => b && b.kind === 'attachment');
    if (atts.length) {
      const pills = make(doc, 'div', 'extras-pills ask-user-pills');
      for (const b of atts) pills.appendChild(buildAttachmentPill(doc, b));
      wrap.appendChild(pills);
    }
    return { el: wrap, answer: null };
  }
  if (row.role === 'system') {
    const notices = (row.blocks || []).filter((b) => b && b.kind === 'notice');
    for (const b of notices.length ? notices : [{ text: row.text }]) { const n = make(doc, 'div', 'ask-notice'); n.appendChild(make(doc, 'span', null, b.text || '')); wrap.appendChild(n); }
    return { el: wrap, answer: null };
  }
  const answer = make(doc, 'div', 'ask-answer');
  wrap.appendChild(answer);
  renderAnswerInto(answer, text(row), renderer, { live: live(row) });
  for (const b of row.blocks || []) {
    if (!b) continue;
    if (b.kind === 'notice') { const n = make(doc, 'div', 'ask-notice'); n.appendChild(make(doc, 'span', null, b.text || '')); wrap.appendChild(n); }
    else if (b.kind === 'card') {
      const card = make(doc, 'div', 'wx-card');
      card.append(make(doc, 'div', 'wx-card-t', (b.card && (b.card.title || b.card.brief)) || 'Card'), make(doc, 'div', 'wx-card-k', 'Act on this card in Worca.'));
      const open = make(doc, 'button', 'btn-ghost', 'Open in Worca');
      open.type = 'button';
      open.addEventListener('click', openInWorca);
      card.append(open);
      wrap.appendChild(card);
    }
  }
  if (row.status === 'error') {
    // ask-panel.mjs:5085-5093 (minus the signed-out "Sign in…" link, which needs the app): a CLASSIFIED notice is the
    // explanation and suppresses the raw line; otherwise errorMessage, else the generic line only when no notice exists.
    const classified = (row.blocks || []).some((b) => b && b.kind === 'notice' && (b.errorClass || b.codexSetup));
    if (!classified) {
      const explained = (row.blocks || []).some((b) => b && b.kind === 'notice');
      if (row.errorMessage) wrap.appendChild(make(doc, 'div', 'ask-error-line', row.errorMessage));
      else if (!explained) wrap.appendChild(make(doc, 'div', 'ask-error-line', 'This turn ended with an error.'));
    }
  }
  return { el: wrap, answer };
}

/** Offline / unpaired / pairing / denied / expired / remote states. */
export function buildState(doc, kind, props = {}) {
  const box = make(doc, 'div', `wx-state wx-${kind}`);
  const T = {
    offline: props.reason
      ? ['Worca could not load this chat', `Worca at ${props.baseUrl} answered with an error: ${props.reason}`]
      : ['Worca isn\'t running', `Nothing answers at ${props.baseUrl}. Start it with "worca ui" (or "npx @worca/app"), then try again.`],
    unpaired: ['Connect to Worca', 'Pair this browser with your local Worca. Worca will ask you to approve it.'],
    pairing: ['Approve in Worca', 'Worca shows a prompt with this code. Approve it there only if the codes match.'],
    denied: ['Pairing was declined', 'Worca declined this browser. You can ask again.'],
    expired: ['The pairing request expired', 'Nobody answered in time. Ask again.'],
    remote: ['Local Worca only', 'This Worca has remote access on; the browser extension works with a local Worca only.'],
  }[kind];
  box.append(make(doc, 'h2', 'wx-state-t', T[0]), make(doc, 'p', 'wx-state-k', T[1]));
  if (kind === 'pairing') box.append(make(doc, 'div', 'wx-code mono', props.code));
  return box;
}
