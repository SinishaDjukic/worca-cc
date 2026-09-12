// test/ask-api-memory-prompt.test.mjs — the message route's prompt assembly (agent-memory-design.md
// §9.2): the `## Worca memory` block is rendered for the RESOLVED project and sits between the rules
// and the catalog. Boot idiom: test/ask-api-messages.test.mjs (temp home BEFORE the dynamic import).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { memoryRoot, GLOBAL_SCOPE, projectScope, writeMemory } from '../src/core/memory-store.mjs';
import { memoryCaps } from '../src/core/settings.mjs';

useTempHome(after);

let homeDir, prevHome, srv, base, wsBase, mod, project;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5', effort: 'high' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });

function openWs() {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    })();
  });
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askmemprompt-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
  const { addProject } = await import('../src/core/projects.mjs');
  project = (await addProject({ name: 'promptmem', path: gitDir('promptmem') })).find((p) => p.name === 'promptmem');
  const caps = memoryCaps();
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'style', '---\nname: style\ndescription: Terse commits\n---\nNo emoji.\n', { source: 'user', caps });
  await writeMemory(memoryRoot(), projectScope(project.key), 'conventions', '---\nname: conventions\ndescription: Naming rules\n---\nkebab-case files.\n', { source: 'user', caps });
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

test('the message route puts the memory index between the rules and the catalog, covering the project the context resolved', async () => {
  const { thread } = await (await post('/api/ask/threads', {})).json();
  const { ws, msgs, opened } = openWs();
  await opened;
  try {
    const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', ...MODEL, context: { view: 'new', projectKey: project.key } });
    assert.equal(r.status, 202, await r.text());   // the route ACCEPTS the turn; the frames follow on the socket
    // The live job's own prompt — authoritative: this is the exact string the turn spawned with.
    await waitFor(() => msgs.some((m) => m.threadId === thread.id && typeof m.seq === 'number'));
    const sys = mod._testing.askJobs.get(thread.id)?.turn?.systemPrompt;
    assert.equal(typeof sys, 'string', 'the job is still readable when its first frame lands');
    assert.ok(sys.indexOf('## Worca memory') < sys.indexOf('## Catalog'), 'the block sits between the rules and the catalog');
    assert.ok(sys.includes('Global — scope "global":\n- `style.md`'), sys.slice(sys.indexOf('## Worca memory'), sys.indexOf('## Catalog')));
    assert.ok(sys.includes(`Project promptmem — scope "project":\n- \`conventions.md\``), 'the resolved project rides the index');
    await waitFor(() => msgs.some((m) => m.threadId === thread.id && m.type === 'ask-done'));
  } finally { ws.close(); }
});

test('_testing.askSystemPromptFor: the same assembly without a live job — no project in the context ⇒ global only', async () => {
  const catalog = await (await import('../src/core/ask/catalog.mjs')).buildCatalog();
  const withProject = await mod._testing.askSystemPromptFor(catalog, { project: { key: project.key, name: 'promptmem' } });
  assert.ok(withProject.indexOf('## Worca memory') < withProject.indexOf('## Catalog'));
  assert.ok(withProject.includes('Project promptmem — scope "project":\n- `conventions.md`'));
  const noProject = await mod._testing.askSystemPromptFor(catalog, {});
  assert.ok(noProject.includes('Global — scope "global":\n- `style.md`'));
  assert.ok(!noProject.includes('scope "project"'), 'an unresolved project renders no project section');
});
