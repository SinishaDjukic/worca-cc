// src/core/exec-env/remote-env.mjs
// One remote sandbox per run, on any backend (plans/e2b-execution-design.md §5–§10, §17). Paths are
// MIRRORED: a host path P lives at sb(P) = prefix + P in the sandbox, prefix '' on real E2B (the
// loopback fakes set one). Every backend call goes through _call so a gone sandbox marks the env
// `lost`, which the harness turns into a clean terminal failure. The backend's client (exec-env/backend.mjs
// BackendClient) is the only thing that knows the provider. Sync runs at the SPAWN boundary
// (RemoteChild, runInProcess): executors read results right after a spawn.
import { createHash } from 'node:crypto';
import { readFile, writeFile, appendFile, mkdir, rename, rm, stat, readdir, lstat } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteChild } from './remote-child.mjs';
import { shq, shellJoin, mkdirsScript } from './shell.mjs';
import { ExecEnvLostError, ExecEnvSyncError, LOST_HINT, EXEC_ENV_CODES } from './index.mjs';
import { SANDBOX_TIMEOUT_MS, HEARTBEAT_MS, SHELL_COMMAND_TIMEOUT_MS, sandboxEnv, sandboxMcpConfig, engineSandbox } from './policy.mjs';
import { ModelRelay, leakedSecret } from './model-relay.mjs';
import { withStreamTimeouts } from '../model-env.mjs';
import { MODEL_CREDENTIAL_ENV_KEYS } from '../broker-guard.mjs';
import { remoteModelRoute, engineModelRoute } from './relay-route.mjs';
import { createRouteMeter, relayUsageTotal } from './relay-usage.mjs';
import { DEFAULT_SECRET_PATHS, isSecretPath } from '../secret-paths.mjs';
import { createSourceBundle, overlayFiles, overlaySecretLines, makeTarGz, walkFiles, applyPatch, patchAlreadyApplied, patchPaths, hostRunChanges, injectedPaths, cloneScript, treeScript,
  mergesScript, diffScript, SNAPSHOT_JS } from './git-transfer.mjs';

export const SCRIPT_SUPPORT_FILES = Object.freeze([
  fileURLToPath(new URL('../graph/script-child.mjs', import.meta.url)),
  fileURLToPath(new URL('../graph/worca_script.py', import.meta.url)),
]);
// The in-sandbox half of the model relay (plans/model-relay-design.md §3), uploaded as <work>/model-relay.mjs.
const RELAY_SCRIPT = fileURLToPath(new URL('./sandbox-relay.mjs', import.meta.url));
const RELAY_NAME = 'model-relay.mjs';
const DEFAULT_HOME = '/home/user';                    // backend.homeDir: the sandbox user's HOME (E2B's convention)
const DEFAULT_WORK = '/tmp/worca-exec';               // sandbox scratch (backend.workDir): bundle, tars, patches, temp index, stdin files
const SKIP_NAMES = new Set(['live-log.ndjson']);      // host-only, large, never read by an agent
const APPEND_ONLY = new Set(['directions.ndjson']);   // two writers (directions.mjs): merge, never overwrite
// Historical names, shared by every backend: renaming them would re-sync files of runs in flight.
const SKIP_PREFIX = 'e2b-unapplied-';
const TEMP_MARK = '.e2b-';
// Above the largest file worca itself puts in the pipeline dir: run extras (<pipeline>/extras) take up to
// ask/limits.mjs maxBytesPerFile = 100 MiB, and the prompt names them, so a smaller cap would hide an attachment.
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_LABEL = '128 MiB';
// What one sync and one run may bring back into the run's folders: a runaway agent must not fill the host's disk.
const SYNC_BUDGET = Object.freeze({ syncFiles: 20_000, syncBytes: 2 * 1024 ** 3, runBytes: 8 * 1024 ** 3 });
const mib = (n) => `${Math.round(n / 1024 ** 2)} MiB`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sigOf = (st) => `${st.size}:${st.mtimeMs}`;
// Automatic relay restarts after a drop mid-step: at most this many failures in a row (a start that throws, or a relay
// that drops again within RELAY_STICK_MS of its restart), RELAY_RETRY_MS apart and doubling; then the next spawn's
// beforeSpawn tries again.
const RELAY_MAX_FAILS = 3;
const RELAY_RETRY_MS = 1000;
const RELAY_STICK_MS = 10_000;
// Model credentials a spawn env must never carry into the sandbox under any name (envFor); not the file path in
// GOOGLE_APPLICATION_CREDENTIALS.
const LEAK_KEYS = [...MODEL_CREDENTIAL_ENV_KEYS.filter((k) => k !== 'GOOGLE_APPLICATION_CREDENTIALS'), 'COPILOT_GITHUB_TOKEN', 'CURSOR_AUTH_TOKEN'];
const credentialValues = (env) => LEAK_KEYS.map((k) => env?.[k]).filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());

export class RemoteExecEnv {
  constructor({ backend, client, environment = null, environmentBuild = null, worktreeDir, pipelineDir, storeRoots = [], mcpConfigPath = null,
    injected = [], refreshPaths = [], syncExcludes = [], supportFiles = SCRIPT_SUPPORT_FILES, metadata, scratchDir,
    log = () => {}, env = process.env, startedAt = Date.now(), onMaxWait = null, onPark = null, onReview = null, syncBudget = null,
    mcpjsonProjectDir = null, homeDir = homedir(), rebuildHint = backend.rebuildHint ?? null, relayUpstreams = null,
    secretPaths = DEFAULT_SECRET_PATHS, network = null }) {
    Object.assign(this, { backend, client, environment, environmentBuild, worktreeDir, pipelineDir, storeRoots, mcpConfigPath, injected,
      refreshPaths, syncExcludes, supportFiles, metadata, scratchDir, log, env, startedAt, onMaxWait, onPark, onReview,
      mcpjsonProjectDir, homeDir, rebuildHint, secretPaths, network });
    // Where the engine routes' calls go when not the vendor's own API (relay-route.mjs ENGINE_UPSTREAMS): tests only.
    this.relayUpstreams = relayUpstreams;
    this.parkedUntil = null;     // epoch ms the parked sandbox is released at, while an ask waits (onPark tells the host)
    this.kind = backend.name; this.label = backend.label; this.title = backend.title;
    this.work = backend.workDir || DEFAULT_WORK;
    this.home = backend.homeDir || DEFAULT_HOME;
    this.sandbox = null; this.sandboxId = null; this.prefix = '';
    this.syncedTree = null; this.baseHead = null; this.lost = null; this.syncFailure = null;
    // Host-side record of the last tree the host worktree really holds; survives a crash (scratchDir
    // is removed only by close()). A reconnect prefers it to the resume point's copy (Step 4 notes).
    this._treeFile = join(scratchDir, 'synced-tree');
    this.mcpEnvRefs = [];
    this.activeSpawns = 0;
    this._known = new Map();     // sandbox path -> "size:mtimeMs" when last synced (either direction)
    this._uploaded = new Map();  // host path -> "size:mtimeMs" of the host copy when last synced
    this._inputs = new Set();    // bound inputs outside this run's own files (an older plan), uploaded when changed
    this._dirs = new Set();      // sandbox dirs already created
    this._trees = new Set();     // host dirs uploaded whole once (script program roots)
    this._homeFiles = new Map();  // sandbox path under the engine home -> sha256 of what worca last put there
    this._engineFiles = new Set(); // host paths syncEngineFiles mirrored (only these are ever removed again)
    this._excluded = new Set();    // the anchored lines syncEngineFiles put in the sandbox clone's info/exclude
    this._clis = new Map();        // engine CLI -> Promise<boolean>: whether this sandbox's template has it (ensureCli)
    this._chain = Promise.resolve();
    this._heartbeat = null; this._patchNo = 0; this._seq = 0;
    this._budget = { ...SYNC_BUDGET, ...(syncBudget || {}) }; this._pulledBytes = 0;
    this._waiting = 0; this._maxWaitMs = 0; this._parked = false; this._held = false; this._maxWaitTimer = null;
    this._tchain = Promise.resolve();
    // One relay per sandbox: every model call of a spawn goes through it, and the credential stays in worca.
    this.relay = new ModelRelay({ log: (level, text) => this.log(level, text), onDrop: () => this._onRelayDrop() });
    this._relayChain = Promise.resolve(); this._relayFails = 0; this._relayAutoAt = 0; this._closing = false; this._relayRetryTimer = null;
    this._keylessLogged = new Set();   // origins of keyless routes already named in the run log
    this._meters = new Map();    // route id -> its usage meter (relay-usage.mjs)
    this._authCache = new Map(); // engine routes' Copilot host lookups and Cursor access tokens (relay-route.mjs), per credential
    this._refused = new Set();   // host paths an upload refused (a link out of its root), each logged once
  }
  get remote() { return true; }
  get roots() { return [this.pipelineDir, ...this.storeRoots]; }
  sb(p) { return this.prefix + p; }
  _host(p) { return this.prefix && p.startsWith(this.prefix) ? p.slice(this.prefix.length) : p; }
  _serial(fn) { const run = this._chain.then(fn, fn); this._chain = run.catch(() => {}); return run; }
  _underRoots(abs) { return this.roots.some((r) => abs.startsWith(resolve(r) + sep)); }
  /** An upload left the symbolic link `p` out: a synced folder's links are never followed (a step or a patch may have
   *  left one, and its target would go up with the next step), nor a mount's links out of the mount. Logged once. */
  _refuseLink(p) {
    if (this._refused.has(p)) return;
    this._refused.add(p);
    this.log('warn', `not uploading ${p} to the ${this.label}: it is a symbolic link, and worca does not send what it points at`);
  }
  /** The refresh paths (the memory mount) that are real directories in the worktree. worca makes the mount a plain
   *  directory, so a mount that is now a link (out of the worktree, say) is skipped, never followed. */
  async _refreshRoots() {
    const out = [];
    for (const rel of this.refreshPaths) {
      const abs = resolve(this.worktreeDir, rel);
      let st; try { st = await lstat(abs); } catch { continue; }
      if (st.isSymbolicLink()) this._refuseLink(abs); else if (st.isDirectory()) out.push(abs);
    }
    return out;
  }

  lostError() { return this.lost || new ExecEnvLostError(`The run's ${this.label} is gone. ${LOST_HINT}`); }
  /** The error that must end the run, or null: a lost sandbox, or a patch that did not apply. */
  fatalError() { return this.lost || this.syncFailure || null; }

  async _call(fn) {
    if (this.lost) throw this.lost;
    try { return await fn(); }
    catch (err) {
      const kind = this.client.classifyError(err);
      if (kind === 'gone' || (kind === 'unreachable' && await this._goneOnControlPlane())) {
        this.lost ||= new ExecEnvLostError(`The run's ${this.label} ${this.sandboxId} is gone (${err.message}). ${LOST_HINT}`, { cause: err });
        this._stopHeartbeat(); clearTimeout(this._maxWaitTimer);
        throw this.lost;
      }
      throw err;
    }
  }
  /** A dropped tunnel also looks "unreachable": ask the control plane before giving up. */
  async _goneOnControlPlane() {
    if (!this.sandboxId) return true;
    try { await this.client.info(this.sandboxId); return false; }
    catch (e) { return this.client.classifyError(e) === 'gone'; }
  }
  /** Foreground sandbox command; a non-zero exit is an Error with the stderr tail. */
  async _sh(cmd, { root = false, cwd } = {}) {
    return this._call(async () => {
      try {
        const r = await this.client.run(this.sandbox, cmd, { timeoutMs: SHELL_COMMAND_TIMEOUT_MS, ...(root ? { user: 'root' } : {}), ...(cwd ? { cwd } : {}) });
        return r.stdout;
      } catch (err) {
        if (typeof err?.exitCode === 'number') throw new Error(`sandbox command failed (exit ${err.exitCode}): ${String(err.stderr || '').slice(-1500)}`);
        throw err;
      }
    });
  }
  /** Mirrored host dirs (/Users/…, /var/folders/…) sit under root-owned parents in the VM. */
  async _ensureDirs(hostDirs) {
    const want = [...new Set(hostDirs.map((d) => this.sb(d)))].filter((d) => !this._dirs.has(d));
    if (!want.length) return;
    await this._sh(mkdirsScript(want), { root: true });
    for (const d of want) this._dirs.add(d);
  }
  async _putHost(hostPath, buf) {
    await this._ensureDirs([dirname(hostPath)]);
    return this._call(() => this.client.writeFile(this.sandbox, this.sb(hostPath), buf));
  }
  async _get(sbPath) { return this._call(() => this.client.readFile(this.sandbox, sbPath)); }
  /** Upload a tar of `files` (relative to `cwd`) and extract it at the mirrored `cwd`. */
  async _putTree(cwd, files, name, { dereference = true } = {}) {
    const tar = join(this.scratchDir, `${name}.tgz`);
    await mkdir(this.scratchDir, { recursive: true });
    await makeTarGz({ cwd, files, outFile: tar, dereference });
    await this._putHost(`${this.work}/${name}.tgz`, await readFile(tar));
    await this._sh(`tar -xzf ${shq(this.sb(`${this.work}/${name}.tgz`))} -C ${shq(this.sb(cwd))}`);
  }

  /** The run worktree's code graph, built here rather than on the host (run-harness _buildSandboxGraph): the
   *  self-ignoring graphify-out/.gitignore first (preflight.mjs runGraphifyUpdate's sentinel, so no patch carries
   *  the graph), then `graphify update`, capped by `timeout` so an overrun also stops in the sandbox. A failed build
   *  never throws ({ ok, ms, error }); a lost sandbox does. */
  async buildCodeGraph({ timeoutMs }) {
    const dir = shq(this.sb(this.worktreeDir));
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    const script = [
      `cd ${dir} || exit 1`,
      `git ls-files -- graphify-out | grep -q . || { mkdir -p graphify-out && printf '*\\n' > graphify-out/.gitignore; }`,
      `command -v graphify >/dev/null 2>&1 || { echo 'graphify is not installed in this template' >&2; exit 127; }`,
      `if command -v timeout >/dev/null 2>&1; then exec timeout ${secs} graphify update ${dir}; else exec graphify update ${dir}; fi`,
    ].join('\n');
    const t0 = Date.now();
    try {
      await this._call(() => this.client.run(this.sandbox, script, { timeoutMs: timeoutMs + 30_000 }));
      return { ok: true, ms: Date.now() - t0 };
    } catch (err) {
      if (this.lost) throw this.lost;
      const error = err?.exitCode === 124 ? `timed out after ${secs} s`
        : String(err?.stderr || err?.message || err).trim().split('\n').slice(-3).join(' | ');
      return { ok: false, ms: Date.now() - t0, error };
    }
  }

  _adopt(h) { this.sandbox = h.box; this.sandboxId = h.id; this.prefix = h.pathPrefix || ''; }
  async start() {
    if (!this.environment) throw new Error(`no ${this.backend.environmentNoun} to start the ${this.label} from`);
    // `network` (null: open) is fixed at create; a reconnect keeps the policy the sandbox was made with.
    this._adopt(await this._call(() => this.client.create({ environment: this.environment, tags: this.metadata, timeoutMs: SANDBOX_TIMEOUT_MS,
      ...(this.network ? { network: this.network } : {}) })));
    this.log('info', `sandbox ${this.sandboxId} created from ${this.backend.environmentNoun} ${this.environment}`);
    await this._ensureDirs([this.work, dirname(this.worktreeDir), ...this.roots]);
    await this._cloneIn();
    await this._uploadSupport();
    await this._uploadDelta();
    this._known = new Map(Object.entries(await this._snapshot()));
    this._startHeartbeat();
    await this._startRelay({ upload: true });
  }

  // ── model relay (plans/model-relay-design.md §3, §6) ──
  get _relayPath() { return `${this.work}/${RELAY_NAME}`; }
  /** Upload (on start and reconnect: the worca version may have changed) and start the relay. A restart reuses the
   *  first port: spawn envs built before it already name that URL. A failure is a run failure, never a fallback. */
  async _startRelay({ upload = false } = {}) {
    if (upload) await this._putHost(this._relayPath, await readFile(RELAY_SCRIPT));
    try {
      await this._call(() => this.relay.start({ client: this.client, box: this.sandbox, scriptPath: this.sb(this._relayPath), port: this.relay.port ?? 0 }));
    } catch (err) {
      if (this.lost) throw this.lost;
      throw new Error(`The model relay in the ${this.label} did not start: ${err?.message || err}`, { cause: err });
    }
  }
  /** A relay worca no longer talks to: one a previous worca process started (its stdin channel went with that
   *  process), or one whose command stream dropped while the process lives on (a failed kill() is swallowed). It
   *  may hold the port a restart needs, so it is killed and waited for (up to 2 s). The pattern names this sandbox's
   *  script path and cannot match the shell running pkill ([m] is not "[m]"). Only pkill's "no match" (1) is quiet. */
  async _killStaleRelay() {
    const pat = shq(`${escapeRe(this.sb(this.work))}/[${RELAY_NAME[0]}]${escapeRe(RELAY_NAME.slice(1))}`);
    const out = (await this._sh([
      `pkill -f ${pat}; s=$?`,
      'if [ "$s" -gt 1 ]; then echo "pkill:$s"; exit 0; fi',
      `i=0; while pgrep -f ${pat} >/dev/null 2>&1; do i=$((i+1)); if [ "$i" -ge 20 ]; then echo running; exit 0; fi; sleep 0.1; done`,
    ].join('\n'))).trim();
    const code = /^pkill:(\d+)$/.exec(out)?.[1];
    if (code === '127') this.log('warn', `pkill is not available in the ${this.label}; a model relay left from before may still run and hold its port`);
    else if (code) this.log('warn', `pkill failed (exit ${code}) in the ${this.label}; a model relay left from before may still run and hold its port`);
    else if (out === 'running') this.log('warn', `the previous model relay is still running in the ${this.label} 2 s after pkill`);
  }
  /** Relay restarts one at a time: the automatic one after a drop and beforeSpawn's. */
  _relaySerial(fn) { const run = this._relayChain.then(fn, fn); this._relayChain = run.catch(() => {}); return run; }
  /** Kill whatever is left of a dead relay and start it again on its port. False when the env is closing or lost. */
  async _restartRelay() {
    if (this.relay.alive) return true;
    if (this._closing || this.lost || !this.sandbox) return false;
    await this._killStaleRelay();
    if (this._closing || this.lost || !this.sandbox) return false;
    await this._startRelay();
    this.log('warn', 'model relay restarted');
    this._clearRelayRetry();   // a backoff retry still pending would count a later real drop as a failed restart
    return true;
  }
  _clearRelayRetry() { clearTimeout(this._relayRetryTimer); this._relayRetryTimer = null; }
  /** Before a spawn: a relay that died (it exited, a write to it failed, or its stream dropped) comes back on its
   *  port, once whatever is left of it is gone. */
  async _ensureRelay() {
    if (this.relay.alive) return;
    await this._relaySerial(() => this._restartRelay());
    this._relayFails = 0; this._relayAutoAt = 0;
  }
  /** The relay ended mid-step while worca did not stop it (ModelRelay onDrop). A running claude still holds the relay
   *  URL; if the process outlived its dropped stream it would accept calls nothing answers, until the CLI's API
   *  timeout. Restart it now, in the background, so in-flight calls fail fast and the CLI's retries reach the new one. */
  _onRelayDrop() {
    // Held (parked, or drained for a pause): no step runs, and a resume's reconnect may be pkilling this very relay
    // from a new env; restarting here would kill the new env's relay in turn. The resume or beforeSpawn restarts it.
    if (this._closing || this.lost || !this.sandbox || this._held) return;
    if (this._relayAutoAt && Date.now() - this._relayAutoAt < RELAY_STICK_MS) this._relayFails++;   // came back, did not stay
    else this._relayFails = 0;
    this._relayAutoAt = 0;
    this._autoRestartRelay();
  }
  async _autoRestartRelay() {
    this._relayRetryTimer = null;
    if (this._closing || this.lost || !this.sandbox || this._held) return;
    if (this._relayFails >= RELAY_MAX_FAILS) { this._relayGiveUp('it kept dropping'); return; }
    let err = null; let ok = false;
    try { ok = await this._relaySerial(() => this._restartRelay()); } catch (e) { err = e; }
    if (ok) { this._relayAutoAt = Date.now(); return; }
    if (!err || this._closing || this.lost || !this.sandbox || this._held) return;
    this._relayFails++;
    if (this._relayFails >= RELAY_MAX_FAILS) { this._relayGiveUp(err?.message || String(err)); return; }
    this._clearRelayRetry();
    this._relayRetryTimer = setTimeout(() => this._autoRestartRelay(), RELAY_RETRY_MS * 2 ** (this._relayFails - 1));
    this._relayRetryTimer.unref?.();
  }
  _relayGiveUp(why) {
    this.log('error', `model relay: ${RELAY_MAX_FAILS} restarts in a row failed (${String(why).slice(0, 300)}); the next step's start tries again`);
  }
  /** A route for one spawn's model calls (relay-route.mjs decides where they go and how they are signed, in worca).
   *  The sandbox gets only the relay URL and the route id. Throws the route's refusals (errorClass 'config'). */
  openModelRoute({ spawnEnv = {}, modelEnv = null } = {}) {
    const route = remoteModelRoute({ spawnEnv, modelEnv, serverEnv: this.env, label: this.label });
    const meter = createRouteMeter();
    route.meter = meter.reply;
    const { id, baseUrl } = this.relay.addRoute(route);
    this._meters.set(id, meter);
    // A keyless gateway: say so once per origin, so a 401 from it is explainable (the origin only, never a header).
    if (!route.signed && !this._keylessLogged.has(route.origin)) {
      this._keylessLogged.add(route.origin);
      this.log('info', `model relay: calls to ${route.origin} get no credential from worca (this model sets no key for it); a 401 comes from that endpoint`);
    }
    return { id, env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: id }, secrets: route.secrets, firstParty: route.firstParty };
  }
  /** What the relay measured on route `id` since the last take (relay-usage.mjs `take`), or null for no such route:
   *  the cost a remote spawn books, because the sandbox writes the CLI's own `result` frames. */
  routeUsage(id) { return this._meters.get(id)?.take() ?? null; }
  /** End route `id`; returns what its meter counted since the last take (null for no such route). */
  closeModelRoute(id) {
    this.relay.removeRoute(id);
    const rest = this.routeUsage(id);
    this._meters.delete(id);
    return rest;
  }

  /** A route for one spawn of `engine` (codex, copilot, cursor): relay-route.mjs engineModelRoute decides where its calls
   *  go and how worca signs them (the server's key, a token worca derives from it, or a codex endpoint model's own key).
   *  The sandbox gets only the relay URL and a dummy credential: `env`, and for codex the `-c` overrides in `args`.
   *  Throws the route's refusals (errorClass 'config'). */
  openEngineRoute(engine, { spawnEnv = {}, model = null, endpoint = null } = {}) {
    const route = engineModelRoute({ engine, serverEnv: this.env, spawnEnv, model, endpoint, label: this.label, upstreams: this.relayUpstreams, cache: this._authCache });
    const meter = createRouteMeter();
    route.meter = meter.reply;
    const { id, baseUrl } = this.relay.addRoute(route);
    this._meters.set(id, meter);
    const spawn = route.spawn(baseUrl);
    return { id, env: spawn.env, args: spawn.args || [], secrets: route.secrets };
  }
  /** A remote engine spawn's onEvent, metered by route `id` (security evaluation E4: the sandbox writes the CLI's
   *  stream, so its usage and cost are a claim). Each `result` carries what the relay measured since the previous one:
   *  with `cost` (codex, which books list prices) as `relay`, which the harness books in place of the CLI's figure;
   *  without (copilot, cursor: subscription-billed, no cost of their own) the relay's token counts replace the result's
   *  `usage`, and a cost the sandbox claimed is dropped. */
  meteredEvents(id, onEvent, { cost = false } = {}) {
    return (e) => {
      if (e?.type !== 'result') return onEvent(e);
      const relay = this.routeUsage(id);
      if (cost) return onEvent(relay ? { ...e, relay } : e);
      const { costUsd, ...rest } = e;
      return onEvent({ ...rest, ...(relay ? { usage: relayUsageTotal(relay) } : {}) });
    };
  }
  /** End an engine route at its spawn's end. With `cost`, the calls no result covered go out as `relayCost` (booked
   *  like a result's, as a claude spawn's are). */
  closeEngineRoute(id, onEvent, { cost = false } = {}) {
    const rest = this.closeModelRoute(id);
    if (cost && rest?.messages) { try { onEvent({ type: 'relayCost', messages: rest.messages, byModel: rest.byModel }); } catch { /* listener */ } }
  }

  async _cloneIn() {
    const bundle = await createSourceBundle({ worktreeDir: this.worktreeDir, outFile: join(this.scratchDir, 'source.bundle') });
    await this._putHost(`${this.work}/source.bundle`, await readFile(bundle.file));
    await this._sh(cloneScript({ bundle: this.sb(`${this.work}/source.bundle`), dir: this.sb(this.worktreeDir), branch: bundle.branch, head: bundle.head }));
    this.baseHead = bundle.head;
    await this._overlay();
  }
  _treeArgs() { return { dir: this.sb(this.worktreeDir), index: this.sb(`${this.work}/sync.index`), excludes: this.syncExcludes }; }
  /** The tree the host now holds: in memory and in the crash-safe host file. */
  _setSynced(tree) {
    this.syncedTree = tree;
    try { mkdirSync(this.scratchDir, { recursive: true }); writeFileSync(this._treeFile, tree); } catch { /* best effort */ }
  }
  /** Push host-only worktree state (dirty/untracked/injected files, deletions) and re-baseline. */
  async _overlay() {
    const refresh = new Set(this.refreshPaths.map((rel) => resolve(this.worktreeDir, rel)));
    const real = new Set(await this._refreshRoots());
    const injected = this.injected.filter((rel) => { const abs = resolve(this.worktreeDir, rel); return !refresh.has(abs) || real.has(abs); });
    const overlay = await overlayFiles({ worktreeDir: this.worktreeDir, injected, onSkip: (p) => this._refuseLink(p), secretPaths: this.secretPaths });
    const { files, mounts, deleted } = overlay;
    // Named once per sandbox: a reconnect clones again but the lists are the same.
    if (!this._secretsLogged) { this._secretsLogged = true; for (const l of overlaySecretLines(overlay)) this.log(l.level, l.text); }
    // The worktree's own paths keep their symlinks (a link out of the worktree must not upload its
    // target); only the injected mounts are dereferenced (a symlinked skill's content, never a link out of it).
    if (files.length) await this._putTree(this.worktreeDir, files, 'overlay', { dereference: false });
    if (mounts.length) await this._putTree(this.worktreeDir, mounts, 'overlay-mounts');
    if (deleted.length) await this._sh(`cd ${shq(this.sb(this.worktreeDir))} && rm -f -- ${deleted.map(shq).join(' ')}`);
    for (const root of real) {                              // the refresh baseline: nothing to re-upload yet
      for (const abs of await walkFiles(root)) { try { this._uploaded.set(abs, sigOf(await stat(abs))); } catch { /* gone */ } }
    }
    this._setSynced((await this._sh(treeScript(this._treeArgs()))).trim());
  }
  /** Files the agent needs that live outside the worktree and the synced roots. */
  async _uploadSupport() {
    if (this.mcpConfigPath) {
      let json = null; try { json = JSON.parse(await readFile(this.mcpConfigPath, 'utf8')); } catch { /* no servers */ }
      if (json) {
        const { config, dropped, envRefs, exposed } = sandboxMcpConfig(json);
        for (const d of dropped) this.log('warn', `MCP server "${d.name}" is not available in the ${this.label}: it ${d.reason}`);
        for (const e of exposed) this.log('warn', `MCP server "${e.name}" is available in the ${this.label} with the values of these env vars: ${e.envRefs.join(', ')}`);
        this.mcpEnvRefs = envRefs;
        await this._putHost(this.mcpConfigPath, Buffer.from(JSON.stringify(config, null, 2)));
      }
    }
    for (const f of this.supportFiles) {
      let buf; try { buf = await readFile(f); } catch { continue; }   // e.g. no run-root CLAUDE.md on a legacy run
      await this._putHost(f, buf);
    }
  }

  // ── per-spawn sync (RemoteChild / runInProcess) ──
  /** Inputs bound to a node that live outside this run's own files (orchestrator _runOnce). */
  addInputs(paths) { for (const p of paths) if (typeof p === 'string' && p.startsWith('/')) this._inputs.add(p); }
  /** Before a command: bring sandbox changes home first (so nothing a parallel node wrote is
   *  overwritten), then upload what changed on the host. */
  beforeSpawn() { return this._serial(async () => { await this._ensureRelay(); await this._pullFiles(); await this._pullCode(); await this._uploadDelta(); }); }
  afterSpawn() { return this._serial(async () => { await this._pullFiles(); await this._pullCode(); }); }
  /** The final sync (before _buildResults) and the park-time sync. */
  syncBack() { return this.afterSpawn(); }

  async _pullFiles() {
    if (this.syncFailure) throw this.syncFailure;
    const now = await this._snapshot();
    const todo = [];
    for (const [p, sig] of Object.entries(now)) {
      if (this._known.get(p) === sig) continue;
      const host = this._host(p);
      if (!(await this._acceptDownload(host))) { this._known.set(p, sig); continue; }
      const size = Number(sig.split(':')[0]);
      if (size > MAX_FILE_BYTES) { this._known.set(p, sig); this.log('warn', `not syncing ${host}: larger than ${MAX_LABEL}`); continue; }
      todo.push({ p, sig, host, size });
    }
    // The budget is checked before anything downloads: past it the run fails, and the host keeps what it had.
    const bytes = todo.reduce((n, t) => n + t.size, 0);
    const { syncFiles, syncBytes, runBytes } = this._budget;
    const over = todo.length > syncFiles ? `${todo.length} files in one step (the limit is ${syncFiles})`
      : bytes > syncBytes ? `${mib(bytes)} in one step (the limit is ${mib(syncBytes)})`
        : this._pulledBytes + bytes > runBytes ? `${mib(this._pulledBytes + bytes)} over this run (the limit is ${mib(runBytes)})` : null;
    if (over) {
      this.syncFailure = new ExecEnvSyncError(`The ${this.label} wrote more into the run's folders than worca brings back: ${over}. Nothing of this step was downloaded.`, { code: EXEC_ENV_CODES.syncBudget });
      throw this.syncFailure;
    }
    for (const { p, sig, host, size } of todo) {
      this._known.set(p, sig);
      this._pulledBytes += size;
      const data = await this._get(p);
      await mkdir(dirname(host), { recursive: true });
      const base = host.split(sep).pop();
      if (APPEND_ONLY.has(base) && existsSync(host)) {
        // Both sides append (a user direction on the host, a consumption record in the sandbox).
        const mine = await readFile(host, 'utf8'); const have = new Set(mine.split('\n'));
        const add = data.toString('utf8').split('\n').filter((l) => l.trim() && !have.has(l));
        if (add.length) await appendFile(host, `${mine && !mine.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
        this._uploaded.delete(host);           // the merged copy goes back up on the next beforeSpawn
        continue;
      }
      const tmp = `${host}${TEMP_MARK}${process.pid}`;
      await writeFile(tmp, data); await rename(tmp, host);
      this._uploaded.set(host, sigOf(await stat(host)));
    }
  }

  /** An incremental binary patch of the worktree since the last synced tree. `tolerateApplied`
   *  (reconnect only): a patch the host already holds counts as applied, because the resume
   *  point's syncedTree can lag the host by one parallel pull. */
  async _pullCode({ tolerateApplied = false } = {}) {
    if (this.syncFailure) throw this.syncFailure;
    const dir = this.sb(this.worktreeDir);
    if (this.baseHead) {
      // A merge commit cannot cross a content patch: flattened, it would push a branch that still
      // conflicts. Worca's own merge runs are local (Step 8); anything else fails clearly here.
      const merge = (await this._sh(mergesScript({ dir, since: this.baseHead }))).trim();
      if (merge) {
        this.syncFailure = new ExecEnvSyncError(`The agent committed a merge (${merge.slice(0, 12)}) in the ${this.label}. A merge cannot be brought back to the local branch from a sandbox; run this task with the Local execution environment.`, { code: EXEC_ENV_CODES.mergeCommit });
        throw this.syncFailure;
      }
    }
    const tree = (await this._sh(treeScript(this._treeArgs()))).trim();
    if (tree === this.syncedTree) return;
    const out = this.sb(`${this.work}/step.patch`);
    const size = Number((await this._sh(diffScript({ dir, from: this.syncedTree, to: tree, out }))).trim());
    if (size > 0) {
      const local = join(this.scratchDir, 'step.patch');
      await mkdir(this.scratchDir, { recursive: true });
      await writeFile(local, await this._get(out));
      const touched = await patchPaths({ worktreeDir: this.worktreeDir, patchFile: local });
      const list = (ps) => `${ps.slice(0, 5).join(', ')}${ps.length > 5 ? ', and more' : ''}`;
      const refuse = async (message, code) => {
        const keep = join(this.pipelineDir, `${SKIP_PREFIX}${++this._patchNo}.patch`);
        await rename(local, keep).catch(() => {});
        this.syncFailure = new ExecEnvSyncError(`${message} Nothing of this step was applied. The patch is saved at ${keep}.`, { patchFile: keep, code });
        throw this.syncFailure;
      };
      let found;
      try { found = await hostRunChanges({ worktreeDir: this.worktreeDir, patchFile: local, paths: touched, mcpVerdict: () => this._mcpVerdict() }); }
      catch (err) { await refuse(`Worca could not check the ${this.label}'s changes before applying them (${String(err.stderr || err.message).trim().slice(0, 500)}).`, EXEC_ENV_CODES.patchRejected); }
      const { hooks, config, review } = found;
      if (hooks.length) await refuse(`The agent changed git hook files in the ${this.label} (${list(hooks)}). Hooks run on this machine at the next commit or push, so worca does not bring them back from a sandbox. Run this task with the Local execution environment.`, EXEC_ENV_CODES.hookChange);
      // The sandbox's own tree leaves the injected paths out (treeScript), so a patch that touches one was forged in
      // the sandbox: a symlink planted there would send the host file it points at up with the next upload.
      const owned = injectedPaths({ worktreeDir: this.worktreeDir, paths: touched, roots: [...this.injected, ...this.syncExcludes] });
      if (owned.length) await refuse(`The ${this.label} sent back changes to files worca put in the worktree (${list(owned)}). The sandbox never sends those back on its own, so the step's changes were altered inside it; worca refused them.`, EXEC_ENV_CODES.injectedChange);
      if (config.length) await refuse(`The agent changed agent configuration in the ${this.label} (${list(config)}). Claude Code and the other agent CLIs load it on this machine (hooks, MCP servers, permissions), on a local step, a resume on Local or when you open the folder, so worca does not bring it back from a sandbox. Run this task with the Local execution environment.`, EXEC_ENV_CODES.configChange);
      try { await applyPatch({ worktreeDir: this.worktreeDir, patchFile: local }); }
      catch (err) {
        if (!(tolerateApplied && await patchAlreadyApplied({ worktreeDir: this.worktreeDir, patchFile: local }))) {
          const keep = join(this.pipelineDir, `${SKIP_PREFIX}${++this._patchNo}.patch`);
          await rename(local, keep).catch(() => {});
          this.syncFailure = new ExecEnvSyncError(`The sandbox's changes did not apply to the local worktree (${String(err.stderr || err.message).trim().slice(0, 500)}). The patch is saved at ${keep}.`, { patchFile: keep, cause: err });
          throw this.syncFailure;
        }
      }
      // Files only a person runs later (worca never does) came home: say which, so nobody runs them unread.
      for (const r of review) this.log('warn', `review before running on this machine: ${r.path} from the ${this.label} (${r.why})`);
      if (review.length) { try { this.onReview?.(review); } catch { /* a host callback never breaks the sync */ } }
    }
    this._setSynced(tree);
  }
  /** The host's approval check for the project's committed `.mcp.json` servers, as a Claude spawn applies it
   *  (claude-runner.mjs). Loaded here: run-context's imports lead back to the exec-env layer. */
  async _mcpVerdict() {
    const { mcpjsonApproval } = await import('../run-context.mjs');
    return mcpjsonApproval(this.mcpjsonProjectDir || this.worktreeDir, this.homeDir, () => {});
  }

  /** Only regular files strictly inside a synced root; never through a host symlink. */
  async _acceptDownload(host) {
    const abs = resolve(host);
    if (abs !== host || host.includes('\n')) return false;
    const base = abs.split(sep).pop();
    if (SKIP_NAMES.has(base) || base.startsWith(SKIP_PREFIX) || base.includes(TEMP_MARK)) return false;
    if (!this._underRoots(abs)) return false;
    try { if ((await lstat(abs)).isSymbolicLink()) return false; } catch { /* new file */ }
    return true;
  }

  async _snapshot() {
    const out = await this._sh(`node -e ${shq(SNAPSHOT_JS)} ${this.roots.map((r) => shq(this.sb(r))).join(' ')}`);
    try { return JSON.parse(out || '{}'); } catch { return {}; }
  }

  /** Host files changed since the last sync: the whole pipeline dir; in the store roots only
   *  this run's files and bound inputs (older plans of the project stay home); the refresh
   *  paths (the memory mount); plus host deletions inside the synced roots. */
  async _uploadDelta() {
    const changed = new Map();   // host path -> sig
    // lstat, never stat: a link (one a patch or a step could have left) is not followed to its target.
    const consider = async (abs, { onlyNew = false, root = dirname(abs) } = {}) => {
      let st; try { st = await lstat(abs); } catch { return; }
      if (st.isSymbolicLink()) { this._refuseLink(abs); return; }
      const base = abs.split(sep).pop();
      if (!st.isFile() || SKIP_NAMES.has(base) || base.startsWith(SKIP_PREFIX) || base.includes(TEMP_MARK)) return;
      // A secret file (secret-paths.mjs) stays on this machine, as in the first upload (overlayFiles).
      if (this._secretKept(abs, root)) return;
      if (st.size > MAX_FILE_BYTES) { this.log('warn', `not uploading ${abs}: larger than ${MAX_LABEL}; the sandbox cannot read it`); return; }
      if (onlyNew && st.mtimeMs < this.startedAt && !this._inputs.has(abs)) return;
      const sig = sigOf(st);
      if (this._uploaded.get(abs) !== sig) changed.set(abs, sig);
    };
    const walk = async (dir, o) => {
      let es; try { es = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of es) { const p = join(dir, e.name); if (e.isDirectory()) await walk(p, o); else await consider(p, { root: dir, ...o }); }
    };
    await walk(this.pipelineDir, { root: this.pipelineDir });
    for (const r of this.storeRoots) await walk(r, { onlyNew: true, root: r });
    for (const root of await this._refreshRoots()) await walk(root, { root });
    for (const p of this._inputs) if (!changed.has(p)) await consider(p, {});

    const removed = [...this._uploaded.keys()].filter((h) => this._underRoots(h) && !existsSync(h));
    if (removed.length) {
      await this._sh(`rm -f -- ${removed.map((h) => shq(this.sb(h))).join(' ')}`);
      for (const h of removed) { this._uploaded.delete(h); this._known.delete(this.sb(h)); }
    }
    if (!changed.size) return;
    const paths = [...changed.keys()];
    await this._ensureDirs([...new Set(paths.map((p) => dirname(p)))]);
    await this._putTree('/', paths.map((p) => p.slice(1)), 'up', { dereference: false });
    for (const [p, sig] of changed) this._uploaded.set(p, sig);
    const snap = await this._snapshot();      // what the sandbox now holds is "known" (no echo download)
    for (const p of paths) { const s = snap[this.sb(p)]; if (s) this._known.set(this.sb(p), s); }
  }

  // ── spawning ──
  /** The env a sandbox command of `engine` gets: that engine's allowlist + `keep`, never any engine's model credential,
   *  endpoint or custom headers (sandboxEnv drops them, even when kept), plus a model route's env when given
   *  (openModelRoute for claude, openEngineRoute for the others: the relay URL and a route id or dummy). Scripts pass no
   *  route: they call no model. A claude route's spawn sees a custom endpoint (the relay URL), so it gets the stream
   *  ceilings one gets locally, and on a first-party route tool search, which the CLI turns off for a custom endpoint.
   *  Refused (errorClass 'config'), never stripped: an env holding a route secret or any engine's credential value
   *  (from the spawn's env or the server's) under any key. */
  envFor(env, { engine = 'claude', keep = [], route = null } = {}) {
    const out = sandboxEnv(env, { keep, engine });
    if (!route) return out;
    let child = { ...out, ...route.env };
    if ((engine || 'claude') === 'claude') {
      child = withStreamTimeouts(child);
      if (route.firstParty && child.ENABLE_TOOL_SEARCH === undefined) {
        child.ENABLE_TOOL_SEARCH = typeof env?.ENABLE_TOOL_SEARCH === 'string' ? env.ENABLE_TOOL_SEARCH : 'true';
      }
    }
    const leak = leakedSecret(child, [...(route.secrets || []), ...credentialValues(env), ...credentialValues(this.env)]);
    if (leak) throw Object.assign(new Error(`${leak} holds a model credential, which never enters the ${this.label}. Remove the credential from ${leak}, or pick Local for this model.`), { errorClass: 'config' });
    return child;
  }

  /** `engine`'s own dir in the sandbox HOME (policy.mjs ENGINE_SANDBOX home: codex's CODEX_HOME, cursor's
   *  CURSOR_CONFIG_DIR) with the files worca puts there: `files` ({ rel, data, mode? }: codex's rules, cursor's
   *  cli-config.json). Never a sign-in file: the model relay signs every call in worca. HOME is outside the worktree
   *  and every synced root: nothing here travels back. A file goes up again only when its content changed; `remove`
   *  deletes what worca put there before. Resolves the env that points the CLI at the dir ({} for an engine without
   *  one). Serialised with the spawn syncs. One dir per sandbox and engine is enough: a run's rules are run-level
   *  (RunHarness._spawnPermissionRules), so every node writes the same files. */
  engineHome(engine, { files = [], remove = [] } = {}) {
    const spec = engineSandbox(engine);
    if (!spec.home) return Promise.resolve({});
    const dir = `${this.home}/${spec.home.dir}`;
    return this._serial(async () => {
      for (const f of files) {
        const p = `${dir}/${f.rel}`;
        const buf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data));
        const sig = createHash('sha256').update(buf).digest('hex');
        if (this._homeFiles.get(p) === sig) continue;
        await this._putHost(p, buf);
        await this._sh(`chmod ${(f.mode ?? 0o644).toString(8)} ${shq(this.sb(p))}`);
        this._homeFiles.set(p, sig);
      }
      const gone = remove.map((rel) => `${dir}/${rel}`).filter((p) => this._homeFiles.has(p));
      if (gone.length) {
        await this._sh(`rm -f -- ${gone.map((p) => shq(this.sb(p))).join(' ')}`);
        for (const p of gone) this._homeFiles.delete(p);
      }
      return { [spec.home.env]: this.sb(dir) };
    });
  }

  /** Host files an adapter rewrites per spawn outside the synced roots (Cursor's .cursor/*.json in the checkout, which
   *  _uploadDelta never walks): each of `paths` is uploaded to its mirrored path, and an earlier one no longer wanted is
   *  removed. Only paths this method put are ever removed: an agent's own file of the same name stays. The sandbox clone
   *  has no host info/exclude line for them, so each one under the worktree gets an anchored line in the clone's own
   *  info/exclude: the agents' git (status, diff, stageAll's intent-to-add) never sees worca's file, as on a local run,
   *  and treeScript's `git add -A` never puts it in a patch (worca writes only untracked .cursor files). Not syncExcludes:
   *  that would also drop an agent's edit to a .cursor file the project tracks. */
  syncEngineFiles(paths) {
    return this._serial(async () => {
      // The exclude lines go in BEFORE the files: an agent's `git add -A` running in between never stages worca's file.
      const lines = paths.map((p) => relative(this.worktreeDir, p)).filter((r) => r && !r.startsWith('..'))
        .map((r) => `/${r.split(sep).join('/')}`).filter((l) => !this._excluded.has(l));
      if (lines.length) {
        await this._sh(`cd ${shq(this.sb(this.worktreeDir))} && f="$(git rev-parse --git-path info/exclude)" && mkdir -p "$(dirname "$f")" && touch "$f" && `
          + lines.map((l) => `{ grep -qxF ${shq(l)} "$f" || printf '%s\\n' ${shq(l)} >> "$f"; }`).join(' && '));
        for (const l of lines) this._excluded.add(l);
      }
      for (const p of paths) { await this._putHost(p, await readFile(p)); this._engineFiles.add(p); }
      const gone = [...this._engineFiles].filter((p) => !paths.includes(p));
      if (gone.length) {
        await this._sh(`rm -f -- ${gone.map((p) => shq(this.sb(p))).join(' ')}`);
        for (const p of gone) this._engineFiles.delete(p);
      }
    });
  }

  /** Removes a path an adapter staged at its mirrored path (copilot's per-spawn scratch dir: its agent file and MCP
   *  config must not outlive the spawn in the sandbox). Never throws: a failed removal leaves one stale dir. */
  removeUploaded(hostPath) {
    return this._serial(() => this._sh(`rm -rf -- ${shq(this.sb(hostPath))}`)).then(() => {}, () => {});
  }
  /** The template's `bin`, an engine CLI other than claude, looked up (`command -v`) before that engine's first spawn in this
   *  sandbox: a template built before the engine joined it has none, and the step would end in a bare "command not found"
   *  (exit 127). Throws the step's failure with how to rebuild (`rebuildHint`). The answer is kept with this env, once per
   *  sandbox and CLI (a reconnected env, or a fresh sandbox, asks again); a lookup the sandbox did not answer is not kept. */
  async ensureCli(bin) {
    let found = this._clis.get(bin);
    if (!found) {
      found = this._sh(`command -v ${shq(bin)} || true`).then((out) => !!out.trim());
      this._clis.set(bin, found);
      found.catch(() => { if (this._clis.get(bin) === found) this._clis.delete(bin); });
    }
    if (!(await found)) throw new Error(`the ${this.title} ${this.backend.environmentNoun} has no ${bin}: rebuild it${this.rebuildHint ? ` (${this.rebuildHint})` : ''}`);
  }
  /** A child-like handle running `file args` in the sandbox (./remote-child.mjs). */
  spawn(file, args, { cwd, env = {}, stdin = null, uploads = [] } = {}) {
    return new RemoteChild(this, shellJoin([file, ...args]), { cwd: this.sb(cwd), envs: env, stdinText: stdin, uploads });
  }
  /** A staged prompt dir (under os.tmpdir()) or a single file, at its mirrored path. */
  async uploadPath(p) {
    let st; try { st = await stat(p); } catch { return; }
    if (st.isFile()) { await this._putHost(p, await readFile(p)); return; }
    const files = (await walkFiles(p, { onSkip: (q) => this._refuseLink(q) })).map((f) => relative(p, f));
    if (!files.length) return;
    await this._ensureDirs([p, ...new Set(files.map((f) => dirname(join(p, f))))]);
    await this._putTree(p, files, `path-${++this._seq}`);
  }
  /** Is `abs` a secret file (its path under `root`, the walked root, matches secretPaths)? Kept on this machine and
   *  named once in the run log. */
  _secretKept(abs, root) {
    const rel = relative(root, abs).split(sep).join('/');
    if (!isSecretPath(rel, this.secretPaths)) return false;
    this._maskedLater ??= new Set();
    if (!this._maskedLater.has(abs)) { this._maskedLater.add(abs); this.log('warn', `sandbox upload: secret file kept on this machine: ${abs}`); }
    return true;
  }
  /** Script program roots (Step 6): uploaded whole, once per sandbox, but for their secret files (secret-paths.mjs). */
  async uploadTrees(dirs) {
    for (const d of dirs) {
      if (this._trees.has(d)) continue;
      const files = (await walkFiles(d, { onSkip: (q) => this._refuseLink(q) })).map((f) => relative(d, f))
        .filter((f) => !f.split(sep).includes('node_modules') && !this._secretKept(join(d, f), d));
      if (files.length) {
        await this._ensureDirs([d, ...new Set(files.map((f) => dirname(join(d, f))))]);
        await this._putTree(d, files, `tree-${++this._seq}`);
      }
      this._trees.add(d);
    }
  }
  async writeScratch(text) { const p = `${this.work}/stdin-${++this._seq}`; await this._putHost(p, Buffer.from(text)); return this.sb(p); }
  removeScratch(sbPath) { this._sh(`rm -f ${shq(sbPath)}`).catch(() => {}); }

  /** Mock mode only (the loopback fake): run the in-process mock engine against sandbox paths,
   *  with the same before/after sync a RemoteChild does. */
  async runInProcess(run, opts) {
    const roots = [this.worktreeDir, ...this.roots].sort((a, b) => b.length - a.length);
    const re = new RegExp(roots.map(escapeRe).join('|'), 'g');
    const map = (s) => (typeof s === 'string' && this.prefix ? s.replace(re, (m) => this.sb(m)) : s);
    await this._spawnStarted();
    let result; let failure = null;
    try {
      await this.beforeSpawn();
      result = await run({ ...opts, cwd: this.sb(opts.cwd), prompt: map(opts.prompt), systemPrompt: map(opts.systemPrompt),
        workspaceWriteTargets: Array.isArray(opts.workspaceWriteTargets) ? opts.workspaceWriteTargets.map(map) : opts.workspaceWriteTargets });
    } catch (err) { failure = err; }
    try { if (!this.lost) await this.afterSpawn(); } catch (err) { failure ||= err; }
    await this._spawnEnded();
    if (failure) throw failure;
    return result;
  }
  /** _stageWorkingTree's twin, same pathspecs: the next node's `git diff` in the sandbox sees new files. */
  stageAll(excludes = []) {
    const spec = excludes.length ? ` -- . ${excludes.map(shq).join(' ')}` : '';
    return this._serial(() => this._sh(`cd ${shq(this.sb(this.worktreeDir))} && git add -A -N${spec}`));
  }

  // ── waiting (clarify: long-wait-policy) ──
  /** Through the serialised _timeout chain: a tick already in flight when a park starts must not land
   *  AFTER the park's longer timeout and cut the parked sandbox back to 30 min. */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeat = setInterval(() => {
      if (this._parked || this._held) return;
      this._timeout(SANDBOX_TIMEOUT_MS).catch(() => {});
    }, HEARTBEAT_MS);
    this._heartbeat.unref?.();
  }
  _stopHeartbeat() { if (this._heartbeat) clearInterval(this._heartbeat); this._heartbeat = null; }
  /** Timeout changes are serialised, so a late unpark can never land after a park. */
  _timeout(ms) { const run = this._tchain.then(() => this._call(() => this.client.setTimeout(this.sandbox, ms))); this._tchain = run.catch(() => {}); return run; }
  /** Pause/drain: the provider itself ends the sandbox after `ms` if the run never resumes. Holds (no
   *  ask can unpark it) until a reconnect or close. */
  async park(ms) { this._held = true; clearTimeout(this._maxWaitTimer); this._stopHeartbeat(); await this._timeout(ms); }
  async unpark() { this._held = false; await this._timeout(SANDBOX_TIMEOUT_MS); this._startHeartbeat(); }

  /** An ask started (on) or ended (off) (harness _ask). Counted: two overlapping asks must not
   *  unpark on the first answer. The sandbox parks only while an ask is pending AND no spawn runs
   *  (a parallel node may still be working); the host max-wait timer runs only while parked. */
  setWaiting(on, maxWaitMs = this._maxWaitMs) {
    this._waiting = Math.max(0, this._waiting + (on ? 1 : -1));
    this._maxWaitMs = maxWaitMs;
    return this._applyWait();
  }
  _spawnStarted() { this.activeSpawns += 1; return this._applyWait(); }
  _spawnEnded() { this.activeSpawns = Math.max(0, this.activeSpawns - 1); return this._applyWait(); }
  async _applyWait() {
    const park = this._waiting > 0 && this.activeSpawns === 0;
    if (this._held || park === this._parked || this.lost || !this.sandbox) return;
    this._parked = park;
    try {
      if (park) {
        this._stopHeartbeat();
        await this._timeout(this._maxWaitMs);
        if (this._parked && !this._held) {            // a spawn may have started during the await
          clearTimeout(this._maxWaitTimer);
          // Kept ref'd: while a run waits for an answer it may be the only thing pending, and it must fire to
          // release the sandbox. Every way out (unpark, park, loss, close) clears it.
          this._maxWaitTimer = setTimeout(() => this.onMaxWait?.(), this._maxWaitMs);
          this._setParkedUntil(Date.now() + this._maxWaitMs);
        }
      } else {
        clearTimeout(this._maxWaitTimer); this._maxWaitTimer = null;
        this._setParkedUntil(null);
        await this._timeout(SANDBOX_TIMEOUT_MS);
        if (!this._held) this._startHeartbeat();
      }
    } catch (err) { this.log('warn', `changing the sandbox timeout failed: ${err?.message || err}`); }
  }

  _setParkedUntil(until) {
    if (until === this.parkedUntil) return;
    this.parkedUntil = until;
    try { this.onPark?.(until); } catch { /* a host callback never breaks the sandbox */ }
  }

  resumeRecord() {
    return { kind: this.kind, sandboxId: this.sandboxId, syncedTree: this.syncedTree, startedAt: this.startedAt,
      // What the sandbox was created from: a resume starts a fresh sandbox when the run now resolves another.
      ...(this.environment ? { environment: this.environment, environmentBuild: this.environmentBuild } : {}),
      ...(this.baseHead ? { baseHead: this.baseHead } : {}) };
  }
  static async reconnect(record, opts) {
    const env = new this({ ...opts, environment: record.environment ?? null, environmentBuild: record.environmentBuild ?? null,
      startedAt: record.startedAt ?? opts.startedAt });   // `this`: E2bExecEnv keeps working
    env.sandboxId = record.sandboxId;
    // _adopt sets sandbox, sandboxId AND prefix from the handle (a backend's box need not carry pathPrefix).
    try { env._adopt(await env._call(() => env.client.connect(record.sandboxId))); }
    catch (err) {
      // _call turns only a CONFIRMED loss into ExecEnvLostError (gone, or unreachable and the control plane agrees):
      // flag it, so a resume may start a fresh sandbox. An unreachable provider (a dropped tunnel) is not that.
      if (err instanceof ExecEnvLostError) { err.sandboxGone = true; throw err; }
      throw new ExecEnvLostError(`The run's ${env.label} could not be reached on resume (${err.message}). ${LOST_HINT}`, { cause: err });
    }
    env.baseHead = record.baseHead || null;
    // The resume point is written on scheduler snapshots, so after a crash its syncedTree can lag the
    // host by a parallel node's pull. The host file is written right after every applied patch.
    let fromFile = null; try { fromFile = readFileSync(env._treeFile, 'utf8').trim() || null; } catch { /* drained, or no file */ }
    env.syncedTree = fromFile || record.syncedTree;
    try {
      await env.unpark();
      // Step files were synced after every finished spawn and at park time; an interrupted
      // spawn's files are not recovered (that step re-runs). Its CODE edits are pulled, so the
      // host matches the sandbox before the re-overlay re-baselines.
      env._known = new Map(Object.entries(await env._snapshot()));
      await env._pullCode({ tolerateApplied: true });
      await env._overlay();          // resume re-assembly rewrote the memory mount / skills: re-baseline
      await env._uploadSupport();    // and the run-root CLAUDE.md and mcp.json
      await env._killStaleRelay();   // the previous worca process's relay: nothing answers it any more
      await env._startRelay({ upload: true });
    } catch (err) {
      // unpark() started the heartbeat: a dropped env would renew the sandbox for as long as the server runs.
      await env.close('reconnect failed');
      throw err;
    }
    return env;
  }

  async close(reason) {
    this._closing = true; this._clearRelayRetry();
    this._stopHeartbeat(); clearTimeout(this._maxWaitTimer); this._maxWaitTimer = null;
    this._setParkedUntil(null);
    await this.relay.stop().catch(() => {});
    if (!this.sandbox) return;
    const id = this.sandboxId;
    try { await this.client.remove(id); this.log('info', `sandbox ${id} killed (${reason})`); }
    catch (err) { this.log('warn', `sandbox ${id} kill failed (${err.message}); a sweep removes it`); }
    this.sandbox = null;
    if (!this.lost) this.lost = new ExecEnvLostError(`The run's ${this.label} was released (${reason}). ${LOST_HINT}`);
    await rm(this.scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}
