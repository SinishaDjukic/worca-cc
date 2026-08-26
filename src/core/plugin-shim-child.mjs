// src/core/plugin-shim-child.mjs
// Ephemeral connector runner (spec §7.2). Deliberately imports NOTHING from
// worca: it runs with a scrubbed env (PATH+HOME only, no WORCA_HOME), so any
// store/db import here would resolve wrong paths. Protocol: read ONE JSON doc
// from stdin, run ONE op, write ONE JSON frame to stdout, exit 0. The child
// ALWAYS exits 0 after writing a frame — a nonzero exit means "crashed before
// the frame" and the parent maps it to PluginOpError('protocol').
import { pathToFileURL } from 'node:url';

const logs = [];

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
// the parent's timeout SIGKILL is the only way out; process.exit(0) after the
// frame ends the process regardless.
setInterval(() => {}, 1 << 30);

main()
  .catch((err) => ({
    ok: false,
    error: { kind: err?.kind || 'plugin', message: err?.message || String(err) },
    logs,
  }))
  .then((frame) => {
    // Write-callback before exit so a piped stdout is fully flushed.
    process.stdout.write(JSON.stringify(frame), () => process.exit(0));
  });
