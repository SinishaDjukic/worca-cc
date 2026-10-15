// tools/demo/extension-video/lib/worca-host.mjs — the demo's isolated Worca, in-process (like tools/readme-screenshots.mjs)
// so it can answer the mock run's clarify question through the `runs` map. Prints one WORCA_DEMO_READY {json} line.
// Runs ONLY as a child of lib/start-host.mjs, whose hostEnv() has already sandboxed HOME/WORCA_HOME and set WORCA_MOCK.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freePort } from './ports.mjs';
import { createSampleProject } from './sample-project.mjs';
import { READY_PREFIX } from './start-host.mjs';

const HOME = process.env.WORCA_HOME;
const PORT = Number(process.env.PORT);
if (!HOME || !PORT || process.env.WORCA_MOCK !== '1') throw new Error('worca-host.mjs runs only under lib/start-host.mjs (sandboxed WORCA_HOME, PORT, WORCA_MOCK=1)');
writeFileSync(join(HOME, '.gitconfig'), '[user]\n\tname = Alex Rivera\n\temail = alex@acme.test\n[init]\n\tdefaultBranch = main\n');
const projectDir = createSampleProject(join(HOME, 'code', 'acme-pulse'));

const { server, runs } = await import(new URL('../../../../ui/server.mjs', import.meta.url).href);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const url = `http://127.0.0.1:${PORT}`;
const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
  const res = await fetch(url + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${JSON.stringify(j)}`), { status: res.status, body: j });
  return j;
};
const until = async (fn, tag, ms = 120_000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${tag}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

await api('/api/onboarding', { welcomeSeen: true, hidden: true });
const { projects } = await api('/api/projects', { name: 'Acme Pulse', path: projectDir });
const projectKey = projects.find((p) => p.path === projectDir || p.name === 'Acme Pulse').key;

// One finished mock run: Actions run in a run's checkout (POST …/actions/:id/try picks the newest finished one).
const started = await api('/api/run', { projectDir, prompt: 'Polish the pricing page', title: 'Polish the pricing page', workflowId: 'wf_default', mock: true });
const q = await until(() => runs.get(started.runId)?.pendingQuestion, 'the mock run\'s clarify question');
await api('/api/answer', { runId: started.runId, id: q.id, payload: { answers: q.questions.map((x) => ({ id: x.id, choice: x.recommended || x.options[0] })) } });
await until(() => runs.get(started.runId)?.settled, 'the mock run to finish');

await api(`/api/projects/${projectKey}/actions`, { actions: [{ id: 'dev', label: 'Dev server', kind: 'service', cmd: 'node serve.mjs', cwd: '.',
  env: [{ name: 'PORT', type: 'port', value: 'auto' }], openUrl: 'http://localhost:{PORT}', ready: { kind: 'port', port: 'PORT', timeoutMs: 30000 } }] }, 'PUT');

/** The bound PORT of the run's `dev` instance once it answers (registry snapshot: status ready, ports.PORT). */
const readyPort = (list) => {
  const inst = (list.instances || []).find((i) => i.actionId === 'dev' && i.status === 'ready');
  return inst ? Number(inst.ports?.PORT) || Number(new URL(inst.url).port) : null;
};

let runId = runs.get(started.runId)?.pipelineId || null;
let appUrl = null; let appPort = null; let actionStarted = false; let fallback = null;
try {
  const tried = await api(`/api/projects/${projectKey}/actions/dev/try`, {});
  runId = tried.runId;
  // 200 → snapshot; 202 → queued behind setup: poll the run's actions list until the instance is ready.
  appPort = await until(async () => readyPort(await api(`/api/runs/${runId}/actions?projectKey=${encodeURIComponent(projectKey)}`)),
    'the Dev server Action to be ready', 60_000);
  appUrl = `http://localhost:${appPort}`;
  actionStarted = true;
} catch (err) {
  // D9: keep the video reproducible; the script then pins the scope by hand.
  console.error(`WARN demo Worca: the Dev server Action did not start (${err.message}); serving the app directly`);
  appPort = await freePort();
  fallback = spawn(process.execPath, ['serve.mjs'], { cwd: projectDir, env: { ...process.env, PORT: String(appPort) }, stdio: 'ignore' });
  appUrl = `http://localhost:${appPort}`;
}
// Mock-run drift: the page served must still be the sample.
const page = await until(async () => { const r = await fetch(appUrl).catch(() => null); return r?.ok ? r.text() : null; }, 'the sample app to answer', 30_000);
if (!page.includes('Acme Pulse')) throw new Error(`${appUrl} does not serve the Acme Pulse sample`);

process.stdout.write(`${READY_PREFIX}${JSON.stringify({ url, port: PORT, projectKey, runId, appUrl, appPort, actionStarted })}\n`);

const shutdown = async () => {
  try { if (actionStarted) await api(`/api/runs/${runId}/actions/dev/stop?projectKey=${encodeURIComponent(projectKey)}`, {}); } catch { /* the instance is gone already */ }
  if (fallback) fallback.kill('SIGTERM');
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
