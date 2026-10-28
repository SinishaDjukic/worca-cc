// src/core/plugin-shim-child.mjs
// Ephemeral connector runner (spec §7.2). Deliberately imports nothing from
// worca but env-proxy.mjs (node builtins and undici, no store): it runs with a
// scrubbed env (PATH, HOME, the proxy and CA variables, no WORCA_HOME), so any
// store/db import here would resolve wrong paths. Protocol: read ONE JSON doc
// from stdin, run ONE op, write ONE JSON frame to stdout, exit 0. The child
// exits 0 after writing a frame. A nonzero exit with no complete frame on
// stdout means "crashed before the frame" and the parent maps it to
// PluginOpError('protocol'); a complete frame is kept even when the exit itself
// crashes (Node 24 on Windows can, after a connector's HTTPS fetch).
import { pathToFileURL } from 'node:url';
import { useEnvProxy, proxyNotice } from './env-proxy.mjs';

const logs = [];

// The connector's fetch() honors HTTP(S)_PROXY / NO_PROXY like worca's own:
// same NO_PROXY merge, loopback always direct. A proxy that can't be applied is
// a warning in the op's logs instead of a bare "fetch failed".
const proxyLine = proxyNotice(useEnvProxy());
if (proxyLine?.level === 'warn') logs.push({ level: 'warn', msg: proxyLine.text });

async function main() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const msg = JSON.parse(raw);

  // ctx.state: plain-object snapshot + mutation collection. get() prefers the
  // delta so a connector reads back its own writes within the op; set() only
  // RECORDS — the HOST applies the delta via writePluginState after the frame.
  const snapshot = msg.state && typeof msg.state === 'object' ? msg.state : {};
  const stateDelta = {};
  const ctx = {
    apiVersion: msg.apiVersion ?? 1,
    // Which profile this op runs against. config/state are ALREADY that
    // profile's — the id is here for connectors that keep their own storage and
    // must key it the same way (e.g. a per-profile CLI config dir).
    profile: typeof msg.profile === 'string' && msg.profile ? msg.profile : 'default',
    config: msg.config && typeof msg.config === 'object' ? msg.config : {},
    state: {
      get: async (k) => (k in stateDelta ? stateDelta[k] : (snapshot[k] ?? null)),
      set: async (k, v) => { stateDelta[k] = v; },
    },
    log: (level, text) => { logs.push({ level, msg: String(text) }); }, // stdout is protocol-reserved
  };

  const mod = await import(pathToFileURL(msg.module).href);
  if (typeof mod.default !== 'function') {
    throw Object.assign(new Error(`connector module has no default-export factory: ${msg.module}`), { kind: 'plugin' });
  }
  const source = mod.default(ctx);
  const fn = source?.[msg.op];
  if (typeof fn !== 'function') {
    // Optional ops (e.g. capabilities) land here. The kind is 'unimplemented',
    // NOT 'plugin': an op the connector lacks and an implemented op that
    // CRASHED must stay distinguishable — the capabilities probe defaults
    // writeBack:true only for the former (Task 13 / sources.mjs).
    throw Object.assign(new Error(`connector does not implement op "${msg.op}"`), { kind: 'unimplemented' });
  }

  // §7.1 signatures: getTask(id) and reportResult(id, r) are positional; every
  // other op takes the single args object (listTasks(q), validateConfig(), …).
  const args = msg.args && typeof msg.args === 'object' ? msg.args : {};
  let result;
  if (msg.op === 'getTask') {
    result = await fn.call(source, args.id);
  } else if (msg.op === 'reportResult') {
    const { id, ...r } = args;
    result = await fn.call(source, id, r);
  } else {
    result = await fn.call(source, args);
  }
  return { ok: true, result: result === undefined ? null : result, stateDelta, logs };
}

// A pending op promise alone does not keep the event loop alive: a hung
// connector with no live handles would exit 0 with NO frame (parent would see
// 'protocol', not 'timeout'). Hold the loop open so a hung op stays hung and
// the parent's timeout SIGKILL is the only way out. The hold is released only
// once the frame is written.
const hold = setInterval(() => {}, 1 << 30);

// After the frame, a connector's leftover handle (a timer, a socket) may still
// keep the loop alive: process.exit(0) ends the child after this grace.
const EXIT_GRACE_MS = 500;

main()
  .catch((err) => ({
    ok: false,
    error: { kind: err?.kind || 'plugin', message: err?.message || String(err) },
    logs,
  }))
  .then((frame) => {
    // Write-callback first so a piped stdout is fully flushed. Then let the loop
    // end on its own: on Windows, Node 24's process.exit(0) right after a
    // connector's HTTPS fetch can crash in libuv (exit 0xC0000409); a natural
    // end does not. The unref'd fallback never keeps the child alive itself.
    process.stdout.write(JSON.stringify(frame), () => {
      // stdout carries ONE frame: whatever a connector's leftover work prints
      // after it is dropped, as the immediate exit used to drop it.
      process.stdout.write = () => true;
      clearInterval(hold);
      setTimeout(() => process.exit(0), EXIT_GRACE_MS).unref();
    });
  });
