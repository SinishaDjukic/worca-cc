// src/core/executor/session.mjs
// One authenticated worker connection on the controller: the exec/signal side the remote child
// (remote-child.mjs) drives, the frame router for what the worker sends back, flow control
// (acks), liveness (pings) and loss handling. Created by the registry once a worker's hello
// has been accepted; it never decides WHICH worker a spawn goes to.
import { randomBytes } from 'node:crypto';
import { encodeFrame, decodeFrame, ACK_EVERY } from './protocol.mjs';

const DEFAULT_PING_MS = 30_000;
/** How long a worker may take to answer a shutdown frame with its bye before the socket is cut. */
const SHUTDOWN_SLACK_MS = 5_000;

/**
 * @param {import('ws').WebSocket} ws   an open socket whose hello was accepted
 * @param {{ workerId: string, scope: {kind:string,id:string}, capabilities: object, pid: number,
 *   pingMs?: number, ackEvery?: number, log?: (msg:string) => void,
 *   onRelay?: (frame:object) => Promise<{lines?:string[]|null, error?:string|null}> }} o
 */
/** An env as child_process.spawn takes it — unset values dropped, the rest as strings — which is what an adapter
 *  may hand over (a number, an `undefined` from an optional setting) and what the frame's strict validation needs. */
const stringEnv = (env) => Object.fromEntries(Object.entries(env || {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));

export function createWorkerSession(ws, { workerId, scope, capabilities, pid, pingMs = DEFAULT_PING_MS, ackEvery = ACK_EVERY, log = () => {}, onRelay = null }) {
  const execs = new Map();   // exec id -> handlers
  const closeFns = new Set();
  let closed = false;
  let closeReason = null;
  let byeSeen = false;
  let execSeq = 0;
  let pingTimer = null;
  let pending = 0;   // pings without a pong
  const startedAt = Date.now();
  let lastActiveAt = Date.now();

  const send = (frame) => {
    if (closed) throw new Error(`worker ${workerId} is gone (${closeReason})`);
    // ws discards a frame on a closing or closed socket without a word when no callback is given: say so instead.
    if (ws.readyState !== 1) throw Object.assign(new Error('socket is not open'), { code: 'ENOTCONN' });
    ws.send(encodeFrame(frame));
  };
  const trySend = (frame) => { try { send(frame); } catch { /* closing */ } };
  /** Answer a worker's relay. An answer that cannot be sent (too large for a frame) is answered with an error instead:
   *  silence would leave the chat's tool call waiting for the shim's own timeout. */
  const relayResult = (id, lines, error) => {
    const e = error == null ? null : String(error).slice(0, 4000);
    try { send({ type: 'relay-result', id, lines, error: e }); }
    catch (err) { trySend({ type: 'relay-result', id, lines: null, error: `relay: the answer could not be sent (${String(err?.message || err).slice(0, 200)})` }); }
  };

  const settle = (reason) => {
    if (closed) return;
    closed = true;
    closeReason = reason;
    clearInterval(pingTimer);
    const hadExecs = execs.size > 0;   // the listeners learn whether a step was cut: the execs are gone by then
    for (const [id, h] of execs) { execs.delete(id); try { h.onLost(reason); } catch { /* listener */ } }
    for (const fn of closeFns) { try { fn(reason, { hadExecs }); } catch { /* listener */ } }
  };

  const onFrame = (frame) => {
    const h = frame.id != null ? execs.get(frame.id) : null;
    switch (frame.type) {
      case 'started': if (h) h.onStarted({ pid: frame.pid }); return;
      case 'spawn-error': if (h) { execs.delete(frame.id); h.onSpawnError({ code: frame.code ?? null, message: frame.message }); } return;
      case 'out':
        lastActiveAt = Date.now();
        if (h) h.onLines({ stream: frame.stream, lines: frame.lines, more: frame.more === true });
        // Flow control: acknowledge every Nth frame; the worker pauses past its window otherwise.
        if (frame.seq % ackEvery === ackEvery - 1) trySend({ type: 'ack', id: frame.id, seq: frame.seq });
        return;
      case 'exit':
        lastActiveAt = Date.now();
        if (h) { execs.delete(frame.id); h.onExit({ code: frame.code, signal: frame.signal }); }
        return;
      case 'ping': trySend({ type: 'pong', id: frame.id }); return;
      case 'pong': pending = 0; return;
      case 'relay':
        if (!onRelay) { trySend({ type: 'relay-result', id: frame.id, lines: null, error: 'relay is not available' }); return; }
        Promise.resolve().then(() => onRelay(frame)).then(
          (r) => relayResult(frame.id, r?.lines ?? null, r?.error ?? null),
          (err) => relayResult(frame.id, null, err?.message || 'relay failed'),
        );
        return;
      case 'log': log(`[worker ${workerId}] ${frame.level}: ${frame.msg}`); return;
      case 'bye': byeSeen = true; return;
      default: return;   // a controller-direction frame echoed back: ignored
    }
  };

  ws.on('message', (data) => {
    const frame = decodeFrame(data);
    if (!frame) { log(`[worker ${workerId}] protocol violation: dropping the connection`); try { ws.close(4002, 'protocol violation'); } catch { /* closing */ } return; }
    onFrame(frame);
  });
  ws.on('close', (code, reason) => settle(byeSeen ? 'bye' : `socket closed (${code}${reason?.length ? ` ${reason}` : ''})`));
  ws.on('error', (err) => settle(`socket error: ${err?.message || err}`));

  pingTimer = setInterval(() => {
    if (closed) return;
    if (pending > 0) { log(`[worker ${workerId}] no pong in ${pingMs} ms: dropping the connection`); try { ws.terminate(); } catch { /* gone */ } settle('ping timeout'); return; }
    pending += 1;
    trySend({ type: 'ping', id: `p${Date.now()}` });
  }, pingMs);
  pingTimer.unref?.();

  return {
    workerId, scope, capabilities, pid, startedAt,
    get closed() { return closed; },
    get closeReason() { return closeReason; },
    get liveExecCount() { return execs.size; },
    /** The worker said bye (it idled out, or answered a shutdown): its socket is closing, nothing more can run on it. */
    get leaving() { return byeSeen; },
    get lastActiveAt() { return lastActiveAt; },
    touch() { lastActiveAt = Date.now(); },
    /**
     * Start one process on the worker. Returns the exec id at once; outcomes arrive on the
     * handlers (`onStarted`, `onLines`, `onSpawnError`, `onExit`, `onLost`).
     */
    exec(spec, handlers) {
      const id = `x${++execSeq}-${randomBytes(4).toString('hex')}`;
      execs.set(id, handlers);
      lastActiveAt = Date.now();
      try {
        send({ type: 'exec', id, file: spec.file, args: spec.args, cwd: spec.cwd ?? null, env: stringEnv(spec.env), stdin: spec.stdin ?? null, detached: spec.detached !== false, ...(spec.reap ? { reap: true } : {}), ...(spec.withheld?.length ? { withheld: spec.withheld } : {}) });
      } catch (err) {
        execs.delete(id);
        // A frame the protocol refuses carries its own code (EPROTO malformed, E2BIG too large); anything else is the
        // socket: the worker is gone, which the failure policy retries on a fresh one like any lost worker.
        const lost = closed || !err?.code || err.code === 'ENOTCONN';   // a socket already closing counts as gone
        queueMicrotask(() => handlers.onSpawnError({ code: lost ? 'EWORKERLOST' : err.code, message: err.message, ...(lost ? { errorClass: 'network' } : {}) }));
      }
      return id;
    },
    signal(id, sig) {
      if (!execs.has(id)) return;
      trySend({ type: 'signal', id, sig });
    },
    /** Ask the worker to end its processes and leave; resolves once the socket is closed. */
    shutdown({ graceMs = 5000 } = {}) {
      if (closed) return Promise.resolve();
      graceMs = Math.max(0, Math.floor(Number(graceMs) || 0));   // the frame carries a whole number; a float must not lose the request
      trySend({ type: 'shutdown', graceMs });
      return new Promise((resolve) => {
        const t = setTimeout(() => { try { ws.terminate(); } catch { /* gone */ } settle('shutdown timeout'); resolve(); }, graceMs + SHUTDOWN_SLACK_MS);
        t.unref?.();
        closeFns.add(() => { clearTimeout(t); resolve(); });
      });
    },
    /** Cut the socket now (the worker will kill its children when it notices). */
    terminate(reason = 'terminated') {
      try { ws.terminate(); } catch { /* gone */ }
      settle(reason);
    },
    onClose(fn) { closeFns.add(fn); return () => closeFns.delete(fn); },
  };
}
