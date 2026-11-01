// test/api-pr-ask-link.test.mjs — worca Chat P2 Task 7: the chat's pull-request card is applied by POST /api/pr itself
// (R9): validated BEFORE anything is pushed, flipped on success with {url, draft, existed}, left proposed on failure.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../ui/server.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { writeStoreMeta } from '../src/core/artifacts.mjs';
import { createThread, appendMessage, findCard } from '../src/core/ask/store.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

let srv, base, home, prevHome, repo, runId, key;
let n = 0;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-prlink-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-prlink-repo-'));
  const seeded = await seedPipeline(repo, { title: 'My feature', status: 'done',
    branch: { source: 'main', feature: 'worca-cc/my-feature-pp', branchKept: true, commit: 'abc' } });
  runId = seeded.id; key = seeded.key;
  writeStoreMeta(key, 'project', { key, name: 'Beta', path: repo });
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

beforeEach(() => { gitInfo.reset(); });

const post = (body) => fetch(`${base}/api/pr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/** gh + git faked like test/pr-api.test.mjs's success case; `create` decides what `gh pr create` answers. */
function stubGh(seen, create = { ok: true, stdout: 'https://github.com/x/y/pull/7\n', stderr: '', code: 0 }) {
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'push') return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return Promise.resolve(create);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return Promise.resolve({ ok: true, stdout: 'MERGEABLE\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}
/** A thread with one pull-request card for `pipelineId`, in `state`. */
function seedCard({ pipelineId = runId, state = 'proposed', type = 'pull-request' } = {}) {
  const t = createThread();
  const cardId = `card_${String(++n).padStart(8, '0')}`;
  appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state,
    card: { type, pipelineId, projectKey: key, title: 'My feature', branch: 'worca-cc/my-feature-pp', base: 'main' } }] });
  return { askThreadId: t.id, askCardId: cardId };
}

test('POST /api/pr with an ask link: the PR opens, the card flips to applied with {url, draft, existed}, the response is unchanged', async () => {
  const seen = []; stubGh(seen);
  const link = seedCard();
  const r = await post({ projectKey: key, id: runId, ...link });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(Object.keys(await r.json()).sort(), ['draft', 'existed', 'mergeable', 'ok', 'url']);
  const block = findCard(link.askThreadId, link.askCardId).block;
  assert.equal(block.state, 'applied');
  assert.deepEqual(block.card.result, { url: 'https://github.com/x/y/pull/7', draft: false, existed: false });
});

test('POST /api/pr ask-link refusals come BEFORE anything is pushed; a failed PR leaves the card proposed', async () => {
  await checkRows([
    { name: 'half a pair', run: async () => {
      const seen = []; stubGh(seen);
      const { askThreadId } = seedCard();
      assert.equal((await post({ projectKey: key, id: runId, askThreadId })).status, 400);
      assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'));
    } },
    { name: 'not a pull-request card / another run\'s card', run: async () => {
      const seen = []; stubGh(seen);
      const r1 = await post({ projectKey: key, id: runId, ...seedCard({ type: 'run-stop' }) });
      assert.equal(r1.status, 400); assert.match((await r1.json()).error, /unknown askCardId/);
      const r2 = await post({ projectKey: key, id: runId, ...seedCard({ pipelineId: 'ffff0000' }) });
      assert.equal(r2.status, 400); assert.match((await r2.json()).error, /belongs to another run/);
      assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'));
    } },
    { name: 'a declined card', run: async () => {
      const seen = []; stubGh(seen);
      const r = await post({ projectKey: key, id: runId, ...seedCard({ state: 'declined' }) });
      assert.equal(r.status, 409);
      assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'nothing pushed');
    } },
    { name: 'gh fails', run: async () => {
      const seen = []; stubGh(seen, { ok: false, stdout: '', stderr: 'boom', code: 1 });
      const link = seedCard();
      const r = await post({ projectKey: key, id: runId, ...link });
      assert.notEqual(r.status, 200);
      assert.equal(findCard(link.askThreadId, link.askCardId).block.state, 'proposed', 'the Ship it dialog shows its own error');
    } },
  ]);
});

test('a workspace run: each member PR posts the same ask link; the second is not refused and joins result.members (Review Focus 3, route)', async () => {
  const WK = 'wks-team-a-00000001';
  const apiDir = await mkdtemp(join(tmpdir(), 'worca-cc-prlink-api-'));
  const webDir = await mkdtemp(join(tmpdir(), 'worca-cc-prlink-web-'));
  try {
    const members = [{ projectKey: 'api-00000001', projectDir: apiDir, projectName: 'api' }, { projectKey: 'web-00000002', projectDir: webDir, projectName: 'web' }];
    const branches = { 'api-00000001': { source: 'main', feature: 'worca-cc/feat-api', branchKept: true }, 'web-00000002': { source: 'dev', feature: 'worca-cc/feat-web', branchKept: true } };
    const { id } = await seedWorkspacePipeline(apiDir, WK, { title: 'Cross repo', status: 'done', workspaceName: 'Team A',
      projects: members, projectKeys: members.map((m) => m.projectKey), branches, branch: { ...branches['api-00000001'] } }, members);
    const seen = []; stubGh(seen);
    const link = seedCard({ pipelineId: id });
    const r1 = await post({ projectKey: `workspaces/${WK}`, id, memberKey: 'api-00000001', ...link });
    assert.equal(r1.status, 200, await r1.clone().text());
    const r2 = await post({ projectKey: `workspaces/${WK}`, id, memberKey: 'web-00000002', ...link });
    assert.equal(r2.status, 200, await r2.clone().text());
    const block = findCard(link.askThreadId, link.askCardId).block;
    assert.equal(block.state, 'applied');
    assert.deepEqual(block.card.result.members.map((m) => m.memberKey), ['api-00000001', 'web-00000002']);
  } finally {
    await rm(apiDir, { recursive: true, force: true });
    await rm(webDir, { recursive: true, force: true });
  }
});

test('ask-link refusals name the reason; a failed push leaves the card proposed (mutation killer)', async () => {
  await checkRows([
    { name: 'half a pair', run: async () => {
      const seen = []; stubGh(seen);
      const { askThreadId } = seedCard();
      const r = await post({ projectKey: key, id: runId, askThreadId });
      assert.equal(r.status, 400); assert.match((await r.json()).error, /must be provided together/);
    } },
    { name: 'a malformed id', run: async () => {
      const seen = []; stubGh(seen);
      const r = await post({ projectKey: key, id: runId, askThreadId: '../x', askCardId: 'card_00000001' });
      assert.equal(r.status, 400); assert.match((await r.json()).error, /invalid askThreadId or askCardId/);
    } },
    { name: 'an unknown thread', run: async () => {
      const seen = []; stubGh(seen);
      const r = await post({ projectKey: key, id: runId, askThreadId: 'ask_ffffffff', askCardId: 'card_00000001' });
      assert.equal(r.status, 400); assert.match((await r.json()).error, /unknown askThreadId/);
    } },
    { name: 'push fails', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => {
        seen.push([cmd, ...args]);
        if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
        if (cmd === 'git' && args[0] === 'push') return Promise.resolve({ ok: false, stdout: '', stderr: 'denied', code: 1 });
        return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
      });
      const link = seedCard();
      const r = await post({ projectKey: key, id: runId, ...link });
      assert.equal(r.status, 500);
      assert.ok(seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'it did try to push');
      assert.equal(findCard(link.askThreadId, link.askCardId).block.state, 'proposed');
    } },
  ]);
});

test('a project card already applied is not opened again by naming a member: the card rule reads the resolved member (refine cycle 2)', async () => {
  const seen = []; stubGh(seen);
  const link = seedCard({ state: 'applied' });
  const r = await post({ projectKey: key, id: runId, memberKey: 'anything-00000000', ...link });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'card is applied' });
  assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'nothing pushed');
});

test('on a shared sign-in another person\'s thread is an unknown askThreadId: nothing pushed, the card stays proposed (impl review m1 mutation killer)', async () => {
  const prev = process.env.WORCA_IDENTITY_HEADER;
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';         // a per-person sign-in (identity.mjs 'header')
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // X1: the in-process server's callers are loopback
  try {
    const t = createThread({ createdBy: 'alice@example.com' });
    const askCardId = `card_${String(++n).padStart(8, '0')}`;
    appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: askCardId, state: 'proposed',
      card: { type: 'pull-request', pipelineId: runId, projectKey: key, title: 'My feature', branch: 'worca-cc/my-feature-pp', base: 'main' } }] });
    const as = (who) => fetch(`${base}/api/pr`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': who },
      body: JSON.stringify({ projectKey: key, id: runId, askThreadId: t.id, askCardId }) });
    const seen = []; stubGh(seen);
    const bob = await as('bob@example.com');
    assert.equal(bob.status, 400);
    assert.deepEqual(await bob.json(), { error: 'unknown askThreadId' });
    assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'nothing pushed');
    assert.equal(findCard(t.id, askCardId).block.state, 'proposed');
    const alice = await as('alice@example.com');
    assert.equal(alice.status, 200, await alice.clone().text());
    assert.equal(findCard(t.id, askCardId).block.state, 'applied', 'the thread\'s owner links her own card');
  } finally {
    if (prev === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = prev;
  }
});

test('a card id the thread does not hold is refused before anything is pushed (refine cycle 3 mutation killer)', async () => {
  const seen = []; stubGh(seen);
  const { askThreadId } = seedCard();
  const r = await post({ projectKey: key, id: runId, askThreadId, askCardId: 'card_ffffffff' });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'unknown askCardId' });
  assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'nothing pushed');
});
