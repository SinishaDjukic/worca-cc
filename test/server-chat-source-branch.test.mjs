// test/server-chat-source-branch.test.mjs — "Chat runs: source branch" end to end in ui/server.mjs: POST /api/run
// re-checks every chat-card Start or Schedule with no branch under the mode at that moment (400
// `source-branch-required`, before anything is written), and POST /api/settings lets a good `chat.sourceBranch` through.
// Each case writes the mode it needs (user: settings.json in the sandbox HOME; project: the cascade's project layer),
// which is why these cases are not in test/ask-api-cards.test.mjs (that file keeps `current` seeded throughout).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';

after(() => runs && stopAndSettle(runs));
useTempHome(after);
let sandboxHome, srv, base, runs, writeProjectSettings, createThread, appendMessage, findCard, getDb;
let dirA, dirB, keyA, keyB, workspaceId, branchA;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-srcbranch-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  ({ writeProjectSettings } = await import('../src/core/settings-cascade.mjs'));
  ({ createThread, appendMessage, findCard } = await import('../src/core/ask/store.mjs'));
  ({ getDb } = await import('../src/core/db.mjs'));
  const { addProject, getProjectByPath } = await import('../src/core/projects.mjs');
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  dirA = gitDir('srcbranch-api'); dirB = gitDir('srcbranch-web');
  branchA = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dirA, encoding: 'utf8' }).trim(); // the host's init.defaultBranch
  await addProject({ name: 'api', path: dirA }); await addProject({ name: 'web', path: dirB });
  keyA = getProjectByPath(dirA).key; keyB = getProjectByPath(dirB).key;
  workspaceId = (await createWorkspace({ name: 'srcbranch ws', projectPaths: [dirA, dirB] })).id;
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  for (const d of [sandboxHome, dirA, dirB]) if (d) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** The user layer: settings.json in the sandbox HOME (no mode = nothing stored). */
function userMode(mode) {
  mkdirSync(join(sandboxHome, '.worca-cc'), { recursive: true });
  writeFileSync(join(sandboxHome, '.worca-cc', 'settings.json'), JSON.stringify(mode ? { chat: { sourceBranch: mode } } : {}));
}
const projectMode = (dir, mode) => writeProjectSettings({ projectDir: dir }, { 'chat.sourceBranch': mode });
function setModes({ user = null, a = null, b = null } = {}) { userMode(user); projectMode(dirA, a); projectMode(dirB, b); }

let cardN = 0;
/** A proposed chat card in a fresh thread, as the chat's turn leaves it. */
function proposed(card) {
  const thread = createThread();
  const id = `card_5b${String(++cardN).padStart(6, '0')}`;
  appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id, state: 'proposed', card: { brief: 'x', workflowId: 'wf_default', guardrailsId: 'normal', ...card } }] });
  return { askThreadId: thread.id, askCardId: id };
}
const counts = () => ({ pipelines: getDb().prepare('SELECT COUNT(*) n FROM pipelines').get().n, tickets: getDb().prepare('SELECT COUNT(*) n FROM scheduled_runs').get().n });
const later = () => new Date(Date.now() + 86_400_000).toISOString();
async function start(body) { const r = await post('/api/run', body); return { status: r.status, body: await r.json().catch(() => null) }; }
/** An accepted start: a scheduled one (no live run to settle) is enough — the guard sits before the arms split. */
async function accepted(body) {
  const r = await start({ scheduledFor: later(), ...body });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.status, 'scheduled');
  return r;
}

test('ask mode refuses a branchless project card: 400 source-branch-required, the card stays proposed, no ticket, no row', async () => {
  setModes();
  const link = proposed({ projectDir: dirA });
  const before = counts();
  const r = await start({ projectDir: dirA, prompt: 'x', ...link });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'source-branch-required');
  assert.deepEqual(r.body.members, [keyA]);
  assert.equal(findCard(link.askThreadId, link.askCardId).block.state, 'proposed');
  assert.deepEqual(counts(), before);
  const sched = await start({ projectDir: dirA, prompt: 'x', scheduledFor: later(), ...link });
  assert.equal(sched.status, 400, 'a Schedule is refused too');
  assert.equal(sched.body.code, 'source-branch-required');
  assert.deepEqual(counts(), before);
});

test('ask mode with extras posted leaves no orchestrator-extras dir behind (R-arch-9)', async () => {
  setModes();
  const marker = `srcbranch-${process.pid}-${Date.now()}.txt`;
  const extrasDirs = () => new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('orchestrator-extras-')));
  const before = extrasDirs();
  const r = await start({ projectDir: dirA, prompt: 'x', extras: [{ name: marker, dataBase64: Buffer.from('hi').toString('base64') }], ...proposed({ projectDir: dirA }) });
  assert.equal(r.status, 400);
  const fresh = [...extrasDirs()].filter((n) => !before.has(n));
  assert.ok(!fresh.some((n) => existsSync(join(tmpdir(), n, marker))), 'no extras dir holds the posted file');
});

test('require mode refuses too; current is accepted', async () => {
  setModes({ user: 'require' });
  assert.equal((await start({ projectDir: dirA, prompt: 'x', ...proposed({ projectDir: dirA }) })).body.code, 'source-branch-required');
  setModes({ user: 'current' });
  await accepted({ projectDir: dirA, prompt: 'x', ...proposed({ projectDir: dirA }) });
});

test('override: a project current over a user ask is accepted; a project ask under a user current is refused', async () => {
  setModes({ user: 'ask', a: 'current' });
  await accepted({ projectDir: dirA, prompt: 'x', ...proposed({ projectDir: dirA }) });
  setModes({ user: 'current', a: 'ask' });
  assert.equal((await start({ projectDir: dirA, prompt: 'x', ...proposed({ projectDir: dirA }) })).status, 400);
  setModes();
});

test('a named branch, a New run form body and an after + sourceFromPrevious chain are accepted under ask', async () => {
  setModes();
  await accepted({ projectDir: dirA, prompt: 'x', sourceBranch: branchA, ...proposed({ projectDir: dirA }) });
  await accepted({ projectDir: dirA, prompt: 'x' });   // no askThreadId: the New run form
  seedPipelineRow({ id: 'sb000001', projectKey: keyA, title: 'Prev', status: 'running', startedAt: new Date().toISOString() });
  const r = await start({ projectDir: dirA, prompt: 'x', after: { kind: 'pipeline', id: 'sb000001' }, sourceFromPrevious: true, ...proposed({ projectDir: dirA }) });
  assert.equal(r.status, 202, JSON.stringify(r.body));
});

test('workspace: api (ask) and web (current) with no branches → 400 naming only api; its own branch is accepted', async () => {
  setModes({ a: 'ask', b: 'current' });
  const r = await start({ workspaceId, prompt: 'x', ...proposed({ workspaceId }) });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code, 'source-branch-required');
  assert.deepEqual(r.body.members, [keyA]);
  await accepted({ workspaceId, prompt: 'x', sourceBranchByKey: { [keyA]: branchA }, ...proposed({ workspaceId }) });
  setModes();
});

test('POST /api/settings stores a good chat.sourceBranch and GET returns it', async () => {
  userMode(null);
  const r = await post('/api/settings', { chat: { sourceBranch: 'require' } });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).chat.sourceBranch, 'require');
  userMode(null);
});
