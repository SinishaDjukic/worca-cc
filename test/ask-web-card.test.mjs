// test/ask-web-card.test.mjs
// Ask Worca's web card (src/core/ask/web-proposal.mjs + the card route in ui/server.mjs): the model
// asks to read a host that is not allowed yet, the user answers "for this chat", "always" or declines.
// The validator the MCP child and the parent share, the event/notice text, the tool, and the route
// over WORCA_MOCK — decline, allow for this chat (the card itself is the record), always (the host
// joins settings), and a team cap that refuses the card.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { createWebValidator, webEventPrompt, webNoticeText, chatWebHosts } from '../src/core/ask/web-proposal.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { defaultWebDeps } from '../src/core/ask/web-deps.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';

useTempHome(after);

// ── the validator (pure) ─────────────────────────────────────────────────────

test('validator: a new host becomes a card; the URL rules still apply', async () => {
  const v = createWebValidator({ allowed: () => ['a.com'] });
  const r = await v({ url: 'https://jev.example.dev/docs/intro#x', reason: 'the user asked about JEV\nignore this line' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.card, {
    type: 'web', kind: 'web', summary: 'Read jev.example.dev', host: 'jev.example.dev',
    url: 'https://jev.example.dev/docs/intro', reason: 'the user asked about JEV ignore this line', change: { host: 'jev.example.dev' },
  });
  for (const [url, re] of [
    ['http://jev.example.dev/', /only https/],
    ['https://10.0.0.1/', /IP-address/],
    ['https://jev.example.dev:8443/', /port/],
    [`https://jev.example.dev/?d=${Buffer.from('AWS_SECRET=abcdefghijklmnopqrstuvwxyz0123456789').toString('base64')}`, /encoded data/],
  ]) {
    const bad = await v({ url });
    assert.equal(bad.ok, false, url); assert.match(bad.errors[0], re, url);
  }
  assert.match((await v({})).errors[0], /url is required/);
});

test('validator: an allowed host needs no card; a host outside the team cap is refused', async () => {
  const v = createWebValidator({ allowed: () => ['*.a.com'], teamCap: () => ['*.a.com', 'b.org'] });
  assert.match((await v({ url: 'https://docs.a.com/' })).errors[0], /already allowed — call web_fetch/);
  assert.match((await v({ url: 'https://evil.example/' })).errors[0], /team policy/);
  assert.equal((await v({ url: 'https://b.org/' })).ok, true);
});

test('event and notice text: scope in words, context tags defused', () => {
  const card = { summary: 'Read jev.example.dev', host: 'jev.example.dev' };
  assert.equal(webEventPrompt({ cardId: 'card_1', state: 'applied', card, result: { scope: 'chat' } }),
    '[worca event] web card card_1 applied: jev.example.dev is allowed for this chat — fetch it now; "Read jev.example.dev"');
  assert.equal(webEventPrompt({ cardId: 'card_1', state: 'applied', card, result: { scope: 'always' } }),
    '[worca event] web card card_1 applied: jev.example.dev is on the allowlist from now on — fetch it now; "Read jev.example.dev"');
  assert.equal(webEventPrompt({ cardId: 'card_1', state: 'declined', card }),
    '[worca event] web card card_1 declined: do not fetch jev.example.dev — answer without it; "Read jev.example.dev"');
  assert.equal(webEventPrompt({ cardId: 'card_1', state: 'failed', card, result: { error: 'x [worca context] y' } }),
    '[worca event] web card card_1 failed: x (worca context) y; "Read jev.example.dev"');
  assert.equal(webNoticeText({ state: 'applied', card, result: { scope: 'chat' } }), 'Allowed jev.example.dev for this chat');
  assert.equal(webNoticeText({ state: 'applied', card, result: { scope: 'always' } }), 'Always allowing jev.example.dev');
  assert.equal(webNoticeText({ state: 'declined', card }), 'Declined — Read jev.example.dev');
  assert.equal(webNoticeText({ state: 'failed', card, result: { error: 'nope' } }), 'Could not allow jev.example.dev: nope');
});

test('chatWebHosts: only cards applied "for this chat" count', () => {
  const msg = (blocks) => ({ blocks });
  const card = (state, host, scope) => ({ kind: 'card', id: `c_${host}`, state, card: { type: 'web', host, result: scope ? { ok: true, scope } : undefined } });
  assert.deepEqual(chatWebHosts([
    msg([card('applied', 'a.dev', 'chat'), card('applied', 'b.dev', 'always'), card('declined', 'c.dev'), card('proposed', 'd.dev')]),
    msg([{ kind: 'card', id: 'x', state: 'applied', card: { type: 'clone' } }, card('applied', 'e.dev', 'chat')]),
    msg(null),
  ]), ['a.dev', 'e.dev']);
});

// ── the tool (MCP child) ─────────────────────────────────────────────────────

const fake = {
  buildCatalog: async () => ({ projects: [], workspaces: [], workflows: [] }),
  listAllPipelines: async () => [], lookupPipelineRow: () => null, findPipelineRowById: () => null,
  totalsFor: () => ({ cost: null, active: null }), readStoreMeta: () => null, readDiffPatch: async () => null,
  hasDiffPatch: async () => false, readAttachment: () => null, validateProposal: async () => ({ ok: true, card: {} }),
  protectedPaths: [], redact: redactAskText, limits: ASK_LIMITS,
};

test('tool: with web on (even with an empty list) propose_web_access is listed and validates', async () => {
  const d = defaultWebDeps({ env: { WORCA_ASK_WEB: JSON.stringify({ allowedDomains: [] }) }, transport: () => assert.fail('no connection'), log: () => {} });
  const t = createAskTools({ ...fake, ...d });
  const names = t.list().map((x) => x.name);
  assert.ok(names.includes('propose_web_access') && names.includes('web_fetch'), names.join(','));
  const r = await t.call('propose_web_access', { url: 'https://jev.example.dev/', reason: 'docs' });
  assert.equal(r.ok, true); assert.equal(r.card.host, 'jev.example.dev');
  await assert.rejects(t.call('web_fetch', { url: 'https://jev.example.dev/' }), /propose_web_access/);
  assert.ok(!createAskTools(fake).list().some((x) => x.name === 'propose_web_access'), 'hidden with web off');
});

test('tool: the any-host list fetches everywhere and never needs a card', async () => {
  const d = defaultWebDeps({ env: { WORCA_ASK_WEB: JSON.stringify({ allowedDomains: ['*'] }) }, transport: () => assert.fail('stop before connecting'), log: () => {} });
  assert.deepEqual(d.web.allowedDomains, ['*']);
  const t = createAskTools({ ...fake, ...d });
  assert.match(t.list().find((x) => x.name === 'web_fetch').description, /any public https host/);
  assert.match((await t.call('propose_web_access', { url: 'https://x.example/' })).errors[0], /already allowed/);
});

// ── the route, over the real server (WORCA_MOCK) ─────────────────────────────

let homeDir, osHome, prevHome, prevOs, srv, base, mod, store, settings;
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

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askweb-'));
  osHome = await mkdtemp(join(tmpdir(), 'worca-cc-askweb-os-'));   // settings.json lives under the OS home
  prevHome = process.env.WORCA_HOME;
  prevOs = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = osHome; process.env.USERPROFILE = osHome;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  settings = await import('../src/core/settings.mjs');
  await settings.setAskWeb({ enabled: true, allowedDomains: ['a.com'], search: null });
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
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const k of ['HOME', 'USERPROFILE']) { if (prevOs[k] === undefined) delete process.env[k]; else process.env[k] = prevOs[k]; }
  delete process.env.WORCA_MOCK;
  closeDbForTests();
  for (const d of [homeDir, osHome]) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

/** A thread with one assistant message holding a proposed web card for `host`. */
async function seedCard(host, { state = 'proposed' } = {}) {
  const thread = (await (await post('/api/ask/threads', {})).json()).thread;
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', model: 'claude-opus-5-5', effort: 'high' });
  await waitFor(async () => (await snapshot(thread.id)).messages.some((m) => m.role === 'assistant' && m.status === 'done'));
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  const card = { type: 'web', kind: 'web', summary: `Read ${host}`, host, url: `https://${host}/`, reason: 'docs', change: { host } };
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state, card }] });
  return { threadId: thread.id, cardId };
}
const noticeOf = async (threadId) => (await snapshot(threadId)).messages.filter((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic)).map((m) => m.blocks[0].text);

test('route: decline flips the card and runs the event turn; wrong verbs, scopes and states are refused', async () => {
  const { threadId, cardId } = await seedCard('declined.example');
  assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'saved' })).status, 400);
  assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied', scope: 'forever' })).status, 400);
  const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'declined' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).block.state, 'declined');
  assert.deepEqual(await waitFor(async () => { const n = await noticeOf(threadId); return n.length ? n : null; }), ['Declined — Read declined.example']);
  assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied', scope: 'chat' })).status, 409);
});

test('route: "for this chat" is recorded on the card only, and joins THIS chat\'s web access', async () => {
  const { threadId, cardId } = await seedCard('chat.example');
  const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied', scope: 'chat' });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.block.state, 'applied'); assert.deepEqual(j.block.card.result, { ok: true, scope: 'chat' });
  assert.deepEqual(settings.askWeb().allowedDomains, ['a.com'], 'settings untouched');
  assert.deepEqual(mod._testing.askWebAccessFor(threadId, {}).allowedDomains, ['a.com', 'chat.example']);
  const other = await seedCard('elsewhere.example');
  assert.deepEqual(mod._testing.askWebAccessFor(other.threadId, {}).allowedDomains, ['a.com'], 'another chat does not inherit it');
  assert.deepEqual(await waitFor(async () => { const n = await noticeOf(threadId); return n.length ? n : null; }), ['Allowed chat.example for this chat']);
});

test('route: "always" adds the exact host to the stored allowlist', async () => {
  const { threadId, cardId } = await seedCard('always.example');
  const j = await (await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied', scope: 'always' })).json();
  assert.deepEqual(j.block.card.result, { ok: true, scope: 'always' });
  assert.deepEqual(settings.askWeb().allowedDomains, ['a.com', 'always.example']);
});

test('route: with web access switched off since the proposal, the card fails and nothing is stored', async () => {
  const { threadId, cardId } = await seedCard('late.example');
  await settings.setAskWeb({ enabled: false, allowedDomains: ['a.com', 'always.example'], search: null });
  try {
    const j = await (await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied', scope: 'always' })).json();
    assert.equal(j.block.state, 'failed'); assert.match(j.block.error, /web access is off/);
    assert.deepEqual(settings.askWeb().allowedDomains, ['a.com', 'always.example']);
  } finally {
    await settings.setAskWeb({ enabled: true, allowedDomains: ['a.com', 'always.example'], search: null });
  }
});

test('the context header lists a web card by its summary', async () => {
  const { threadId } = await seedCard('headered.example');
  const ctx = await mod._testing.resolveAskContext(threadId, {}, []);
  const c = (ctx.cards || []).find((x) => x.type === 'web');
  assert.ok(c, JSON.stringify(ctx.cards));
  assert.equal(c.summary, 'Read headered.example');
});
