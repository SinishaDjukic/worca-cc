// test/ask-api-metrics-cards.test.mjs
// The metrics card end to end over WORCA_MOCK (docs/team-metrics.md "Ask Worca"): the mock's
// propose_metrics_change → the parent re-validates and mints the card → POST
// /api/ask/threads/:id/cards/:cardId with `applied` (the change happens HERE — the "Include my
// runs" switch, no git) or `declined`, each flipping the card, storing the synthetic notice row
// and starting the event turn whose mock reply confirms; 400/409 for the wrong verb or state.
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
let projectDir, projectKey, readPrefs, writePrefs;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };

function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
}

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-askmcards-cwd-'));
  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askmcards-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
  projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-askmcards-proj-'));
  gitInit(projectDir);
  const { addProject, listProjects } = await import('../src/core/projects.mjs');
  await addProject({ name: 'demo', path: projectDir });
  projectKey = (await listProjects()).find((p) => p.path === projectDir).key;
  ({ readTeamMetricsPrefs: readPrefs, writeTeamMetricsPrefs: writePrefs } = await import('../src/core/config.mjs'));
  // "Enabled" as the record side sees it (a fetched config, recording locally) — no git, no origin:
  // the mock proposes a `record` change, whose apply only writes this machine's switch.
  writePrefs(projectKey, { enabled: true, configKnown: true, config: { schema: 1, attribution: 'git-user' }, slug: 'acme/demo', record: true });
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

/** One mock turn whose text trips the metrics arm; resolves once the card is PROPOSED and the turn is done. */
async function proposeMetrics(text = 'stop recording my metrics on this project') {
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text, ...MODEL, context: { projectKey } });
  assert.equal(r.status, 202);
  const proposed = await waitFor(() => frames(w.msgs, t.id, 'ask-card').find((f) => f.block.state === 'proposed'));
  await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1);
  w.ws.close();
  return { thread: t, card: proposed.block, msgs: w.msgs };
}
/** The event turn's assistant reply: the LAST assistant message of the thread once it is done. */
async function eventReply(threadId, beforeCount) {
  return waitFor(async () => {
    const s = await snapshot(threadId);
    const asst = s.messages.filter((m) => m.role === 'assistant');
    return asst.length > beforeCount && asst.at(-1).status === 'done' ? asst.at(-1) : null;
  });
}
async function waitForAsync(pred, timeoutMs = WAIT_FOR_MS) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitForAsync timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('the mock proposes a `record` change: the parent re-validates the input and mints a proposed metrics card with the real project name', async () => {
  const { card, msgs, thread } = await proposeMetrics();
  assert.equal(card.card.type, 'metrics');
  assert.deepEqual([card.card.kind, card.card.projectKey, card.card.projectName, card.card.record], ['record', projectKey, 'demo', false]);
  assert.equal(card.card.summary, 'Turn "Include my runs" off for demo');
  assert.ok(Array.isArray(card.card.effects) && card.card.effects.length >= 2);
  assert.equal(card.card.note, 'mock: stop recording my runs here');
  assert.ok(frames(msgs, thread.id, 'ask-label').some((f) => f.label === 'Proposing a metrics change'), 'the tool row is labelled');
  const s = await snapshot(thread.id);
  const stored = s.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card' && b.id === card.id);
  assert.equal(stored.state, 'proposed', 'persisted');
});

test('apply: the switch flips on this machine, the card turns applied with the result, the notice row and the event turn follow', async () => {
  const { card, thread } = await proposeMetrics();
  assert.equal(readPrefs(projectKey).record, true, 'precondition');
  const before = (await snapshot(thread.id)).messages.filter((m) => m.role === 'assistant').length;
  const w = openWs();
  await w.opened;
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'applied' });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.block.state, 'applied');
  assert.deepEqual(j.block.card.result, { ok: true, detail: '"Include my runs" is now off' });
  assert.equal(j.block.card.summary, 'Turn "Include my runs" off for demo', 'the rest of the card survives the sub-patch');
  assert.equal(readPrefs(projectKey).record, false, 'the change happened server-side, behind the click');
  assert.ok(j.turn && (j.turn.assistantMessageId || j.turn.deferred), 'the event turn started');
  const reply = await waitForAsync(async () => eventReply(thread.id, before).catch(() => null));
  assert.match(reply.text, /Applied\./, 'the mock answered the applied event');
  const s = await snapshot(thread.id);
  const notice = s.messages.find((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic));
  assert.ok(notice, 'the synthetic notice row exists');
  assert.equal(notice.blocks[0].text, 'Applied — Turn "Include my runs" off for demo · "Include my runs" is now off');
  assert.match(notice.text, /^\[worca event\] metrics card card_[0-9a-f]{8} applied; "Turn 'Include my runs' off for demo"; 'Include my runs' is now off$/);
  assert.ok(frames(w.msgs, thread.id, 'ask-message').length >= 1, 'other tabs get the flipped message');
  w.ws.close();
  // A second verb on a non-proposed card is refused, as is a wrong verb anywhere.
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'applied' })).status, 409);
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'saved' })).status, 400);
  writePrefs(projectKey, { record: true });   // back to the fixture's state for the next test
});

test('decline: the card flips to declined, nothing changes, the event turn confirms', async () => {
  const { card, thread } = await proposeMetrics();
  const before = (await snapshot(thread.id)).messages.filter((m) => m.role === 'assistant').length;
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'declined' });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.block.state, 'declined');
  assert.equal(j.block.card.result, undefined);
  assert.equal(readPrefs(projectKey).record, true, 'untouched');
  const reply = await waitForAsync(async () => eventReply(thread.id, before).catch(() => null));
  assert.match(reply.text, /Declined — nothing changed\./);
  const s = await snapshot(thread.id);
  const notice = s.messages.find((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic));
  assert.equal(notice.blocks[0].text, 'Declined — Turn "Include my runs" off for demo');
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'declined' })).status, 409);
});

test('a failing apply turns the card failed with the error and still runs the event turn', async () => {
  const { card, thread } = await proposeMetrics();
  // The project vanishes before the click: applyMetricsChange cannot resolve its path (removeProject takes the NAME).
  const { removeProject, addProject } = await import('../src/core/projects.mjs');
  await removeProject('demo');
  try {
    const before = (await snapshot(thread.id)).messages.filter((m) => m.role === 'assistant').length;
    const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'applied' });
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json();
    assert.equal(j.block.state, 'failed');
    assert.match(j.block.error, /unknown projectKey/);
    assert.equal(j.block.card.result.ok, false); assert.equal(j.block.card.result.code, 'NOT_FOUND');
    const reply = await waitForAsync(async () => eventReply(thread.id, before).catch(() => null));
    assert.match(reply.text, /The change failed/);
    const s = await snapshot(thread.id);
    const notice = s.messages.find((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic));
    assert.match(notice.blocks[0].text, /^Could not apply — Turn "Include my runs" off for demo: unknown projectKey/);
  } finally {
    await addProject({ name: 'demo', path: projectDir });
  }
});

test('after the failure the re-added project proposes again; the persisted card keeps its type through the flips', async () => {
  const { card, thread } = await proposeMetrics();
  const before = (await snapshot(thread.id)).messages.filter((m) => m.role === 'assistant').length;
  await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'declined' });
  await waitForAsync(async () => eventReply(thread.id, before).catch(() => null));
  const s = await snapshot(thread.id);
  const stored = s.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card' && b.id === card.id);
  assert.equal(stored.state, 'declined');
  assert.equal(stored.card.type, 'metrics');
});
