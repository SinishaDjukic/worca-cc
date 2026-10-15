// tools/demo/extension-video/lib/start-host.mjs — the parent side of the demo Worca: spawn lib/worca-host.mjs in a
// sandboxed env, wait for its WORCA_DEMO_READY line, stop it. The parent keeps the real HOME (Playwright's browsers).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

export const READY_PREFIX = 'WORCA_DEMO_READY ';

/** Parse the host's ready line → {url, port, projectKey, appUrl, appPort, runId, actionStarted} or null. */
export function parseReadyLine(line) {
  if (!line.startsWith(READY_PREFIX)) return null;
  try { return JSON.parse(line.slice(READY_PREFIX.length)); } catch { return null; }
}

/** Sandbox env for the demo Worca: everything under `home`, mock + scenario on, agent/remote vars dropped. */
export function hostEnv(base, { home, port, scenario }) {
  const env = { ...base, HOME: home, USERPROFILE: home, WORCA_HOME: home, PORT: String(port), WORCA_MOCK: '1',
    WORCA_DEMO_SCENARIO: scenario, GIT_CONFIG_NOSYSTEM: '1', WORCA_PROJECTS_ROOT: home };
  for (const k of ['WORCA_HOST_PID', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_ALLOWED_HOSTS', 'CLAUDE_CONFIG_DIR',
    'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'ORCH_MOCK']) delete env[k];
  return env;
}

export async function startHost({ home, port, scenario, log }) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('./worca-host.mjs', import.meta.url))],
    { env: hostEnv(process.env, { home, port, scenario }), stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = createInterface({ input: child.stdout });
  const ready = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('demo Worca did not get ready in 180 s')), 180_000);
    child.once('exit', (c) => { clearTimeout(t); reject(new Error(`demo Worca exited (${c}) before it was ready`)); });
    rl.on('line', (l) => { const r = parseReadyLine(l); if (r) { clearTimeout(t); resolve(r); } else log(`[worca] ${l}`); });
  }).catch(async (err) => { if (child.exitCode == null) { child.kill('SIGTERM'); await once(child, 'exit'); } throw err; });
  return { ...ready, child, async stop() { if (child.exitCode == null) { child.kill('SIGTERM'); await once(child, 'exit'); } } };
}
