// test/live/lib/sandbox.mjs
// One isolated world per scenario: a throwaway HOME and WORCA_HOME, a fixture
// project in its own git repo, and a tapped harness binary. worca runs from a
// chosen checkout (`repo`: the build under test, or the baseline build), so the
// same scenario can drive two builds side by side.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LIVE_ROOT = resolve(HERE, '..');
const TAP = join(HERE, 'tap.mjs');
const NODE = process.execPath;

const GIT_ID = { GIT_AUTHOR_NAME: 'Live Suite', GIT_AUTHOR_EMAIL: 'live@example.invalid', GIT_COMMITTER_NAME: 'Live Suite', GIT_COMMITTER_EMAIL: 'live@example.invalid' };
// Ambient switches that would bend a live run; never inherited from the shell.
const DROP_ENV = /^(WORCA_|ORCH_|LIVE_|NODE_TEST|ANTHROPIC_|CLAUDE_CODE_(?!OAUTH)|CLAUDECODE$|npm_)/;

export async function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{repo:string, profile:object, outDir:string, label:string, fixture?:string, env?:object, projectName?:string}} o
 */
export function createSandbox({ repo, profile, outDir, label, fixture = 'calc', env: extraEnv = {}, projectName = 'calc', base: fixedBase = null }) {
  mkdirSync(outDir, { recursive: true });
  const base = fixedBase || mkdtempSync(join(outDir, `${label.replace(/[^\w.-]+/g, '_').slice(0, 60)}-`));
  const home = join(base, 'home');
  const worca = join(base, 'worca');
  const projects = join(base, 'projects');
  const tapDir = join(base, 'tap');
  const binDir = join(base, 'bin');
  for (const d of [home, worca, projects, tapDir, binDir]) mkdirSync(d, { recursive: true });

  // The tapped harness: a wrapper with its config baked in, so it survives
  // worca's spawn-env scrub (which keeps only an allowlist of keys).
  const realBin = profile.realBin();
  const wrapper = join(binDir, profile.engine);
  writeFileSync(wrapper, `#!/bin/sh\nLIVE_TAP_DIR='${tapDir}' LIVE_TAP_REAL='${realBin}' LIVE_TAP_HOME='${profile.realHome()}' LIVE_TAP_SANDBOX_HOME='${home}' exec '${NODE}' '${TAP}' "$@"\n`);
  chmodSync(wrapper, 0o755);

  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!DROP_ENV.test(k)) env[k] = v;
  Object.assign(env, GIT_ID, {
    HOME: home,
    WORCA_HOME: worca,
    PATH: `${binDir}:${process.env.PATH}`,
    [profile.binEnv]: wrapper,
    WORCA_NO_UPDATE_CHECK: '1',
  }, extraEnv);

  const sb = {
    base, home, worca, projects, tapDir, repo, profile, env,
    cliPath: join(repo, 'src', 'cli', 'worca-cc.mjs'),

    /** A fixture project as its own git repo; returns its dir. */
    addProject(name = projectName, fx = fixture) {
      const dir = join(projects, name);
      if (existsSync(dir)) return dir;
      cpSync(join(LIVE_ROOT, 'fixtures', 'repos', fx), dir, { recursive: true });
      sb.git(dir, ['init', '-q', '-b', 'main']);
      sb.git(dir, ['add', '-A']);
      sb.git(dir, ['commit', '-qm', 'initial']);
      return dir;
    },

    git(cwd, args) {
      const r = spawnSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args], { cwd, env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout;
    },

    /** Run the worca CLI to completion. */
    cli(args, { timeoutMs = 45 * 60 * 1000, cwd = base, env: e = {} } = {}) {
      return new Promise((res) => {
        const t0 = Date.now();
        const ch = spawn(NODE, ['--disable-warning=ExperimentalWarning', sb.cliPath, ...args], { cwd, env: { ...env, ...e }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        ch.stdout.on('data', (d) => { out += d; });
        ch.stderr.on('data', (d) => { err += d; });
        const timer = setTimeout(() => { ch.kill('SIGTERM'); setTimeout(() => ch.kill('SIGKILL'), 10000); }, timeoutMs);
        ch.on('close', (code, signal) => { clearTimeout(timer); res({ code, signal, stdout: out, stderr: err, ms: Date.now() - t0, timedOut: Date.now() - t0 >= timeoutMs }); });
      });
    },

    /** Start the worca CLI and hand back the child (pause/stop/kill scenarios). */
    cliBackground(args, { cwd = base, env: e = {} } = {}) {
      const ch = spawn(NODE, ['--disable-warning=ExperimentalWarning', sb.cliPath, ...args], { cwd, env: { ...env, ...e }, stdio: ['ignore', 'pipe', 'pipe'] });
      ch.out = ''; ch.err = '';
      ch.stdout.on('data', (d) => { ch.out += d; });
      ch.stderr.on('data', (d) => { ch.err += d; });
      ch.done = new Promise((res) => ch.on('close', (code, signal) => res({ code, signal, stdout: ch.out, stderr: ch.err })));
      return ch;
    },

    cliSync(args, { env: e = {} } = {}) {
      return spawnSync(NODE, ['--disable-warning=ExperimentalWarning', sb.cliPath, ...args], { cwd: base, env: { ...env, ...e }, encoding: 'utf8', timeout: 120000 });
    },

    runs() {
      const r = sb.cliSync(['runs', '--json']);
      try { return JSON.parse(r.stdout); } catch { return []; }
    },
    runShow(id) {
      const r = sb.cliSync(['runs', 'show', id, '--json']);
      try { return JSON.parse(r.stdout); } catch { return null; }
    },

    db() { return new DatabaseSync(join(worca, '.worca-cc', 'worca-cc.db'), { readOnly: true }); },
    query(sql, ...params) {
      const db = sb.db();
      try { return db.prepare(sql).all(...params); } finally { db.close(); }
    },

    /** Every tapped spawn so far, oldest first, with its wire summary. */
    taps() {
      if (!existsSync(tapDir)) return [];
      return readdirSync(tapDir).filter((f) => f.endsWith('.json')).sort().map((f) => {
        const rec = JSON.parse(readFileSync(join(tapDir, f), 'utf8'));
        const stdout = existsSync(rec.stdoutFile) ? readFileSync(rec.stdoutFile, 'utf8') : '';
        rec.probe = profile.isProbe(rec);
        rec.site = profile.callSite(rec);
        rec.wire = rec.probe ? null : profile.parseWire(stdout);
        return rec;
      }).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    },
    agentTaps() { return sb.taps().filter((t) => !t.probe); },

    /** The UI server on a free port; api(method, path, body) talks to it. */
    async server({ mock = false } = {}) {
      const port = await freePort();
      const ch = spawn(NODE, ['--disable-warning=ExperimentalWarning', join(repo, 'ui', 'server.mjs')], {
        cwd: repo, env: { ...env, PORT: String(port), ...(mock ? { WORCA_MOCK: '1' } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      ch.stdout.on('data', (d) => { log += d; });
      ch.stderr.on('data', (d) => { log += d; });
      const url = `http://127.0.0.1:${port}`;
      const api = async (method, path, body, { headers = {} } = {}) => {
        const r = await fetch(url + path, { method, headers: { 'content-type': 'application/json', origin: url, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await r.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        return { status: r.status, json, text };
      };
      for (let i = 0; i < 150; i++) {
        try { const r = await fetch(`${url}/api/settings`); if (r.ok) break; } catch { /* not up yet */ }
        if (ch.exitCode !== null) throw new Error(`server exited: ${log.slice(-2000)}`);
        await sleep(200);
      }
      const srv = { port, url, api, child: ch, log: () => log,
        async stop() { if (ch.exitCode !== null) return; ch.kill('SIGTERM'); for (let i = 0; i < 50 && ch.exitCode === null; i++) await sleep(100); if (ch.exitCode === null) ch.kill('SIGKILL'); } };
      return srv;
    },

    settingsFile: join(home, '.worca-cc', 'settings.json'),
    readSettings() { try { return JSON.parse(readFileSync(sb.settingsFile, 'utf8')); } catch { return {}; } },
    writeSettings(obj) { mkdirSync(dirname(sb.settingsFile), { recursive: true }); writeFileSync(sb.settingsFile, JSON.stringify(obj, null, 2)); },
  };
  return sb;
}

/** Poll until fn() returns a truthy value (or time runs out → null). */
export async function waitFor(fn, { timeoutMs = 600000, everyMs = 2000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs);
  }
  return null;
}
export { sleep };
