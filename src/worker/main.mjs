// src/worker/main.mjs
// `worca worker`: the process that runs in a worker container. It reads its assignment from the
// environment (set by the controller's backend when it started the container), connects to the
// controller, and executes what it is sent until released. It opens no database and serves no
// HTTP; the shared volume is mounted at the same paths as on the controller.
//
//   WORCA_CONTROLLER_URL     ws://<controller host>:<worker port>   (required)
//   WORCA_WORKER_TOKEN       the one-time token, or WORCA_WORKER_TOKEN_FILE  (required)
//   WORCA_WORKER_SCOPE       run:<pipeline id> | chat:<thread id>     (required)
//   WORCA_WORKER_ID          the id the controller expects in the hello (required)
//   WORCA_WORKER_IDLE_MS     leave after this long with nothing to run (chat workers)
//
// Exit codes: 0 after a shutdown, an idle timeout or a refusal it was told about; 1 when the
// connection dropped; 78 (EX_CONFIG) when the assignment is incomplete; `--check` prints the
// capabilities as JSON and exits 0 without connecting (image smoke tests).
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { worcaHome } from '../core/projects.mjs';
import { parseScopeKey } from '../core/executor/scope.mjs';
import { workerHomeDir } from '../core/executor/index.mjs';
import { envInt } from '../core/executor/shared.mjs';
import { seedClaudeLogin } from '../core/executor/login-seed.mjs';
export { seedClaudeLogin };   // the rule lives in executor/login-seed.mjs (the controller reclaims by the same rule)
import { probeCapabilities } from './capabilities.mjs';
import { startWorker } from './client.mjs';
import { startRelayShim, DEFAULT_RELAY_PORT } from './relay-shim.mjs';

/** How long a worker keeps trying to make its FIRST connection to the controller. */
const CONNECT_RETRY_MS = 30_000;
export const EX_CONFIG = 78;

/** The assignment from the environment, or `{ errors }`. Pure over `env`. */
export function readWorkerConfig(env = process.env) {
  const errors = [];
  const url = String(env.WORCA_CONTROLLER_URL || '').trim();
  if (!/^wss?:\/\//.test(url)) errors.push(url ? `WORCA_CONTROLLER_URL must be a ws:// or wss:// URL (got ${url})` : 'WORCA_CONTROLLER_URL is not set');
  const scope = parseScopeKey(String(env.WORCA_WORKER_SCOPE || '').trim());
  if (!scope) errors.push(env.WORCA_WORKER_SCOPE ? `WORCA_WORKER_SCOPE must be run:<id> or chat:<id> (got ${env.WORCA_WORKER_SCOPE})` : 'WORCA_WORKER_SCOPE is not set');
  let token = String(env.WORCA_WORKER_TOKEN || '').trim();
  if (!token && env.WORCA_WORKER_TOKEN_FILE) {
    try { token = readFileSync(env.WORCA_WORKER_TOKEN_FILE, 'utf8').trim(); } catch (err) { errors.push(`WORCA_WORKER_TOKEN_FILE: ${err.message}`); }
  }
  if (!token) errors.push('WORCA_WORKER_TOKEN (or WORCA_WORKER_TOKEN_FILE) is not set');
  const workerId = String(env.WORCA_WORKER_ID || '').trim();
  if (!workerId) errors.push('WORCA_WORKER_ID is not set');
  const idle = Number(env.WORCA_WORKER_IDLE_MS);
  const idleMs = Number.isFinite(idle) && idle > 0 ? idle : null;
  if (errors.length) return { errors };
  // The controller's rule (executor/index.mjs workerHomeDir), under the worca home this env names: the controller cleans
  // the folder up by the same path, so nothing overrides it.
  const home = workerHomeDir(scope, worcaHome(env));
  return { url, scope, token, workerId, home, idleMs, errors: [] };
}

/** `worca worker [--check]` entry. Returns the exit code. */
export async function runWorkerCli(args = [], { env = process.env, out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`), start = startWorker, signals = process } = {}) {
  if (args.includes('--check')) {
    out(JSON.stringify(await probeCapabilities({ env }), null, 2));
    return 0;
  }
  const cfg = readWorkerConfig(env);
  if (cfg.errors.length) { for (const e of cfg.errors) err(`worca worker: ${e}`); return EX_CONFIG; }
  // The token leaves the environment before any child can read it: the engine probes below spawn every CLI's
  // `--version`, and children get their env from the controller anyway.
  delete env.WORCA_WORKER_TOKEN; delete env.WORCA_WORKER_TOKEN_FILE;
  const graceMs = envInt(env, 'WORCA_SIGTERM_GRACE_MS', 5000);
  try { mkdirSync(cfg.home, { recursive: true, mode: 0o700 }); } catch (e) { err(`worca worker: cannot create HOME ${cfg.home}: ${e.message}`); return EX_CONFIG; }
  const seeded = seedClaudeLogin(cfg.home, env.WORCA_WORKER_SEED_CLAUDE);
  if (seeded.length) out(`worca worker: seeded ${seeded.join(', ')} from ${env.WORCA_WORKER_SEED_CLAUDE}`);
  const capabilities = await probeCapabilities({ env });
  const installed = Object.entries(capabilities.engines).filter(([, v]) => v).map(([k, v]) => `${k} ${v.version || '?'}`);
  out(`worca worker ${cfg.workerId} for ${cfg.scope.kind}:${cfg.scope.id} — engines: ${installed.join(', ') || 'none'}; HOME ${cfg.home}`);
  // Before every spawn too: a login renewed on the controller (`worca container login`) while this worker lives must
  // reach the next step, not only the next worker (executor/login-seed.mjs).
  const beforeExec = () => { const again = seedClaudeLogin(cfg.home, env.WORCA_WORKER_SEED_CLAUDE); if (again.length) out(`worca worker: seeded ${again.join(', ')} again (the seed is newer)`); };
  let w = start({ ...cfg, capabilities, lostGraceMs: graceMs, log: out, beforeExec });
  // The chat relay on this container's loopback (relay-shim.mjs); a chat turn's MCP child posts to it.
  let shim = null;
  const relayPort = envInt(env, 'WORCA_WORKER_RELAY_PORT', DEFAULT_RELAY_PORT);
  const relayTimeout = envInt(env, 'WORCA_WORKER_RELAY_TIMEOUT_MS', undefined);
  try { shim = await startRelayShim({ relay: (token, line, o) => w.relay(token, line, o), port: relayPort, ...(relayTimeout ? { timeoutMs: relayTimeout } : {}), log: out }); }
  catch (e) { err(`worca worker: relay shim could not listen on 127.0.0.1:${relayPort} (${e.message}); chats on this worker will have no worca tools`); }
  let stopping = false;
  const onSignal = () => { stopping = true; w.leave(graceMs, { cut: true }); };   // from outside: a live step is lost, not finished
  signals.on('SIGTERM', onSignal);
  signals.on('SIGINT', onSignal);
  // There is no reconnect once connected. But a FIRST connect that cannot be made — the controller's Service has no
  // ready endpoint yet, its name does not resolve yet — is retried for a short while: the token is still good, and
  // giving up at once would cost the run the controller's whole start timeout.
  const retry = Number(env.WORCA_WORKER_CONNECT_RETRY_MS);
  const deadline = Date.now() + (Number.isFinite(retry) && retry >= 0 ? retry : CONNECT_RETRY_MS);
  let code;
  for (let attempt = 1; ; attempt += 1) {
    code = await w.done;
    if (code === 0 || w.connected || w.refusedStatus != null || stopping || Date.now() >= deadline) break;
    out(`worca worker: the controller at ${cfg.url} is not reachable yet (${w.endedWith}); trying again`);
    await new Promise((r) => setTimeout(r, Math.min(500 * attempt, 3000)));
    if (stopping) break;   // told to stop while it waited: no new attempt (the previous one's exit code stands)
    w = start({ ...cfg, capabilities, lostGraceMs: graceMs, log: out });
  }
  signals.off('SIGTERM', onSignal);
  signals.off('SIGINT', onSignal);
  await shim?.close();
  return code;
}


