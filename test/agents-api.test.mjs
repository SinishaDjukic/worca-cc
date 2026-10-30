// test/agents-api.test.mjs — /api/agents CRUD route surface.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

let srv, base, homeDir, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-agentsapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const put = (p, b) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(b) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });

const META = {
  metaVersion: 2, displayName: 'Docs Writer', description: 'writes docs', color: 'green',
  runnerType: 'producer', order: 42,
  inputs: [{ id: 'plan', type: 'md' }],
  outputs: [{ id: 'review', type: 'md', filename: 'docs-review.md' }],
};
const MD = '# Agent: Docs Writer\n\nYou write docs.\n';

test('GET /api/agents: origin, mockWriterRoles, v2 port fields, no markdown, workspace-only gated', async () => {
  await checkRows([
    { name: 'GET /api/agents carries origin + mockWriterRoles and EXCLUDES markdown', run: async () => {
      const r = await get('/api/agents');
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.ok(Array.isArray(data.agents) && data.agents.length >= 9);
      assert.ok(data.agents.every((a) => a.origin === 'builtin' || a.origin === 'user'));
      assert.ok(data.agents.every((a) => !('markdown' in a)));
      // mockWriterRoles is a CLOSED list (the mock switch in claude-runner.mjs),
      // unlike the open channel vocabulary it will replace in Task 12.
      assert.equal(data.channels, undefined, 'the channel vocabulary is gone from this payload');
      assert.ok(Array.isArray(data.mockWriterRoles));
      assert.ok(data.mockWriterRoles.includes('generic-verifier') && data.mockWriterRoles.includes('clarify'));
      assert.ok(!data.agents.some((a) => a.key === 'workspaceScanner'), 'workspace-only excluded by default');
      const all = await (await get('/api/agents?all=1')).json();
      assert.ok(all.agents.some((a) => a.key === 'workspaceScanner'), '?all=1 includes workspace-only');
    } },
    // A REGRESSION PIN on the seed data: the builtin sidecars carry v2 ports
    // (P1 seeded them).
    { name: 'GET /api/agents carries the v2 port fields the composer and the editor need', run: async () => {
      const { agents } = await (await get('/api/agents')).json();
      const planner = agents.find((a) => a.key === 'planner');
      assert.equal(planner.metaVersion, 2);
      assert.ok(Array.isArray(planner.inputs) && planner.inputs.some((p) => p.id === 'task'));
      assert.ok(Array.isArray(planner.outputs) && planner.outputs.some((p) => p.id === 'plan'));
      assert.equal(typeof planner.portSummary, 'string');
      assert.ok(planner.portSummary.length > 0);
    } },
  ]);
});

test('POST -> 201, GET :key (full incl. markdown), PUT, DELETE round-trip', async () => {
  const c = await post('/api/agents', { meta: META, markdown: MD });
  assert.equal(c.status, 201);
  const created = await c.json();
  assert.equal(created.meta.key, 'docsWriter');
  assert.equal(created.meta.origin, 'user');

  const g = await get('/api/agents/docsWriter');
  assert.equal(g.status, 200);
  assert.equal((await g.json()).markdown, MD);

  const u = await put('/api/agents/docsWriter', { meta: { ...META, displayName: 'Docs v2' }, markdown: MD + 'x\n' });
  assert.equal(u.status, 200);
  assert.equal((await u.json()).meta.displayName, 'Docs v2');

  const d = await del('/api/agents/docsWriter');
  assert.equal(d.status, 200);
  assert.equal((await get('/api/agents/docsWriter')).status, 404);
});

test('built-in guardrails: PUT/DELETE planner -> 409, duplicate POST -> 409, bad body -> 400', async () => {
  assert.equal((await put('/api/agents/planner', { meta: META })).status, 409);
  const delB = await del('/api/agents/planner');
  assert.equal(delB.status, 409);
  assert.match((await delB.json()).error, /duplicate it/i);
  await post('/api/agents', { meta: META, markdown: MD });
  assert.equal((await post('/api/agents', { meta: META, markdown: MD })).status, 409);
  assert.equal((await post('/api/agents', { meta: META, markdown: '' })).status, 400);
  assert.equal((await get('/api/agents/..%2Fetc')).status, 404);
  await del('/api/agents/docsWriter');
});

test('DELETE a workflow-referenced agent -> 409; POST /api/workflows accepts a user-agent key', async () => {
  await post('/api/agents', { meta: META, markdown: MD });
  // POST /api/workflows takes ONLY a v2 graph now. docsWriter consumes `plan`
  // and produces `review`, so the graph needs a planner upstream of it.
  const wf = await post('/api/workflows', {
    version: 2, name: 'Uses Docs', domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_docs', kind: 'agent', key: 'docsWriter', x: 600, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_docs', port: 'plan' } },
      { id: 'w3', from: { node: 'n_docs', port: 'review' }, to: { node: 'n_end', port: 'result' } }],
  });
  assert.equal(wf.status, 201, 'user agent validates in a workflow');
  const r = await del('/api/agents/docsWriter');
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Uses Docs/);
});

test('POST /api/agents answers 422 with a per-path error list for a bad ask form', async () => {
  const res = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      markdown: '# asker\n',
      meta: {
        metaVersion: 2, key: 'apiAskBad', displayName: 'Asker', runnerType: 'producer',
        inputs: [{ id: 'task', type: 'md' }],
        outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
        ask: { forms: { 'pick-one': {
          version: 1, title: 'Pick one',
          data: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
          answer: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['yes', 'no'] } } },
          layout: [{ widget: 'grid', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' }],
          example: { summary: 'Something happened.' },
        } } },
      },
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(Array.isArray(body.errors) && body.errors.length >= 1, JSON.stringify(body));
  assert.match(body.errors[0].path, /^ask\.forms\."pick-one"/);
  assert.equal(typeof body.errors[0].code, 'string');
  assert.equal(typeof body.errors[0].message, 'string');
});

test('PUT /api/agents/:key answers 422 the same way, and 400 keeps its old body', async () => {
  const create = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      markdown: '# asker\n',
      meta: {
        metaVersion: 2, key: 'apiAskPut', displayName: 'Asker', runnerType: 'producer',
        inputs: [{ id: 'task', type: 'md' }],
        outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
      },
    }),
  });
  assert.equal(create.status, 201);

  const bad = await fetch(`${base}/api/agents/apiAskPut`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta: { metaVersion: 2, ask: { forms: { 'Not An Id': { version: 1 } } } } }),
  });
  assert.equal(bad.status, 422);
  assert.ok(Array.isArray((await bad.json()).errors));

  // A plain meta rule is still a 400 with ONLY { error } — no `errors` key.
  const plain = await fetch(`${base}/api/agents/apiAskPut`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta: { metaVersion: 2, runnerType: 'nonsense' } }),
  });
  assert.equal(plain.status, 400);
  assert.equal((await plain.json()).errors, undefined);
});

// ── FEAT-1: per-agent MCP servers and skills — capabilities, run-check, review flag ─────────────────────────
const cap = {};   // shared fixture of the three tests below, built on first use

async function capFixture() {
  if (cap.key) return cap;
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, realpathSync } = await import('node:fs');
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const store = await import('../src/core/mcp/store.mjs');
  const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { stdio: 'ignore' });
  const mk = async (tag) => realpathSync(await mkdtemp(join(tmpdir(), `agents-cap-${tag}-`)));
  // Git project: `.mcp.json` has `committed` (committed, unchanged => the run drops it until Claude approves it) and `wip`
  // (added after the commit => untracked edit, provided). The user's LOCAL scope has `mine`; the top-level `mcpServers` has `userwide`.
  const dir = await mk('git');
  git(dir, 'init', '-q');
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { committed: { command: 'x' } } }));
  git(dir, 'add', '.mcp.json'); git(dir, 'commit', '-qm', 'init');
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { committed: { command: 'x' }, wip: { command: 'y' } } }));
  // Folder project: its single `.mcp.json` server is unapproved (the run copies the real-dir file as its "committed" copy).
  const folder = await mk('folder');
  writeFileSync(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { fsrv: { command: 'z' } } }));
  const prevHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'agents-cap-home-'));
  process.env.HOME = home;
  writeFileSync(join(home, '.claude.json'), JSON.stringify({
    mcpServers: { userwide: { command: 'u' } },
    projects: { [dir]: { mcpServers: { mine: { command: 'm' } } } },
  }));
  await addProject({ name: 'cap-git', path: dir });
  await addProject({ name: 'cap-folder', path: folder, vcs: 'none' });
  const pg = await store.addManualServer('pg', { type: 'stdio', command: 'node', args: ['/srv/pg.js'], description: 'db' });
  const team = await store.createSet('Billing');
  await store.putMember(team.id, 'manual:pg', { enabled: true, values: {}, secrets: {} }, { def: pg });
  await store.recordTest(team.id, 'manual:pg', { at: new Date().toISOString(), ok: true, tools: ['query', 'drop'], error: null, fingerprint: 'f' });
  Object.assign(cap, { key: projectKey(dir), folderKey: projectKey(folder), dir, home, prevHome, set: team, store });
  return cap;
}
after(() => { if (cap.key) { if (cap.prevHome === undefined) delete process.env.HOME; else process.env.HOME = cap.prevHome; } });

test('GET /api/agents/capabilities: Project/Team/Personal order, native rows, no user-scope row, unavailable approvals', async () => {
  const f = await capFixture();
  await f.store.setProjectAssignment(f.key, { sets: [f.set.id], includeGeneral: false });
  const r = await get(`/api/agents/capabilities?projectKey=${f.key}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  const ids = body.servers.map((s) => s.id);
  assert.ok(ids.includes('native:wip'), 'an untracked/edited .mcp.json server is a Project row');
  assert.ok(ids.includes('native:mine'), 'local scope is a Personal row');
  assert.ok(!ids.includes('native:userwide'), 'the top-level user-scope server is not a row');
  assert.ok(!ids.includes('native:committed'), 'a committed-identical unapproved server is not choosable');
  assert.equal(body.unavailable.servers['native:committed'], 'not approved in Claude Code yet');
  const groups = body.servers.map((s) => s.group);
  assert.deepEqual(groups, [...groups].sort((a, b) => ['project', 'team', 'personal'].indexOf(a) - ['project', 'team', 'personal'].indexOf(b)));
  assert.equal(body.servers.find((s) => s.id === 'native:wip').group, 'project');
  assert.equal(body.servers.find((s) => s.id === 'native:mine').group, 'personal');
  assert.equal((await get('/api/agents/capabilities?projectKey=nope-00000000')).status, 404);
  assert.equal((await get('/api/agents/capabilities?projectKey=../x')).status, 400);
  assert.equal((await get('/api/agents/capabilities')).status, 200, 'no project: the library has no native rows');
});

test('GET /api/agents: reviewTools counts untested-since tools of an "all" entry; no entry => the key is absent', async () => {
  const f = await capFixture();
  const meta = (key, mcpAccess) => ({ ...META, key, displayName: key, order: 50, ...(mcpAccess ? { mcpAccess } : {}) });
  await post('/api/agents', { meta: meta('revFlagged', [{ server: 'manual:pg', tools: 'all', reviewedTools: ['query'] }]), markdown: MD });
  await post('/api/agents', { meta: meta('revPlain', [{ server: 'manual:pg', tools: ['query'] }]), markdown: MD });
  await post('/api/agents', { meta: meta('revNone'), markdown: MD });
  const { agents } = await (await get('/api/agents')).json();
  assert.equal(agents.find((a) => a.key === 'revFlagged').reviewTools, 1);
  assert.equal('reviewTools' in agents.find((a) => a.key === 'revPlain'), false);
  assert.equal('reviewTools' in agents.find((a) => a.key === 'revNone'), false);
  assert.ok(f.set);
});

test('POST /api/agents/run-check: opted-out server, no selection, codex, unapproved native, untracked native, Folder project, Auto', async () => {
  const f = await capFixture();
  const agentMeta = (key, mcpAccess) => ({ ...META, key, displayName: key, order: 51, ...(mcpAccess ? { mcpAccess } : {}) });
  const names = { opted: 'rcOpted', none: 'rcNone', committed: 'rcCommitted', wip: 'rcWip', folder: 'rcFolder' };
  await post('/api/agents', { meta: agentMeta(names.opted, [{ server: 'manual:pg', tools: 'all' }]), markdown: MD });
  await post('/api/agents', { meta: agentMeta(names.none), markdown: MD });
  await post('/api/agents', { meta: agentMeta(names.committed, [{ server: 'native:committed', tools: 'all' }]), markdown: MD });
  await post('/api/agents', { meta: agentMeta(names.wip, [{ server: 'native:wip', tools: 'all' }]), markdown: MD });
  await post('/api/agents', { meta: agentMeta(names.folder, [{ server: 'native:fsrv', tools: 'all' }]), markdown: MD });
  const wfIds = new Map();
  const wfFor = async (key) => {
    if (wfIds.has(key)) return wfIds.get(key);
    const r = await post('/api/workflows', {
      version: 2, name: `rc ${key}`, domain: 'coding',
      nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
        { id: 'n_a', kind: 'agent', key, x: 600, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
      wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
        { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_a', port: 'plan' } },
        { id: 'w3', from: { node: 'n_a', port: 'review' }, to: { node: 'n_end', port: 'result' } }],
    });
    assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
    wfIds.set(key, (await r.json()).workflow.id);
    return wfIds.get(key);
  };
  const check = async (key, body = {}, projectKey = f.key) => (await (await post('/api/agents/run-check', { target: { projectKey }, workflowId: await wfFor(key), ...body })).json());

  await f.store.setProjectAssignment(f.key, { sets: [f.set.id], includeGeneral: false });
  assert.deepEqual((await check(names.none)).warnings, [], 'an agent without a selection');
  assert.deepEqual((await check(names.wip)).warnings, [], 'an untracked/edited .mcp.json server is provided');
  const opted = await check(names.opted, { mcpOptOut: [`${f.set.id}|manual:pg`] });
  assert.equal(opted.warnings.length, 1);
  assert.match(opted.warnings[0], /rcOpted/);
  assert.match((await check(names.committed)).warnings[0], /not approved in Claude Code yet$/);
  const codex = await check(names.wip, { engine: 'codex' });
  assert.ok(codex.warnings.some((w) => /applies them run-wide/.test(w)));
  assert.match((await check(names.folder, {}, f.folderKey)).warnings[0], /not approved in Claude Code yet$/);
  const auto = await (await post('/api/agents/run-check', { target: { projectKey: f.key } })).json();
  assert.deepEqual(auto.warnings, [], 'Auto has no workflow at start');
  assert.equal((await post('/api/agents/run-check', { target: {} })).status, 400);
});
