// test/ask-api-action-cards.test.mjs — worca Chat P2 Task 6: the receipt's Revert, the stop card and the pull-request
// card through POST /api/ask/threads/:id/cards/:cardId, over the real settings file, store and runs Map.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';

useTempHome(after);
let osHome, mod, store, srv, base, project;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const get = async (p) => (await fetch(`${base}${p}`)).json();
let n = 0;
const nextCardId = () => `card_${String(++n).padStart(8, '0')}`;

before(async () => {
  osHome = await mkdtemp(join(tmpdir(), 'worca-cc-actcards-os-'));   // settings.json lives under the OS home
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = osHome; process.env.USERPROFILE = osHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  const { addProject } = await import('../src/core/projects.mjs');
  project = (await addProject({ name: 'actcards', path: gitDir('actcards') })).find((p) => p.name === 'actcards');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  mod.runs.clear();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  closeDbForTests();
  await rm(osHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

/** A thread whose one assistant message holds `block` (a card the host minted, or a hand-built one). */
function seed(block) {
  const thread = store.createThread();
  const id = nextCardId();
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id, ...block }] });
  return { threadId: thread.id, cardId: id };
}
const cardPost = (s, body) => post(`/api/ask/threads/${s.threadId}/cards/${s.cardId}`, body);
const host = () => mod._testing.askChatActions;
/** A runs-Map entry (test/ask-track-run.test.mjs makeEntry) whose orchestrator records the stop. */
function liveEntry(over) {
  const orch = Object.assign(new EventEmitter(), { stop(by) { this.stoppedBy = by; } });
  const e = { id: 'uuid-stop', orch, projectDir: project.path, title: 'Fix login', status: 'running', startedAt: new Date().toISOString(), events: [], pendingQuestion: null, kind: 'run', ...over };
  mod.runs.set(e.id, e);
  return e;
}

test('receipt Revert: writes the old value back through the same path, flips to reverted, posts a notice — no model turn', async () => {
  const minted = await host().apply({ kind: 'setting', id: 'theme', scope: 'user', value: 'dark' }, { actor: 'local' });
  assert.equal(minted.ok, true, JSON.stringify(minted));
  assert.equal((await get('/api/settings')).theme, 'dark');
  const s = seed(minted.block);
  const r = await cardPost(s, { state: 'reverted' });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.block.state, 'reverted');
  assert.match(j.block.card.result.revertedAt, /^\d{4}-/);
  assert.equal((await get('/api/settings')).theme, 'system');
  const msgs = (await get(`/api/ask/threads/${s.threadId}`)).messages;
  assert.equal(msgs.at(-1).role, 'system');
  assert.equal(msgs.at(-1).text, 'Reverted: Theme back to System (default)');
  assert.equal(mod._testing.askJobs.has(s.threadId), false, 'no event turn');
  const again = await cardPost(s, { state: 'reverted' });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'ALREADY_REVERTED');
});

test('receipt Revert after the user changed it again: 409 CHANGED_SINCE, nothing written, the note stays on the card (Review Focus 4)', async () => {
  const minted = await host().apply({ kind: 'setting', id: 'theme', scope: 'user', value: 'dark' }, { actor: 'local' });
  const s = seed(minted.block);
  assert.equal((await post('/api/settings', { theme: 'light' })).status, 200);
  const r = await cardPost(s, { state: 'reverted' });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'Changed since — not reverted', code: 'CHANGED_SINCE' });
  assert.equal((await get('/api/settings')).theme, 'light');
  const card = store.findCard(s.threadId, s.cardId).block;
  assert.equal(card.state, 'applied');
  assert.deepEqual(card.card.result, { code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
  await post('/api/settings', { theme: '' });
});

test('receipt rows: a project override reverts to inherited; a direction is NOT_REVERTIBLE; "reverted" is the only verb', async () => {
  await checkRows([
    { name: 'project override', run: async () => {
      const minted = await host().apply({ kind: 'setting', id: 'askMaxTurns', scope: 'project', projectKey: project.key, value: 20 }, { actor: 'local' });
      assert.equal(minted.ok, true, JSON.stringify(minted));
      assert.equal((await get(`/api/projects/${project.key}/settings`)).own.askMaxTurns, 20);
      const s = seed(minted.block);
      assert.equal((await cardPost(s, { state: 'reverted' })).status, 200);
      assert.equal((await get(`/api/projects/${project.key}/settings`)).own.askMaxTurns, undefined);
    } },
    { name: 'direction', run: async () => {
      const s = seed({ state: 'applied', card: { type: 'receipt', kind: 'direction', label: 'Direction', target: { pipelineId: 'aaaa0001', title: 'x' }, before: '', after: 'skip', raw: { before: null, after: { id: 'd1' } }, revertible: false } });
      const r = await cardPost(s, { state: 'reverted' });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).code, 'NOT_REVERTIBLE');
    } },
    { name: 'verbs', run: async () => {
      const s = seed({ state: 'applied', card: { type: 'receipt', kind: 'direction', label: 'Direction', target: {}, before: '', after: 'x', raw: {}, revertible: false } });
      assert.equal((await cardPost(s, { state: 'applied' })).status, 400);
    } },
  ]);
});

test('run-stop card: Stop pipeline stops in-process as the clicker; an interrupted run is refused in the card; Keep running declines', async () => {
  await checkRows([
    { name: 'apply', run: async () => {
      const { id } = await seedPipeline(project.path, { title: 'Fix login', status: 'running' });
      const e = liveEntry({ id: 'uuid-stop-1', pipelineId: id });
      const s = seed({ state: 'proposed', card: { type: 'run-stop', runId: e.id, pipelineId: id, title: 'Fix login', branch: 'worca/fix', status: 'running' } });
      const r = await cardPost(s, { state: 'applied' });
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal((await r.json()).block.state, 'applied');
      assert.equal(e.orch.stoppedBy, 'local');
      assert.equal(mod.runs.get('uuid-stop-1').status, 'stopped');
      assert.equal((await cardPost(s, { state: 'applied' })).status, 409, 'once');
      mod.runs.delete('uuid-stop-1');
    } },
    { name: 'interrupted', run: async () => {
      const { id } = await seedPipeline(project.path, { title: 'Old', status: 'interrupted' });
      const e = liveEntry({ id: 'uuid-stop-2', pipelineId: id, status: 'interrupted' });
      const s = seed({ state: 'proposed', card: { type: 'run-stop', runId: e.id, pipelineId: id, title: 'Old', branch: '', status: 'interrupted' } });
      const j = await (await cardPost(s, { state: 'applied' })).json();
      assert.equal(j.block.state, 'failed');
      assert.match(j.block.error, /interrupted run can't be stopped/);
      assert.equal(e.orch.stoppedBy, undefined);
      mod.runs.delete('uuid-stop-2');
    } },
    { name: 'decline', run: async () => {
      const s = seed({ state: 'proposed', card: { type: 'run-stop', runId: null, pipelineId: 'aaaa0009', title: 'x', branch: '', status: 'running' } });
      assert.equal((await cardPost(s, { state: 'nope' })).status, 400);
      const j = await (await cardPost(s, { state: 'declined' })).json();
      assert.equal(j.block.state, 'declined');
    } },
  ]);
});

test('pull-request card: "Not now" declines; applied is not a cards-route verb (only POST /api/pr applies it)', async () => {
  const s = seed({ state: 'proposed', card: { type: 'pull-request', pipelineId: 'aaaa0010', projectKey: project.key, title: 'x', branch: 'worca/x', base: 'main' } });
  assert.equal((await cardPost(s, { state: 'applied' })).status, 400);
  const j = await (await cardPost(s, { state: 'declined' })).json();
  assert.equal(j.block.state, 'declined');
});

test('the context block lists a receipt by its one line, so the next turn sees a revert', async () => {
  const s = seed({ state: 'reverted', card: { type: 'receipt', kind: 'setting', label: 'Theme', target: { settingId: 'theme', scope: 'user' }, before: 'System (default)', after: 'Dark', raw: { before: null, after: 'dark' }, revertible: true } });
  const ctx = await mod._testing.resolveAskContext(s.threadId, {}, []);
  assert.deepEqual((ctx.cards || []).find((c) => c.id === s.cardId), { id: s.cardId, type: 'receipt', state: 'reverted', summary: 'Theme: System (default) → Dark' });
  const { buildContextHeader } = await import('../src/core/ask/prompt.mjs');
  assert.match(buildContextHeader(ctx), /receipt card_\d{8} reverted "Theme: System \(default\) → Dark"/);
});

test('run-stop card: the stop is recorded as the clicker (actorOf), not as the server (mutation killer)', async () => {
  const prev = process.env.WORCA_IDENTITY_NAME;
  process.env.WORCA_IDENTITY_NAME = 'ada';
  try {
    const { id } = await seedPipeline(project.path, { title: 'Fix login', status: 'running' });
    const e = liveEntry({ id: 'uuid-stop-3', pipelineId: id });
    const s = seed({ state: 'proposed', card: { type: 'run-stop', runId: e.id, pipelineId: id, title: 'Fix login', branch: 'worca/fix', status: 'running' } });
    assert.equal((await cardPost(s, { state: 'applied' })).status, 200);
    assert.equal(e.orch.stoppedBy, 'ada');
  } finally {
    if (prev === undefined) delete process.env.WORCA_IDENTITY_NAME; else process.env.WORCA_IDENTITY_NAME = prev;
    mod.runs.delete('uuid-stop-3');
  }
});

test('receipt Revert: a second click while the first is in flight is refused — one revert, not two (mutation killer)', async () => {
  const minted = await host().apply({ kind: 'setting', id: 'theme', scope: 'user', value: 'dark' }, { actor: 'local' });
  const s = seed(minted.block);
  const h = host(); const orig = h.revert;
  let release; const gate = new Promise((r) => { release = r; });
  let entered = 0;
  h.revert = async (...a) => { entered += 1; await gate; return orig(...a); };
  try {
    const first = cardPost(s, { state: 'reverted' });
    for (let i = 0; i < 400 && entered === 0; i++) await new Promise((r) => setTimeout(r, 5));
    let secondDone = false;
    const second = cardPost(s, { state: 'reverted' }).then((r) => { secondDone = true; return r; });
    for (let i = 0; i < 100 && !secondDone && entered < 2; i++) await new Promise((r) => setTimeout(r, 5));
    release();
    const r2 = await second;
    assert.equal(r2.status, 409);
    assert.equal((await r2.json()).error, 'card is being applied');
    assert.equal((await first).status, 200);
    assert.equal(entered, 1, 'the second click never reached the host');
  } finally { h.revert = orig; release(); }
});

test('Away "I\'m back" counts only inside away hours: a receipt while they apply, none outside them', async () => {
  const h = host();
  const { applySettingsPatch } = mod._testing;
  const hhmm = (ms) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  try {
    const none = await h.awaySwitch({ kind: 'global', toggle: 'here' }, { actor: 'local', person: null });
    assert.equal(none.ok, true, JSON.stringify(none));
    assert.equal(none.receipt, undefined, 'no away hours: "I\'m back" changes nothing, so no receipt');
    await h.awaySwitch({ kind: 'global', toggle: 'auto' }, { actor: 'local', person: null });
    await applySettingsPatch({ nightMode: { window: `${hhmm(Date.now() - 3600e3)}-${hhmm(Date.now() + 3600e3)}` } });
    const r = await h.awaySwitch({ kind: 'global', toggle: 'here' }, { actor: 'local', person: null });
    assert.ok(r.receipt, 'inside away hours, auto → here changed the status');
    assert.deepEqual(r.receipt.raw, { before: 'auto', after: 'here', person: null });
    assert.equal(r.receipt.after, "I'm back");
  } finally {
    await h.awaySwitch({ kind: 'global', toggle: 'auto' }, { actor: 'local', person: null });
    await applySettingsPatch({ nightMode: null });
  }
});

test('receipt Revert: the host is called as the clicker (actorOf), not as the server (refine cycle 2 mutation killer)', async () => {
  const prev = process.env.WORCA_IDENTITY_NAME;
  process.env.WORCA_IDENTITY_NAME = 'ada';
  const h = host(); const orig = h.revert;
  const seen = [];
  h.revert = async (_card, o) => { seen.push(o && o.actor); return { ok: true, notice: 'Reverted: Run (x) back to Running' }; };
  try {
    const s = seed({ state: 'applied', card: { type: 'receipt', kind: 'pause', label: 'Run', target: { pipelineId: 'aaaa0011', title: 'x' }, before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' }, revertible: true } });
    assert.equal((await cardPost(s, { state: 'reverted' })).status, 200);
    assert.deepEqual(seen, ['ada']);
  } finally {
    h.revert = orig;
    if (prev === undefined) delete process.env.WORCA_IDENTITY_NAME; else process.env.WORCA_IDENTITY_NAME = prev;
  }
});

test('run-stop card: a second Stop click while the first is in flight is refused — one stop, not two (refine cycle 2 mutation killer)', async () => {
  const s = seed({ state: 'proposed', card: { type: 'run-stop', runId: null, pipelineId: 'aaaa0012', title: 'x', branch: '', status: 'running' } });
  const h = host(); const orig = h.stop;
  let release; const gate = new Promise((r) => { release = r; });
  let entered = 0;
  h.stop = async () => { entered += 1; await gate; return { ok: true }; };
  try {
    const first = cardPost(s, { state: 'applied' });
    for (let i = 0; i < 400 && entered === 0; i++) await new Promise((r) => setTimeout(r, 5));
    let secondDone = false;
    const second = cardPost(s, { state: 'applied' }).then((r) => { secondDone = true; return r; });
    for (let i = 0; i < 100 && !secondDone && entered < 2; i++) await new Promise((r) => setTimeout(r, 5));
    release();
    const r2 = await second;
    assert.equal(r2.status, 409);
    assert.equal((await r2.json()).error, 'card is being applied');
    assert.equal((await first).status, 200);
    assert.equal(entered, 1, 'the second click never reached the host');
    assert.equal(store.findCard(s.threadId, s.cardId).block.state, 'applied');
  } finally { h.stop = orig; release(); }
});

test('pull-request card: "Not now" on a card POST /api/pr already applied is refused — its pull request links stay (refine cycle 2 mutation killer)', async () => {
  const s = seed({ state: 'applied', card: { type: 'pull-request', pipelineId: 'aaaa0013', projectKey: project.key, title: 'x', branch: 'worca/x', result: { url: 'https://x/pull/1', draft: false, existed: false } } });
  const r = await cardPost(s, { state: 'declined' });
  assert.equal(r.status, 409);
  assert.equal(store.findCard(s.threadId, s.cardId).block.state, 'applied');
});

test('per-person Away (B4): the chat\'s "I\'m away now" / "I\'m back" receipts read the asking person\'s own switch, and Revert puts THAT switch back (refine cycle 2 mutation killer)', async () => {
  const prev = process.env.WORCA_AWAY_PER_PERSON;
  process.env.WORCA_AWAY_PER_PERSON = '1';
  const { nightModeToggleFor, nightModeToggle } = await import('../src/core/settings.mjs');
  const { applySettingsPatch } = mod._testing;
  const hhmm = (ms) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  const h = host();
  try {
    const r = await h.awaySwitch({ kind: 'global', toggle: 'on' }, { actor: 'ada', person: 'ada' });
    assert.ok(r.receipt, JSON.stringify(r));
    assert.deepEqual(r.receipt.raw, { before: 'auto', after: 'on', person: 'ada' });
    assert.equal(nightModeToggle(), 'auto', 'the instance switch is untouched');
    const s = seed({ state: 'applied', card: r.receipt });
    const rv = await cardPost(s, { state: 'reverted' });
    assert.equal(rv.status, 200, await rv.clone().text());
    assert.equal(nightModeToggleFor('ada'), 'auto', 'ada\'s own switch is back');
    await applySettingsPatch({ nightMode: { window: `${hhmm(Date.now() - 3600e3)}-${hhmm(Date.now() + 3600e3)}` } });
    const back = await h.awaySwitch({ kind: 'global', toggle: 'here' }, { actor: 'ada', person: 'ada' });
    assert.ok(back.receipt, 'inside away hours, ada\'s own "I\'m back" changed her status');
    assert.deepEqual(back.receipt.raw, { before: 'auto', after: 'here', person: 'ada' });
  } finally {
    await h.awaySwitch({ kind: 'global', toggle: 'auto' }, { actor: 'ada', person: 'ada' });
    await applySettingsPatch({ nightMode: null });
    if (prev === undefined) delete process.env.WORCA_AWAY_PER_PERSON; else process.env.WORCA_AWAY_PER_PERSON = prev;
  }
});

test('the context block lists a stop warning and a pull-request offer by their one line too (refine cycle 2 mutation killer)', async () => {
  const a = seed({ state: 'declined', card: { type: 'run-stop', runId: null, pipelineId: 'aaaa0014', title: 'Fix login', branch: '', status: 'running' } });
  const b = seed({ state: 'applied', card: { type: 'pull-request', pipelineId: 'aaaa0015', projectKey: project.key, title: 'Ship me', branch: 'worca/x', result: { url: 'https://x/pull/9', draft: false, existed: false } } });
  const ca = (await mod._testing.resolveAskContext(a.threadId, {}, [])).cards.find((c) => c.id === a.cardId);
  const cb = (await mod._testing.resolveAskContext(b.threadId, {}, [])).cards.find((c) => c.id === b.cardId);
  assert.deepEqual(ca, { id: a.cardId, type: 'run-stop', state: 'declined', summary: 'Stop Fix login' });
  assert.deepEqual(cb, { id: b.cardId, type: 'pull-request', state: 'applied', summary: 'Pull request for Ship me: https://x/pull/9' });
});

test('pull-request card facts come from the saved run: branch → base and files ± for a project run; a workspace run names its workspace and member branch (refine cycle 2 mutation killer)', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { seedWorkspacePipeline } = await import('./helpers/db-seed.mjs');
  const { id, dir } = await seedPipeline(project.path, { title: 'Ship me', status: 'done', branch: { source: 'main', feature: 'worca/ship-me', branchKept: true } });
  await writeFile(join(dir, 'results.json'), JSON.stringify({ summary: { filesNew: 2, filesChanged: 3, linesAdded: 40, linesRemoved: 7 } }));
  const p = await host().apply({ kind: 'pull-request', runId: id }, { actor: 'local' });
  assert.deepEqual(p.block, { state: 'proposed', card: { type: 'pull-request', pipelineId: id, projectKey: project.key, title: 'Ship me', branch: 'worca/ship-me', base: 'main', filesChanged: 5, additions: 40, deletions: 7 } });
  const WK = 'wks-cards-00000001';
  const members = [{ projectKey: project.key, projectDir: project.path, projectName: 'actcards' }];
  const feat = { source: 'main', feature: 'worca/ws-feat', branchKept: true };
  const ws = await seedWorkspacePipeline(project.path, WK, { title: 'Cross', status: 'done', workspaceName: 'Team', projects: members, projectKeys: [project.key],
    branches: { [project.key]: feat }, branch: { ...feat } }, members);
  const w = await host().apply({ kind: 'pull-request', runId: ws.id }, { actor: 'local' });
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.deepEqual(w.block.card, { type: 'pull-request', pipelineId: ws.id, projectKey: `workspaces/${WK}`, workspaceId: WK, title: 'Cross', branch: 'worca/ws-feat' });
});

test('startAskTurn wiring (askChatTurnDeps): chat actions run as "<person> via worca chat"; the Away switch acts on the asking person\'s own switch (refine cycle 2)', async () => {
  const h = host(); const { apply, awaySwitch } = h;
  const seen = [];
  h.apply = async (req, o) => { seen.push(['apply', req.kind, o]); return { ok: false, notice: 'x' }; };
  h.awaySwitch = async (req, o) => { seen.push(['away', req.kind, o]); return { ok: true, line: 'x' }; };
  try {
    const d = mod._testing.askChatTurnDeps('ada@example.com');
    await d.chatAction({ kind: 'pause', runId: 'aaaa0001' });
    await d.awaySwitch({ kind: 'global', toggle: 'on' });
    const local = mod._testing.askChatTurnDeps(null);
    await local.chatAction({ kind: 'pause', runId: 'aaaa0001' });
    await local.awaySwitch({ kind: 'global', toggle: 'on' });
    assert.deepEqual(seen, [
      ['apply', 'pause', { actor: 'ada@example.com via worca chat' }],
      ['away', 'global', { actor: 'ada@example.com', person: 'ada@example.com' }],
      ['apply', 'pause', { actor: 'worca chat' }],
      ['away', 'global', { actor: 'local', person: null }],
    ]);
  } finally { h.apply = apply; h.awaySwitch = awaySwitch; }
});

test('askChatTurnDeps: changes/route go to askShapeAction with the turn\'s thread; other kinds stay on the host', async () => {
  const d = mod._testing.askChatTurnDeps('ada@example.com');
  const prev = process.env.WORCA_FLAGS; process.env.WORCA_FLAGS = '-shapeFirst';
  try {
    assert.deepEqual(await d.chatAction({ kind: 'changes', pipelineId: 'aaaa0001', request: 'x' }, { threadId: 'ask_x' }),
      { ok: false, notice: 'Not applied: Shaper is off' });
  } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
});

test('one turn\'s set_away_now and change_setting both land: the Away switch shares the settings write queue (refine cycle 2)', async () => {
  const { nightModeToggle } = await import('../src/core/settings.mjs');
  const h = host();
  try {
    for (let i = 0; i < 3; i++) {
      const [a, b] = await Promise.all([
        h.apply({ kind: 'setting', id: 'theme', scope: 'user', value: 'dark' }, { actor: 'local' }),
        h.awaySwitch({ kind: 'global', toggle: 'on' }, { actor: 'local', person: null }),
      ]);
      assert.equal(a.ok, true, JSON.stringify(a));
      assert.equal(b.ok, true, JSON.stringify(b));
      assert.equal((await get('/api/settings')).theme, 'dark', `theme kept (round ${i})`);
      assert.equal(nightModeToggle(), 'on', `Away switch kept (round ${i})`);
      // An away-now Revert racing a chat change keeps both too.
      const s = seed({ state: 'applied', card: b.receipt });
      const [rv, c] = await Promise.all([cardPost(s, { state: 'reverted' }), h.apply({ kind: 'setting', id: 'theme', scope: 'user', value: 'light' }, { actor: 'local' })]);
      assert.equal(rv.status, 200, await rv.clone().text());
      assert.equal(c.ok, true, JSON.stringify(c));
      assert.equal(nightModeToggle(), 'auto', `Away switch reverted (round ${i})`);
      assert.equal((await get('/api/settings')).theme, 'light', `theme kept beside the Revert (round ${i})`);
      await post('/api/settings', { theme: '' });
    }
  } finally {
    await h.awaySwitch({ kind: 'global', toggle: 'auto' }, { actor: 'local', person: null });
    await post('/api/settings', { theme: '' });
  }
});

test('stop apply / decline and pull-request "Not now" start no event turn (lead call 5) (refine cycle 2)', async () => {
  const { id } = await seedPipeline(project.path, { title: 'Quiet', status: 'running' });
  const e = liveEntry({ id: 'uuid-stop-q', pipelineId: id });
  const a = seed({ state: 'proposed', card: { type: 'run-stop', runId: e.id, pipelineId: id, title: 'Quiet', branch: '', status: 'running' } });
  const b = seed({ state: 'proposed', card: { type: 'run-stop', runId: null, pipelineId: 'aaaa0016', title: 'x', branch: '', status: 'running' } });
  const c = seed({ state: 'proposed', card: { type: 'pull-request', pipelineId: 'aaaa0017', projectKey: project.key, title: 'x', branch: 'worca/x' } });
  try {
    assert.equal((await cardPost(a, { state: 'applied' })).status, 200);
    assert.equal((await cardPost(b, { state: 'declined' })).status, 200);
    assert.equal((await cardPost(c, { state: 'declined' })).status, 200);
    for (const s of [a, b, c]) assert.equal(mod._testing.askJobs.has(s.threadId), false, s.cardId);
  } finally { mod.runs.delete('uuid-stop-q'); }
});

test('a real turn is wired through askChatTurnDeps(the TURN\'s reader): a shared sign-in\'s chat actions and Away switch are that person\'s, a thread owner\'s when no one is signed in on the request (refine cycle 3 mutation killer)', async () => {
  const { holdMockTurn } = await import('./helpers/ask-hold.mjs');
  const prev = process.env.WORCA_IDENTITY_HEADER;
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';         // a per-person sign-in (identity.mjs 'header')
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // X1: the in-process server's callers are loopback
  const h = host(); const { apply, awaySwitch } = h;
  /** Start a held mock turn on `thread` with `headers`, call its two chat deps, return what the host saw. */
  async function depsSeen(thread, headers) {
    const seen = [];
    h.apply = async (req, o) => { seen.push(['apply', req.kind, o]); return { ok: false, notice: 'x' }; };
    h.awaySwitch = async (req, o) => { seen.push(['away', req.kind, o]); return { ok: true, line: 'x' }; };
    const hold = holdMockTurn(null);
    try {
      const r = await fetch(`${base}/api/ask/threads/${thread.id}/messages`, { method: 'POST', headers: { ...JSONH, ...headers },
        body: JSON.stringify({ text: 'MOCK_SLOW pause it', model: 'claude-opus-5-5', effort: 'high', context: {} }) });
      assert.equal(r.status, 202, await r.clone().text());
      let turn = null;
      for (let i = 0; i < 500 && !(turn = mod._testing.askJobs.get(thread.id)?.turn); i++) await new Promise((res) => setTimeout(res, 10));
      assert.ok(turn, 'the turn started');
      assert.equal(typeof turn.deps.chatAction, 'function', 'startAskTurn hands the turn its chatAction dep');
      assert.equal(typeof turn.deps.awaySwitch, 'function', 'startAskTurn hands the turn its awaySwitch dep');
      await turn.deps.chatAction({ kind: 'pause', runId: 'aaaa0001' }, { threadId: thread.id });
      await turn.deps.awaySwitch({ kind: 'global', toggle: 'on' });
      return seen;
    } finally {
      await fetch(`${base}/api/ask/threads/${thread.id}/stop`, { method: 'POST', headers: { ...JSONH, ...headers }, body: '{}' });
      hold.dispose();
      for (let i = 0; i < 500 && mod._testing.askJobs.get(thread.id)?.status === 'running'; i++) await new Promise((res) => setTimeout(res, 10));   // settled (its grace entry stays)
    }
  }
  try {
    assert.deepEqual(await depsSeen(store.createThread(), { 'x-test-user': 'ada@example.com' }), [
      ['apply', 'pause', { actor: 'ada@example.com via worca chat' }],
      ['away', 'global', { actor: 'ada@example.com', person: 'ada@example.com' }],
    ], 'the signed-in asker');
    assert.deepEqual(await depsSeen(store.createThread({ createdBy: 'bob@example.com' }), {}), [
      ['apply', 'pause', { actor: 'bob@example.com via worca chat' }],
      ['away', 'global', { actor: 'bob@example.com', person: 'bob@example.com' }],
    ], 'no sign-in on the request: the shared thread\'s owner (turnReader), as an event turn reads it');
  } finally {
    h.apply = apply; h.awaySwitch = awaySwitch;
    if (prev === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = prev;
  }
});

test('per-person Away on a shared sign-in: in an ownerless (legacy) thread every person reaches, one person never Reverts another\'s own Away switch (refine cycle 3)', async () => {
  const prev = { pp: process.env.WORCA_AWAY_PER_PERSON, hdr: process.env.WORCA_IDENTITY_HEADER };
  process.env.WORCA_AWAY_PER_PERSON = '1';
  process.env.WORCA_IDENTITY_HEADER = 'X-Worca-User';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // X1: the in-process server's callers are loopback
  const { nightModeToggleFor } = await import('../src/core/settings.mjs');
  const h = host();
  const as = (who, s) => fetch(`${base}/api/ask/threads/${s.threadId}/cards/${s.cardId}`, { method: 'POST', headers: { ...JSONH, 'X-Worca-User': who }, body: JSON.stringify({ state: 'reverted' }) });
  try {
    const r = await h.awaySwitch({ kind: 'global', toggle: 'on' }, { actor: 'ada@x.com', person: 'ada@x.com' });
    assert.deepEqual(r.receipt.raw, { before: 'auto', after: 'on', person: 'ada@x.com' });
    const s = seed({ state: 'applied', card: r.receipt });
    assert.equal(store.getThread(s.threadId).createdBy ?? null, null, 'an ownerless thread: every signed-in person reaches it');
    const bob = await as('bob@x.com', s);
    assert.equal(bob.status, 409, await bob.clone().text());
    assert.equal((await bob.json()).code, 'NOT_REVERTIBLE');
    assert.equal(nightModeToggleFor('ada@x.com'), 'on', 'ada\'s own switch is untouched');
    assert.equal(store.findCard(s.threadId, s.cardId).block.state, 'applied');
    const ada = await as('ADA@x.com', s);
    assert.equal(ada.status, 200, await ada.clone().text());
    assert.equal(nightModeToggleFor('ada@x.com'), 'auto', 'the owner of the switch puts it back');
  } finally {
    await h.awaySwitch({ kind: 'global', toggle: 'auto' }, { actor: 'ada@x.com', person: 'ada@x.com' });
    for (const [k, v] of [['WORCA_AWAY_PER_PERSON', prev.pp], ['WORCA_IDENTITY_HEADER', prev.hdr]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('receipt Revert brings back the Settings page\'s "No cap" tick (a stored null), never an unset cap a team default fills', async () => {
  const { readSettings } = await import('../src/core/settings.mjs');
  assert.equal((await post('/api/settings', { askMaxBudgetUsd: null })).status, 200);   // Settings › Chat: No cap ticked
  assert.equal(readSettings().askMaxBudgetUsd, null);
  const minted = await host().apply({ kind: 'setting', id: 'askMaxBudgetUsd', scope: 'user', value: 5 }, { actor: 'local' });
  assert.equal(minted.ok, true, JSON.stringify(minted));
  assert.equal(minted.block.card.before, 'No cap');
  assert.equal(readSettings().askMaxBudgetUsd, 5);
  const r = await cardPost(seed(minted.block), { state: 'reverted' });
  assert.equal(r.status, 200, await r.clone().text());
  const stored = readSettings();
  assert.ok(Object.prototype.hasOwnProperty.call(stored, 'askMaxBudgetUsd'), 'the key is back, not cleared (limits.mjs: a cleared key takes the team default)');
  assert.equal(stored.askMaxBudgetUsd, null);
  assert.deepEqual(await host().apply({ kind: 'setting', id: 'askMaxBudgetUsd', scope: 'user', value: null }, { actor: 'local' }),
    { ok: false, notice: 'Per-turn cost cap is already No cap' }, 'null on an explicit No cap is no change');
  assert.equal((await mod._testing.askChatSettings.check({ id: 'askMaxBudgetUsd', scope: 'user', value: null })).value, null,
    'the child hands the parent the model\'s own null, never the stored marker');
  assert.equal((await post('/api/settings', { askMaxBudgetUsd: '' })).status, 200);
});

test('pull-request card of a mixed workspace run counts only its Git members: a Folder member ships in no pull request', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { seedWorkspacePipeline } = await import('./helpers/db-seed.mjs');
  const WK = 'wks-cards-00000002';
  const FK = 'notes-0000000f';
  const members = [{ projectKey: FK, projectDir: '/nowhere/notes', projectName: 'notes', workMode: 'folder' },
    { projectKey: project.key, projectDir: project.path, projectName: 'actcards' }];
  const feat = { source: 'main', feature: 'worca/ws-mixed', branchKept: true };
  const ws = await seedWorkspacePipeline(project.path, WK, { title: 'Mixed', status: 'done', workspaceName: 'Team', projects: members,
    projectKeys: members.map((m) => m.projectKey),
    branches: { [FK]: { workMode: 'folder', runRootMode: 'detached', copyDir: '/nowhere/copy', realDir: '/nowhere/notes' }, [project.key]: feat }, branch: {} }, members);
  const sum = (n, add) => ({ filesNew: n, filesChanged: 0, filesDeleted: 0, linesAdded: add, linesRemoved: 0 });
  await writeFile(join(ws.dir, 'results.json'), JSON.stringify({ summary: sum(5, 50), perProject: { [FK]: { summary: sum(3, 30) }, [project.key]: { summary: sum(2, 20) } } }));
  const w = await host().apply({ kind: 'pull-request', runId: ws.id }, { actor: 'local' });
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.deepEqual([w.block.card.branch, w.block.card.filesChanged, w.block.card.additions, w.block.card.deletions], ['worca/ws-mixed', 2, 20, 0]);
});
