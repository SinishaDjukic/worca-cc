// ui/public/ask-ref-chips.mjs — inline chips for what an assistant answer names: a GitHub or Azure DevOps pull
// request, a GitHub issue, an Azure DevOps work item, a worca run or a chat (src/shared/chip-refs.mjs decides which).
// The Chat page's answer pass only (ask-panel.mjs renderAnswerPiece); the markdown renderer and its other surfaces
// stay as they are. It reads the SANITIZED fragment (links, and text outside code/pre) and builds every chip with DOM
// APIs and textContent, never from markup. One controller per panel: a cache keyed by ref, one batched
// POST /api/ask/refs/resolve per render pass (none while the answer streams), and run chips that follow the run store
// like the run cards (chat/run-card.mjs: store events, plus a REST re-read of an unfinished run every 30 s).
import { refFromHref, refsInText, REFS_MAX } from '../../src/shared/chip-refs.mjs';
import { runPill, TERMINAL_RUN_STATUS } from './ask-run-card.mjs';

/** A resolved ref is asked again after this long (on the next render; the server's own cache answers it). */
export const CHIP_TTL_MS = 60_000;
/** An unfinished run this tab gets no frames for is re-read this often while its chip is on screen. */
export const CHIP_REHYDRATE_MS = 30_000;

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHOW_TEXT = 4;                                     // NodeFilter.SHOW_TEXT
const SKIP = new Set(['A', 'CODE', 'PRE']);             // never chip-ify code, or a link's own words
const RING = 'a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0';
/** 24-grid stroked glyphs (module literals only — never data). */
const GLYPHS = {
  pr: [`M3.5 6${RING}`, `M3.5 18${RING}`, `M15.5 18${RING}`, 'M6 8.5v7M18 15.5V10a3 3 0 0 0-3-3h-4', 'M13 5l-2 2 2 2'],
  merged: [`M3.5 6${RING}`, `M15.5 18${RING}`, 'M6 8.5V21M6 9a9 9 0 0 0 9 9h.5'],
  issue: ['M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  ref: ['M5 9h14M5 15h14M10 4 8 20M16 4l-2 16'],
  workitem: ['M10 7h10M10 12h10M10 17h10', 'M4 7l1.2 1.2L7.5 6M4 12l1.2 1.2 2.3-2.2M4 17l1.2 1.2 2.3-2.2'],
  run: ['M8 5.5v13l10.5-6.5z'],
  chat: ['M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z'],
};
const PROVIDER = { gh: 'GitHub', adopr: 'Azure DevOps', adowi: 'Azure DevOps' };
/** The short ref a chip shows: `owner/repo#7`, `api!7`, `AB#123`, `#<run id>`; a chat shows its title only. */
const labelOf = (ref) => ref.label || (ref.kind === 'run' ? `#${ref.id.slice(0, 8)}` : '');
const ITEM_PILL = { open: ['green', 'Open'], draft: ['slate', 'Draft'], merged: ['slate', 'Merged'], closed: ['red', 'Closed'] };
const RESULT_KINDS = { gh: ['pr', 'issue'], adopr: ['pr'], adowi: ['workitem'], run: ['run'], chat: ['chat'] };

/** A work item's state (any process: Agile, Scrum, Basic, CMMI, custom) → a pill tone; unknown states stay neutral. */
export function workItemTone(state) {
  const s = String(state || '').trim().toLowerCase();
  if (['closed', 'done', 'completed'].includes(s)) return 'green';
  if (['removed', 'cut'].includes(s)) return 'red';
  if (s === 'resolved') return 'amber';
  if (['active', 'in progress', 'committed', 'doing', 'approved', 'open'].includes(s)) return 'blue';
  return 'slate';
}

/**
 * @param {{doc: Document, fetch: Function, runStore?: object|null, now?: () => number, root?: () => Element|null,
 *   ttlMs?: number, rehydrateMs?: number, visible?: () => boolean}} opts  `root` holds every answer (the transcript);
 *   rehydrateMs 0 = no interval (tests call tick() by hand); `visible` false = the Chat page is hidden: run store
 *   events scan nothing until show().
 */
export function createRefChips({ doc, fetch, runStore = null, now = () => Date.now(), root = () => null, ttlMs = CHIP_TTL_MS, rehydrateMs = CHIP_REHYDRATE_MS, visible = () => true } = {}) {
  const cache = new Map();        // ref key -> { at, result } (result null: no answer — the chip keeps its plain ref)
  const inflight = new Set();     // keys a request is out for
  const want = new Set();         // keys the next send() asks for
  const info = new WeakMap();     // chip or candidate element -> { ref, fallback, parts }
  let sendQueued = false, repaintQueued = false, missed = false, timer = null, unsub = null, dead = false;

  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // Write a property only when it changes: the run store repaints on every frame of any run, and a rewritten
  // textContent swaps the text node, which collapses a selection the reader holds inside a chip.
  const put = (n, k, v) => { if (n[k] !== v) n[k] = v; };
  /** The browser has an answer (or a miss) for `key` younger than the TTL. */
  const fresh = (key) => { const hit = cache.get(key); return !!hit && now() - hit.at < ttlMs; };
  const resultOf = (ref) => {
    const hit = cache.get(ref.key);
    const r = hit && hit.result;
    return r && r.ok === true && (RESULT_KINDS[ref.kind] || []).includes(r.kind) ? r : null;
  };
  // app.js hides a whole page with the .hidden class (showView), a part of one with [hidden]: the run cards' rule.
  const shown = (el) => !!el && el.isConnected && !(el.closest && el.closest('.hidden, [hidden]'));

  function glyph(name) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of [['class', 'ask-ref-ic'], ['width', '14'], ['height', '14'], ['viewBox', '0 0 24 24'], ['fill', 'none'],
      ['stroke', 'currentColor'], ['stroke-width', '1.9'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
    for (const d of GLYPHS[name] || GLYPHS.ref) { const p = doc.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); }
    return svg;
  }

  /** The run's snapshot: the live lineage from the store (as the run cards read it), else the resolve answer. */
  function runSnap(ref, r) {
    let snap = null;
    if (runStore) {
      const pid = r ? r.id : (/^[0-9a-f]{8}$/.test(ref.id) ? ref.id : null);
      const rid = (r && r.runId) || (pid === ref.id ? null : ref.id);
      if (pid && typeof runStore.byPipeline === 'function') snap = runStore.byPipeline(pid);
      if (!snap && rid && typeof runStore.get === 'function') snap = runStore.get(rid);
    }
    if (snap || !r) return snap;
    const status = String(r.status || '').toLowerCase();
    return { source: 'rest', title: r.title || '', status, pauseReason: r.pauseReason || null, pendingQuestion: null, active: [], terminal: TERMINAL_RUN_STATUS.has(status) };
  }

  /** Paint one chip from the cache (and, for a run, the store): glyph, title, pill and the tooltip. */
  function fill(el) {
    const meta = info.get(el);
    if (!meta) return;
    const { ref, fallback, parts } = meta;
    const r = resultOf(ref);
    let icon = ref.kind === 'adowi' ? 'workitem' : ref.kind === 'gh' ? (ref.type || 'ref') : ref.kind === 'adopr' ? 'pr' : ref.kind;
    let title = '', tone = '', text = '';
    if (ref.kind === 'run') {
      const snap = runSnap(ref, r);
      if (snap) { const p = runPill(snap); title = snap.title || ''; tone = p.family; text = p.text; }
      if (r && r.id) put(parts.label, 'textContent', `#${r.id}`);
    } else if (ref.kind === 'chat') {
      if (r) title = r.title || 'New chat';
    } else if (r) {
      title = r.title;
      if (r.kind === 'workitem') { tone = workItemTone(r.state); text = r.state; } else [tone, text] = Object.hasOwn(ITEM_PILL, r.state) ? ITEM_PILL[r.state] : ['', ''];
      if (ref.kind === 'gh') icon = r.kind === 'issue' ? 'issue' : r.state === 'merged' ? 'merged' : 'pr';
      else if (r.state === 'merged') icon = 'merged';
    }
    title = title || fallback;
    if (parts.icon !== icon) { el.replaceChild(glyph(icon), el.firstChild); parts.icon = icon; }
    put(parts.title, 'textContent', title);
    put(parts.title, 'hidden', !title);
    put(parts.sep, 'hidden', !title || parts.label.hidden);
    put(parts.sep, 'textContent', parts.sep.hidden ? '' : ' · ');   // hidden text still reaches textContent (a copy, a quote)
    put(parts.pill, 'textContent', text);
    put(parts.pill, 'className', `ask-ref-pill tone-${tone || 'slate'}`);
    put(parts.pill, 'hidden', !text);
    const what = ref.kind === 'gh' ? (r ? (r.kind === 'issue' ? 'issue' : 'pull request') : 'issue or pull request')
      : ref.kind === 'adopr' ? 'pull request' : ref.kind === 'adowi' ? (r && r.type ? r.type : 'work item') : ref.kind === 'run' ? 'Run' : 'Chat';
    put(el, 'title', [`${PROVIDER[ref.kind] ? `${PROVIDER[ref.kind]} ` : ''}${what} ${parts.label.textContent}`.trim(), title, text].filter(Boolean).join(' · '));
  }

  function chip(ref, words = '') {
    const fallback = words || (ref.kind === 'chat' ? 'Chat' : '');
    const href = ref.url || null;
    const a = h('a', `ask-ref-chip ask-ref-chip-${ref.kind}`);
    if (href) a.setAttribute('href', href);
    if (href && !href.startsWith('#')) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    const label = h('span', 'ask-ref-label', labelOf(ref));
    label.hidden = ref.kind === 'chat';
    const sep = h('span', 'ask-ref-sep');
    const title = h('span', 'ask-ref-title');
    const pill = h('span', 'ask-ref-pill');
    // The spaces are real text (a copy or a Pinpoint quote reads "o/r#7 · Title Open"); a flex container renders
    // neither the white-space-only node nor the separator's outer spaces.
    a.append(glyph('ref'), label, sep, title, doc.createTextNode(' '), pill);
    info.set(a, { ref, fallback, parts: { icon: 'ref', label, sep, title, pill } });
    fill(a);
    return a;
  }

  /** Where a confirmed candidate links, or null: not confirmed (yet), or a run with no page to open (no app run id and
   *  no History home), which stays text rather than becoming a link that goes nowhere. */
  const confirmedUrl = (ref) => { const r = resultOf(ref); return r ? (ref.kind === 'chat' ? ref.url : routeOf(r)) : null; };

  /** A bare 8-hex id or ask_ id in text: plain text until the server confirms it (then chip()), never a guess. */
  function candidate(ref, text) {
    const url = confirmedUrl(ref);
    if (url) return chip({ ...ref, url });
    if (fresh(ref.key)) return doc.createTextNode(text);   // answered lately: not a run, or not this viewer's chat
    const span = h('span', 'ask-ref-cand', text);
    info.set(span, { ref, fallback: '', parts: null });
    return span;
  }
  /** A confirmed run's page, as the run cards route it (ask-run-card.mjs progressRoute): a run this server still runs
   *  opens Running, any other its History page. */
  const routeOf = (r) => (r.runId && !TERMINAL_RUN_STATUS.has(String(r.status || '').toLowerCase()) ? `#running/${r.runId}`
    : r.home && r.id ? `#history/${r.home}/${r.id}` : r.runId ? `#running/${r.runId}` : null);

  /** The link's own words when they say more than its URL or the ref (`[the login fix](…/pull/7)`): the chip's title
   *  until the lookup answers, and after it when the lookup fails. `[#7](…/pull/7)` says nothing more, and neither
   *  does an autolink's raw text: marked percent-encodes the href (`Caf%C3%A9`) but keeps the text (`Café`). */
  function customText(a, ref) {
    const t = (a.textContent || '').trim();
    const label = labelOf(ref);
    if (!t || t === a.getAttribute('href') || t === ref.url || (label && label.endsWith(t)) || refFromHref(t)) return '';
    return t;
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

  function need(ref, live) {
    if (live || inflight.has(ref.key) || fresh(ref.key)) return;
    want.add(ref.key);
  }

  /** Turn one rendered answer piece's refs into chips. `live`: the answer is still streaming — chips paint from the
   *  cache, but nothing is asked until the finished answer renders. */
  function decorate(container, { live = false } = {}) {
    if (dead || !container) return;
    let runs = false;
    for (const a of [...container.querySelectorAll('a[href]')]) {
      if (a.closest('pre, code')) continue;
      const ref = refFromHref(a.getAttribute('href'));
      if (!ref) continue;
      a.replaceWith(chip(ref, customText(a, ref)));
      need(ref, live);
      runs ||= ref.kind === 'run';
    }
    for (const node of textNodes(container)) {
      const hits = refsInText(node.data);
      if (!hits.length) continue;
      const frag = doc.createDocumentFragment();
      let at = 0;
      for (const { start, end, ref } of hits) {
        if (start > at) frag.append(node.data.slice(at, start));
        const text = node.data.slice(start, end);
        frag.append(ref.candidate || ref.kind === 'chat' ? candidate(ref, text) : chip(ref));
        need(ref, live);
        runs ||= ref.kind === 'run';
        at = end;
      }
      if (at < node.data.length) frag.append(node.data.slice(at));
      node.replaceWith(frag);
    }
    if (runs) wire();
    if (want.size && !sendQueued) { sendQueued = true; Promise.resolve().then(send); }
  }

  function send() {
    sendQueued = false;
    if (dead) return;
    const keys = [...want].filter((k) => !inflight.has(k));
    want.clear();
    // worca's own runs and chats never wait behind a slow forge: two requests, each at most REFS_MAX keys.
    const local = keys.filter((k) => k.startsWith('run:') || k.startsWith('chat:'));
    const remote = keys.filter((k) => !local.includes(k));
    for (const group of [local, remote]) for (let i = 0; i < group.length; i += REFS_MAX) post(group.slice(i, i + REFS_MAX));
  }

  async function post(keys) {
    for (const k of keys) inflight.add(k);
    let refs = null;
    try {
      const res = await fetch('/api/ask/refs/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs: keys }) });
      if (res && res.ok) {
        const body = await res.json();
        if (body && body.refs && typeof body.refs === 'object') refs = body.refs;
      }
    } catch { /* offline: the chips keep their plain refs */ }
    const t = now();
    for (const k of keys) {
      inflight.delete(k);
      const r = refs && Object.prototype.hasOwnProperty.call(refs, k) ? refs[k] : null;
      cache.set(k, { at: t, result: r && typeof r === 'object' ? r : null });   // no answer is cached too: asked again after the TTL, never in a loop
    }
    if (!dead) repaint((ref) => keys.includes(ref.key));
  }

  /** Repaint the chips (and promote the candidates) whose ref matches `pick`, wherever the transcript holds them now. */
  function repaint(pick) {
    const host = root();
    if (!host) return;
    for (const el of [...host.querySelectorAll('.ask-ref-chip, .ask-ref-cand')]) {
      const meta = info.get(el);
      if (!meta || !pick(meta.ref)) continue;
      if (meta.parts) { fill(el); continue; }
      const url = confirmedUrl(meta.ref);
      if (url) el.replaceWith(chip({ ...meta.ref, url }));
      // Text only on a FRESH miss: an expired one is being asked again (want / in flight), and a run store event that
      // lands before that answer must leave the candidate for it to promote (candidate()'s own rule).
      else if (fresh(meta.ref.key)) el.replaceWith(doc.createTextNode(el.textContent));
    }
  }

  /** The 30 s cadence: an unfinished run the store does not hold (a run going on elsewhere) is asked again. */
  function tick() {
    if (dead) return;
    const host = root();
    if (!host) return;
    let any = false;
    for (const el of host.querySelectorAll('.ask-ref-chip-run')) {
      const meta = info.get(el);
      if (!meta || !shown(el) || inflight.has(meta.ref.key)) continue;
      if (cache.has(meta.ref.key) && !resultOf(meta.ref)) continue;   // the server knew no such run: the next render asks again
      const snap = runSnap(meta.ref, resultOf(meta.ref));
      if (snap && (snap.source === 'live' || snap.terminal)) continue;
      want.add(meta.ref.key);
      any = true;
    }
    if (any) send();
  }

  function queueRunRepaint() {
    repaintQueued = true;
    Promise.resolve().then(() => { repaintQueued = false; if (!dead) repaint((ref) => ref.kind === 'run'); });
  }

  function wire() {
    if (!unsub && runStore && typeof runStore.subscribe === 'function') {
      unsub = runStore.subscribe((runId, type) => {
        if (dead || type === 'log' || repaintQueued) return;
        if (!visible()) { missed = true; return; }   // the progress cards' st.open rule: show() catches up
        queueRunRepaint();
      });
    }
    if (!timer && rehydrateMs > 0) {
      timer = setInterval(tick, rehydrateMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
  }

  return {
    decorate,
    tick,
    /** The Chat page shows again: one run chip repaint for the run store events it skipped while hidden. */
    show() {
      if (dead || !missed || !visible()) return;
      missed = false;
      if (!repaintQueued) queueRunRepaint();
    },
    destroy() {
      dead = true;
      if (timer) { clearInterval(timer); timer = null; }
      if (unsub) { try { unsub(); } catch { /* ignore */ } unsub = null; }
      cache.clear(); want.clear();
    },
  };
}
