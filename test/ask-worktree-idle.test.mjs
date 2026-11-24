// test/ask-worktree-idle.test.mjs
// The idle classifier, boot/Free-idle remover and the guarded hand remover over
// real git checkouts (src/core/ask/worktree-idle.mjs). "Old" is made by injecting
// a `now` far in the future, never by back-dating files.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { existsSync, rmSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread, appendMessage, getThread } from '../src/core/ask/store.mjs';
import { prepare } from '../src/core/db.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { runGitCapture } from '../src/core/worktree.mjs';
import {
  openAskWorktree, getAskWorktree, listAskWorktrees, removeAskWorktree, sweepAskWorktrees, AskWorktreeError,
} from '../src/core/ask/worktrees.mjs';
import {
  classifyAskWorktree, listAskWorktreeVerdicts, freeIdleAskWorktrees, removeAskWorktreeChecked,
} from '../src/core/ask/worktree-idle.mjs';

useTempHome(after);

const DAY = 24 * 60 * 60_000;
const OLD = () => Date.now() + 30 * DAY;          // a clock 30 days on: every fresh row is idle
const never = () => null;

const created = [];
// Each test shares one DB: free every row it left (rows are what the cap and the sweeps look at).
afterEach(async () => {
  for (const r of prepare('SELECT thread_id, id FROM ask_worktrees').all()) {
    await removeAskWorktree({ threadId: r.thread_id, wtId: r.id }).catch(() => {});
  }
});
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

let seq = 0;
async function project() {
  const dir = templateRepo('awi', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
  const name = `awi-${++seq}`;
  const p = (await addProject({ name, path: dir })).find((x) => x.name === name);
  return { dir, key: p.key };
}
async function checkout() {
  const p = await project();
  const t = createThread({ title: `chat ${seq}` });
  const wt = await openAskWorktree({ threadId: t.id, projectKey: p.key, ref: 'main' });
  return { ...p, t, wt };
}
const row = (wt) => getAskWorktree(wt.threadId, wt.worktreeId);
const g = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
const iso = (ms) => new Date(ms).toISOString();
/** Make a checkout's every signal `days` old (the .git pointer file's mtime is one of them). */
function backdate(c, days) {
  const at = Date.now() - days * DAY;
  prepare('UPDATE ask_worktrees SET created_at = ?, updated_at = ? WHERE id = ?').run(iso(at), iso(at), c.wt.worktreeId);
  prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(iso(at), c.t.id);
  utimesSync(join(c.wt.path, '.git'), at / 1000, at / 1000);
}

test('classify: a clean old checkout is safe', async () => {
  const { wt } = await checkout();
  const v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never });
  assert.equal(v.safe, true);
  assert.equal(v.inUse, false);
  assert.equal(v.loss, 'none');
  assert.equal(v.recent, false);
  assert.equal(v.missingDir, false);
  assert.deepEqual(v.lost.dirtyFiles, []);
  assert.deepEqual(v.lost.commits, []);
  assert.match(v.lost.fingerprint, /^[0-9a-f]{64}$/);
});

test('classify: an untracked file and a modified tracked file are both dirty', async () => {
  const { wt } = await checkout();
  await writeFile(join(wt.path, 'new.txt'), 'x\n');
  let v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never });
  assert.equal(v.safe, false);
  assert.equal(v.dirty, true);
  assert.equal(v.loss, 'work');
  assert.deepEqual(v.lost.dirtyFiles, ['new.txt']);
  await rm(join(wt.path, 'new.txt'));
  await writeFile(join(wt.path, 'README.md'), 'changed\n');
  v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never });
  assert.equal(v.dirty, true);
  assert.deepEqual(v.lost.dirtyFiles, ['README.md']);
});

test('classify: a commit on no branch is ownCommits; the same commit on a branch is safe', async () => {
  const { wt, dir } = await checkout();
  await writeFile(join(wt.path, 'f.txt'), 'f\n');
  g(wt.path, 'add', '-A'); g(wt.path, 'commit', '-qm', 'my work');
  let v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never });
  assert.equal(v.safe, false);
  assert.equal(v.ownCommits, true);
  assert.equal(v.loss, 'work');
  assert.equal(v.lost.commits.length, 1);
  assert.match(v.lost.commits[0].sha, /^[0-9a-f]{40}$/);
  assert.equal(v.lost.commits[0].subject, 'my work');
  const head = g(wt.path, 'rev-parse', 'HEAD').stdout.trim();
  g(dir, 'branch', 'keeper', head);
  v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never });
  assert.equal(v.ownCommits, false);
  assert.equal(v.safe, true);
});

test('classify: a live use is inUse, not safe, and runs no git probe', async () => {
  const { wt } = await checkout();
  const probe = () => { throw new Error('runGit must not be called for an in-use row'); };
  for (const reason of ['replying', 'command', 'following', 'terminal']) {
    const v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: () => reason, runGit: probe });
    assert.equal(v.inUse, reason);
    assert.equal(v.safe, false);
    assert.equal(v.loss, 'none');
  }
  let v = await classifyAskWorktree(row(wt), { now: OLD(), runGit: probe });
  assert.equal(v.inUse, 'unknown');
  assert.equal(v.safe, false);
  v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: () => { throw new Error('boom'); }, runGit: probe });
  assert.equal(v.inUse, 'unknown');
  v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: () => 'mystery', runGit: probe });
  assert.equal(v.inUse, 'unknown');
});

test('classify: a failed probe, a timeout and truncated output each give loss unknown', async () => {
  const { wt } = await checkout();
  const cases = {
    'non-zero exit': async () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal' }),
    'timeout': async () => ({ ok: false, code: -1, stdout: '', stderr: 'git timed out' }),
    'truncated': async () => ({ ok: true, code: 0, stdout: '?? a\n', stderr: '', truncated: true }),
  };
  for (const [name, runGit] of Object.entries(cases)) {
    const v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never, runGit });
    assert.equal(v.loss, 'unknown', name);
    assert.equal(v.safe, false, name);
  }
});

test('classify: a failed status probe and a failed log probe each give unknown on their own, with the bounded timeout', async () => {
  const { wt } = await checkout();
  const fail = { ok: false, code: 128, stdout: '', stderr: 'fatal' };
  for (const broken of ['status', 'log']) {
    const seen = [];
    const runGit = (cwd, args, o) => {
      seen.push(o.timeoutMs);
      return args.includes(broken) ? Promise.resolve(fail) : runGitCapture(cwd, args, o);
    };
    const v = await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never, runGit });
    assert.equal(v.loss, 'unknown', broken);
    assert.equal(v.safe, false, broken);
    assert.deepEqual(seen, [ASK_LIMITS.worktreeGitCheckMs, ASK_LIMITS.worktreeGitCheckMs], broken);
  }
});

test('classify: recency is the max of the row, thread and message signals; unparseable signals are ignored', async () => {
  const { wt, t } = await checkout();
  const now = OLD();
  assert.equal((await classifyAskWorktree(row(wt), { now, busyFor: never })).recent, false);
  prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(iso(now - DAY), t.id);
  let v = await classifyAskWorktree(row(wt), { now, busyFor: never });
  assert.equal(v.recent, true);
  assert.equal(v.safe, false);
  assert.equal(v.loss, 'none');
  assert.equal(v.lastTouchedAt, iso(now - DAY));
  prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(iso(now - 20 * DAY), t.id);
  assert.equal((await classifyAskWorktree(row(wt), { now, busyFor: never })).recent, false);
  prepare('UPDATE ask_messages SET created_at = ? WHERE thread_id = ?').run(iso(now - 2 * DAY), t.id);   // no rows yet: a no-op
  appendMessage(t.id, { role: 'user', text: 'hello' });
  prepare('UPDATE ask_messages SET created_at = ? WHERE thread_id = ?').run(iso(now - 2 * DAY), t.id);
  assert.equal((await classifyAskWorktree(row(wt), { now, busyFor: never })).recent, true);
  prepare('UPDATE ask_messages SET created_at = ? WHERE thread_id = ?').run(iso(now - 10 * DAY), t.id);
  assert.equal((await classifyAskWorktree(row(wt), { now, busyFor: never })).recent, false);
  prepare('UPDATE ask_worktrees SET updated_at = ? WHERE id = ?').run(iso(now - 3 * DAY), wt.worktreeId);
  assert.equal((await classifyAskWorktree(row(wt), { now, busyFor: never })).recent, true);
  prepare('UPDATE ask_worktrees SET updated_at = ? WHERE id = ?').run('garbage', wt.worktreeId);
  assert.equal((await classifyAskWorktree(row(wt), { now, busyFor: never })).recent, false);
});

test('classify: every signal unparseable gives loss unknown (keep)', async () => {
  const { wt, t } = await checkout();
  prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run('?', t.id);
  const v = await classifyAskWorktree({ ...row(wt), createdAt: 'x', updatedAt: 'y' }, { now: 0, busyFor: never, mtimeOf: () => NaN });
  assert.equal(v.loss, 'unknown');
  assert.equal(v.safe, false);
});

test('classify: a recent clean row is not safe but its probes ran', async () => {
  const { wt } = await checkout();
  let calls = 0;
  const runGit = (cwd, args, o) => { calls += 1; return runGitCapture(cwd, args, o); };
  const v = await classifyAskWorktree(row(wt), { now: Date.now(), busyFor: never, runGit });
  assert.equal(v.recent, true);
  assert.equal(v.loss, 'none');
  assert.equal(v.safe, false);
  assert.equal(calls, 2);
});

test('classify: a missing folder is safe without probes, unless the chat is in use', async () => {
  const { wt } = await checkout();
  rmSync(wt.path, { recursive: true, force: true });
  const probe = () => { throw new Error('no probe for a missing dir'); };
  let v = await classifyAskWorktree(row(wt), { now: Date.now(), busyFor: never, runGit: probe });
  assert.equal(v.missingDir, true);
  assert.equal(v.safe, true);
  assert.equal(v.loss, 'none');
  v = await classifyAskWorktree(row(wt), { now: Date.now(), busyFor: () => 'replying', runGit: probe });
  assert.equal(v.missingDir, true);
  assert.equal(v.safe, false);
});

test('fingerprint: stable for the same state, different for a swapped file of equal count', async () => {
  const { wt } = await checkout();
  await writeFile(join(wt.path, 'a.txt'), 'a\n');
  const a1 = (await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never })).lost.fingerprint;
  const a2 = (await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never })).lost.fingerprint;
  assert.equal(a1, a2);
  await rm(join(wt.path, 'a.txt'));
  await writeFile(join(wt.path, 'b.txt'), 'b\n');
  const b = (await classifyAskWorktree(row(wt), { now: OLD(), busyFor: never })).lost.fingerprint;
  assert.notEqual(a1, b);
});

test('listAskWorktreeVerdicts: capacity, used, oldest first, joined title/owner', async () => {
  const a = await checkout();
  const b = await checkout();
  backdate(b, 50);
  const out = await listAskWorktreeVerdicts({ now: OLD(), busyFor: never });
  assert.equal(out.capacity, ASK_LIMITS.worktreesGlobal);
  assert.equal(out.used, out.items.length);
  const ids = out.items.map((i) => i.worktreeId);
  assert.ok(ids.indexOf(b.wt.worktreeId) < ids.indexOf(a.wt.worktreeId));
  const item = out.items.find((i) => i.worktreeId === a.wt.worktreeId);
  assert.equal(item.title, a.t.title);
  assert.equal(item.projectKey, a.key);
  assert.equal(item.ref, 'main');
  assert.equal(item.path, a.wt.path);
  await removeAskWorktree({ threadId: a.t.id, wtId: a.wt.worktreeId });
  await removeAskWorktree({ threadId: b.t.id, wtId: b.wt.worktreeId });
});

test('free-idle: frees safe rows oldest first, honours limit, calls onFreed, keeps dirty and own-commit rows', async () => {
  const clean1 = await checkout();
  const clean2 = await checkout();
  const dirty = await checkout();
  const commit = await checkout();
  await writeFile(join(dirty.wt.path, 'x.txt'), 'x\n');
  await writeFile(join(commit.wt.path, 'c.txt'), 'c\n');
  g(commit.wt.path, 'add', '-A'); g(commit.wt.path, 'commit', '-qm', 'mine');
  backdate(clean2, 90);
  const freedIds = [];
  const first = await freeIdleAskWorktrees({ now: OLD(), busyFor: never, limit: 1, onFreed: (tid) => freedIds.push(tid) });
  assert.deepEqual(first.freed, [clean2.wt.worktreeId]);   // the oldest signal goes first
  assert.deepEqual(freedIds, [clean2.t.id]);
  assert.equal(existsSync(clean2.wt.path), false);
  const second = await freeIdleAskWorktrees({ now: OLD(), busyFor: never });
  assert.deepEqual(second.freed, [clean1.wt.worktreeId]);
  assert.equal(second.kept, 2);
  assert.equal(second.failed, 0);
  assert.ok(existsSync(dirty.wt.path) && existsSync(commit.wt.path));
  assert.ok(getThread(clean1.t.id), 'removing a checkout never deletes the chat');
  for (const c of [dirty, commit]) await removeAskWorktree({ threadId: c.t.id, wtId: c.wt.worktreeId });
});

test('free-idle: a file appearing between the first classification and the re-check keeps the row', async () => {
  const c = await checkout();
  let statusCalls = 0;
  const runGit = async (cwd, args, o) => {
    if (args.includes('status') && ++statusCalls === 2) await writeFile(join(c.wt.path, 'late.txt'), 'late\n');
    return runGitCapture(cwd, args, o);
  };
  // the first status (classification 1) is clean; the file lands just before the re-check's status
  const res = await freeIdleAskWorktrees({ now: OLD(), busyFor: never, runGit });
  assert.deepEqual(res.freed, []);
  assert.ok(existsSync(c.wt.path));
  await removeAskWorktree({ threadId: c.t.id, wtId: c.wt.worktreeId });
});

test('free-idle: a turn or terminal that starts during the probes is seen by the final busy check', async () => {
  const c = await checkout();
  let calls = 0;
  const busyFor = () => (++calls >= 3 ? 'terminal' : null);   // classification, re-classification, then the pre-remove check
  const res = await freeIdleAskWorktrees({ now: OLD(), busyFor });
  assert.deepEqual(res.freed, []);
  assert.equal(calls, 3);
  assert.ok(existsSync(c.wt.path));
  assert.ok(getAskWorktree(c.t.id, c.wt.worktreeId));
  await removeAskWorktree({ threadId: c.t.id, wtId: c.wt.worktreeId });
});

test('free-idle: a throwing final busy check keeps the row', async () => {
  const c = await checkout();
  let calls = 0;
  const busyFor = () => { if (++calls >= 3) throw new Error('lookup failed'); return null; };
  const res = await freeIdleAskWorktrees({ now: OLD(), busyFor });
  assert.deepEqual(res.freed, []);
  assert.equal(res.kept, 1);
  assert.ok(existsSync(c.wt.path));
  await removeAskWorktree({ threadId: c.t.id, wtId: c.wt.worktreeId });
});

test('free-idle: the chat is claimed from the final busy check until the removal settles, then released', async () => {
  const c = await checkout();
  const held = new Set();
  let finish;
  const gate = new Promise((r) => { finish = r; });
  let entered;
  const started = new Promise((r) => { entered = r; });
  const run = freeIdleAskWorktrees({
    now: OLD(), busyFor: (id) => (held.has(id) ? 'replying' : null),
    claim: (id) => held.add(id), release: (id) => held.delete(id),
    remove: async (a) => { entered(); await gate; return removeAskWorktree(a); },
  });
  await started;
  assert.ok(held.has(c.t.id), 'claimed while git is still deleting');
  // a second sweep (or a hand remove) that looks now sees the chat as in use and leaves it to the first
  const other = await freeIdleAskWorktrees({ now: OLD(), busyFor: (id) => (held.has(id) ? 'replying' : null), remove: async () => { throw new Error('must not remove'); } });
  assert.deepEqual(other.freed, []);
  finish();
  const res = await run;
  assert.deepEqual(res.freed, [c.wt.worktreeId]);
  assert.equal(held.size, 0, 'released once the removal settled');
});

test('free-idle: a failed removal still releases the claim', async () => {
  const c = await checkout();
  const held = new Set();
  const res = await freeIdleAskWorktrees({
    now: OLD(), busyFor: never, claim: (id) => held.add(id), release: (id) => held.delete(id),
    remove: async () => { throw new Error('disk on fire'); },
  });
  assert.equal(res.failed, 1);
  assert.equal(held.size, 0);
  await removeAskWorktree({ threadId: c.t.id, wtId: c.wt.worktreeId });
});

test('free-idle: a missing-dir row goes through removeAskWorktree, so git forgets the checkout', async () => {
  const c = await checkout();
  rmSync(c.wt.path, { recursive: true, force: true });
  assert.match(g(c.dir, 'worktree', 'list', '--porcelain').stdout, /wt_[0-9a-f]{8}/);   // stale metadata still there
  const res = await freeIdleAskWorktrees({ now: Date.now(), busyFor: never });
  assert.deepEqual(res.dropped, [c.wt.worktreeId]);
  assert.deepEqual(res.freed, []);
  assert.equal(getAskWorktree(c.t.id, c.wt.worktreeId), null);
  assert.doesNotMatch(g(c.dir, 'worktree', 'list', '--porcelain').stdout, /wt_[0-9a-f]{8}/);
});

test('free-idle: one row failing to remove does not stop the others', async () => {
  const bad = await checkout();
  const good = await checkout();
  backdate(bad, 90);
  const logs = [];
  const res = await freeIdleAskWorktrees({
    now: OLD(), busyFor: never, log: (l, m) => logs.push([l, m]),
    remove: async (a) => { if (a.wtId === bad.wt.worktreeId) throw new Error('disk on fire'); return removeAskWorktree(a); },
  });
  assert.equal(res.failed, 1);
  assert.deepEqual(res.freed, [good.wt.worktreeId]);
  assert.ok(logs.some(([, m]) => /disk on fire/.test(m)));
  await removeAskWorktree({ threadId: bad.t.id, wtId: bad.wt.worktreeId });
});

test('sweepAskWorktrees (worca doctor) never does idle removal, even for a clean checkout 90 days idle', async () => {
  const c = await checkout();
  backdate(c, 90);
  await sweepAskWorktrees({});
  assert.ok(existsSync(c.wt.path));
  assert.ok(getAskWorktree(c.t.id, c.wt.worktreeId));
  await removeAskWorktree({ threadId: c.t.id, wtId: c.wt.worktreeId });
});

const codeOf = (p) => p.then(() => null, (e) => e);

test('removeChecked: dirty needs a confirm that carries lost; the fingerprint binds it', async () => {
  const c = await checkout();
  await writeFile(join(c.wt.path, 'x.txt'), 'x\n');
  const base = { threadId: c.t.id, wtId: c.wt.worktreeId, now: OLD(), busyFor: never, canDiscard: true };
  let e = await codeOf(removeAskWorktreeChecked(base));
  assert.ok(e instanceof AskWorktreeError);
  assert.equal(e.code, 'CHECKOUT_NEEDS_CONFIRM');
  assert.deepEqual(e.detail.lost.dirtyFiles, ['x.txt']);
  e = await codeOf(removeAskWorktreeChecked({ ...base, discard: true }));
  assert.equal(e.code, 'CHECKOUT_NEEDS_CONFIRM');
  e = await codeOf(removeAskWorktreeChecked({ ...base, discard: true, confirmFingerprint: 'nope' }));
  assert.equal(e.code, 'CHECKOUT_NEEDS_CONFIRM');
  const fp = e.detail.lost.fingerprint;
  // the state changes (a different file, same count): the old fingerprint is stale
  await rm(join(c.wt.path, 'x.txt'));
  await writeFile(join(c.wt.path, 'y.txt'), 'y\n');
  e = await codeOf(removeAskWorktreeChecked({ ...base, discard: true, confirmFingerprint: fp }));
  assert.equal(e.code, 'CHECKOUT_NEEDS_CONFIRM');
  assert.ok(existsSync(c.wt.path));
  const fresh = e.detail.lost.fingerprint;
  const ok = await removeAskWorktreeChecked({ ...base, discard: true, confirmFingerprint: fresh });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.discarded.dirtyFiles, ['y.txt']);
  assert.equal(existsSync(c.wt.path), false);
  assert.equal(getAskWorktree(c.t.id, c.wt.worktreeId), null);
  assert.ok(getThread(c.t.id));
});

test('removeChecked: busy is refused even with discard; unknown needs discard; a final busy check runs', async () => {
  const c = await checkout();
  const base = { threadId: c.t.id, wtId: c.wt.worktreeId, now: OLD(), canDiscard: true };
  let e = await codeOf(removeAskWorktreeChecked({ ...base, busyFor: () => 'terminal', discard: true, confirmFingerprint: 'x' }));
  assert.equal(e.code, 'CHECKOUT_BUSY');
  e = await codeOf(removeAskWorktreeChecked({ ...base, busyFor: () => { throw new Error('x'); }, discard: true }));
  assert.equal(e.code, 'CHECKOUT_BUSY');
  const failing = async () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal' });
  e = await codeOf(removeAskWorktreeChecked({ ...base, busyFor: never, runGit: failing }));
  assert.equal(e.code, 'CHECKOUT_UNKNOWN');
  let n = 0;
  e = await codeOf(removeAskWorktreeChecked({ ...base, busyFor: () => (++n >= 2 ? 'replying' : null) }));
  assert.equal(e.code, 'CHECKOUT_BUSY');
  assert.ok(existsSync(c.wt.path));
  await removeAskWorktree({ threadId: c.t.id, wtId: c.wt.worktreeId });
});

test('removeChecked: the claim spans the removal and is released after it; a refusal never claims', async () => {
  const c = await checkout();
  const held = [];
  const base = { threadId: c.t.id, wtId: c.wt.worktreeId, now: OLD(), busyFor: never, canDiscard: true, claim: (id) => held.push(['claim', id]), release: (id) => held.push(['release', id]) };
  const refused = await codeOf(removeAskWorktreeChecked({ ...base, busyFor: () => 'terminal' }));
  assert.equal(refused.code, 'CHECKOUT_BUSY');
  assert.deepEqual(held, [], 'a refusal never claims');
  const ok = await removeAskWorktreeChecked(base);
  assert.equal(ok.ok, true);
  assert.deepEqual(held, [['claim', c.t.id], ['release', c.t.id]]);
});

test('removeChecked: busy beats not-owner, and an unknown row is removed on a discard with the matching fingerprint', async () => {
  const c = await checkout();
  await writeFile(join(c.wt.path, 'x.txt'), 'x\n');
  const e = await codeOf(removeAskWorktreeChecked({ threadId: c.t.id, wtId: c.wt.worktreeId, now: OLD(), busyFor: () => 'command', canDiscard: false }));
  assert.equal(e.code, 'CHECKOUT_BUSY');
  const failing = async () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal' });
  const base = { threadId: c.t.id, wtId: c.wt.worktreeId, now: OLD(), busyFor: never, canDiscard: true, runGit: failing };
  const need = await codeOf(removeAskWorktreeChecked(base));
  assert.equal(need.code, 'CHECKOUT_UNKNOWN');
  const stale = await codeOf(removeAskWorktreeChecked({ ...base, discard: true, confirmFingerprint: 'nope' }));
  assert.equal(stale.code, 'CHECKOUT_NEEDS_CONFIRM');
  const ok = await removeAskWorktreeChecked({ ...base, discard: true, confirmFingerprint: need.detail.lost.fingerprint });
  assert.equal(ok.ok, true);
  assert.equal(getAskWorktree(c.t.id, c.wt.worktreeId), null);
});

test('removeChecked: without ownership only a safe row can go', async () => {
  const dirty = await checkout();
  await writeFile(join(dirty.wt.path, 'x.txt'), 'x\n');
  const base = { now: OLD(), busyFor: never, canDiscard: false };
  const e = await codeOf(removeAskWorktreeChecked({ ...base, threadId: dirty.t.id, wtId: dirty.wt.worktreeId, discard: true, confirmFingerprint: 'x' }));
  assert.equal(e.code, 'CHECKOUT_NOT_OWNER');
  assert.ok(existsSync(join(dirty.wt.path, 'x.txt')));
  const recent = await checkout();
  const r = await codeOf(removeAskWorktreeChecked({ ...base, now: Date.now(), threadId: recent.t.id, wtId: recent.wt.worktreeId }));
  assert.equal(r.code, 'CHECKOUT_NOT_OWNER');   // recent is not safe
  const clean = await checkout();
  const ok = await removeAskWorktreeChecked({ ...base, threadId: clean.t.id, wtId: clean.wt.worktreeId });
  assert.equal(ok.ok, true);
  assert.equal(ok.discarded, null);
  for (const c of [dirty, recent]) await removeAskWorktree({ threadId: c.t.id, wtId: c.wt.worktreeId });
});

test('removeChecked: the owner removes a recent clean row without a confirm', async () => {
  const c = await checkout();
  const ok = await removeAskWorktreeChecked({ threadId: c.t.id, wtId: c.wt.worktreeId, now: Date.now(), busyFor: never, canDiscard: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.discarded, null);
  assert.deepEqual(listAskWorktrees(c.t.id), []);
});
