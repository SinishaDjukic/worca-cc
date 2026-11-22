// ui/public/ask-file-links.mjs — file paths in a chat answer become buttons that open a Files tab of the tool panel
// (issue 1064 §2). The same shape as ask-ref-chips.mjs, and it runs right after it on the same fragment: a walk over the
// SANITIZED answer (text outside links, fences and code — and inline code spans whose whole text is a path), candidates
// that stay plain text until the server confirms them (one batched POST /api/ask/files/resolve per render pass, none
// while the answer streams; one request in flight per chat, the rest queued), and a cache with a TTL. Every node is
// built with DOM APIs and textContent. The same pass names the answer's web links for screen readers (D11b): "…, opens
// in the panel" or "…, opens in a new tab", from `webHint` (chat-link-route.mjs linkHint, given by app.js).
import { fileRefsInText, fileRefFromCode, clampLines, FILE_REFS_MAX } from '../../src/shared/file-refs.mjs';

export const FILE_LINK_TTL_MS = 60_000;
const SHOW_TEXT = 4;
const SKIP = new Set(['A', 'PRE', 'CODE', 'BUTTON']);

/**
 * @param {{doc: Document, fetch: Function, threadId: () => string|null, enabled?: () => boolean, root?: () => Element|null,
 *   onOpen?: (target: object) => void, webHint?: (href: string) => 'panel'|'tab'|null, now?: () => number,
 *   ttlMs?: number}} opts
 */
export function createFileLinks({ doc, fetch, threadId = () => null, enabled = () => true, root = () => null, onOpen = () => {}, webHint = null, now = () => Date.now(), ttlMs = FILE_LINK_TTL_MS } = {}) {
  const cache = new Map();     // `${thread}\n${key}` → { at, result } (null result: not a link)
  const inflight = new Set();  // keys queued or asked, not yet answered
  const want = new Map();      // thread → Set of keys the next send asks
  const queues = new Map();    // thread → chunks of keys waiting for the request in flight (review minor 8)
  const busy = new Set();      // threads with a request in flight
  const info = new WeakMap();  // candidate span → { thread, ref }
  let queued = false;
  let dead = false;
  const ck = (thread, key) => `${thread}\n${key}`;
  const fresh = (k) => { const hit = cache.get(k); return !!hit && now() - hit.at < ttlMs; };
  const confirmed = (k) => { const hit = cache.get(k); return hit && hit.result && hit.result.ok === true ? hit.result : null; };
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function link(thread, ref, r, text) {
    const { line, endLine } = r.type === 'dir' ? { line: null, endLine: null } : clampLines(ref, r.lines);
    const b = make('button', `ask-file-link${r.type === 'dir' ? ' is-dir' : ''}`, text);
    b.type = 'button';
    const where = `${r.path}${line ? `, line ${line}${endLine ? ` to ${endLine}` : ''}` : ''}`;
    b.title = `Open ${where} in the panel`;
    b.setAttribute('aria-label', `${r.type === 'dir' ? 'Folder' : 'File'} ${where}, opens in the panel`);
    const target = { threadId: thread, path: r.path, type: r.type, line, endLine, root: r.root || null, member: r.member || null };
    b.addEventListener('click', (e) => { e.preventDefault(); onOpen(target); });
    return b;
  }

  function ask(thread, key, live) {
    if (live || inflight.has(ck(thread, key)) || fresh(ck(thread, key))) return;
    if (!want.has(thread)) want.set(thread, new Set());
    want.get(thread).add(key);
  }

  function candidate(thread, ref, text, live) {
    const k = ck(thread, ref.key);
    const r = confirmed(k);
    ask(thread, ref.key, live);                            // an answer older than the TTL is asked again
    if (r) return link(thread, ref, r, text);
    if (fresh(k)) return doc.createTextNode(text);         // answered lately: not a file of this chat's root
    const span = make('span', 'ask-file-cand', text);
    info.set(span, { thread, ref });
    return span;
  }

  function textNodes(container) {
    const out = [];
    const walker = doc.createTreeWalker(container, SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let skip = false;
      for (let p = n.parentNode; p && p !== container; p = p.parentNode) if (SKIP.has(p.nodeName)) { skip = true; break; }
      if (!skip && n.data.trim()) out.push(n);
    }
    return out;
  }

  /** Turn one rendered answer piece's paths into candidates or links. `live`: still streaming — links paint from the
   *  cache, nothing is asked until the finished answer renders. */
  /** The answer's http(s) links get an accessible name saying where a click goes (D11b). A link webHint says nothing
   *  about keeps whatever it had. */
  function labelLinks(container) {
    if (typeof webHint !== 'function') return;
    // ref chips fill their own text after a lookup: a label frozen now would hide their title and state for good
    for (const a of [...container.querySelectorAll('a[href]:not(.ask-ref-chip)')]) {
      const href = a.getAttribute('href') || '';
      if (!/^https?:/i.test(href)) continue;
      const hint = webHint(href);
      if (hint !== 'panel' && hint !== 'tab') continue;
      const text = a.textContent.replace(/\s+/g, ' ').trim() || href;
      a.setAttribute('aria-label', `${text}, ${hint === 'panel' ? 'opens in the panel' : 'opens in a new tab'}`);
    }
  }

  function decorate(container, { live = false } = {}) {
    if (dead || !container || !enabled()) return;
    labelLinks(container);
    const thread = threadId();
    if (!thread) return;
    for (const code of [...container.querySelectorAll('code')]) {
      if (code.closest('pre, a, button') || code.querySelector('a, button')) continue;   // raw <code><a> HTML keeps its link
      const ref = fileRefFromCode(code.textContent);
      if (ref) code.replaceChildren(candidate(thread, ref, code.textContent, live));
    }
    for (const node of textNodes(container)) {
      const hits = fileRefsInText(node.data);
      if (!hits.length) continue;
      const frag = doc.createDocumentFragment();
      let at = 0;
      for (const { start, end, ref } of hits) {
        if (start > at) frag.append(node.data.slice(at, start));
        frag.append(candidate(thread, ref, node.data.slice(start, end), live));
        at = end;
      }
      if (at < node.data.length) frag.append(node.data.slice(at));
      node.replaceWith(frag);
    }
    if (want.size && !queued) { queued = true; Promise.resolve().then(send); }
  }

  function send() {
    queued = false;
    if (dead) return;
    for (const [thread, keys] of want) {
      const list = [...keys].filter((k) => !inflight.has(ck(thread, k)));
      if (!list.length) continue;
      for (const k of list) inflight.add(ck(thread, k));          // queued counts: a re-render meanwhile asks nothing twice
      if (!queues.has(thread)) queues.set(thread, []);
      for (let i = 0; i < list.length; i += FILE_REFS_MAX) queues.get(thread).push(list.slice(i, i + FILE_REFS_MAX));
      pump(thread);
    }
    want.clear();
  }

  /** One request in flight per chat: the next chunk goes when the last one answered (or failed). */
  function pump(thread) {
    if (dead || busy.has(thread)) return;
    const keys = queues.get(thread)?.shift();
    if (!keys) { queues.delete(thread); return; }
    busy.add(thread);
    void post(thread, keys).finally(() => { busy.delete(thread); pump(thread); });
  }

  async function post(thread, keys) {
    let body = null;
    try {
      const res = await fetch('/api/ask/files/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: thread, paths: keys }) });
      if (res && res.ok) body = await res.json();
    } catch { /* offline: the words stay text */ }
    const t = now();
    const rootSpec = body && typeof body.root === 'string' ? body.root : null;
    for (const k of keys) {
      inflight.delete(ck(thread, k));
      const r = body && body.paths && Object.prototype.hasOwnProperty.call(body.paths, k) ? body.paths[k] : null;
      cache.set(ck(thread, k), { at: t, result: r && r.ok === true ? { ...r, root: rootSpec } : null });
    }
    if (!dead) repaint(thread, new Set(keys));
  }

  function repaint(thread, keys) {
    const host = root();
    if (!host) return;
    for (const el of [...host.querySelectorAll('.ask-file-cand')]) {
      const m = info.get(el);
      if (!m || m.thread !== thread || !keys.has(m.ref.key)) continue;
      const r = confirmed(ck(thread, m.ref.key));
      if (r) el.replaceWith(link(thread, m.ref, r, el.textContent));
      else if (fresh(ck(thread, m.ref.key))) el.replaceWith(doc.createTextNode(el.textContent));
    }
  }

  return {
    decorate,
    destroy() { dead = true; cache.clear(); want.clear(); queues.clear(); },
  };
}
