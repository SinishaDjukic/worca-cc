import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeDelayMs, waitForNetwork, networkResumeEligible, createNetworkWatch, NETWORK_ACTOR } from '../src/core/network-wait.mjs';

/** A clock whose sleep advances time instantly (and honours an abort). */
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, sleep: async (ms, signal) => { if (!signal?.aborted) t += ms; }, advance: (ms) => { t += ms; } };
}

test('probeDelayMs: 5s, 10s, 20s, 40s, then 60s; the env base pins it', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => probeDelayMs(n, {})), [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.equal(probeDelayMs(3, { WORCA_NETWORK_PROBE_MS: '0' }), 0);
  assert.equal(probeDelayMs(2, { WORCA_NETWORK_PROBE_MS: '10' }), 20);
});

test('waitForNetwork: back on the first passing probe', async () => {
  const c = fakeClock(); let n = 0;
  const out = await waitForNetwork({ probe: async () => ++n >= 3, until: 3_600_000, now: c.now, sleep: c.sleep, env: {} });
  assert.equal(out, 'back'); assert.equal(n, 3); assert.equal(c.now(), 5000 + 10000 + 20000);
});

test('waitForNetwork: timeout once the deadline passes; never sleeps past it', async () => {
  const c = fakeClock();
  const out = await waitForNetwork({ probe: async () => false, until: 12_000, now: c.now, sleep: c.sleep, env: {} });
  assert.equal(out, 'timeout'); assert.equal(c.now(), 12_000);
});

test('waitForNetwork: an abort (pause / stop) and a switched-off setting end it', async () => {
  const c = fakeClock(); const ac = new AbortController();
  const p = waitForNetwork({ probe: async () => { ac.abort(); return false; }, until: 1e9, now: c.now, sleep: c.sleep, signal: ac.signal, env: {} });
  assert.equal(await p, 'aborted');
  assert.equal(await waitForNetwork({ probe: async () => false, until: 1e9, now: c.now, sleep: c.sleep, isEnabled: () => false, env: {} }), 'disabled');
});

const H = 3_600_000;
const row = (status, rp) => ({ id: 'p1', status, resumePoint: rp });
const netRp = (over = {}) => ({ pauseReason: 'recoverable', pauseClass: 'network',
  network: { since: new Date(0).toISOString(), origin: 'https://api.anthropic.com', reachable: false, waiting: false }, ...over });

test('networkResumeEligible: only network pauses parked while unreachable, or runs that died waiting, inside the window', () => {
  const at = { now: H, maxWaitMs: 4 * H };
  assert.equal(networkResumeEligible(row('paused', netRp()), at), true);
  assert.equal(networkResumeEligible(row('paused', netRp()), { now: 5 * H, maxWaitMs: 4 * H }), false, 'window closed');
  assert.equal(networkResumeEligible(row('paused', netRp({ network: { ...netRp().network, reachable: true } })), at), false, 'reachable: would loop');
  for (const pauseReason of [null, 'error', 'usage_limit', 'cost_pipeline', 'cost_total', 'night_guardrail'])
    assert.equal(networkResumeEligible(row('paused', netRp({ pauseReason })), at), false, String(pauseReason));
  for (const pauseClass of ['auth', 'quota', 'rate_limit', 'model', undefined])
    assert.equal(networkResumeEligible(row('paused', netRp({ pauseClass })), at), false, String(pauseClass));
  assert.equal(networkResumeEligible(row('paused', { pauseReason: 'recoverable', pauseDetail: 'network: ECONNRESET' }), at), false, 'legacy: no since');
  assert.equal(networkResumeEligible(row('interrupted', netRp({ pauseReason: null, network: { ...netRp().network, waiting: true } })), at), true);
  assert.equal(networkResumeEligible(row('interrupted', netRp({ pauseReason: null })), at), false, 'died, but not while waiting');
  assert.equal(networkResumeEligible(row('stopped', netRp()), at), false);
});

test('createNetworkWatch: probes each origin once, resumes only eligible rows, skips scheduled resumes, logs a refusal once', async () => {
  const rows = [
    row('paused', netRp()), { ...row('paused', netRp()), id: 'p2' }, { ...row('paused', netRp()), id: 'p3' },
    { ...row('paused', netRp({ pauseReason: 'cost_pipeline' })), id: 'p4' },
  ];
  const probes = []; const resumed = []; const logs = [];
  const watch = createNetworkWatch({
    settings: () => ({ enabled: true, maxWaitMs: 4 * H }), now: () => H,
    listRuns: () => rows, hasResumeTicket: (id) => id === 'p2',
    probe: async (o) => { probes.push(o); return true; },
    resume: async (r) => { if (r.id === 'p3') throw Object.assign(new Error('x'), { body: { error: 'total cost limit reached' } }); resumed.push(r.id); },
    log: (m) => logs.push(m),
  });
  assert.deepEqual(await watch.tick(), ['p1']);
  await watch.tick();
  assert.deepEqual(probes, ['https://api.anthropic.com', 'https://api.anthropic.com'], 'one probe per origin per pass');
  assert.equal(logs.filter((l) => /p3: total cost limit reached/.test(l)).length, 1, 'same refusal logged once');
});

test('createNetworkWatch: off, or the probe still failing, resumes nothing', async () => {
  const base = { now: () => H, listRuns: () => [row('paused', netRp())], hasResumeTicket: () => false, resume: async () => { throw new Error('must not resume'); } };
  assert.deepEqual(await createNetworkWatch({ ...base, settings: () => ({ enabled: false, maxWaitMs: 4 * H }), probe: async () => true }).tick(), []);
  assert.deepEqual(await createNetworkWatch({ ...base, settings: () => ({ enabled: true, maxWaitMs: 4 * H }), probe: async () => false }).tick(), []);
});

test('NETWORK_ACTOR is a non-person actor label', () => { assert.equal(NETWORK_ACTOR, 'worca (network watch)'); });
