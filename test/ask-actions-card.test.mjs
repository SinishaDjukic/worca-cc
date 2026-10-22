// test/ask-actions-card.test.mjs
// Ask Worca and Actions (docs/actions.md "Chat"): the card's validator (pure, over injected
// readers), the event/notice text, the five tools (read-only + propose; no start/stop tool exists),
// the registry's state file the tools read from another process, the deployment line,
// and the card route over WORCA_MOCK — decline, apply a project config, apply stacks, a refusal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import {
  createActionsChangeValidator, actionsEventPrompt, actionsNoticeText, actionsProposalInput, describeAction, ACTIONS_CHANGE_KINDS,
} from '../src/core/ask/actions-proposal.mjs';
import { normalizeProjectActions } from '../src/core/actions/model.mjs';
import { ActionRegistry, readActionsState } from '../src/core/actions/registry.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

// ── the validator (pure) ─────────────────────────────────────────────────────

const PROJECTS = [{ key: 'web-0000aaaa', name: 'web', path: '/r/web' }, { key: 'api-0000bbbb', name: 'api', path: '/r/api' }];
const RUN = { id: 'run', label: 'Run', kind: 'service', cmd: 'npm start', env: [{ name: 'PORT', type: 'port', value: 'auto' }],
  openUrl: 'http://localhost:{PORT}', ready: { kind: 'port', port: 'PORT' } };
const TEST = { id: 'test', label: 'Test', kind: 'task', cmd: 'npm test' };
const WS = { id: 'wks-shop-0000abcd', name: 'Shop' };
const MEMBERS = [{ projectKey: 'api-0000bbbb', name: 'api' }, { projectKey: 'web-0000aaaa', name: 'web' }];

function validator({ stored = {}, stacks = [], using = [] } = {}) {
  return createActionsChangeValidator({
    listProjects: async () => PROJECTS,
    readProjectActions: (key) => normalizeProjectActions(stored[key] || {}),
    readWorkspace: async (id) => (id === WS.id ? WS : null),
    workspaceMembers: async (id) => (id === WS.id ? MEMBERS : null),
    readWorkspaceStacks: () => stacks,
    stacksUsing: async () => using,
    redact: redactAskText,
  });
}

test('kinds and project refusals: only project/stacks; no key, unknown key, no action list, nothing to change and the model\'s own field errors are refused', async () => {
  await checkRows([
    { name: 'kinds: project and stacks; anything else is refused', run: async () => {
      assert.deepEqual([...ACTIONS_CHANGE_KINDS], ['project', 'stacks']);
      assert.deepEqual(await validator()({ kind: 'start' }), { ok: false, errors: ['kind must be one of project, stacks'] });
    } },
    { name: 'project refusals: no key, unknown key, no action list, nothing to change, and the model\'s own field errors', run: async () => {
      const v = validator({ stored: { 'web-0000aaaa': { actions: [TEST] } } });
      assert.match((await v({ kind: 'project' })).errors[0], /projectKey is required/);
      assert.match((await v({ kind: 'project', projectKey: 'nope-00000000', actions: [] })).errors[0], /unknown projectKey/);
      assert.match((await v({ kind: 'project', projectKey: 'web-0000aaaa' })).errors[0], /actions is required/);
      assert.match((await v({ kind: 'project', projectKey: 'web-0000aaaa', actions: [TEST] })).errors[0], /nothing would change/);
      const bad = await v({ kind: 'project', projectKey: 'web-0000aaaa', actions: [{ ...TEST, cwd: '../up' }] });
      assert.deepEqual(bad, { ok: false, errors: ['the working directory must stay inside the worktree (actions[0].cwd)'] });
      const link = await v({ kind: 'project', projectKey: 'web-0000aaaa', actions: [{ ...RUN, openUrl: 'javascript:alert(1)' }] });
      assert.match(link.errors[0], /http:\/\/ or https:\/\//);
    } },
  ]);
});

test('project card: a first config adds setup + every action with its command; a change, a removal and a built-in switched off name the stacks that start a removed action', async () => {
  await checkRows([
    { name: 'project: a first config adds the setup and each action, with every command on the card', run: async () => {
      const r = await validator()({ kind: 'project', projectKey: 'web-0000aaaa', setup: 'npm ci', actions: [RUN, TEST], note: 'from package.json' });
      assert.equal(r.ok, true, JSON.stringify(r));
      const c = r.card;
      assert.equal(c.type, 'actions');
      assert.equal(c.summary, 'Set up actions for web');
      assert.equal(c.note, 'from package.json');
      assert.deepEqual(c.changes.map((x) => [x.op, x.label]), [['add', 'Setup'], ['add', 'Run'], ['add', 'Test']]);
      assert.equal(c.changes[0].after, 'npm ci');
      assert.match(c.changes[1].after, /^npm start\nservice · ready when port PORT answers \(60 s\)\nPORT = port \(automatic\)\nopen http:\/\/localhost:\{PORT\}$/);
      assert.match(c.effects[0], /only when a person clicks Start/);
      assert.deepEqual(c.change.config.actions.map((a) => a.id), ['run', 'test']);
      assert.equal(c.change.config.setup, 'npm ci');
    } },
    { name: 'project: a change, a removal and a built-in switched off; stacks that start a removed action are named', run: async () => {
      const v = validator({ stored: { 'web-0000aaaa': { setup: 'npm ci', actions: [RUN, TEST] } },
        using: [{ workspaceId: WS.id, workspaceName: 'Shop', stackId: 'qa', label: 'QA', actions: ['test'] }] });
      const r = await v({ kind: 'project', projectKey: 'web-0000aaaa', actions: [{ ...RUN, cmd: 'npm run dev' }], builtins: { terminal: false } });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.card.summary, 'Change the actions of web');
      assert.deepEqual(r.card.changes.map((x) => [x.op, x.label]), [['change', 'Run'], ['remove', 'Test'], ['change', 'Built-in terminal']]);
      assert.match(r.card.changes[0].before, /^npm start\n/);
      assert.match(r.card.changes[0].after, /^npm run dev\n/);
      assert.equal(r.card.change.config.setup, 'npm ci', 'setup left out keeps the stored one');
      assert.equal(r.card.change.config.builtins.terminal, false);
      assert.equal(r.card.change.config.builtins.editor, true);
      assert.deepEqual(r.card.warnings, ['Stack "QA" of workspace Shop starts test — change that stack too, or it stops working']);
    } },
  ]);
});

test('redaction: an action sent back redacted but unchanged keeps the stored secret; a changed one is refused', async () => {
  const secret = 'sk-ant-abcdefghijklmnopqrstuvwxyz012345';
  const SEEDED = { ...TEST, env: [{ name: 'ANTHROPIC_API_KEY', type: 'text', value: secret }] };
  const v = validator({ stored: { 'web-0000aaaa': { setup: `curl -H "x: ${secret}" x`, actions: [SEEDED] } } });
  const shown = redactAskText(secret);
  assert.notEqual(shown, secret);
  const back = { ...SEEDED, env: [{ name: 'ANTHROPIC_API_KEY', type: 'text', value: shown }] };
  const r = await v({ kind: 'project', projectKey: 'web-0000aaaa', setup: `curl -H "x: ${shown}" x`, actions: [back, RUN] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.card.change.config.actions[0].env[0].value, secret, 'the stored value, never the marker');
  assert.equal(r.card.change.config.setup, `curl -H "x: ${secret}" x`);
  const changed = await v({ kind: 'project', projectKey: 'web-0000aaaa', actions: [{ ...back, cmd: 'npm run test:ci' }] });
  assert.match(changed.errors[0], /action "test" holds a redacted value/);
  const setup = await v({ kind: 'project', projectKey: 'web-0000aaaa', setup: `npm ci ${shown}`, actions: [back] });
  assert.match(setup.errors[0], /setup command holds a redacted value/);
});

test('stacks card names members/actions by key with aliases; describeAction (task, ready, cwd, Windows command)', async () => {
  await checkRows([
    { name: 'stacks: steps name members by key and actions by id; the card names members with their alias', run: async () => {
      const v = validator({ stored: { 'api-0000bbbb': { actions: [RUN] }, 'web-0000aaaa': { actions: [RUN, TEST] } } });
      const stack = { id: 'dev', label: 'Dev', kind: 'service', steps: [
        { member: 'api-0000bbbb', action: 'run' },
        { member: 'web-0000aaaa', action: 'run', env: [{ name: 'API_URL', value: 'http://localhost:{api.PORT}' }] }] };
      const r = await v({ kind: 'stacks', workspaceId: WS.id, stacks: [stack] });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.card.summary, 'Add stacks to Shop');
      assert.equal(r.card.changes[0].after, 'service stack\n1. api (api) › run\n2. web (web) › run (API_URL=http://localhost:{api.PORT})');
      assert.deepEqual(r.card.change, { workspaceId: WS.id, stacks: [{ ...stack, steps: [{ ...stack.steps[0], env: [] }, { ...stack.steps[1], env: [{ name: 'API_URL', type: 'text', value: 'http://localhost:{api.PORT}' }] }] }] });
      assert.match((await v({ kind: 'stacks', workspaceId: WS.id, stacks: [{ ...stack, steps: [{ member: 'api-0000bbbb', action: 'lint' }] }] })).errors[0], /"lint" is not an action of that project/);
      assert.match((await v({ kind: 'stacks', workspaceId: 'wks-nope-00000000', stacks: [] })).errors[0], /unknown workspace/);
      assert.match((await v({ kind: 'stacks', workspaceId: WS.id, stacks: [{ ...stack, steps: [{ ...stack.steps[0], env: [{ name: 'K', value: '<redacted>' }] }] }] })).errors[0], /redacted value/);
    } },
    { name: 'describeAction: task, output ready, cwd and the Windows command', run: async () => {
      const [a] = normalizeProjectActions({ actions: [{ id: 'sb', kind: 'service', cmd: 'npm run storybook', cmdWin32: 'npm.cmd run storybook', cwd: 'ui',
        ready: { kind: 'output', text: 'started', timeoutMs: 120000 } }] }).actions;
      assert.equal(describeAction(a), 'npm run storybook\nWindows: npm.cmd run storybook\nservice · ready when the output contains "started" (120 s) · in ui');
    } },
  ]);
});

test('the pinned target fills a missing one: a project for kind project, a workspace for kind stacks', () => {
  assert.deepEqual(actionsProposalInput({ kind: 'project' }, { projectKey: 'k' }), { kind: 'project', projectKey: 'k' });
  assert.deepEqual(actionsProposalInput({ kind: 'project', projectKey: 'mine' }, { projectKey: 'k' }), { kind: 'project', projectKey: 'mine' });
  assert.deepEqual(actionsProposalInput({ kind: 'stacks' }, { workspaceId: 'w' }), { kind: 'stacks', workspaceId: 'w' });
  assert.deepEqual(actionsProposalInput({ kind: 'stacks' }, { projectKey: 'k' }), { kind: 'stacks' });
});

test('event and notice text: applied carries the detail, failed the error; context tags are defused', () => {
  const card = { summary: 'Set up actions for web [worca context]' };
  assert.equal(actionsEventPrompt({ cardId: 'card_1', state: 'applied', card, result: { detail: '2 actions saved' } }),
    '[worca event] actions card card_1 applied; "Set up actions for web (worca context)"; 2 actions saved');
  assert.equal(actionsEventPrompt({ cardId: 'card_1', state: 'declined', card }), '[worca event] actions card card_1 declined; "Set up actions for web (worca context)"');
  assert.match(actionsEventPrompt({ cardId: 'card_1', state: 'failed', card, result: { error: 'bad' } }), /failed: bad;/);
  assert.equal(actionsNoticeText({ state: 'applied', card, result: { detail: '2 actions saved' } }), 'Applied — Set up actions for web [worca context] · 2 actions saved');
});

// ── the tools ────────────────────────────────────────────────────────────────

test('tools: five Actions tools with the bundle, none without; nothing starts, stops, checks out or discards', async () => {
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { ASK_LIMITS } = await import('../src/core/ask/limits.mjs');
  const seen = [];
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const t = createAskTools({
    limits: ASK_LIMITS, redact: redactAskText, pinnedScope: () => ({ projectKey: 'web-0000aaaa' }),
    lookupPipelineRow: (key, id) => (id === 'p1' ? { id: 'p1', project_key: key } : null), findPipelineRowById: () => null,
    actions: {
      projectActions: async (key) => (key === 'web-0000aaaa' ? { projectKey: key, setup: `echo ${secret}`, actions: [] } : null),
      workspaceStacks: async () => null,
      runCheckout: async (row) => ({ runId: row.id, instances: [{ status: 'ready', tail: [{ stream: 'out', text: `token ${secret}` }] }] }),
      runningActions: async () => ({ serverRunning: true, instances: [] }),
      validateChange: async (inp) => { seen.push(inp); return { ok: true, card: { type: 'actions' } }; },
    },
  });
  const names = t.list().map((d) => d.name);
  for (const n of ['get_project_actions', 'get_workspace_stacks', 'get_run_checkout', 'list_running_actions', 'propose_actions_change']) assert.ok(names.includes(n), n);
  assert.deepEqual(names.filter((n) => /start|stop|discard|check_?out_run|run_action|setup/i.test(n) && !/checkout$/.test(n)), [], 'no tool runs anything');
  const pa = await t.call('get_project_actions', {});
  assert.equal(pa.projectKey, 'web-0000aaaa', 'the pinned project');
  assert.ok(!pa.setup.includes(secret), 'commands are redacted');
  const rc = await t.call('get_run_checkout', { id: 'p1', projectKey: 'web-0000aaaa' });
  assert.ok(!rc.instances[0].tail[0].text.includes(secret), 'log lines are redacted');
  await assert.rejects(t.call('get_workspace_stacks', {}), /workspaceId is required/);
  await assert.rejects(t.call('get_project_actions', { projectKey: 'nope-00000000' }), /unknown projectKey/);
  await t.call('propose_actions_change', { kind: 'project', actions: [] });
  assert.deepEqual(seen, [{ kind: 'project', actions: [], projectKey: 'web-0000aaaa' }]);
  const bare = createAskTools({ limits: ASK_LIMITS });
  assert.equal(bare.list().some((d) => /actions|checkout|stacks/.test(d.name)), false);
});

// ── the registry's state file (read from another process) ─────────────────────

test('state file: an instance with its status, ports and log tail; a dead server reads as nothing running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-act-state-'));
  try {
    const stateFile = join(dir, 'state.json');
    const reg = new ActionRegistry({ pidFile: join(dir, 'live.json'), stateFile });
    const [action] = normalizeProjectActions({ actions: [{ id: 'hello', kind: 'task', cmd: 'echo hello-from-action' }] }).actions;
    const snap = await reg.start({ runId: 'r1', member: 'm1', worktreeDir: dir, branch: 'feat', action });
    await reg.waitFor(snap.instanceId, (s) => s.status === 'exited');
    await new Promise((r) => setTimeout(r, 650));          // the debounced write after the last line
    const st = readActionsState(stateFile);
    assert.equal(st.serverRunning, true);
    const inst = st.instances.find((s) => s.instanceId === snap.instanceId);
    assert.equal(inst.status, 'exited');
    assert.equal(inst.exitCode, 0);
    assert.ok(inst.tail.some((l) => l.stream === 'sys' && /echo hello-from-action/.test(l.text)), 'the command line');
    assert.ok(inst.tail.some((l) => l.text === 'hello-from-action'), 'the output');

    const doc = JSON.parse(await readFile(stateFile, 'utf8'));
    await writeFile(stateFile, JSON.stringify({ ...doc, ownerPid: 2 ** 22 + 7, instances: [{ ...inst, status: 'ready' }] }));
    const gone = readActionsState(stateFile, { isAlive: () => false });
    assert.equal(gone.serverRunning, false);
    assert.equal(gone.instances[0].status, 'stopped', 'its processes went with the server');
    assert.deepEqual(readActionsState(join(dir, 'missing.json')), { serverRunning: false, instances: [] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ── the prompt ───────────────────────────────────────────────────────────────

test('deployment header: actions=off is rendered only when actions are off', async () => {
  const { buildContextHeader } = await import('../src/core/ask/prompt.mjs');
  const head = buildContextHeader({ now: '2026-10-02T10:00:00Z', deployment: { deployment: 'hosted', projectsRoot: '/data/projects', github: 'app', actions: 'off' } });
  assert.match(head, /deployment: hosted projects root \/data\/projects github=app actions=off/);
  const on = buildContextHeader({ now: '2026-10-02T10:00:00Z', deployment: { deployment: 'hosted', projectsRoot: '/data/projects', github: 'app' } });
  assert.doesNotMatch(on, /actions=/);
});

// ── the route, over the real server (WORCA_MOCK) ─────────────────────────────

let homeDir, prevHome, srv, base, mod, store, project, ws;
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
  const dir = templateRepo('askact-repo', { branch: 'main', user: true,
    files: { 'package.json': '{"scripts":{"start":"node server.js","test":"node -e 1"}}\n' } });
  created.push(dir);
  return dir;
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askact-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  closeDbForTests();
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const dirs = [await freshRepo(), await freshRepo()];
  const projects = [];
  for (const dir of dirs) {
    const r = await post('/api/projects', { name: `p-${Math.random().toString(16).slice(2, 8)}`, path: dir });
    assert.equal(r.status, 200, await r.clone().text());
    projects.push((await r.json()).projects.find((p) => p.path === dir));
  }
  project = projects[0];
  const r = await post('/api/workspaces', { name: 'Act WS', projectPaths: dirs });
  assert.equal(r.status, 201, await r.clone().text());
  ws = (await r.json()).workspace;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  for (const [rid, r] of mod.runs) if (r.autoRescan) { try { r.orch.stop(); } catch { /* reap */ } mod.runs.delete(rid); }
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

async function seedCard(card) {
  const thread = (await (await post('/api/ask/threads', {})).json()).thread;
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', model: 'claude-opus-5-5', effort: 'high' });
  await waitFor(async () => (await snapshot(thread.id)).messages.some((m) => m.role === 'assistant' && m.status === 'done'));
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card: { type: 'actions', changes: [], warnings: [], effects: [], ...card } }] });
  return { threadId: thread.id, cardId };
}
const noticeOf = async (threadId) => (await snapshot(threadId)).messages.filter((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic)).map((m) => m.blocks[0].text);
const storedActions = async (key) => (await (await fetch(`${base}/api/projects/${key}/actions`)).json()).config;

test('route: decline stores nothing; apply stores the project config through the same validation; a stack card applies against the members\' current actions and a stale one fails storing nothing', async () => {
  await checkRows([
    { name: 'route: decline stores nothing; apply stores the project config through the same validation; then it is applied', run: async () => {
      const config = { setup: 'npm ci', actions: [RUN, TEST] };
      const d = await seedCard({ kind: 'project', summary: 'Set up actions for p', projectKey: project.key, change: { projectKey: project.key, config } });
      assert.equal((await post(`/api/ask/threads/${d.threadId}/cards/${d.cardId}`, { state: 'started' })).status, 400);
      let r = await post(`/api/ask/threads/${d.threadId}/cards/${d.cardId}`, { state: 'declined' });
      assert.equal((await r.json()).block.state, 'declined');
      assert.deepEqual(await waitFor(async () => { const n = await noticeOf(d.threadId); return n.length ? n : null; }), ['Declined — Set up actions for p']);
      assert.deepEqual((await storedActions(project.key)).actions, []);

      const a = await seedCard({ kind: 'project', summary: 'Set up actions for p', projectKey: project.key, change: { projectKey: project.key, config } });
      r = await post(`/api/ask/threads/${a.threadId}/cards/${a.cardId}`, { state: 'applied' });
      assert.equal(r.status, 200, await r.clone().text());
      const j = await r.json();
      assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
      assert.equal(j.block.card.result.detail, '2 actions and a setup command saved');
      const saved = await storedActions(project.key);
      assert.equal(saved.setup, 'npm ci');
      assert.deepEqual(saved.actions.map((x) => x.id), ['run', 'test']);
      assert.deepEqual(await waitFor(async () => { const n = await noticeOf(a.threadId); return n.length ? n : null; }), ['Applied — Set up actions for p · 2 actions and a setup command saved']);
      assert.equal((await post(`/api/ask/threads/${a.threadId}/cards/${a.cardId}`, { state: 'applied' })).status, 409, 'applied once');
    } },
    { name: 'route: a stack card is applied against the members\' current actions; a stale one fails and stores nothing', run: async () => {
      const stacks = [{ id: 'dev', label: 'Dev', kind: 'service', steps: [{ member: project.key, action: 'run', env: [] }] }];
      const ok = await seedCard({ kind: 'stacks', summary: 'Add stacks to Act WS', workspaceId: ws.id, change: { workspaceId: ws.id, stacks } });
      let j = await (await post(`/api/ask/threads/${ok.threadId}/cards/${ok.cardId}`, { state: 'applied' })).json();
      assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
      assert.equal(j.block.card.result.detail, '1 stack saved');
      assert.deepEqual((await (await fetch(`${base}/api/workspaces/${ws.id}/actions`)).json()).stacks.map((s) => s.id), ['dev']);

      const stale = [{ id: 'qa', label: 'QA', kind: 'task', steps: [{ member: project.key, action: 'lint', env: [] }] }];
      const bad = await seedCard({ kind: 'stacks', summary: 'Change the stacks of Act WS', workspaceId: ws.id, change: { workspaceId: ws.id, stacks: stale } });
      j = await (await post(`/api/ask/threads/${bad.threadId}/cards/${bad.cardId}`, { state: 'applied' })).json();
      assert.equal(j.block.state, 'failed');
      assert.match(j.block.error, /"lint" is not an action of that project/);
      assert.deepEqual((await (await fetch(`${base}/api/workspaces/${ws.id}/actions`)).json()).stacks.map((s) => s.id), ['dev'], 'unchanged');
    } },
  ]);
});

test('the real deps: the parent validator and get_run_checkout read the stored config and the run rows', async () => {
  const { validateActionsChange, defaultActionsDeps } = await import('../src/core/ask/actions-deps.mjs');
  const r = await validateActionsChange({ kind: 'project', projectKey: project.key, actions: [RUN] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card.changes.map((x) => [x.op, x.label]), [['remove', 'Test']]);
  assert.deepEqual(r.card.warnings, [], 'the Dev stack starts run, which stays');
  const r2 = await validateActionsChange({ kind: 'project', projectKey: project.key, actions: [TEST] });
  assert.match(r2.card.warnings[0], /^Stack "Dev" of workspace Act WS starts run/);
  const deps = defaultActionsDeps().actions;
  const pa = await deps.projectActions(project.key);
  assert.deepEqual(pa.stacksUsingIt.map((s) => s.stackId), ['dev']);
  assert.deepEqual((await deps.workspaceStacks(ws.id)).members.map((m) => m.alias).length, 2);
  assert.deepEqual(await deps.runningActions(), { serverRunning: false, instances: [] });
});
