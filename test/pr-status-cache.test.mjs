// test/pr-status-cache.test.mjs
// The PR-status store every Worca process on the machine shares (src/core/pr-status-cache.mjs) and
// lookupPrForBranch on top of it (F-X-02, C-2). gh is never spawned for real: git-info's test runner
// answers, and the store lives in a temp dir (useDir, after setRunner, which suspends it).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  prStatusKey, prStatusPath, readPrStatus, writePrStatus, entryFresh, derivePr, singleFlight, _testing as cache,
} from '../src/core/pr-status-cache.mjs';
import { _testing as quota } from '../src/core/github-quota.mjs';
import { lookupPrForBranch, findPrForBranch, _testing as gitInfo } from '../src/core/git-info.mjs';
import { checkRows } from './helpers/rows.mjs';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-prstatus-')); dirs.push(d); return d; };
afterEach(() => {
  gitInfo.reset(); cache.reset(); quota.reset();
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const OPEN = { state: 'OPEN', url: 'https://github.com/o/r/pull/3', number: 3, isDraft: false, mergeable: 'MERGEABLE' };
const MERGED = { state: 'MERGED', url: 'https://github.com/o/r/pull/2', number: 2, isDraft: false, mergeable: 'UNKNOWN' };
const CLOSED = { state: 'CLOSED', url: 'https://github.com/o/r/pull/1', number: 1, isDraft: true, mergeable: 'UNKNOWN' };
const VERDICT = { draft: false, reviewDecision: null, mergeable: 'MERGEABLE', checks: { state: 'passing', total: 1, failed: 0, pending: 0 } };
const entry = (over) => ({ checkedAt: Date.now(), live: null, closed: null, verdict: null, ...over });

test('the store: freshness, derivation, merge-on-write', async () => {
  await checkRows([
    { name: 'entryFresh: MERGED final, OPEN/none 10 min, CLOSED or old none 24 h (F-X-02)', run: () => {
      const at = (e, age, runEndedAt = null) => entryFresh({ ...e, checkedAt: NOW - age }, { now: NOW, runEndedAt });
      assert.equal(at(entry({ live: MERGED }), 400 * DAY), true, 'merged is final');
      assert.equal(at(entry({ live: OPEN }), 9 * MIN), true);
      assert.equal(at(entry({ live: OPEN }), 10 * MIN), false);
      assert.equal(at(entry({}), 9 * MIN), true, 'no PR');
      assert.equal(at(entry({}), 11 * MIN), false);
      assert.equal(at(entry({ closed: CLOSED }), 23 * HOUR), true, 'closed only: a day');
      assert.equal(at(entry({ closed: CLOSED }), 25 * HOUR), false);
      assert.equal(at(entry({}), 23 * HOUR, NOW - 31 * DAY), true, 'no PR on a month-old run: a day');
      assert.equal(at(entry({}), 23 * HOUR, NOW - 29 * DAY), false, 'a recent run keeps 10 min');
      assert.equal(at(entry({ live: OPEN }), 11 * MIN, NOW - 60 * DAY), false, 'an open PR is 10 min whatever the age');
    } },
    { name: 'derivePr keeps today\'s keys (includeClosed, withVerdict)', run: () => {
      assert.deepEqual(derivePr(entry({ live: MERGED }), { includeClosed: false, withVerdict: true }), MERGED, 'no verdict on a merged PR');
      assert.deepEqual(derivePr(entry({ live: OPEN, verdict: VERDICT }), { withVerdict: true }), { ...OPEN, verdict: VERDICT });
      assert.deepEqual(derivePr(entry({ live: OPEN }), { withVerdict: true }), { ...OPEN, verdict: null }, 'a failed verdict read is null');
      assert.deepEqual(derivePr(entry({ live: OPEN, verdict: VERDICT }), { withVerdict: false }), OPEN);
      assert.equal(derivePr(entry({ closed: CLOSED }), { includeClosed: false }), null);
      assert.deepEqual(derivePr(entry({ closed: CLOSED }), { includeClosed: true }), CLOSED);
      assert.equal(derivePr(entry({}), { includeClosed: true }), null);
    } },
    { name: 'prStatusKey: lower-cased slug, prUrl kept, null without repo or head', run: () => {
      assert.equal(prStatusKey({ repo: 'Acme/App', head: 'feat/X' }), 'acme/app#feat/X#');
      assert.equal(prStatusKey({ repo: 'acme/app', head: 'b', prUrl: 'https://github.com/acme/app/pull/4' }), 'acme/app#b#https://github.com/acme/app/pull/4');
      assert.equal(prStatusKey({ repo: null, head: 'b' }), null);
      assert.equal(prStatusKey({ repo: 'a/b', head: '' }), null);
    } },
    { name: 'write merges with what another process wrote (newer checkedAt wins), prunes, caps', run: async () => {
      const dir = tmp();
      cache.useDir(dir);
      await writePrStatus('a#1#', entry({ live: OPEN }));
      // Another process writes b, and an older answer for a, straight to the file.
      const file = JSON.parse(readFileSync(prStatusPath(), 'utf8'));
      file.entries['b#1#'] = entry({ live: MERGED });
      file.entries['old#1#'] = entry({ checkedAt: Date.now() - 36 * DAY });
      writeFileSync(prStatusPath(), JSON.stringify(file));
      await writePrStatus('a#1#', entry({ checkedAt: Date.now() - MIN, live: CLOSED }));
      assert.deepEqual(readPrStatus('a#1#').live, OPEN, 'an older answer never overwrites a newer one');
      assert.deepEqual(readPrStatus('b#1#').live, MERGED, 'the other process\'s entry survives');
      await writePrStatus('c#1#', entry({ checkedAt: Date.now() }));
      assert.equal(readPrStatus('old#1#'), null, 'entries older than 35 days are pruned');
      // Cap: 5 000 entries, the oldest go first.
      const big = { v: 1, entries: {} };
      for (let i = 0; i < 5_000; i++) big.entries[`k${i}#b#`] = entry({ checkedAt: Date.now() - 1000 + i % 500 });
      big.entries['k0#b#'].checkedAt = Date.now() - DAY;
      writeFileSync(prStatusPath(), JSON.stringify(big));
      await writePrStatus('new#b#', entry({ checkedAt: Date.now() }));
      const after = JSON.parse(readFileSync(prStatusPath(), 'utf8'));
      assert.equal(Object.keys(after.entries).length, 5_000);
      assert.equal(after.entries['k0#b#'], undefined, 'the oldest went first');
      assert.ok(after.entries['new#b#']);
    } },
    { name: 'a lock timeout skips the write, never throws', run: async () => {
      const dir = tmp();
      cache.useDir(dir);
      // A live holder (this process's pid, fresh heartbeat) keeps the lock for longer than the 2 s wait.
      writeFileSync(`${prStatusPath()}.lock`, JSON.stringify({ pid: process.pid, token: 'x', at: new Date().toISOString() }));
      await writePrStatus('a#1#', entry({ live: OPEN }));
      assert.equal(existsSync(prStatusPath()), false, 'nothing written');
      writeFileSync(prStatusPath(), '{not json');
      assert.equal(readPrStatus('a#1#'), null, 'bad JSON reads as empty');
    } },
    { name: 'suspended: no read, no write', run: async () => {
      const dir = tmp();
      cache.useDir(dir);
      cache.suspend();
      await writePrStatus('a#1#', entry({ live: OPEN }));
      assert.equal(existsSync(join(dir, 'pr-status.json')), false);
      assert.equal(readPrStatus('a#1#'), null);
    } },
    { name: 'singleFlight: one call per key at a time; a null key runs alone', run: async () => {
      let n = 0;
      const fn = () => new Promise((r) => setTimeout(() => r(++n), 10));
      const [a, b] = await Promise.all([singleFlight('k', fn), singleFlight('k', fn)]);
      assert.equal(a, 1); assert.equal(b, 1);
      assert.equal(await singleFlight('k', fn), 2, 'settled flights are forgotten');
      const [c, d] = await Promise.all([singleFlight(null, fn), singleFlight(null, fn)]);
      assert.notEqual(c, d);
    } },
  ]);
});

// ── lookupPrForBranch on the store ─────────────────────────────────────────

const ok = (v) => Promise.resolve({ ok: true, stdout: typeof v === 'string' ? v : JSON.stringify(v), stderr: '', code: 0 });
// A GHE base remote: the key is shared (ghe.corp/o/r) and the lookup is today's gh pr list.
const REMOTE = 'origin\tgit@ghe.corp:o/r.git (fetch)\norigin\tgit@ghe.corp:o/r.git (push)\n';
function runner({ list, gh = [] }) {
  return (cmd, args) => {
    if (cmd === 'git' && args[0] === 'remote') return ok(REMOTE);
    if (cmd !== 'gh') return ok('');
    gh.push(args.join(' '));
    if (args[1] === 'list') return typeof list === 'function' ? list(args) : list;
    return ok('');
  };
}

test('lookupPrForBranch shares one answer per repo and branch (F-X-02)', async () => {
  await checkRows([
    { name: 'F-X-02: two concurrent callers for one branch share ONE gh lookup', run: async () => {
      const gh = [];
      gitInfo.setRunner(runner({ gh, list: () => new Promise((r) => setTimeout(() => r({ ok: true, stdout: JSON.stringify([MERGED]), stderr: '', code: 0 }), 20)) }));
      cache.useDir(tmp());
      const [a, b] = await Promise.all([lookupPrForBranch({ projectDir: '/r', head: 'b' }), lookupPrForBranch({ projectDir: '/r', head: 'b' })]);
      assert.deepEqual(a, { ok: true, pr: MERGED });
      assert.deepEqual(b, a);
      assert.equal(gh.length, 1);
    } },
    { name: 'F-X-02: a second process reads the first\'s answer without asking GitHub', run: async () => {
      const dir = tmp();
      gitInfo.setRunner(runner({ list: ok([MERGED]) }));
      cache.useDir(dir);
      assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'feat/x' })).pr.state, 'MERGED');
      const gitInfoUrl = pathToFileURL(fileURLToPath(new URL('../src/core/git-info.mjs', import.meta.url))).href;
      const cacheUrl = pathToFileURL(fileURLToPath(new URL('../src/core/pr-status-cache.mjs', import.meta.url))).href;
      const script = `
        const gi = await import(${JSON.stringify(gitInfoUrl)});
        const c = await import(${JSON.stringify(cacheUrl)});
        let gh = 0;
        gi._testing.setRunner((cmd, args) => {
          if (cmd === 'git' && args[0] === 'remote') return Promise.resolve({ ok: true, stdout: ${JSON.stringify(REMOTE)}, stderr: '', code: 0 });
          if (cmd === 'gh') { gh++; return Promise.resolve({ ok: false, stdout: '', stderr: 'gh must not run', code: 1 }); }
          return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
        });
        c._testing.useDir(${JSON.stringify(dir)});
        const r = await gi.lookupPrForBranch({ projectDir: '/r', head: 'feat/x' });
        process.stdout.write(JSON.stringify({ r, gh }));`;
      const out = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let s = '', e = '';
        child.stdout.on('data', (b) => (s += b)); child.stderr.on('data', (b) => (e += b));
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve(s) : reject(new Error(`child exited ${code}: ${e}`))));
      });
      const { r, gh } = JSON.parse(out);
      assert.deepEqual(r, { ok: true, pr: MERGED });
      assert.equal(gh, 0, 'the second process made no gh call');
    } },
    { name: 'MERGED is never re-asked; OPEN is re-asked after 10 min', run: async () => {
      let now = NOW;
      const gh = [];
      let rows = [MERGED];
      gitInfo.setRunner(runner({ gh, list: () => ok(rows) }));
      gitInfo.setNow(() => now);
      cache.useDir(tmp());
      await lookupPrForBranch({ projectDir: '/r', head: 'm' });
      now += 400 * DAY;
      assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'm' })).pr.state, 'MERGED');
      assert.equal(gh.length, 1, 'merged: asked once, ever');
      now = NOW; rows = [OPEN]; gh.length = 0;
      await lookupPrForBranch({ projectDir: '/r', head: 'o' });
      now = NOW + 9 * MIN;
      await lookupPrForBranch({ projectDir: '/r', head: 'o' });
      assert.equal(gh.length, 1, 'fresh for 10 min');
      now = NOW + 10 * MIN;
      await lookupPrForBranch({ projectDir: '/r', head: 'o' });
      assert.equal(gh.length, 2, 'asked again after 10 min');
    } },
    { name: 'a failed lookup never writes the store, and returns last (C-2)', run: async () => {
      let now = NOW;
      let fail = false;
      gitInfo.setRunner(runner({ list: () => (fail ? Promise.resolve({ ok: false, stdout: '', stderr: 'HTTP 502', code: 1 }) : ok([OPEN])) }));
      gitInfo.setNow(() => now);
      cache.useDir(tmp());
      await lookupPrForBranch({ projectDir: '/r', head: 'b' });
      const before = readFileSync(prStatusPath(), 'utf8');
      now += 11 * MIN; fail = true;
      const r = await lookupPrForBranch({ projectDir: '/r', head: 'b' });
      assert.deepEqual(r, { ok: false, reason: 'gh-failed', last: OPEN });
      assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'b' }), OPEN);
      assert.equal(readFileSync(prStatusPath(), 'utf8'), before, 'the store is unchanged');
      const none = await lookupPrForBranch({ projectDir: '/r', head: 'never-seen' });
      assert.deepEqual(none, { ok: false, reason: 'gh-failed' }, 'no last without an entry');
    } },
  ]);
});

test('C1: Worca\'s own merge, close, ready and create replace the shared answer at once', async () => {
  const { prMerge, closePr, markPrReady, createPr } = await import('../src/core/git-info.mjs');
  const primed = async (rowsAfter) => {
    const gh = [];
    let rows = [OPEN];
    gitInfo.setRunner(runner({ gh, list: () => ok(rows) }));
    cache.useDir(tmp());
    assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'w' })).pr.state, 'OPEN');
    rows = rowsAfter;
    return gh;
  };
  const listed = (gh) => gh.filter((c) => c.startsWith('pr list')).length;
  await checkRows([
    { name: 'a merge by Worca: the next lookup asks GitHub again and reads MERGED, not the cached OPEN', run: async () => {
      const gh = await primed([{ ...OPEN, state: 'MERGED' }]);
      assert.equal((await prMerge({ projectDir: '/r', prUrl: OPEN.url })).ok, true);
      assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'w' })).pr.state, 'MERGED');
      assert.equal(listed(gh), 2);
    } },
    { name: 'a close by Worca drops the cached OPEN', run: async () => {
      const gh = await primed([{ ...OPEN, state: 'CLOSED' }]);
      assert.equal((await closePr({ projectDir: '/r', prUrl: OPEN.url })).ok, true);
      assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'w' })).pr, null);
      assert.equal(listed(gh), 2);
    } },
    { name: 'mark ready by Worca drops the cached draft', run: async () => {
      const gh = await primed([{ ...OPEN, isDraft: false }]);
      assert.equal((await markPrReady({ projectDir: '/r', prUrl: OPEN.url })).ok, true);
      await lookupPrForBranch({ projectDir: '/r', head: 'w' });
      assert.equal(listed(gh), 2);
    } },
    { name: 'a failed write keeps the cached answer', run: async () => {
      const gh = [];
      gitInfo.setRunner((cmd, args) => (cmd === 'gh' && args[1] === 'close' ? Promise.resolve({ ok: false, stdout: '', stderr: 'boom', code: 1 }) : runner({ gh, list: () => ok([OPEN]) })(cmd, args)));
      cache.useDir(tmp());
      await lookupPrForBranch({ projectDir: '/r', head: 'w' });
      assert.equal((await closePr({ projectDir: '/r', prUrl: OPEN.url })).ok, false);
      await lookupPrForBranch({ projectDir: '/r', head: 'w' });
      assert.equal(listed(gh), 1);
    } },
    { name: 'a PR created by Worca replaces a cached "no PR" for its branch', run: async () => {
      const gh = [];
      let rows = [];
      gitInfo.setRunner((cmd, args) => (cmd === 'gh' && args[1] === 'create' ? ok(`${OPEN.url}\n`) : runner({ gh, list: () => ok(rows) })(cmd, args)));
      cache.useDir(tmp());
      assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'w' })).pr, null);
      rows = [OPEN];
      assert.equal((await createPr({ projectDir: '/r', base: 'main', head: 'w', title: 't' })).ok, true);
      assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'w' })).pr.state, 'OPEN');
    } },
    { name: 'a lookup in flight across Worca\'s close does not store its pre-close OPEN', run: async () => {
      const gh = [];
      let release;
      const blocked = new Promise((r) => { release = r; });
      let rows = () => blocked.then(() => ({ ok: true, stdout: JSON.stringify([OPEN]), stderr: '', code: 0 }));
      gitInfo.setRunner(runner({ gh, list: () => rows() }));
      cache.useDir(tmp());
      const inFlight = lookupPrForBranch({ projectDir: '/r', head: 'w' });
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(listed(gh), 1, 'the lookup is waiting on GitHub');
      assert.equal((await closePr({ projectDir: '/r', prUrl: OPEN.url })).ok, true);
      release();
      assert.equal((await inFlight).pr.state, 'OPEN', 'the late caller still gets its own answer');
      rows = () => ok([{ ...OPEN, state: 'CLOSED' }]);
      assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'w' })).pr, null, 'the stale OPEN was not stored');
      assert.equal(listed(gh), 2, 'GitHub was asked again');
    } },
    { name: 'a "no PR" lookup in flight across Worca\'s create does not store "no PR"', run: async () => {
      const gh = [];
      let release;
      const blocked = new Promise((r) => { release = r; });
      let rows = () => blocked.then(() => ({ ok: true, stdout: '[]', stderr: '', code: 0 }));
      gitInfo.setRunner((cmd, args) => (cmd === 'gh' && args[1] === 'create' ? ok(`${OPEN.url}\n`) : runner({ gh, list: () => rows() })(cmd, args)));
      cache.useDir(tmp());
      const inFlight = lookupPrForBranch({ projectDir: '/r', head: 'w' });
      await new Promise((r) => setTimeout(r, 5));
      assert.equal((await createPr({ projectDir: '/r', base: 'main', head: 'w', title: 't' })).ok, true);
      release();
      await inFlight;
      rows = () => ok([OPEN]);
      assert.equal((await lookupPrForBranch({ projectDir: '/r', head: 'w' })).pr.state, 'OPEN');
    } },
    { name: 'forgetPrStatus keeps other branches\' and other PRs\' entries', run: async () => {
      const { forgetPrStatus } = await import('../src/core/pr-status-cache.mjs');
      cache.useDir(tmp());
      const kOpen = prStatusKey({ repo: 'o/r', head: 'a' }), kNone = prStatusKey({ repo: 'o/r', head: 'b' }), kOther = prStatusKey({ repo: 'o/r', head: 'c' });
      await writePrStatus(kOpen, entry({ live: OPEN }));
      await writePrStatus(kNone, entry());
      await writePrStatus(kOther, entry({ live: MERGED }));
      await forgetPrStatus({ url: OPEN.url });
      assert.equal(readPrStatus(kOpen), null);
      assert.ok(readPrStatus(kNone) && readPrStatus(kOther));
      await forgetPrStatus({ head: 'b' });
      assert.equal(readPrStatus(kNone), null);
      assert.ok(readPrStatus(kOther), 'a live entry on another branch stays');
    } },
  ]);
});
