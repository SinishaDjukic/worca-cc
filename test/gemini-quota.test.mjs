// test/gemini-quota.test.mjs — Gemini CLI's plan quota (src/core/gemini-quota.mjs): the Login-with-Google check, the
// two Code Assist requests behind the egress policy, the bucket choice, credential hygiene and the page-gated poller.
// Fixtures follow code_assist/types.ts: { buckets: [{ remainingAmount, remainingFraction, resetTime, tokenType, modelId }] }.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  geminiGoogleSignIn, noteGeminiModel, pickBucket, quotaReading, fetchGeminiQuota, createGeminiQuotaPoller, _resetGeminiQuotaForTests,
} from '../src/core/gemini-quota.mjs';
import { recordUsageReading, usageLimits, usageLimitsAnswer, _resetUsageLimitsForTests } from '../src/core/usage-limits.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after, 'worca-gemini-quota-');
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const TOKEN = 'ya29.SENTINEL-TOKEN-7f3a';
const EMAIL = 'sentinel.person@example.invalid';
const FOLDER = 'sentinel-folder-q9';
const PROJECT = 'sentinel-project-41';
const NOW = Date.parse('2026-11-18T12:00:00Z');
const RESET = '2026-11-19T00:00:00Z';
const BASE = 'https://cloudcode-pa.googleapis.com/v1internal:';

/** A temp HOME holding a Login-with-Google sign-in: settings.json and an anonymised oauth_creds.json. */
function googleHome({ authType = 'oauth-personal', expiry = NOW + 3_600_000, creds = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worca-gq-'));
  dirs.push(root);
  const home = path.join(root, FOLDER);
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ security: { auth: { selectedType: authType } } }));
  const idToken = `x.${Buffer.from(JSON.stringify({ email: EMAIL })).toString('base64url')}.y`;
  if (creds) fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), JSON.stringify({ access_token: TOKEN, refresh_token: 'r-SENTINEL',
    id_token: idToken, expiry_date: expiry, token_type: 'Bearer', scope: 'x' }));
  return home;
}

const buckets = (...b) => ({ buckets: b });
const bucket = (modelId, remainingFraction, resetTime = RESET) => ({ remainingAmount: '10', remainingFraction, resetTime, tokenType: 'REQUESTS', modelId });
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (n) => ({ ok: false, status: n, json: async () => ({}) });

/** A fake fetch: answers by URL; records every call (url, init) into `calls` and, if given, into `log`. */
function fakeFetch({ load = okJson({ cloudaicompanionProject: PROJECT }), quota = okJson(buckets(bucket('gemini-2.5-pro', 0.25))), log } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    log?.push(`fetch ${url.slice(BASE.length)}`);
    const r = url.endsWith(':loadCodeAssist') ? load : quota;
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r() : r;
  };
  return { fetch, calls };
}

beforeEach(() => { _resetGeminiQuotaForTests(); });

test('several model buckets', () => {
  const list = [bucket('gemini-2.5-pro', 0.9), bucket('gemini-2.5-flash', 0.2), bucket('broken', 'x')];
  assert.equal(pickBucket(list, 'gemini-2.5-pro').modelId, 'gemini-2.5-pro');
  assert.equal(pickBucket(list, null).modelId, 'gemini-2.5-flash', 'the most used');
  assert.equal(pickBucket(list, 'unknown-model').modelId, 'gemini-2.5-flash');
  assert.equal(pickBucket([bucket('a', null)], null), null);
  noteGeminiModel('gemini-2.5-pro');
  assert.equal(quotaReading(buckets(...list), { model: 'gemini-2.5-pro', now: NOW }).windows[0].pct, 10);
});

test('used share is one minus the share left', () => {
  assert.deepEqual(quotaReading(buckets(bucket('m', 0.25)), { now: NOW }),
    { observedAt: NOW, windows: [{ kind: 'day', pct: 75, resetsAt: Date.parse(RESET) }] });
  assert.equal(quotaReading({ buckets: 'nope' }, { now: NOW }), null);
  assert.equal(quotaReading(buckets(bucket('m', 0.5, 'not a time')), { now: NOW }), null);
});

test('geminiGoogleSignIn: Login with Google only', () => {
  const home = googleHome();
  const s = geminiGoogleSignIn({ HOME: home, GOOGLE_CLOUD_PROJECT: PROJECT });
  assert.equal(s.credsFile, path.join(home, '.gemini', 'oauth_creds.json'));
  assert.equal(s.project, PROJECT);
  assert.equal(geminiGoogleSignIn({ HOME: home }).project, null);
  assert.equal(geminiGoogleSignIn({ HOME: googleHome({ authType: 'gemini-api-key' }) }), null);
  assert.equal(geminiGoogleSignIn({ HOME: home, GEMINI_API_KEY: 'k' }), null);
});

test('a successful call: loadCodeAssist, then retrieveUserQuota with the project in the body', async () => {
  const f = fakeFetch();
  const r = await fetchGeminiQuota({ env: { HOME: googleHome() }, fetch: f.fetch, now: NOW });
  assert.deepEqual(r, { ok: true, reading: { observedAt: NOW, windows: [{ kind: 'day', pct: 75, resetsAt: Date.parse(RESET) }] } });
  assert.deepEqual(f.calls.map((c) => c.url), [`${BASE}loadCodeAssist`, `${BASE}retrieveUserQuota`]);
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { project: PROJECT });
});

test('an expired token makes no request', async () => {
  const f = fakeFetch();
  assert.deepEqual(await fetchGeminiQuota({ env: { HOME: googleHome({ expiry: NOW - 1 }) }, fetch: f.fetch, now: NOW }), { ok: false, why: 'expired' });
  assert.equal(f.calls.length, 0);
});

test('a missing or oversized creds file is no-token', async () => {
  const f = fakeFetch();
  assert.deepEqual(await fetchGeminiQuota({ env: { HOME: googleHome({ creds: false }) }, fetch: f.fetch, now: NOW }), { ok: false, why: 'no-token' });
  const big = googleHome();
  fs.writeFileSync(path.join(big, '.gemini', 'oauth_creds.json'), JSON.stringify({ access_token: TOKEN, pad: 'x'.repeat(70_000) }));
  assert.deepEqual(await fetchGeminiQuota({ env: { HOME: big }, fetch: f.fetch, now: NOW }), { ok: false, why: 'no-token' });
  assert.equal(f.calls.length, 0);
});

test('a creds path that is not a regular file is no-token and never blocks', async () => {
  const f = fakeFetch();
  const dir = googleHome({ creds: false });
  fs.mkdirSync(path.join(dir, '.gemini', 'oauth_creds.json'));
  assert.deepEqual(await fetchGeminiQuota({ env: { HOME: dir }, fetch: f.fetch, now: NOW }), { ok: false, why: 'no-token' });
  if (process.platform !== 'win32') {
    const fifo = googleHome({ creds: false });
    execFileSync('mkfifo', [path.join(fifo, '.gemini', 'oauth_creds.json')]);
    assert.deepEqual(await fetchGeminiQuota({ env: { HOME: fifo }, fetch: f.fetch, now: NOW }), { ok: false, why: 'no-token' });
  }
  assert.equal(f.calls.length, 0);
});

test('a 401 makes no new reading and keeps the last until its reset', async () => {
  _resetUsageLimitsForTests();
  recordUsageReading('gemini', { observedAt: NOW, windows: [{ kind: 'day', pct: 52, resetsAt: NOW + 3_600_000 }] }, { now: NOW });
  const run = (o) => fetchGeminiQuota({ env: { HOME: googleHome(), GOOGLE_CLOUD_PROJECT: PROJECT }, now: NOW, ...o });
  const r = await run({ fetch: fakeFetch({ quota: status(401) }).fetch });
  assert.deepEqual(r, { ok: false, why: 'http-401' });
  assert.equal(usageLimits({ now: NOW }).harnesses[0].windows[0].pct, 52);
  assert.deepEqual(await run({ fetch: fakeFetch({ quota: status(403) }).fetch }), { ok: false, why: 'http-403' });
  assert.deepEqual(await run({ fetch: fakeFetch({ quota: status(500) }).fetch }), { ok: false, why: 'http-error' });
});

test('a network error returns network; a bad response returns bad-response', async () => {
  const env = { HOME: googleHome(), GOOGLE_CLOUD_PROJECT: PROJECT };
  assert.deepEqual(await fetchGeminiQuota({ env, now: NOW, fetch: fakeFetch({ quota: new TypeError('fetch failed') }).fetch }), { ok: false, why: 'network' });
  assert.deepEqual(await fetchGeminiQuota({ env, now: NOW, fetch: fakeFetch({ quota: { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } } }).fetch }),
    { ok: false, why: 'bad-response' });
  assert.deepEqual(await fetchGeminiQuota({ env, now: NOW, fetch: fakeFetch({ quota: okJson({ buckets: [] }) }).fetch }), { ok: false, why: 'bad-response' });
});

test('an egress-refused host makes no request and no reading', async () => {
  const home = googleHome();
  for (const extra of [{ WORCA_EGRESS_MODE: 'allow' }, { WORCA_EGRESS_MODE: 'block', WORCA_EGRESS_DENY: 'cloudcode-pa.googleapis.com' },
    { WORCA_EGRESS_MODE: 'allow', WORCA_EGRESS_ALLOW: 'cloudcode-pa.googleapis.com', WORCA_EGRESS_DENY: '.googleapis.com' }]) {
    const f = fakeFetch();
    assert.deepEqual(await fetchGeminiQuota({ env: { HOME: home, ...extra }, fetch: f.fetch, now: NOW }), { ok: false, why: 'egress-refused' }, JSON.stringify(extra));
    assert.equal(f.calls.length, 0);
  }
  const f = fakeFetch();
  assert.equal((await fetchGeminiQuota({ env: { HOME: home, WORCA_EGRESS_MODE: 'block' }, fetch: f.fetch, now: NOW })).ok, true);
});

test('an allowed egress policy makes the call', async () => {
  const f = fakeFetch();
  const r = await fetchGeminiQuota({ env: { HOME: googleHome(), WORCA_EGRESS_MODE: 'allow', WORCA_EGRESS_ALLOW: 'cloudcode-pa.googleapis.com' }, fetch: f.fetch, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 2);
});

test('decide runs before each request', async () => {
  const log = [];
  const f = fakeFetch({ log });
  const decideHost = (host) => { log.push(`decide ${host}`); return { ok: true }; };
  await fetchGeminiQuota({ env: { HOME: googleHome() }, fetch: f.fetch, now: NOW, decideHost });
  assert.deepEqual(log, ['decide cloudcode-pa.googleapis.com', 'fetch loadCodeAssist', 'decide cloudcode-pa.googleapis.com', 'fetch retrieveUserQuota']);
  _resetGeminiQuotaForTests();
  let n = 0;
  const g = fakeFetch();
  const r = await fetchGeminiQuota({ env: { HOME: googleHome() }, fetch: g.fetch, now: NOW, decideHost: () => ({ ok: ++n < 2 }) });
  assert.deepEqual(r, { ok: false, why: 'egress-refused' });
  assert.equal(g.calls.length, 1);
});

test('API key, Vertex, GCA and encrypted storage make no call', async () => {
  const home = googleHome();
  for (const [extra, why] of [[{ GEMINI_API_KEY: 'k' }, 'no-sign-in'], [{ GOOGLE_API_KEY: 'k' }, 'no-sign-in'],
    [{ GOOGLE_GENAI_USE_VERTEXAI: 'true' }, 'no-sign-in'], [{ GOOGLE_GENAI_USE_GCA: 'true' }, 'no-sign-in'],
    [{ GEMINI_FORCE_ENCRYPTED_FILE_STORAGE: 'true' }, 'encrypted-storage']]) {
    const f = fakeFetch();
    assert.deepEqual(await fetchGeminiQuota({ env: { HOME: home, ...extra }, fetch: f.fetch, now: NOW }), { ok: false, why }, JSON.stringify(extra));
    assert.equal(f.calls.length, 0);
  }
  const f = fakeFetch();
  assert.deepEqual(await fetchGeminiQuota({ env: { HOME: googleHome({ authType: 'vertex-ai' }) }, fetch: f.fetch, now: NOW }), { ok: false, why: 'no-sign-in' });
  // An API key in the CLI's own .env file counts too.
  const dotenv = googleHome();
  fs.writeFileSync(path.join(dotenv, '.gemini', '.env'), 'GEMINI_API_KEY=k\n');
  assert.deepEqual(await fetchGeminiQuota({ env: { HOME: dotenv }, fetch: f.fetch, now: NOW }), { ok: false, why: 'no-sign-in' });
  assert.equal(f.calls.length, 0);
});

test('no project and loadCodeAssist failing returns no-project; GOOGLE_CLOUD_PROJECT skips loadCodeAssist', async () => {
  for (const load of [status(500), okJson({}), okJson({ cloudaicompanionProject: { id: 7 } })]) {
    _resetGeminiQuotaForTests();
    const f = fakeFetch({ load });
    assert.deepEqual(await fetchGeminiQuota({ env: { HOME: googleHome() }, fetch: f.fetch, now: NOW }), { ok: false, why: 'no-project' });
    assert.equal(f.calls.length, 1);
  }
  _resetGeminiQuotaForTests();
  const obj = fakeFetch({ load: okJson({ cloudaicompanionProject: { id: PROJECT } }) });
  assert.equal((await fetchGeminiQuota({ env: { HOME: googleHome() }, fetch: obj.fetch, now: NOW })).ok, true);
  const f = fakeFetch();
  assert.equal((await fetchGeminiQuota({ env: { HOME: googleHome(), GOOGLE_CLOUD_PROJECT: PROJECT }, fetch: f.fetch, now: NOW })).ok, true);
  assert.deepEqual(f.calls.map((c) => c.url), [`${BASE}retrieveUserQuota`]);
});

test('the token is sent only to the two Code Assist URLs', async () => {
  const f = fakeFetch();
  await fetchGeminiQuota({ env: { HOME: googleHome() }, fetch: f.fetch, now: NOW });
  _resetGeminiQuotaForTests();
  await fetchGeminiQuota({ env: { HOME: googleHome(), GOOGLE_CLOUD_PROJECT: PROJECT }, fetch: f.fetch, now: NOW });
  assert.equal(f.calls.length, 3);
  for (const { url, init } of f.calls) {
    assert.ok(url === `${BASE}loadCodeAssist` || url === `${BASE}retrieveUserQuota`, url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(!url.includes(PROJECT));
  }
  assert.ok(f.calls.filter((c) => c.url.endsWith(':retrieveUserQuota')).every((c) => JSON.parse(c.init.body).project === PROJECT));
});

test('loadCodeAssist runs once per process', async () => {
  const f = fakeFetch();
  const home = googleHome();
  assert.equal((await fetchGeminiQuota({ env: { HOME: home }, fetch: f.fetch, now: NOW })).ok, true);
  assert.equal((await fetchGeminiQuota({ env: { HOME: home }, fetch: f.fetch, now: NOW })).ok, true);
  assert.equal(f.calls.filter((c) => c.url.endsWith(':loadCodeAssist')).length, 1);
  assert.equal(f.calls.filter((c) => c.url.endsWith(':retrieveUserQuota')).length, 2);
});

test('a 401, 403 or 404 on the quota call drops the cached project, so the next call learns it again', async () => {
  const home = googleHome();
  for (const n of [401, 403, 404]) {
    _resetGeminiQuotaForTests();
    assert.equal((await fetchGeminiQuota({ env: { HOME: home }, fetch: fakeFetch().fetch, now: NOW })).ok, true);
    const failing = fakeFetch({ quota: status(n) });
    assert.equal((await fetchGeminiQuota({ env: { HOME: home }, fetch: failing.fetch, now: NOW })).ok, false);
    assert.equal(failing.calls.filter((c) => c.url.endsWith(':loadCodeAssist')).length, 0, 'the cached project was used');
    const next = fakeFetch({ load: okJson({ cloudaicompanionProject: 'other-project' }) });
    assert.equal((await fetchGeminiQuota({ env: { HOME: home }, fetch: next.fetch, now: NOW })).ok, true);
    assert.equal(next.calls.filter((c) => c.url.endsWith(':loadCodeAssist')).length, 1, `after ${n}`);
    assert.equal(JSON.parse(next.calls.at(-1).init.body).project, 'other-project');
  }
  _resetGeminiQuotaForTests();
  const env = { HOME: home, GOOGLE_CLOUD_PROJECT: 'env-project' };
  await fetchGeminiQuota({ env, fetch: fakeFetch({ quota: status(403) }).fetch, now: NOW });
  const after403 = fakeFetch();
  await fetchGeminiQuota({ env, fetch: after403.fetch, now: NOW });
  assert.equal(after403.calls.filter((c) => c.url.endsWith(':loadCodeAssist')).length, 0, 'an env project is never re-learned');
});

test('no token, email or home path in the store, the API answer or the log', async () => {
  _resetUsageLimitsForTests();
  const home = googleHome();
  const lines = [];
  const cases = [fakeFetch(), fakeFetch({ quota: status(401) }), fakeFetch({ load: status(500) })];
  for (const f of cases) {
    _resetGeminiQuotaForTests();
    const run = () => fetchGeminiQuota({ env: { HOME: home }, fetch: f.fetch, now: Date.now() });
    const fake = fakeTimers();
    const p = createGeminiQuotaPoller({ run, log: (l) => lines.push(l), now: () => fake.t, timers: fake });
    p.setPagePresent(true);
    await fake.settle();
    p.stop();
  }
  const store = fs.readFileSync(path.join(worcaHome(), 'usage-limits.json'), 'utf8');
  const all = [store, JSON.stringify(usageLimitsAnswer({ now: NOW })), lines.join('\n')].join('\n');
  assert.ok(lines.length >= 2, lines.join('\n'));
  for (const s of [TOKEN, EMAIL, FOLDER, 'SENTINEL']) assert.ok(!all.includes(s), s);
});

test('the creds file bytes and mtime are unchanged', async () => {
  const home = googleHome();
  const file = path.join(home, '.gemini', 'oauth_creds.json');
  const before = { bytes: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtimeMs };
  await fetchGeminiQuota({ env: { HOME: home }, fetch: fakeFetch().fetch, now: NOW });
  await fetchGeminiQuota({ env: { HOME: home }, fetch: fakeFetch({ quota: status(401) }).fetch, now: NOW });
  await fetchGeminiQuota({ env: { HOME: home }, fetch: fakeFetch().fetch, now: NOW + 10 * 3_600_000 });
  assert.deepEqual({ bytes: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtimeMs }, before);
});

// ── poller ───────────────────────────────────────────────────────────────────

/** Fake timers: setInterval/clearInterval on a manual clock; `advance(ms)` fires due ticks. */
function fakeTimers() {
  const fake = {
    t: 1_000_000, timers: new Map(), next: 1,
    setInterval(fn, ms) { const id = fake.next++; fake.timers.set(id, { fn, ms, at: fake.t + ms }); return id; },
    clearInterval(id) { fake.timers.delete(id); },
    async settle() { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); },
    async advance(ms) {
      const end = fake.t + ms;
      for (;;) {
        const due = [...fake.timers.values()].filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        fake.t = due.at; due.at += due.ms; due.fn();
        await fake.settle();
      }
      fake.t = end;
      await fake.settle();
    },
  };
  return fake;
}

function counted(result = { ok: true, reading: { observedAt: NOW, windows: [{ kind: 'day', pct: 10, resetsAt: NOW + 1 }] } }) {
  const c = { n: 0 };
  c.run = async () => { c.n += 1; return typeof result === 'function' ? result() : result; };
  return c;
}

test('poller: no page, no call', async () => {
  const fake = fakeTimers();
  const c = counted();
  const p = createGeminiQuotaPoller({ run: c.run, record: () => {}, log: () => {}, now: () => fake.t, timers: fake });
  await fake.advance(5 * 60_000);
  assert.equal(c.n, 0);
  p.stop();
});

test('poller: 10 page sockets make one call per minute', async () => {
  const fake = fakeTimers();
  const c = counted();
  const recorded = [];
  const p = createGeminiQuotaPoller({ run: c.run, record: (e, r) => recorded.push(e), log: () => {}, now: () => fake.t, timers: fake });
  for (let i = 0; i < 10; i += 1) p.setPagePresent(true);
  await fake.settle();
  assert.equal(c.n, 1);
  await fake.advance(60_000);
  assert.equal(c.n, 2);
  await fake.advance(120_000);
  assert.equal(c.n, 4);
  assert.deepEqual([...new Set(recorded)], ['gemini']);
  p.stop();
});

test('poller: a page reopened within the minute makes no extra call', async () => {
  const fake = fakeTimers();
  const c = counted();
  const p = createGeminiQuotaPoller({ run: c.run, record: () => {}, log: () => {}, now: () => fake.t, timers: fake });
  p.setPagePresent(true);
  await fake.settle();
  await fake.advance(10_000);
  p.setPagePresent(false);
  p.setPagePresent(true);
  await fake.settle();
  assert.equal(c.n, 1);
  p.stop();
});

test('poller: the last page closing stops the timer', async () => {
  const fake = fakeTimers();
  const c = counted();
  const p = createGeminiQuotaPoller({ run: c.run, record: () => {}, log: () => {}, now: () => fake.t, timers: fake });
  p.setPagePresent(true);
  await fake.settle();
  p.setPagePresent(false);
  await fake.advance(5 * 60_000);
  assert.equal(c.n, 1);
  assert.equal(fake.timers.size, 0);
  p.stop();
});

test('poller: one log line per change of why; a failure records nothing', async () => {
  const fake = fakeTimers();
  let why = 'expired';
  const c = counted(() => ({ ok: false, why }));
  const lines = [];
  const recorded = [];
  const p = createGeminiQuotaPoller({ run: c.run, record: (...a) => recorded.push(a), log: (l) => lines.push(l), now: () => fake.t, timers: fake });
  p.setPagePresent(true);
  await fake.settle();
  await fake.advance(60_000);
  assert.equal(c.n, 2);
  assert.deepEqual(lines, ['[usage] Gemini quota: no reading (expired)']);
  why = 'http-401';
  await fake.advance(60_000);
  assert.deepEqual(lines, ['[usage] Gemini quota: no reading (expired)', '[usage] Gemini quota: no reading (http-401)']);
  assert.equal(recorded.length, 0);
  p.stop();
});

test('poller: one call in flight', async () => {
  const fake = fakeTimers();
  let release;
  const c = { n: 0, run: () => { c.n += 1; return new Promise((r) => { release = () => r({ ok: false, why: 'network' }); }); } };
  const p = createGeminiQuotaPoller({ run: c.run, record: () => {}, log: () => {}, now: () => fake.t, timers: fake });
  p.setPagePresent(true);
  await fake.advance(3 * 60_000);
  assert.equal(c.n, 1);
  release();
  await fake.settle();
  await fake.advance(60_000);
  assert.equal(c.n, 2);
  p.stop();
});
