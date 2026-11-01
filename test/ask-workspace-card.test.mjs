// test/ask-workspace-card.test.mjs
// Ask Worca's workspace card (src/core/ask/workspace-proposal.mjs + workspace-deps.mjs + the card
// route in ui/server.mjs): the validator the MCP child and the parent share (pure, over injected
// readers: the registry's own plan checks, live runs, schedules, the metrics / policy homes), the
// event/notice text, and the route over WORCA_MOCK — decline, apply for each kind, a live run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import {
  createWorkspaceChangeValidator, workspaceEventPrompt, workspaceNoticeText, WORKSPACE_CHANGE_KINDS,
} from '../src/core/ask/workspace-proposal.mjs';
import { checkRows } from './helpers/rows.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';

useTempHome(after);

// ── the validator (pure) ─────────────────────────────────────────────────────

const PROJECTS = [
  { key: 'ka', name: 'api', path: '/r/api' },
  { key: 'kb', name: 'web', path: '/r/web' },
  { key: 'kc', name: 'docs', path: '/r/docs' },
];
const WS = {
  id: 'wks-shop-0000abcd', name: 'Shop', projectPaths: ['/r/api', '/r/web'], projectKeys: ['ka', 'kb'],
  metricsProject: '/r/api', policyProject: '/r/api',
};
const keyOf = (p) => (PROJECTS.find((x) => x.path === p) || {}).key || `k:${p}`;
const coded = (message, code) => Object.assign(new Error(message), { code });

function validator(over = {}) {
  const calls = [];
  const v = createWorkspaceChangeValidator({
    listProjects: async () => PROJECTS,
    readWorkspace: async (id) => (id === WS.id ? WS : null),
    projectKeyOf: keyOf,
    plan: {
      create: (inp) => { calls.push(['create', inp]); return { id: 'wks-new-00000001', name: inp.name.trim(), members: inp.projectPaths }; },
      add: (id, paths) => { calls.push(['add', id, paths]); return { next: [...WS.projectPaths, ...paths] }; },
      remove: (id, path) => {
        calls.push(['remove', id, path]);
        return { removed: path, next: WS.projectPaths.filter((p) => p !== path),
          metricsProject: WS.metricsProject === path ? null : WS.metricsProject, policyProject: WS.policyProject === path ? null : WS.policyProject };
      },
      rename: (id, name) => { calls.push(['rename', id, name]); return { name: name.trim() }; },
    },
    liveRun: async () => false,
    scheduled: async () => [],
    homeStatus: async () => ({ metrics: null, policy: null }),
    ...over,
  });
  return { v, calls };
}

test('kinds and create: create/add_members/remove_member/rename; registered projects by key become a create card with the change to replay', async () => {
  await checkRows([
    { name: 'kinds: create, add_members, remove_member, rename', run: async () => {
      assert.deepEqual([...WORKSPACE_CHANGE_KINDS], ['create', 'add_members', 'remove_member', 'rename']);
    } },
    { name: 'create: registered projects by key become a card with the member set and the change to replay', run: async () => {
      const { v, calls } = validator();
      const r = await v({ kind: 'create', name: ' Shop 2 ', projectKeys: ['ka', 'kc'], note: 'for the release' });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.card.type, 'workspace');
      assert.equal(r.card.kind, 'create');
      assert.equal(r.card.summary, 'Create workspace Shop 2 with api, docs');
      assert.deepEqual(r.card.members, [{ key: 'ka', name: 'api', path: '/r/api' }, { key: 'kc', name: 'docs', path: '/r/docs' }]);
      assert.equal(r.card.note, 'for the release');
      assert.deepEqual(r.card.change, { name: 'Shop 2', projectPaths: ['/r/api', '/r/docs'] });
      assert.deepEqual(calls[0], ['create', { name: ' Shop 2 ', projectPaths: ['/r/api', '/r/docs'] }], 'the registry\'s own checks run');
    } },
  ]);
});

test('refusals: bad kind, unknown project, missing workspace, and the registry\'s coded errors come back as errors', async () => {
  const { v } = validator({
    plan: { create: () => { throw coded('a workspace named "Shop" already exists', 'DUPLICATE_NAME'); } },
  });
  assert.match((await v({ kind: 'merge' })).errors[0], /kind must be one of/);
  assert.match((await v({ kind: 'create', name: 'X', projectKeys: ['ka', 'nope'] })).errors[0], /unknown projectKey "nope"/);
  assert.match((await v({ kind: 'create', name: 'Shop', projectKeys: ['ka', 'kb'] })).errors[0], /already exists/);
  assert.match((await v({ kind: 'add_members', projectKeys: ['kc'] })).errors[0], /workspaceId is required/);
  assert.match((await v({ kind: 'add_members', workspaceId: 'wks-ghost-00000000', projectKeys: ['kc'] })).errors[0], /unknown workspace/);
  assert.match((await v({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'kc' })).errors[0], /not a member of Shop/);
});

test('add_members: names the new member, keeps the id, re-scans; warns about a live run, metrics/policy home mismatches and per-member schedules', async () => {
  await checkRows([
    { name: 'add_members: a plain add names the new member, keeps the id and says it re-scans', run: async () => {
      const { v } = validator();
      const r = await v({ kind: 'add_members', workspaceId: WS.id, projectKeys: ['kc'] });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.card.summary, 'Add docs to Shop');
      assert.deepEqual(r.card.added, [{ key: 'kc', name: 'docs', path: '/r/docs' }]);
      assert.deepEqual(r.card.change, { workspaceId: WS.id, projectPaths: ['/r/docs'] });
      assert.equal(r.card.workspaceId, WS.id);
      assert.ok(r.card.effects.some((e) => /keeps its id/.test(e)));
      assert.ok(r.card.effects.some((e) => /Workspace scan run.*graphify.*map.*description/.test(e)), JSON.stringify(r.card.effects));
      assert.deepEqual(r.card.warnings, []);
      assert.deepEqual(r.card.followUps, []);
    } },
    { name: 'add_members warns: a live run, a member off the metrics / policy home, schedules keyed per member', run: async () => {
      const { v } = validator({
        liveRun: async (id) => id === WS.id,
        homeStatus: async (ws, next) => {
          assert.deepEqual(next, ['/r/api', '/r/web', '/r/docs'], 'the status is read over the NEW member set');
          return {
            metrics: { home: 'acme/api', members: [{ path: '/r/api', ok: true }, { path: '/r/web', ok: true }, { path: '/r/docs', ok: false }] },
            policy: { home: 'acme/api', members: [{ path: '/r/docs', ok: false }] },
          };
        },
        scheduled: async () => [
          { kind: 'schedule', id: 'sch_1', title: 'Nightly', sourceBranchByKey: { ka: 'dev', kb: 'dev' }, sourceFromPrevious: false },
          { kind: 'ticket', id: 'run_2', title: 'Follow-up', sourceBranchByKey: null, sourceFromPrevious: true },
          { kind: 'ticket', id: 'run_3', title: 'Plain', sourceBranchByKey: null, sourceFromPrevious: false },
        ],
      });
      const r = await v({ kind: 'add_members', workspaceId: WS.id, projectKeys: ['kc'] });
      assert.equal(r.ok, true);
      const w = r.card.warnings.join('\n');
      assert.match(w, /A run of Shop is live/);
      assert.match(w, /docs does not record to the metrics home acme\/api/);
      assert.match(w, /docs does not follow the policy home acme\/api/);
      assert.match(w, /Nightly.*per-member source branches.*docs starts from the default/);
      assert.match(w, /Follow-up.*previous run's branches.*docs starts from its default source branch/);
      assert.doesNotMatch(w, /Plain/);
      assert.deepEqual(r.card.followUps, ['metrics_route_members', 'policy_route_members']);
    } },
  ]);
});

test('a Workspace scan still running reads as one: an automatic re-scan is replaced, one the user started must end', async () => {
  const { v } = validator({ liveRun: async () => 'scan' });
  const r = await v({ kind: 'add_members', workspaceId: WS.id, projectKeys: ['kc'] });
  assert.equal(r.ok, true);
  assert.match(r.card.warnings.join('\n'), /A Workspace scan of Shop is running — an automatic re-scan is replaced by this change; a scan you started must end first/);
  assert.doesNotMatch(r.card.warnings.join('\n'), /refused until it ends/);
});

test('remove_member clears a home it removes and warns about schedules; rename keeps the id', async () => {
  await checkRows([
    { name: 'remove_member: clears a home it removes, and warns about schedules naming the project', run: async () => {
      const { v, calls } = validator({
        scheduled: async () => [
          { kind: 'schedule', id: 'sch_1', title: 'Nightly', sourceBranchByKey: { ka: 'release', kb: 'dev' }, sourceFromPrevious: false },
          { kind: 'schedule', id: 'sch_2', title: 'Other', sourceBranchByKey: { kb: 'dev' }, sourceFromPrevious: false },
        ],
      });
      const r = await v({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'ka' });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(calls[0], ['remove', WS.id, '/r/api']);
      assert.equal(r.card.summary, 'Remove api from Shop');
      assert.deepEqual(r.card.removed, { key: 'ka', name: 'api', path: '/r/api' });
      assert.deepEqual(r.card.change, { workspaceId: WS.id, projectPath: '/r/api' });
      const w = r.card.warnings.join('\n');
      assert.match(w, /api is the metrics home — it is cleared/);
      assert.match(w, /api is the policy home — it is cleared/);
      assert.match(w, /Nightly.*api.*release/);
      assert.ok(r.card.effects.some((e) => /Map tab drops api's edges and reviews/.test(e)), JSON.stringify(r.card.effects));
      assert.doesNotMatch(w, /Other/);
      assert.deepEqual(r.card.followUps, ['metrics_workspace_home', 'policy_workspace_home']);
    } },
    { name: 'rename: the new name, the id kept', run: async () => {
      const { v } = validator();
      const r = await v({ kind: 'rename', workspaceId: WS.id, name: ' Storefront ' });
      assert.equal(r.ok, true);
      assert.equal(r.card.summary, 'Rename Shop to Storefront');
      assert.deepEqual(r.card.change, { workspaceId: WS.id, name: 'Storefront' });
      assert.deepEqual(r.card.followUps, []);
    } },
  ]);
});

test('remove_member carries worca\'s re-scan recommendation once (no duplicate effects line), preselects it, takes the user\'s choice', async () => {
  const REC = { level: 'full', reason: 'api had 9 edges with 1 member (web). A full re-scan is recommended so the map and its notes are rebuilt around the members left.', partialAvailable: true, signals: {} };
  const seen = [];
  const { v } = validator({ removeImpact: async (id, path, opts) => { seen.push([id, path, opts]); return REC; } });
  let r = await v({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'ka' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.recommendation, { level: 'full', reason: REC.reason, partialAvailable: true });
  assert.equal(r.card.rescan, 'full');
  assert.equal(r.card.rescanAsked, false);
  assert.deepEqual(seen[0], [WS.id, '/r/api', { pendingRescan: null }]);
  assert.equal(r.card.effects.some((e) => e.includes(REC.reason)), false, 'the reason is shown once, in the card\'s re-scan box');
  assert.equal(r.card.effects.some((e) => /starts a Workspace scan run of the new set/.test(e)), false, 'no "always a full scan" line on a removal');
  assert.ok(r.card.effects.some((e) => /re-scans as chosen on the card/.test(e)));
  assert.ok(r.card.effects.some((e) => /Map tab drops api's edges and reviews/.test(e)), 'the existing effect stays');

  r = await v({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'ka', rescan: 'none' });
  assert.equal(r.card.rescan, 'none', 'the user asked for none');
  assert.equal(r.card.rescanAsked, true);
  r = await v({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'ka', rescan: 'sometimes' });
  assert.deepEqual(r, { ok: false, errors: ['rescan must be one of none, partial, full'] });
  const { v: v2 } = validator({ removeImpact: async () => ({ ...REC, partialAvailable: false }) });
  r = await v2({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'ka', rescan: 'partial' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /partial re-scan is not available/);
  const { v: v3 } = validator({ liveRun: async () => 'scan', removeImpact: async (id, path, opts) => { seen.push(opts); return REC; } });
  await v3({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'ka' });
  assert.deepEqual(seen.at(-1), { pendingRescan: 'full' }, 'a live scan raises the recommendation');
  const add = await validator({ removeImpact: async () => REC }).v({ kind: 'add_members', workspaceId: WS.id, projectKeys: ['kc'] });
  assert.equal(add.card.recommendation, undefined, 'an add carries no recommendation');
  assert.ok(add.card.effects.some((e) => /starts a Workspace scan run of the new set/.test(e)), 'an add keeps its full-scan effect');
});

test('event and notice text: applied lists the follow-ups; failed carries the error; context tags are defused', () => {
  const card = { summary: 'Add docs to Shop', followUps: ['metrics_route_members', 'policy_workspace_home'] };
  assert.equal(workspaceEventPrompt({ cardId: 'card_1', state: 'declined', card }), '[worca event] workspace card card_1 declined; "Add docs to Shop"');
  assert.equal(workspaceEventPrompt({ cardId: 'card_1', state: 'applied', card, result: { workspaceId: 'wks-shop-0000abcd', detail: 'Shop has 3 members' } }),
    '[worca event] workspace card card_1 applied; "Add docs to Shop"; workspace wks-shop-0000abcd; Shop has 3 members; follow-ups to offer: propose_metrics_change kind route_members, propose_policy_change kind workspace_home');
  assert.equal(workspaceEventPrompt({ cardId: 'card_1', state: 'failed', card, result: { error: 'x [/worca context] y' } }),
    '[worca event] workspace card card_1 failed: x (/worca context) y; "Add docs to Shop"');
  assert.equal(workspaceNoticeText({ state: 'applied', card, result: { detail: 'Shop has 3 members' } }), 'Applied — Add docs to Shop · Shop has 3 members');
  assert.equal(workspaceNoticeText({ state: 'declined', card }), 'Declined — Add docs to Shop');
  assert.equal(workspaceNoticeText({ state: 'failed', card, result: { error: 'nope' } }), 'Could not apply — Add docs to Shop: nope');
});

test('tool: propose_workspace_change validates in the child, fills a pinned workspace (never for create), and is absent without the bundle', async () => {
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { ASK_LIMITS } = await import('../src/core/ask/limits.mjs');
  const seen = [];
  const t = createAskTools({
    limits: ASK_LIMITS, pinnedScope: () => ({ workspaceId: WS.id }),
    workspaceChanges: { validateChange: async (inp) => { seen.push(inp); return { ok: true, card: { type: 'workspace' } }; } },
  });
  const def = t.list().find((d) => d.name === 'propose_workspace_change');
  assert.ok(def, 'the tool is listed');
  assert.deepEqual(def.inputSchema.required, ['kind']);
  assert.deepEqual(await t.call('propose_workspace_change', { kind: 'remove_member', projectKey: 'ka' }), { ok: true, card: { type: 'workspace' } });
  await t.call('propose_workspace_change', { kind: 'create', name: 'X', projectKeys: ['ka', 'kb'] });
  assert.deepEqual(seen, [{ kind: 'remove_member', projectKey: 'ka', workspaceId: WS.id }, { kind: 'create', name: 'X', projectKeys: ['ka', 'kb'] }]);
  const bare = createAskTools({ limits: ASK_LIMITS });
  assert.equal(bare.list().some((d) => d.name === 'propose_workspace_change'), false);
});

// ── the route, over the real server (WORCA_MOCK) ─────────────────────────────

let homeDir, prevHome, srv, base, mod, store, ws, projects;
const created = [];
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
function freshRepo() {
  const dir = templateRepo('askws-repo', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
  return dir;
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askws-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  closeDbForTests();
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  projects = [];
  for (let i = 0; i < 4; i++) {
    const dir = await freshRepo();
    const r = await post('/api/projects', { name: `p${i}-${Math.random().toString(16).slice(2, 8)}`, path: dir });
    assert.equal(r.status, 200, await r.clone().text());
    projects.push((await r.json()).projects.find((p) => p.path === dir));
  }
  const r = await post('/api/workspaces', { name: 'Card WS', projectPaths: [projects[0].path, projects[1].path] });
  assert.equal(r.status, 201, await r.clone().text());
  ws = (await r.json()).workspace;
  // A pick-less workspace's members-change auto-rescan answers needsModel by design (the page
  // asks the user). The card tests the auto-re-scan itself, so save a pick the way the page does.
  const pick = await fetch(`${base}/api/workspaces/${ws.id}/scan-models`, {
    method: 'PUT', headers: JSONH, body: JSON.stringify({ workspaceScan: { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'opus', agentEffort: 'xhigh' } }),
  });
  assert.equal(pick.status, 200, `PUT /scan-models: ${(await pick.json()).error || pick.status}`);
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  await stopAndSettle(mod.runs);
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  closeDbForTests();
  for (const d of [homeDir, ...created]) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

/** A thread with one assistant message holding a proposed workspace card. */
async function seedCard(card) {
  const thread = (await (await post('/api/ask/threads', {})).json()).thread;
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', model: 'claude-opus-5-5', effort: 'high' });
  await waitFor(async () => (await snapshot(thread.id)).messages.some((m) => m.role === 'assistant' && m.status === 'done'));
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card: { type: 'workspace', followUps: [], ...card } }] });
  return { threadId: thread.id, cardId };
}
const noticeOf = async (threadId) => (await snapshot(threadId)).messages.filter((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic)).map((m) => m.blocks[0].text);
const readWs = async (id) => (await (await fetch(`${base}/api/workspaces/${id}`)).json()).workspace;

test('route refusals: decline changes nothing (event turn runs), a wrong verb is 400, a live run fails the card and nothing changes', async () => {
  await checkRows([
    { name: 'route: decline changes nothing and runs the event turn; a wrong verb is a 400', run: async () => {
      const { threadId, cardId } = await seedCard({ kind: 'rename', summary: 'Rename Card WS to Nope', change: { workspaceId: ws.id, name: 'Nope' } });
      assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'saved' })).status, 400);
      const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'declined' });
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal((await r.json()).block.state, 'declined');
      assert.deepEqual(await waitFor(async () => { const n = await noticeOf(threadId); return n.length ? n : null; }), ['Declined — Rename Card WS to Nope']);
      assert.equal((await readWs(ws.id)).name, 'Card WS');
      assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' })).status, 409);
    } },
    { name: 'route: a live run of the workspace fails the card, and nothing changes', run: async () => {
      const { threadId, cardId } = await seedCard({ kind: 'add_members', summary: 'Add p3', change: { workspaceId: ws.id, projectPaths: [projects[3].path] } });
      mod.runs.set('live-ws-card', { id: 'live-ws-card', workspaceId: ws.id, status: 'running', kind: 'workspace-run' });
      try {
        const j = await (await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' })).json();
        assert.equal(j.block.state, 'failed');
        assert.match(j.block.error, /run or scan owns it/);
      } finally { mod.runs.delete('live-ws-card'); }
      assert.equal((await readWs(ws.id)).projectPaths.includes(projects[3].path), false);
    } },
  ]);
});

test('route apply: add_members then remove_member, rename and create change the registry (id kept) and run the event turn', async () => {
  await checkRows([
    { name: 'route: apply add_members then remove_member changes the registry, keeps the id, and runs the event turn', run: async () => {
      const add = await seedCard({ kind: 'add_members', summary: 'Add p2 to Card WS', change: { workspaceId: ws.id, projectPaths: [projects[2].path] } });
      let r = await post(`/api/ask/threads/${add.threadId}/cards/${add.cardId}`, { state: 'applied' });
      assert.equal(r.status, 200, await r.clone().text());
      let j = await r.json();
      assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
      assert.equal(j.block.card.result.workspaceId, ws.id);
      assert.equal((await readWs(ws.id)).projectPaths.length, 3);
      const notices = await waitFor(async () => { const n = await noticeOf(add.threadId); return n.length ? n : null; });
      assert.match(notices[0], /^Applied — Add p2 to Card WS · .*re-scanning the workspace/);
      assert.ok(mod.runs.get(j.block.card.result.rescanRunId)?.autoRescan, 'the card started the workspace re-scan');
      await stopAndSettle(mod.runs, (e) => e.autoRescan);

      const del = await seedCard({ kind: 'remove_member', summary: 'Remove p0 from Card WS', rescan: 'full', rescanAsked: true, change: { workspaceId: ws.id, projectPath: projects[0].path } });
      mod._testing.setAutoRescan(false);
      try {
        r = await post(`/api/ask/threads/${del.threadId}/cards/${del.cardId}`, { state: 'applied' });
        j = await r.json();
      } finally { mod._testing.setAutoRescan(true); }
      assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
      assert.equal(j.block.card.result.rescanRunId, undefined, 'the seam skipped the re-scan');
      assert.match(j.block.card.result.detail, /no re-scan \(automatic re-scans are off/);
      const now = await readWs(ws.id);
      assert.equal(now.id, ws.id);
      assert.equal(now.projectPaths.includes(projects[0].path), false);

      // Re-add p0 (removed just above) so a second removal leaves two members. Never p3: the tests
      // below validate adding projects[3] to Card WS and need it to stay a non-member.
      const back0 = await seedCard({ kind: 'add_members', summary: 'Add p0 back to Card WS', change: { workspaceId: ws.id, projectPaths: [projects[0].path] } });
      mod._testing.setAutoRescan(false);
      try { assert.equal((await post(`/api/ask/threads/${back0.threadId}/cards/${back0.cardId}`, { state: 'applied' })).status, 200); }
      finally { mod._testing.setAutoRescan(true); }
      assert.equal((await readWs(ws.id)).projectPaths.length, 3);
      // A user's pick on the card (body.rescan) wins over the proposal; none starts no run and says so on the card.
      const del2 = await seedCard({ kind: 'remove_member', summary: 'Remove p1 from Card WS', rescan: 'full', rescanAsked: false,
        change: { workspaceId: ws.id, projectPath: projects[1].path } });
      r = await post(`/api/ask/threads/${del2.threadId}/cards/${del2.cardId}`, { state: 'applied', rescan: 'none' });
      j = await r.json();
      assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
      assert.equal(j.block.card.result.rescan, 'none', 'the user\'s pick on the card wins over the proposal');
      assert.equal(j.block.card.result.rescanRunId, undefined);
      assert.match(j.block.card.result.detail, /map pruned, not re-scanned/);
      assert.equal([...mod.runs.values()].some((e) => e.workspaceId === ws.id && e.autoRescan && !['done', 'stopped', 'error'].includes(String(e.status).toLowerCase())), false);
      const after2 = await readWs(ws.id);
      assert.deepEqual([...after2.projectPaths].sort(), [projects[0].path, projects[2].path].sort());
      assert.equal(after2.projectPaths.includes(projects[3].path), false, 'p3 stays out for the add_members tests below');

      // A partial pick the recommendation no longer allows at Apply (no stored map: partialAvailable false)
      // falls back to the recommendation — the card applies, it never fails.
      const back1 = await seedCard({ kind: 'add_members', summary: 'Add p1 back to Card WS', change: { workspaceId: ws.id, projectPaths: [projects[1].path] } });
      mod._testing.setAutoRescan(false);
      try {
        assert.equal((await post(`/api/ask/threads/${back1.threadId}/cards/${back1.cardId}`, { state: 'applied' })).status, 200);
        const del3 = await seedCard({ kind: 'remove_member', summary: 'Remove p1 from Card WS', rescan: 'partial', rescanAsked: true,
          change: { workspaceId: ws.id, projectPath: projects[1].path } });
        j = await (await post(`/api/ask/threads/${del3.threadId}/cards/${del3.cardId}`, { state: 'applied', rescan: 'partial' })).json();
      } finally { mod._testing.setAutoRescan(true); }
      assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
      assert.equal(j.block.card.result.rescan, 'full', 'a stale partial pick falls back to the recommendation');
      assert.deepEqual([...(await readWs(ws.id)).projectPaths].sort(), [projects[0].path, projects[2].path].sort());
    } },
    { name: 'route: rename and create apply through the registry', run: async () => {
      const ren = await seedCard({ kind: 'rename', summary: 'Rename Card WS to Renamed WS', change: { workspaceId: ws.id, name: 'Renamed WS' } });
      let j = await (await post(`/api/ask/threads/${ren.threadId}/cards/${ren.cardId}`, { state: 'applied' })).json();
      assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
      assert.equal((await readWs(ws.id)).name, 'Renamed WS');

      const mk = await seedCard({ kind: 'create', summary: 'Create workspace Fresh', change: { name: 'Fresh', projectPaths: [projects[0].path, projects[3].path] } });
      mod._testing.setAutoRescan(false);
      try {
        j = await (await post(`/api/ask/threads/${mk.threadId}/cards/${mk.cardId}`, { state: 'applied' })).json();
      } finally { mod._testing.setAutoRescan(true); }
      assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
      const made = await readWs(j.block.card.result.workspaceId);
      assert.equal(made.name, 'Fresh');
    } },
  ]);
});

test('the parent validator (workspace-deps) reads the real registry and refuses a set another workspace spans', async () => {
  const { validateWorkspaceChange } = await import('../src/core/ask/workspace-deps.mjs');
  const cur = await readWs(ws.id);
  const add = await validateWorkspaceChange({ kind: 'add_members', workspaceId: ws.id, projectKeys: [projects[3].key] });
  assert.equal(add.ok, true, JSON.stringify(add));
  assert.equal(add.card.workspaceName, cur.name);
  const dup = await validateWorkspaceChange({ kind: 'create', name: 'Dup', projectKeys: cur.projectKeys });
  assert.equal(dup.ok, false);
  assert.match(dup.errors[0], /exact project set already exists/);
});

test('automatic re-scans: an ending one tells its page how (superseded says nothing); a resumed one stays automatic', async () => {
  await checkRows([
    { name: 'an automatic re-scan run that ends tells its workspace page how: refreshed, failed, stopped — a superseded one says nothing', run: async () => {
      const { WebSocket } = await import('ws');
      const { EventEmitter } = await import('node:events');
      const sock = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
      const msgs = [];
      sock.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
      await new Promise((res, rej) => { sock.on('open', res); sock.on('error', rej); });
      try {
        const end = (id, { status, outcome = null, superseded = false }) => {
          const orch = Object.assign(new EventEmitter(), { state: { workspaceScan: outcome ? { outcome } : null }, getState: () => ({}) });
          const entry = { id, kind: 'workspace-run', workspaceId: 'wks-shop-0000abcd', status: 'running', autoRescan: true, superseded, orch, events: [], seq: 0 };
          mod.runs.set(id, entry);
          mod._testing.wireRun(entry);
          orch.emit('done', { status });
          mod.runs.delete(id);
        };
        end('auto-1', { status: 'done', outcome: 'updated' });
        end('auto-2', { status: 'done', outcome: 'failed' });
        end('auto-3', { status: 'stopped' });
        end('auto-4', { status: 'stopped', superseded: true });
        end('auto-5', { status: 'error' });
        const seen = await waitFor(async () => {
          const got = msgs.filter((m) => m.type === 'workspaces-changed' && m.workspaceId === 'wks-shop-0000abcd');
          return got.length >= 4 ? got : null;
        });
        assert.deepEqual(seen.map((m) => [m.runId, m.action]), [
          ['auto-1', 'description'], ['auto-2', 'rescan-failed'], ['auto-3', 'rescan-stopped'], ['auto-5', 'rescan-failed'],
        ]);
      } finally { sock.close(); }
    } },
    { name: 'a resumed automatic re-scan stays automatic: it is tagged again and its page follows the new run', run: async () => {
      const { WebSocket } = await import('ws');
      const sock = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
      const msgs = [];
      sock.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
      await new Promise((res, rej) => { sock.on('open', res); sock.on('error', rej); });
      const W = 'wks-shop-0000abcd';
      try {
        mod.runs.set('auto-old', { id: 'auto-old', kind: 'workspace-run', workspaceId: W, pipelineId: 'feed0001', status: 'paused', autoRescan: true, events: [] });
        mod.runs.set('user-old', { id: 'user-old', kind: 'workspace-run', workspaceId: W, pipelineId: 'feed0002', status: 'paused', events: [] });
        const resumed = { id: 'auto-new', kind: 'workspace-run', workspaceId: W, pipelineId: 'feed0001', status: 'starting', events: [] };
        const other = { id: 'user-new', kind: 'workspace-run', workspaceId: W, pipelineId: 'feed0002', status: 'starting', events: [] };
        mod._testing.markResumedRescan(resumed);
        mod._testing.markResumedRescan(other);
        assert.equal(resumed.autoRescan, true, 'the lineage was an automatic re-scan');
        assert.equal(other.autoRescan, undefined, 'a run the user started stays theirs');
        const seen = await waitFor(async () => msgs.find((m) => m.type === 'workspaces-changed' && m.action === 'rescan-resumed') || null);
        assert.deepEqual([seen.workspaceId, seen.runId], [W, 'auto-new']);
        assert.equal(msgs.filter((m) => m.action === 'rescan-resumed').length, 1);
      } finally {
        sock.close();
        mod.runs.delete('auto-old'); mod.runs.delete('user-old');
      }
    } },
  ]);
});

test('the parent validator reads live runs from pipeline rows: a running or PAUSED Workspace scan owns the workspace (warns), any other run does not', async () => {
  await checkRows([
    { name: 'the parent validator reads live runs from the pipeline rows: a running Workspace scan vs any other run', run: async () => {
      const { validateWorkspaceChange } = await import('../src/core/ask/workspace-deps.mjs');
      const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
      const { getDb } = await import('../src/core/db.mjs');
      const cur = await readWs(ws.id);
      const warn = async () => (await validateWorkspaceChange({ kind: 'add_members', workspaceId: ws.id, projectKeys: [projects[3].key] })).card.warnings.join('\n');
      const row = (id, wf) => seedPipelineRow({ id, projectKey: cur.projectKeys[0], workspaceKey: ws.id, target: 'workspace', status: 'running',
        startedAt: new Date().toISOString(), stepper: { version: 2, template: { id: wf, name: wf } } });
      try {
        row('5ca50001', 'wf_workspace_scan');
        assert.match(await warn(), /A Workspace scan of .* is running/);
        row('5ca50002', 'wf_default');
        assert.match(await warn(), /A run of .* is live/);
      } finally {
        getDb().prepare("DELETE FROM pipelines WHERE id IN ('5ca50001', '5ca50002')").run();
      }
    } },
    { name: 'a PAUSED Workspace scan still owns the workspace (it resumes into it): the card warns, as the apply guard refuses', run: async () => {
      const { validateWorkspaceChange } = await import('../src/core/ask/workspace-deps.mjs');
      const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
      const { getDb } = await import('../src/core/db.mjs');
      const cur = await readWs(ws.id);
      const warn = async () => (await validateWorkspaceChange({ kind: 'add_members', workspaceId: ws.id, projectKeys: [projects[3].key] })).card.warnings.join('\n');
      const row = (id, wf) => seedPipelineRow({ id, projectKey: cur.projectKeys[0], workspaceKey: ws.id, target: 'workspace', status: 'paused',
        startedAt: new Date().toISOString(), stepper: { version: 2, template: { id: wf, name: wf } } });
      // The route tests above re-scan this workspace (mock runs): let those settle first.
      await waitFor(async () => !getDb().prepare("SELECT 1 FROM pipelines WHERE workspace_key = ? AND status IN ('created', 'starting', 'running', 'pausing', 'paused')").get(ws.id), 120000);
      try {
        row('5ca50011', 'wf_default');
        assert.doesNotMatch(await warn(), /A (Workspace scan|run) of/, 'a paused ordinary run holds nothing (ownsWorkspaceTarget)');
        row('5ca50012', 'wf_workspace_scan');
        assert.match(await warn(), /A Workspace scan of .* (is running|is paused)/);
      } finally {
        getDb().prepare("DELETE FROM pipelines WHERE id IN ('5ca50011', '5ca50012')").run();
      }
    } },
  ]);
});

test('a Folder project joins a create card; its member row carries vcs none (Git rows unchanged)', async () => {
  const { v } = validator({ listProjects: async () => [...PROJECTS, { key: 'kn', name: 'notes', path: '/r/notes', vcs: 'none' }] });
  const r = await v({ kind: 'create', name: 'Mixed', projectKeys: ['ka', 'kn'] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.members, [{ key: 'ka', name: 'api', path: '/r/api' }, { key: 'kn', name: 'notes', path: '/r/notes', vcs: 'none' }]);
});

test('a remove_member card for a Folder member carries vcs none (its Remove row shows the Folder chip); a Git member\'s does not', async () => {
  const { v } = validator({ listProjects: async () => PROJECTS.map((p) => (p.key === 'kb' ? { ...p, vcs: 'none' } : p)) });
  const r = await v({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'kb' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.removed, { key: 'kb', name: 'web', path: '/r/web', vcs: 'none' });
  assert.deepEqual((await v({ kind: 'remove_member', workspaceId: WS.id, projectKey: 'ka' })).card.removed, { key: 'ka', name: 'api', path: '/r/api' });
});
