// test/ask-pr-fix-card.test.mjs — PR watch fix runs in the Ask chat (askPrFixRun): a fix run is a round of the PR's run,
// so the chats holding the PR's applied pull-request card get round-changed, and the outcome lands on the round's marker.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
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

// ── Shaper s5 (D20–D22): a fix run is a round of the PR's run — no card, row or link of its own ──
const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
const { roundsOf } = await import('../src/core/shape/rounds.mjs');

test('s5: a fix run posts no card, no row and no link; the chats holding the PR get round-changed', async () => {
  const a = chatWith(prCard({ url: GH, draft: false, existed: false }));
  const before = listMessages(a.id).length;
  const e = await liveFix();
  const w = openWs(); await w.opened;
  assert.deepEqual(mod._testing.askPrFixRun(started(e.id)), []);
  assert.equal(listMessages(a.id).length, before, '0 new rows');
  assert.equal(fixCards(a.id).length, 0, '0 new chat cards');
  assert.deepEqual(listRunLinks(a.id), []);
  await until(() => w.msgs.some((m) => m.type === 'round-changed'));
  const f = w.msgs.find((m) => m.type === 'round-changed');
  assert.equal(f.origin, 'orig0001');
  assert.ok(f.threadIds.includes(a.id), 'every chat holding the PR');
  w.ws.close();
});

test('s5: ended writes the outcome onto the fix round\'s marker, once', async () => {
  seedPipelineRow({ id: 'orig0001', status: 'done', branch: { source: 'dev', feature: 'feat/login' } });
  seedPipelineRow({ id: 'fix00001', status: 'done', branch: { source: 'dev', featureBranch: 'feat/login',
    roundOf: { pipelineId: 'orig0001', round: 2, request: 'fix failing checks', by: 'watch', kinds: ['checks'] } } });
  mod._testing.askPrFixRun(ended('run-x', { kind: 'pushed', sha: 'a1b2c3d', stopped: null, fixRuns: 1 }));
  mod._testing.askPrFixRun(ended('run-x', { kind: 'failed', reason: 'fix-failed' }));
  assert.deepEqual(roundsOf(['orig0001']).get('orig0001')[0].outcome, { kind: 'pushed', sha: 'a1b2c3d' });
});

test('s5: a fix run started through prWatcherDeps.startRun gets round n+1 of the PR\'s run', () => {
  seedPipelineRow({ id: 'orig0002', status: 'done', branch: { source: 'dev', feature: 'feat/a' } });
  assert.deepEqual(mod._testing.prFixRoundOf({ pipelineId: 'orig0002', request: 'resolve conflicts', kinds: ['conflict'] }),
    { pipelineId: 'orig0002', round: 2, request: 'resolve conflicts', by: 'watch', kinds: ['conflict'] });
  assert.equal(mod._testing.prFixRoundOf(null), null);
  assert.equal(mod._testing.prFixRoundOf({ pipelineId: '' }), null);
});
