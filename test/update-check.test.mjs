// test/update-check.test.mjs
// The latest-version check (issue #841): SemVer precedence, the four statuses, the release links,
// and the checker's cache / re-check throttle / setting-off / failure rules. No network: every
// fetcher here is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import {
  parseVersion, formatVersion, compareVersions, versionStatus, releaseLinks, fetchNpmLatest,
  createUpdateChecker, CHANGELOG_URL, NPM_DIST_TAGS_URL,
  CHECK_INTERVAL_MS, FAILED_RETRY_MS, MIN_RECHECK_MS,
} from '../src/core/update-check.mjs';

test('parseVersion accepts SemVer 2.0 (optional v, prerelease, build) and refuses garbage', () => {
  assert.deepEqual(parseVersion('1.13.1'), { major: 1, minor: 13, patch: 1, pre: [] });
  assert.deepEqual(parseVersion('v1.14.0-rc.1'), { major: 1, minor: 14, patch: 0, pre: ['rc', '1'] });
  assert.deepEqual(parseVersion('1.2.3+build.7'), { major: 1, minor: 2, patch: 3, pre: [] });
  for (const bad of ['', '1.2', '01.2.3', '1.2.3-', 'latest', '1.2.3 ', ' 1.2.3x', null, undefined, 42, {}, '1.2.3-rc..1', 'x'.repeat(100)]) {
    assert.equal(parseVersion(bad), null, JSON.stringify(bad));
  }
  assert.equal(formatVersion(parseVersion('v1.14.0-rc.1+abc')), '1.14.0-rc.1', 'build metadata and v are dropped');
});

test('compareVersions follows SemVer precedence', () => {
  const cmp = (a, b) => compareVersions(parseVersion(a), parseVersion(b));
  assert.equal(cmp('1.13.1', '1.13.1'), 0);
  assert.equal(cmp('1.13.1', '1.14.0'), -1);
  assert.equal(cmp('2.0.0', '1.99.99'), 1);
  assert.equal(cmp('1.14.0-rc.1', '1.14.0'), -1, 'a prerelease sorts before its release');
  assert.equal(cmp('1.14.0-rc.2', '1.14.0-rc.10'), -1, 'numeric identifiers compare as numbers');
  assert.equal(cmp('1.14.0-rc.1', '1.14.0-rc.1.1'), -1, 'more identifiers win when the rest is equal');
  assert.equal(cmp('1.14.0-1', '1.14.0-rc'), -1, 'numeric identifiers sort before alphanumeric');
  assert.equal(cmp('1.2.3+a', '1.2.3+b'), 0, 'build metadata is ignored');
});

test('versionStatus: stable, rc, ahead and garbage', async () => {
  const rows = [
    ['1.13.1', '1.13.1', 'up-to-date'],
    ['1.13.1', '1.14.0', 'outdated'],
    ['1.13.1-rc.2', '1.13.1', 'outdated'],       // the stable release of my RC is out
    ['1.14.0-rc.1', '1.13.1', 'ahead'],          // an RC of the next version is never "outdated"
    ['1.15.0', '1.14.0', 'ahead'],               // a source checkout ahead of npm
    ['1.13.1', '1.14.0-rc.1', 'unknown'],        // a prerelease is never offered as newer stable
    ['garbage', '1.14.0', 'unknown'],
    ['1.13.1', 'garbage', 'unknown'],
    ['1.13.1', null, 'unknown'],
  ];
  await checkRows(rows.map(([cur, lat, want]) => ({
    name: `${cur} vs ${lat} → ${want}`,
    run: () => assert.equal(versionStatus(cur, lat), want),
  })));
});

test('releaseLinks: release notes always; What\'s new + compare only when outdated', () => {
  const repo = 'https://github.com/SinishaDjukic/worca-cc';
  assert.deepEqual(releaseLinks({ current: '1.13.1', latest: '1.14.0', status: 'outdated' }, repo), {
    releaseNotes: CHANGELOG_URL,
    whatsNew: 'https://docs.worca.dev/changelog/1.14.0/',
    compare: `${repo}/compare/worca-app-v1.13.1...worca-app-v1.14.0`,
  });
  for (const status of ['up-to-date', 'ahead', 'unknown']) {
    assert.deepEqual(releaseLinks({ current: '1.13.1', latest: '1.13.1', status }, repo),
      { releaseNotes: CHANGELOG_URL, whatsNew: '', compare: '' }, status);
  }
  assert.equal(releaseLinks({ current: '1.13.1', latest: '1.14.0', status: 'outdated' }, '').compare, '', 'no repo, no compare link');
  assert.equal(releaseLinks({ current: '1.13.1', latest: '1.14.0', status: 'outdated' }, 'javascript:alert(1)').compare, '', 'only https repos');
  assert.equal(releaseLinks({ current: '1.13.1+local', latest: '1.14.0', status: 'outdated' }, repo + '/').compare,
    `${repo}/compare/worca-app-v1.13.1...worca-app-v1.14.0`, 'build metadata dropped, no doubled slash');
});

const okFetch = (body, { status = 200 } = {}) => {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  fn.calls = calls;
  return fn;
};

test('fetchNpmLatest reads dist-tags.latest with a timeout signal, and throws on bad answers', async () => {
  const f = okFetch({ latest: '1.14.0', rc: '1.15.0-rc.1' });
  assert.equal(await fetchNpmLatest({ fetchImpl: f }), '1.14.0');
  assert.equal(f.calls[0].url, NPM_DIST_TAGS_URL);
  assert.ok(f.calls[0].init.signal, 'an AbortSignal bounds the request');
  await assert.rejects(fetchNpmLatest({ fetchImpl: okFetch({}, { status: 503 }) }), /503/);
  await assert.rejects(fetchNpmLatest({ fetchImpl: okFetch({ latest: 'nope' }) }), /usable/);
  await assert.rejects(fetchNpmLatest({ fetchImpl: okFetch(null) }), /usable/);
});

/** A checker on a hand-driven clock with a counting fake fetcher. */
function rig({ answer = '1.14.0', enabled = true, current = '1.13.1' } = {}) {
  const clock = { t: Date.UTC(2026, 9, 23) };
  const st = { enabled, answer, calls: 0 };
  const checker = createUpdateChecker({
    currentVersion: current,
    now: () => clock.t,
    enabled: () => st.enabled,
    fetchLatest: async () => { st.calls++; if (st.answer instanceof Error) throw st.answer; return st.answer; },
  });
  return { clock, st, checker };
}

test('checker: first status fetches, then the answer is cached for 24 h', async () => {
  const { clock, st, checker } = rig();
  const a = await checker.status();
  assert.deepEqual(a, { current: '1.13.1', latest: '1.14.0', status: 'outdated', checkedAt: new Date(clock.t).toISOString(), enabled: true });
  clock.t += CHECK_INTERVAL_MS - 1;
  await checker.status();
  assert.equal(st.calls, 1, 'fresh cache: no second fetch');
  clock.t += 1;
  st.answer = '1.13.1';
  assert.equal((await checker.status()).status, 'up-to-date', 'stale after 24 h: fetched again');
  assert.equal(st.calls, 2);
});

test('checker: concurrent callers share one request', async () => {
  const { st, checker } = rig();
  await Promise.all([checker.status(), checker.status(), checker.status({ force: true })]);
  assert.equal(st.calls, 1);
});

test('checker: a manual re-check is throttled to one per MIN_RECHECK_MS', async () => {
  const { clock, st, checker } = rig();
  await checker.status();
  clock.t += MIN_RECHECK_MS - 1;
  await checker.status({ force: true });
  assert.equal(st.calls, 1, 'too soon: cached answer, no fetch');
  clock.t += 1;
  st.answer = '1.15.0';
  assert.equal((await checker.status({ force: true })).latest, '1.15.0');
  assert.equal(st.calls, 2);
});

test('checker: setting off = no fetch and status unknown', async () => {
  const { st, checker } = rig({ enabled: false });
  assert.deepEqual(await checker.status(), { current: '1.13.1', latest: null, status: 'unknown', checkedAt: null, enabled: false });
  await checker.status({ force: true });
  assert.equal(st.calls, 0);
});

test('checker: a failure is unknown, silent, and retried only after FAILED_RETRY_MS', async () => {
  const { clock, st, checker } = rig({ answer: new Error('getaddrinfo ENOTFOUND registry.npmjs.org') });
  const a = await checker.status();
  assert.equal(a.status, 'unknown');
  assert.equal(a.latest, null);
  clock.t += FAILED_RETRY_MS - 1;
  await checker.status();
  assert.equal(st.calls, 1, 'no retry storm while offline');
  clock.t += 1;
  st.answer = '1.13.1';
  assert.equal((await checker.status()).status, 'up-to-date');
});

test('checker: a garbage registry answer is unknown, and a failure after a success drops the old answer', async () => {
  const { clock, st, checker } = rig({ answer: 'not-a-version' });
  assert.equal((await checker.status()).status, 'unknown');
  clock.t += FAILED_RETRY_MS;
  st.answer = '1.14.0';
  assert.equal((await checker.status()).status, 'outdated');
  clock.t += CHECK_INTERVAL_MS;
  st.answer = new Error('timeout');
  assert.equal((await checker.status()).status, 'unknown', 'the spec: an error leaves the state unknown');
});
