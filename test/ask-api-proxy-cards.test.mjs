// test/ask-api-proxy-cards.test.mjs
// The corporate proxy card over the cards route (ui/server.mjs, WORCA_MOCK): Apply of a settings card saves through
// the PUT /api/proxy/settings path (proxyHost.saveSettings, so D14's marker is set too); Apply of the flag card turns
// corporateProxy on through setFlags; an agent under isolation cannot apply; the event turn says what happened.
// HOME is pinned to a temp dir: settings.json (networkProxy, the flags) lives under HOME, never WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';

useTempHome(after);

const PROXY_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'WORCA_EGRESS_PROXY_URL'];
let homeDir; let osHome; let mod; let store; let srv; let base; let testing; let networkProxySettings; let flagEnabled;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
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
async function withAgent(fn) {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(osHome, 'agent');
  try { return await fn(); } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askproxy-'));
  osHome = await mkdtemp(join(tmpdir(), 'worca-cc-askproxy-os-'));   // settings.json lives under the OS home
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_FLAGS', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', ...PROXY_ENV]) prevEnv[k] = process.env[k];
  for (const k of PROXY_ENV) delete process.env[k];
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = osHome; process.env.USERPROFILE = osHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';   // the flag card's setFlags writes the temp settings.json
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'corporateProxy';
  mod = await import('../ui/server.mjs');
  testing = mod._testing;
  store = await import('../src/core/ask/store.mjs');
  ({ networkProxySettings } = await import('../src/core/settings.mjs'));
  ({ flagEnabled } = await import('../src/core/flags.mjs'));
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  testing?.setEgress(null);
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

/** A thread with one assistant message holding a proposed proxy card. */
async function seedCard(card) {
  const thread = (await (await post('/api/ask/threads', {})).json()).thread;
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', model: 'claude-opus-5-5', effort: 'high' });
  await waitFor(async () => (await snapshot(thread.id)).messages.some((m) => m.role === 'assistant' && m.status === 'done'));
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card }] });
  return { threadId: thread.id, cardId };
}
const SETTINGS_CARD = { type: 'proxy', kind: 'settings', patch: { upstream: 'proxy2.acme.test:3128' },
  changes: [{ field: 'upstream', label: 'Proxy', before: 'none (…)', after: 'proxy2.acme.test:3128' }], summary: 'Proxy: proxy2.acme.test:3128', upstreamChanged: true, restartNote: 'Restart Worca to apply.', note: '' };
const FLAG_CARD = { type: 'proxy', kind: 'flag', set: { corporateProxy: true }, changes: [{ field: 'corporateProxy', label: 'Corporate proxy (Labs)', before: 'Off', after: 'On' }],
  summary: 'Corporate proxy (Labs): On', restartNote: 'Restart Worca to apply.', note: '' };
const eventRow = async (threadId) => (await snapshot(threadId)).messages.find((m) => m.role === 'user' && /^\[worca event\] proxy card /.test(m.text || ''));

test('proxy card: Apply saves through the PUT path (marker set: test then says RESTART_NEEDED), an agent cannot apply, the event turn says so', async () => {
  process.env.WORCA_FLAGS = 'corporateProxy';
  const { threadId, cardId } = await seedCard(SETTINGS_CARD);
  await withAgent(async () => {
    const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' });
    assert.deepEqual([r.status, (await r.json()).code], [403, 'PROXY_AGENT_BLOCKED']);
  });
  const res = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' });
  assert.equal(res.status, 200, await res.clone().text());
  const r = { body: await res.json() };
  assert.equal(r.body.block.state, 'applied');
  assert.equal(r.body.block.card.result.detail, 'Saved. Restart Worca to apply.');
  assert.equal(networkProxySettings().upstream, 'http://proxy2.acme.test:3128');
  assert.equal(testing.proxyHost.changedSinceBoot(), true, 'the same marker PUT /api/proxy/settings sets');
  assert.equal((await (await post('/api/proxy/test', {})).json()).code, 'RESTART_NEEDED');
  assert.ok(r.body.turn && (r.body.turn.assistantMessageId || r.body.turn.deferred), 'an event turn was started or queued');
  const ev = await waitFor(() => eventRow(threadId));
  assert.match(ev.text, /^\[worca event\] proxy card \S+ applied; "Proxy: proxy2\.acme\.test:3128"; Saved\. Restart Worca to apply\./);
  testing.setEgress(null);   // clears the marker (a restart) for the next test
});

test('proxy card: Keep as is declines and posts the event; nothing is written', async () => {
  process.env.WORCA_FLAGS = 'corporateProxy';
  const before = networkProxySettings();
  const { threadId, cardId } = await seedCard({ ...SETTINGS_CARD, patch: { upstream: 'proxy3.acme.test:3128' }, summary: 'Proxy: proxy3.acme.test:3128' });
  const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'declined' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).block.state, 'declined');
  assert.deepEqual(networkProxySettings(), before);
  const ev = await waitFor(() => eventRow(threadId));
  assert.equal(ev.text, '[worca event] proxy card ' + cardId + ' declined; "Proxy: proxy3.acme.test:3128"');
});

test('flag off: a settings card fails; a locked flag fails the flag card; the flag card turns corporateProxy on through setFlags', async () => {
  delete process.env.WORCA_FLAGS;   // unset, not "-corporateProxy" (that locks it)
  assert.equal(flagEnabled('corporateProxy'), false);
  const s = await seedCard({ ...SETTINGS_CARD, patch: { upstream: 'proxy4.acme.test:3128' } });
  const sr = await (await post(`/api/ask/threads/${s.threadId}/cards/${s.cardId}`, { state: 'applied' })).json();
  assert.equal(sr.block.state, 'failed');
  assert.match(sr.block.error, /corporate proxy is off/);

  process.env.WORCA_FLAGS = '-corporateProxy';
  try {
    const l = await seedCard(FLAG_CARD);
    const lr = await (await post(`/api/ask/threads/${l.threadId}/cards/${l.cardId}`, { state: 'applied' })).json();
    assert.equal(lr.block.state, 'failed');
    assert.match(lr.block.error, /WORCA_FLAGS/);
  } finally { delete process.env.WORCA_FLAGS; }

  const f = await seedCard(FLAG_CARD);
  await withAgent(async () => assert.equal((await post(`/api/ask/threads/${f.threadId}/cards/${f.cardId}`, { state: 'applied' })).status, 403));
  const fr = await (await post(`/api/ask/threads/${f.threadId}/cards/${f.cardId}`, { state: 'applied' })).json();
  assert.equal(fr.block.state, 'applied', JSON.stringify(fr));
  assert.equal(fr.block.card.result.detail, 'Corporate proxy is on. Restart Worca to start the local proxy.');
  assert.equal(flagEnabled('corporateProxy'), true);
});
