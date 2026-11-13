// test/stillhet-seed-chat-cards.test.mjs — tools/stillhet-seed-chat-cards.mjs seeds one REAL record of every Stillhet chat
// card: the server answers each chat with the card the walk needs (read through Stillhet's own mapper, chat-turns.mjs).
// It needs the in-process server and two real mock runs (a Default run at its question, a Shaper run at its plan), the
// only way a question card and a PlanCard exist (they come from a live run's pendingQuestion, never from a DB row).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { turnsOf } from '../ui/public/stillhet/live/chat-turns.mjs';

useTempHome(after);

let srv, base, mod, seeded, proj;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_MOCK: process.env.WORCA_MOCK, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };

before(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-seed-test-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  proj = await mkdtemp(join(tmpdir(), 'worca-seed-test-proj-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@worca.local'], ['config', 'user.name', 't']]) execFileSync('git', a, { cwd: proj });
  await writeFile(join(proj, 'README.md'), '# t\n');
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { seedChatCards } = await import('../tools/stillhet-seed-chat-cards.mjs');
  seeded = await seedChatCards({ base, runs: mod.runs, projectDir: proj });
});

after(async () => {
  for (const id of Object.values(seeded?.runs || {})) {
    await fetch(`${base}/api/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: id }) }).catch(() => {});
  }
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries({ HOME: saved.HOME, USERPROFILE: saved.USERPROFILE, WORCA_MOCK: saved.WORCA_MOCK, WORCA_TEST_ALLOW_HOME_FALLBACK: saved.ALLOW })) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const get = async (p) => (await fetch(`${base}${p}`)).json();
const turns = async (key) => { const t = await get(`/api/ask/threads/${seeded.threads[key]}`); return { t, turns: turnsOf(t) }; };

test('a task waiting on its question: its TaskCard is the card the chat started, and the live run asks with options', async () => {
  const { t, turns: l } = await turns('question');
  const task = l.find((x) => x.t === 'task');
  assert.ok(task, JSON.stringify(l));
  assert.equal(t.runLinks.find((x) => x.cardId === task.id)?.runId, seeded.runs.question);
  const q = mod.runs.get(seeded.runs.question).pendingQuestion;
  assert.notEqual(q.kind, 'plan');
  assert.ok(q.questions.length && q.questions.every((x) => (x.options || []).length >= 2), JSON.stringify(q.questions));
  const links = (await get('/api/ask/run-links')).links;
  assert.ok(links.some((x) => x.runId === seeded.runs.question && x.started));
});

test('a Shaper task at its plan: its TaskCard and a live plan question (the PlanCard)', async () => {
  const { turns: l } = await turns('plan');
  assert.ok(l.some((x) => x.t === 'task'));
  const q = mod.runs.get(seeded.runs.plan).pendingQuestion;
  assert.equal(q.kind, 'plan');
  assert.ok(q.plan, 'the plan stop carries its plan');
});

test('a proposed change: a real mock turn proposed a model change', async () => {
  const { turns: l } = await turns('change');
  const c = l.find((x) => x.t === 'change');
  assert.ok(c, JSON.stringify(l));
  assert.equal(c.cardType, 'model');
  assert.equal(c.state, 'proposed');
});

test('a failed task and a failed reply; a finished task with its PR', async () => {
  const history = (await get('/api/history')).pipelines;
  assert.equal(history.find((p) => p.id === seeded.pipelines.failed)?.status, 'error');
  assert.equal(history.find((p) => p.id === seeded.pipelines.pr)?.status, 'done');
  const failed = (await turns('failed')).turns;
  assert.ok(failed.some((x) => x.t === 'task'));
  assert.ok(failed.some((x) => x.t === 'failed'), 'the MOCK_FAIL reply');
  const pr = (await turns('pr')).turns;
  assert.ok(pr.some((x) => x.t === 'task'));
  assert.match(pr.find((x) => x.cardType === 'pull-request')?.done || '', /^PR opened: https:\/\/github\.com\//);
});
