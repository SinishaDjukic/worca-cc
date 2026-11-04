// src/core/chat/channel-host.mjs
// Supervisor for persistent channel workers (chat-connectivity-design.md §4.4).
// One child process per enabled+configured chatChannels entry: spawned with the
// same scrubbed env and user as connector ops (plugin-shim.mjs pluginChildSpawn),
// fed config/secrets/state via the hello frame on stdin, restarted with backoff
// on crash, killed on plugin disable/uninstall and on server shutdown. All worker-originated strings are
// redacted before they reach the logger or the UI.
//
// Worker contract: a worker that emits any 'status' frame before 'ready' will
// NOT be flipped to 'connected' by that 'ready' — the documented no-throw
// auth-failure pattern (emit 'disconnected' with the reason, then return from
// start()) relies on this. Workers that self-report 'connected' are unaffected:
// their own status frame does it.
//
// WORCA_MOCK=1: no children — in-memory mock workers, instantly 'connected',
// with test hooks mirroring plugin-shim.mjs setMockSourceResponses.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { PluginOpError, pluginChildSpawn, killPluginChild, warnWithheldProxy } from '../plugin-shim.mjs';
import { normalizeManifest, negotiatedApi } from '../plugin-manifest.mjs';
import { WORCA_PLUGIN_API } from '../plugin-api.mjs';
import { readPluginsLock, pluginCurrentDir } from '../plugins-lock.mjs';
import { readPluginConfig, readPluginState, writePluginState } from '../plugin-config.mjs';
import { encodeFrame, decodeFrame, isValidMessage, isValidSendOptions, isValidHistory, CONTROL_LIMITS, MAX_FRAME_BYTES, INBOUND_LIMITS } from './channel-protocol.mjs';
import { redactSecrets } from './redact.mjs';

const CHILD_PATH = fileURLToPath(new URL('./channel-worker-child.mjs', import.meta.url));

const RESTART_BACKOFF_MS = [1000, 5000, 30000, 60000];
const MAX_CONSECUTIVE_FAILURES = 10;
const HEALTHY_AFTER_MS = 60000;
const PING_INTERVAL_MS = 30000;
const SHUTDOWN_GRACE_MS = 5000;
const MAX_OUT_QUEUE = 100;
const DELIVERY_RING_SIZE = 50;

const workerKey = (plugin, channelId) => `${plugin}/${channelId}`;

/** A send the platform itself refused (404, 403, an invalid message): retrying the same message cannot succeed, unlike a
 *  network error, a 5xx, a 429 or a worker that is down. The conversation bridge reads `permanent` to skip such a part. */
function refused(err) {
  err.permanent = true;
  return err;
}

/** Same env-flag semantics as plugin-shim.mjs#mockMode. */
function mockMode() {
  const v = process.env.WORCA_MOCK ?? process.env.ORCH_MOCK;
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
}

// ── mock hooks (tests / offline smoke) ───────────────────────────────────────

let _mockBehavior = null;   // key or '*' -> { send?(chatId, message), webhook?(req), react?(frame), history?(frame), typing?(frame) }
const _mockSent = [];       // every sendMessage seen in mock mode

/** Tests: override mock worker behavior per "plugin/channelId" key ('*' = all). */
export function setMockChannelBehavior(map) {
  _mockBehavior = map && typeof map === 'object' ? map : null;
}

/** Tests: messages delivered through mock workers, oldest first. */
export function mockSentMessages() { return _mockSent.slice(); }

/** Tests: reset recorded mock deliveries. */
export function clearMockSentMessages() { _mockSent.length = 0; }
const _mockReplies = [];    // every replyInteraction seen in mock mode
/** Tests: interaction replies delivered through mock workers, oldest first. */
export function mockInteractionReplies() { return _mockReplies.slice(); }
export function clearMockInteractionReplies() { _mockReplies.length = 0; }

/** A non-interactive channel gets text only: link controls become link segments, executable controls vanish
 *  (they could never be answered there). */
export function withoutControls(message) {
  if (!Array.isArray(message.controls)) return message;
  const links = message.controls.filter((c) => c.kind === 'link')
    .flatMap((c) => [{ kind: 'text', value: '\n' }, { kind: 'link', value: c.label, href: c.url }]);
  const { controls: _drop, ...rest } = message;
  return { ...rest, body: [...rest.body, ...links] };
}

// ── discovery ────────────────────────────────────────────────────────────────

/**
 * Enabled plugins' chatChannels, standard discovery idiom (lock -> sorted ->
 * enabled -> current/ manifest), failing closed to []. Each entry carries what
 * the supervisor needs to spawn and what the UI needs to display.
 */
export function discoverChannels() {
  let lock;
  try { lock = readPluginsLock(); } catch { return []; }
  const out = [];
  for (const name of Object.keys(lock).sort()) {
    if (lock[name]?.enabled === false) continue;
    const dir = pluginCurrentDir(name);
    let manifest;
    try {
      const norm = normalizeManifest(JSON.parse(readFileSync(join(dir, 'worca-cc-plugin.json'), 'utf8')), { dir });
      if (!norm.ok) continue;
      manifest = norm.manifest;
    } catch { continue; }
    for (const ch of manifest.chatChannels || []) {
      const missing = (ch.configSchema || [])
        .filter((f) => f.required)
        .filter((f) => {
          const v = readPluginConfig(name, ch.configSchema)[f.key];
          return v === undefined || v === null || v === '';
        })
        .map((f) => f.key);
      out.push({
        plugin: name,
        channelId: ch.id,
        displayName: ch.displayName,
        platform: ch.platform,
        ingress: ch.ingress,
        capabilities: ch.capabilities,
        // chat context: the CDN hosts the host may download this channel's message files from (manifest; absent = none)
        ...(ch.attachmentHosts ? { attachmentHosts: ch.attachmentHosts } : {}),
        configSchema: ch.configSchema,
        modulePath: resolve(dir, ch.module),
        apiVersion: negotiatedApi(manifest.engines?.worcaApi) ?? WORCA_PLUGIN_API,
        missingConfig: missing,
      });
    }
  }
  return out;
}

// ── supervisor ───────────────────────────────────────────────────────────────

/**
 * @param {{logger?:(level:string,msg:string)=>void,
 *          onInbound?:(ev:{plugin:string,channelId:string,platform:string,msg:object})=>void,
 *          onStatus?:(ev:{plugin:string,channelId:string,platform:string,state:string,detail:string|null})=>void,
 *          _spawn?:typeof spawn, _backoffMs?:number[], _healthyAfterMs?:number}} opts
 *   `_spawn`/`_backoffMs`/`_healthyAfterMs` are test seams only.
 */
export function createChannelHost({ logger, onInbound, onInteraction, onStatus, _spawn = spawn, _backoffMs = RESTART_BACKOFF_MS, _healthyAfterMs = HEALTHY_AFTER_MS } = {}) {
  const log = typeof logger === 'function' ? logger : (level, msg) => console.error(`chat ${level}: ${msg}`);
  const workers = new Map(); // key -> worker record
  let stopping = false;

  // Per-worker redactor: pattern scrubs (redact.mjs) PLUS literal occurrences
  // of this channel's secret config VALUES — patterns can't know an arbitrary
  // token a user pasted into a secret field.
  const makeRedactor = (entry) => {
    let values = [];
    try {
      const cfg = readPluginConfig(entry.plugin, entry.configSchema);
      values = (entry.configSchema || [])
        .filter((f) => f.secret)
        .map((f) => cfg[f.key])
        .filter((v) => typeof v === 'string' && v.length >= 4);
    } catch { /* discovery already logged */ }
    return (s) => values.reduce((acc, v) => acc.split(v).join('<redacted>'), redactSecrets(s));
  };

  const setStatus = (w, state, detail = null) => {
    const red = detail == null ? null : w.redact(detail);
    if (w.state === state && w.detail === red) return;
    // healthySince = when we last BELIEVED this worker connected. Stamped on the
    // transition only, so a masked 'ready' (worker already said disconnected)
    // can never buy the exit handler's forgiveness.
    if (state === 'connected' && w.state !== 'connected') w.healthySince = Date.now();
    w.state = state;
    w.detail = red;
    try { onStatus?.({ plugin: w.entry.plugin, channelId: w.entry.channelId, platform: w.entry.platform, state, detail: red }); }
    catch { /* listener faults never reach the supervisor */ }
  };

  const rejectPending = (w, err) => {
    for (const [, p] of w.pending) { clearTimeout(p.timer); p.reject(err); }
    w.pending.clear();
  };

  const pushDelivery = (w, rec) => {
    w.deliveries.push({ at: new Date().toISOString(), ...rec });
    if (w.deliveries.length > DELIVERY_RING_SIZE) w.deliveries.shift();
  };

  // Bounded outbound frame queue: drop-oldest at MAX_OUT_QUEUE, counted; a
  // dropped send RPC rejects immediately instead of hanging to timeout.
  const writeFrame = (w, frame) => {
    if (!w.proc || w.proc.killed) throw new PluginOpError('plugin', 'worker is not running');
    if (w.backpressured || w.outQueue.length) {
      w.outQueue.push(frame);
      while (w.outQueue.length > MAX_OUT_QUEUE) {
        const dropped = w.outQueue.shift();
        w.dropped += 1;
        const p = dropped?.id ? w.pending.get(dropped.id) : null;
        if (p) { w.pending.delete(dropped.id); clearTimeout(p.timer); p.reject(new PluginOpError('rate-limit', 'outbound queue overflow — frame dropped')); }
      }
      return;
    }
    const ok = w.proc.stdin.write(encodeFrame(frame));
    if (!ok) {
      w.backpressured = true;
      w.proc.stdin.once('drain', () => flushQueue(w));
    }
  };
  const flushQueue = (w) => {
    w.backpressured = false;
    while (w.outQueue.length && w.proc && !w.proc.killed) {
      if (!w.proc.stdin.write(encodeFrame(w.outQueue.shift()))) {
        w.backpressured = true;
        w.proc.stdin.once('drain', () => flushQueue(w));
        return;
      }
    }
  };

  const handleFrame = (w, frame) => {
    switch (frame.type) {
      case 'ready':
        w.identity = frame.identity ?? null;
        // NOT w.consecutiveFailures = 0 — the exit handler already forgives a
        // crash after _healthyAfterMs of health; zeroing here let a
        // connect-then-crash worker restart at the 1s floor forever.
        // NOT w.healthySince here either — setStatus stamps it on the real
        // transition, so a masked ready cannot buy forgiveness.
        // 'ready' is optimistic: it only claims 'connected' when the worker has
        // not already reported its own state this spawn (the documented no-throw
        // auth-failure pattern emits 'disconnected' BEFORE ready).
        if (!w.statusSinceSpawn) setStatus(w, 'connected', null);
        break;
      case 'status':
        w.statusSinceSpawn = true;
        setStatus(w, frame.state, frame.detail ?? null);
        break;
      case 'inbound':
        if (!w.entry.capabilities.inbound) break; // manifest said outbound-only: drop
        try { onInbound?.({ plugin: w.entry.plugin, channelId: w.entry.channelId, platform: w.entry.platform, msg: frame.msg }); }
        catch (err) { log('error', `chat inbound handler failed: ${w.redact(err?.message || err)}`); }
        break;
      case 'interaction':
        if (!w.entry.capabilities.inbound || w.entry.capabilities.interactive !== true) break;
        try { onInteraction?.({ plugin: w.entry.plugin, channelId: w.entry.channelId, platform: w.entry.platform, evt: frame.evt }); }
        catch (err) { log('error', `chat interaction handler failed: ${w.redact(err?.message || err)}`); }
        break;
      case 'send-result':
      case 'webhook-result': {
        const p = w.pending.get(frame.id);
        if (!p) break;
        w.pending.delete(frame.id);
        clearTimeout(p.timer);
        p.resolve(frame);
        break;
      }
      case 'state-delta':
        try { writePluginState(w.entry.plugin, frame.delta); }
        catch (err) { log('error', `chat state persist failed for ${w.key}: ${err?.message || err}`); }
        break;
      case 'pong':
        w.missedPongs = 0;
        break;
      case 'log':
        log(frame.level || 'info', `[chat:${w.key}] ${w.redact(frame.msg)}`);
        break;
      default: // host->worker types echoed back: protocol noise, ignore
        break;
    }
  };

  const spawnWorker = (w) => {
    if (stopping) return;
    setStatus(w, 'connecting', null);
    warnWithheldProxy();
    // As the container's plugin user when there is one (plugin-shim.mjs pluginChildSpawn).
    const run = pluginChildSpawn([...(process.env.WORCA_PLUGIN_INSPECT ? ['--inspect'] : []), CHILD_PATH]);
    const proc = _spawn(run.file, run.args, { ...run.options, stdio: ['pipe', 'pipe', 'pipe'] });
    const kill = () => killPluginChild(proc, run.user);
    w.proc = proc;
    w.kill = kill;
    w.missedPongs = 0;
    w.spawnedAt = Date.now();
    w.statusSinceSpawn = false;

    proc.stdin.on('error', () => { /* EPIPE on dying child: exit handler owns recovery */ });
    let stderrTail = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-2000); });

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
        log('error', `[chat:${w.key}] oversize frame — protocol violation, restarting worker`);
        kill();
        return;
      }
      const frame = decodeFrame(line);
      if (!frame) { log('warn', `[chat:${w.key}] invalid worker frame dropped`); return; }
      handleFrame(w, frame);
    });

    w.pingTimer = setInterval(() => {
      if (!w.proc || w.proc.killed) return;
      w.missedPongs += 1;
      if (w.missedPongs > 2) {
        log('warn', `[chat:${w.key}] unresponsive (missed pongs) — restarting worker`);
        kill();
        return;
      }
      try { writeFrame(w, { type: 'ping', id: `ping-${Date.now()}` }); } catch { /* exit handler owns it */ }
    }, PING_INTERVAL_MS);
    w.pingTimer.unref?.();

    const onExit = (code, signal) => {
      if (w.proc !== proc) return;            // stale duplicate: error path ran, or a respawn happened
      clearInterval(w.pingTimer);
      w.proc = null;
      w.outQueue.length = 0;
      w.backpressured = false;
      rejectPending(w, new PluginOpError('plugin', `worker exited (${signal || code})`));
      if (stopping || w.removed) { setStatus(w, 'disconnected', null); return; }
      if (w.shuttingDown) { w.shuttingDown = false; setStatus(w, 'disconnected', null); return; }

      const healthyLongEnough = w.healthySince && Date.now() - w.healthySince > _healthyAfterMs;
      w.consecutiveFailures = healthyLongEnough ? 1 : w.consecutiveFailures + 1;
      w.healthySince = null;
      const detail = w.spawnErrorDetail || stderrTail.trim().split('\n').pop() || `exit ${signal || code}`;
      w.spawnErrorDetail = null;
      if (w.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        log('error', `[chat:${w.key}] giving up after ${w.consecutiveFailures} failures: ${w.redact(detail)}`);
        setStatus(w, 'failed', detail);
        return;
      }
      const delay = _backoffMs[Math.min(w.consecutiveFailures - 1, _backoffMs.length - 1)];
      log('warn', `[chat:${w.key}] worker exited (${signal || code}) — restart in ${delay}ms`);
      setStatus(w, 'disconnected', detail);
      w.restartTimer = setTimeout(() => spawnWorker(w), delay);
      w.restartTimer.unref?.();
    };
    proc.on('exit', onExit);
    // Async spawn/pipe failures (EMFILE, EAGAIN) must never become an unhandled
    // 'error' on the child. If spawn failed outright (no pid), 'exit' will never
    // fire — stash the real error text (stderrTail is empty on this path, so the
    // badge would otherwise show a useless "exit -1") and route into recovery.
    proc.on('error', (err) => {
      const msg = w.redact(err?.message || String(err));
      log('error', `[chat:${w.key}] worker process error: ${msg}`);
      if (proc.pid) kill();
      else { w.spawnErrorDetail = msg; onExit(-1, null); }
    });

    // hello: config+secrets+state via stdin ONLY (spec §7.2 rule, persistent).
    try {
      writeFrame(w, {
        type: 'hello',
        apiVersion: w.entry.apiVersion,
        plugin: w.entry.plugin,
        channelId: w.entry.channelId,
        platform: w.entry.platform,
        module: w.entry.modulePath,
        config: readPluginConfig(w.entry.plugin, w.entry.configSchema),
        state: readPluginState(w.entry.plugin),
        mock: false,
      });
    } catch (err) {
      log('error', `[chat:${w.key}] hello failed: ${w.redact(err?.message || err)}`);
    }
  };

  const makeRecord = (entry) => ({
    key: workerKey(entry.plugin, entry.channelId),
    entry,
    redact: makeRedactor(entry),
    proc: null,
    state: 'disconnected',
    detail: null,
    identity: null,
    pending: new Map(),
    outQueue: [],
    backpressured: false,
    dropped: 0,
    deliveries: [],
    consecutiveFailures: 0,
    healthySince: null,
    statusSinceSpawn: false,
    spawnErrorDetail: null,
    missedPongs: 0,
    shuttingDown: false,
    removed: false,
    pingTimer: null,
    restartTimer: null,
    mock: false,
  });

  const startEntry = (entry) => {
    const key = workerKey(entry.plugin, entry.channelId);
    if (workers.has(key)) return;
    const w = makeRecord(entry);
    workers.set(key, w);
    if (entry.missingConfig.length) {
      setStatus(w, 'unconfigured', `missing config: ${entry.missingConfig.join(', ')}`);
      return;
    }
    if (mockMode()) {
      w.mock = true;
      w.identity = 'mock';
      setStatus(w, 'connected', null);
      return;
    }
    spawnWorker(w);
  };

  const stopWorker = async (w) => {
    w.removed = true;
    clearTimeout(w.restartTimer);
    clearInterval(w.pingTimer);
    const proc = w.proc;
    const kill = w.kill;
    if (!proc || proc.killed) { setStatus(w, 'disconnected', null); return; }
    w.shuttingDown = true;
    try { writeFrame(w, { type: 'shutdown' }); } catch { /* dying already */ }
    await new Promise((resolveWait) => {
      const t = setTimeout(kill, SHUTDOWN_GRACE_MS);
      t.unref?.();
      proc.once('exit', () => { clearTimeout(t); resolveWait(); });
      if (proc.exitCode !== null) { clearTimeout(t); resolveWait(); }
    });
  };

  const rpc = (w, frame, timeoutMs, kindOnTimeout = 'timeout') => new Promise((resolveRpc, rejectRpc) => {
    const timer = setTimeout(() => {
      w.pending.delete(frame.id);
      // Still queued behind backpressure? Drop it: a later drain must not
      // deliver a send the caller was already told had failed.
      const qi = w.outQueue.findIndex((f) => f && f.id === frame.id);
      if (qi >= 0) w.outQueue.splice(qi, 1);   // NOT counted in w.dropped (that means queue overflow)
      rejectRpc(new PluginOpError(kindOnTimeout, `worker did not answer within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    w.pending.set(frame.id, { resolve: resolveRpc, reject: rejectRpc, timer });
    try { writeFrame(w, frame); } catch (err) {
      w.pending.delete(frame.id);
      clearTimeout(timer);
      rejectRpc(err instanceof PluginOpError ? err : new PluginOpError('plugin', err?.message || String(err)));
    }
  });

  let rpcSeq = 0;

  return {
    /** Discover + start a worker per enabled, fully-configured channel. With a
     *  filter, start ONLY that channel — `worca plugin channel` must not spawn
     *  every configured channel (a second telegram long-poller 409s the live
     *  server's worker).
     *  @param {{plugin:string,channelId:string}} [filter] */
    start(filter) {
      for (const entry of discoverChannels()) {
        if (filter && (entry.plugin !== filter.plugin || entry.channelId !== filter.channelId)) continue;
        startEntry(entry);
      }
    },

    /** Shutdown frame -> grace -> SIGKILL, for every worker. */
    async stop() {
      stopping = true;
      await Promise.all([...workers.values()].map((w) => stopWorker(w)));
      workers.clear();
      stopping = false;
    },

    /** Restart the plugin's workers against fresh manifest/config (enable,
     *  disable, config save, install, update, uninstall all route here). */
    async reloadPlugin(name) {
      const mine = [...workers.values()].filter((w) => w.entry.plugin === name);
      await Promise.all(mine.map((w) => stopWorker(w)));
      for (const w of mine) workers.delete(w.key);
      for (const entry of discoverChannels().filter((e) => e.plugin === name)) startEntry(entry);
    },

    list() { return [...workers.values()].map((w) => w.entry); },

    /** UI/doctor status rows (redacted, ring-buffered deliveries included). */
    status() {
      return [...workers.values()].map((w) => ({
        plugin: w.entry.plugin,
        channelId: w.entry.channelId,
        displayName: w.entry.displayName,
        platform: w.entry.platform,
        ingress: w.entry.ingress,
        capabilities: w.entry.capabilities,
        state: w.state,
        detail: w.detail,
        identity: w.identity,
        dropped: w.dropped,
        restarts: w.consecutiveFailures,
        deliveries: w.deliveries.slice(),
        missingConfig: [...(w.entry.missingConfig || [])],
      }));
    },

    /**
     * Deliver one NormalizedMessage to one chat. Resolves {ok:true} or throws
     * PluginOpError with the worker-reported kind. Mock mode records instead.
     */
    async sendMessage({ plugin, channelId, chatId, message, options = null, timeoutMs = 15000 }) {
      if (!isValidMessage(message)) throw refused(new PluginOpError('plugin', 'invalid NormalizedMessage'));
      const w = workers.get(workerKey(plugin, channelId));
      if (!w) throw new PluginOpError('plugin', `no such channel worker "${plugin}/${channelId}"`);
      const interactive = w.entry.capabilities.interactive === true;
      if (options && !interactive) throw new PluginOpError('plugin', 'channel is not interactive (edits and threads need the interactive capability)');
      if (options && !isValidSendOptions(options)) throw new PluginOpError('plugin', 'invalid send options');
      const msg = interactive ? message : withoutControls(message);
      if (w.mock) {
        const behavior = _mockBehavior?.[w.key] ?? _mockBehavior?.['*'];
        _mockSent.push({ plugin, channelId, chatId, message: msg, ...(options ? { options } : {}) });
        if (behavior?.send) {
          const r = await behavior.send(chatId, msg, options); // may throw {kind, permanent?,...}
          pushDelivery(w, { chatId, ok: true });
          return r ?? { ok: true };
        }
        pushDelivery(w, { chatId, ok: true });
        return { ok: true };
      }
      if (w.state === 'unconfigured' || w.state === 'failed' || !w.proc) {
        throw new PluginOpError('plugin', `channel worker is ${w.state}`);
      }
      const id = `s-${++rpcSeq}`;
      const res = await rpc(w, { type: 'send', id, chatId, message: msg, ...(options ? { options } : {}) }, timeoutMs);
      if (res.ok) {
        pushDelivery(w, { chatId, ok: true });
        return { ok: true, ...(res.detail && typeof res.detail === 'object' && !Array.isArray(res.detail) ? { detail: res.detail } : {}) };
      }
      pushDelivery(w, { chatId, ok: false, errorKind: res.error?.kind || 'plugin' });
      const err = new PluginOpError(res.error?.kind || 'plugin', w.redact(res.error?.message || 'send failed'));
      if (Number.isFinite(res.error?.retryAfterMs)) err.retryAfterMs = res.error.retryAfterMs;
      throw res.error?.permanent === true ? refused(err) : err;
    },

    /** v2: an ephemeral answer to one acknowledged interaction (interactive channels). The worker holds the token. */
    async replyInteraction({ plugin, channelId, interactionId, text, timeoutMs = 15000 }) {
      const w = workers.get(workerKey(plugin, channelId));
      if (!w) throw new PluginOpError('plugin', `no such channel worker "${plugin}/${channelId}"`);
      if (w.entry.capabilities.interactive !== true) throw new PluginOpError('plugin', 'channel is not interactive');
      const body = String(text || '').slice(0, CONTROL_LIMITS.replyText) || '…';
      if (w.mock) { _mockReplies.push({ plugin, channelId, interactionId, text: body }); return { ok: true }; }
      if (w.state === 'unconfigured' || w.state === 'failed' || !w.proc) throw new PluginOpError('plugin', `channel worker is ${w.state}`);
      const res = await rpc(w, { type: 'interaction-reply', id: `r-${++rpcSeq}`, interactionId, text: body }, timeoutMs);
      if (res.ok) return { ok: true };
      throw new PluginOpError(res.error?.kind || 'plugin', w.redact(res.error?.message || 'reply failed'));
    },

    /** v2: add (`on`) or remove the bot's OWN reaction on one message (interactive channels). Resolves {ok:true} or
     *  throws PluginOpError; a refusal that would fail again (no permission, deleted message, a worker without
     *  react) is `permanent`. The default timeout outlasts the worker's own 429 ladder so a late reaction call cannot
     *  land after the next one. Mock mode calls behavior.react(frame) when the test set one. */
    async react({ plugin, channelId, chatId, messageId, emoji, on, timeoutMs = 60000 }) {
      const w = workers.get(workerKey(plugin, channelId));
      if (!w) throw new PluginOpError('plugin', `no such channel worker "${plugin}/${channelId}"`);
      if (w.entry.capabilities.interactive !== true) throw refused(new PluginOpError('plugin', 'channel is not interactive'));
      const frame = { chatId: String(chatId), messageId: String(messageId), emoji: String(emoji), on: on === true };
      if (w.mock) {
        const behavior = _mockBehavior?.[w.key] ?? _mockBehavior?.['*'];
        if (behavior?.react) await behavior.react(frame);   // may throw {kind, permanent?}
        return { ok: true };
      }
      if (w.state === 'unconfigured' || w.state === 'failed' || !w.proc) throw new PluginOpError('plugin', `channel worker is ${w.state}`);
      const res = await rpc(w, { type: 'react', id: `x-${++rpcSeq}`, ...frame }, timeoutMs);
      if (res.ok) return { ok: true };
      const err = new PluginOpError(res.error?.kind || 'plugin', w.redact(res.error?.message || 'reaction failed'));
      if (Number.isFinite(res.error?.retryAfterMs)) err.retryAfterMs = res.error.retryAfterMs;
      throw res.error?.permanent === true ? refused(err) : err;
    },

    /** v2 (live status): start (`on`) or stop the typing indicator in one chat (interactive channels). The worker keeps
     *  it alive until it is stopped. Resolves {ok:true} or throws PluginOpError; a refusal that would fail again (no
     *  access, a worker without typing) is `permanent`. Mock mode calls behavior.typing(frame) when the test set one. */
    async typing({ plugin, channelId, chatId, on, timeoutMs = 15000 }) {
      const w = workers.get(workerKey(plugin, channelId));
      if (!w) throw new PluginOpError('plugin', `no such channel worker "${plugin}/${channelId}"`);
      if (w.entry.capabilities.interactive !== true) throw refused(new PluginOpError('plugin', 'channel is not interactive'));
      const frame = { chatId: String(chatId), on: on === true };
      if (w.mock) {
        const behavior = _mockBehavior?.[w.key] ?? _mockBehavior?.['*'];
        if (behavior?.typing) await behavior.typing(frame);   // may throw {kind, permanent?}
        return { ok: true };
      }
      if (w.state === 'unconfigured' || w.state === 'failed' || !w.proc) throw new PluginOpError('plugin', `channel worker is ${w.state}`);
      const res = await rpc(w, { type: 'typing', id: `t-${++rpcSeq}`, ...frame }, timeoutMs);
      if (res.ok) return { ok: true };
      const err = new PluginOpError(res.error?.kind || 'plugin', w.redact(res.error?.message || 'typing failed'));
      if (Number.isFinite(res.error?.retryAfterMs)) err.retryAfterMs = res.error.retryAfterMs;
      throw res.error?.permanent === true ? refused(err) : err;
    },

    /** v2 (chat context): up to `limit` messages of one chat before one message, oldest first, as quoted messages
     *  (channel-protocol.mjs isValidQuotedMessage). Interactive channels only; the worker decides what it may read.
     *  Throws PluginOpError; a refusal that would fail again (no access, a worker without history) is `permanent`.
     *  The default timeout outlasts the worker's own short 429 waits. Mock mode asks behavior.history(frame). */
    async history({ plugin, channelId, chatId, before, limit, timeoutMs = 30000 }) {
      const w = workers.get(workerKey(plugin, channelId));
      if (!w) throw new PluginOpError('plugin', `no such channel worker "${plugin}/${channelId}"`);
      if (w.entry.capabilities.interactive !== true) throw refused(new PluginOpError('plugin', 'channel is not interactive'));
      const frame = { chatId: String(chatId), before: String(before),
        limit: Math.max(1, Math.min(INBOUND_LIMITS.history, Math.trunc(Number(limit)) || 1)) };
      let messages;
      if (w.mock) {
        const behavior = _mockBehavior?.[w.key] ?? _mockBehavior?.['*'];
        messages = behavior?.history ? await behavior.history(frame) : [];   // may throw {kind, permanent?}
      } else {
        if (w.state === 'unconfigured' || w.state === 'failed' || !w.proc) throw new PluginOpError('plugin', `channel worker is ${w.state}`);
        const res = await rpc(w, { type: 'history', id: `h-${++rpcSeq}`, ...frame }, timeoutMs);
        if (!res.ok) {
          const err = new PluginOpError(res.error?.kind || 'plugin', w.redact(res.error?.message || 'history read failed'));
          if (Number.isFinite(res.error?.retryAfterMs)) err.retryAfterMs = res.error.retryAfterMs;
          throw res.error?.permanent === true ? refused(err) : err;
        }
        messages = res.detail?.messages;
      }
      if (!isValidHistory(messages)) throw new PluginOpError('protocol', 'the channel worker answered an invalid history');
      return messages.slice(-frame.limit);
    },

    /** Tests: the interaction twin of injectInboundMessage. */
    injectInteraction(plugin, channelId, evt) {
      const w = workers.get(workerKey(plugin, channelId));
      if (!w) throw new Error(`no such channel worker "${plugin}/${channelId}"`);
      handleFrame(w, { type: 'interaction', evt });
    },

    /** Teams ingress: forward one raw HTTP request to the worker, get back
     *  {statusCode, headers?, bodyB64?}. Worker down -> PluginOpError. */
    async handleWebhook({ plugin, channelId, method, path, headers, bodyB64, timeoutMs = 10000 }) {
      const w = workers.get(workerKey(plugin, channelId));
      if (!w) throw new PluginOpError('plugin', `no such channel worker "${plugin}/${channelId}"`);
      if (w.mock) {
        const behavior = _mockBehavior?.[w.key] ?? _mockBehavior?.['*'];
        if (behavior?.webhook) return behavior.webhook({ method, path, headers, bodyB64 });
        return { statusCode: 200 };
      }
      if (!w.proc) throw new PluginOpError('plugin', `channel worker is ${w.state}`);
      const id = `w-${++rpcSeq}`;
      const res = await rpc(w, { type: 'webhook', id, method, path, headers, bodyB64 }, timeoutMs);
      return { statusCode: res.statusCode, headers: res.headers, bodyB64: res.bodyB64 };
    },

    /** Tests/mocks: drive the full inbound pipeline without a process. */
    injectInboundMessage(plugin, channelId, msg) {
      const w = workers.get(workerKey(plugin, channelId));
      if (!w) throw new Error(`no such channel worker "${plugin}/${channelId}"`);
      handleFrame(w, { type: 'inbound', msg });
    },

    /** One-shot `--check` spawn: run the module's validateConfig offline
     *  (doctor / `worca plugin channel --check`). */
    async checkChannel(plugin, channelId, { timeoutMs = 30000 } = {}) {
      const entry = discoverChannels().find((e) => e.plugin === plugin && e.channelId === channelId);
      if (!entry) throw new PluginOpError('plugin', `no such chat channel "${plugin}/${channelId}"`);
      if (mockMode()) return { ok: true, mock: true };
      warnWithheldProxy();
      return new Promise((resolveCheck, rejectCheck) => {
        const run = pluginChildSpawn([CHILD_PATH, '--check']);
        const proc = _spawn(run.file, run.args, { ...run.options, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let settled = false;
        const timer = setTimeout(() => { settled = true; killPluginChild(proc, run.user); rejectCheck(new PluginOpError('timeout', `validateConfig timed out after ${timeoutMs}ms`)); }, timeoutMs);
        timer.unref?.();
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (d) => { stdout += d; });
        proc.on('exit', () => {
          if (settled) return;
          clearTimeout(timer);
          const line = stdout.trim().split('\n').filter(Boolean).pop();
          try { resolveCheck(JSON.parse(line)); }
          catch { rejectCheck(new PluginOpError('protocol', 'validateConfig produced no result frame')); }
        });
        proc.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          rejectCheck(new PluginOpError('plugin', `validateConfig child failed: ${err?.message || err}`));
        });
        proc.stdin.on('error', () => { /* EPIPE on dying child: exit/error handlers own it */ });
        try {
          proc.stdin.write(encodeFrame({
            type: 'hello',
            apiVersion: entry.apiVersion,
            plugin, channelId,
            platform: entry.platform,
            module: entry.modulePath,
            config: readPluginConfig(plugin, entry.configSchema),
            state: readPluginState(plugin),
            mock: false,
          }));
        } catch { /* dying child: handlers above settle the promise */ }
      });
    },
  };
}
