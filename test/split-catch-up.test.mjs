// test/split-catch-up.test.mjs — tools/split-catch-up.mjs in-process with fakes: arguments, M, one target, --all, never a push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, findMigration, movedOf, ownRoutes, catchUpOne, catchUpAll, resolveContext, main } from '../tools/split-catch-up.mjs';

test('parseArgs: one of BRANCH, --all, --fixture; --all defaults to no parity (quick parity on the fixture only)', () => {
  assert.equal(parseArgs(['feat/x']).branch, 'feat/x');
  assert.equal(parseArgs(['--all']).parity, 'none');
  assert.equal(parseArgs(['--fixture']).parity, 'quick');
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['a', 'b']), /one branch at a time/);
  assert.throws(() => parseArgs(['--tests', 'all', 'x']), /related or none/);
  assert.deepEqual(parseArgs(['feat/x', '--out', 'o', '--m', 'abc', '--tests', 'none', '--parity', 'none']),
    { mode: 'branch', branch: 'feat/x', out: 'o', m: 'abc', tests: 'none', parity: 'none' });
});
test('findMigration: the newest first-parent freeze-day subject, never a readiness dry run', () => {
  const run = () => ({ code: 0, stdout: `aaa\tOther\nbbb\tSplit large files by feature (#919): readiness dry run\nccc\tSplit large files by feature (#919) (#1100)\n`, stderr: '' });
  assert.equal(findMigration(run, '/r'), 'ccc');
  assert.equal(findMigration(() => ({ code: 0, stdout: 'aaa\tx\n', stderr: '' }), '/r'), null);
});
test('movedOf: a monolith edit maps to the split files that carry it; an ordinary file stays put', () => {
  assert.deepEqual(movedOf(['ui/server.mjs', 'ui/public/style.css', 'docs/a.md'],
    ['ui/routes/settings/config.mjs', 'ui/routes/settings/index.mjs', 'ui/public/shell/sidebar.css', 'docs/a.md']), [
    { from: 'ui/server.mjs', to: ['ui/routes/settings/config.mjs'] }, { from: 'ui/public/style.css', to: ['ui/public/shell/sidebar.css'] },
    { from: 'docs/a.md', to: ['docs/a.md'] }]);
});
test('ownRoutes: added app./router. routes in the patch', () => {
  assert.deepEqual([...ownRoutes("+app.get('/api/settings/catch-up-fixture', h)\n-app.post('/api/old', h)\n+  router.post(\"/api/x/y\", h)\n")],
    ['GET /api/settings/catch-up-fixture', 'POST /api/x/y']);
});

// the fakes used by the catchUpOne cases
function fakes({ mergeCode = 0, applyCode = 0, unmerged = '' } = {}) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args.includes('merge') && args.includes('--no-edit')) return { code: mergeCode, stdout: '', stderr: mergeCode ? 'CONFLICT' : '' };
    if (args.includes('--diff-filter=U')) return { code: 0, stdout: unmerged, stderr: '' };
    if (args.includes('apply')) return { code: applyCode, stdout: '', stderr: applyCode ? 'error: patch failed' : '' };
    if (args.includes('diff') && args.includes('--binary')) return { code: 0, stdout: "+app.get('/api/settings/catch-up-fixture', h)\n", stderr: '' };
    if (args.includes('rev-parse')) return { code: 0, stdout: `${'s'.repeat(40)}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const deps = { run, runLogged: (c, a) => { calls.push([c, ...a].join(' ')); return { code: 0, text: 'ℹ fail 0\n' }; },
    cloneAt: (r, root, sha, dir) => { mkdirSync(dir, { recursive: true }); calls.push(`clone ${root} ${sha}`); return dir; },
    npmCi: () => {}, applySplit: async (r, dir, o = {}) => { calls.push(`split ${dir} with ${o.splitter}`); return { changed: [] }; },
    commitMigration: () => 'p'.repeat(40), relatedTests: () => ({ full: false, tests: ['test/a.test.mjs'] }),
    register: () => [], parity: () => ({ code: 0, rep: { routeDiffs: [], failedFlows: [], signedOutProblems: [], visualDiffs: [] } }) };
  return { calls, deps };
}
const CTX = { rehearsal: true, m: 'm'.repeat(40), mParent: 'h'.repeat(40), mRepo: '/m', devRepo: '/m', devRef: 'm'.repeat(40), splitter: '/splitter', devTree: '/m' };
const T = { key: '#7', branch: 'feat/old', title: 'feat: old', head: 'e'.repeat(40) };
const out = () => mkdtempSync(join(tmpdir(), 'cu-'));
// never a push, and nothing writes in the user's repo: -C /root is only ever a read
const safe = (calls) => {
  assert.ok(!calls.some((c) => /\bpush\b/.test(c)), calls.join('\n'));
  for (const c of calls.filter((x) => x.includes('-C /root'))) assert.match(c, /^git -C \/root (rev-parse|log|cat-file|merge-base|remote get-url)\b/, c);
};

test('catchUpOne: a merge conflict with M^ needs a hand fix naming the files, and no split is attempted', async () => {
  const { calls, deps } = fakes({ mergeCode: 1, unmerged: 'ui/server.mjs\nui/public/style.css\n' });
  const row = await catchUpOne({ root: '/root', t: T, ctx: CTX, out: out(), d: deps });
  assert.equal(row.verdict, 'needs hand fix');
  assert.deepEqual(row.reasons, ['merge with M^ conflicts in: ui/server.mjs, ui/public/style.css']);
  assert.ok(!calls.some((c) => c.startsWith('split ')));
  safe(calls);
});
test('catchUpOne: the clean path splits with M^\'s splitter, diffs M..split and applies it 3-way onto the latest dev', async () => {
  const { calls, deps } = fakes();
  const o = out();
  const row = await catchUpOne({ root: '/root', t: T, ctx: CTX, out: o, d: deps, parity: 'quick' });
  assert.equal(row.verdict, 'works', row.reasons.join('; '));
  assert.ok(calls.includes(`split ${join(o, '-7', 'tree')} with /splitter`), 'never the PR tree\'s own splitter');
  assert.ok(calls.some((c) => c === `git -C ${join(o, '-7', 'tree')} diff --binary ${CTX.m} ${'p'.repeat(40)}`));
  assert.ok(calls.includes(`clone /m ${CTX.devRef}`));
  assert.ok(calls.some((c) => c.startsWith(`git -C ${join(o, '-7', 'applied')} apply -3 --index `)));
  assert.equal(row.caughtUp, 's'.repeat(40));
  assert.deepEqual(row.tests, { ran: true, full: false, files: 1, fail: 0, unlisted: 0, log: 'tests.log' });
  assert.deepEqual([row.parity.own, row.parity.foreign], [0, []]);
  assert.ok(existsSync(join(o, '-7', 'P.patch')));
  safe(calls);
});
test('catchUpOne: unmerged paths after apply -3 need a hand fix naming them', async () => {
  const { calls, deps } = fakes({ applyCode: 1, unmerged: 'ui/routes/settings/config.mjs\nui/public/shell/sidebar.css\nui/public/shell/main.html\n' });
  const row = await catchUpOne({ root: '/root', t: T, ctx: CTX, out: out(), d: deps });
  assert.equal(row.verdict, 'needs hand fix');
  assert.deepEqual(row.reasons, ['3-way apply conflicts in: ui/routes/settings/config.mjs, ui/public/shell/sidebar.css, ui/public/shell/main.html']);
  safe(calls);
});
test('catchUpOne: a fork PR is split and applied, but its code is never run here', async () => {
  const { calls, deps } = fakes();
  const row = await catchUpOne({ root: '/root', t: { ...T, fork: true }, ctx: CTX, out: out(), d: deps });
  assert.equal(row.verdict, 'works');
  assert.deepEqual(row.tests, { ran: false, why: 'fork PR: its code is not run here' });
  assert.ok(!calls.some((c) => c.includes('tools/test.mjs')));
  safe(calls);
});
test('catchUpOne: the express 5 bump is "rebase after the migration" without cloning anything', async () => {
  const { calls, deps } = fakes();
  const row = await catchUpOne({ root: '/root', t: { ...T, title: 'chore(deps): bump express from 4.22.3 to 5.3.0' }, ctx: CTX, out: out(), d: deps });
  assert.equal(row.verdict, 'needs hand fix');
  assert.deepEqual(row.reasons, ['express 5 bump: rebase after the migration (runbook)']);
  assert.deepEqual(calls, []);
});
test('catchUpOne: without ctx.splitter, M^ is cloned once and reused as the splitter', async () => {
  const { calls, deps } = fakes();
  const ctx = { ...CTX, splitter: null }; const o = out();
  await catchUpOne({ root: '/root', t: T, ctx, out: o, d: deps });
  await catchUpOne({ root: '/root', t: { ...T, key: '#8' }, ctx, out: o, d: deps });
  assert.equal(calls.filter((c) => c === `clone /root ${CTX.mParent}`).length, 1);
  assert.ok(calls.includes(`split ${join(o, '-8', 'tree')} with ${join(o, 'splitter')}`));
});

test('resolveContext: no migration commit on origin/dev rehearses on HEAD\'s own split', async () => {
  const { calls, deps } = fakes();
  deps.run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args.some((x) => x.startsWith('refs/tags/'))) return { code: 1, stdout: '', stderr: '' };   // no feature-split tags yet
    return args.includes('log') ? { code: 0, stdout: 'aaa\tx\n', stderr: '' } : { code: 0, stdout: `${'h'.repeat(40)}\n`, stderr: '' };
  };
  const o = out();
  const ctx = await resolveContext({ root: '/root', out: o, d: deps });
  assert.deepEqual([ctx.rehearsal, ctx.mParent, ctx.m, ctx.mRepo, ctx.devTree], [true, 'h'.repeat(40), 'p'.repeat(40), join(o, 'm'), join(o, 'm')]);
  assert.ok(calls.includes(`split ${join(o, 'm')} with undefined`));
  safe(calls);
});

test('resolveContext: without --m, the tags feature-split/after and feature-split/before are M and M^', async () => {
  const { deps } = fakes();
  const tags = { 'refs/tags/feature-split/after^{commit}': 'a'.repeat(40), 'refs/tags/feature-split/before^{commit}': 'b'.repeat(40) };
  const rev = (have) => (cmd, args) => {
    const t = args.find((x) => x.startsWith('refs/tags/'));
    if (t) return have && tags[t] ? { code: 0, stdout: `${tags[t]}\n`, stderr: '' } : { code: 1, stdout: '', stderr: '' };
    if (args.includes('log')) return { code: 0, stdout: `${'c'.repeat(40)}\tSplit large files by feature (#919)\n`, stderr: '' };
    const x = args.at(-1); return { code: 0, stdout: `${x === 'origin/dev^{commit}' ? 'd'.repeat(40) : x.startsWith('m'.repeat(40)) ? 'n'.repeat(40) : 'e'.repeat(40)}\n`, stderr: '' };
  };
  deps.run = rev(true);
  let ctx = await resolveContext({ root: '/root', out: out(), d: deps });
  assert.deepEqual([ctx.rehearsal, ctx.m, ctx.mParent, ctx.devRef], [false, 'a'.repeat(40), 'b'.repeat(40), 'd'.repeat(40)]);
  ctx = await resolveContext({ root: '/root', out: out(), m: 'm'.repeat(40), d: deps });   // --m wins, and M^ is its own parent, not the tag
  assert.deepEqual([ctx.m, ctx.mParent], ['n'.repeat(40), 'e'.repeat(40)]);
  deps.run = rev(false);                                                                    // no tags: the freeze-day subject
  ctx = await resolveContext({ root: '/root', out: out(), d: deps });
  assert.deepEqual([ctx.rehearsal, ctx.m], [false, 'c'.repeat(40)]);
});

test('catchUpAll: one row per target, a gone head is a hand fix, all.json and report.md written', async () => {
  const { calls, deps } = fakes();
  const targets = [{ kind: 'PR', number: 7, title: 'feat: a', branch: 'feat/a', head: 'e'.repeat(40) }, { kind: 'dependabot branch', number: null, title: 'dependabot/x', branch: 'dependabot/x', head: 'f'.repeat(40) }];
  deps.listTargets = () => targets; deps.fetchHeads = () => [targets[1]];
  const o = out();
  const rows = await catchUpAll({ root: '/root', out: o, ctx: CTX, d: deps });
  assert.deepEqual(rows.map((r) => [r.key, r.verdict]), [['#7', 'works'], ['dependabot/x', 'needs hand fix']]);
  assert.deepEqual(rows[1].reasons, ['branch gone']);
  const all = JSON.parse(readFileSync(join(o, 'all.json'), 'utf8'));
  assert.deepEqual([all.mParent, all.m, all.mTree, all.rows.length], [CTX.mParent, CTX.m, 's'.repeat(40), 2]);
  assert.match(readFileSync(join(o, 'report.md'), 'utf8'), /^\| `#7` \| `feat\/a` \| works \|/m);
  safe(calls);
});

test('main: bad arguments exit 2; a fatal start exits 3; a hand fix exits 1', async () => {
  const errs = [];
  assert.equal(await main(['a', 'b'], { err: (m) => errs.push(m), log: () => {} }), 2);
  const { deps } = fakes();
  deps.run = (cmd, args) => (args.includes('cat-file') || args.includes('--verify') ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: 'aaa\tx\n', stderr: '' });
  assert.equal(await main(['feat/x', '--out', out()], { err: (m) => errs.push(m), log: () => {}, deps, root: '/root' }), 3);
  const f = fakes({ mergeCode: 1, unmerged: 'ui/server.mjs\n' });
  f.deps.run = ((inner) => (cmd, args) => (args.includes('log') ? { code: 0, stdout: `ccc\tSplit large files by feature (#919) (#1100)\n`, stderr: '' } : inner(cmd, args)))(f.deps.run);
  const lines = [];
  assert.equal(await main(['feat/x', '--out', out()], { err: () => {}, log: (l) => lines.push(l), deps: f.deps, root: '/root' }), 1);
  assert.ok(lines.some((l) => /needs hand fix/.test(l)), lines.join('\n'));
  assert.ok(!f.calls.some((c) => /\bpush\b/.test(c)));
});
