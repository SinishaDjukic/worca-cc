// src/core/exec-env/model-relay.mjs
// Worca's half of the model relay (plans/model-relay-design.md §3, §5): starts sandbox-relay.mjs in the
// sandbox with stdin open, reads its request frames, and does all the deciding — route, method and path,
// size, concurrency, header allowlist — then adds the route's credential on this side, forwards to the
// route's one upstream (no redirects) and streams the reply back as frames via sendStdin, scrubbed of every
// route's credential.
import { randomBytes } from 'node:crypto';
import { shq } from './shell.mjs';
import { upstreamRequestHeaders, agentResponseHeaders, MAX_REQUEST_BYTES, UPSTREAM_IDLE_MS, CLIENT_DRAIN_MS } from '../../broker/service.mjs';
import { scrubText, createByteScrubber, createConnectScrubber, connectReplyProblem, isConnectStream, CONNECT_IDENTITY } from '../../broker/scrub.mjs';
import { CONNECT_CODES } from '../../broker/cursor.mjs';
import { pathIssue } from '../../broker/slots.mjs';
import { requestWithUsage } from '../../broker/usage.mjs';
/** The byte-stream scrubber lives in src/broker/scrub.mjs (the broker scrubs Cursor replies the same way). */
export { createByteScrubber } from '../../broker/scrub.mjs';

const READY_TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY = 64 << 10;
// One request frame is at most the base64 body plus method, path and headers (Node's HTTP server caps those at
// 16 KiB, at most doubled by JSON escaping); a longer line means the relay misbehaves.
export const MAX_LINE = Math.ceil(MAX_REQUEST_BYTES / 3) * 4 + (64 << 10);
// Request bodies a relay holds while their calls run. Per sandbox: two bodies of the largest size, or dozens of real
// ones (Claude Code's largest measured was 443 KB); past it a call gets 429. Across all sandboxes of this worca
// process: past it a call gets 529. Claude Code retries both.
const MAX_INFLIGHT_BYTES = 2 * MAX_REQUEST_BYTES;
const MAX_TOTAL_INFLIGHT_BYTES = 8 * MAX_REQUEST_BYTES;
// A route without its own `allow` (a Claude route): the Messages API only.
const CLAUDE_ALLOW = Object.freeze([['POST', '/v1/messages'], ['POST', '/v1/messages/count_tokens']]);
const NO_BODY = new Set(['GET', 'HEAD']);
const SAFE_QUERY = /^[A-Za-z0-9_=&.-]*$/;
const SEND_BATCH = 1 << 20;            // one sendStdin carries at most this many chars (a longer frame goes alone)
const SEND_HIGH_WATER = 16 << 20;      // past this many queued chars, an upstream read waits for the queue to drain
const MIN_SECRET = 8;                  // as scrubText: a shorter value is no secret worth matching
const secretValues = (secrets) => [...new Set((secrets || []).map((s) => String(s || '')).filter((s) => s.length >= MIN_SECRET))];

/** The first key of `env` whose value holds one of `secrets` (under any name), or null. */
export function leakedSecret(env, secrets) {
  const values = secretValues(secrets);
  for (const [k, v] of Object.entries(env || {})) if (typeof v === 'string' && values.some((s) => v.includes(s))) return k;
  return null;
}

/** Response headers minus any whose value holds a secret: the allowlist decides the names, this the values. */
const cleanHeaders = (headers, secrets) => {
  const values = secretValues(secrets);
  return Object.fromEntries(Object.entries(headers).filter(([, v]) => !values.some((s) => String(v).includes(s))));
};

/** Bytes in flight against `limit`, shared by the relays that hold it. */
export const createByteBudget = (limit) => ({ limit, used: 0 });
const TOTAL_BUDGET = createByteBudget(MAX_TOTAL_INFLIGHT_BYTES);
const mib = (n) => Math.round(n / (1 << 20));
/** The decoded size of base64 text, known before decoding it. */
const b64Bytes = (s) => Math.max(0, Math.floor(s.length * 3 / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0));

const relayError = (status, type, message) => ({ status, type, message });
/** google.rpc status names for the HTTP statuses the relay refuses with. */
const GOOGLE_STATUS = Object.freeze({ 400: 'INVALID_ARGUMENT', 403: 'PERMISSION_DENIED', 413: 'INVALID_ARGUMENT', 429: 'RESOURCE_EXHAUSTED',
  502: 'UNAVAILABLE', 504: 'DEADLINE_EXCEEDED', 529: 'UNAVAILABLE' });
const lowerKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));
/** Whether `route` takes `method pathname`: its `allow` list of [method, exact path | RegExp] (CLAUDE_ALLOW without one). */
const allows = (route, method, pathname) => (route.allow || CLAUDE_ALLOW)
  .some(([m, p]) => m === method && (p instanceof RegExp ? p.test(pathname) : p === pathname));
/** A refusal body in the shape the route's client reads: Anthropic's (the default), OpenAI's, Google's or Connect's. */
function refusalBody(protocol, { status, type, message }) {
  const msg = `worca-relay: ${message}`;
  if (protocol === 'openai') return { error: { message: msg, type, code: null } };
  if (protocol === 'gemini') return { error: { code: status, message: msg, status: GOOGLE_STATUS[status] || 'UNKNOWN' } };
  if (protocol === 'connect') return { code: CONNECT_CODES[status] || 'unknown', message: msg };
  return { type: 'error', error: { type, message: msg } };
}

export class ModelRelay {
  /** `onDrop()`: a ready relay ended without stop() (it exited, its command stream dropped, a write to it failed or it
   *  sent a frame too long): the env restarts it at once, so a running step's model calls do not hang (remote-env.mjs).
   *  `maxInflightBytes`: this relay's budget of request bodies held at once; `budget`: the one all relays share.
   *  `clientDrainMs`: how long a reply may wait for the sandbox to take its frames before the call counts as hung up. */
  constructor({ log = () => {}, fetchImpl = globalThis.fetch, maxConcurrentPerRoute = 16, upstreamIdleMs = UPSTREAM_IDLE_MS, onDrop = null,
    sendBatch = SEND_BATCH, sendHighWater = SEND_HIGH_WATER, maxInflightBytes = MAX_INFLIGHT_BYTES, budget = TOTAL_BUDGET,
    clientDrainMs = CLIENT_DRAIN_MS } = {}) {
    this.log = log; this.fetchImpl = fetchImpl; this.maxConcurrent = maxConcurrentPerRoute; this.idleMs = upstreamIdleMs; this.onDrop = onDrop;
    this.clientDrainMs = clientDrainMs;
    this.sendBatch = sendBatch; this.sendHighWater = sendHighWater;
    this.maxBytes = maxInflightBytes; this.budget = budget; this._bytes = 0;   // body bytes of this relay's calls in flight
    this.routes = new Map();     // route id -> { route, active, idle }; kept when the relay restarts
    // Every credential any route of this relay attaches, also of routes since removed or rotated away: a reply on one
    // route is scrubbed of all of them, so an upstream echoing another route's key never brings it into the sandbox.
    this.secrets = new Set();
    this.inflight = new Map();   // frame id -> { detach() } for the current relay process
    // _buf: the pieces of the stdout line not yet complete, _bufLen chars in all.
    this.handle = null; this.port = null; this._alive = false; this._stopped = false; this._buf = []; this._bufLen = 0; this._gen = 0;
    // Reply frames of the current relay process, written in order, one sendStdin at a time (_pump).
    this._queue = []; this._queued = 0; this._writing = false; this._waiters = [];
  }

  get alive() { return this._alive; }

  /** A route can be added once the relay has a port: also while a dead relay waits for its restart on that port. */
  get _usable() { return this._alive || (this.port != null && !this._stopped); }

  /** The base URL of a registered route, or null. A restart on the remembered port keeps it valid. */
  baseUrlFor(id) { return this._usable && this.routes.has(id) ? `http://127.0.0.1:${this.port}/r/${id}` : null; }

  /** `port` 0 picks a free one; a restart passes the remembered port, because spawn envs already name it. A port
   *  that cannot be bound fails the start: there is no fallback to another one. */
  async start({ client, box, scriptPath, port = 0 }) {
    if (this.handle) throw new Error('the model relay is already started');
    this._stopped = false;
    let ready; let fail;
    const readyP = new Promise((res, rej) => { ready = res; fail = rej; });
    const gen = ++this._gen; this._buf = []; this._bufLen = 0; this._dupLogged = false;
    this._onReady = (port) => { this.port = port; this._alive = true; ready(); };
    // timeoutMs 0: no command deadline (E2B's commands.run defaults to 60 s); the relay lives as long as the sandbox.
    const handle = await client.run(box, `node ${shq(scriptPath)} ${MAX_REQUEST_BYTES} ${Number(port) || 0}`, {
      background: true, stdin: true, timeoutMs: 0,
      onStdout: (d) => { if (gen === this._gen) this._onStdout(d); },
      onStderr: (d) => { if (gen === this._gen) this.log('warn', `model relay: ${String(d).trim().slice(0, 300)}`); },
    });
    if (this._stopped) {   // stop() ran while the command started: it must not outlive the stop
      try { await handle.kill(); } catch { /* already gone */ }
      throw new Error('the model relay was stopped while it started');
    }
    this.handle = handle;
    Promise.resolve().then(() => handle.wait()).catch(() => {}).finally(() => {
      if (this.handle !== handle) return;
      const wasAlive = this._alive;
      if (wasAlive) this.log('warn', 'model relay: the relay in the sandbox stopped');
      this._drop();
      fail(new Error('the model relay exited before it was ready'));
      if (wasAlive) this._dropped();
    });
    const timer = setTimeout(() => fail(new Error(`the model relay did not start within ${READY_TIMEOUT_MS / 1000} s`)), READY_TIMEOUT_MS);
    try { await readyP; } catch (err) { await this._kill(); throw err; } finally { clearTimeout(timer); }
  }

  addRoute(route) {
    if (!this._usable) throw new Error('the model relay is not running');
    const id = randomBytes(32).toString('base64url');
    this.routes.set(id, { route, active: 0, idle: [] });
    for (const s of route.secrets || []) this.secrets.add(s);
    return { id, baseUrl: this.baseUrlFor(id) };
  }

  /** Take route `id` out: no new call reaches it. Resolves once the calls it still has in flight have ended (each one's
   *  usage is in its meter by then), at once when it has none. */
  removeRoute(id) {
    const entry = this.routes.get(id);
    this.routes.delete(id);
    return entry?.active ? new Promise((r) => entry.idle.push(r)) : Promise.resolve();
  }
  /** Stop new calls on route `id` and resolve once its in-flight calls have ended (each has committed its usage to the
   *  route's meter), or after `ms`. A drained route refuses new calls as ended; removeRoute still deletes it. */
  drainRoute(id, ms = 5000) {
    const entry = this.routes.get(id);
    if (!entry) return Promise.resolve();
    entry.closed = true;
    if (!entry.active) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, ms); t.unref?.();
      (entry.drained ||= []).push(done);
    });
  }

  /** End the relay and every route. Calls still running keep reading their upstream until it ends (see _request). */
  async stop() { this.routes.clear(); this.secrets.clear(); this._stopped = true; await this._kill(); }

  /** Forget the current relay process; routes stay for a restart. Its in-flight calls lose their client: they stop
   *  forwarding and read on (a sandbox that ends its relay mid-reply must not end the metering with it). */
  _drop() {
    const h = this.handle;
    this._alive = false; this.handle = null; this._buf = []; this._bufLen = 0; this._gen++;
    for (const r of this.inflight.values()) r.detach();
    this.inflight.clear();
    this._queue = []; this._queued = 0; this._writing = false;
    for (const w of this._waiters.splice(0)) w();   // they see the new generation: false
    return h;
  }

  async _kill() {
    const h = this._drop();
    if (h) { try { await h.kill(); } catch { /* already gone */ } }
  }

  /** A relay worca did not stop is gone: tell the env (never after stop()). */
  _dropped() { if (!this._stopped) { try { this.onDrop?.(); } catch { /* the env's restart never breaks the relay */ } } }

  /** End a ready relay that misbehaves or cannot be written to, then report the drop. */
  async _lose() { const was = this._alive; await this._kill(); if (was) this._dropped(); }

  /** Splits stdout into lines, looking for the newline in each new piece only. A line that grows past MAX_LINE
   *  stops the relay as soon as it does, complete or not. */
  _onStdout(d) {
    let s = String(d); let i;
    while ((i = s.indexOf('\n')) >= 0) {
      if (this._bufLen + i > MAX_LINE) return this._tooLong();
      const line = this._bufLen ? this._buf.join('') + s.slice(0, i) : s.slice(0, i);
      this._buf = []; this._bufLen = 0; s = s.slice(i + 1);
      this._line(line);
    }
    if (this._bufLen + s.length > MAX_LINE) return this._tooLong();
    if (s) { this._buf.push(s); this._bufLen += s.length; }
  }

  _tooLong() { this.log('warn', 'model relay: a frame from the sandbox was too long; stopping the relay'); this._lose(); }

  _line(line) {
    let f; try { f = JSON.parse(line); } catch { return; }
    if (f?.t === 'ready' && Number.isInteger(f.port) && !this._alive && this._onReady) { const r = this._onReady; this._onReady = null; r(f.port); }
    else if (f?.t === 'req' && this._alive && this.inflight.has(f.id)) {
      // The relay numbers requests itself, so a reused id means it misbehaves: the call in flight keeps the id.
      if (!this._dupLogged) { this._dupLogged = true; this.log('warn', 'model relay: ignored a request frame whose id is already in flight'); }
    } else if (f?.t === 'req' && this._alive) this._request(f).catch((err) => this.log('warn', `model relay: ${err?.message || err}`));
    else if (f?.t === 'close') this.inflight.get(f.id)?.detach();
  }

  /** Queue one frame; false when its relay process is gone. `gen`: the relay process the request came from. After a
   *  restart the new process reuses frame ids, so a late frame of an older request must never reach it. Resolves at
   *  once unless more than sendHighWater chars are queued: then once the queue drains (the caller stops reading its
   *  upstream meanwhile) or the relay is gone. */
  async _send(frame, gen) {
    if (!this._alive || !this.handle || gen !== this._gen) return false;
    const text = JSON.stringify(frame) + '\n';
    this._queue.push(text); this._queued += text.length;
    this._pump();
    if (this._queued > this.sendHighWater) await new Promise((r) => this._waiters.push(r));
    return this._alive && gen === this._gen;
  }

  /** One sendStdin at a time, in queue order; what queued meanwhile goes as one batch of at most sendBatch chars. */
  _pump() {
    const h = this.handle;
    if (this._writing || !h || !this._queue.length) return;
    let n = 0; let k = 0;
    while (k < this._queue.length && (k === 0 || n + this._queue[k].length <= this.sendBatch)) n += this._queue[k++].length;
    const text = this._queue.splice(0, k).join('');
    const gen = this._gen;
    this._writing = true;
    Promise.resolve().then(() => h.sendStdin(text)).then(() => {
      if (gen !== this._gen) return;
      this._writing = false; this._queued -= n;
      if (this._queued <= this.sendHighWater) for (const w of this._waiters.splice(0)) w();
      this._pump();
    }, () => {
      if (this.handle === h) { this.log('warn', 'model relay: writing to the relay failed; stopping it'); this._lose(); }
    });
  }

  async _reply(f, status, headers, body) {
    const { id, gen } = f;
    if (!await this._send({ t: 'head', id, status, headers }, gen)) return;
    if (body.length && !await this._send({ t: 'data', id, b64: body.toString('base64') }, gen)) return;
    await this._send({ t: 'end', id }, gen);
  }

  async _refuse(f, where, { status, type, message }, protocol = 'anthropic') {
    this.log('warn', `model relay: refused ${String(f.method).slice(0, 10)} ${where} → ${status} (${message})`);
    const body = Buffer.from(JSON.stringify(refusalBody(protocol, { status, type, message })));
    await this._reply(f, status, { 'content-type': 'application/json', 'content-length': String(body.length) }, body);
  }

  /** Route id, the rest of the path, and where to log it (never the id). */
  _parse(f) {
    const raw = String(f.path || '');
    const m = /^\/r\/([^/?]*)(.*)$/.exec(raw);
    if (m) return { id: m[1], rest: m[2], where: `/r/<route>${m[2]}`.slice(0, 200) };
    const auth = /^Bearer\s+(\S+)$/i.exec(String(f.headers?.authorization || ''));
    return { id: auth ? auth[1] : '', rest: raw, where: raw.slice(0, 200) };
  }

  async _request(frame) {
    // The call keeps the decoded body only, never the base64 text.
    const { b64: text, ...meta } = frame; frame.b64 = '';
    const b64 = String(text || '');
    const f = { ...meta, gen: this._gen };
    const headers = lowerKeys(f.headers);
    const { id, rest, where } = this._parse({ ...f, headers });
    const q = rest.indexOf('?');
    const pathname = q < 0 ? rest : rest.slice(0, q); const query = q < 0 ? '' : rest.slice(q + 1);
    if (f.method === 'HEAD' && pathname === '/api/hello' && !query) return this._reply(f, 200, {}, Buffer.alloc(0));
    const entry = this.routes.get(id);
    if (!id || !entry || entry.closed) return this._refuse(f, where, relayError(403, 'permission_error', 'unknown or ended route'));
    const proto = entry.route.protocol;
    // As the broker does (slots.mjs pathIssue): a dot, empty or encoded segment is refused before any allow pattern
    // reads the path, since the fetch below would normalise it to a path the route never admitted.
    if (pathIssue(pathname) || !allows(entry.route, f.method, pathname) || !SAFE_QUERY.test(query) || query.includes('..')) {
      return this._refuse(f, where, relayError(403, 'permission_error', `${String(f.method).slice(0, 10)} ${pathname.slice(0, 100)} is not ${entry.route.call || 'a Messages API call'}`), proto);
    }
    // Every limit is checked on the size the base64 announces, before decoding it.
    const size = b64Bytes(b64);
    if (f.over || size > MAX_REQUEST_BYTES) return this._refuse(f, where, relayError(413, 'request_too_large', `the request body is over ${MAX_REQUEST_BYTES >> 20} MiB`), proto);
    if (entry.active >= this.maxConcurrent) return this._refuse(f, where, relayError(429, 'rate_limit_error', `more than ${this.maxConcurrent} calls at once on one route`), proto);
    if (this._bytes + size > this.maxBytes) return this._refuse(f, where, relayError(429, 'rate_limit_error', `more than ${mib(this.maxBytes)} MiB of request bodies in flight from this sandbox`), proto);
    if (this.budget.used + size > this.budget.limit) return this._refuse(f, where, relayError(529, 'overloaded_error', `worca is relaying more than ${mib(this.budget.limit)} MiB of request bodies at once`), proto);
    let body = Buffer.from(b64, 'base64');
    // The model this call was held to (null: the route checks none), which its usage is booked under ('' for the step's
    // own model, relay-usage.mjs createRouteMeter).
    let checked = null;
    const pinned = Array.isArray(entry.route.models) && entry.route.models.length ? entry.route.models : null;
    // A path-checked route (a per-mode route's pin, relay-route.mjs modePin): the model, deployment or endpoint the path
    // names must be the step's, on every call (also a GET of the endpoint's own config).
    if (entry.route.modelCheck === 'path' && pinned) {
      const m = entry.route.pathModel?.exec(pathname)?.[1];
      if (typeof m !== 'string' || !pinned.includes(m)) {
        return this._refuse(f, where, relayError(403, 'permission_error', `model ${JSON.stringify(String(m ?? '').slice(0, 100))} is not this step's model`), proto);
      }
      checked = m;
    }
    // The step's model (plans/core-protection-layer-design.md §4.2): a body-checked route (catalog relay.modelCheck
    // 'body', or a per-mode route's body pin) carries `models`; a call naming any other model is refused. The body is
    // forwarded re-serialised, so the upstream reads the same `model` worca checked (JSON.parse keeps the last of
    // duplicate keys; an upstream may keep the first). A second, differently cased model key is refused: a Go upstream
    // (encoding/json) matches field names case-insensitively. Routes without `models` (partial checks: Claude, Cursor,
    // Gemini CLI) pass untouched.
    if (entry.route.modelCheck === 'body' && pinned && !NO_BODY.has(f.method)) {
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { parsed = undefined; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return this._refuse(f, where, relayError(400, 'invalid_request_error', 'the request body is not JSON'), proto);
      }
      if (Object.keys(parsed).some((k) => k !== 'model' && k.toLowerCase() === 'model')) {
        return this._refuse(f, where, relayError(400, 'invalid_request_error', 'the request body names its model more than once'), proto);
      }
      const m = parsed.model;
      if (typeof m !== 'string' || !pinned.includes(m)) {
        return this._refuse(f, where, relayError(403, 'permission_error', `model ${JSON.stringify(String(m ?? '').slice(0, 100))} is not this step's model`), proto);
      }
      body = Buffer.from(JSON.stringify(parsed));
      checked = m;
    }
    // A reply worca can meter (as the broker asks for it, src/broker/usage.mjs): a streamed Chat Completions call asks
    // for its usage whatever the sandbox sent, and a background Responses call (answered to a poll the relay never sees)
    // is refused.
    if (proto === 'openai' && !NO_BODY.has(f.method)) {
      try { body = requestWithUsage({ id: '', protocol: proto, upstream: entry.route.origin || 'http://relay.invalid' }, pathname, body); }
      catch (err) {
        if (err?.code !== 'E_BACKGROUND') throw err;
        return this._refuse(f, where, relayError(400, 'invalid_request_error', 'a background response is not supported: worca could not meter it'), proto);
      }
    }
    // Only upstream silence ends a call early. A client that goes (a 'close' frame, a relay exit or stop(), a sandbox
    // that stops taking frames) detaches it: nothing more is forwarded, and the upstream is read to its end, so the
    // meter books what the provider bills. Its usage comes last in a stream (Anthropic's message_delta), so an
    // aborted reply would book next to nothing (as the broker does, V7). A detached call keeps its slot until then.
    const ac = new AbortController();
    const call = { why: null, gone: false, model: checked != null && checked === entry.route.stepModel ? '' : checked,
      abort: (why) => { if (!call.why) call.why = why; ac.abort(); }, detach: () => { call.gone = true; } };
    const idle = setTimeout(() => call.abort('idle'), this.idleMs); idle.unref?.();
    call.touch = () => idle.refresh();
    entry.active++; this.inflight.set(f.id, call); this._bytes += size; this.budget.used += size;
    try { await this._forward(f, entry.route, headers, rest, pathname, body, where, ac.signal, call); }
    finally {
      clearTimeout(idle); ac.abort(); if (this.inflight.get(f.id) === call) this.inflight.delete(f.id);
      this._bytes -= size; this.budget.used -= size;
      if (--entry.active === 0) {
        for (const r of entry.idle.splice(0)) r();
        // A drain waiting on this route (closeRoute): its last in-flight call has committed its usage. The captured
        // entry keeps the waiters even when removeRoute or stop() dropped it from the map.
        if (entry.drained) { const w = entry.drained; entry.drained = null; for (const fn of w) fn(); }
      }
    }
  }

  /** Forward one reply frame of `call`, unless its client is gone. A relay gone, or a sandbox that has not taken the
   *  queued frames within clientDrainMs, detaches the call; it never waits longer than that. */
  async _pass(f, call, frame) {
    if (call.gone) return;
    let timer;
    const stalled = new Promise((r) => { timer = setTimeout(() => r(false), this.clientDrainMs); timer.unref?.(); });
    const ok = await Promise.race([this._send(frame, f.gen), stalled]);
    clearTimeout(timer);
    if (!ok) call.detach();
  }

  async _forward(f, route, headers, rest, pathname, body, where, signal, call) {
    const proto = route.protocol;
    const stalled = () => this._refuse(f, where, relayError(504, 'api_error', 'the model endpoint stopped answering'), proto);
    // The upstream and the auth headers may come from a call worca makes first (a host lookup, a token exchange):
    // their failure is a refusal, worded without any secret.
    let url; let out;
    try {
      const base = typeof route.upstream === 'function' ? await route.upstream() : route.upstream;
      url = String(base).replace(/\/+$/, '') + rest;
      const auth = lowerKeys(await route.authHeaders(headers));
      // Whatever worca signs with is scrubbed from every reply, also a token the route derived just now.
      for (const k of ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key']) {
        if (auth[k] !== undefined) { const s = String(auth[k]); this.secrets.add(s); this.secrets.add(s.replace(/^(Bearer|token)\s+/i, '')); }
      }
      for (const s of route.secrets || []) this.secrets.add(s);
      // A Connect route asks for uncompressed messages (the reply scrub reads gzip too: a server may mirror the request's).
      out = { ...upstreamRequestHeaders(headers, route.forwardHeaders), ...lowerKeys(route.extraHeaders), ...(proto === 'connect' ? CONNECT_IDENTITY : {}), ...auth };
    } catch (err) {
      if (call.why) return;
      return this._refuse(f, where, relayError(502, 'api_error', scrubText(`worca could not sign the call: ${err?.message || err}`, [...this.secrets]).slice(0, 300)), proto);
    }
    let r;
    try { r = await this.fetchImpl(url, { method: f.method, headers: out, body: body.length && !NO_BODY.has(f.method) ? body : undefined, redirect: 'manual', signal }); }
    catch {
      if (call.why === 'idle') return stalled();
      if (call.why) return;
      return this._refuse(f, where, relayError(502, 'api_error', 'the model endpoint could not be reached'), proto);
    }
    call.touch();
    try { route.onStatus?.(r.status); } catch { /* a route's bookkeeping never breaks the call */ }
    if (r.status >= 300 && r.status < 400) {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      return this._refuse(f, where, relayError(502, 'api_error', 'the upstream redirected'), proto);
    }
    const secrets = [...this.secrets];
    const upHeaders = Object.fromEntries(r.headers);
    const extra = Object.fromEntries((route.responseHeaders || []).filter((k) => upHeaders[k] !== undefined).map((k) => [k, upHeaders[k]]));
    const rh = cleanHeaders({ ...agentResponseHeaders(upHeaders), ...extra }, secrets);
    if (r.status < 200 || r.status >= 300) {
      const parts = []; let n = 0;
      try { for await (const c of r.body || []) { call.touch(); parts.push(c); n += c.length; if (n >= MAX_ERROR_BODY) break; } } catch { /* what arrived */ }
      if (call.why === 'idle') return stalled();
      if (call.why) return;
      const text = Buffer.from(scrubText(Buffer.concat(parts).subarray(0, MAX_ERROR_BODY).toString('utf8'), secrets));
      this.log('info', `model relay: ${where} → ${r.status}`);
      return this._reply(f, r.status, { ...rh, 'content-length': String(text.length) }, text);
    }
    // A Connect reply worca cannot read is refused before its head (fetch decoded any content-encoding already); a
    // streamed one is scrubbed message by message, a gzip message inflated first.
    const unreadable = proto === 'connect' ? connectReplyProblem(upHeaders, { decoded: true }) : null;
    if (unreadable) {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      return this._refuse(f, where, relayError(502, 'api_error', `the upstream sent ${unreadable}, which worca cannot check for credentials`), proto);
    }
    const scrub = proto === 'connect' && isConnectStream(upHeaders['content-type'])
      ? createConnectScrubber(secrets, { maxMessage: MAX_REQUEST_BYTES }) : createByteScrubber(secrets);
    // The route's meter (relay-usage.mjs): worca's own count of what the reply used, never the sandbox's. It is fed
    // every upstream byte, also after the client is gone.
    const meter = route.meter?.(pathname, call.model) || null;
    try {
      await this._pass(f, call, { t: 'head', id: f.id, status: r.status, headers: rh });
      try {
        for await (const c of r.body || []) {
          call.touch();
          meter?.push(c);
          if (call.gone) continue;
          const b = scrub.push(c);
          if (b === null) {   // a message the scrub cannot read: the client's stream is cut, the upstream still metered
            this.log('warn', `model relay: ${where} → ${r.status}, cut a reply with a message worca cannot check for credentials`);
            await this._pass(f, call, { t: 'end', id: f.id, error: true });
            call.detach();
            continue;
          }
          if (b.length) await this._pass(f, call, { t: 'data', id: f.id, b64: b.toString('base64') });
        }
      } catch {
        this.log('warn', `model relay: ${where} → ${r.status}, the reply ${call.why === 'idle' ? 'stalled' : 'broke off'}`);
        await this._pass(f, call, { t: 'end', id: f.id, error: true });
        return;
      }
      const tail = scrub.flush();
      if (tail.length) await this._pass(f, call, { t: 'data', id: f.id, b64: tail.toString('base64') });
      await this._pass(f, call, { t: 'end', id: f.id });
    } finally { meter?.end(); }
  }
}
