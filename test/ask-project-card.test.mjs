// test/ask-project-card.test.mjs
// Ask Worca's project card route (ui/server.mjs, P2 Task 10) over the real server (WORCA_MOCK): decline, apply
// create (folder + registry + the chat switched through startScopeEventTurn), apply add with Use git, and a refusal
// at apply time that switches nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { _testing as gitTesting } from '../src/core/git-available.mjs';
import { displayPath } from '../src/core/projects.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

let homeDir, prevHome, prevRoot, prevGit, srv, base, mod, store, projectsRoot;
const made = [];                                                  // mkdtemp folders outside homeDir, removed in after()
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();
async function waitFor(pred, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askproj-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-askproj-projects-'));
  prevHome = process.env.WORCA_HOME;
  prevRoot = process.env.WORCA_PROJECTS_ROOT;
  prevGit = process.env.WORCA_GIT;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_PROJECTS_ROOT = projectsRoot;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_GIT = '1'; gitTesting.reset();
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevRoot === undefined) delete process.env.WORCA_PROJECTS_ROOT; else process.env.WORCA_PROJECTS_ROOT = prevRoot;
  if (prevGit === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = prevGit;
  delete process.env.WORCA_MOCK;
  gitTesting.reset();
  closeDbForTests();
  for (const d of [homeDir, projectsRoot]) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

const noticeOf = async (threadId) => (await snapshot(threadId)).messages.filter((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic)).map((m) => m.blocks[0].text);

async function seedCard(card) {
  const thread = (await (await post('/api/ask/threads', {})).json()).thread;
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', model: 'claude-opus-5-5', effort: 'high' });
  await waitFor(async () => (await snapshot(thread.id)).messages.some((m) => m.role === 'assistant' && m.status === 'done'));
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card }] });
  return { threadId: thread.id, cardId };
}
const createCard = (name) => ({ type: 'project', kind: 'create', summary: `Create ${name}`, name, path: join(projectsRoot, name), vcs: 'none', change: { kind: 'create', name, useGit: false } });
const divider = (snap, text) => snap.messages.some((m) => m.role === 'system' && (m.blocks || []).some((b) => b.kind === 'divider' && b.text === text));

test('project card route: decline, apply create (folder + registry + chat switch + event turn), apply add with Use git, refusals switch nothing', async () => {
  await checkRows([
    { name: 'decline: flips, event turn; wrong verbs and states refused', run: async () => {
      const { threadId, cardId } = await seedCard(createCard('declined-one'));
      assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'saved' })).status, 400);
      const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'declined' });
      assert.equal((await r.json()).block.state, 'declined');
      assert.deepEqual(await waitFor(async () => { const n = await noticeOf(threadId); return n.length ? n : null; }), ['Declined — Create declined-one']);
      assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' })).status, 409);
      assert.equal(existsSync(join(projectsRoot, 'declined-one')), false);
      assert.deepEqual((await mod._testing.resolveAskContext(threadId, {}, [])).cards.find((c) => c.id === cardId),
        { id: cardId, type: 'project', state: 'declined', summary: 'Create declined-one' }, 'the next turn\'s cards: line names the project card, never a run card');
    } },
    { name: 'apply create: folder made, registered, chat pinned to it with a divider, event turn names it', run: async () => {
      const { threadId, cardId } = await seedCard(createCard('landing-page'));
      const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' });
      assert.equal(r.status, 200, await r.clone().text());
      const j = await r.json();
      assert.equal(j.block.state, 'applied');
      const p = j.block.card.result.project;
      assert.match(p.key, /^landing-page-[0-9a-f]{8}$/);
      assert.deepEqual({ ...p, key: 'k' }, { key: 'k', name: 'landing-page', path: join(projectsRoot, 'landing-page'),
        displayPath: displayPath(join(projectsRoot, 'landing-page')), vcs: 'none' });   // import { displayPath } from '../src/core/projects.mjs'
      assert.ok(existsSync(join(projectsRoot, 'landing-page')));
      assert.deepEqual(j.block.card.result.scope, { pinned: true, projectKey: p.key });
      assert.ok(j.turn && j.turn.assistantMessageId, 'the event turn started (the thread was idle)');
      const snap = await snapshot(threadId);
      assert.equal(snap.thread.context.pinned, true); assert.equal(snap.thread.context.projectKey, p.key);
      assert.ok(divider(snap, 'Switched to landing-page'));
      const at = snap.messages.findIndex((m) => (m.blocks || []).some((b) => b.kind === 'card' && b.id === cardId));
      assert.deepEqual(snap.messages.slice(at, at + 4).map((m) => m.role), ['assistant', 'system', 'user', 'assistant'], 'card → divider → event → answer');
      const ev = snap.messages[at + 2].blocks[0];
      assert.equal(ev.quiet, true, 'the divider and the card already say it (P4a S3)');
      assert.equal(ev.text, `Created — Create landing-page · ${join(projectsRoot, 'landing-page')}`);
    } },
    { name: 'apply broadcasts projects-changed (every Projects list refreshes)', run: async () => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
      const frames = [];
      ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
      await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
      try {
        const { threadId, cardId } = await seedCard(createCard('bcast-one'));
        assert.equal((await (await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' })).json()).block.state, 'applied');
        await waitFor(async () => frames.some((f) => f.type === 'projects-changed' && f.action === 'created'));
      } finally { ws.close(); }
    } },
    { name: 'apply add with Use git: git init once, vcs git', run: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'worca-cc-askproj-add-')); made.push(dir);
      const { threadId, cardId } = await seedCard({ type: 'project', kind: 'add', summary: 'Add docs-folder', name: 'docs-folder', path: dir, vcs: 'git', change: { kind: 'add', name: 'docs-folder', path: dir, useGit: true } });
      const j = await (await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' })).json();
      assert.equal(j.block.card.result.project.vcs, 'git');
      assert.ok(existsSync(join(dir, '.git', 'HEAD')));
    } },
    { name: 'a refusal at apply time (the folder appeared since) fails the card and switches nothing', run: async () => {
      mkdirSync(join(projectsRoot, 'taken-one'));
      const { threadId, cardId } = await seedCard(createCard('taken-one'));
      const j = await (await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' })).json();
      assert.equal(j.block.state, 'failed');
      assert.equal(j.block.card.result.code, 'EXISTS');
      assert.match(j.block.error, /already exists/);
      const snap = await snapshot(threadId);
      assert.ok(!(snap.thread.context && snap.thread.context.projectKey), 'no switch');
      assert.ok(!divider(snap, 'Switched to taken-one'));
      const notices = await waitFor(async () => { const n = await noticeOf(threadId); return n.length ? n : null; });
      assert.match(notices[0], /^Could not create — Create taken-one: .*already exists/);
    } },
  ]);
});
