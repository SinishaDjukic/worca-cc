// test/ask-api-spec-cards.test.mjs
// The Spec Builder end to end over WORCA_MOCK + WORCA_FLAGS=specBuilder (docs/spec-builder.md), three turns on one
// thread pinned to the project: the POST /api/spec-builder/prompt text → a `spec-questions` card; the answers → a
// `spec` card that fails the `testable` shape check; the fix message → the same card at 8 of 8.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { answersMessage, fixMessage } from '../src/shared/spec-builder/messages.mjs';
import { MOCK_SPEC_PATHS, MOCK_SPEC_QUESTIONS } from '../src/core/spec-builder/mock-spec.mjs';

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
  for (const rel of MOCK_SPEC_PATHS) {
    mkdirSync(dirname(join(projectDir, rel)), { recursive: true });
    writeFileSync(join(projectDir, rel), 'export {};\n');
  }
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

test('three turns: questions card → spec card failing `testable` → fixed to 8 of 8', async () => {
  const pr = await post('/api/spec-builder/prompt', { projectDir, idea: 'Charts from a question' });
  assert.equal(pr.status, 200);
  const { text, title, projectKey: key } = await pr.json();
  assert.equal(key, projectKey);
  assert.equal(title, 'Spec: Charts from a question');
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  // One turn: send, then wait for the turn it started (the nth ask-done) to end.
  let done = 0;
  const turn = async (body) => {
    const r = await post(`/api/ask/threads/${t.id}/messages`, { text: body, ...MODEL, context: { pinned: true, projectKey } });
    assert.equal(r.status, 202);
    done += 1;
    await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= done);
    const cards = (await snapshot(t.id)).messages.flatMap((m) => m.blocks || []).filter((b) => b.kind === 'card');
    return cards;
  };
  try {
    // Turn 1: the first message → one question.
    let cards = await turn(text);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].card.type, 'spec-questions');
    assert.deepEqual(cards[0].card.questions.map((q) => q.id), MOCK_SPEC_QUESTIONS.map((q) => q.id));
    const header = await mod._testing.resolveAskContext(t.id, { pinned: true, projectKey }, []);
    assert.equal(header.cards.find((c) => c.id === cards[0].id)?.type, 'spec-questions');

    // Turn 2: the answers → a spec card with one failing shape check.
    cards = await turn(answersMessage(MOCK_SPEC_QUESTIONS, { 'chart-storage': 'Per project' }));
    let spec = cards.filter((b) => b.card.type === 'spec').at(-1).card;
    assert.equal(spec.shape.ok, false);
    assert.equal(spec.shape.items.find((i) => i.id === 'testable').pass, false);
    assert.equal(spec.frontMatter.generatedBy, 'spec-builder@2');
    for (const f of MOCK_SPEC_PATHS) assert.equal(spec.grounding.find((g) => g.path === f)?.found, true, f);
    assert.equal(spec.grounding.find((g) => g.path === 'src/charts.mjs').isNew, true);
    assert.equal(spec.projectKey, projectKey);

    // Turn 3: the fix message → 8 of 8.
    const failing = spec.shape.items.filter((i) => !i.pass && !i.waived);
    cards = await turn(fixMessage(failing));
    spec = cards.filter((b) => b.card.type === 'spec').at(-1).card;
    assert.equal(spec.shape.ok, true);
    assert.equal(spec.shape.passed, 8);
  } finally { w.ws.close(); }
});
