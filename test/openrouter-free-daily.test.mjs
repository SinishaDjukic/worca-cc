// test/openrouter-free-daily.test.mjs
// OpenRouter's daily allowance of `:free` requests:
//  A. the daily-limit 429 is a usage limit — the run pauses at once, naming the reset,
//     instead of retrying as a rate limit (recoverable-error.mjs, failure-policy.mjs, the
//     bridge's error mapping);
//  B. the counter (openrouter-free.mjs): OpenRouter's /key reading, lowered per `:free`
//     call the bridge forwards, emptied by a daily-limit refusal; and its UI helpers.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyError, isFreeDailyLimit, freeDailyResetAt, freeDailyHint, untilText, rateLimitHint } from '../src/core/recoverable-error.mjs';
import { resolveFailure, REASON } from '../src/core/failure-policy.mjs';
import { mapUpstreamError } from '../src/core/bridge/errors.mjs';
import { recordBridgeCall, recordBridgeError, bridgeCallsFor, _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';
import { isOpenRouterFree, keyAccount, nextUtcMidnight, freeDailyStatus, freeModelIds, cachedFreeDailyCounts, _resetFreeDaily } from '../src/core/openrouter-free.mjs';
import { freeLevel, runFreeRequests, freeRequestsSuffix, typicalFreeRun, newRunFreeWarning, providerFreeLine, renderFreeDaily, FREE_RUN_DEFAULT } from '../ui/public/openrouter-free-view.mjs';
import { hintFor } from '../src/core/model-test.mjs';

// The exact line worca-01's run log showed on 2026-09-26 when the allowance ran out.
const WORCA01 = 'claude exited with code 1: API Error: Request rejected (429) · openai: rate limited (429) — Rate limit exceeded: free-models-per-day-high-balance.  [openrouter_free_tier_daily]';
const SHARED_POOL = 'API Error: 429 · openai: rate limited (429) via Chutes — temporarily rate-limited upstream [upstream_provider_shared_pool]';

afterEach(() => { _resetFreeDaily(); _resetBridgeTelemetry(); });

// ── A: the daily limit is a usage limit ─────────────────────────────────────

test('A: the daily-limit 429 classifies as usage_limit; the shared-pool 429 stays rate_limit', () => {
  assert.equal(classifyError(new Error(WORCA01)), 'usage_limit');
  assert.equal(classifyError('Rate limit exceeded: free-models-per-day'), 'usage_limit');
  assert.equal(isFreeDailyLimit(WORCA01), true);
  assert.equal(classifyError(new Error(SHARED_POOL)), 'rate_limit');
  assert.equal(isFreeDailyLimit(SHARED_POOL), false);
  assert.match(rateLimitHint(new Error(SHARED_POOL)), /shared free pool/);
});

test('A: usage_limit pauses at once in every mode and site — no retries, no recovery prompt', () => {
  for (const site of ['node', 'setup', 'shell']) {
    for (const auto of [true, false]) {
      assert.deepEqual({ ...resolveFailure({ site, cls: 'usage_limit', auto }) }, { outcome: 'pause', reason: REASON.USAGE_LIMIT }, `${site} auto=${auto}`);
    }
  }
  // Other setup failures keep pausing as errors.
  assert.equal(resolveFailure({ site: 'setup', cls: 'network', auto: true }).reason, REASON.ERROR);
});

test('A: the reset — the one OpenRouter names, else the next 00:00 UTC', () => {
  const now = Date.parse('2026-09-26T21:01:26Z');
  assert.equal(freeDailyResetAt(WORCA01, now), Date.parse('2026-09-27T00:00:00Z'));
  const named = `${WORCA01} resets 2026-09-27T00:00:00.000Z`;
  assert.equal(freeDailyResetAt(named, now), Date.parse('2026-09-27T00:00:00Z'));
  assert.equal(freeDailyResetAt('free-models-per-day resets 2026-09-26T00:00:00Z', now), Date.parse('2026-09-27T00:00:00Z'), 'a reset in the past is ignored');
  assert.equal(untilText(3 * 3_600_000 + 12 * 60_000), '3h 12m');
  assert.equal(untilText(12 * 60_000), '12m');
  assert.equal(untilText(10_000), 'under a minute');
});

test('A: the pause text names what ran out, the count, the reset and the two ways on', () => {
  const now = Date.parse('2026-09-26T20:48:00Z');
  assert.equal(freeDailyHint(new Error(WORCA01), { now, used: 1000, limit: 1000 }),
    "OpenRouter's free-model requests for today are used up (1000 / 1000) — they reset at 00:00 UTC, in 3h 12m. Resume after the reset, or switch this step to a paid model");
  assert.match(freeDailyHint(WORCA01, { now }), /used up — they reset at 00:00 UTC/);
  assert.equal(freeDailyHint(new Error(SHARED_POOL), { now }), '');
});

test('A: the bridge keeps the limit source and OpenRouter\'s reset time in the 429 it answers', () => {
  const body = JSON.stringify({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day-high-balance. ',
    metadata: { limit_source: 'openrouter_free_tier_daily', headers: { 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Date.parse('2026-09-27T00:00:00Z')) } } } });
  const e = mapUpstreamError(429, body, { provider: 'openai' });
  assert.equal(e.status, 429);
  const msg = e.body.error.message;
  assert.match(msg, /free-models-per-day-high-balance/);
  assert.match(msg, /\[openrouter_free_tier_daily\] resets 2026-09-27T00:00:00\.000Z$/);
  assert.equal(classifyError(msg), 'usage_limit');
  assert.equal(freeDailyResetAt(msg, Date.parse('2026-09-26T21:00:00Z')), Date.parse('2026-09-27T00:00:00Z'));
  // Without headers: as before.
  const plain = mapUpstreamError(429, JSON.stringify({ error: { message: 'x', metadata: { limit_source: 'upstream_provider_shared_pool' } } }), { provider: 'openai' });
  assert.match(plain.body.error.message, /\[upstream_provider_shared_pool\]$/);
});

test('A: Models › Test names the daily allowance', () => {
  assert.match(hintFor('usage_limit'), /usage limit/);
});

// ── B: the counter ──────────────────────────────────────────────────────────

test('B: which calls are free, whose key, and the reset clock', () => {
  assert.equal(isOpenRouterFree({ model: 'nvidia/nemotron-3-super:free', baseUrl: 'https://openrouter.ai/api/v1' }), true);
  assert.equal(isOpenRouterFree({ model: 'nvidia/nemotron-3-super', baseUrl: 'https://openrouter.ai/api/v1' }), false);
  assert.equal(isOpenRouterFree({ model: 'x:free', baseUrl: 'https://api.openai.com/v1' }), false);
  const a = keyAccount('sk-or-v1-abc');
  assert.match(a, /^key:[0-9a-f]{16}$/);
  assert.ok(!a.includes('abc'));
  assert.equal(keyAccount(''), null);
  assert.equal(nextUtcMidnight(Date.parse('2026-09-26T23:59:59Z')), Date.parse('2026-09-27T00:00:00Z'));
});

test('B: the bridge counts every :free call per run, continuations too', () => {
  recordBridgeCall({ tag: 'x1', catalogId: 'm', provider: 'openai', api: 'openai-chat', initiator: 'user', free: true });
  recordBridgeCall({ tag: 'x1', catalogId: 'm', provider: 'openai', api: 'openai-chat', initiator: 'agent', free: true });
  recordBridgeCall({ tag: 'x1', catalogId: 'p', provider: 'openai', api: 'openai-chat', initiator: 'user' });
  assert.deepEqual(bridgeCallsFor('x1'), { initiated: 2, continued: 1, errors: 0, free: 2 });
});

async function withSettings(settings, fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-orfree-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, BROKER: process.env.WORCA_BROKER_URL };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_BROKER_URL;
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify(settings), 'utf8');
  try { return await fn(); } finally {
    for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW], ['WORCA_BROKER_URL', prev.BROKER]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await rm(home, { recursive: true, force: true });
  }
}

const OR_SETTINGS = {
  providers: { openai: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-v1-testkey0000000000000001' } },
  models: [
    { id: 'nemo-free', label: 'Nemotron free', upstream: { provider: 'openai', api: 'openai-chat', model: 'nvidia/nemotron-3-super:free' } },
    { id: 'nemo', label: 'Nemotron', upstream: { provider: 'openai', api: 'openai-chat', model: 'nvidia/nemotron-3-super' } },
  ],
};

function fakeKeyFetch(reads) {
  return async (url, init) => {
    reads.push({ url, auth: init?.headers?.authorization });
    return new Response(JSON.stringify({ data: { limit: 10, usage: 0, free_model_daily_requests: { used: 59, limit: 1000, remaining: 941 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('B: no :free model in the catalog — nothing to show, nothing read', async () => {
  await withSettings({ ...OR_SETTINGS, models: [OR_SETTINGS.models[1]] }, async () => {
    const reads = [];
    assert.deepEqual(await freeDailyStatus({ fetch: fakeKeyFetch(reads) }), { enabled: false });
    assert.equal(reads.length, 0);
  });
});

test('B: a reading, lowered per forwarded :free call, emptied by a daily-limit refusal, read again after the TTL', async () => {
  await withSettings(OR_SETTINGS, async () => {
    assert.deepEqual(freeModelIds(), ['nemo-free']);
    const reads = [];
    // The fake clock sits on the REAL UTC day: the bridge's call listener lowers the
    // count with the real clock, and a fixed date turned every later day into "a new
    // day, drop the reading" (this test started failing the day after it was written).
    const today = nextUtcMidnight(Date.now()) - 86_400_000;
    let t = today + (4 * 60 + 39) * 60_000;
    const now = () => t;
    const s1 = await freeDailyStatus({ fetch: fakeKeyFetch(reads), now });
    assert.equal(reads.length, 1);
    assert.equal(reads[0].url, 'https://openrouter.ai/api/v1/key');
    assert.equal(reads[0].auth, 'Bearer sk-or-v1-testkey0000000000000001');
    assert.deepEqual({ ...s1, readAt: undefined }, { enabled: true, known: true, models: ['nemo-free'], used: 59, limit: 1000, remaining: 941, resetAt: new Date(today + 86_400_000).toISOString(), readAt: undefined });

    // Two :free calls through the bridge with this key, one with another key, one not free.
    const account = keyAccount('sk-or-v1-testkey0000000000000001');
    recordBridgeCall({ tag: 't', catalogId: 'nemo-free', provider: 'openai', api: 'openai-chat', initiator: 'user', free: true, account });
    recordBridgeCall({ tag: 't', catalogId: 'nemo-free', provider: 'openai', api: 'openai-chat', initiator: 'agent', free: true, account });
    recordBridgeCall({ tag: 't', catalogId: 'x', provider: 'openai', api: 'openai-chat', initiator: 'user', free: true, account: keyAccount('other') });
    recordBridgeCall({ tag: 't', catalogId: 'nemo', provider: 'openai', api: 'openai-chat', initiator: 'user', free: false, account });
    const s2 = await freeDailyStatus({ fetch: fakeKeyFetch(reads), now });
    assert.equal(reads.length, 1, 'within the TTL: no second reading');
    assert.equal(s2.remaining, 939);
    assert.equal(s2.used, 61);
    assert.deepEqual(cachedFreeDailyCounts(), { used: 61, limit: 1000 });

    recordBridgeError({ tag: 't', catalogId: 'nemo-free', provider: 'openai', status: 429, message: WORCA01, account });
    assert.equal((await freeDailyStatus({ fetch: fakeKeyFetch(reads), now })).remaining, 0);

    t += 6 * 60_000;
    const s4 = await freeDailyStatus({ fetch: fakeKeyFetch(reads), now });
    assert.equal(reads.length, 2, 'after the TTL OpenRouter is asked again and corrects the count');
    assert.equal(s4.remaining, 941);
    await freeDailyStatus({ fetch: fakeKeyFetch(reads), now, force: true });
    assert.equal(reads.length, 3, 'force reads now');
  });
});

test('B: a key OpenRouter answers without an allowance, and no key at all', async () => {
  await withSettings(OR_SETTINGS, async () => {
    const f = async () => new Response(JSON.stringify({ data: { limit: null, usage: 1 } }), { status: 200 });
    const s = await freeDailyStatus({ fetch: f });
    assert.equal(s.enabled, true);
    assert.equal(s.known, false);
  });
  await withSettings({ ...OR_SETTINGS, providers: { openai: { baseUrl: 'https://openrouter.ai/api/v1' } } }, async () => {
    const s = await freeDailyStatus({ fetch: async () => { throw new Error('must not be called'); } });
    assert.deepEqual(s, { enabled: true, known: false, models: ['nemo-free'], reason: 'no OpenRouter key to read' });
  });
});

// ── B: the UI helpers ───────────────────────────────────────────────────────

const KNOWN = (remaining, limit = 1000) => ({ enabled: true, known: true, used: limit - remaining, limit, remaining, resetAt: '2026-09-28T00:00:00.000Z' });

test('B UI: level, per-run count, typical run', () => {
  assert.equal(freeLevel(KNOWN(941)), 'ok');
  assert.equal(freeLevel(KNOWN(99)), 'low');
  assert.equal(freeLevel(KNOWN(0)), 'out');
  const steps = [{ bridgeFreeCalls: 40 }, { bridgeFreeCalls: 47 }, { bridgeCalls: 3 }];
  assert.equal(runFreeRequests(steps), 87);
  assert.equal(freeRequestsSuffix(steps), ' · 87 free requests');
  assert.equal(freeRequestsSuffix([{ bridgeFreeCalls: 1 }]), ' · 1 free request');
  assert.equal(freeRequestsSuffix([]), '');
  assert.equal(typicalFreeRun([]), FREE_RUN_DEFAULT);
  const runs = [80, 90, 400].map((n) => ({ status: 'completed', steps: [{ bridgeFreeCalls: n }] }));
  runs.push({ status: 'running', steps: [{ bridgeFreeCalls: 5 }] });
  assert.equal(typicalFreeRun(runs), 90);
});

test('B UI: the new-run warning, the Providers line', () => {
  const now = Date.parse('2026-09-27T20:48:00Z');
  assert.equal(newRunFreeWarning(KNOWN(941), { usesFree: true, now }), null);
  assert.equal(newRunFreeWarning(KNOWN(42), { usesFree: false, now }), null, 'no :free model chosen');
  assert.equal(newRunFreeWarning(KNOWN(42), { usesFree: true, typical: 90, now }),
    '42 OpenRouter free requests left today (resets 00:00 UTC, in 3h 12m); a run here usually needs ~90.');
  assert.match(newRunFreeWarning(KNOWN(0), { usesFree: true, now }), /^No OpenRouter free requests left today .*Pick a paid model/);
  assert.equal(providerFreeLine(KNOWN(941), { now }), 'Free-model requests today: 941 of 1000 left · resets 00:00 UTC (in 3h 12m).');
  assert.equal(providerFreeLine({ enabled: true, known: false }), '');
});

test('B UI: the sidebar block', () => {
  const made = [];
  const doc = {
    createElement(tag) {
      const e = { tag, className: '', textContent: '', title: '', type: '', style: {}, children: [],
        append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); } };
      made.push(e);
      return e;
    },
  };
  assert.equal(renderFreeDaily({ enabled: false }, { doc }), null);
  assert.equal(renderFreeDaily({ enabled: true, known: false }, { doc }), null);
  const now = Date.parse('2026-09-27T20:48:00Z');
  const ok = renderFreeDaily(KNOWN(941), { doc, now });
  assert.equal(ok.className, 'spend-ind free-ind');
  const text = (e) => [e.textContent, ...(e.children || []).map(text)].join(' ');
  assert.match(text(ok), /OpenRouter free today 941 \/ 1000/);
  assert.match(ok.title, /resets 00:00 UTC, in 3h 12m/);
  assert.equal(renderFreeDaily(KNOWN(50), { doc, now }).className, 'spend-ind free-ind warn');
  const out = renderFreeDaily(KNOWN(0), { doc, now });
  assert.equal(out.className, 'spend-ind free-ind over');
  assert.match(text(out), /used up/);
});
