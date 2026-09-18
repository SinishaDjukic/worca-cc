// test/ask-schedules.test.mjs
// Scheduled runs in Ask Worca (docs/scheduled-runs.md "Ask Worca"), end to end over WORCA_MOCK:
// a "schedule …" message proposes a run card carrying its schedule (read in the browser's zone);
// the card schedules once or becomes a repeating schedule it then follows; a schedule-change card
// is applied or declined behind the click through the same verbs the Schedules page uses; and the
// real tool bundle reads, previews and makes the small reversible changes directly.
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
const MODEL = { model: 'claude-opus-5', effort: 'high' };
const TZ = 'Asia/Tokyo';                     // not this machine's zone, on purpose

function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
}

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-asksched-cwd-'));
  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-asksched-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
  projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-asksched-proj-'));
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
const blocksOf = async (id) => (await snapshot(id)).messages.flatMap((m) => m.blocks || []);
const WAIT_FOR_MS = process.platform === 'win32' ? 60000 : 10000;
function waitFor(pred, timeoutMs = WAIT_FOR_MS) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (async function tick() {
      const v = await pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 20);
    })();
  });
}
function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
/** One mock turn; resolves the card blocks it produced and the frames it sent. */
async function turn(threadId, text, context = { projectKey, timeZone: TZ }) {
  const w = openWs(`?threadId=${threadId}`);
  await w.opened;
  const before = (await blocksOf(threadId)).filter((b) => b.kind === 'card').length;
  const r = await post(`/api/ask/threads/${threadId}/messages`, { text, ...MODEL, context });
  assert.equal(r.status, 202, 'turn accepted');
  // THIS turn's end: a re-subscribe replays the previous (event) turn's ask-done within its grace window.
  const { assistantMessageId } = await r.json();
  await waitFor(async () => {
    const snap = await snapshot(threadId);
    const m = snap.messages.find((x) => x.id === assistantMessageId);
    return m && m.status !== 'streaming' && !snap.inFlight;
  });
  w.ws.close();
  const cards = (await blocksOf(threadId)).filter((b) => b.kind === 'card');
  return { cards: cards.slice(before), msgs: w.msgs };
}
const runBody = (thread, card, extra = {}) => ({
  projectDir, prompt: card.card.brief, workflowId: card.card.workflowId, guardrailsId: card.card.guardrailsId,
  title: card.card.title, askThreadId: thread.id, askCardId: card.id, ...extra,
});
/** A card's POST, waiting for the event turn it starts to finish (one turn per thread). */
async function actOnCard(threadId, cardId, state) {
  const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state });
  const body = await r.json();
  await waitFor(() => !mod._testing.askJobs.get(threadId)?.turn || ['done', 'stopped', 'error'].includes(mod._testing.askJobs.get(threadId)?.turn?.status));
  await waitFor(async () => !(await snapshot(threadId)).inFlight);
  return { status: r.status, body };
}

test('"schedule …" proposes a run card carrying its schedule, read in the browser\'s timezone', async () => {
  const t = await newThread();
  const t0 = Date.now();
  const { cards } = await turn(t.id, 'schedule a dependency upgrade for this project');
  assert.equal(cards.length, 1);
  const s = cards[0].card.schedule;
  assert.equal(cards[0].state, 'proposed');
  assert.equal(s.kind, 'once');
  assert.equal(s.timeZone, TZ, 'the thread context carried the zone to the proposal');
  const at = Date.parse(s.runAt);
  assert.ok(at >= t0 + 110_000 && at <= Date.now() + 125_000, 'the mock asked for +2m');
  assert.match(s.when, /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
  // The thread stored the zone, so the MCP child reads it too.
  assert.equal((await snapshot(t.id)).thread.context.timeZone, TZ);

  // Schedule → the card waits as a ticket; its line reaches the next turn's context block.
  const made = await post('/api/run', runBody(t, cards[0], { scheduledFor: s.runAt }));
  assert.equal(made.status, 202);
  const { runId } = await made.json();
  const block = (await blocksOf(t.id)).find((b) => b.id === cards[0].id);
  assert.equal(block.state, 'scheduled');
  assert.equal(block.runId, runId);
});

test('"schedule … every …": the card becomes a repeating schedule it follows; deleting the series hands it back', async () => {
  const t = await newThread();
  const { cards } = await turn(t.id, 'schedule a nightly audit every weekday');
  const card = cards[0];
  assert.equal(card.card.schedule.kind, 'repeat');
  assert.equal(card.card.schedule.sentence, 'Every weekday at 02:00');
  assert.equal(card.card.schedule.rule.tz, TZ);
  assert.equal(card.card.schedule.next.length, 3);
  const s = card.card.schedule;
  const made = await post('/api/run', runBody(t, card, { repeat: { rule: s.rule, overlap: s.overlap, maxFailures: s.maxFailures } }));
  assert.equal(made.status, 202, 'an Ask card may now start a repeating schedule');
  const out = await made.json();
  assert.match(out.scheduleId, /^sch_[0-9a-f]{8}$/);
  let block = (await blocksOf(t.id)).find((b) => b.id === card.id);
  assert.equal(block.state, 'scheduled');
  assert.equal(block.scheduleId, out.scheduleId);
  assert.equal(block.sentence, 'Every weekday at 02:00');
  assert.equal(block.runId ?? null, null, 'a series card follows the schedule, not one run of it');
  const detail = await (await fetch(`${base}/api/schedules/${out.scheduleId}`)).json();
  assert.equal(detail.item.askCardId, card.id, 'the series remembers the card that made it');

  // The next turn's context block names it, so the model never proposes it again.
  const next = await turn(t.id, 'thanks');
  assert.equal(next.cards.length, 0);

  const del = await fetch(`${base}/api/schedules/${out.scheduleId}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  block = (await blocksOf(t.id)).find((b) => b.id === card.id);
  assert.equal(block.state, 'proposed', 'deleting the series hands the card back');
  assert.equal(block.scheduleId ?? null, null);
});

test('schedule card: propose → decline (nothing changes) and propose → apply (the change happens, the event turn answers)', async () => {
  // A one-off scheduled run made by hand, an hour out.
  const at = new Date(Date.now() + 3600_000).toISOString();
  const r = await post('/api/run', { projectDir, prompt: 'Upgrade deps', title: 'Upgrade deps', scheduledFor: at });
  assert.equal(r.status, 202);
  const { runId } = await r.json();
  const t = await newThread();

  // move → a card with before/after; decline leaves the ticket alone.
  let { cards } = await turn(t.id, `move ${runId} a bit later`);
  assert.equal(cards.length, 1);
  let sc = cards[0];
  assert.equal(sc.card.type, 'schedule');
  assert.equal(sc.card.action, 'move');
  assert.equal(sc.card.before.at, at);
  assert.ok(Date.parse(sc.card.after.at) > Date.now(), 'the mock asked for +5m');
  assert.match(sc.card.summary, /^Move "Upgrade deps" from .+ to .+$/);
  let res = await actOnCard(t.id, sc.id, 'declined');
  assert.equal(res.status, 200);
  assert.equal(res.body.block.state, 'declined');
  assert.equal((await (await fetch(`${base}/api/schedules/${runId}`)).json()).item.runAt, at, 'decline changed nothing');
  let snap = await snapshot(t.id);
  assert.ok(snap.messages.some((m) => (m.blocks || []).some((b) => b.kind === 'notice' && /^Declined — Move "Upgrade deps"/.test(b.text))), 'the notice row');

  // move again → apply: the ticket moves, the card says so, the event turn answers.
  ({ cards } = await turn(t.id, `move ${runId} a bit later`));
  sc = cards[0];
  res = await actOnCard(t.id, sc.id, 'applied');
  assert.equal(res.status, 200);
  assert.equal(res.body.block.state, 'applied');
  assert.match(res.body.block.card.result.detail, /^now at /);
  assert.equal((await (await fetch(`${base}/api/schedules/${runId}`)).json()).item.runAt, sc.card.after.at, 'the ticket moved');
  // Applying twice is refused.
  assert.equal((await post(`/api/ask/threads/${t.id}/cards/${sc.id}`, { state: 'applied' })).status, 409);
  snap = await snapshot(t.id);
  assert.ok(snap.messages.some((m) => m.role === 'assistant' && /Done\./.test(m.text || '')), 'the event turn confirmed');

  // cancel → apply: the ticket is canceled.
  ({ cards } = await turn(t.id, `cancel ${runId} please`));
  res = await actOnCard(t.id, cards[0].id, 'applied');
  assert.equal(res.body.block.state, 'applied');
  assert.equal((await (await fetch(`${base}/api/schedules/${runId}`)).json()).item.status, 'canceled');

  // A change the rows no longer allow is a failed card, never a silent success.
  ({ cards } = await turn(t.id, `run now ${runId}`));
  assert.equal(cards.length, 0, 'the parent re-validation refuses a canceled run: no card');
  snap = await snapshot(t.id);
  assert.ok(snap.messages.some((m) => (m.blocks || []).some((b) => b.kind === 'notice' && /^Schedule change rejected: this run is canceled/.test(b.text))));
});

test('schedule card on a series: edit replaces the rule; delete removes it', async () => {
  const rule = { freq: 'daily', interval: 1, time: '04:00', tz: 'UTC' };
  const made = await (await post('/api/run', { projectDir, prompt: 'Nightly', title: 'Nightly', repeat: { rule } })).json();
  const t = await newThread();
  let { cards } = await turn(t.id, `edit ${made.scheduleId} to weekdays`);
  const edit = cards[0];
  assert.equal(edit.card.action, 'edit');
  assert.equal(edit.card.before.sentence, 'Every day at 04:00');
  assert.equal(edit.card.after.sentence, 'Every weekday at 03:00');
  assert.equal(edit.card.patch.rule.tz, 'UTC', 'an edit keeps the series\' own zone');
  let res = await actOnCard(t.id, edit.id, 'applied');
  assert.equal(res.body.block.state, 'applied');
  assert.match(res.body.block.card.result.detail, /^next run [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, 03:00$/);
  const s = (await (await fetch(`${base}/api/schedules/${made.scheduleId}`)).json()).item;
  assert.equal(s.sentence, 'Every weekday at 03:00');

  ({ cards } = await turn(t.id, `delete ${made.scheduleId}`));
  res = await actOnCard(t.id, cards[0].id, 'applied');
  assert.equal(res.body.block.state, 'applied');
  assert.equal((await fetch(`${base}/api/schedules/${made.scheduleId}`)).status, 404);
});

test('the real tool bundle: list, get, preview, pause / resume / skip, mark read — and the child\'s writes repaint the page', async () => {
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { defaultToolDeps } = await import('../src/core/ask/tool-deps.mjs');
  const { defaultScheduleDeps } = await import('../src/core/ask/schedule-deps.mjs');
  const { addNotification } = await import('../src/core/notifications.mjs');
  const t = await newThread();
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'hello', ...MODEL, context: { projectKey, timeZone: 'Europe/Berlin' } });
  await waitFor(async () => !(await snapshot(t.id)).inFlight);
  const tools = createAskTools({ ...defaultToolDeps({ threadId: t.id }), ...defaultScheduleDeps({ threadId: t.id }) });

  const made = await (await post('/api/run', { projectDir, prompt: 'Weekly report', title: 'Weekly report',
    repeat: { rule: { freq: 'weekly', interval: 1, weekdays: ['mo'], time: '09:00', tz: 'Europe/Berlin' } } })).json();
  const list = await tools.call('list_schedules', { projectKey });
  assert.equal(list.timeZone, 'Europe/Berlin', 'times come in the zone the browser reported');
  const row = list.schedules.find((x) => x.id === made.scheduleId);
  assert.equal(row.sentence, 'Every Monday at 09:00');
  assert.match(row.nextRun.when, /^Mon [A-Z][a-z]{2} \d{1,2}, 09:00$/);
  assert.equal(row.request.workflowId, 'wf_default');
  assert.deepEqual((await tools.call('list_schedules', { projectKey: 'nope-00000000' })).schedules, [], 'another scope is empty');

  const got = await tools.call('get_schedule', { id: made.scheduleId });
  assert.equal(got.kind, 'repeat');
  assert.equal(got.next.length, 3);
  assert.equal(got.history.length, 1, 'the pending occurrence');
  await assert.rejects(() => tools.call('get_schedule', { id: 'sch_00000000' }), /no schedule or scheduled run/);

  const pv = await tools.call('preview_schedule', { every: 'mon,thu 07:30', count: 4 });
  assert.equal(pv.sentence, 'Every Monday and Thursday at 07:30, 4 times');
  assert.equal(pv.timeZone, 'Europe/Berlin');
  assert.equal((await tools.call('preview_schedule', { when: 'yesterday' })).ok, false);

  // Direct writes: reversible, a series only, and the parent broadcasts them.
  const paused = await tools.call('pause_schedule', { id: made.scheduleId });
  assert.equal(paused.schedule.status, 'paused');
  await assert.rejects(() => tools.call('pause_schedule', { id: made.scheduleId }), /this schedule is paused/);
  await assert.rejects(() => tools.call('skip_next_run', { id: made.scheduleId }), /this schedule is paused/);
  assert.equal((await tools.call('resume_schedule', { id: made.scheduleId })).schedule.status, 'active');
  const before = (await tools.call('get_schedule', { id: made.scheduleId })).history.find((h) => h.status === 'scheduled').runAt;
  await tools.call('skip_next_run', { id: made.scheduleId });
  const after = (await tools.call('get_schedule', { id: made.scheduleId })).history.find((h) => h.status === 'scheduled').runAt;
  assert.ok(Date.parse(after) > Date.parse(before), 'the next Monday replaced the skipped one');
  await assert.rejects(() => tools.call('pause_schedule', { id: '11111111-2222-3333-4444-555555555555' }), /must be a repeating schedule/);

  addNotification({ kind: 'failed', severity: 'problem', scheduleId: made.scheduleId, title: 'Weekly report', message: 'could not start.' });
  const act = await tools.call('list_schedule_activity', { unread: true });
  assert.ok(act.unread >= 1);
  const item = act.items.find((n) => n.scheduleId === made.scheduleId && n.kind === 'failed');
  assert.equal(item.unread, true);
  const marked = await tools.call('mark_schedule_activity_read', { ids: [item.id] });
  assert.equal(marked.marked, 1);
  await assert.rejects(() => tools.call('mark_schedule_activity_read', {}), /give ids/);
  assert.equal((await tools.call('mark_schedule_activity_read', { all: true })).unread, 0);

  // propose_schedule_change validates and never writes.
  const bad = await tools.call('propose_schedule_change', { id: made.scheduleId, action: 'move', when: '+1h' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /move changes a one-off run/);
  const good = await tools.call('propose_schedule_change', { id: made.scheduleId, action: 'edit', maxFailures: 5 });
  assert.equal(good.ok, true);
  assert.equal(good.card.patch.maxFailures, 5);
  assert.equal((await tools.call('get_schedule', { id: made.scheduleId })).maxFailures, 3, 'nothing written');
});

test('"schedule a fix for bug MOCK-7 with auto": the card\'s task is the tracker issue, Auto picks the workflow at start, and the ticket stores the reference', async () => {
  // The in-tree mock-source fixture, installed into this home (the shim serves canned tasks in mock mode).
  const { writePluginsLock, readPluginsLock, pluginCurrentDir } = await import('../src/core/plugins-lock.mjs');
  const { mkdirSync, copyFileSync } = await import('node:fs');
  const cur = pluginCurrentDir('mock-source');
  mkdirSync(cur, { recursive: true });
  copyFileSync(new URL('./fixtures/plugins/mock-source/worca-cc-plugin.json', import.meta.url), join(cur, 'worca-cc-plugin.json'));
  writePluginsLock({ ...readPluginsLock(), 'mock-source': { repo: 'https://example.invalid/r', subdir: '', pinnedSha: 'a'.repeat(40), version: '0.1.0', enabled: true } });

  const t = await newThread();
  const { cards } = await turn(t.id, 'schedule a fix for bug MOCK-7 with auto');
  assert.equal(cards.length, 1, JSON.stringify((await snapshot(t.id)).messages.flatMap((m) => (m.blocks || []).filter((b) => b.kind === 'notice'))));
  const c = cards[0].card;
  assert.equal(c.workflowId, 'wf_auto');
  assert.equal(c.brief, '', 'the issue is the task — no copy of it');
  assert.deepEqual({ plugin: c.source.plugin, sourceId: c.source.sourceId, taskId: c.source.taskId }, { plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-7' });
  assert.equal(c.source.title, 'Fix the login redirect', 'the parent looked the task up once');
  assert.equal(c.title, 'Fix the login redirect');
  assert.equal(c.schedule.kind, 'once');

  // Schedule it the way the card does: source, not prompt.
  const body = {
    projectDir, workflowId: c.workflowId, guardrailsId: c.guardrailsId, title: c.title, askThreadId: t.id, askCardId: cards[0].id,
    source: { type: 'plugin', plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-7' }, scheduledFor: c.schedule.runAt,
  };
  const made = await post('/api/run', body);
  assert.equal(made.status, 202, await made.clone().text());
  const { runId } = await made.json();
  const { getDb } = await import('../src/core/db.mjs');
  const stored = JSON.parse(getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(runId).request);
  assert.deepEqual(stored.source, { type: 'plugin', plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-7' }, 'a reference, read when the run starts');
  assert.equal(stored.workflowId, 'wf_auto');
  const now = await (await post(`/api/schedules/${runId}/run-now`, {})).json();
  assert.equal(now.status, 'fired', 'the source probe at start found the task and the run started');
  for (const r of mod.runs.values()) { try { r.orch?.stop?.(); } catch { /* reap */ } }
});
