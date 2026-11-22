// test/ask-api-verbosity.test.mjs — Chat reply style (#1230) end to end: startAskTurn resolves the level
// (chat > project > user > team default > normal) and the turn's system prompt carries that level's block last.
// Needs the real server: the wiring lives in startAskTurn. Boot = test/ask-api-agent-always.test.mjs (WORCA_MOCK; the
// turn is read back from _testing.askJobs). settings.json lives under the OS home, so HOME is a temp dir too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { VERBOSITY_BLOCKS } from '../src/core/ask/verbosity.mjs';

useTempHome(after);

let osHome, srv, base, mod, project, store, settings, cascade, config;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });
const idle = async () => {
  for (let i = 0; i < 500 && [...mod._testing.askJobs.values()].some((j) => j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};
const turnOf = async (threadId) => {
  for (let i = 0; i < 500 && !mod._testing.askJobs.get(threadId)?.turn; i++) await new Promise((r) => setTimeout(r, 10));
  return mod._testing.askJobs.get(threadId).turn;
};
const NO_PROJECT = { view: 'chat', pinned: false };
const inProject = () => ({ view: 'chat', pinned: true, projectKey: project.key });
/** One message on a new chat; returns the turn's system prompt. */
async function promptOf({ context = NO_PROJECT, threadPatch = null, send = {} } = {}) {
  await idle();
  const { thread } = await (await post('/api/ask/threads', {})).json();
  if (threadPatch) assert.equal((await patch(`/api/ask/threads/${thread.id}`, threadPatch)).status, 200);
  const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, context, ...send });
  assert.equal(r.status, 202, await r.text());
  const prompt = (await turnOf(thread.id)).systemPrompt;
  await idle();
  return { prompt, thread };
}
const styleOf = (prompt) => Object.entries(VERBOSITY_BLOCKS).filter(([, b]) => prompt.includes(b)).map(([k]) => k);

before(async () => {
  osHome = await mkdtemp(join(tmpdir(), 'worca-cc-askverb-os-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = osHome; process.env.USERPROFILE = osHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  settings = await import('../src/core/settings.mjs');
  cascade = await import('../src/core/settings-cascade.mjs');
  config = await import('../src/core/config.mjs');
  const { addProject } = await import('../src/core/projects.mjs');
  project = (await addProject({ name: 'verbose', path: gitDir('verbose') })).find((p) => p.name === 'verbose');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(osHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

test('normal adds no Reply style section', async () => {
  const { prompt } = await promptOf();
  assert.doesNotMatch(prompt, /## Reply style/);
});

test('a thread override terse puts the terse block last in the turn\'s system prompt', async () => {
  const { prompt } = await promptOf({ threadPatch: { verbosity: 'terse' } });
  assert.deepEqual(styleOf(prompt), ['terse']);
  const at = prompt.indexOf(VERBOSITY_BLOCKS.terse);
  assert.ok(at > prompt.indexOf('## Commands (agent mode)'), 'after the commands section');
  assert.equal(prompt.split('## Reply style').length, 2, 'exactly one block');
});

test('no override follows the user setting (caveman) and a project override beats it', async () => {
  await settings.setChatPrefs({ verbosity: 'caveman' });
  try {
    assert.deepEqual(styleOf((await promptOf()).prompt), ['caveman'], 'a No-project chat follows the user setting');
    cascade.writeProjectSettings(project.path, { 'chat.verbosity': 'detailed' });
    assert.deepEqual(styleOf((await promptOf({ context: inProject() })).prompt), ['detailed'], 'the project override beats the user value');
    assert.deepEqual(styleOf((await promptOf()).prompt), ['caveman'], 'a No-project chat never reads a project layer');
    assert.deepEqual(styleOf((await promptOf({ context: inProject(), threadPatch: { verbosity: 'concise' } })).prompt), ['concise'], 'the chat beats the project');
    assert.equal(styleOf((await promptOf({ context: inProject(), threadPatch: { verbosity: 'normal' } })).prompt).length, 0, 'a chat pick of normal beats the project too');
  } finally {
    cascade.writeProjectSettings(project.path, { 'chat.verbosity': null });
    await settings.setChatPrefs({ verbosity: null });
  }
});

test('a project chat with a team-policy default (and no user value) uses it', async () => {
  config.writeTeamPolicyPrefs(project.key, { present: true, docKnown: true, slug: 'acme/verbose', headSha: 'abc1234', delegateTo: null,
    doc: { schema: 1, fields: { 'ask.verbosity': { kind: 'default', value: 'concise' } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } } });
  try {
    assert.deepEqual(styleOf((await promptOf({ context: inProject() })).prompt), ['concise']);
    assert.equal(styleOf((await promptOf()).prompt).length, 0, 'the team layer exists only for a project chat');
  } finally {
    config.writeTeamPolicyPrefs(project.key, { present: false, docKnown: false, doc: null });
  }
});

test('a send carrying verbosity on a new chat stores it before the first turn and that turn uses it', async () => {
  const { prompt, thread } = await promptOf({ send: { verbosity: 'caveman' } });
  assert.deepEqual(styleOf(prompt), ['caveman']);
  assert.equal(store.getThread(thread.id).verbosity, 'caveman', 'stored on the thread');
  const again = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'again', ...MODEL, context: NO_PROJECT });
  assert.equal(again.status, 202, await again.text());
  await idle();
  assert.equal(store.getThread(thread.id).verbosity, 'caveman', 'a send without verbosity leaves it alone');
});

test('a refused send (bad verbosity) writes nothing', async () => {
  await idle();
  const { thread } = await (await post('/api/ask/threads', {})).json();
  const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, context: NO_PROJECT, verbosity: 'loud' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'verbosity must be one of detailed | normal | concise | terse | caveman, or null');
  assert.equal(store.getThread(thread.id).verbosity, null);
  assert.equal(store.listMessages(thread.id).length, 0, 'no message was stored');
});

test('a composer-mode thread\'s prompt never carries the block', async () => {
  await idle();
  const { thread } = await (await post('/api/ask/threads', { mode: 'composer' })).json();
  assert.equal((await patch(`/api/ask/threads/${thread.id}`, { verbosity: 'terse' })).status, 200);
  await settings.setChatPrefs({ verbosity: 'caveman' });
  try {
    const composer = { sessionId: 'cs_ab12cd34', docToken: 'd_ab12cd34', graph: { name: 'x', nodes: [], wires: [] }, selection: null, drafts: [] };
    const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'Build a workflow', ...MODEL, context: {}, composer });
    assert.equal(r.status, 202, await r.text());
    assert.doesNotMatch((await turnOf(thread.id)).systemPrompt, /## Reply style/);
    await idle();
  } finally {
    await settings.setChatPrefs({ verbosity: null });
  }
});
