// src/core/executor/registry.mjs
// The controller's workers: one listener on its own port (never the UI's — the UI port is
// published to people and guarded by host/identity checks; this one is reachable only on the
// container network and authenticated by a one-time token), a map of scope -> worker session,
// and the lifecycle around a backend that starts and removes worker containers.
//
//   acquire(scope)  -> the scope's ready session, or: mint a token, backend.start(), wait for
//                      the worker's hello on this listener, then the session
//   release(scope)  -> shutdown frame, wait for bye/close, backend.remove()
//   reapAtBoot()    -> every worker the backend still knows is a previous controller's: removed
//                      (its token died with that process; a single-replica controller owns all)
//
// A scope may have more than one worker: one per worker CLASS, which is the backend's answer to "what runs
// this engine" (its image). One image serving every engine is one worker; a run whose helper jobs use another
// engine than its agents gets a second one. release(scope) ends them all.
//
// A backend: { start({ scope, scopeKey, workerId, token, controllerUrl, env, idleMs, engine, signal }) -> handle,
//              remove(handle, { reason }), listWorkers() -> handle[], describe() -> object,
//              classFor?(engine) -> string (default: the engine name) }.
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { decodeFrame, encodeFrame, PROTOCOL_VERSION, WORKER_WS_PATH, WS_MAX_PAYLOAD } from './protocol.mjs';

export { WORKER_WS_PATH };
import { createWorkerSession } from './session.mjs';
import { normalizeScope, scopeKey } from './scope.mjs';
import { startFailure, abortError, sleep, envInt as sharedEnvInt } from './shared.mjs';

export const DEFAULT_WORKER_PORT = 4319;
const HELLO_TIMEOUT_MS = 10_000;
const SWEEP_MS = 30_000;
/** How long an acquire waits for a leaving worker's socket to close before it looks again (an abort ends it sooner). */
const LEAVE_WAIT_MS = 10_000;
/** An idle worker whose last touch is this recent was just handed out by acquire (its exec follows a few ticks later). */
const CLAIM_GRACE_MS = 5_000;
const WAIT_POLL_MS = 2_000;
const CAP_WAIT_MS = 10 * 60_000;

const envInt = (name, def) => sharedEnvInt(process.env, name, def);



export function createWorkerRegistry({
  backend,
  host = process.env.WORCA_WORKER_HOST || '0.0.0.0',
  port = envInt('WORCA_WORKER_PORT', DEFAULT_WORKER_PORT),
  controllerUrl = process.env.WORCA_CONTROLLER_URL || null,
  maxWorkers = envInt('WORCA_WORKER_MAX', 20),
  startTimeoutMs = envInt('WORCA_WORKER_START_TIMEOUT_MS', 120_000),
  outerStartMs = envInt('WORCA_WORKER_START_OUTER_MS', 10 * 60_000),   // the backend must have produced a container by then (image pulls included)
  chatIdleMs = envInt('WORCA_WORKER_CHAT_IDLE_MS', 15 * 60_000),
  helperIdleMs = envInt('WORCA_WORKER_HELPER_IDLE_MS', 2 * 60_000),   // a run's worker for another engine than the run's own
  tokenTtlMs = null,        // how long a worker has to present its token once its container exists; default: startTimeoutMs
  capWaitMs = envInt('WORCA_WORKER_CAP_WAIT_MS', CAP_WAIT_MS),
  capPollMs = WAIT_POLL_MS,
  claimGraceMs = CLAIM_GRACE_MS,   // an idle worker touched this recently was just handed to a spawn: not evictable
  version = null,           // this controller's worca version: a worker that reports another one is named in the log
  onEnded = null,           // (scope, { reason }) after a worker is gone, released or lost: the controller reclaims what it wrote (a refreshed login)
  probeMs = 3_000,          // while waiting for a worker's hello: how often the backend is asked whether it died
  pingMs = undefined,
  bootId = `ctl-${randomUUID()}`,
  log = (msg) => console.log(`[worca-workers] ${msg}`),
  onRelay = null,
} = {}) {
  if (!backend) throw new Error('createWorkerRegistry: a backend is required');
  const entries = new Map();   // `${scopeKey}|${class}` -> { scope, key, ek, engine, state:'starting'|'ready'|'closing', workerId, token, handle, session, waiters:[], startedAt, idleMs, timer, ctl, abandoned }
  const tokens = new Map();    // token -> { key, ek, workerId, armedAt, used }
  const scopeEntries = (key) => [...entries.values()].filter((e) => e.key === key);
  const releases = new Map();   // scopeKey -> how many times it was released while an acquire for it was in flight: the acquire compares before and after its await
  let sweeping = false;
  const classes = new Map();    // engine -> its worker class (the image): fixed for the registry's life, looked up once
  const acquiring = new Map();  // scopeKey -> acquires in flight (the only readers of `releases`: the entry goes when the last one ends)
  /** What tells a scope's workers apart: the backend's class for the engine (its image), else the engine name. */
  const classOf = async (engine) => {
    // Looked up once per engine name: the class is the image, fixed for this registry's life. No engine named (a
    // script node outside any engine's scope) reads the install's default each time, which may change in Settings.
    if (engine && classes.has(engine)) return classes.get(engine);
    let c = null;
    try { c = await backend.classFor?.(engine); } catch { /* the engine name will do */ }
    const out = c ? String(c) : String(engine || 'default');
    if (engine) classes.set(engine, out);
    return out;
  };
  let server = null;
  let wss = null;
  let boundPort = port;
  let sweeper = null;
  let closing = false;

  const mintToken = (key, ek, workerId) => {
    const token = randomBytes(32).toString('base64url');
    tokens.set(token, { key, ek, workerId, armedAt: null, used: false });
    return token;
  };
  const tokenOf = (req) => {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    return m ? m[1] : null;
  };
  // A token lives as long as the start it belongs to: while the backend is still bringing the container up (an image
  // pull, a Pending pod — minutes on a cold node) it cannot expire, and once the container exists (`armedAt`) the
  // worker has as long to present it as the registry waits for its hello (startTimeoutMs, so raising that timeout
  // really gives a slow worker longer). A start that ended, either way, takes its token with it.
  const tokenDead = (t) => {
    const e = entries.get(t.ek);
    return t.used || !e || e.state !== 'starting' || (t.armedAt != null && Date.now() - t.armedAt > (tokenTtlMs ?? startTimeoutMs));
  };
  const usableToken = (token) => {
    const t = tokens.get(token);
    if (!t) return null;
    if (tokenDead(t)) { tokens.delete(token); return null; }
    return t;
  };
  const sweepTokens = () => { for (const [k, t] of tokens) if (tokenDead(t)) tokens.delete(k); };

  /** The URL a worker is told to connect to: the operator's (a service name), else this listener. */
  const urlForWorkers = () => {
    if (controllerUrl) return controllerUrl;
    const h = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    return `ws://${h.includes(':') && !h.startsWith('[') ? `[${h}]` : h}:${boundPort}`;   // an IPv6 literal is bracketed in a URL
  };

  function admit(ws, req) {
    // From the first moment: a WebSocket-level error (a malformed or oversize frame before the hello, or after a
    // refusal) is an 'error' event, and one with no listener is an uncaught exception in the controller.
    ws.on('error', () => { try { ws.terminate(); } catch { /* gone */ } });
    const token = tokenOf(req);
    const t = token ? usableToken(token) : null;
    if (!t) { ws.close(4001, 'unknown token'); return; }
    const entry = entries.get(t.ek);
    if (!entry || entry.state !== 'starting') { ws.close(4001, 'no worker expected'); return; }
    const timer = setTimeout(() => { ws.close(4003, 'no hello'); }, HELLO_TIMEOUT_MS);
    ws.once('message', (data) => {
      clearTimeout(timer);
      const hello = decodeFrame(data);
      if (!hello || hello.type !== 'hello') { ws.close(4002, 'hello expected'); return; }
      if (hello.apiVersion !== PROTOCOL_VERSION) { ws.send(encodeFrame({ type: 'refuse', reason: `protocol ${hello.apiVersion} is not ${PROTOCOL_VERSION}` })); ws.close(4004, 'protocol'); return; }
      if (scopeKey(hello.scope) !== t.key || hello.workerId !== t.workerId) { ws.send(encodeFrame({ type: 'refuse', reason: 'scope or worker id does not match the token' })); ws.close(4001, 'scope mismatch'); return; }
      // Re-checked now, not only at the upgrade: a release or a stop in between must not be undone by a late hello.
      if (entries.get(t.ek) !== entry || entry.state !== 'starting') { ws.send(encodeFrame({ type: 'refuse', reason: 'this worker is no longer expected' })); ws.close(4001, 'no worker expected'); return; }
      t.used = true;
      tokens.delete(token);
      const session = createWorkerSession(ws, { workerId: hello.workerId, scope: hello.scope, capabilities: hello.capabilities, pid: hello.pid, pingMs, log, onRelay });
      // The controller composes each spawn (flags, hook paths, frame fields) for ITS version; a worker image pulled
      // once under a moving tag executes them with whatever it has. Not refused (the protocol matches), but said.
      const theirs = hello.capabilities?.worca;
      if (version && theirs && String(theirs) !== String(version)) log(`worker ${hello.workerId} runs worca ${theirs}, this controller ${version}: pull the worker image for this version (worca container pull)`);
      try { ws.send(encodeFrame({ type: 'welcome', controllerBootId: bootId, pingMs: pingMs ?? 30_000, idleMs: entry.idleMs ?? null })); }
      catch (err) {
        // The token is spent and the worker cannot try again: the start fails now, not after the whole start timeout.
        log(`worker ${hello.workerId}: the welcome could not be sent (${err?.message || err})`);
        try { ws.close(1011, 'welcome failed'); } catch { /* gone */ }
        fail(entry, startFailure(`worker ${hello.workerId} for ${t.key}: the welcome could not be sent (${err?.message || err})`));
        return;
      }
      entry.session = session;
      entry.state = 'ready';
      clearTimeout(entry.timer); clearTimeout(entry.outerTimer); clearInterval(entry.probeTimer);
      session.onClose((reason, { hadExecs = false } = {}) => {
        if (entries.get(t.ek) !== entry) return;
        entries.delete(t.ek);
        if (entry.state !== 'closing') {
          // `bye` with nothing running: the worker idled out by itself (its own timer is the backstop of this
          // registry's sweep) — a leave, not a loss.
          const left = reason === 'bye' && !hadExecs;
          log(left ? `worker ${entry.workerId} for ${t.key} left: idle` : `worker ${entry.workerId} for ${t.key} is gone: ${reason}`);
          entry.abandoned = true;   // a handle the backend has not handed over yet is removed when it arrives (begin)
          if (entry.handle) backend.remove(entry.handle, { reason: left ? 'idle' : `lost: ${reason}` }).catch(() => {});
          ended(entry, left ? 'idle' : `lost: ${reason}`);
        }
      });
      const waiters = entry.waiters; entry.waiters = [];
      for (const w of waiters) w.resolve(session);
    });
  }

  /** A start that will not be used (it failed, timed out, or nobody waits for it any more): forget the entry
   *  and remove its container, now or when the backend hands it over. */
  function abandon(entry, reason) {
    entry.abandoned = true;
    clearTimeout(entry.timer); clearTimeout(entry.outerTimer); clearInterval(entry.probeTimer);
    if (entries.get(entry.ek) === entry) entries.delete(entry.ek);
    if (entry.token) tokens.delete(entry.token);
    try { entry.ctl.abort(); } catch { /* nothing listening */ }
    if (entry.handle) backend.remove(entry.handle, { reason }).catch(() => {});
  }
  /** Every caller waiting on this start gets `err`; the start is abandoned. */
  function fail(entry, err) {
    const ws = entry.waiters; entry.waiters = [];
    abandon(entry, 'did not connect');
    for (const w of ws) w.reject(err);
  }

  /**
   * Begin starting a worker: the entry exists at once (so concurrent callers wait on it), the backend starts the
   * container in the background, and the hello on the listener resolves the waiters. A backend failure or a
   * worker that never connects rejects ALL of them. Nothing here depends on one caller's abort signal.
   */
  function begin(scope, key, ek, engine, helper = false) {
    const workerId = `w-${scope.kind}-${randomBytes(4).toString('hex')}`;
    const entry = { scope, key, ek, engine, state: 'starting', workerId, token: null, handle: null, session: null, waiters: [], startedAt: Date.now(),
      // A chat's worker leaves when the thread goes quiet. A run's own worker stays for the run; one it started for
      // another engine's IMAGE (a title on Claude in a Codex run, one step on a second engine) leaves when idle and
      // comes back on demand: it would otherwise hold a container's memory and CPU reservation until the run ends.
      // With one image for every engine there is one worker, and it is the run's own whichever spawn started it.
      idleMs: scope.kind === 'chat' ? chatIdleMs : (helper ? helperIdleMs : null), timer: null, probeTimer: null, ctl: new AbortController(), abandoned: false };
    entries.set(ek, entry);
    entry.token = mintToken(key, ek, workerId);
    // The start timeout proper counts from the container's existence (below). A backend whose start never comes back
    // (a hung Engine, a pod with no deadline) would leave a caller without a signal waiting for good: an outer deadline.
    entry.outerTimer = setTimeout(() => { if (entry.state === 'starting' && !entry.abandoned) fail(entry, startFailure(`worker ${workerId} for ${key}: the backend did not start a container within ${Math.round(outerStartMs / 1000)} s`)); }, outerStartMs);
    entry.outerTimer.unref?.();
    Promise.resolve()
      .then(() => backend.start({ scope, scopeKey: key, workerId, token: entry.token, controllerUrl: urlForWorkers(), idleMs: entry.idleMs, engine, env: {}, signal: entry.ctl.signal,
        connected: () => entry.state === 'ready' }))   // the backend's own wait may lose track of a container whose worker is already here
      .then((handle) => {
        entry.handle = handle;
        if (entry.abandoned || entry.state === 'closing') { backend.remove(handle, { reason: 'start abandoned' }).catch(() => {}); return; }
        const t = tokens.get(entry.token);
        if (t) t.armedAt = Date.now();   // the container exists: from now the token's time to live counts
        // A worker that exits before it connects (a bad assignment: exit 78, an unwritable volume, a controller URL
        // it cannot reach) would otherwise cost the whole start timeout and leave no reason behind.
        if (typeof backend.probe === 'function' && entry.state === 'starting') {
          let probing = false;   // one probe at a time: a slow Engine must not have them stack up for the whole start window
          entry.probeTimer = setInterval(() => {
            if (probing) return;
            probing = true;
            Promise.resolve().then(() => backend.probe(handle)).then((why) => {
              if (why && entry.state === 'starting' && !entry.abandoned) fail(entry, startFailure(`worker ${workerId} for ${key} will not connect: ${why}`));
            }, () => { /* the backend could not say: the start timeout still stands */ }).finally(() => { probing = false; });
          }, probeMs);
          entry.probeTimer.unref?.();
        }
        if (entry.state === 'starting') entry.timer = setTimeout(() => fail(entry, startFailure(`worker ${workerId} for ${key} did not connect within ${Math.round(startTimeoutMs / 1000)} s`)), startTimeoutMs);
      }, (err) => {
        if (entry.abandoned) return;
        // The worker connected while its backend was still waiting for the container: the session is live and stays.
        // Its container is then only known to boot maintenance (the backend handed no handle over).
        if (entry.state === 'ready') { log(`worker ${workerId} for ${key} is connected; its start reported late: ${err?.message || err}`); return; }
        fail(entry, startFailure(`cannot start a worker for ${key}: ${err?.message || err}`));
      });
    return entry;
  }

  /** Wait for a starting entry's session. The caller's abort ends its own wait at once (an AbortError); when it was
   *  the last one waiting, the start itself is abandoned. */
  function waitFor(entry, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); if (entry.state === 'starting' && !entry.waiters.length) abandon(entry, 'aborted'); return; }
      const off = () => signal?.removeEventListener('abort', onAbort);
      const w = { resolve: (s) => { off(); resolve(s); }, reject: (e) => { off(); reject(e); } };
      function onAbort() {
        const i = entry.waiters.indexOf(w);
        if (i >= 0) entry.waiters.splice(i, 1);
        reject(abortError());
        if (entry.state === 'starting' && !entry.waiters.length) abandon(entry, 'aborted');
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.waiters.push(w);
    });
  }

  /** End one worker: shutdown frame, then the backend removes it. */
  async function releaseEntry(entry, { reason = 'released', graceMs = 5000 } = {}) {
    // Once only: the sweep, a cap eviction and a scope's release can meet on one entry; the later callers await the first.
    if (entry.releasing) return entry.releasing;
    entry.releasing = releaseEntryOnce(entry, { reason, graceMs });
    return entry.releasing;
  }
  async function releaseEntryOnce(entry, { reason, graceMs }) {
    entry.state = 'closing';
    clearTimeout(entry.timer); clearTimeout(entry.outerTimer); clearInterval(entry.probeTimer);
    if (!entry.session) { try { entry.ctl.abort(); } catch { /* nothing listening */ } }   // still starting: stop the backend's wait
    if (entries.get(entry.ek) === entry) entries.delete(entry.ek);
    if (entry.token) tokens.delete(entry.token);
    const ws = entry.waiters; entry.waiters = [];
    for (const w of ws) w.reject(startFailure(`worker for ${entry.key} released before it connected (${reason})`));
    if (entry.session && !entry.session.closed) await entry.session.shutdown({ graceMs });
    if (entry.handle) await backend.remove(entry.handle, { reason }).catch((err) => log(`remove ${entry.workerId}: ${err?.message || err}`));
    if (entry.session) ended(entry, reason);   // one that never connected wrote nothing
  }
  /** After a connected worker is gone: the controller's hook, once per entry, never throwing into the release. */
  function ended(entry, reason) {
    if (!onEnded || entry.ended) return;
    entry.ended = true;
    try { onEnded(entry.scope, { reason }); } catch (err) { log(`after worker ${entry.workerId}: ${err?.message || err}`); }
  }

  const registry = {
    get port() { return boundPort; },
    get bootId() { return bootId; },
    get controllerUrl() { return urlForWorkers(); },

    async listen() {
      server = http.createServer((_req, res) => { res.statusCode = 404; res.end(); });
      wss = new WebSocketServer({
        server, path: WORKER_WS_PATH, maxPayload: WS_MAX_PAYLOAD,
        verifyClient: (info, done) => { const token = tokenOf(info.req); done(!!(token && usableToken(token)), 401); },
      });
      wss.on('error', () => {});
      wss.on('connection', admit);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          server.on('error', (err) => log(`worker listener error: ${err?.message || err}`));   // never an uncaught exception for the controller
          boundPort = server.address().port; resolve();
        });
      });
      sweeper = setInterval(() => { if (!sweeping) registry.sweep().catch(() => {}); }, SWEEP_MS);   // one sweep at a time: a slow one never overlaps the next tick
      sweeper.unref?.();
      return boundPort;
    },

    /**
     * The worker session a spawn of `engine` in this scope runs on: the live one, or a freshly started one.
     * `engine` (else the scope's own) picks the worker class; with neither, any worker the scope has will do.
     */
    async acquire(scope, opts = {}) {
      const s = normalizeScope(scope);
      if (!s) throw new Error('acquire: a run or chat scope is required');
      const key = scopeKey(s);
      acquiring.set(key, (acquiring.get(key) || 0) + 1);
      try { return await registry._acquire(s, key, opts); }
      finally {
        const n = (acquiring.get(key) || 1) - 1;
        if (n > 0) acquiring.set(key, n); else { acquiring.delete(key); releases.delete(key); }
      }
    },
    async _acquire(s, key, { signal, engine = null } = {}) {
      const want = (typeof engine === 'string' && engine.trim()) || s.engine || null;
      const epoch = releases.get(key) || 0;
      let waitingSince = null;
      for (;;) {
        if (signal?.aborted) throw abortError();
        if (closing) throw startFailure('the server is shutting down');
        // A worker of the scope that is not on its way out, else one that is (its close is awaited below).
        let entry = want ? null : (scopeEntries(key).find((e) => !(e.state === 'ready' && e.session.leaving)) || scopeEntries(key)[0] || null);
        // One await for both lookups: every await here is a window a release must be checked after.
        const ownEngine = s.kind === 'run' && s.engine && want && want !== s.engine ? s.engine : null;
        const [wantClass, ownClass] = entry ? [null, null] : await Promise.all([classOf(want), ownEngine ? classOf(ownEngine) : null]);
        const ek = entry ? entry.ek : `${key}|${wantClass}`;
        const helper = !entry && !!ownEngine && wantClass !== ownClass;
        // Asked again after the await: a stop, a shutdown or the scope's release may have happened meanwhile, and a
        // worker begun now would belong to nobody (a run's has no idle timeout: it would hold a slot until the next boot).
        if (signal?.aborted) throw abortError();
        if (closing) throw startFailure('the server is shutting down');
        if ((releases.get(key) || 0) !== epoch) throw startFailure(`the worker for ${key} was released while this spawn was starting`);
        entry ||= entries.get(ek) || null;
        // A worker on its way out (it idled out by itself and said bye; its close is not yet processed) takes no more
        // work: wait for the close, then start afresh.
        if (entry?.state === 'ready' && entry.session.leaving) {
          let off = null;
          await Promise.race([new Promise((r) => { off = entry.session.onClose(r); }), sleep(LEAVE_WAIT_MS, signal)]);
          off?.();   // the wait is over either way: no listener left behind on a socket that closes later
          continue;
        }
        if (entry?.state === 'ready') { entry.session.touch(); return entry.session; }
        if (entry?.state === 'starting') return waitFor(entry, signal);
        // The cap bounds how many scopes hold workers. A scope that already holds one never waits for its second
        // (a helper job on another engine's image): every such wait holds a slot, and a few of them deadlock.
        if (entries.size < maxWorkers || scopeEntries(key).length) return waitFor(begin(s, key, ek, want, helper), signal);
        // Full. A chat worker with nothing running gives way (its thread gets a fresh one on its next turn)…
        const idle = [...entries.values()].filter((e) => e.state === 'ready' && e.idleMs != null && e.session.liveExecCount === 0 && Date.now() - e.session.lastActiveAt > claimGraceMs)
          .sort((a, b) => a.session.lastActiveAt - b.session.lastActiveAt)[0];
        if (idle) { log(`worker cap (${maxWorkers}) reached: releasing idle ${idle.key} for ${key}`); await releaseEntry(idle, { reason: 'evicted: worker cap' }); continue; }
        // …else this waits, says so once, and gives up as a start failure (the run pauses or retries) rather than hang.
        if (waitingSince == null) { waitingSince = Date.now(); log(`${key} waits for a free worker: all ${maxWorkers} (WORCA_WORKER_MAX) are in use`); }
        if (Date.now() - waitingSince > capWaitMs) throw startFailure(`no free worker for ${key} after ${Math.round(capWaitMs / 1000)} s: all ${maxWorkers} (WORCA_WORKER_MAX) are in use`);
        await sleep(capPollMs, signal);
      }
    },

    /** End the scope's workers (no-op when there is none). */
    async release(scope, { reason = 'released', graceMs = 5000 } = {}) {
      const key = scopeKey(scope);
      if (key && acquiring.has(key)) releases.set(key, (releases.get(key) || 0) + 1);   // an acquire in flight for this scope must not start a worker now
      const mine = key ? scopeEntries(key) : [];
      if (!mine.length) return false;
      await Promise.all(mine.map((entry) => releaseEntry(entry, { reason, graceMs })));
      return true;
    },

    touch(scope) { for (const e of scopeEntries(scopeKey(scope) ?? '')) e.session?.touch(); },

    /** Idle chat workers are released; stale tokens are dropped. */
    async sweep() {
      if (sweeping) return;
      sweeping = true;
      try { await registry._sweep(); } finally { sweeping = false; }
    },
    async _sweep() {
      sweepTokens();
      const now = Date.now();
      // The idle ones go together (a serial sweep of many would outlast the next tick), and only those still here: one
      // whose worker left or was lost meanwhile has been removed by its close already.
      const idle = [...entries.values()].filter((entry) => entry.state === 'ready' && entry.idleMs != null
        && entry.session.liveExecCount === 0 && now - entry.session.lastActiveAt > entry.idleMs);
      await Promise.all(idle.map((entry) => (entries.get(entry.ek) === entry && !entry.session.closed ? releaseEntry(entry, { reason: 'idle' }) : null)));
    },

    /** Remove every worker the backend still knows about: with one controller, all are orphans. */
    async reapAtBoot() {
      let handles = [];
      try { handles = await backend.listWorkers(); } catch (err) { log(`cannot list workers: ${err?.message || err}`); return { removed: 0 }; }
      let removed = 0;
      // Maintenance runs while the server already serves: a worker THIS controller started a moment ago is not an orphan.
      handles = handles.filter((h) => !(h?.own === true || (h?.bootId && h.bootId === bootId)));
      for (const h of handles) { try { await backend.remove(h, { reason: 'orphan at boot' }); removed += 1; } catch (err) { log(`cannot remove ${h?.workerId || h?.id || 'a worker'}: ${err?.message || err}`); } }
      if (removed) log(`removed ${removed} orphan worker(s) from a previous controller`);
      return { removed };
    },

    async closeAll(reason = 'shutdown') {
      closing = true;
      clearInterval(sweeper);
      await Promise.all([...entries.values()].map((e) => releaseEntry(e, { reason })));
      await new Promise((resolve) => {
        if (!server) return resolve();
        wss?.clients.forEach((c) => { try { c.terminate(); } catch { /* gone */ } });
        wss?.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      server = null; wss = null;
    },

    snapshot() {
      return [...entries.values()].map((e) => ({
        scope: e.scope, engine: e.engine || null, workerId: e.workerId, state: e.state, since: e.startedAt,
        liveExecs: e.session?.liveExecCount ?? 0, engines: e.session ? Object.keys(e.session.capabilities?.engines || {}).filter((k) => e.session.capabilities.engines[k]) : [],
      }));
    },

    describe() { return { backend: backend.describe?.() ?? null, port: boundPort, workers: entries.size, maxWorkers }; },
    /** The backend's login seed folder in this process's filesystem, or null (executor/index.mjs reclaimWorkerLogin). */
    loginSeedDir() { return backend.loginSeedDir?.() ?? null; },
  };
  return registry;
}
