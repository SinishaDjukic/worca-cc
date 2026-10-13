// extension/src/page-context.mjs — what a sidebar message carries about the page (docs/browser-extension.md).
// URL + title + selection always (page-context.md); the readable page text only when the user toggled its chip on for
// this message (page-text.md); a passage the user quoted from the page (Pinpoint "Send to chat" / the context menu) as
// page-quote.md. ALL page-derived text rides in attachments — never in the message text (review M1): the model reads
// them as DATA (system rule 2) and the server stamps a [worca context] line saying so (EXTENSION_CLIENT_LINE).
export const SELECTION_MAX = 4000;
export const TITLE_MAX = 300;
export const PAGE_TEXT_MAX = 200_000;
export const QUOTE_MAX = 4000;
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function pageContextMarkdown({ url, title, selection }) {
  const lines = ['# Web page context', '', `url: ${clip(oneLine(url), 2000)}`, `title: ${clip(oneLine(title), TITLE_MAX)}`];
  const sel = String(selection ?? '').trim();
  if (sel) lines.push('', '## Selected text', '', clip(sel, SELECTION_MAX));
  return `${lines.join('\n')}\n`;
}

export function quoteMarkdown(quote) {
  const lines = ['# Text the user quoted from a web page', ''];
  if (quote.src) lines.push(`from: ${oneLine(quote.src)}`, '');
  lines.push(clip(String(quote.text ?? '').trim(), QUOTE_MAX));
  return `${lines.join('\n')}\n`;
}

export function utf8Base64(text) {
  const bytes = new TextEncoder().encode(String(text ?? '').replace(/\u0000/g, ''));   // the route refuses NUL bytes
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** → the `attachments` array of POST /api/ask/threads/:id/messages. */
export function pageAttachments(ctx, { withText, quote = null }) {
  const out = [];
  if (ctx && ctx.url) {
    out.push({ name: 'page-context.md', dataBase64: utf8Base64(pageContextMarkdown(ctx)) });
    if (withText && ctx.text && String(ctx.text).trim()) {
      out.push({ name: 'page-text.md', dataBase64: utf8Base64(`# ${oneLine(ctx.title) || 'Page text'}\n\nSource: ${oneLine(ctx.url)}\n\n${clip(ctx.text, PAGE_TEXT_MAX + 64)}\n`) });
    }
  }
  if (quote && String(quote.text ?? '').trim()) out.push({ name: 'page-quote.md', dataBase64: utf8Base64(quoteMarkdown(quote)) });
  return out;
}
