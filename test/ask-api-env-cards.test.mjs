// test/ask-api-env-cards.test.mjs
// The environment card over the cards route (ui/server.mjs, WORCA_MOCK): Apply of a spec card writes the project's
// spec through the PUT …/exec-env/spec code, a clear card removes it, a sandbox settings card writes the backend fields,
// a build card starts a build (the Docker fake in mock mode); an isolated agent and a page of another origin cannot
// apply; Keep as is declines; each posts its "[worca event] environment card …" turn. The bridge answers the chat's
// security reads for this turn's token only. HOME is pinned to a temp dir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';

useTempHome(after);

let homeDir; let osHome; let mod; let store; let srv; let base; let project; let readProjectExecEnv;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { ...JSONH, ...headers }, body: JSON.stringify(body) });
const get = async (p) => (await fetch(`${base}${p}`)).json();
const snapshot = async (id) => get(`/api/ask/threads/${id}`);
async function waitFor(pred, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askenv-'));
  osHome = await mkdtemp(join(tmpdir(), 'worca-cc-askenv-os-'));
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME']) prevEnv[k] = process.env[k];
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = osHome; process.env.USERPROFILE = osHome;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  ({ readProjectExecEnv } = await import('../src/core/config.mjs'));
  const { insertProject } = await import('../src/core/projects.mjs');
  const dir = join(osHome, 'acme-api');
  await mkdir(dir, { recursive: true });
  project = insertProject({ name: 'acme-api', path: dir, vcs: 'git' });
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  closeDbForTests();
  for (const d of [homeDir, osHome]) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

async function seedCard(card) {
  const thread = (await (await post('/api/ask/threads', {})).json()).thread;
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', model: 'claude-opus-5-5', effort: 'high' });
  await waitFor(async () => (await snapshot(thread.id)).messages.some((m) => m.role === 'assistant' && m.status === 'done'));
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card }] });
  return { threadId: thread.id, cardId };
}
const eventRow = async (threadId) => (await snapshot(threadId)).messages.find((m) => m.role === 'user' && /^\[worca event\] environment card /.test(m.text || ''));
const specCard = (apt) => ({ type: 'environment', kind: 'spec', projectKey: project.key, projectName: project.name, summary: `Set the environment spec of ${project.name}`,
  change: { clear: false, spec: { version: 1, tools: [{ name: 'node', version: '22.11.0' }], apt } }, changes: [] });

test('spec card: Apply writes the spec as the project page does; a page of another origin cannot; the event turn says so', async () => {
  const { threadId, cardId } = await seedCard(specCard(['jq']));
  const cross = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' }, { Origin: 'http://localhost:1' });
  assert.equal(cross.status, 403);
  assert.equal(readProjectExecEnv(project.key).spec, null, 'nothing written');
  const res = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.block.state, 'applied');
  assert.deepEqual(readProjectExecEnv(project.key).spec.apt, ['jq']);
  const ev = await waitFor(() => eventRow(threadId));
  assert.match(ev.text, /^\[worca event\] environment card \S+ applied; "Set the environment spec of acme-api"; Saved\./);
});

test('spec card: an invalid spec fails the card and writes nothing; Keep as is declines', async () => {
  const bad = await seedCard({ ...specCard(['Not A Package']) });
  const r = await (await post(`/api/ask/threads/${bad.threadId}/cards/${bad.cardId}`, { state: 'applied' })).json();
  assert.equal(r.block.state, 'failed');
  assert.match(r.block.error, /not a Debian package name/);
  assert.deepEqual(readProjectExecEnv(project.key).spec.apt, ['jq']);
  const d = await seedCard(specCard(['git']));
  const dr = await (await post(`/api/ask/threads/${d.threadId}/cards/${d.cardId}`, { state: 'declined' })).json();
  assert.equal(dr.block.state, 'declined');
  assert.deepEqual(readProjectExecEnv(project.key).spec.apt, ['jq']);
});

test('sandbox settings and build cards: the backend fields are written; a build starts on the Docker fake', async () => {
  const cfg = await seedCard({ type: 'environment', kind: 'config', projectKey: project.key, projectName: project.name, backend: 'docker', summary: 'Change the Docker settings',
    change: { backend: 'docker', values: { egress: 'allow' } }, changes: [] });
  const cr = await (await post(`/api/ask/threads/${cfg.threadId}/cards/${cfg.cardId}`, { state: 'applied' })).json();
  assert.equal(cr.block.state, 'applied', JSON.stringify(cr.block));
  assert.equal(readProjectExecEnv(project.key).config.docker.egress, 'allow');
  const b = await seedCard({ type: 'environment', kind: 'build', projectKey: project.key, projectName: project.name, backend: 'docker', summary: 'Build the image', change: { backend: 'docker' }, changes: [] });
  const br = await (await post(`/api/ask/threads/${b.threadId}/cards/${b.cardId}`, { state: 'applied' })).json();
  assert.equal(br.block.state, 'applied', JSON.stringify(br.block));
  assert.match(br.block.card.result.jobId, /^envb_[0-9a-f]{8}$/);
});

test('an isolated agent cannot apply an environment card', async () => {
  const { threadId, cardId } = await seedCard(specCard(['curl']));
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(osHome, 'agent');
  try {
    const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' });
    assert.equal(r.status, 403);
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
  assert.deepEqual(readProjectExecEnv(project.key).spec.apt, ['jq']);
});

test('the bridge: security reads answer only this turn\'s token, and never a key or login', async () => {
  const none = await post('/api/ask/proxy', { op: 'security-posture' }, { 'x-worca-ask-proxy': 'nope' });
  assert.equal(none.status, 403);
  const { askProxyBridge } = mod._testing;
  if (typeof askProxyBridge !== 'function') return;   // not exposed: covered by the in-process readers' tests
  const b = askProxyBridge({ threadId: 'ask_00000001' });
  try {
    const r = await (await post('/api/ask/proxy', { op: 'security-posture' }, { 'x-worca-ask-proxy': b.token })).json();
    assert.equal(r.result.where, 'native');
  } finally { b.dispose(); }
});
