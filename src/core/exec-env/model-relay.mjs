// src/core/exec-env/model-relay.mjs
// Worca's half of the model relay (plans/model-relay-design.md §3, §5): starts sandbox-relay.mjs in the
// sandbox with stdin open, reads its request frames, and does all the deciding — route, method and path,
// size, concurrency, header allowlist — then adds the route's credential on this side, forwards to the
// route's one upstream (no redirects) and streams the reply back as frames via sendStdin, scrubbed of every
// route's credential.
import { randomBytes } from 'node:crypto';
import { shq } from './shell.mjs';
import { upstreamRequestHeaders, agentResponseHeaders, MAX_REQUEST_BYTES, UPSTREAM_IDLE_MS } from '../../broker/service.mjs';
import { scrubText, REMOVED } from '../../broker/scrub.mjs';

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
const ALLOWED_PATHS = new Set(['/v1/messages', '/v1/messages/count_tokens']);
const SAFE_QUERY = /^[A-Za-z0-9_=&.-]*$/;
const REMOVED_BYTES = Buffer.from(REMOVED);
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

/** Exact-value scrub of `secrets` over a byte stream: a value split across chunks is still caught; only bytes
 *  that could begin a value (at most longest − 1) are held back. Never decodes, so UTF-8 split across chunks
 *  passes intact. Values under 8 characters are skipped, as scrubText does. Any chunking gives the same bytes
 *  as one whole-body pass (earliest match first, the longest on a tie). */
export function createByteScrubber(secrets = []) {
  const keys = secretValues(secrets).map((s) => Buffer.from(s));
  const hold = keys.reduce((m, k) => Math.max(m, k.length - 1), 0);
  let carry = Buffer.alloc(0);
  // The earliest position from `from` whose tail is a proper prefix of some value: it may finish in the next chunk.
  const pendingFrom = (buf, from) => {
    for (let i = Math.max(from, buf.length - hold); i < buf.length; i++) {
      const tail = buf.subarray(i);
      if (keys.some((k) => k.length > tail.length && k.subarray(0, tail.length).equals(tail))) return i;
    }
    return buf.length;
  };
  const scan = (buf, final) => {
    const out = []; let pos = 0; let cut;
    for (;;) {
      const wait = final ? buf.length : pendingFrom(buf, pos);
      let at = -1; let len = 0;
      for (const k of keys) { const i = buf.indexOf(k, pos); if (i !== -1 && (at === -1 || i < at || (i === at && k.length > len))) { at = i; len = k.length; } }
      // A match at or after `wait` could lose to a longer or earlier value still arriving: decide it next chunk.
      if (at === -1 || at >= wait) { cut = wait; break; }
      out.push(buf.subarray(pos, at), REMOVED_BYTES); pos = at + len;
    }
    out.push(buf.subarray(pos, cut));
    carry = Buffer.from(buf.subarray(cut));
    return Buffer.concat(out);
  };
  return {
    push: (chunk) => (keys.length ? scan(carry.length ? Buffer.concat([carry, chunk]) : Buffer.from(chunk), false) : Buffer.from(chunk)),
    flush: () => (keys.length ? scan(carry, true) : Buffer.alloc(0)),
  };
}

/** Bytes in flight against `limit`, shared by the relays that hold it. */
export const createByteBudget = (limit) => ({ limit, used: 0 });
const TOTAL_BUDGET = createByteBudget(MAX_TOTAL_INFLIGHT_BYTES);
const mib = (n) => Math.round(n / (1 << 20));
/** The decoded size of base64 text, known before decoding it. */
const b64Bytes = (s) => Math.max(0, Math.floor(s.length * 3 / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0));

const relayError = (status, type, message) => ({ status, type, message });
const lowerKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));

export class ModelRelay {
  /** `onDrop()`: a ready relay ended without stop() (it exited, its command stream dropped, a write to it failed or it
   *  sent a frame too long): the env restarts it at once, so a running step's model calls do not hang (remote-env.mjs).
   *  `maxInflightBytes`: this relay's budget of request bodies held at once; `budget`: the one all relays share. */
  constructor({ log = () => {}, fetchImpl = globalThis.fetch, maxConcurrentPerRoute = 16, upstreamIdleMs = UPSTREAM_IDLE_MS, onDrop = null,
    sendBatch = SEND_BATCH, sendHighWater = SEND_HIGH_WATER, maxInflightBytes = MAX_INFLIGHT_BYTES, budget = TOTAL_BUDGET } = {}) {
    this.log = log; this.fetchImpl = fetchImpl; this.maxConcurrent = maxConcurrentPerRoute; this.idleMs = upstreamIdleMs; this.onDrop = onDrop;
    this.sendBatch = sendBatch; this.sendHighWater = sendHighWater;
    this.maxBytes = maxInflightBytes; this.budget = budget; this._bytes = 0;   // body bytes of this relay's calls in flight
    this.routes = new Map();     // route id -> { route, active }; kept when the relay restarts
    // Every credential any route of this relay attaches, also of routes since removed or rotated away: a reply on one
    // route is scrubbed of all of them, so an upstream echoing another route's key never brings it into the sandbox.
    this.secrets = new Set();
    this.inflight = new Map();   // frame id -> { abort(why) } for the current relay process
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
    this.routes.set(id, { route, active: 0 });
    for (const s of route.secrets || []) this.secrets.add(s);
    return { id, baseUrl: this.baseUrlFor(id) };
  }

  removeRoute(id) { this.routes.delete(id); }

  /** End the relay and every route. */
  async stop() { this.routes.clear(); this.secrets.clear(); this._stopped = true; await this._kill(); }

  /** Forget the current relay process and fail its in-flight requests; routes stay for a restart. */
  _drop() {
    const h = this.handle;
    this._alive = false; this.handle = null; this._buf = []; this._bufLen = 0; this._gen++;
    for (const r of this.inflight.values()) r.abort('stopped');
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
    else if (f?.t === 'close') this.inflight.get(f.id)?.abort('closed');
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

  async _refuse(f, where, { status, type, message }) {
    this.log('warn', `model relay: refused ${String(f.method).slice(0, 10)} ${where} → ${status} (${message})`);
    const body = Buffer.from(JSON.stringify({ type: 'error', error: { type, message: `worca-relay: ${message}` } }));
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
    if (!id || !entry) return this._refuse(f, where, relayError(403, 'permission_error', 'unknown or ended route'));
    if (f.method !== 'POST' || !ALLOWED_PATHS.has(pathname) || !SAFE_QUERY.test(query) || query.includes('..')) {
      return this._refuse(f, where, relayError(403, 'permission_error', `${String(f.method).slice(0, 10)} ${pathname.slice(0, 100)} is not a Messages API call`));
    }
    // Every limit is checked on the size the base64 announces, before decoding it.
    const size = b64Bytes(b64);
    if (f.over || size > MAX_REQUEST_BYTES) return this._refuse(f, where, relayError(413, 'request_too_large', `the request body is over ${MAX_REQUEST_BYTES >> 20} MiB`));
    if (entry.active >= this.maxConcurrent) return this._refuse(f, where, relayError(429, 'rate_limit_error', `more than ${this.maxConcurrent} calls at once on one route`));
    if (this._bytes + size > this.maxBytes) return this._refuse(f, where, relayError(429, 'rate_limit_error', `more than ${mib(this.maxBytes)} MiB of request bodies in flight from this sandbox`));
    if (this.budget.used + size > this.budget.limit) return this._refuse(f, where, relayError(529, 'overloaded_error', `worca is relaying more than ${mib(this.budget.limit)} MiB of request bodies at once`));
    const body = Buffer.from(b64, 'base64');
    // One controller per call: a client hang-up ('close' frame), stop(), a relay exit or upstream silence ends it.
    const ac = new AbortController();
    const call = { why: null, abort: (why) => { if (!call.why) call.why = why; ac.abort(); } };
    const idle = setTimeout(() => call.abort('idle'), this.idleMs); idle.unref?.();
    call.touch = () => idle.refresh();
    entry.active++; this.inflight.set(f.id, call); this._bytes += size; this.budget.used += size;
    try { await this._forward(f, entry.route, headers, rest, body, where, ac.signal, call); }
    finally {
      clearTimeout(idle); ac.abort(); if (this.inflight.get(f.id) === call) this.inflight.delete(f.id); entry.active--;
      this._bytes -= size; this.budget.used -= size;
    }
  }

  async _forward(f, route, headers, rest, body, where, signal, call) {
    const url = String(route.upstream).replace(/\/+$/, '') + rest;
    const out = { ...upstreamRequestHeaders(headers), ...lowerKeys(route.extraHeaders), ...route.authHeaders(headers) };
    const stalled = () => this._refuse(f, where, relayError(504, 'api_error', 'the model endpoint stopped answering'));
    let r;
    try { r = await this.fetchImpl(url, { method: 'POST', headers: out, body: body.length ? body : undefined, redirect: 'manual', signal }); }
    catch {
      if (call.why === 'idle') return stalled();
      if (call.why) return;   // the caller hung up or the relay stopped: nobody to answer
      return this._refuse(f, where, relayError(502, 'api_error', 'the model endpoint could not be reached'));
    }
    call.touch();
    if (r.status >= 300 && r.status < 400) {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      return this._refuse(f, where, relayError(502, 'api_error', 'the upstream redirected'));
    }
    const secrets = [...this.secrets];
    const rh = cleanHeaders(agentResponseHeaders(Object.fromEntries(r.headers)), secrets);
    if (r.status < 200 || r.status >= 300) {
      const parts = []; let n = 0;
      try { for await (const c of r.body || []) { call.touch(); parts.push(c); n += c.length; if (n >= MAX_ERROR_BODY) break; } } catch { /* what arrived */ }
      if (call.why === 'idle') return stalled();
      if (call.why) return;
      const text = Buffer.from(scrubText(Buffer.concat(parts).subarray(0, MAX_ERROR_BODY).toString('utf8'), secrets));
      this.log('info', `model relay: ${where} → ${r.status}`);
      return this._reply(f, r.status, { ...rh, 'content-length': String(text.length) }, text);
    }
    if (!await this._send({ t: 'head', id: f.id, status: r.status, headers: rh }, f.gen)) return;
    const scrub = createByteScrubber(secrets);
    // The route's meter (relay-usage.mjs): worca's own count of what the reply used, never the sandbox's.
    const meter = route.meter?.() || null;
    try {
      for await (const c of r.body || []) {
        call.touch();
        meter?.push(c);
        const b = scrub.push(c);
        if (b.length && !await this._send({ t: 'data', id: f.id, b64: b.toString('base64') }, f.gen)) return;
      }
    } catch {
      if (call.why !== 'closed' && call.why !== 'stopped') this.log('warn', `model relay: ${where} → ${r.status}, the reply ${call.why === 'idle' ? 'stalled' : 'broke off'}`);
      await this._send({ t: 'end', id: f.id, error: true }, f.gen);
      return;
    } finally { meter?.end(); }
    const tail = scrub.flush();
    if (tail.length && !await this._send({ t: 'data', id: f.id, b64: tail.toString('base64') }, f.gen)) return;
    await this._send({ t: 'end', id: f.id }, f.gen);
  }
}
