// ui/public/terminal-pane.mjs — the Terminal tool of the tool panel (issues 573, 1064). The shell runs on the worca
// server (src/core/terminal/manager.mjs); this draws it with xterm.js over /ws (term-* frames). One xterm serves every
// terminal tab: the panel mounts a tab, and this attaches that tab's shell, or starts one in the tab's folder (a run
// member's, a project's own, a chat's). A tab that is not on screen keeps its shell running on the server.
// Chat's agent-mode terminals (#574) are tabs of the chat that started them (tool-tabs.mjs sessionScope). A command the
// chat starts never opens or switches the panel; a click on the command card's folder shows its tab (panel showSession).
// The server records each command for the audit log; the tool does not list them.
import { createLineEditor } from './terminal-line.mjs';
import { runQuery } from './tool-tabs.mjs';

// xterm's 16 ANSI colours, each read from a --term-ansi-* token (style.css), so both themes stay readable.
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const ansiToken = (name) => `--term-ansi-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const LIVE_WARNING = 'This pipeline is still running and changing these files.';

let xtermPromise = null;
/** xterm.js + the fit addon, loaded on first use: pages that never show a terminal never pay for it. */
export function defaultLoadXterm(doc) {
  if (!doc.querySelector('link[data-xterm-css]')) {
    const l = doc.createElement('link');
    l.rel = 'stylesheet'; l.href = '/vendor/xterm/xterm.css'; l.dataset.xtermCss = '1';
    doc.head.appendChild(l);
  }
  xtermPromise ||= Promise.all([import('/vendor/xterm/xterm.mjs'), import('/vendor/xterm/addon-fit.mjs')])
    .then(([x, f]) => ({ Terminal: x.Terminal, FitAddon: f.FitAddon }))
    .catch((e) => { xtermPromise = null; throw e; });
  return xtermPromise;
}

/**
 * The Terminal tool. `kind` is its tool panel registration (tool-kinds.mjs). `onSessions(list)` hears the server's
 * sessions after each change, once the first list loaded (the panel keeps one tab per live shell). It is held while a
 * tab's shell is starting, so that start's own term-status frame never makes a second tab for it.
 * `confirm({ title, message, confirmLabel })` resolves true to go ahead (app.js passes its confirmModal).
 */
export function createTerminalTool({ doc, win, fetch, sendWs, confirm = null, loadXterm = null, onSessions = null }) {
  const load = loadXterm || (() => defaultLoadXterm(doc));
  const st = { enabled: true, pty: { available: true, reason: null }, sessions: new Map(), current: null, lastSeq: 0,
    infoOk: false, info: null, api: null, tabId: null, member: '', ctx: null, ctxGen: 0,
    term: null, fit: null, line: null, bootId: null, note: '', busy: '', online: true, destroyed: false, replaying: null,
    warnings: new Map(),         // session id → the warning its open returned (a detached branch copy): shown while attached
    starting: new Set(),         // tab ids whose shell is being made: one start per tab at a time
    closing: new Set(),          // session ids whose close (a tab's ×) is under way
    restartFor: null,            // Enter starts a new shell for this tab (its last one ended, or none started)
    why: null };
  const drawn = { context: '' };   // what the context line shows: unchanged → not rebuilt (an open select stays open)
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // ── DOM: a terminal tab's body. The panel moves it into its own body whenever a terminal tab shows. ──
  const el = make('div', 'term-body');
  const context = make('div', 'term-context');
  const banners = make('div', 'term-banners');
  const screen = make('div', 'term-screen');
  const probe = make('span', 'term-sel-probe');      // its token background becomes xterm's selection colour
  const ansiProbes = ANSI.map((name) => {            // their token colours become xterm's ANSI palette
    const p = make('span', 'term-ansi-probe');
    p.style.setProperty('color', `var(${ansiToken(name)})`);
    return [name, p];
  });
  // xterm opens in the host, which has no padding or border: FitAddon sizes rows and columns from its
  // parent's computed height and width, and under border-box those would include the frame's.
  const host = make('div', 'term-host');
  screen.append(probe, ...ansiProbes.map(([, p]) => p), host);
  el.append(context, banners, screen);

  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (!r.ok) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status, code: j && j.code });
    return j;
  }
  const showError = (e) => { st.note = e?.message || String(e); render(); return null; };
  // app.js's sendWs returns false while /ws is down (reconnecting): the pane says so instead of
  // pretending the keys went through. onHello clears it.
  function send(obj) {
    const ok = sendWs(obj) !== false;
    if (!ok && st.online) { st.online = false; renderBanners(); }
    return ok;
  }

  function emitSessions() {
    if (st.infoOk && !st.starting.size && typeof onSessions === 'function') onSessions([...st.sessions.values()]);
  }
  async function refreshInfo() {
    try {
      const info = await api('GET', '/api/terminal');
      st.enabled = !!info.enabled;
      st.pty = info.pty || st.pty;
      // The server's list is the truth. The attached one stays in the map, marked ended, so its tab can offer Enter.
      const keep = st.current && st.sessions.get(st.current);
      st.sessions = new Map((info.sessions || []).map((s) => [s.id, s]));
      if (keep && !st.sessions.has(keep.id)) st.sessions.set(keep.id, keep.status === 'running' ? { ...keep, status: 'closed' } : keep);
      st.infoOk = true;
    } catch (e) { st.note = e.message; st.info = null; }
    render();
    emitSessions();
  }
  const ensureInfo = () => (st.info ||= refreshInfo());

  const memberNow = () => st.ctx?.members?.find((x) => x.projectKey === st.member) || st.ctx?.members?.[0] || null;
  /** A run tab's members (folders, checkout state, warning): what its context line and its start read. */
  async function loadRunCtx(scope) {
    const gen = ++st.ctxGen;
    let ctx = null;
    try { ctx = await api('GET', `/api/runs/${encodeURIComponent(scope.id)}/terminal?${runQuery(scope)}`); }
    catch (e) { if (gen === st.ctxGen) st.note = e.message; }
    if (gen !== st.ctxGen) return null;
    st.ctx = ctx;
    for (const s of ctx?.sessions || []) if (!st.sessions.has(s.id)) st.sessions.set(s.id, s);
    if (ctx && !ctx.members.some((m) => m.projectKey === st.member)) st.member = ctx.members[0]?.projectKey || '';
    return ctx;
  }
  const endedWhy = (s) => (s.status === 'closed' ? 'terminal closed' : `shell exited${s.exitCode == null ? '' : ` with code ${s.exitCode}`}`);

  // ── mount / unmount: the panel shows one tab at a time ────────────────────────────────────────────
  /** Shows `tab`: its running shell is attached; a tab with none starts one (D4: the tab was opened to get a shell);
   *  a tab whose shell ended offers Enter, never a new shell on its own. */
  async function mount(tab, kindApi) {
    st.api = kindApi;
    if (st.tabId !== tab.id) { st.note = ''; st.busy = ''; st.ctx = null; st.restartFor = null; drawn.context = ''; }
    st.tabId = tab.id;
    st.member = typeof tab.state.member === 'string' ? tab.state.member : '';
    render();
    await ensureInfo();
    if (st.tabId !== tab.id) return;
    if (!st.enabled) { render(); return; }               // hosted and off: the context line says how to turn it on
    const scope = kindApi.scopeFor(tab);
    if (scope.type === 'run') { await loadRunCtx(scope); if (st.tabId !== tab.id) return; render(); }
    const sid = tab.state.sessionId;
    const s = sid ? st.sessions.get(sid) : null;
    if (s && s.status === 'running') { await attach(s.id); return; }
    if (sid) { detachCurrent(); promptRestart(tab.id, st.why || (s ? endedWhy(s) : 'terminal closed')); render(); return; }
    // A run with no folder (or whose lookup failed) starts nothing: the context line says why, and Enter does nothing.
    const m = scope.type === 'run' ? memberNow() : null;
    if (scope.type === 'run' && (!m || m.state === 'unavailable')) { render(); return; }
    await startTab(tab);
  }
  /** The tab leaves the screen: let go of its shell (it keeps running), so no keystroke reaches it. */
  function unmount() {
    detachCurrent();
    st.tabId = null;
    st.ctx = null;
    st.ctxGen += 1;
    st.restartFor = null;
    render();
  }

  // ── sessions ─────────────────────────────────────────────────────────────────────────────────────
  async function termSize() {
    try { await ensureTerm(); return { cols: st.term.cols, rows: st.term.rows }; } catch { return { cols: 100, rows: 30 }; }
  }
  /** Starts the tab's shell in its scope's folder and binds it to the tab; attached only if the tab is still shown. */
  async function startTab(tab) {
    if (!st.enabled || !st.online || st.starting.has(tab.id)) return;
    st.starting.add(tab.id);
    st.restartFor = null;
    render();
    let r = null;
    try {
      const scope = st.api.scopeFor(tab);
      r = scope.type === 'run' ? await startRun(tab, scope)
        : scope.type === 'chat' ? await startIn(`/api/ask/threads/${encodeURIComponent(scope.id)}/terminal`)
          : await startIn(`/api/projects/${encodeURIComponent(scope.id)}/terminal`);
    } finally {
      st.starting.delete(tab.id);
      st.busy = '';
    }
    if (r) {
      st.sessions.set(r.session.id, r.session);
      if (r.warning) st.warnings.set(r.session.id, r.warning);
      st.api.setTabState(tab.id, { sessionId: r.session.id, ...(r.session.member ? { member: r.session.member } : {}) });
    }
    emitSessions();                                      // held while this start was in flight
    if (st.tabId !== tab.id) { render(); return; }
    if (!r) { promptRestart(tab.id); render(); return; }
    st.note = '';
    await attach(r.session.id);
  }
  async function startIn(url) {
    const size = await termSize();
    return api('POST', url, size).catch(showError);
  }
  async function startRun(tab, scope) {
    const m = memberNow();
    if (!m) { st.note ||= 'This run has no folder.'; return null; }
    if (m.state === 'unavailable') { st.note = m.reason || 'This run has no folder.'; return null; }
    const q = runQuery(scope);
    // A finished run with no checkout: the start makes one server-side. Never POST /checkout for it —
    // that route refuses a member the run did not change, and "No changes in this project" is no answer
    // to "give me a shell". Say what is happening while the folder is made.
    const fresh = m.state === 'needs-checkout';
    if (fresh) { st.busy = 'Making a checkout of this run…'; render(); }
    const size = await termSize();
    const r = await api('POST', `/api/runs/${encodeURIComponent(scope.id)}/terminal?${q}`, { member: m.projectKey, ...size }).catch(showError);
    // That start made a checkout, so the picker's 'needs-checkout' is stale: read the context again.
    if (r && fresh && st.tabId === tab.id) {
      const ctx = await api('GET', `/api/runs/${encodeURIComponent(scope.id)}/terminal?${q}`).catch(() => null);
      if (ctx && st.tabId === tab.id) st.ctx = ctx;
    }
    return r;
  }
  /** A dim line in the terminal; Enter (that keypress only) then starts a new shell for this tab. Never on its own. */
  function promptRestart(tabId, why = st.why) {
    st.why = null;
    if (st.restartFor === tabId) return;
    st.restartFor = tabId;
    const text = why ? `[${why}. Press Enter for a new one]` : '[no shell here. Press Enter to start one]';
    ensureTerm().then((t) => { if (st.restartFor === tabId && st.tabId === tabId) t.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`); }).catch(() => {});
  }
  /** Forgets the attached session: the screen and any half-typed line. */
  function resetCurrent() {
    st.current = null;
    st.replaying = null;
    st.lastSeq = 0;
    st.line = null;
    try { st.term?.reset(); } catch { /* not drawn yet */ }
  }
  function detachCurrent() {
    if (st.current) send({ type: 'term-detach', sessionId: st.current });
    resetCurrent();
  }
  async function attach(id) {
    if (st.current && st.current !== id) send({ type: 'term-detach', sessionId: st.current });
    resetCurrent();
    st.current = id;
    st.restartFor = null;
    const s = st.sessions.get(id);
    st.line = s && s.mode === 'pipes' ? createLineEditor() : null;
    try {
      const term = await ensureTerm();
      term.reset();
      term.options.convertEol = !!(s && s.mode === 'pipes');
    } catch (e) { st.note = `The terminal could not load: ${e.message}`; }
    if (!s || s.status === 'running') send({ type: 'term-attach', sessionId: id });
    render();
    fitNow();                                            // the width may have changed since the session started
  }
  function stopCurrent() {
    if (st.current) api('POST', `/api/terminal/sessions/${encodeURIComponent(st.current)}/stop`).catch(showError);
  }
  /**
   * A tab's × (the panel calls this before it drops the tab): closes that shell. One that has run a command asks first.
   * Resolves false to keep the tab (No, or a failed close, which the context line explains).
   */
  async function close(tab) {
    const id = tab.state.sessionId;
    const x = id ? st.sessions.get(id) : null;
    if (!x || x.status !== 'running') return true;     // never started, or already ended: the tab just leaves
    if (st.closing.has(id)) return false;
    if (x.commands > 0) {
      const name = title(tab);
      const n = x.commands === 1 ? 'A command has' : `${x.commands} commands have`;
      const busy = x.currentBlock ? ` ${x.currentBlock.command} is still running and stops.` : '';
      const ask = { title: 'Close this terminal?', message: `${n} run in ${name}. Closing it ends the shell.${busy}`, confirmLabel: 'Close terminal' };
      const ok = confirm ? await confirm(ask) : win.confirm(`${ask.title}\n${ask.message}`);
      if (!ok) return false;
      if (st.sessions.get(id)?.status !== 'running') return true;
    }
    st.closing.add(id);                                  // a second click while it closes does nothing
    const done = await api('DELETE', `/api/terminal/sessions/${encodeURIComponent(id)}`).catch(showError).finally(() => st.closing.delete(id));
    if (!done) return false;
    const now = st.sessions.get(id);                    // its 'closed' status usually came first
    if (now?.status === 'running') st.sessions.set(id, { ...now, status: 'closed' });
    if (id === st.current) detachCurrent();
    return true;
  }
  function title(tab) {
    const s = tab.state.sessionId ? st.sessions.get(tab.state.sessionId) : null;
    return s?.label || 'Terminal';
  }

  // ── xterm ────────────────────────────────────────────────────────────────────────────────────────
  function themeNow() {
    const cs = win.getComputedStyle(screen);
    const theme = { background: cs.backgroundColor, foreground: cs.color, cursor: cs.color, selectionBackground: win.getComputedStyle(probe).backgroundColor };
    for (const [name, p] of ansiProbes) {
      const c = win.getComputedStyle(p).color;
      if (c) theme[name] = c;                            // unresolved (no stylesheet): xterm keeps its default
    }
    return theme;
  }
  async function ensureTerm() {
    if (st.term) return st.term;
    const { Terminal, FitAddon } = await load();
    const term = new Terminal({ fontFamily: win.getComputedStyle(screen).fontFamily, fontSize: 12, cursorBlink: true, scrollback: 5000, theme: themeNow() });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.onData((d) => onKeys(d));
    st.term = term;
    st.fit = fit;
    fitNow();
    if (typeof win.ResizeObserver === 'function') new win.ResizeObserver(() => fitNow()).observe(host);
    return term;
  }
  let fitTimer = null;
  function fitNow() {
    if (!st.fit || !el.isConnected) return;               // not on screen: FitAddon would measure nothing
    try { st.fit.fit(); } catch { return; }
    win.clearTimeout(fitTimer);
    fitTimer = win.setTimeout(() => {
      if (st.current && st.term) send({ type: 'term-resize', sessionId: st.current, cols: st.term.cols, rows: st.term.rows });
    }, 100);
  }
  const focusTerm = () => { try { st.term?.focus?.(); } catch { /* not drawn */ } };
  function onKeys(data) {
    const s = st.sessions.get(st.current);
    if (!s || s.status !== 'running') {
      // No shell: Enter starts a new one for this tab (and is not sent anywhere); other keys do nothing.
      if (st.restartFor && st.restartFor === st.tabId && st.online && /[\r\n]/.test(data) && !st.starting.has(st.tabId)) {
        const tab = st.api?.tab(st.tabId);
        if (tab) startTab(tab);
      }
      return;
    }
    if (!st.online) return;                              // reconnecting: the banner says keys are not sent
    if (!st.line) { send({ type: 'term-input', sessionId: s.id, data }); return; }
    const r = st.line.feed(data);
    if (r.echo) st.term.write(r.echo);
    if (r.send && !send({ type: 'term-input', sessionId: s.id, data: r.send })) st.term.write('[not sent: reconnecting]\r\n');
    if (r.interrupt) stopCurrent();                      // over pipes Ctrl+C has no tty to reach: the stop API does it
  }

  // ── frames ───────────────────────────────────────────────────────────────────────────────────────
  function onFrame(msg) {
    if (msg.type === 'term-status' && msg.snapshot) {
      const prev = st.sessions.get(msg.snapshot.id);
      st.sessions.set(msg.snapshot.id, msg.snapshot);
      if (msg.snapshot.id === st.current && prev?.status === 'running' && msg.snapshot.status !== 'running' && st.term) {
        // `exit`, a crash or a close: say so, and never start another shell unasked (Enter does).
        const why = endedWhy(msg.snapshot);
        if (st.tabId) { st.restartFor = null; promptRestart(st.tabId, why); } else st.term.write(`\r\n\x1b[2m[${why}]\x1b[0m\r\n`);
      }
      render();
      emitSessions();
      return;
    }
    if (msg.sessionId !== st.current) return;
    if (msg.type === 'term-replay') {
      st.lastSeq = msg.seq || 0;
      if (!st.term) return;
      st.term.reset();
      // The shell wrote this output for its PTY's width: zsh wraps a long line with ` \r\e[K` (on a wider screen that
      // erases the line's start) and pads its partial-line mark to the width. Draw each part at the width it was
      // written at (the server's segments; else the PTY's size now), then fit to the pane: xterm reflows wrapped
      // lines and the fit sends the pane's size to the shell.
      const { cols, rows } = msg.snapshot || {};
      const parts = Array.isArray(msg.segments) && msg.segments.length ? msg.segments : [{ cols, rows, data: msg.data || '' }];
      // xterm parses writes later but resizes at once: each resize waits for the previous part's write, and live
      // frames that arrive meanwhile wait for the whole replay.
      const term = st.term;
      const queue = [];
      st.replaying = queue;
      let resized = false;
      const step = (i) => {
        if (st.replaying !== queue || st.term !== term) return;          // a newer replay or attach took over
        if (i >= parts.length) {
          st.replaying = null;
          for (const d of queue) term.write(d);
          if (resized) fitNow();
          return;
        }
        const p = parts[i];
        if (p.cols > 0 && p.rows > 0 && (p.cols !== term.cols || p.rows !== term.rows)) {
          try { term.resize(p.cols, p.rows); resized = true; } catch { /* not drawn */ }
        }
        term.write(String(p.data ?? ''), () => step(i + 1));
      };
      step(0);
      return;
    }
    if (msg.type === 'term-data') {
      if (msg.seq <= st.lastSeq) return;
      st.lastSeq = msg.seq;
      if (st.replaying) st.replaying.push(msg.data);
      else if (st.term) st.term.write(msg.data);
    }
  }
  function onHello(msg) {
    const restarted = !!(st.bootId && msg.bootId && msg.bootId !== st.bootId);
    st.bootId = msg.bootId || st.bootId;
    const wasOffline = !st.online;
    st.online = true;
    if (restarted) {                                     // the server restarted: its shells are gone, and none respawns
      const had = st.current;
      resetCurrent();
      st.sessions.clear();
      if (had) st.why = 'the worca server restarted';
      if (!st.infoOk) { render(); return; }              // never loaded: the first open loads the list
      st.info = null;
      ensureInfo().then(() => {
        if (!had || st.current || !st.tabId) return;
        st.note = 'The worca server restarted, which closed its terminals. Press Enter in the terminal for a new one.';
        promptRestart(st.tabId);
        render();
      });
      return;
    }
    if (st.current && st.sessions.get(st.current)?.status === 'running') send({ type: 'term-attach', sessionId: st.current });
    if (wasOffline) renderBanners();
    // Frames sent while /ws was down are lost: read the list again, so tabs follow the shells that opened or closed meanwhile.
    if (wasOffline && st.infoOk) { st.info = null; ensureInfo(); }
  }
  /** app.js tells the tool when /ws drops; onHello says it is back. */
  function onConnection(up) {
    if (!!up === st.online) return;
    st.online = !!up;
    renderBanners();
  }

  // ── render ───────────────────────────────────────────────────────────────────────────────────────
  function render() { renderContext(); renderBanners(); }
  /** The amber line of the attached shell: a live run's (while it runs), or what its open returned. */
  function sessionWarning(s) {
    if (s.scope === 'run') return s.status === 'running' && s.runLive ? (st.warnings.get(s.id) || LIVE_WARNING) : null;
    return st.warnings.get(s.id) || null;
  }
  /** What the context line shows, as data: rebuilt only when this changes (an open select stays open). */
  function contextParts() {
    if (!st.enabled) return [['note', 'The terminal is turned off on this hosted deployment. An administrator can enable it with WORCA_TERMINAL_REMOTE=1.']];
    const parts = [];
    if (st.note) parts.push(['error', st.note]);
    if (st.busy) parts.push(['note', st.busy]);
    const s = st.sessions.get(st.current);
    const c = st.ctx;
    const m = c ? memberNow() : null;
    if (c && c.members.length > 1) parts.push(['members', c.members.map((x) => [x.projectKey, x.projectName]), s?.member || st.member]);
    if (m && m.state === 'unavailable' && !s) parts.push(['note', m.reason || 'This run has no folder.']);
    const folder = s?.cwd || m?.cwd || null;
    if (folder) parts.push(['folder', folder]);
    const warn = s ? sessionWarning(s) : m?.warning;
    if (warn) parts.push(['warn', warn]);
    return parts;
  }
  function renderContext() {
    const parts = contextParts();
    const key = JSON.stringify(parts);
    if (key === drawn.context) return;
    drawn.context = key;
    context.replaceChildren();
    for (const [kind, value, chosen] of parts) {
      if (kind === 'members') {
        const sel = make('select', 'term-member');
        sel.setAttribute('aria-label', 'Project');
        for (const [k, name] of value) { const o = make('option', null, name); o.value = k; o.selected = k === chosen; sel.append(o); }
        // Another member: a running shell keeps its own folder, so that member's shell opens in a new tab.
        sel.addEventListener('change', () => {
          const tab = st.api?.tab(st.tabId);
          if (!tab) return;
          const s = st.sessions.get(st.current);
          if (s && s.status === 'running' && s.member !== sel.value) { st.api.openTab('terminal', tab.scope, { member: sel.value }); return; }
          st.member = sel.value;
          st.api.setTabState(tab.id, { member: sel.value });
          if (!st.starting.has(tab.id)) { detachCurrent(); startTab(tab); }
        });
        context.append(sel);
      } else if (kind === 'folder') {
        const f = make('span', 'term-folder', value);
        f.title = value;
        context.append(f);
      } else {
        context.append(make('p', { error: 'term-note term-error', warn: 'term-warn', note: 'term-note' }[kind], value));
      }
    }
  }
  function renderBanners() {
    banners.replaceChildren();
    const s = st.sessions.get(st.current);
    if (!st.online && st.tabId) banners.append(make('p', 'term-warn term-offline', 'Reconnecting to the worca server. Keys typed now are not sent.'));
    el.classList.toggle('term-is-offline', !st.online);
    if (!s) return;
    if (s.mode === 'pipes') banners.append(make('p', 'term-banner', `Full-screen programs (vim, top, less) do not work here: ${st.pty.reason || 'node-pty is not available on this server'}. Commands and Ctrl+C still work.`));
    if (s.folder === 'gone') banners.append(make('p', 'term-banner', 'This folder was removed when the run finished. Type exit, then press Enter for a new terminal on the run.'));
    if (s.folder === 'replaced') banners.append(make('p', 'term-banner', 'This folder was re-created when the run finished. Run cd "$PWD" here, or type exit and press Enter for a new terminal.'));
  }

  // ── global listeners ─────────────────────────────────────────────────────────────────────────────
  const onTheme = () => { if (st.term) st.term.options.theme = themeNow(); };
  doc.addEventListener('worca:theme', onTheme);
  function destroy() {
    st.destroyed = true;
    win.clearTimeout(fitTimer);
    doc.removeEventListener('worca:theme', onTheme);
    try { st.term?.dispose(); } catch { /* already gone */ }
  }

  const kind = Object.freeze({
    kind: 'terminal', label: 'Terminal', icon: 'terminal', order: 10,
    shortcut: Object.freeze({ code: 'Backquote', key: '`', ctrl: true, label: 'Ctrl+`' }),
    unavailable: () => (st.enabled ? null : 'The terminal is turned off on this hosted deployment.'),
    title,
    mount: (tab, hostEl, kindApi) => { hostEl.append(el); return mount(tab, kindApi); },
    unmount: () => unmount(),
    close,
    focus: () => focusTerm(),
  });

  return { el, kind, sessions: () => [...st.sessions.values()], refreshInfo: () => { st.info = refreshInfo(); return st.info; },
    onFrame, onHello, onConnection, destroy };
}
