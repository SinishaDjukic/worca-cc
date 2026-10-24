/* tools/mock-artifact/shim.js — the mock artifact's fake backend (docs/screenshots.md#mock-artifact). It runs before
   the app's bundle and replays a recorded sandbox session (record.mjs), so the real frontend works with no server:
   - fetch answers /api/* from the recording (build.mjs#httpTable); a GET it cannot answer is a 404 and lands in
     window.__worcaMockMisses (check.mjs reports them), any other method answers { ok: true };
   - the WebSocket is a fake that sends the recorded hello, then a run's recorded frames when the page subscribes;
   - Chat sends get a canned, streamed reply from a small in-page stand-in for the Ask engine;
   - files the frontend names by URL (images, fonts, dagre, xterm.css, hljs modules) come from blob: URLs. */
(function () {
  'use strict';
  const D = JSON.parse(document.getElementById('worca-mock-data').textContent);
  window.__worcaMock = D;

  // Clock pinned to the recording, still ticking, so every "2h ago" reads as it did.
  const RealDate = Date;
  const t0 = performance.now();
  const now = () => D.now + (performance.now() - t0);
  class MockDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now()); }
    static now() { return Math.floor(now()); }
  }
  window.Date = MockDate;

  // ---- assets and modules by URL path -------------------------------------------------------
  const blobs = new Map();
  const bytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  // The app asks by absolute path (/api/…). Opened from disk (file://) those resolve to file:///api/…, whose origin is
  // the opaque "null": treat every file: URL as the page's own, so a double-clicked copy works like a served one.
  const pathOf = (u) => {
    try {
      const x = new URL(u, location.href);
      if (x.protocol === 'file:' && location.protocol === 'file:') return x.pathname;
      return x.origin === location.origin || x.protocol === 'about:' ? x.pathname : null;
    } catch { return null; }
  };
  function assetUrl(u) {
    if (typeof u !== 'string' || !u.startsWith('/')) return u;
    const p = u.split(/[?#]/)[0];
    const a = D.assets[p];
    if (!a) return u;
    if (!blobs.has(p)) blobs.set(p, URL.createObjectURL(new Blob([bytes(a.b64)], { type: a.type })));
    return blobs.get(p);
  }
  for (const [El, prop] of [[HTMLImageElement, 'src'], [HTMLScriptElement, 'src'], [HTMLLinkElement, 'href'], [HTMLSourceElement, 'src']]) {
    const d = Object.getOwnPropertyDescriptor(El.prototype, prop);
    Object.defineProperty(El.prototype, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set(v) { d.set.call(this, assetUrl(v)); } });
  }
  const setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    if ((n === 'src' || n === 'href') && (this instanceof HTMLImageElement || this instanceof HTMLScriptElement || this instanceof HTMLLinkElement)) v = assetUrl(String(v));
    return setAttr.call(this, n, v);
  };
  const modUrls = new Map();
  window.__worcaImport = function (spec) {
    const p = typeof spec === 'string' && spec.startsWith('/') ? spec.split(/[?#]/)[0] : null;
    if (p && D.modules[p] != null) {
      if (!modUrls.has(p)) modUrls.set(p, URL.createObjectURL(new Blob([D.modules[p]], { type: 'text/javascript' })));
      return import(modUrls.get(p));
    }
    return import(spec);
  };

  // The recorded socket frames, and the page's socket (the HTTP and Chat stand-ins push frames to it).
  const frames = D.ws.map((s) => { try { return { s, m: JSON.parse(s) }; } catch { return null; } }).filter(Boolean);
  const hello = frames.find((f) => f.m.type === 'hello');
  let liveSocket = null;

  // ---- HTTP ---------------------------------------------------------------------------------
  const realFetch = window.fetch.bind(window);
  const miss = new Set();
  window.__worcaMockMisses = miss;
  function answer(r) {
    const body = r.b != null ? bytes(r.b) : r.t;
    return new Response(r.s === 204 || r.s === 304 ? null : body, { status: r.s, headers: { 'content-type': r.ct || 'application/json' } });
  }
  window.fetch = async function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const p = pathOf(url);
    if (p == null) return realFetch(input, init);
    const u = new URL(url, location.href);
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    if (!p.startsWith('/api/')) {
      const a = D.assets[p];
      if (a) return new Response(bytes(a.b64), { status: 200, headers: { 'content-type': a.type } });
      if (D.modules[p] != null) return new Response(D.modules[p], { status: 200, headers: { 'content-type': 'text/javascript' } });
      return new Response('', { status: 404 });
    }
    const body = typeof init.body === 'string' ? init.body : null;
    const fake = askFake(method, p, u, body);
    if (fake) { await new Promise((res) => setTimeout(res, 40)); return fake; }
    const k = `${method} ${p}${u.search}`;
    const r = (body && D.http[`${k} ${body}`]) || D.http[k] || D.http[`${method} ${p}`];
    await new Promise((res) => setTimeout(res, 20));
    // Starting a run's action (Run, Test) replays that action's recorded output over the socket.
    const am = method === 'POST' && /^\/api\/runs\/([^/]+)\/actions/.exec(p);
    if (am && liveSocket) {
      const mine = frames.filter((f) => /^action-/.test(f.m.type) && f.s.includes(`"act:${am[1]}:`));
      mine.forEach((f, i) => setTimeout(() => liveSocket._push(f.s), 60 + i * 25));
    }
    if (r) return answer(r);
    miss.add(`${method} ${p}${u.search}`);
    if (method === 'GET') return new Response(JSON.stringify({ error: 'Not available in this mock' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  // ---- Chat: a small stateful stand-in for the Ask engine, so sending a message streams a reply ----------
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  const iso = () => new Date().toISOString();
  const hex = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  const recorded = (k) => { const r = D.http[k]; try { return r && r.t ? JSON.parse(r.t) : null; } catch { return null; } };
  const threads = new Map();   // id -> { thread, messages, base (recorded GET body or null), timers }
  const ZERO = { costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, turns: 0, agents: 0 };
  function newThread() {
    const id = 'ask_' + hex(); const t = iso();
    const thread = { id, title: null, createdAt: t, updatedAt: t, model: null, effort: null, sessionId: null, context: { pinned: false }, contexts: [], totals: { ...ZERO },
      createdBy: 'local', mcpOff: { sets: [], members: [] }, agentMode: true, engine: 'claude' };
    threads.set(id, { thread, messages: [], base: null, timers: [] });
    return thread;
  }
  function stateOf(id) {
    if (threads.has(id)) return threads.get(id);
    const base = recorded(`GET /api/ask/threads/${id}`);
    if (!base || !base.thread) return null;
    const st = { thread: base.thread, messages: base.messages || [], base, timers: [] };
    threads.set(id, st);
    return st;
  }
  const ANSWERS = [
    [/\b(need|waiting|wait|block|clarify|question)/i, 'Three runs are waiting on you. Each one stopped at **Clarify** with a few multiple-choice questions, and planning carries on once you answer them:\n\n- **Bulk-edit contact owners** in nimbus-web\n- **Full-text search for the docs** in lumen-docs\n- **Webhooks for deal stage changes** in nimbus-crm\n\nNothing else is running. The newest finished run, **CSV export for contacts**, is ready to ship: its tests pass and the PR description is drafted.'],
    [/\b(cost|spend|spent|budget|money|price|\$)/i, 'This month\'s runs cost **$59.30**, and **$63.38** all time. No budget limit is set, so nothing is blocked.\n\nThe most expensive finished run was **CSV export for contacts** at $4.82, most of it in Implement and Review. Turning on a monthly limit in **Settings → Runs** stops new runs once the window is spent.'],
    [/\b(fail|failed|error|broke|broken|flaky)/i, 'The **lumen-docs** build failed on a broken link: `guide/setup.md` points at `../install.md`, which the last commit moved to `getting-started/install.md`.\n\nI can start a run that fixes the link and adds a link check to the build, so the next move fails in CI instead of in production. Say the word and I\'ll propose it.'],
    [/\b(test|tests|ci)\b/i, 'The **nimbus-crm** tests pass on `main`: 3 tests, 0 failures, about 130 ms. The newest run, **CSV export for contacts**, added two of them in `test/csv.test.js`.\n\nOpen the run\'s **Actions** tab to run them again in its checkout.'],
  ];
  const FALLBACK = 'This is a design mock of worca, so replies here are canned. In the app, worca reads your runs, projects and workflows to answer, and it can propose a run, a schedule or a workflow right from the chat.\n\nTry asking **which runs need me**, **what did we spend this month**, or **why did the docs build fail**.';
  const answerFor = (text) => (ANSWERS.find(([re]) => re.test(text)) || [null, FALLBACK])[1];
  const titleFor = (text) => { const w = String(text).replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '').split(' ').slice(0, 6).join(' '); return w ? w[0].toUpperCase() + w.slice(1) : 'New chat'; };
  function threadList(search) {
    const base = recorded(`GET /api/ask/threads${search}`) || recorded('GET /api/ask/threads?limit=50') || { threads: [] };
    const touched = [...threads.values()].filter((s) => s.messages.length && (s.base == null || s.touched)).map((s) => s.thread);
    const ids = new Set(touched.map((t) => t.id));
    return { ...base, threads: [...touched.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), ...(base.threads || []).filter((t) => !ids.has(t.id))] };
  }
  function streamTurn(st, text, umId, amId) {
    const tid = st.thread.id; const push = (o) => liveSocket && liveSocket._push(JSON.stringify({ ...o, threadId: tid }));
    const t = iso(); const model = st.thread.model || 'claude-opus-5-5'; const effort = st.thread.effort || 'high';
    const umsg = { id: umId, threadId: tid, seq: st.messages.length + 1, role: 'user', text, blocks: null, status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: t };
    st.messages.push(umsg);
    const answer = answerFor(text);
    const chunks = answer.match(/\S+\s*/g) || [];
    const words = []; for (let i = 0; i < chunks.length; i += 3) words.push(chunks.slice(i, i + 3).join(''));
    let seq = 0; let acc = ''; const started = performance.now();
    const usage = { input: 14000 + text.length * 40 + st.messages.length * 900, output: Math.round(answer.length / 3.6), cacheRead: 0, cacheCreation: 0 };
    usage.ctx = usage.input + usage.output;
    const cost = Math.round((usage.input * 3 + usage.output * 15) / 1e4) / 100;
    const at = (ms, fn) => st.timers.push(setTimeout(fn, ms));
    push({ type: 'ask-message', message: umsg });
    at(40, () => push({ type: 'ask-start', userMessageId: umId, model, effort, startedAt: t, messageId: amId, seq: ++seq }));
    at(60, () => push({ type: 'ask-label', label: 'Thinking', messageId: amId, seq: ++seq }));
    const t0 = 900;
    words.forEach((w, i) => at(t0 + i * 70, () => {
      acc += w; push({ type: 'ask-delta', text: w, messageId: amId, seq: ++seq });
      if (i === 1 && !st.thread.title) { st.thread.title = titleFor(text); push({ type: 'ask-title', title: st.thread.title }); }
    }));
    const end = t0 + words.length * 70 + 40;
    at(end, () => push({ type: 'ask-usage', usage: { ...usage, ctxWindow: 200000 }, costUsd: cost, estimatedCostUsd: null, messageId: amId, seq: ++seq }));
    at(end + 30, () => finish('done'));
    st.finish = finish;
    function finish(status) {
      st.timers.forEach(clearTimeout); st.timers = []; st.finish = null;
      const tot = st.thread.totals || { ...ZERO };
      st.thread.totals = { ...tot, costUsd: Math.round(((tot.costUsd || 0) + cost) * 100) / 100, input: (tot.input || 0) + usage.input, output: (tot.output || 0) + usage.output, turns: (tot.turns || 0) + 1, ctx: usage.ctx, ctxWindow: 200000 };
      st.thread.updatedAt = iso(); st.thread.model = model; st.thread.effort = effort;
      const durationMs = Math.round(performance.now() - started);
      const final = status === 'done' ? answer : acc;
      st.messages.push({ id: amId, threadId: tid, seq: st.messages.length + 1, role: 'assistant', text: final, blocks: [], status, reason: null, model, effort, usage: { ...usage, ctxWindow: 200000 }, costUsd: cost, durationMs, createdAt: t });
      push({ type: 'ask-done', text: final, blocks: [], usage: { ...usage, ctxWindow: 200000 }, costUsd: cost, durationMs, model, status, threadTotals: st.thread.totals, contexts: [], messageId: amId, seq: ++seq });
    }
  }
  function askFake(method, p, u, body) {
    if (method === 'GET' && p === '/api/ask/threads') return threads.size ? json(threadList(u.search)) : null;
    if (method === 'POST' && p === '/api/ask/threads') return json({ thread: newThread() }, 201);
    let m = /^\/api\/ask\/threads\/(ask_[\w-]+)(\/[\w-]+)?$/.exec(p);
    if (!m) return null;
    const [, id, sub] = m;
    if (method === 'GET' && !sub) {
      const st = threads.get(id);
      if (!st) return null;
      return json({ ...(st.base || { attachments: [], runLinks: [], worktrees: [] }), thread: st.thread, messages: st.messages, inFlight: null });
    }
    if (method === 'POST' && sub === '/messages') {
      const st = stateOf(id); if (!st) return null;
      let text = ''; let b = {}; try { b = JSON.parse(body || '{}'); text = String(b.text || ''); } catch {}
      if (b.model) st.thread.model = b.model; if (b.effort) st.thread.effort = b.effort;
      st.touched = true;
      const umId = 'askm_' + hex(); const amId = 'askm_' + hex();
      setTimeout(() => streamTurn(st, text, umId, amId), 5);
      return json({ userMessageId: umId, assistantMessageId: amId, attachments: [], contexts: [] }, 202);
    }
    if (method === 'POST' && sub === '/stop') { const st = threads.get(id); if (st && st.finish) st.finish('stopped'); return json({ ok: true }); }
    if (method === 'PATCH' && !sub) {
      const st = stateOf(id); if (!st) return null;
      try { Object.assign(st.thread, JSON.parse(body || '{}')); } catch {}
      return json({ thread: st.thread });
    }
    if (method === 'DELETE' && !sub) { threads.delete(id); return json({ ok: true }); }
    return null;
  }

  // ---- WebSocket ----------------------------------------------------------------------------

  class MockSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url; this.readyState = 0; this.protocol = ''; this.extensions = ''; this.binaryType = 'blob'; this.bufferedAmount = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this._subs = new Set();
      liveSocket = this;
      setTimeout(() => {
        this.readyState = 1;
        this._emit('open', new Event('open'));
        if (hello) this._push(hello.s);
      }, 30);
    }
    _emit(type, ev) { this.dispatchEvent(ev); const h = this['on' + type]; if (typeof h === 'function') h.call(this, ev); }
    _push(data) { if (this.readyState === 1) this._emit('message', new MessageEvent('message', { data })); }
    send(data) {
      if (this.readyState !== 1) return;
      let m; try { m = JSON.parse(data); } catch { return; }
      if (m.type === 'subscribe' && m.runId && !this._subs.has(m.runId)) {
        this._subs.add(m.runId);
        const mine = frames.filter((f) => f.m.runId === m.runId && f.m.type !== 'hello');
        mine.forEach((f, i) => setTimeout(() => this._push(f.s), 5 + i));
      }
    }
    close() { if (this.readyState >= 2) return; this.readyState = 3; this._emit('close', new CloseEvent('close', { code: 1000, wasClean: true })); }
  }
  Object.assign(MockSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = MockSocket;
})();
