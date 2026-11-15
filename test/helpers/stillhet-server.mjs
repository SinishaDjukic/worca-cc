// A real server in a child process with a temp HOME and a given WORCA_FLAGS, for the tests that need the flag read at
// start-up (the flags module reads WORCA_FLAGS once). `root` is the tree to serve (default: this checkout).
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

export async function startServer({ flags, root = ROOT, settings = {}, env = {} } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'stillhet-srv-'));
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding: { welcomeSeen: true }, ...settings }));
  const port = await freePort();
  const childEnv = { ...process.env, PORT: String(port), HOME: home, USERPROFILE: home, WORCA_HOME: join(home, 'worca-home'), WORCA_MOCK: '1', WORCA_TEST_ALLOW_HOME_FALLBACK: '1', FORCE_COLOR: '0', ...env };
  delete childEnv.WORCA_FLAGS;
  if (flags !== undefined) childEnv.WORCA_FLAGS = flags;
  let log = '';
  const child = spawn(process.execPath, ['ui/server.mjs'], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${log}`);
    try { up = (await fetch(`${base}/api/projects`)).ok; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!up || /already in use/.test(log)) throw new Error(`server did not start: ${log}`);
  return { base, home, log: () => log, stop: async () => { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); await rm(home, { recursive: true, force: true }); } };
}
