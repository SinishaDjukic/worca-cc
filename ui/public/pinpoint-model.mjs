// pinpoint-model.mjs — pure helpers for Pinpoint (#669): act on selected text in the chat, run artifacts and the
// Diff tab. DOM-free on purpose (pattern: comment-thread.mjs / diff-view.mjs) so node:test covers them without jsdom;
// pinpoint.mjs (the toolbar and popovers), ask-panel.mjs (the quote chip) and app.js import them.

/**
 * The toolbar per surface: [key, label, shortcut, showLabel]. '|' is a separator. `artifact` is a plan or review
 * open in the viewer; Disagree / Note / Use this collect in its tray while the run can still take a direction.
 */
export const PINPOINT_ACTIONS = Object.freeze({
  chat: [['copy', 'Copy', 'C', false], ['explain', 'Explain', 'E', true], ['alts', 'Alternatives', 'A', true], ['disagree', 'Disagree', 'D', true], ['quote', 'Quote in reply', 'Q', false]],
  artifact: [['copy', 'Copy', 'C', false], ['explain', 'Explain', 'E', true], ['alts', 'Alternatives', 'A', true], ['disagree', 'Disagree', 'D', true], ['note', 'Note', 'N', true], ['|'], ['send', 'Send to chat', 'S', false]],
  diff: [['copy', 'Copy', 'C', false], ['explain', 'Explain', 'E', true], ['alts', 'Alternatives', 'A', true], ['comment', 'Comment', 'M', true], ['|'], ['send', 'Send to chat', 'S', false]],
});

/** Quick reasons on the Disagree box. */
export const DISAGREE_REASONS = Object.freeze(['Too risky', 'Out of scope', 'Simpler please', 'Wrong assumption']);

/** Pending kinds and their tray labels. */
export const PENDING_KINDS = Object.freeze({ disagree: 'Disagree', alt: 'Alternative', note: 'Note' });

/** The longest quote kept; a longer selection is cut with an ellipsis (the server caps it too). */
export const QUOTE_MAX = 2000;
/** The text around a quote sent to Explain / Alternatives. */
export const CONTEXT_MAX = 6000;
/** Same cap as the server's DIRECTION_MAX_CHARS. */
export const DIRECTION_MAX = 4000;

export const normText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function shortText(s, n = 46) {
  const t = normText(s);
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/** A selection's quote: trailing blank lines dropped, lines kept, capped at QUOTE_MAX. */
export function clipQuote(s) {
  const t = String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
  return t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX - 1).trimEnd()}…` : t;
}

/** Up to `max` characters of `full` around [start, end), on word edges where it can. */
export function contextAround(full, start, end, max = CONTEXT_MAX) {
  const text = String(full ?? '');
  if (text.length <= max) return text;
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  let a = Math.max(0, s - Math.floor(Math.max(0, max - (e - s)) / 2));
  let b = a + max;
  if (b > text.length) { b = text.length; a = Math.max(0, b - max); }
  const lead = a > 0 ? text.indexOf(' ', a) : a;
  const tail = b < text.length ? text.lastIndexOf(' ', b) : b;
  const from = lead > -1 && lead < s ? lead + 1 : a;
  const to = tail > e ? tail : b;
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

// ---- quotes in chat messages -------------------------------------------------------------------------------------

const FROM_RE = /^From (.+):$/;

/**
 * The chat message a quote chip sends: the quote as a markdown blockquote (its source on the first line), a blank
 * line, then what the user typed. The model reads it as written; the bubble shows it as a quote card
 * (parseQuotedMessage). An empty quote leaves the text as it is.
 */
export function formatQuotedMessage(quote, text) {
  const q = clipQuote(quote && quote.text);
  const body = String(text ?? '').trim();
  if (!q) return body;
  const src = normText(quote.src);
  const lines = [...(src ? [`From ${src.replace(/:+$/, '')}:`] : []), ...q.split('\n')];
  return `${lines.map((l) => (l ? `> ${l}` : '>')).join('\n')}${body ? `\n\n${body}` : ''}`;
}

/** A message that opens with a blockquote → { quote: {text, src}, rest }; anything else → { quote: null, rest: text }. */
export function parseQuotedMessage(text) {
  const s = String(text ?? '');
  const lines = s.split('\n');
  let i = 0;
  while (i < lines.length && /^>( |$)/.test(lines[i])) i += 1;
  if (!i || (i < lines.length && lines[i].trim())) return { quote: null, rest: s };
  const q = lines.slice(0, i).map((l) => l.replace(/^> ?/, ''));
  const from = FROM_RE.exec(q[0] || '');
  const src = from ? from[1] : '';
  const quoted = (from ? q.slice(1) : q).join('\n').trim();
  if (!quoted) return { quote: null, rest: s };
  return { quote: { text: quoted, src }, rest: lines.slice(i).join('\n').trim() };
}

// ---- Disagree / Alternatives replies -----------------------------------------------------------------------------

/** The message a Disagree sends (chat) or keeps (tray): the reason, then what it should be. */
export function disagreeText(reason, text) {
  const r = normText(reason);
  const t = String(text ?? '').trim();
  if (r && t) return `I disagree (${r.toLowerCase()}): ${t}`;
  if (r) return `I disagree: ${r.toLowerCase()}.`;
  return t ? `I disagree: ${t}` : '';
}

/** The tray / message text for a picked alternative. */
export function useAltText(alt) {
  const title = normText(alt && alt.title);
  const detail = normText(alt && alt.detail);
  return detail ? `Use this instead: ${title} — ${detail}` : `Use this instead: ${title}`;
}

// ---- the artifact tray -------------------------------------------------------------------------------------------

/** localStorage key of one artifact's pending changes. */
export const trayKey = (runId, rel) => `worca.pinpoint.${runId}::${rel}`;

/** Parse a stored tray; anything malformed is an empty one. */
export function readTray(raw) {
  let v = null;
  try { v = JSON.parse(raw || 'null'); } catch { v = null; }
  const items = v && Array.isArray(v.items) ? v.items : [];
  const ok = items.filter((p) => p && typeof p.quote === 'string' && p.quote && PENDING_KINDS[p.kind] && Number.isInteger(p.n));
  return { items: ok, seq: Math.max(Number.isInteger(v?.seq) ? v.seq : 0, ...ok.map((p) => p.n), 0) };
}

/** A tray with one more item (numbered after the last one ever added, so a number is never reused). */
export function addTrayItem(tray, { kind, quote, at = null, text = '' }) {
  const n = tray.seq + 1;
  return { items: [...tray.items, { n, kind, quote: clipQuote(quote), ...(Number.isInteger(at) ? { at } : {}), text: String(text ?? '').trim() }], seq: n };
}

export const removeTrayItem = (tray, n) => ({ items: tray.items.filter((p) => p.n !== n), seq: tray.seq });

/**
 * The run direction "Send back" posts: one line per pending change, quote first. Capped at DIRECTION_MAX — the
 * quotes shrink before any item is dropped, and a cut list says how many it left out.
 */
export function trayDirection(items, file) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';
  const head = `Feedback on ${file || 'the artifact'} — please revise and address each point:`;
  const line = (p, i, qmax) => `${i + 1}. ${PENDING_KINDS[p.kind]} on “${shortText(p.quote, qmax)}”${p.text ? `: ${normText(p.text)}` : ''}`;
  for (const qmax of [400, 160, 60]) {
    const out = [head, ...list.map((p, i) => line(p, i, qmax))].join('\n');
    if (out.length <= DIRECTION_MAX) return out;
  }
  const kept = [];
  let len = head.length;
  for (let i = 0; i < list.length; i++) {
    const l = line(list[i], i, 60);
    if (len + l.length + 1 + 40 > DIRECTION_MAX) break;
    kept.push(l);
    len += l.length + 1;
  }
  const out = [head, ...kept, `(${list.length - kept.length} more not included)`].join('\n');
  return out.length <= DIRECTION_MAX ? out : out.slice(0, DIRECTION_MAX);
}

// ---- the Diff tab ------------------------------------------------------------------------------------------------

/** A diff comment's body from a Pinpoint Comment: the selected code as a blockquote, then the comment. */
export function diffCommentBody(quote, text) {
  const q = clipQuote(quote);
  const t = String(text ?? '').trim();
  if (!q) return t;
  return `${q.split('\n').map((l) => `> \`${l.replace(/`/g, 'ˋ')}\``).join('\n')}${t ? `\n\n${t}` : ''}`;
}

/** The code a diff comment body quotes (diffCommentBody's form), or '' — what the row highlights. */
export function quoteOfCommentBody(body) {
  const lines = String(body ?? '').split('\n');
  const q = [];
  for (const l of lines) {
    const m = /^> `(.*)`$/.exec(l);
    if (!m) break;
    q.push(m[1].replace(/ˋ/g, '`'));
  }
  return q.join('\n');
}

/** Root comments a fix run could still take: open, not sent to a run yet. */
export const openFixComments = (comments) => (Array.isArray(comments) ? comments : []).filter((c) => c && !c.parentId && !c.resolved && !c.sentRunId);

/** The chat text asking Worca to propose a fix run from those comments (propose_run takes their ids). */
export function fixRunRequest(comments, runId) {
  const refs = comments.map((c) => `- [diff comment ${c.id} — ${c.path}:${c.line} (${c.side})] ${shortText(c.body, 120)}`);
  return `Propose a fix run for run ${runId} that addresses these diff comments (pass their ids as commentIds):\n${refs.join('\n')}`;
}

// ---- placement ---------------------------------------------------------------------------------------------------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * The box of the line a selection ended on (forward) or began on (backward), merged across its inline boxes —
 * where the toolbar points. null when no rect has size.
 */
export function lineRect(rects, backward = false) {
  const rs = [...(rects || [])].filter((r) => r && r.width > 0.5 && r.height > 0.5);
  if (!rs.length) return null;
  const pick = backward ? rs[0] : rs[rs.length - 1];
  const mid = pick.top + pick.height / 2;
  const same = rs.filter((r) => Math.abs(r.top + r.height / 2 - mid) < Math.max(6, pick.height / 2));
  const left = Math.min(...same.map((r) => r.left));
  const right = Math.max(...same.map((r) => r.right));
  return { left, right, width: right - left, top: Math.min(...same.map((r) => r.top)), bottom: Math.max(...same.map((r) => r.bottom)) };
}

/**
 * Where the toolbar goes: centred over `r`, kept 8px inside `view`, flipped below when fewer than 48px are free
 * above. → { left, top, below, arrow } (arrow = the pointer's x inside the bar).
 */
export function placeBar(r, { w, h }, view) {
  const cx = r.left + r.width / 2;
  const left = clamp(cx - w / 2, view.left + 8, Math.max(view.left + 8, view.right - w - 8));
  const below = r.top - view.top < 48 + h / 2;
  return { left, top: below ? r.bottom + 10 : r.top - h - 10, below, arrow: clamp(cx - left, 14, w - 14) };
}

/** Where a popover goes: below `r`, or above when it does not fit below and there is more room above. */
export function placePop(r, { w, h }, view) {
  const cx = r.left + r.width / 2;
  const left = clamp(cx - w / 2, view.left + 8, Math.max(view.left + 8, view.right - w - 8));
  const above = r.bottom + 10 + h > view.bottom && r.top - view.top > view.bottom - r.bottom;
  return { left, top: above ? Math.max(view.top + 8, r.top - 10 - h) : r.bottom + 10, above, arrow: clamp(cx - left, 16, w - 16) };
}

/** The offset of `quote` in `full` nearest `at` (whitespace-tolerant fallback), or -1. → { index, length }. */
export function findQuote(full, quote, at = 0) {
  const text = String(full ?? '');
  const q = String(quote ?? '');
  if (!q) return { index: -1, length: 0 };
  let best = -1;
  for (let i = text.indexOf(q); i > -1; i = text.indexOf(q, i + 1)) if (best < 0 || Math.abs(i - at) < Math.abs(best - at)) best = i;
  if (best > -1) return { index: best, length: q.length };
  const words = normText(q).split(' ').filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return { index: -1, length: 0 };
  const m = new RegExp(words.join('\\s+')).exec(text);
  return m ? { index: m.index, length: m[0].length } : { index: -1, length: 0 };
}

/** Alternatives from the server, normalized: 1–3 cards with a title, a detail and tagged tradeoffs. */
export function normalizeAlternatives(list) {
  const tones = new Set(['ok', 'warn', 'bad']);
  return (Array.isArray(list) ? list : []).map((a) => ({
    title: normText(a && a.title).slice(0, 120),
    detail: String((a && a.detail) ?? '').trim().slice(0, 600),
    tradeoffs: (Array.isArray(a && a.tradeoffs) ? a.tradeoffs : [])
      .map((t) => ({ tone: tones.has(t && t.tone) ? t.tone : 'warn', text: normText(t && t.text).slice(0, 60) }))
      .filter((t) => t.text).slice(0, 3),
  })).filter((a) => a.title).slice(0, 3);
}
