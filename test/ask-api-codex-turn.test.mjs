// test/ask-api-codex-turn.test.mjs — a Codex chat end to end under the mock (cascading-settings-design.md §8 tests 14, 18).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { CODEX_ASK_LOCKDOWN } from '../src/core/engines/codex.mjs';

useTempHome(after);
// Task 0 (a) was NOT CONFIRMED on codex-cli 0.146 (plans/ask-on-codex-spike.md): CODEX_ASK_LOCKDOWN is null, the catalog
// offers no Codex model, and the server refuses one before any write. The two end-to-end tests below need a lockable
// codex; they run as soon as CODEX_ASK_LOCKDOWN is set.
const LOCKABLE = Array.isArray(CODEX_ASK_LOCKDOWN);
const needsLockdown = LOCKABLE ? {} : { skip: 'CODEX_ASK_LOCKDOWN is null on this codex (plans/ask-on-codex-spike.md (a))' };
let sandboxHome, srv, base, store, mockSpawnLog;
const prevEnv = {};
const send = async (method, p, b) => { const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64').toString('base64');
const PDF = Buffer.from('%PDF-1.4\n%âã\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1').toString('base64');

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-ask-codex-turn-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  store = await import('../src/core/ask/store.mjs');
  ({ mockSpawnLog } = await import('../src/core/claude-runner.mjs'));
});
after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});
async function settled(id) {
  for (let i = 0; i < 200; i += 1) {
    const m = store.listMessages(id).find((x) => x.role === 'assistant');
    if (m && m.status && m.status !== 'streaming') return m;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('turn never settled');
}

test('a Codex chat: every spawn of the turn and its title is codex read-only; the row keeps the Codex model', needsLockdown, async () => {
  const t = store.createThread();
  const from = mockSpawnLog.length;
  const r = await send('POST', `/api/ask/threads/${t.id}/messages`, { text: 'What runs are there?', model: 'gpt-5.5', effort: 'low', attachments: [{ name: 'shot.png', dataBase64: PNG }] });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const m = await settled(t.id);
  assert.equal(m.model, 'gpt-5.5');
  await new Promise((res) => setTimeout(res, 100));   // the title call
  const spawns = mockSpawnLog.slice(from);
  assert.ok(spawns.length >= 1);
  assert.ok(spawns.every((sp) => sp.engine === 'codex' && sp.sandbox === 'read-only'), JSON.stringify(spawns));
});

test('a PDF in a Codex chat is refused before any write; a Claude chat still takes it', needsLockdown, async () => {
  const t = store.createThread();
  const r = await send('POST', `/api/ask/threads/${t.id}/messages`, { text: 'read this', model: 'gpt-5.5', effort: 'low', attachments: [{ name: 'spec.pdf', dataBase64: PDF }] });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'PDFs need a Claude chat: spec.pdf');
  assert.equal(store.listMessages(t.id).length, 0);
});

test('no lockdown on this codex: a Codex model is refused before any write, and nothing spawns', LOCKABLE ? { skip: 'this codex can be locked down' } : {}, async () => {
  const t = store.createThread();
  const from = mockSpawnLog.length;
  const r = await send('POST', `/api/ask/threads/${t.id}/messages`, { text: 'hi', model: 'gpt-5.5', effort: 'low', attachments: [{ name: 'spec.pdf', dataBase64: PDF }] });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'unknown model "gpt-5.5"');
  assert.equal(store.listMessages(t.id).length, 0);
  assert.equal(mockSpawnLog.length, from);
});

test('a Claude chat still takes a PDF', async () => {
  const t = store.createThread();
  const r = await send('POST', `/api/ask/threads/${t.id}/messages`, { text: 'read this', model: 'claude-opus-5-5', effort: 'high', attachments: [{ name: 'spec.pdf', dataBase64: PDF }] });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  await settled(t.id);
});
