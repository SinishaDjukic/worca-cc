// test/github-quota.test.mjs
// The machine-wide GitHub quota window (src/core/github-quota.mjs) and the gate every read-only gh
// call in git-info passes through (F-X-02, C-2). gh is never spawned for real: every call goes through
// git-info's test runner, and the quota file lives in a temp dir (useDir).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  quotaBlocked, noteQuotaExhausted, quotaPath, isRateLimitText, formatResetTime, _testing as quota,
} from '../src/core/github-quota.mjs';
import { _testing as cache, prStatusKey, writePrStatus } from '../src/core/pr-status-cache.mjs';
import {
  lookupPrForBranch, findPrForBranch, prChecks, prMergeable, prLifecycleState, prWatchSnapshot, ghItemSummaries,
  createPr, prMerge, prWatchReply, ghApi, _testing as gitInfo,
} from '../src/core/git-info.mjs';
import { checkRows } from './helpers/rows.mjs';

const MIN = 60_000;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-quota-')); dirs.push(d); return d; };
afterEach(() => {
  gitInfo.reset(); quota.reset(); cache.reset();
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

test('F-X-02: the quota window file', async () => {
  await checkRows([
    { name: 'F-X-02: a recorded window blocks until the reset and never shortens a later one', run: () => {
      quota.useDir(tmp());
      assert.equal(quotaBlocked('graphql', { now: NOW }), null);
      const { until } = noteQuotaExhausted('graphql', { resetAt: NOW + 30 * MIN, now: NOW });
      assert.equal(until, NOW + 30 * MIN);
      assert.deepEqual(quotaBlocked('graphql', { now: NOW + 29 * MIN }), { until: NOW + 30 * MIN });
      assert.equal(quotaBlocked('graphql', { now: NOW + 30 * MIN }), null, 'open again at the reset');
      assert.equal(quotaBlocked('core', { now: NOW }), null, 'core has its own window');
      assert.equal(noteQuotaExhausted('graphql', { resetAt: NOW + 10 * MIN, now: NOW }).until, NOW + 30 * MIN, 'never shortened');
      assert.deepEqual(quotaBlocked('graphql', { now: NOW + 20 * MIN }), { until: NOW + 30 * MIN });
    } },
    { name: 'F-X-02: the window is clamped to 5 s … 60 min; fallback 15 min', run: () => {
      quota.useDir(tmp());
      assert.equal(noteQuotaExhausted('graphql', { resetAt: NOW - 1000, now: NOW }).until, NOW + 5_000);
      quota.useDir(tmp());
      assert.equal(noteQuotaExhausted('graphql', { resetAt: NOW + 5 * 60 * MIN, now: NOW }).until, NOW + 60 * MIN);
      quota.useDir(tmp());
      assert.equal(noteQuotaExhausted('core', { now: NOW }).until, NOW + 15 * MIN);
      const file = JSON.parse(readFileSync(quotaPath(), 'utf8'));
      assert.equal(file.v, 1);
      assert.equal(file.core.source, 'fallback');
    } },
    { name: 'F-X-02: a second process reads the same window', run: () => {
      const dir = tmp();
      quota.useDir(dir);
      noteQuotaExhausted('graphql', { resetAt: NOW + 20 * MIN, now: NOW });
      quota.reset();                                 // memory cleared: only the file can answer
      quota.useDir(dir);
      assert.deepEqual(quotaBlocked('graphql', { now: NOW }), { until: NOW + 20 * MIN });
    } },
    { name: 'suspended → no file written', run: () => {
      const dir = tmp();
      quota.useDir(dir);
      quota.suspend();
      assert.equal(noteQuotaExhausted('graphql', { now: NOW }).until, NOW + 15 * MIN);
      assert.equal(existsSync(join(dir, 'quota.json')), false);
      assert.equal(quotaBlocked('graphql', { now: NOW }), null);
    } },
    { name: 'bad JSON reads as no window', run: () => {
      const dir = tmp();
      quota.useDir(dir);
      writeFileSync(join(dir, 'quota.json'), '{not json');
      assert.equal(quotaBlocked('graphql', { now: NOW }), null);
      writeFileSync(join(dir, 'quota.json'), JSON.stringify({ v: 9, graphql: { until: NOW + MIN } }));
      assert.equal(quotaBlocked('graphql', { now: NOW }), null, 'an unknown version is empty');
      assert.equal(noteQuotaExhausted('graphql', { resetAt: NOW + MIN, now: NOW }).until, NOW + MIN, 'and is overwritten');
    } },
    { name: 'isRateLimitText and formatResetTime', run: () => {
      assert.equal(isRateLimitText('GraphQL: API rate limit exceeded for user'), true);
      assert.equal(isRateLimitText('You have exceeded a secondary rate limit'), true);
      assert.equal(isRateLimitText('abuse detection mechanism'), true);
      assert.equal(isRateLimitText('HTTP 404: Not Found'), false);
      assert.match(formatResetTime(NOW), /^\d\d:\d\d$/);
    } },
  ]);
});

// ── The gate in git-info ─────────────────────────────────────────────────────

const ok = (v) => Promise.resolve({ ok: true, stdout: typeof v === 'string' ? v : JSON.stringify(v), stderr: '', code: 0 });
const LIMITED = { ok: false, stdout: '', stderr: 'GraphQL: API rate limit exceeded for user ID 1.', code: 1 };
const RATE = { resources: { core: { limit: 5000, remaining: 4000, reset: 0 }, graphql: { limit: 5000, remaining: 0, reset: Math.floor((NOW + 40 * MIN) / 1000) } } };

/** Opt one test into the shared stores (setRunner suspends them). */
function optIn() { const d = tmp(); quota.useDir(d); cache.useDir(d); return d; }

test('F-X-02/C-2: a quota error keeps the last state and schedules no burst of retries', async () => {
  let now = NOW;
  let limited = false;
  const gh = [];
  // A GHE base remote: the key is shared (slug ghe.corp/o/r) and the lookup stays on gh pr list (graphql).
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'git' && args[0] === 'remote') return ok('origin\tgit@ghe.corp:o/r.git (fetch)\norigin\tgit@ghe.corp:o/r.git (push)\n');
    if (cmd !== 'gh') return ok('');
    gh.push(args.join(' '));
    if (args[0] === 'api' && args[1] === 'rate_limit') return ok(RATE);
    if (args[1] === 'list') {
      if (limited) return Promise.resolve(LIMITED);
      const head = args[args.indexOf('--head') + 1];
      return ok(head === 'b0' ? [{ number: 9, state: 'MERGED', url: 'https://ghe.corp/o/r/pull/9' }] : []);
    }
    return ok('');
  });
  gitInfo.setNow(() => now);
  optIn();
  // b0: a MERGED PR, found once and final from then on.
  assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'b0' })).pr.state, 'MERGED');
  // b1: an OPEN PR seen 11 minutes ago (by any process): stale, so it is asked again.
  const open = { state: 'OPEN', url: 'https://ghe.corp/o/r/pull/11', number: 11, isDraft: false, mergeable: 'MERGEABLE' };
  await writePrStatus(prStatusKey({ repo: 'ghe.corp/o/r', head: 'b1' }), { checkedAt: NOW - 11 * MIN, live: open, closed: null, verdict: null });
  gh.length = 0;
  limited = true;
  const r = await lookupPrForBranch({ projectDir: '/r', head: 'b1' });
  assert.deepEqual(r, { ok: false, reason: 'quota', last: open, retryAt: NOW + 40 * MIN });
  assert.equal(gh.filter((c) => c === 'api rate_limit').length, 1, 'exactly one rate_limit probe');
  assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'b1' }), open, 'findPrForBranch keeps the last state (C-2)');
  // 20 more lookups over several branches: no gh spawn until the reset.
  gh.length = 0;
  for (let i = 0; i < 20; i++) {
    const x = await lookupPrForBranch({ projectDir: '/r', head: `b${i % 4}` });
    if (i % 4 === 0) assert.equal(x.pr.state, 'MERGED', 'b0 answers from the store');
    else assert.equal(x.reason, 'quota');
  }
  assert.deepEqual(gh, [], 'no burst of retries while the window is open');
  // After the reset: exactly one lookup per stale key (b0 is MERGED, final).
  now = NOW + 40 * MIN + 1;
  limited = false;
  for (let i = 0; i < 8; i++) await lookupPrForBranch({ projectDir: '/r', head: `b${i % 4}` });
  assert.deepEqual(gh.filter((c) => c.startsWith('pr list')).length, 3);
  assert.equal(gh.filter((c) => c === 'api rate_limit').length, 0);
});

test('F-X-02 (I-2): lookups that hit the limit together send one rate_limit probe', async () => {
  const gh = [];
  let releaseProbe;
  const probeGate = new Promise((r) => { releaseProbe = r; });
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'git' && args[0] === 'remote') return ok('origin\tgit@ghe.corp:o/r.git (fetch)\norigin\tgit@ghe.corp:o/r.git (push)\n');
    if (cmd !== 'gh') return ok('');
    gh.push(args.join(' '));
    if (args[0] === 'api' && args[1] === 'rate_limit') return probeGate.then(() => ok(RATE));
    if (args[1] === 'list') return Promise.resolve(LIMITED);
    return ok('');
  });
  gitInfo.setNow(() => NOW);
  optIn();
  const runs = ['c1', 'c2', 'c3', 'c4'].map((head) => lookupPrForBranch({ projectDir: '/r', head }));
  await new Promise((r) => setTimeout(r, 20));   // every lookup is limited and waits on the probe
  releaseProbe();
  for (const r of await Promise.all(runs)) assert.equal(r.reason, 'quota');
  assert.equal(gh.filter((c) => c === 'api rate_limit').length, 1, 'one probe for the four lookups');
  assert.deepEqual(quotaBlocked('graphql', { now: NOW }), { until: NOW + 40 * MIN });
});

test('while graphql is blocked: prChecks, prMergeable, prLifecycleState, prWatchSnapshot (class rate-limit, today\'s wording), ghItemSummaries spawn nothing', async () => {
  const gh = [];
  gitInfo.setRunner((cmd, args) => { if (cmd === 'gh') gh.push(args.join(' ')); return ok(args[0] === '--version' ? 'gh 2.x' : ''); });
  optIn();
  gitInfo.setNow(() => NOW);
  noteQuotaExhausted('graphql', { resetAt: NOW + 30 * MIN, now: NOW });
  const prUrl = 'https://github.com/o/r/pull/7';
  assert.equal(await prChecks({ projectDir: '/r', prUrl }), null);
  assert.equal(await prMergeable({ projectDir: '/r', head: 'b', prUrl }), 'UNKNOWN');
  assert.equal(await prLifecycleState({ projectDir: '/r', prUrl }), null);
  const w = await prWatchSnapshot({ projectDir: '/r', prUrl });
  assert.equal(w.ok, false);
  assert.equal(w.class, 'rate-limit');
  assert.match(w.error, /rate limit/i);
  assert.equal((await ghItemSummaries({ repo: 'o/r', numbers: [1, 2] })).size, 0);
  assert.deepEqual(gh.filter((c) => c !== '--version'), [], 'no gated gh call spawned');
});

test('writes still try while blocked: createPr, prMerge, prWatchReply spawn gh', async () => {
  const gh = [];
  gitInfo.setRunner((cmd, args) => { if (cmd === 'gh') gh.push(args.join(' ')); return ok(''); });
  optIn();
  gitInfo.setNow(() => NOW);
  noteQuotaExhausted('graphql', { resetAt: NOW + 30 * MIN, now: NOW });
  noteQuotaExhausted('core', { resetAt: NOW + 30 * MIN, now: NOW });
  const prUrl = 'https://github.com/o/r/pull/7';
  await createPr({ projectDir: '/r', head: 'b', base: 'main', title: 't', body: 'x' });
  await prMerge({ projectDir: '/r', prUrl });
  await prWatchReply({ projectDir: '/r', prUrl, threadId: 'T', body: 'hi' });
  assert.ok(gh.some((c) => c.startsWith('pr create')), 'create PR spawned');
  assert.ok(gh.some((c) => c.startsWith('pr merge') || c.startsWith('repo view')), 'merge spawned');
  assert.ok(gh.some((c) => c.startsWith('api graphql') && c.includes('mutation')), 'reply spawned');
});

test('ghApi: 403 + X-RateLimit-Remaining 0 + X-RateLimit-Reset records the core window at that time; a later GET is skipped', async () => {
  const gh = [];
  const reset = Math.floor((NOW + 25 * MIN) / 1000);
  gitInfo.setRunner((cmd, args) => {
    gh.push(args.join(' '));
    return Promise.resolve({ ok: false, code: 1, stderr: 'gh: API rate limit exceeded (HTTP 403)',
      stdout: `HTTP/2.0 403 Forbidden\nX-Ratelimit-Remaining: 0\nX-Ratelimit-Reset: ${reset}\nX-Ratelimit-Resource: core\n\n{"message":"API rate limit exceeded"}` });
  });
  optIn();
  gitInfo.setNow(() => NOW);
  const r = await ghApi({ path: 'repos/o/r/pulls/7' });
  assert.equal(r.ok, false);
  assert.equal(r.class, 'rate-limit');
  assert.equal(r.resetAt, reset * 1000);
  assert.deepEqual(quotaBlocked('core', { now: NOW }), { until: reset * 1000 });
  const again = await ghApi({ path: 'repos/o/r/pulls/8' });
  assert.equal(again.ok, false);
  assert.equal(again.class, 'rate-limit');
  assert.equal(gh.length, 1, 'the second GET is skipped');
  await ghApi({ method: 'POST', path: 'repos/o/r/issues/1/comments', body: { body: 'x' } });
  assert.equal(gh.length, 2, 'a write still tries');
});

test('D8: a secondary limit (remaining above 0) blocks REST for about a minute, never until the primary reset', async () => {
  await checkRows([
    { name: 'no retry-after: 60 s, though x-ratelimit-reset is 50 min away', run: async () => {
      const reset = Math.floor((NOW + 50 * MIN) / 1000);
      gitInfo.setRunner(() => Promise.resolve({ ok: false, code: 1, stderr: 'gh: You have exceeded a secondary rate limit (HTTP 403)',
        stdout: `HTTP/2.0 403 Forbidden\nX-Ratelimit-Remaining: 10\nX-Ratelimit-Reset: ${reset}\nX-Ratelimit-Resource: core\n\n{"message":"You have exceeded a secondary rate limit"}` }));
      optIn();
      gitInfo.setNow(() => NOW);
      const r = await ghApi({ path: 'repos/o/r/pulls/7' });
      assert.equal(r.class, 'rate-limit');
      assert.equal(r.resetAt, NOW + 60_000);
      assert.deepEqual(quotaBlocked('core', { now: NOW }), { until: NOW + 60_000 });
      assert.equal(quotaBlocked('core', { now: NOW + 61_000 }), null, 'open again after a minute');
    } },
    { name: 'retry-after wins over x-ratelimit-reset', run: async () => {
      const reset = Math.floor((NOW + 50 * MIN) / 1000);
      gitInfo.setRunner(() => Promise.resolve({ ok: false, code: 1, stderr: 'gh: You have exceeded a secondary rate limit (HTTP 403)',
        stdout: `HTTP/2.0 403 Forbidden\nRetry-After: 30\nX-Ratelimit-Remaining: 10\nX-Ratelimit-Reset: ${reset}\n\n{}` }));
      optIn();
      gitInfo.setNow(() => NOW);
      assert.equal((await ghApi({ path: 'repos/o/r/pulls/7' })).resetAt, NOW + 30_000);
    } },
  ]);
});
