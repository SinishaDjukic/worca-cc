// test/readiness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, runReadiness, postFrom, splitAt } from '../tools/readiness.mjs';
import { validateReport, GATE_NOTE } from '../tools/readiness/report.mjs';

const SHA = 'a'.repeat(40);
const PARITY = { pass: true, timingGated: true, routeDiffs: [], visualDiffs: [], failedFlows: [],
  timings: { boot: { a: 1400, b: 1410, deltaPct: 0.7, gated: true, pass: true }, pages: { runs: { a: 300, b: 301, deltaPct: 0.3, gated: true, pass: true } } } };
const TARGET = { kind: 'PR', number: 1049, title: 'chore(deps): bump express from 4.22.3 to 5.3.0', branch: 'dependabot/npm_and_yarn/dev/express-5.3.0',
  head: 'd'.repeat(40), url: 'https://github.com/SinishaDjukic/worca-cc/pull/1049', ref: 'refs/readiness/pr/1049', src: 'refs/pull/1049/head' };

function fakeDeps({ failOpenPrs = false, noAuth = false, badSha = false, gateFailed = false, targets = [TARGET], gone = [] } = {}) {
  const run = (cmd, args) => {
    if (cmd === 'git' && args.includes('rev-parse')) return { code: 0, stdout: `${badSha ? 'nope' : SHA}\n`, stderr: '' };
    if (cmd === 'git' && args.includes('get-url')) return { code: 0, stdout: 'git@github.com:SinishaDjukic/worca-cc.git\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const runLogged = (cmd, args, file) => {
    mkdirSync(dirname(file), { recursive: true });
    const i = args.indexOf('--out');
    if (i >= 0) { mkdirSync(args[i + 1], { recursive: true }); writeFileSync(join(args[i + 1], 'report.json'), JSON.stringify(PARITY)); writeFileSync(join(args[i + 1], 'report.md'), 'PASS\n'); }
    const stats = gateFailed ? '9972 lines — spike gate FAILED' : '8000 lines — spike gate passed';
    const text = args.includes('tools/test.mjs') ? '✔ x\nℹ pass 1\nℹ fail 0\n'
      : args.includes('--stats') ? `moved 430/441 route statements (98%), ui/server.mjs after the split: ${stats}\n` : 'ok\n';
    writeFileSync(file, text);
    return { code: gateFailed && args.includes('--stats') ? 1 : 0, text };
  };
  return {
    run, runLogged,
    cloneAt: (_r, _root, _sha, dir) => { mkdirSync(join(dir, 'test'), { recursive: true }); writeFileSync(join(dir, 'test/flaky-register.json'), '[]'); return dir; },
    npmCi: () => {},
    applySplit: async () => ({ plan: { files: new Map([['ui/routes/chat.mjs', 'a\n']]) }, changed: ['ui/routes/chat.mjs'] }),
    treeHash: () => 'f'.repeat(40), resetTree: () => {}, commitMigration: () => 'b'.repeat(40),
    rehearseRollback: () => ({ ok: true, reverted: 'c'.repeat(40), diff: '', status: '', cleaned: '' }),
    servedEquivalence: async () => ({ ok: true, css: true, html: true, routes: true, routeCount: [2, 2], firstDiff: null }),
    docsAndPackage: () => ({ ok: true, designOk: true, featureFiles: true, notListed: [], notPacked: [], dirs: ['ui/public/chat/'] }),
    listTargets: () => { if (failOpenPrs || noAuth) throw new Error('gh pr list failed: HTTP 401'); return targets; },
    fetchHeads: () => gone, mergeCheck: () => ({ conflict: false, files: [] }), listRoutes: () => [],
    authStatus: () => (noAuth ? { ok: false, detail: 'gh auth status failed: run gh auth login' } : { ok: true, detail: 'gh is signed in to github.com as someone' }),
    codeFiles: () => [], deadCode: () => [], largestFiles: () => [], featureNames: () => ['chat'], movedByFeature: () => [{ feature: 'chat', files: [{ path: 'ui/routes/chat.mjs', lines: 1 }], lines: 1 }],
  };
}
const outDir = () => join(mkdtempSync(join(tmpdir(), 'readiness-run-')), 'out');
const go = (deps, extra = {}) => { const lines = []; return runReadiness({ root: '.', out: outDir(), log: (l) => lines.push(l), now: () => new Date('2026-10-30T12:00:00Z'), deps, ...extra }).then((r) => ({ ...r, lines })); };

test('parseArgs: run, post and split; anything else throws the usage line', () => {
  assert.deepEqual(parseArgs(['run', '--out', '/tmp/r', '--keep']), { cmd: 'run', out: '/tmp/r', keep: true });
  assert.deepEqual(parseArgs(['post', '--out', 'x']), { cmd: 'post', out: 'x' });
  assert.deepEqual(parseArgs(['split', '--rev', 'HEAD', '--splitter-rev', 'M^', '--out', 'w']), { cmd: 'split', rev: 'HEAD', splitterRev: 'M^', out: 'w' });
  assert.throws(() => parseArgs(['post']), /post needs --out DIR/);
  assert.throws(() => parseArgs(['split', '--rev', 'HEAD']), /split needs --rev REV --splitter-rev REV --out DIR/);
  assert.throws(() => parseArgs(['go']), /usage: readiness\.mjs run/);
});

test('runReadiness with every fake passing: 10 pass rows, go, a valid report, the rollback row has 4 links, trees removed', async () => {
  const { out, report, lines } = await go(fakeDeps());
  assert.deepEqual(validateReport(report), []);
  assert.equal(report.checks.length, 10);
  assert.ok(report.checks.every((c) => c.status === 'pass'), JSON.stringify(report.checks.filter((c) => c.status !== 'pass')));
  assert.equal(report.verdict.value, 'go');
  assert.equal(report.checks.find((c) => c.id === 'rollback').evidence.length, 4);
  assert.equal(report.openPrs[0].action, 'rebase after the migration');
  assert.ok(existsSync(join(out, 'report.md')) && existsSync(join(out, 'report.json')));
  assert.ok(!existsSync(join(out, 'trees')));
  assert.ok(lines.some((l) => /^readiness: verdict go \(0 of 10 checks fail\)/.test(l)));
});

test('runReadiness: a throwing step becomes a fail row with its log; the report validates and is no-go', async () => {
  const { out, report, lines } = await go(fakeDeps({ failOpenPrs: true }));
  assert.deepEqual(validateReport(report), []);
  assert.equal(report.verdict.value, 'no-go');
  const row = report.checks.find((c) => c.id === 'open-prs');
  assert.equal(row.status, 'fail'); assert.match(row.detail, /^error: gh pr list failed/);
  assert.match(readFileSync(join(out, 'evidence', 'open-prs.log'), 'utf8'), /gh pr list failed: HTTP 401/);
  assert.ok(lines.some((l) => /^readiness: verdict no-go/.test(l)));
});

test('runReadiness without gh auth still writes a valid report with gh-auth, open-prs and baseline as fail rows', async () => {
  const { report } = await go(fakeDeps({ noAuth: true }));
  assert.deepEqual(validateReport(report), []);
  assert.deepEqual(report.checks.filter((c) => c.status === 'fail').map((c) => c.id).sort(), ['baseline', 'gh-auth', 'open-prs']);
});

test('no open PRs is a passing open-prs row and does not fail the baseline row: the verdict stays go', async () => {
  const { report } = await go(fakeDeps({ targets: [] }));
  assert.deepEqual(report.checks.filter((c) => c.status !== 'pass').map((c) => c.id), []);
  assert.equal(report.verdict.value, 'go');
});

test('a head gone before the fetch is left out of the table and named in the open-prs row, which still passes', async () => {
  const other = { ...TARGET, number: 570, title: 'feat: x', url: 'u', ref: 'refs/readiness/pr/570', src: 'refs/pull/570/head' };
  const { report, out } = await go(fakeDeps({ targets: [other, TARGET], gone: [other] }));
  const row = report.checks.find((c) => c.id === 'open-prs');
  assert.equal(row.status, 'pass'); assert.match(row.detail, /; 1 gone before the fetch: #570$/);
  assert.deepEqual(report.openPrs.map((t) => t.number), [1049]);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'evidence', 'open-prs.json'), 'utf8')).gone, ['#570']);
});

test('without --out the run writes into a new private temp dir', async () => {
  const { out } = await runReadiness({ root: '.', log: () => {}, now: () => new Date('2026-10-30T12:00:00Z'), deps: fakeDeps() });
  try {
    assert.ok(out.startsWith(join(tmpdir(), 'worca-readiness-')), out);
    assert.equal(statSync(out).mode & 0o777, 0o700);
    assert.ok(existsSync(join(out, 'report.md')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('runReadiness keeps OUT/trees only with --keep, and removes it after a fatal report error too', async () => {
  const kept = await go(fakeDeps(), { keep: true });
  assert.ok(existsSync(join(kept.out, 'trees', 'base')));
  const out = outDir();
  await assert.rejects(() => runReadiness({ root: '.', out, log: () => {}, deps: fakeDeps({ badSha: true }) }), (e) => e.fatal && /dev commit must be a 40-character SHA/.test(e.message));
  assert.ok(!existsSync(join(out, 'trees')));
});

test('runReadiness refuses a non-empty out dir before fetching anything', async () => {
  const out = mkdtempSync(join(tmpdir(), 'readiness-full-')); writeFileSync(join(out, 'x'), '');
  const deps = fakeDeps(); let fetched = false; deps.runLogged = () => { fetched = true; return { code: 0, text: '' }; };
  await assert.rejects(() => runReadiness({ root: '.', out, deps, log: () => {} }), (e) => e.fatal && /is not empty/.test(e.message));
  assert.equal(fetched, false);
});

test('a failed spike gate is a split-check fail row, and the rollback row and verdict say "mechanics only"', async () => {
  const { report, out } = await go(fakeDeps({ gateFailed: true }));
  const sc = report.checks.find((c) => c.id === 'split-check');
  assert.equal(sc.status, 'fail');
  assert.match(sc.detail, /^spike gate FAILED: ui\/server\.mjs after the split 9972 lines > 9000/);
  assert.deepEqual(report.verdict.failing, ['split-check']);
  assert.ok(report.checks.find((c) => c.id === 'rollback').detail.includes(GATE_NOTE));
  assert.ok(readFileSync(join(out, 'report.md'), 'utf8').includes(GATE_NOTE));
});

test('postFrom posts the run\'s report with every #ev- anchor resolved, .json evidence included', async () => {
  const { out } = await go(fakeDeps());
  let body = '';
  const calls = [];
  const gh = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'gh' && args[0] === 'auth') return { code: 0, stdout: '', stderr: '✓ Logged in to github.com account someone (keyring)' };
    if (cmd === 'git' && args.includes('get-url')) return { code: 0, stdout: 'git@github.com:SinishaDjukic/worca-cc.git\n', stderr: '' };
    if (cmd === 'gh' && args[1] === 'comment') { body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8'); return { code: 0, stdout: 'https://github.com/SinishaDjukic/worca-cc/issues/919#issuecomment-1\n', stderr: '' }; }
    if (cmd === 'gh' && args[1] === 'view') return { code: 0, stdout: body, stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  const r = postFrom({ root: '.', out, run: gh, log: () => {} });
  assert.match(r.url, /issuecomment-1$/);
  assert.deepEqual(r.omitted, []);
  assert.ok(body.startsWith(`**Readiness dry run** · dev ${SHA.slice(0, 9)} · 2026-10-30T12:00:00Z`));
  const links = new Set([...body.matchAll(/\]\(#(ev-[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const ids = new Set([...body.matchAll(/<a id="(ev-[a-z0-9-]+)"><\/a>/g)].map((m) => m[1]));
  assert.deepEqual([...links].sort(), [...ids].sort());
  for (const a of ['ev-evidence-open-prs-json', 'ev-evidence-equivalence-json', 'ev-parity-reverted-report-md']) assert.ok(ids.has(a), a);
  assert.ok(!body.includes(out), 'the out dir is rewritten to $OUT');
});

test('splitAt clones both revisions as marked scratch trees, splits with the splitter tree and commits', async () => {
  const out = outDir(); const seen = {};
  const deps = {
    run: (cmd, args) => (assert.ok(!args.includes('rev-parse') || args.at(-2) === '--end-of-options', 'a "-…" revision is never read as an option'), args.includes('rev-parse') ? (args.at(-1).startsWith('nope') ? { code: 1, stdout: '', stderr: '' }
      : { code: 0, stdout: `${args.at(-1).startsWith('M^') ? 'b' : 'a'}${'0'.repeat(39)}\n`, stderr: '' }) : { code: 0, stdout: '', stderr: '' }),
    runLogged: () => ({ code: 0, text: '' }), npmCi: () => {},
    cloneAt: (_r, _root, sha, dir) => { (seen.clones ??= []).push([sha[0], dir]); return dir; },
    applySplit: async (_r, dir, { splitter }) => { seen.split = [dir, splitter]; return { changed: ['ui/routes/chat.mjs'] }; },
    commitMigration: () => 'c'.repeat(40),
  };
  const r = await splitAt({ root: '.', rev: 'HEAD', splitterRev: 'M^', out, deps });
  assert.deepEqual(seen.clones, [['a', join(out, 'tree')], ['b', join(out, 'splitter')]]);
  assert.deepEqual(seen.split, [join(out, 'tree'), join(out, 'splitter')]);
  assert.equal(r.commit, 'c'.repeat(40));
  await assert.rejects(() => splitAt({ root: '.', rev: 'nope', splitterRev: 'M^', out: outDir(), deps }), /unknown revision nope/);
});
