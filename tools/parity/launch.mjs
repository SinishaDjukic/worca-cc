// tools/parity/launch.mjs — #919 slice 2: start a target (source tree, installed package, Docker image) in a sandbox.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { createServer } from 'node:net';
import { devNull, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';

export const SIGNED_OUT_HOST = 'parity.invalid';
export const HOST_APP_PORT = 4317;          // the host worca app; never a target's host port
export const CONTAINER_PORT = 4317;         // the image's own EXPOSE (docker/Dockerfile)
const KEEP = ['PATH', 'LANG', 'TMPDIR', 'TEMP', 'TMP', 'TERM', 'SystemRoot', 'ComSpec'];
const GIT_ID = { GIT_AUTHOR_NAME: 'parity', GIT_AUTHOR_EMAIL: 'parity@example.invalid',
  GIT_COMMITTER_NAME: 'parity', GIT_COMMITTER_EMAIL: 'parity@example.invalid' };

export function parseTarget(spec) {
  const m = /^(tree|package|docker):(.+)$/.exec(String(spec));
  if (!m) throw new Error(`target must start with tree:, package: or docker: (got ${spec})`);
  // the ref lands in the docker argv before the image: a leading '-' would be read as a docker option
  if (m[1] === 'docker' && !/^[a-z0-9][\w.\-/:@]*$/i.test(m[2])) throw new Error(`not a docker image reference: ${m[2]}`);
  return { kind: m[1], ref: m[2] };
}

/** Allowlist env (D3): nothing of the operator's credentials or host config reaches a target. */
export function buildEnv(base, { home, port, signedOut = false }) {
  const env = {};
  for (const [k, v] of Object.entries(base)) if (KEEP.includes(k) || k.startsWith('LC_')) env[k] = v;
  Object.assign(env, GIT_ID, { HOME: home, USERPROFILE: home, WORCA_HOME: home, WORCA_MOCK: '1',
    WORCA_NO_NATIVE_DIALOG: '1', PORT: String(port) });
  if (signedOut) Object.assign(env, { WORCA_ALLOWED_HOSTS: SIGNED_OUT_HOST, WORCA_IDENTITY_ISSUER: 'http://localhost:9' });
  return env;
}

export function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
    s.on('error', fail);
  });
}

/**
 * The run args of tools/docker-smoke.mjs main(). That file runs main() at import, so it cannot be imported.
 * No --rm: an exited container must stay inspectable and keep its log; stop() removes it.
 */
export function dockerArgs({ image, projectPath, vol, claudeVol, env, user }) {
  const args = ['run', '-d', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '-p', `127.0.0.1:0:${CONTAINER_PORT}`, '-v', `${vol}:/worca`, '-v', `${claudeVol}:/home/worca/.claude`,
    '-v', `${projectPath}:/projects/sandbox`];
  if (user) args.push('--user', user);
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  return [...args, image];
}

async function waitHealthy({ base, logFile, t0, exited, ms = 60_000 }) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
    if (/already in use/.test(log)) throw new Error(`port ${new URL(base).port} is already in use (server log: ${logFile})`);
    if (exited()) throw new Error(`server exited (${exited()}) before /api/health answered (server log: ${logFile})`);
    try { const r = await fetch(`${base}/api/health`); if (r.status === 200) return Date.now() - t0; } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no 200 from /api/health within ${ms} ms (server log: ${logFile})`);
}

/**
 * Extract a tree's `npm pack --ignore-scripts` tarball (no prepack build: `extension/dist` and other built files must
 * already exist in the tree, as for `test/extension-packaging.test.mjs`) and reuse that tree's node_modules (R-ops-4).
 */
export function installPackage(treeDir) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-pkg-'));
  const out = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], { cwd: treeDir, encoding: 'utf8' });
  const tgz = JSON.parse(out)[0].filename;
  const app = join(dir, 'app');
  mkdirSync(app);
  execFileSync('tar', ['-xzf', join(dir, tgz), '-C', app, '--strip-components=1']);
  symlinkSync(resolve(treeDir, 'node_modules'), join(app, 'node_modules'), 'dir');
  return app;
}

/** Fixed paths for the UI server so A and B show the same paths (D15); a lock dir keeps two harness runs apart. */
export function fixedRoot(base = tmpdir()) {
  const root = join(base, 'worca-parity');
  const lock = join(root, 'lock');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const st = lstatSync(root);   // a shared $TMPDIR: refuse a planted or loose root (D15)
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${root} is not a plain directory`);
  if (process.getuid && st.uid !== process.getuid()) throw new Error(`${root} belongs to uid ${st.uid}`);
  if (process.platform !== 'win32' && (st.mode & 0o077)) throw new Error(`${root} is open to group/other (mode ${(st.mode & 0o777).toString(8)})`);
  try { mkdirSync(lock); } catch {
    let pid = NaN; try { pid = Number(readFileSync(join(lock, 'pid'), 'utf8')); } catch {}   // no pid file: a dead owner
    let alive = false; if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch {} }
    if (alive) throw new Error(`another parity run (pid ${pid}) holds ${lock}`);
  }
  writeFileSync(join(lock, 'pid'), String(process.pid));
  return { root, release: () => rmSync(lock, { recursive: true, force: true }) };
}

/** The operator's git config (hooks, templates, signing) never touches the throwaway repo (D3). */
function sandboxRepo(projectPath) {
  rmSync(projectPath, { recursive: true, force: true });
  mkdirSync(projectPath, { recursive: true });
  const env = { ...process.env, ...GIT_ID, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };
  const safe = ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${devNull}`];
  execFileSync('git', [...safe, 'init', '-q', '-b', 'main', projectPath], { env });
  execFileSync('git', [...safe, '-C', projectPath, 'commit', '-q', '--allow-empty', '-m', 'init'], { env });
}

/**
 * opts.fixed: a fixedRoot().root for the UI server (wiped home and sandbox at fixed paths); else a fresh mkdtemp.
 * @returns {Promise<{kind, base, port, bootMs, root, projectPath, logFile, alive: () => boolean, stop: () => Promise<void>}>}
 */
export async function startTarget({ kind, ref, signedOut = false, appDir }, { port: wantPort, fixed } = {}) {
  const port = wantPort ?? await freePort();
  if (port === HOST_APP_PORT) throw new Error(`refusing port ${HOST_APP_PORT}: it belongs to the host worca app`);
  const home = fixed ? join(fixed, 'home') : mkdtempSync(join(tmpdir(), 'parity-home-'));
  if (fixed) { rmSync(home, { recursive: true, force: true }); mkdirSync(home, { recursive: true }); }
  const logFile = join(home, 'server.log');
  const projectPath = fixed ? join(fixed, 'sandbox') : join(home, 'sandbox');
  sandboxRepo(projectPath);
  const t0 = Date.now();
  if (kind === 'docker') {
    let vol = null; let claudeVol = null;
    const env = { WORCA_MOCK: '1', ...GIT_ID, ...(signedOut ? { WORCA_ALLOWED_HOSTS: SIGNED_OUT_HOST, WORCA_IDENTITY_ISSUER: 'http://localhost:9' } : {}) };
    const user = process.platform === 'linux' ? `${userInfo().uid}:${userInfo().gid}` : undefined;
    let id = null;
    const quiet = (args) => { try { execFileSync('docker', args, { stdio: 'ignore' }); } catch {} };
    const running = () => { try { return execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', id], { encoding: 'utf8' }).trim() === 'true'; } catch { return false; } };
    const dumpLog = () => { try { writeFileSync(logFile, execFileSync('docker', ['logs', id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); } catch {} };
    const remove = () => {
      if (id) { dumpLog(); quiet(['stop', id]); quiet(['rm', '-f', id]); }
      const vols = [vol, claudeVol].filter(Boolean);
      if (vols.length) quiet(['volume', 'rm', '-f', ...vols]);
      id = null;
    };
    try {
      vol = execFileSync('docker', ['volume', 'create'], { encoding: 'utf8' }).trim();
      claudeVol = execFileSync('docker', ['volume', 'create'], { encoding: 'utf8' }).trim();
      id = execFileSync('docker', dockerArgs({ image: ref, projectPath, vol, claudeVol, env, user }), { encoding: 'utf8' }).trim();
      const hostPort = Number(execFileSync('docker', ['port', id, `${CONTAINER_PORT}/tcp`], { encoding: 'utf8' }).trim().split('\n')[0].split(':').pop());
      if (hostPort === HOST_APP_PORT) throw new Error(`refusing port ${HOST_APP_PORT}`);
      const base = `http://127.0.0.1:${hostPort}`;
      const bootMs = await waitHealthy({ base, logFile, t0, exited: () => (running() ? null : 'container stopped') });
      return { kind, base, port: hostPort, bootMs, logFile, projectPath: '/projects/sandbox', alive: running,
        stop: async () => remove() };
    } catch (e) { remove(); throw e; }
  }
  const out = openSync(logFile, 'a');
  // realpath: ui/server.mjs listens only when argv[1] equals its own (realpath) URL, so /tmp/x (/private/tmp/x) never would
  const root = realpathSync(kind === 'package' ? (appDir ?? installPackage(resolve(ref))) : resolve(ref));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'ui', 'server.mjs')],
    { cwd: home, env: buildEnv(process.env, { home, port, signedOut }), stdio: ['ignore', out, out] });
  let exit = null;
  child.once('exit', (code, sig) => { exit = sig ? `signal ${sig}` : `code ${code}`; });
  const base = `http://127.0.0.1:${port}`;
  let bootMs;
  try { bootMs = await waitHealthy({ base, logFile, t0, exited: () => exit }); }
  catch (e) { if (!exit) child.kill('SIGKILL'); throw e; }
  return { kind, base, port, bootMs, logFile, projectPath, root, home, pid: child.pid, alive: () => exit === null,
    stop: () => (exit !== null ? Promise.resolve()
      : new Promise((r) => { child.once('exit', () => r()); child.kill('SIGTERM'); })) };
}
