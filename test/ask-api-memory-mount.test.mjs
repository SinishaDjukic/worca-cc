// test/ask-api-memory-mount.test.mjs — the message route refreshes the Ask memory mount for the
// RESOLVED project and hands it to the turn; the system prompt carries no memory block.
// Boot idiom: test/ask-api-messages.test.mjs (temp home BEFORE the dynamic import).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { memoryRoot, GLOBAL_SCOPE, projectScope, writeMemory, readMemory } from '../src/core/memory-store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { memoryCaps } from '../src/core/settings.mjs';

useTempHome(after);

let homeDir, prevHome, srv, base, wsBase, mod, project;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
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

test('the message route mounts global + the resolved project under <home>/ask/memory/<key>/.claude/rules/worca and the prompt carries no block', async () => {
  const { thread } = await (await post('/api/ask/threads', {})).json();
  const { ws, msgs, opened } = openWs();
  await opened;
  try {
    const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', ...MODEL, context: { view: 'new', projectKey: project.key } });
    assert.equal(r.status, 202, await r.text());
    await waitFor(() => msgs.some((m) => m.threadId === thread.id && typeof m.seq === 'number'));
    const turn = mod._testing.askJobs.get(thread.id)?.turn;
    assert.equal(typeof turn?.systemPrompt, 'string');
    assert.ok(!turn.systemPrompt.includes('## Worca memory'), 'no block in the prompt');
    const mountBase = join(worcaHome(), 'ask', 'memory', project.key);   // worcaHome() = <WORCA_HOME>/.worca-cc — never homeDir itself (and never the file-level `base`, which is the server URL)
    await waitFor(() => turn.memoryDir === mountBase);
    assert.equal(await readFile(join(mountBase, '.claude', 'rules', 'worca', 'global', 'style.md'), 'utf8'), (await readMemory(memoryRoot(), GLOBAL_SCOPE, 'style')).text);
    assert.equal(await readFile(join(mountBase, '.claude', 'rules', 'worca', 'project', 'conventions.md'), 'utf8'), (await readMemory(memoryRoot(), projectScope(project.key), 'conventions')).text);
    await waitFor(() => msgs.some((m) => m.threadId === thread.id && m.type === 'ask-done'));
  } finally { ws.close(); }
});

test('no project in the context ⇒ the global-only mount; an empty store ⇒ no mount dir at all (byte-identical spawn)', async () => {
  const { refreshAskMemoryMount } = await import('../src/core/ask/memory-deps.mjs');
  const g = await refreshAskMemoryMount({});
  assert.equal(g, join(worcaHome(), 'ask', 'memory', 'global'));
  assert.equal(existsSync(join(g, '.claude', 'rules', 'worca', 'global', 'style.md')), true);
  assert.equal(existsSync(join(g, '.claude', 'rules', 'worca', 'project')), false, 'no project dir without a project');
  // Non-destructive refresh: a stale file is unlinked, the dir itself survives (a turn already spawning on it never sees an empty dir).
  await writeFile(join(g, '.claude', 'rules', 'worca', 'global', 'stale.md'), 'x');
  await writeFile(join(g, '.claude', 'rules', 'worca', 'sentinel.txt'), 'x');   // outside the scope dirs: only an rm of the mount could remove it
  await refreshAskMemoryMount({});
  assert.equal(existsSync(join(g, '.claude', 'rules', 'worca', 'global', 'stale.md')), false);
  assert.equal(existsSync(join(g, '.claude', 'rules', 'worca', 'sentinel.txt')), true, 'non-destructive: refreshed in place, never rm-ed (an rm+rewrite mutation is caught here)');
  await rm(memoryRoot(), { recursive: true, force: true });
  assert.equal(await refreshAskMemoryMount({}), null, 'empty store ⇒ null ⇒ no --add-dir');
  assert.equal(existsSync(join(g, '.claude', 'rules', 'worca', 'global', 'style.md')), false, 'and the stale mount was emptied');
  // This test WIPES the store, so it must stay last among the tests that read the seeded store —
  // and it re-seeds for a later test: the two calls below are the `before` hook's, verbatim, so a
  // test appended after this one starts from the same store the hook built.
  const caps = memoryCaps();
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'style', '---\nname: style\ndescription: Terse commits\n---\nNo emoji.\n', { source: 'user', caps });
  await writeMemory(memoryRoot(), projectScope(project.key), 'conventions', '---\nname: conventions\ndescription: Naming rules\n---\nkebab-case files.\n', { source: 'user', caps });
});

test('a junk name in the STORE is reported as ignored, never as a mount write failure; the good file still mounts', async () => {
  const { refreshAskMemoryMount } = await import('../src/core/ask/memory-deps.mjs');
  const caps = memoryCaps();
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'style', '---\nname: style\ndescription: Terse commits\n---\nNo emoji.\n', { source: 'user', caps });
  await writeFile(join(memoryRoot(), 'global', 'junk name.md'), 'not a memory file\n');
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let g;
  try { g = await refreshAskMemoryMount({}); } finally { console.warn = realWarn; }
  assert.equal(g, join(worcaHome(), 'ask', 'memory', 'global'), 'the base is still returned');
  assert.equal(existsSync(join(g, '.claude', 'rules', 'worca', 'global', 'style.md')), true, 'the good file still mounts');
  assert.equal(existsSync(join(g, '.claude', 'rules', 'worca', 'global', 'junk name.md')), false);
  assert.equal(warns.length, 1, warns.join('\n'));
  assert.match(warns[0], /^\[worca-ask\] memory: ignoring .*junk name\.md/);
  assert.match(warns[0], /letters, digits/, 'the name rule, not the write-failure wording');
  assert.ok(!warns[0].includes('could not be refreshed'), 'a listing error is not a write failure');
});
