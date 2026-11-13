// src/core/executor/backends/docker.mjs
// The `docker` executor backend: the controller runs in a container and starts one worker
// container per run or chat through the Docker Engine API (the socket, or a socket proxy at
// WORCA_DOCKER_HOST). Path parity is the whole trick — a worker must see the run's checkout,
// the store and the staged files at the paths the controller wrote into the run — so the
// controller's OWN container is the template: its mounts (minus the docker socket; the Claude
// login volume read-only as a seed), its network and its user are replicated onto every worker.
// Nothing here is Compose-specific; `docker run` and Podman's socket work the same.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { join } from 'node:path';
import { CONTROLLER_LABEL, SCOPE_LABEL, WORKER_LABEL, INSTANCE_LABEL, NETWORK_ROLE_LABEL, FULL_VARIANT_ENGINES, fullVariantEngines, passThroughEnv, defaultWorkerEngine, envInt, abortError } from '../shared.mjs';

export const DOCKER_API = 'v1.43';
export { CONTROLLER_LABEL, SCOPE_LABEL, WORKER_LABEL };
const SEED_CLAUDE_DIR = '/seed/claude';
const START_WAIT_MS = 10_000;

/** `4g` / `512m` / `1024` -> bytes; null when unset or unparsable. */
export function parseBytes(v) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)b?\s*$/i.exec(String(v ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[m[2].toLowerCase()];
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

/** The Docker endpoint: a unix socket (default) or `tcp://host:port` (a socket proxy). */
export function dockerEndpoint(env = process.env) {
  const h = String(env.WORCA_DOCKER_HOST || env.DOCKER_HOST || '').trim();
  if (!h || h.startsWith('unix://')) return { socketPath: h ? h.slice('unix://'.length) : '/var/run/docker.sock' };
  const m = /^(?:tcp|http):\/\/([^/:]+)(?::(\d+))?\/?$/.exec(h);
  if (!m) throw new Error(`WORCA_DOCKER_HOST=${h}: expected tcp://host:port or unix:///path`);
  return { host: m[1], port: Number(m[2] || 2375) };
}

/** The controller's own container id: compose sets it as the hostname; an operator may name it. */
export function selfContainerId(env = process.env, { read = (f) => readFileSync(f, 'utf8') } = {}) {
  const explicit = String(env.WORCA_CONTROLLER_CONTAINER || '').trim();
  if (explicit) return explicit;
  const text = (f) => { try { return read(f); } catch { return ''; } };
  return containerIdFrom(text('/proc/self/cgroup'), text('/proc/self/mountinfo')) || String(env.HOSTNAME || hostname());
}

/**
 * A container's own 64-hex id from what its /proc says. cgroup v1 names it in every line
 * (`…:/docker/<id>`, `…/docker-<id>.scope`); under cgroup v2 that file is just `0::/`, and the id shows in the
 * mounts Docker makes for the container (`/var/lib/docker/containers/<id>/hostname`). null when neither has one —
 * the hostname is the fallback, which is the id's first 12 characters unless the operator set a hostname.
 */
export function containerIdFrom(cgroup = '', mountinfo = '') {
  // cgroup: the id ends a line (`/docker/<id>`, `docker-<id>.scope`).
  const c = /(?:^|[/-])([0-9a-f]{64})(?:\.scope)?[ \t]*$/m.exec(String(cgroup));
  if (c) return c[1];
  // mountinfo: ONLY the files Docker mounts from the container's own folder. Any 64-hex path will not do: the root
  // mount's overlay2 `upperdir` and every anonymous volume carry one too, and they come first.
  const m = /\/containers\/([0-9a-f]{64})\/(?:hostname|hosts|resolv\.conf)(?=\s)/.exec(String(mountinfo));
  return m ? m[1] : null;
}

/** A tiny Docker Engine API client over node:http (no dependency). */
export function createDockerApi(endpoint, { api = DOCKER_API, timeoutMs = 30_000 } = {}) {
  // Its own agent: the Engine (a socket, or the proxy sidecar on the Docker API network) is never reached through an
  // HTTP(S)_PROXY the process honours for everything else (Node's global agent follows the environment).
  const agent = new http.Agent({ keepAlive: false });
  const request = (method, path, body, { raw = false } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      ...endpoint, agent, method, path: `/${api}${path}`,
      headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), host: 'docker' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          let message = buf.toString('utf8').trim();
          try { message = JSON.parse(message).message || message; } catch { /* plain text */ }
          return reject(Object.assign(new Error(`docker ${method} ${path}: ${res.statusCode} ${message}`), { status: res.statusCode }));
        }
        if (raw) return resolve(buf);
        if (!buf.length) return resolve(null);
        try { resolve(JSON.parse(buf.toString('utf8'))); } catch { resolve(buf.toString('utf8')); }
      });
    });
    req.on('error', reject);
    // An Engine (or socket proxy) that accepts the connection and never answers must not hold a run forever: the
    // registry's own start timeout begins only once this backend has answered.
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`docker ${method} ${path}: no answer within ${Math.round(timeoutMs / 1000)} s`)));
    if (payload) req.write(payload);
    req.end();
  });
  return {
    version: () => request('GET', '/version'),
    inspect: (id) => request('GET', `/containers/${encodeURIComponent(id)}/json`),
    create: (name, spec) => request('POST', `/containers/create?name=${encodeURIComponent(name)}`, spec),
    start: (id) => request('POST', `/containers/${encodeURIComponent(id)}/start`),
    remove: (id) => request('DELETE', `/containers/${encodeURIComponent(id)}?force=1&v=1`),
    list: (labels) => request('GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: labels }))}`),
    network: (name) => request('GET', `/networks/${encodeURIComponent(name)}`),
    logsTail: (id, n = 50) => request('GET', `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&tail=${n}`, undefined, { raw: true }).then(demuxLogs).catch(() => ''),
  };
}

/** Docker's multiplexed log stream (8-byte frame headers) -> text. */
export function demuxLogs(buf) {
  if (!Buffer.isBuffer(buf)) return String(buf ?? '');
  if (buf.length < 8) return buf.toString('utf8');
  const parts = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const type = buf[i];
    const len = buf.readUInt32BE(i + 4);
    if (type > 2 || i + 8 + len > buf.length) return buf.toString('utf8');   // not multiplexed (a tty container)
    parts.push(buf.subarray(i + 8, i + 8 + len).toString('utf8'));
    i += 8 + len;
  }
  return parts.join('');
}

/**
 * The worker container's mounts, from the controller's: every volume and bind at the same
 * destination, except the docker socket, and the Claude login volume (the controller's
 * `~/.claude`) which rides read-only at /seed/claude for the worker to copy a login from.
 */
export function workerMountsFrom(selfMounts, { seedClaude = '/home/worca/.claude', enginePath = null, sshAgent = null } = {}) {
  const out = [];
  for (const m of selfMounts || []) {
    if (!m || !m.Destination) continue;
    if (/docker\.sock$/.test(m.Destination) || /docker\.sock$/.test(m.Source || '')) continue;
    const source = m.Type === 'volume' ? m.Name : m.Source;
    if (!source) continue;
    // The engine's own socket, whatever it is called (Podman's, a proxy's): never in a worker, which could drive it.
    if (enginePath && (source === enginePath || m.Destination === enginePath)) continue;
    // The controller's SSH agent socket (compose.ssh.yml) is its push credential: agents get no Git credential.
    if ((sshAgent && (source === sshAgent || m.Destination === sshAgent)) || /ssh-(agent|auth)\.sock$/.test(m.Destination)) continue;
    if (m.Destination === seedClaude) { out.push({ Type: m.Type, Source: source, Target: SEED_CLAUDE_DIR, ReadOnly: true }); continue; }
    out.push({ Type: m.Type, Source: source, Target: m.Destination, ReadOnly: m.RW === false });
  }
  return out;
}

/** The worker image for an engine: WORCA_WORKER_IMAGE (with `{engine}`), `self` for the controller's own image,
 *  or `<controller repo>-worker:<tag>-<engine>`. */
export function workerImageFor(engine, { pattern, controllerImage, fullEngines = FULL_VARIANT_ENGINES }) {
  let ref;
  if (pattern && pattern !== 'self') {
    if (!pattern.includes('{engine}')) return pattern;
    ref = pattern.replaceAll('{engine}', engine);
  } else {
    if (pattern === 'self' || !controllerImage) return controllerImage || null;
    // A digest pin (`repo@sha256:…`, `repo:1.3.0@sha256:…`) names one image, not a family: the tag before it, when
    // there is one, is what the worker images share; with none, nothing says which worker image goes with it.
    const pinned = controllerImage.indexOf('@');
    const base = pinned >= 0 ? controllerImage.slice(0, pinned) : controllerImage;
    const at = base.lastIndexOf(':');
    const slash = base.lastIndexOf('/');
    if (pinned >= 0 && at <= slash) return null;
    const [repo, tag] = at > slash ? [base.slice(0, at), base.slice(at + 1)] : [base, 'latest'];
    ref = `${repo}-worker:${tag}-${engine}`;
  }
  // A `-full` tag (WORCA_TAG=1.3.0-full) names the variant AFTER the engine, as published: `<tag>-<engine>-full`,
  // and only for the engines that have a full worker image; the others run their slim one.
  const tail = `-full-${engine}`;
  if (!ref.endsWith(tail)) return ref;
  return `${ref.slice(0, -tail.length)}-${engine}${fullEngines.includes(engine) ? '-full' : ''}`;
}

/**
 * Whether a worker of `engine` gets the controller's Claude login (the read-only /seed/claude mount and the copy
 * into its HOME): only one that can run Claude Code — the claude and all images, or one image serving every engine.
 */
export function seedsClaudeLogin(engine, pattern) {
  const perEngine = !pattern || (pattern !== 'self' && pattern.includes('{engine}'));
  return !perEngine || engine === 'claude' || engine === 'all';
}

/** The worker container's env: its assignment, plus what every backend lets a worker inherit (shared.mjs
 *  passThroughEnv: connectivity and identity, never a credential). The controller's own home and projects paths
 *  are the worker's too, since its mounts are replicated at the same destinations. */
export function workerEnvFor({ scopeKey, workerId, token, controllerUrl, idleMs, engine, env = process.env, seedClaude = true }) {
  return {
    WORCA_CONTROLLER_URL: controllerUrl, WORCA_WORKER_TOKEN: token, WORCA_WORKER_SCOPE: scopeKey, WORCA_WORKER_ID: workerId,
    WORCA_WORKER_ENGINE: engine, WORCA_CONTAINER: '1', WORCA_NO_DB: '1',
    ...(idleMs ? { WORCA_WORKER_IDLE_MS: String(idleMs) } : {}),
    ...(seedClaude ? { WORCA_WORKER_SEED_CLAUDE: SEED_CLAUDE_DIR } : {}),
    ...passThroughEnv(env, { controllerUrl, also: ['WORCA_HOME', 'WORCA_PROJECTS_ROOT', 'WORCA_DATA_DIR'] }),
  };
}

/**
 * The network worker containers join, chosen from the controller's own. Never the Docker API network (the socket
 * proxy's, labelled `worca.role=docker-api`): a worker there could drive the Engine. An INTERNAL network is
 * preferred over an open one: with the egress overlay the controller is on `internal`, and its workers — where the
 * agents run — must have no other route out than the allowlist proxy. `WORCA_WORKER_NETWORK` names one outright.
 * When the Engine does not answer about a network, its name decides (`…_docker-proxy`, `…_internal`).
 */
export async function pickWorkerNetwork({ attached = [], inspect = async () => null, override = null, log = () => {} } = {}) {
  const names = [...attached].sort();
  let want = String(override || '').trim();
  if (want && !names.includes(want)) {
    // The compose name (`internal`) is accepted for the Engine's project-prefixed one (`worca_internal`).
    const byShortName = names.filter((n) => n.endsWith(`_${want}`));
    if (byShortName.length === 1) want = byShortName[0];
    else throw new Error(`WORCA_WORKER_NETWORK=${want} is not a network of the controller's container (it is on: ${names.join(', ') || 'none'})`);
  }
  if (!names.length && !want) return 'bridge';
  const info = await Promise.all(names.map(async (name) => {
    let meta = null;
    try { meta = await inspect(name); } catch { meta = null; }
    // A network with a worca role is a link to one sidecar (the Docker API proxy, the broker): never a worker's uplink,
    // and no sign that the controller's own traffic is unconfined.
    const role = meta ? meta.Labels?.[NETWORK_ROLE_LABEL] || null : (/(^|[_-])docker[_-]proxy$/.test(name) ? 'docker-api' : /(^|[_-])broker$/.test(name) ? 'broker-link' : null);
    return {
      name,
      api: role === 'docker-api',
      link: !!role,
      internal: meta ? meta.Internal === true : /(^|[_-])internal$/.test(name),
    };
  }));
  if (want) {
    // Named outright: still never a sidecar's link network (the Docker API proxy's, the broker's), which the auto-pick
    // refuses for a reason — an agent there could drive the Engine.
    const chosen = info.find((n) => n.name === want);
    if (chosen?.link) throw new Error(`WORCA_WORKER_NETWORK=${want} is a sidecar's link network (${chosen.api ? 'the Docker API proxy' : 'the broker'}): workers never join it`);
    return want;
  }
  const usable = info.filter((n) => !n.link);
  if (!usable.length) throw new Error(`the controller's container is only on sidecar link networks (${names.join(', ')}): workers need a network they share with it`);
  const confined = usable.filter((n) => n.internal);
  const open = usable.filter((n) => !n.internal);
  if (confined.length && open.length) log(`the controller is on ${open.map((n) => n.name).join(', ')} as well as the internal network ${confined[0].name}: its own traffic is not confined to the egress proxy (with the workers overlay, set WORCA_UPLINK_NETWORK=internal). Workers join ${confined[0].name} only`);
  return (confined[0] || usable[0]).name;
}

export async function createDockerBackend({ env = process.env, log = () => {}, api = null, controllerId = null, bootId = `ctl-${process.pid}-${Date.now().toString(36)}`,
  uid = process.getuid?.() ?? null, gid = process.getgid?.() ?? null } = {}) {
  const docker = api || createDockerApi(dockerEndpoint(env), { timeoutMs: envInt(env, 'WORCA_DOCKER_TIMEOUT_MS', 30_000) });
  let version;
  try { version = await docker.version(); } catch (err) { throw new Error(`cannot reach the Docker Engine (${describeEndpoint(env)}): ${err.message}. Mount the socket or set WORCA_DOCKER_HOST to a socket proxy.`); }
  const selfId = controllerId || selfContainerId(env);
  let self;
  try { self = await docker.inspect(selfId); } catch (err) { throw new Error(`cannot inspect the controller's own container "${selfId}" (${err.message}); set WORCA_CONTROLLER_CONTAINER to its name or id, and run the controller as a container`); }
  const seedClaudeDir = join(String(env.HOME || '').trim() || homedir(), '.claude');   // the login volume is wherever this controller's HOME is
  const template = {
    mounts: workerMountsFrom(self.Mounts, { enginePath: dockerEndpoint(env).socketPath || null, sshAgent: String(env.SSH_AUTH_SOCK || '').trim() || null,
      seedClaude: seedClaudeDir }),   // the engine's socket and the SSH agent stay out
    network: await pickWorkerNetwork({ attached: Object.keys(self.NetworkSettings?.Networks || {}), inspect: (n) => docker.network(n), override: env.WORCA_WORKER_NETWORK, log }),
    // The uid this process runs as — not the container's configured start user: with agent isolation the controller
    // starts as root and its entrypoint drops to `worca`, and a worker created as `0:0` with every capability
    // dropped could not write the volume `worca` owns.
    user: String(env.WORCA_WORKER_USER || (uid != null ? `${uid}:${gid ?? uid}` : self.Config?.User || '')),
    image: self.Config?.Image || null,
  };
  // Which installation these workers belong to: the Compose project (or WORCA_INSTANCE_ID), so a second worca stack
  // on the same Docker host never lists or reaps them.
  const instance = String(env.WORCA_INSTANCE_ID || self.Config?.Labels?.['com.docker.compose.project'] || String(self.Name || selfId).replace(/^\//, '')).trim() || 'worca';
  const pattern = String(env.WORCA_WORKER_IMAGE || '').trim() || null;
  const fullEngines = fullVariantEngines(env);
  const mem = parseBytes(env.WORCA_WORKER_MEM || '4g');
  const cpus = Number(env.WORCA_WORKER_CPUS || 2);
  const pidsLimit = envInt(env, 'WORCA_WORKER_PIDS', 2048);   // the one-container box's limit (compose.yml pids_limit)
  const live = new Map();   // workerId -> handle
  log(`docker ${version?.Version || '?'} via ${describeEndpoint(env)}; controller ${self.Name || selfId} on network ${template.network}, ${template.mounts.length} mount(s) replicated, user ${template.user || '(image default)'}`);

  const engineFor = () => defaultWorkerEngine(env);

  return {
    kind: 'docker',
    template,
    /** What tells this scope's workers apart: the image an engine runs on (one image for every engine = one worker). */
    async classFor(engine) { return workerImageFor(engine || await engineFor(), { pattern, controllerImage: template.image, fullEngines }) || 'none'; },
    async start({ scope, scopeKey, workerId, token, controllerUrl, idleMs, engine: asked = null, signal = null, connected = () => false }) {
      if (signal?.aborted) throw abortError();   // the run was stopped while its worker was being arranged: nothing to create
      const engine = asked || await engineFor();   // the spawn's engine (the run's, the chat's); the install default only when none is named
      const image = workerImageFor(engine, { pattern, controllerImage: template.image, fullEngines });
      if (!image) throw new Error(`no worker image can be derived from the controller's image (${template.image || 'unknown'}): set WORCA_WORKER_IMAGE, e.g. registry/worca-worker:<tag>-{engine}`);
      const seed = seedsClaudeLogin(engine, pattern);
      const name = `worca-worker-${scope.kind}-${String(scope.id).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40)}-${workerId.slice(-8)}`;
      const spec = {
        Image: image, Cmd: ['worca', 'worker'], Hostname: name.slice(0, 63),
        ...(template.user ? { User: template.user } : {}),
        Env: Object.entries(workerEnvFor({ scopeKey, workerId, token, controllerUrl, idleMs, engine, env, seedClaude: seed })).map(([k, v]) => `${k}=${v}`),
        Labels: { [CONTROLLER_LABEL]: bootId, [INSTANCE_LABEL]: instance, [SCOPE_LABEL]: scopeKey, [WORKER_LABEL]: workerId, 'worca.engine': engine },
        HostConfig: {
          Mounts: seed ? template.mounts : template.mounts.filter((m) => m.Target !== SEED_CLAUDE_DIR), NetworkMode: template.network,
          Tmpfs: { '/tmp': 'rw,size=2g' }, SecurityOpt: ['no-new-privileges:true'], CapDrop: ['ALL'],
          PidsLimit: pidsLimit, ...(mem ? { Memory: mem } : {}), ...(Number.isFinite(cpus) && cpus > 0 ? { NanoCpus: Math.round(cpus * 1e9) } : {}),
          RestartPolicy: { Name: 'no' }, Init: true,
        },
      };
      let created;
      if (signal?.aborted) throw abortError();
      try { created = await docker.create(name, spec); } catch (err) {
        if (err.status === 404) throw new Error(`cannot create worker container from ${image}: ${err.message} — a missing image is pulled (or set WORCA_WORKER_IMAGE); a missing network is WORCA_WORKER_NETWORK`);
        throw new Error(`cannot create worker container: ${err.message}`);
      }
      const id = created?.Id;
      const handle = { workerId, id, name, scopeKey, image, engine, startedAt: Date.now() };
      try {
        await docker.start(id);
        // A container that dies at once (a bad image, a missing binary): say why now, not after the start timeout.
        const deadline = Date.now() + START_WAIT_MS;
        for (;;) {
          if (signal?.aborted) throw abortError();   // stopped meanwhile: the container goes (below), nobody waits for it
          const info = await docker.inspect(id);
          if (info?.State?.Running) break;
          if (info?.State?.Status === 'exited' || info?.State?.Dead) {
            const tail = await docker.logsTail(id, 50);
            throw new Error(`worker container exited at once (code ${info.State.ExitCode}) from ${image}${tail ? `:\n${tail.trim()}` : ''}`);
          }
          if (Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (err) {
        // The worker is already connected to the registry: the container runs, whatever the Engine's answer about it
        // was (a request that timed out, a transient error). Never remove a live worker over that.
        if (!connected()) { await docker.remove(id).catch(() => {}); throw err; }
        log(`${name}: the Engine could not confirm the start (${err?.message || err}), but its worker is connected`);
      }
      live.set(workerId, handle);
      log(`started ${name} (${image}) for ${scopeKey}`);
      return handle;
    },
    async remove(handle, { reason } = {}) {
      if (!handle?.id) return;
      live.delete(handle.workerId);
      try { await docker.remove(handle.id); log(`removed ${handle.name || handle.id} (${reason || 'released'})`); }
      catch (err) { if (err.status !== 404) throw err; }
    },
    /** Why this worker will never connect, or null while it may: its container has exited (with what it printed). */
    async probe(handle) {
      if (!handle?.id) return null;
      let info;
      try { info = await docker.inspect(handle.id); } catch (err) { return err.status === 404 ? 'its container is gone' : null; }
      if (info?.State?.Running || !(info?.State?.Status === 'exited' || info?.State?.Dead)) return null;
      const tail = await docker.logsTail(handle.id, 50);
      return `its container exited (code ${info.State.ExitCode})${tail ? `:\n${tail.trim()}` : ''}`;
    },
    async listWorkers() {
      const rows = await docker.list([`${INSTANCE_LABEL}=${instance}`]);   // this installation's only
      return (rows || []).map((c) => ({ id: c.Id, workerId: c.Labels?.[WORKER_LABEL] || c.Id.slice(0, 12), name: (c.Names || [])[0]?.replace(/^\//, '') || c.Id.slice(0, 12), scopeKey: c.Labels?.[SCOPE_LABEL] || null, image: c.Image,
        bootId: c.Labels?.[CONTROLLER_LABEL] || null, own: c.Labels?.[CONTROLLER_LABEL] === bootId }));
    },
    describe() { return { kind: 'docker', endpoint: describeEndpoint(env), instance, network: template.network, image: pattern || workerImageFor('<engine>', { pattern: null, controllerImage: template.image }), live: live.size }; },
    /** Where the Claude login workers are seeded from, in THIS process's filesystem (the controller's ~/.claude volume):
     *  a login a worker's engine refreshed is written back there when the worker ends (executor/login-seed.mjs). null
     *  when no worker is seeded (the volume is not mounted here). */
    loginSeedDir() { return template.mounts.some((m) => m.Target === SEED_CLAUDE_DIR) ? seedClaudeDir : null; },
  };
}

function describeEndpoint(env) {
  try { const e = dockerEndpoint(env); return e.socketPath ? `unix://${e.socketPath}` : `tcp://${e.host}:${e.port}`; } catch { return 'docker'; }
}
