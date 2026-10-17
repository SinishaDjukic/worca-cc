// test/ask-pr-fix-card.test.mjs — PR watch fix runs in the Ask chat (askPrFixRun): the PR → chat map through the applied
// pull-request card, one card per fix run, a quiet follower, the outcome, the unread frame, and what a reload reads back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createThread, appendMessage, listMessages, listRunLinks, newAskId } from '../src/core/ask/store.mjs';

useTempHome(after);
let mod, srv, base;
const tmpDirs = [];
before(async () => {
  mod = await import('../ui/server.mjs');                 // dynamic: after useTempHome()
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${srv.address().port}`;
});
after(async () => {
  mod.runs.clear();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  closeDbForTests();
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

const GH = 'https://github.com/o/r/pull/7';
const prCard = (result, over = {}) => ({ kind: 'card', id: newAskId('card'), state: 'applied',
  card: { type: 'pull-request', pipelineId: 'orig0001', projectKey: 'shop-00000001', title: 'Login', branch: 'feat/login', result, ...over } });
function chatWith(...blocks) { const t = createThread(); appendMessage(t.id, { role: 'assistant', text: 'Here it is.', blocks, status: 'done' }); return t; }
let n = 0;
async function liveFix(title = 'Fix PR #7 feedback') {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-prfix-')); tmpDirs.push(dir);
  const orch = new EventEmitter(); orch.getState = () => ({ title });
  const entry = { id: `fix-run-${++n}`, orch, projectDir: dir, title, status: 'starting', startedAt: new Date().toISOString(), events: [], pendingQuestion: null };
  mod.runs.set(entry.id, entry);
  return entry;
}
const started = (runId, prUrl = GH, over = {}) => ({ phase: 'started', watch: { prUrl, pipelineId: 'orig0001', memberKey: '' }, runId,
  trigger: { kinds: ['checks', 'comments'], label: 'Failing checks and review comments' }, once: false, ...over });
const ended = (runId, outcome, over = {}) => ({ phase: 'ended', watch: { prUrl: GH, pipelineId: 'orig0001', memberKey: '' }, runId, pipelineId: 'fix00001', outcome, ...over });
const fixCards = (threadId) => listMessages(threadId).flatMap((m) => (m.blocks || []).filter((b) => b && b.kind === 'card' && b.card && b.card.fix).map((b) => ({ m, b })));
function openWs() {
  const ws = new WebSocket(`ws://${base}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = []; ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  return { ws, msgs, opened: new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); }) };
}
const until = async (pred, ms = 5000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 15)); } };

test('a fix run on a PR a chat opened: one card on a system row, its link and a quiet follower; nothing for other chats; never twice', async () => {
  const a = chatWith(prCard({ url: GH, draft: false, existed: false }));
  const other = chatWith(prCard({ url: `${GH}0`, draft: false, existed: false }));          // …/pull/70: holds the url as a substring
  const plain = createThread();
  const e = await liveFix();
  const w = openWs(); await w.opened;
  const posted = mod._testing.askPrFixRun(started(e.id));
  assert.deepEqual(posted.map((p) => p.threadId), [a.id]);
  const [{ m, b }] = fixCards(a.id);
  assert.equal(m.role, 'system');
  assert.match(m.text, /^PR watch started a fix run on https:\/\/github\.com\/o\/r\/pull\/7: Failing checks and review comments$/);
  assert.equal(b.state, 'tracked');
  assert.deepEqual(b.card, { type: 'progress', pipelineId: null, runId: e.id, projectKey: projectKey(e.projectDir), workspaceId: null,
    title: 'Fix PR #7 feedback', label: basename(e.projectDir), status: 'starting',
    fix: { prUrl: GH, memberKey: null, originPipelineId: 'orig0001', trigger: ['checks', 'comments'], triggerLabel: 'Failing checks and review comments', once: false } });
  assert.deepEqual(listRunLinks(a.id).map((l) => [l.runId, l.cardId]), [[e.id, b.id]]);
  assert.equal(mod._testing.askFollowers.get(a.id).size, 1);
  assert.deepEqual([fixCards(other.id), fixCards(plain.id)], [[], []]);
  await until(() => w.msgs.some((f) => f.type === 'ask-message' && f.threadId === a.id));
  const frame = w.msgs.find((f) => f.type === 'ask-message' && f.threadId === a.id);
  assert.equal(frame.unread, true, 'the Chat row dot lights where the chat is not on screen');
  assert.deepEqual(mod._testing.askPrFixRun(started(e.id)), [], 'one card per fix run');
  assert.equal(fixCards(a.id).length, 1);
  w.ws.close();
});

test('the follower is quiet: the link gets the pipeline id, and the run ending posts no notice', async () => {
  const a = chatWith(prCard({ url: GH, draft: false, existed: false }));
  const e = await liveFix();
  mod._testing.askPrFixRun(started(e.id));
  const rows = listMessages(a.id).length;
  e.orch.emit('state', { id: 'fix00002', status: 'running', title: 'Fix PR #7 feedback' });
  e.orch.emit('done', { status: 'done' });
  assert.equal(listRunLinks(a.id)[0].pipelineId, 'fix00002');
  assert.equal(listMessages(a.id).length, rows, 'no Run finished row');
  assert.equal(mod._testing.askLinkIsPrFix({ threadId: a.id, cardId: fixCards(a.id)[0].b.id }), true);
  assert.equal(mod._testing.askLinkIsPrFix({ threadId: a.id, cardId: null }), false);
});

test('the outcome lands once on the card with the fix run\'s pipeline id, and survives a reload', async () => {
  // Its own PR: the chats of the tests above also hold an applied card for GH, and each would get this run's card.
  const pr = 'https://github.com/o/r/pull/8';
  const a = chatWith(prCard({ url: pr, draft: false, existed: false }));
  const e = await liveFix('Fix PR #8 feedback');
  mod._testing.askPrFixRun(started(e.id, pr));
  const outcome = { kind: 'pushed', sha: 'abc1234', stopped: 'cap', fixRuns: 3 };
  assert.equal(mod._testing.askPrFixRun(ended(e.id, outcome)).length, 1);
  assert.equal(mod._testing.askPrFixRun(ended(e.id, { kind: 'failed', reason: 'fix-failed', fixRuns: 3 })).length, 0, 'settled once');
  closeDbForTests();                                         // the next read reopens the database from disk
  const snap = await (await fetch(`http://${base}/api/ask/threads/${a.id}`)).json();
  const card = snap.messages.flatMap((m) => m.blocks || []).find((x) => x && x.card && x.card.fix);
  assert.deepEqual([card.card.pipelineId, card.card.fix.outcome], ['fix00001', outcome]);
  assert.ok(snap.runLinks.some((l) => l.runId === e.id && l.cardId === card.id), 'the link that resolves the card after a reload');
});

test('a workspace member PR maps to its chat with the member key; the watcher dep is wired', async () => {
  const web = 'https://github.com/o/web/pull/6';
  const a = chatWith(prCard({ url: 'https://github.com/o/api/pull/5', draft: false, existed: false, members: [
    { url: 'https://github.com/o/api/pull/5', draft: false, existed: false, memberKey: 'api-11111111' },
    { url: web, draft: false, existed: false, memberKey: 'web-22222222' }] }, { projectKey: 'workspaces/wk1', workspaceId: 'wk1' }));
  const e = await liveFix('Resolve PR #6 merge conflicts');
  mod._testing.prWatcherDeps.onFixRun(started(e.id, web, { watch: { prUrl: web, pipelineId: 'orig0001', memberKey: 'web-22222222' },
    trigger: { kinds: ['conflict'], label: 'Merge conflicts' }, once: true }));
  const [{ b }] = fixCards(a.id);
  assert.deepEqual([b.card.fix.memberKey, b.card.fix.once, b.card.fix.triggerLabel, b.card.title], ['web-22222222', true, 'Merge conflicts', 'Resolve PR #6 merge conflicts']);
});
