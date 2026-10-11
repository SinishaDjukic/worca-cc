// test/ask-api-spec-cards.test.mjs
// The Spec Builder card end to end over WORCA_MOCK + WORCA_FLAGS=specBuilder (docs/spec-builder.md): the wizard's
// POST /api/spec-builder/prompt text opens a thread pinned to the project → the mock's propose_spec fills the
// skeleton → the parent re-validates the input and mints a `spec` card with its front-matter and estimate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';

useTempHome(after);

const origCwd = process.cwd();
let cwdSandbox = null;
let homeDir, srv, base, wsBase, mod, prevHome;
let projectDir, projectKey;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };

function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
}

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-askspec-cwd-'));
  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askspec-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'specBuilder';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
  projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-askspec-proj-'));
  gitInit(projectDir);
  const { addProject, listProjects } = await import('../src/core/projects.mjs');
  await addProject({ name: 'demo', path: projectDir });
  projectKey = (await listProjects()).find((p) => p.path === projectDir).key;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  for (const r of mod.runs.values()) { try { r.orch?.stop?.(); } catch { /* reap */ } }
  mod.runs.clear();
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  delete process.env.WORCA_FLAGS;
  process.chdir(origCwd);
  closeDbForTests();
  const reap = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  if (cwdSandbox) await reap(cwdSandbox);
  await reap(homeDir);
  await reap(projectDir);
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const newThread = async () => (await (await post('/api/ask/threads', {})).json()).thread;
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();

function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
const WAIT_FOR_MS = process.platform === 'win32' ? 60000 : 10000;
function waitFor(pred, timeoutMs = WAIT_FOR_MS) {
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
const frames = (msgs, threadId, type) => msgs.filter((m) => m.threadId === threadId && m.type === type);

test('the wizard prompt drafts a spec in Ask: the mock proposes it, the parent re-validates and mints a spec card priced roughly on an empty history', async () => {
  const pr = await post('/api/spec-builder/prompt', { projectDir, answers: { goal: 'Add dark mode', roles: ['qa'] } });
  assert.equal(pr.status, 200);
  const { text, projectKey: key } = await pr.json();
  assert.equal(key, projectKey);
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text, ...MODEL, context: { pinned: true, projectKey } });
  assert.equal(r.status, 202);
  const proposed = await waitFor(() => frames(w.msgs, t.id, 'ask-card').find((f) => f.block.state === 'proposed'));
  await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1);
  w.ws.close();
  const card = proposed.block.card;
  assert.equal(card.type, 'spec');
  assert.equal(card.title, 'Add dark mode');
  assert.equal(card.frontMatter.generatedBy, 'spec-builder@1');
  assert.deepEqual(card.frontMatter.roles, ['product', 'qa']);
  assert.equal(card.estimate.basis, 'rough');
  assert.equal(card.projectKey, projectKey);
  assert.equal(card.projectDir, projectDir);
  assert.equal(card.path, 'plans/mock-spec-design.md');
  const s = await snapshot(t.id);
  const cards = s.messages.flatMap((m) => m.blocks || []).filter((b) => b.kind === 'card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].card.type, 'spec');
});
