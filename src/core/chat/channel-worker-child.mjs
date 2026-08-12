// src/core/chat/channel-worker-child.mjs
// Persistent channel-worker bootstrap (chat-connectivity-design.md §4.4) — the
// long-lived analog of plugin-shim-child.mjs. Runs with a scrubbed env
// ({PATH, HOME}), so it imports NOTHING from the worca core graph except the
// dependency-free channel-protocol module. Protocol: JSON-lines both ways;
// first host frame is `hello` (config+secrets+state via stdin ONLY, never
// argv/env); the process stays up until `shutdown`/stdin-EOF or a crash
// (nonzero exit -> the supervisor restarts with backoff).
//
// The plugin module must export:
//   createChannelWorker(ctx) -> { start(), stop(), send(chatId, msg),
//                                 handleWebhook?(req), onConfig?(config) }
//   validateConfig?(config)  -> {ok:true, identity?} | {ok:false, errors:[...]}
// ctx = { apiVersion, platform, mock, config, state:{get,set}, log,
//         emitMessage, setStatus, shutdownSignal }
//
// `--check` argv mode (doctor / `worca plugin channel --check`): read hello,
// run validateConfig once, write ONE result line, exit 0.

import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { encodeFrame, decodeFrame, isValidIncoming, isValidMessage, CONNECTION_STATES } from './channel-protocol.mjs';

const CHECK_MODE = process.argv.includes('--check');
const MAX_LOG_CHARS = 8 * 1024;

function writeFrame(frame) {
  try { process.stdout.write(encodeFrame(frame)); } catch { /* oversize/broken pipe: drop */ }
}

// stdout is protocol-reserved: any stray console.* from plugin code becomes a
// log frame instead of corrupting the stream (shim-child rule, made survivable
// for a persistent process).
function shimConsole() {
  const to = (level) => (...args) => {
    const msg = args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
    writeFrame({ type: 'log', level, msg: msg.slice(0, MAX_LOG_CHARS) });
  };
  console.log = to('info');
  console.info = to('info');
  console.warn = to('warn');
  console.error = to('error');
}

function errKind(err) {
  const kinds = ['auth', 'rate-limit', 'network', 'plugin', 'timeout', 'protocol'];
  return kinds.includes(err?.kind) ? err.kind : 'plugin';
}

async function main() {
  process.stdin.setEncoding('utf8');
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const iter = lines[Symbol.asyncIterator]();

  const first = await iter.next();
  if (first.done) process.exit(1);
  const hello = decodeFrame(first.value);
  if (!hello || hello.type !== 'hello') {
    process.stderr.write('channel-worker-child: first frame must be a valid hello\n');
    process.exit(1);
  }

  const config = { ...hello.config };
  const stateSnapshot = { ...hello.state };
  const shutdownController = new AbortController();

  const ctx = {
    apiVersion: hello.apiVersion,
    platform: hello.platform,
    mock: hello.mock === true,
    config,
    state: {
      // get() prefers writes made this session; set() RECORDS and emits — the
      // HOST persists via writePluginState (shim stateDelta semantics).
      get: async (k) => (stateSnapshot[k] ?? null),
      set: async (k, v) => { stateSnapshot[k] = v; writeFrame({ type: 'state-delta', delta: { [k]: v } }); },
    },
    log: (level, msg) => writeFrame({ type: 'log', level: String(level || 'info'), msg: String(msg).slice(0, MAX_LOG_CHARS) }),
    emitMessage: (msg) => {
      if (!isValidIncoming(msg)) { ctx.log('warn', 'emitMessage: invalid IncomingMessage dropped'); return; }
      writeFrame({ type: 'inbound', msg: { chatId: msg.chatId, userId: msg.userId, text: msg.text, meta: msg.meta ?? {} } });
    },
    setStatus: (state, detail) => {
      if (!CONNECTION_STATES.includes(state)) return;
      writeFrame({ type: 'status', state, detail: detail == null ? null : String(detail) });
    },
    shutdownSignal: shutdownController.signal,
  };

  shimConsole();

  const mod = await import(pathToFileURL(hello.module).href);

  if (CHECK_MODE) {
    let result;
    try {
      result = typeof mod.validateConfig === 'function'
        ? await mod.validateConfig(config)
        : { ok: true, skipped: 'plugin exports no validateConfig' };
    } catch (err) {
      result = { ok: false, errors: [{ field: null, message: err?.message || String(err) }] };
    }
    process.stdout.write(`${JSON.stringify(result ?? { ok: false, errors: [{ field: null, message: 'validateConfig returned nothing' }] })}\n`, () => process.exit(0));
    return;
  }

  if (typeof mod.createChannelWorker !== 'function') {
    process.stderr.write(`channel module has no createChannelWorker export: ${hello.module}\n`);
    process.exit(1);
  }
  const worker = mod.createChannelWorker(ctx);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownController.abort();
    try { await worker.stop?.(); } catch { /* best effort */ }
    process.exit(0);
  };

  // start() owns the platform connection; ready (with optional identity, e.g.
  // '@worca_bot' from getMe) is emitted by the CHILD once start resolves.
  // A start() failure is a crash: nonzero exit -> supervisor backoff, and auth
  // failures should setStatus('disconnected', ...) + return instead of throwing
  // when a restart cannot help.
  let startInfo;
  try {
    startInfo = await worker.start?.();
  } catch (err) {
    process.stderr.write(`worker start failed: ${err?.message || err}\n`);
    process.exit(1);
  }
  writeFrame({ type: 'ready', identity: startInfo?.identity ?? null });

  for await (const line of lines) {
    const frame = decodeFrame(line);
    if (!frame) { ctx.log('warn', 'invalid host frame dropped'); continue; }
    switch (frame.type) {
      case 'send': {
        (async () => {
          try {
            if (!isValidMessage(frame.message)) throw Object.assign(new Error('invalid NormalizedMessage'), { kind: 'protocol' });
            const r = await worker.send(frame.chatId, frame.message);
            writeFrame({ type: 'send-result', id: frame.id, ok: true, ...(r && typeof r === 'object' ? { detail: r } : {}) });
          } catch (err) {
            writeFrame({
              type: 'send-result', id: frame.id, ok: false,
              error: {
                kind: errKind(err), message: err?.message || String(err),
                ...(Number.isFinite(err?.retryAfterMs) ? { retryAfterMs: err.retryAfterMs } : {}),
              },
            });
          }
        })();
        break;
      }
      case 'webhook': {
        (async () => {
          try {
            if (typeof worker.handleWebhook !== 'function') {
              writeFrame({ type: 'webhook-result', id: frame.id, statusCode: 501 });
              return;
            }
            const res = await worker.handleWebhook({ method: frame.method, path: frame.path, headers: frame.headers, bodyB64: frame.bodyB64 });
            writeFrame({
              type: 'webhook-result', id: frame.id,
              statusCode: Number.isInteger(res?.statusCode) ? res.statusCode : 200,
              ...(res?.headers ? { headers: res.headers } : {}),
              ...(typeof res?.bodyB64 === 'string' ? { bodyB64: res.bodyB64 } : {}),
            });
          } catch (err) {
            ctx.log('error', `handleWebhook failed: ${err?.message || err}`);
            writeFrame({ type: 'webhook-result', id: frame.id, statusCode: 500 });
          }
        })();
        break;
      }
      case 'config': {
        Object.keys(config).forEach((k) => { if (!(k in frame.config)) delete config[k]; });
        Object.assign(config, frame.config);
        try { await worker.onConfig?.(config); } catch (err) { ctx.log('warn', `onConfig failed: ${err?.message || err}`); }
        break;
      }
      case 'ping':
        writeFrame({ type: 'pong', id: frame.id });
        break;
      case 'shutdown':
        await shutdown();
        break;
      case 'hello':
        ctx.log('warn', 'duplicate hello ignored');
        break;
      default:
        ctx.log('warn', `unexpected host frame "${frame.type}" ignored`);
    }
  }
  // stdin EOF = host died or closed us: treat as shutdown.
  await shutdown();
}

main().catch((err) => {
  process.stderr.write(`channel-worker-child crashed: ${err?.stack || err}\n`);
  process.exit(1);
});
