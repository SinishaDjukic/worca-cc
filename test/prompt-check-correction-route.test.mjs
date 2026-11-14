// test/prompt-check-correction-route.test.mjs — POST /api/prompt-check/kind-correction
// (ui/routes/prompt-check/correction-route.mjs). Boots the app in-process with a temp HOME (settings.json) and
// WORCA_HOME (the DB). Ids and kinds only: a refusal writes nothing and no stored row ever holds text.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const HOME = mkdtempSync(join(tmpdir(), 'worca-cc-pcc-home-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';

const { _setCorrectionBucketForTest } = await import('../ui/routes/prompt-check/correction-route.mjs');
const { setChatPrefs } = await import('../src/core/settings.mjs');
const { getDb } = await import('../src/core/db.mjs');
const { TokenBucket } = await import('../src/core/chat/rate-limiter.mjs');

let srv;
let port;
before(async () => {
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});
after(async () => {
  _setCorrectionBucketForTest(null);
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  delete process.env.WORCA_MOCK;
  rmSync(HOME, { recursive: true, force: true });
});

const URL_PATH = '/api/prompt-check/kind-correction';
const body = (o = {}) => ({ surface: 'chat', threadId: 'ask_00000001', proposedKind: 'bug', chosenKind: 'idea', ...o });
const post = async (b) => {
  const r = await fetch(`http://127.0.0.1:${port}${URL_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};
const rows = () => getDb().prepare('SELECT * FROM prompt_kind_corrections ORDER BY id').all().map((r) => ({ ...r }));
const promptCheck = (on) => setChatPrefs({ promptCheck: on });

test('validation: each 400 message in order, and 0 rows written', async () => {
  await promptCheck(true);
  const n = rows().length;
  const cases = [
    [{ surface: undefined }, 'surface is required'],
    [{ surface: 'nope' }, 'surface is required'],
    [{ threadId: undefined }, 'threadId is required'],
    [{ surface: 'shaper', threadId: undefined }, 'threadId is required'],
    [{ surface: 'run-card', threadId: undefined, cardId: 'c1' }, 'threadId is required'],
    [{ surface: 'new-run', threadId: undefined }, 'runId is required'],
    [{ threadId: 42 }, 'id is invalid'],
    [{ threadId: { $gt: '' } }, 'id is invalid'],
    [{ threadId: ['a'] }, 'id is invalid'],
    [{ threadId: 'a b' }, 'id is invalid'],
    [{ threadId: 'x'.repeat(129) }, 'id is invalid'],
    [{ cardId: '<img>' }, 'id is invalid'],
    [{ surface: 'new-run', threadId: undefined, runId: 7 }, 'id is invalid'],
    [{ proposedKind: 'nope' }, 'proposedKind is invalid'],
    [{ chosenKind: 'question' }, 'chosenKind is invalid'],
    [{ chosenKind: 'bug' }, 'the kind did not change'],
  ];
  for (const [patch, error] of cases) {
    const r = await post(body(patch));
    assert.equal(r.status, 400, `${JSON.stringify(patch)} → ${error}`);
    assert.deepEqual(r.body, { error });
  }
  assert.equal(rows().length, n);
});

test('setting off → 409 and 0 rows', async () => {
  await promptCheck(false);
  const n = rows().length;
  const r = await post(body());
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'prompt check is off' });
  assert.equal(rows().length, n);
  await promptCheck(true);
});

test('201 stores {proposedKind, chosenKind, at, threadId}; a text key is never stored', async () => {
  await promptCheck(true);
  const r = await post(body({ text: 'zebra-3317 the secret prompt', prompt: 'zebra-3317', extra: 1 }));
  assert.equal(r.status, 201);
  assert.equal(r.body.ok, true);
  assert.ok(!Number.isNaN(Date.parse(r.body.at)));
  const row = rows().at(-1);
  assert.deepEqual(Object.keys(row), ['id', 'surface', 'thread_id', 'card_id', 'run_id', 'proposed_kind', 'chosen_kind', 'at']);
  assert.deepEqual({ proposedKind: row.proposed_kind, chosenKind: row.chosen_kind, at: row.at, threadId: row.thread_id },
    { proposedKind: 'bug', chosenKind: 'idea', at: r.body.at, threadId: 'ask_00000001' });
  assert.ok(!JSON.stringify(row).includes('zebra'));
  const card = await post(body({ surface: 'run-card', cardId: 'card_00000001' }));
  assert.equal(card.status, 201);
  assert.equal(rows().at(-1).card_id, 'card_00000001');
  const run = await post({ surface: 'new-run', runId: 'run-20261114-abc', proposedKind: 'idea', chosenKind: 'plan' });
  assert.equal(run.status, 201);
  assert.deepEqual([rows().at(-1).run_id, rows().at(-1).thread_id], ['run-20261114-abc', null]);
});

test('the bucket: past 60 a minute answers 429 and writes nothing', async (t) => {
  await promptCheck(true);
  _setCorrectionBucketForTest(new TokenBucket(2, { now: () => 0 }));
  t.after(() => _setCorrectionBucketForTest(null));
  assert.equal((await post(body())).status, 201);
  assert.equal((await post(body())).status, 201);
  const n = rows().length;
  const r = await post(body());
  assert.equal(r.status, 429);
  assert.deepEqual(r.body, { error: 'too many corrections, try again in a moment' });
  assert.equal(rows().length, n);
});

test('the log line holds the surface and the time only: no id, no kind, no text', async (t) => {
  await promptCheck(true);
  const lines = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(keep)) console[k] = (...a) => lines.push(a.join(' '));
  t.after(() => Object.assign(console, keep));
  await post(body({ threadId: 'ask_zebra77', cardId: 'card_quokka', text: 'secret-yak' }));
  await post(body({ surface: 'evil-surface-name' }));
  Object.assign(console, keep);
  const ours = lines.filter((l) => l.includes('kind-correction'));
  assert.ok(ours.length >= 1);
  for (const l of ours) {
    assert.match(l, /^\[worca\] prompt-check kind-correction surface=(chat|shaper|run-card|new-run|unknown) \d+ms$/);
  }
  for (const l of lines) assert.ok(!/zebra77|quokka|secret-yak|evil-surface/.test(l), l);
  const src = readFileSync(new URL('../ui/routes/prompt-check/correction-route.mjs', import.meta.url), 'utf8');
  assert.equal((src.match(/console\.\w+/g) || []).length, 1);
});

function raw(headers, payload) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(payload);
    const r = http.request({ host: '127.0.0.1', port, path: URL_PATH, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, (resp) => {
      let b = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { b += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: b }));
    });
    r.on('error', rej);
    r.end(data);
  });
}

test('a foreign Host is refused with 403 and writes 0 rows; a cross-site Origin is refused too', async () => {
  await promptCheck(true);
  const n = rows().length;
  const host = await raw({ host: 'evil.example.com' }, body());
  assert.equal(host.status, 403);
  const origin = await raw({ host: `127.0.0.1:${port}`, origin: 'https://evil.example.com' }, body());
  assert.ok(origin.status >= 400);
  assert.equal(rows().length, n);
});
