// test/helpers/loopback-backend.mjs
// A second execution backend for tests (plans/e2b-execution-design.md §17): a "box" is a temp dir exposed as
// pathPrefix, commands run with real bash there. It shares no code with the e2b fake on purpose: it proves a
// backend is ONE module the registry takes, with no harness, orchestrator or engine change.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';

export class LoopbackGoneError extends Error { constructor(m) { super(m); this.name = 'LoopbackGoneError'; } }
class LoopbackExitError extends Error { constructor(m, extra) { super(m); Object.assign(this, extra); } }

export function createLoopbackBackend({ root, name = 'loopback', failBuild = false } = {}) {
  const live = new Map();   // id -> { id, pathPrefix, tags, environment, timeoutMs, children }
  const events = [];
  let seq = 0; let base = 'loopback-base@1';
  const alive = (id) => { const b = live.get(id); if (!b) throw new LoopbackGoneError(`${name} box ${id} is gone`); return b; };
  const killGroup = (c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { c.kill('SIGKILL'); } };
  const handleOf = (b) => ({ id: b.id, pathPrefix: b.pathPrefix, box: b });

  function run(box, cmd, { background = false, cwd, env = {}, stdin = false, onStdout, onStderr } = {}) {
    alive(box.id);
    events.push({ type: 'command', id: box.id, cmd: cmd.slice(0, 200) });
    let stdout = ''; let stderr = ''; let killed = false;
    const child = spawn('bash', ['-c', cmd], { cwd: cwd || box.pathPrefix, detached: true,
      env: { PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}`, HOME: join(box.pathPrefix, 'home', 'user'), ...env } });
    box.children.add(child);
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; onStdout?.(d); });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; onStderr?.(d); });
    const done = new Promise((res) => child.on('close', (code) => { box.children.delete(child); res(killed ? 137 : code ?? 1); }));
    const wait = async () => { const exitCode = await done;
      if (exitCode !== 0) throw new LoopbackExitError(`exit ${exitCode}`, { exitCode, stdout, stderr });
      return { exitCode, stdout, stderr }; };
    if (!background) return wait();
    const handle = { pid: child.pid, wait, kill: async () => { killed = true; killGroup(child); return true; } };
    // stdin: true (the model relay): the handle writes to the command's open stdin
    if (stdin) handle.sendStdin = (d) => new Promise((res, rej) => child.stdin.write(d, (e) => (e ? rej(e) : res())));
    return Promise.resolve(handle);
  }

  const client = {
    async create({ environment, tags, timeoutMs }) {
      const id = `lb${++seq}`; const pathPrefix = join(root, id);
      mkdirSync(join(pathPrefix, 'home', 'user'), { recursive: true });   // the e2b fake's HOME layout
      const b = { id, pathPrefix, tags: { ...tags }, environment, timeoutMs, children: new Set() };
      live.set(id, b); events.push({ type: 'create', id, environment, tags: { ...tags } });
      return handleOf(b);
    },
    async connect(id) { const b = alive(id); events.push({ type: 'connect', id }); return handleOf(b); },
    async info(id) { return { id, tags: { ...alive(id).tags } }; },
    async list(tags) { return [...live.values()].filter((b) => Object.entries(tags).every(([k, v]) => b.tags[k] === v)).map((b) => ({ id: b.id, tags: { ...b.tags } })); },
    async remove(id) {
      const b = live.get(id); if (!b) return false;
      live.delete(id); for (const c of b.children) killGroup(c);
      rmSync(b.pathPrefix, { recursive: true, force: true }); events.push({ type: 'remove', id }); return true;
    },
    countRunning: async () => live.size,
    run,
    async readFile(box, path) { alive(box.id); return readFile(path); },
    async writeFile(box, path, data) { alive(box.id); await mkdir(dirname(path), { recursive: true }); await writeFile(path, data); },
    async setTimeout(box, ms) { alive(box.id).timeoutMs = ms; events.push({ type: 'setTimeout', id: box.id, ms }); },
    classifyError: (err) => (err?.name === 'LoopbackGoneError' ? 'gone' : null),
    describe: () => 'loopback',
    async buildEnvironment(spec, { name: envName, onLog = () => {} }) {
      onLog(`loopback: building ${envName}`); onLog(`loopback: ${spec.tools.length} tools, ${spec.apt.length} apt packages`);
      if (failBuild) throw new Error('loopback build failed');
      events.push({ type: 'build', name: envName, specHash: spec.hash });
      return { name: envName, id: `tpl-${envName}`, buildId: `b${++seq}`, specHash: spec.hash, baseVersion: base };
    },
  };

  const FROM = { project: 'the project setting', build: "the project's build", default: 'the default' };
  const backend = Object.freeze({
    name, label: 'Loopback box', title: 'Loopback', environmentNoun: 'image', workDir: '/tmp/worca-loopback',
    capabilities: Object.freeze({ pause: false, buildEnvironment: true, defaultMaxConcurrent: 2, defaultMaxWaitMin: 60 }),
    secretEnv: /^LOOPBACK_SECRET_/,
    projectFields: Object.freeze([{ key: 'image', label: 'Image', hint: 'lowercase letters, digits and -', validate: (v) => /^[a-z0-9-]+$/.test(v) }]),
    preflight: () => ({ errors: [], warnings: [] }),
    configured: () => true,
    open: async () => client,
    resolveEnvironment: ({ config = {}, build = null } = {}) => (config.image ? { name: config.image, source: 'project', from: FROM.project }
      : build?.name ? { name: build.name, source: 'build', from: FROM.build } : { name: 'loopback-base', source: 'default', from: FROM.default }),
    // The server a build lands on (e2b: E2B_API_URL + key); tests switch servers with LOOPBACK_SERVER.
    serverIdentity: (env = process.env) => ({ id: env.LOOPBACK_SERVER || 'here', label: `loopback ${env.LOOPBACK_SERVER || 'here'}` }),
    // The live status (GET /api/exec-envs/status): always reachable, its boxes are the running count.
    status: async ({ env = process.env } = {}) => ({ state: 'connected', server: `loopback ${env.LOOPBACK_SERVER || 'here'}`, running: live.size }),
    baseVersion: () => base,
    environmentName: (projectKey) => `loopback-${projectKey}`,
  });
  return { backend, client, live, events, setBase: (v) => { base = v; } };
}
