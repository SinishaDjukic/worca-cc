// src/core/ask/html-text.mjs
// Untrusted HTML → readable markdown-ish text for web_fetch (docs/guardrails.md "Web access"). htmlparser2's
// streaming tokenizer: no DOM, no scripts, no CSS, no recursion. Hostile input is bounded by a
// depth cap, O(1) output bookkeeping, and a parse-time budget checked between input chunks
// (htmlparser2's own tag stack is O(depth) per tag, so deep nesting is quadratic inside it).
// It yields to the event loop after every chunk: in relay mode (docs/credential-broker.md) this
// runs on the worca server's main thread, and one heavy page must not stall everyone else. The
// budget counts only time spent parsing, so a busy server does not cut pages short.
import { Parser } from 'htmlparser2';

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'canvas',
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'textarea', 'head', 'dialog']);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr', 'param']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'table', 'tr', 'blockquote', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'details', 'summary', 'address']);
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MAX_DEPTH = 256;
const CHUNK = 8192;
const LINK_TEXT_MAX = 400;

function safeHref(href, baseUrl) {
  if (typeof href !== 'string' || !href.trim()) return null;
  try {
    const u = new URL(href, baseUrl || undefined);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.slice(0, 300) : null;
  } catch { return null; }
}

export async function htmlToText(html, baseUrl = null, { maxChars = 100_000, scope = true, budgetMs = 1500 } = {}) {
  const src = String(html ?? '');
  const scoped = scope && /<(main|article)[\s>]/i.test(src);
  let out = ''; let started = false; let nl = 0; let full = false; let cut = false;
  let title = ''; let titleSeen = false; let inTitle = 0;
  let skipDepth = 0; let scopeDepth = 0; let preDepth = 0;
  const stack = []; const lists = []; const links = [];
  const visible = () => skipDepth === 0 && (!scoped || scopeDepth > 0);
  const append = (s) => {                       // O(|s|): tracks the trailing-newline count without reading `out`
    if (!s) return;
    if (out.length + s.length > maxChars) { s = s.slice(0, maxChars + 1 - out.length); full = true; cut = true; }
    out += s;
    let i = s.length; let k = 0;
    while (i > 0 && (s[i - 1] === ' ' || s[i - 1] === '\t' || s[i - 1] === '\n')) { if (s[i - 1] === '\n') k += 1; i -= 1; }
    if (i === 0) nl += k; else { nl = k; started = true; }
  };
  const emit = (s) => {
    if (!visible() || full) return;
    append(s);
    for (const l of links) if (l.text.length < LINK_TEXT_MAX) l.text += s;
  };
  const block = (n) => { if (visible() && !full && started && nl < n) append('\n'.repeat(n - nl)); };
  const close = (e) => {
    if (e.skip) { skipDepth -= 1; return; }
    if (e.link) {
      links.splice(links.indexOf(e), 1);
      const text = e.text.trim();
      if (text && text !== e.link) emit(` (${e.link})`);
    }
    if (e.scope) { block(2); scopeDepth -= 1; return; }
    if (/^h[1-6]$/.test(e.name)) block(2);
    else if (e.name === 'ul' || e.name === 'ol') { lists.pop(); block(lists.length ? 1 : 2); }
    else if (e.name === 'li' || e.name === 'tr') block(1);
    else if (e.name === 'pre') { preDepth -= 1; block(1); emit('```'); block(2); }
    else if (BLOCK.has(e.name)) block(2);
  };
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'title' && !titleSeen && !stack.some((e) => e.name === 'svg' || e.name === 'math')) inTitle += 1;
      if (VOID.has(name)) { if (name === 'br') block(1); else if (name === 'hr') block(2); return; }
      if (stack.length >= MAX_DEPTH) return;     // deeper nesting is flattened (formatting only)
      const e = { name, skip: skipDepth > 0 || SKIP.has(name), scope: false, link: null, text: '' };
      stack.push(e);
      if (e.skip) { skipDepth += 1; return; }
      if (name === 'main' || name === 'article') { e.scope = true; scopeDepth += 1; block(2); return; }
      if (/^h[1-6]$/.test(name)) { block(2); emit(`${'#'.repeat(Number(name[1]))} `); }
      else if (name === 'ul' || name === 'ol') { block(1); lists.push({ ol: name === 'ol', n: 0 }); }
      else if (name === 'li') { block(1); const l = lists.at(-1); emit(`${'  '.repeat(Math.max(0, lists.length - 1))}${l && l.ol ? `${(l.n += 1)}.` : '-'} `); }
      else if (name === 'pre') { block(2); emit('```\n'); preDepth += 1; }
      else if (name === 'a') { e.link = safeHref(attrs.href, baseUrl); if (e.link) links.push(e); }
      else if (name === 'td' || name === 'th') emit(' | ');
      else if (BLOCK.has(name)) block(2);
    },
    ontext(t) {
      if (inTitle) { if (title.length < 1000) title += t; return; }
      if (preDepth) { emit(t); return; }
      const flat = t.replace(/\s+/g, ' ');
      emit(nl > 0 || !started ? flat.replace(/^ /, '') : flat);  // no stray space at a line start
    },
    onclosetag(name) {
      if (name === 'title' && inTitle) { inTitle -= 1; titleSeen = true; }
      if (VOID.has(name)) return;
      const i = stack.findLastIndex((e) => e.name === name);
      if (i === -1) return;
      while (stack.length > i) close(stack.pop());
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  let spent = 0;
  for (let i = 0; i < src.length && !full; i += CHUNK) {
    if (i > 0) await new Promise(setImmediate);
    const t0 = performance.now();
    parser.write(src.slice(i, i + CHUNK));
    spent += performance.now() - t0;
    if (spent > budgetMs) { cut = true; break; }
  }
  parser.end();
  full = false;                                   // closing fences/blocks of still-open elements get through
  while (stack.length) close(stack.pop());
  const clean = out.replace(CONTROL, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (scoped && !clean && !cut) return htmlToText(src, baseUrl, { maxChars, scope: false, budgetMs });
  return {
    title: title.replace(/\s+/g, ' ').trim().slice(0, 300) || null,
    text: clean.slice(0, maxChars),
    truncated: cut || clean.length > maxChars,
  };
}
