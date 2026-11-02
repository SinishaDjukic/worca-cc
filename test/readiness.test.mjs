// test/readiness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, runReadiness, postFrom, splitAt, e2eScripts, runbookInputs, main } from '../tools/readiness.mjs';
import { validateReport, GATE_NOTE, SPLITTER_NOTE } from '../tools/readiness/report.mjs';
import { keyOf } from '../tools/readiness/open-prs.mjs';

const SHA = 'a'.repeat(40);
const PARITY = { pass: true, timingGated: true, routeDiffs: [], visualDiffs: [], failedFlows: [],
  timings: { boot: { a: 1400, b: 1410, deltaPct: 0.7, gated: true, pass: true }, pages: { runs: { a: 300, b: 301, deltaPct: 0.3, gated: true, pass: true } } } };
const TARGET = { kind: 'PR', number: 1049, title: 'chore(deps): bump express from 4.22.3 to 5.3.0', branch: 'dependabot/npm_and_yarn/dev/express-5.3.0',
  head: 'd'.repeat(40), url: 'https://github.com/SinishaDjukic/worca-cc/pull/1049', ref: 'refs/readiness/pr/1049', src: 'refs/pull/1049/head' };

const CRAWL = { pass: true, control: true, a: { spec: 'tree:base', tree: SHA }, bs: [{ spec: 'tree:mig', tree: SHA }], masks: [], minutes: 1,
  comparisons: [{ label: 'migrated', pass: true, diffs: [] }],
  coverage: { screens: 3, routes: { registered: 2, visited: 2, unvisited: [], unfillable: [] }, elements: { found: 5, exercised: 4, skipped: 1, byReason: {} } } };
const RAISES = [{ file: 'ui/server.mjs', from: 9972, to: 10085, why: "dev's own growth" }];
// a Playwright JSON report for e2e:extension: `afterStatus` on the migrated tree, 'unexpected' on the base (dev's darwin baselines)
const pwReport = (st) => ({ suites: [{ title: 'visual.spec.mjs', specs: [{ title: 'sidebar light', tests: [{ projectName: '', status: st }] }] }] });

function fakeDeps({ failOpenPrs = false, noAuth = false, badSha = false, gateFailed = false, splitterMissing = false, e2eFail = null, targets = [TARGET], gone = [], afterStatus = 'unexpected', calls = [], crawl = CRAWL } = {}) {
  const run = (cmd, args) => {
    if (cmd === 'git' && args.includes('rev-parse')) return { code: 0, stdout: `${badSha ? 'nope' : SHA}\n`, stderr: '' };
    if (cmd === 'git' && args.includes('get-url')) return { code: 0, stdout: 'git@github.com:SinishaDjukic/worca-cc.git\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const runLogged = (cmd, args, file, o = {}) => {
    mkdirSync(dirname(file), { recursive: true });
    calls.push([cmd, ...args].join(' '));
    const json = o.env?.PLAYWRIGHT_JSON_OUTPUT_NAME;
    if (json) writeFileSync(json, JSON.stringify(pwReport(o.cwd?.endsWith('migrated') ? afterStatus : 'unexpected')));
    const i = args.indexOf('--out');
    if (i >= 0) { mkdirSync(args[i + 1], { recursive: true }); writeFileSync(join(args[i + 1], 'report.json'), JSON.stringify(args.includes('crawl') ? crawl : PARITY)); writeFileSync(join(args[i + 1], 'report.md'), 'PASS\n'); }
    const stats = gateFailed ? '9980 lines — spike gate FAILED (ui/server.mjs 9980 lines > ceiling 9972)' : '9972 lines — spike gate passed (>= 95% moved, ceiling 9972 lines)';
    const text = args.includes('tools/test.mjs') ? '✔ x\nℹ pass 1\nℹ fail 0\n'
      : args.includes('--stats') ? `moved 430/441 route statements (98%), ui/server.mjs after the split: ${stats}\n` : 'ok\n';
    writeFileSync(file, text);
    const failed = (gateFailed && args.includes('--stats')) || (cmd === 'npm' && args[0] === 'run' && args[1] === e2eFail);
    return { code: failed ? 1 : 0, text };
  };
  const SCRIPTS = { 'e2e:extension': 'node tools/build-extension.mjs --test && playwright test -c e2e/extension/playwright.config.mjs', 'e2e:extension:update-linux': 'y', 'e2e:firefox-smoke': 'z', test: 't' };
  return {
    run, runLogged,
    cloneAt: (_r, _root, _sha, dir) => {
      mkdirSync(join(dir, 'test'), { recursive: true }); writeFileSync(join(dir, 'test/flaky-register.json'), '[]'); writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: SCRIPTS }));
      if (dir.endsWith('migrated')) { mkdirSync(join(dir, 'tools/split-by-feature'), { recursive: true }); writeFileSync(join(dir, 'tools/split-by-feature/size-caps-raises.json'), JSON.stringify(RAISES)); }
      return dir;
    },
    npmCi: () => {},
    hasSplitter: () => !splitterMissing,
    applySplit: async () => ({ plan: { files: new Map([['ui/routes/chat.mjs', 'a\n']]), stats: { serverLinesAfter: 9972, pinnedRoutes: 11 } }, ceiling: 9972, changed: ['ui/routes/chat.mjs'] }),
    sliceOneEquivalence: async () => ({ equal: true, problems: [], probes: 40, routes: 523, acceptedDeltas: [{ note: '/style.css: ETag value is a body hash instead of size-mtime' }] }),
    treeHash: () => 'f'.repeat(40), resetTree: () => {}, commitMigration: () => 'b'.repeat(40),
    rehearseRollback: () => ({ ok: true, reverted: 'c'.repeat(40), diff: '', status: '', cleaned: '' }),
    servedEquivalence: async () => ({ ok: true, css: true, html: true, routes: true, routeCount: [2, 2], firstDiff: null }),
    docsAndPackage: () => ({ ok: true, designOk: true, featureFiles: true, notListed: [], notPacked: [], dirs: ['ui/public/chat/'] }),
    listTargets: () => { if (failOpenPrs || noAuth) throw new Error('gh pr list failed: HTTP 401'); return targets; },
    fetchHeads: () => gone, mergeCheck: () => ({ conflict: false, files: [] }), listRoutes: () => [],
    authStatus: () => (noAuth ? { ok: false, detail: 'gh auth status failed: run gh auth login' } : { ok: true, detail: 'gh is signed in to github.com as someone' }),
    codeFiles: () => [], deadCode: () => [], largestFiles: () => [], featureNames: () => ['chat'], movedByFeature: () => [{ feature: 'chat', files: [{ path: 'ui/routes/chat.mjs', lines: 1 }], lines: 1 }],
    catchUpAll: async ({ targets: ts }) => { calls.push('catchUpAll'); return ts.map((t) => ({ key: keyOf(t), verdict: 'works', reasons: [] })); },
  };
}
const outDir = () => join(mkdtempSync(join(tmpdir(), 'readiness-run-')), 'out');
const go = (deps, extra = {}) => { const lines = []; return runReadiness({ root: '.', out: outDir(), log: (l) => lines.push(l), now: () => new Date('2026-10-30T12:00:00Z'), deps, ...extra }).then((r) => ({ ...r, lines })); };

test('parseArgs: run, post and split; anything else throws the usage line', () => {
  assert.deepEqual(parseArgs(['run', '--out', '/tmp/r', '--keep']), { cmd: 'run', out: '/tmp/r', keep: true, crawlFrom: null, catchUpFrom: null });
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
  const rollback = report.checks.find((c) => c.id === 'rollback');
  assert.deepEqual(rollback.evidence.map((e) => e.href), ['evidence/rollback-diff.log', 'evidence/suite-reverted.log', 'parity-reverted/report.md', 'evidence/parity-reverted.log']);
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
  assert.match(sc.detail, /^spike gate FAILED: ui\/server\.mjs 9980 lines > ceiling 9972$/);
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

test('a dev commit without the splitter: split-check names it, later rows say why, the verdict names the cause, not the gate', async () => {
  const { report, out } = await go(fakeDeps({ splitterMissing: true }));
  const sc = report.checks.find((c) => c.id === 'split-check');
  assert.equal(sc.status, 'fail');
  assert.equal(sc.detail, `splitter missing: tools/split-by-feature.mjs is not in the dev commit ${SHA.slice(0, 9)} (the #919 tooling is not merged into dev)`);
  assert.equal(report.verdict.cause, 'splitter-missing');
  for (const id of ['dry-run-repeatable', 'equivalence', 'rollback', 'baseline']) assert.match(report.checks.find((c) => c.id === id).detail, /no splitter on the dev commit/, id);
  const md = readFileSync(join(out, 'report.md'), 'utf8');
  assert.ok(md.includes(SPLITTER_NOTE)); assert.ok(!md.includes(GATE_NOTE));
});

test('rollback is the empty diff, the suite and a quick parity; no e2e suite runs and the row names the three', async () => {
  const calls = []; const r = await go(fakeDeps({ calls }));
  const row = r.report.checks.find((c) => c.id === 'rollback');
  assert.equal(row.status, 'pass'); assert.match(row.detail, /^diff empty; suite green; quick parity PASS/);
  assert.ok(!calls.some((c) => /npm run e2e:/.test(c)), 'no e2e in readiness');
  assert.match(calls.find((c) => c.includes('parity-reverted')), /--quick/);
});

test('run --firefox-in-ci is an unknown argument now (readiness runs no e2e): exit 2', async () => {
  assert.throws(() => parseArgs(['run', '--firefox-in-ci']), /unknown argument --firefox-in-ci/);
  const errs = [];
  assert.equal(await main(['run', '--firefox-in-ci'], { log: () => {}, err: (l) => errs.push(l) }), 2);
  assert.match(errs.join('\n'), /--firefox-in-ci/);
});

test('runbookInputs reads the owner and the freeze window from the runbook Inputs table; an empty cell is null', () => {
  assert.deepEqual(runbookInputs('| Go/no-go owner | Emil Angelov |\n| Freeze window | dev frozen since 2026-11-01 at bf92e1579 |\n'),
    { owner: 'Emil Angelov', freezeWindow: 'dev frozen since 2026-11-01 at bf92e1579' });
  assert.deepEqual(runbookInputs('| Go/no-go owner | |\n| Freeze window | |\n'), { owner: null, freezeWindow: null });
  assert.deepEqual(runbookInputs(''), { owner: null, freezeWindow: null });
});

test('risks.ceilingRaises comes from the migrated tree\'s size-caps-raises.json, with its evidence', async () => {
  const { report, out } = await go(fakeDeps());
  assert.deepEqual(report.risks.ceilingRaises, RAISES);
  assert.ok(report.risks.evidence.some((e) => e.href === 'evidence/size-caps-raises.json'));
  assert.ok(existsSync(join(out, 'evidence/size-caps-raises.json')));
  assert.match(readFileSync(join(out, 'report.md'), 'utf8'), /^- Ceiling raised: `ui\/server\.mjs` 9,972 → 10,085 lines \(dev's own growth\): needs the owner's sign-off$/m);
});

test('e2eScripts: every e2e:* suite, not the snapshot updaters, sorted', () => {
  assert.deepEqual(e2eScripts({ 'e2e:firefox-smoke': '', 'e2e:extension:update-linux': '', 'e2e:extension': '', test: '' }), ['e2e:extension', 'e2e:firefox-smoke']);
});

test('the report carries accepted deltas, the residual server size with its ceiling and the pin count under Risks', async () => {
  const { report, out } = await go(fakeDeps());
  assert.deepEqual(report.risks.acceptedDeltas, [{ note: '/style.css: ETag value is a body hash instead of size-mtime' }]);
  assert.equal(report.risks.serverLines, 9972); assert.equal(report.risks.ceiling, 9972); assert.equal(report.risks.pins, 11);
  assert.ok(existsSync(join(out, 'evidence/accepted-deltas.json')));
  assert.match(readFileSync(join(out, 'report.md'), 'utf8'), /^- Residual `ui\/server\.mjs`: 9972 lines, capped at 9972 .*not under 1,000$/m);
});

test('when the equivalence step throws, Risks still shows the residual server size and the pin count', async () => {
  const deps = fakeDeps(); deps.sliceOneEquivalence = async () => { throw new Error('boom'); };
  const { report, out } = await go(deps);
  assert.equal(report.checks.find((c) => c.id === 'equivalence').status, 'fail');
  const md = readFileSync(join(out, 'report.md'), 'utf8');
  assert.match(md, /^- Residual `ui\/server\.mjs`: 9972 lines, capped at 9972/m);
  assert.match(md, /^- Routes pinned in `ui\/server\.mjs`: 11/m);
  assert.match(md, /accepted deltas not measured \(the equivalence row failed\)/);
});

test('without a migration commit the report still validates and Risks says it was not measured', async () => {
  const deps = fakeDeps(); deps.commitMigration = () => { throw new Error('git commit: exit 1'); };
  const { report, out } = await go(deps);
  assert.deepEqual(validateReport(report), []);
  assert.ok(existsSync(join(out, 'report.json')));
  assert.equal(report.risks.note, 'not measured: no migrated tree');
});

test('--dev-ref: the run uses that commit, the report names it, and post refuses a rehearsal report', async () => {
  assert.deepEqual(parseArgs(['run', '--out', 'x', '--dev-ref', 'abc']), { cmd: 'run', out: 'x', keep: false, crawlFrom: null, catchUpFrom: null, devRef: 'abc' });
  assert.throws(() => parseArgs(['run', '--dev-ref']), /run --dev-ref needs REF/);
  const { out, report } = await go(fakeDeps(), { devRef: 'abc' });
  assert.equal(report.devCommit.ref, 'abc');
  assert.throws(() => postFrom({ root: '.', out, run: () => ({ code: 0, stdout: '', stderr: '' }), log: () => {} }), /refusing to post: the report is a rehearsal on abc, not origin\/dev/);
});

test('a failed split removes its half-built out dir, and an empty out dir it was given is left empty', async () => {
  const deps = {
    run: (cmd, args) => (args.includes('rev-parse') ? { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' } : { code: 0, stdout: '', stderr: '' }),
    runLogged: () => ({ code: 0, text: '' }), npmCi: (_r, _dir, log) => writeFileSync(log, 'npm ci\n'),
    cloneAt: (_r, _root, _sha, dir) => { mkdirSync(join(dir, '.git'), { recursive: true }); return dir; },
    applySplit: async () => { throw new Error('the split plan has 1 problem(s)'); }, commitMigration: () => 'c'.repeat(40),
  };
  const out = outDir();
  await assert.rejects(() => splitAt({ root: '.', rev: 'HEAD', splitterRev: 'HEAD', out, deps }), /the split plan has 1 problem/);
  assert.equal(existsSync(out), false);
  const given = mkdtempSync(join(tmpdir(), 'readiness-split-empty-'));
  await assert.rejects(() => splitAt({ root: '.', rev: 'HEAD', splitterRev: 'HEAD', out: given, deps }));
  assert.deepEqual(readdirSync(given), []);
});

test('every open-PR row carries its catch-up verdict; a hand fix does not fail the open-prs row', async () => {
  const other = { ...TARGET, number: 570, title: 'feat: x', url: 'u', ref: 'refs/readiness/pr/570', src: 'refs/pull/570/head' };
  const deps = fakeDeps({ targets: [other, TARGET] });
  deps.catchUpAll = async ({ targets: ts, ctx }) => {
    assert.deepEqual([ctx.mParent, ctx.m], [SHA, 'b'.repeat(40)]);
    return ts.map((t) => ({ key: keyOf(t), verdict: t.number === 570 ? 'needs hand fix' : 'works', reasons: t.number === 570 ? ['merge with M^ conflicts in: ui/server.mjs'] : [] }));
  };
  const { report, out } = await go(deps);
  assert.equal(report.checks.find((c) => c.id === 'open-prs').status, 'pass');
  assert.deepEqual(report.openPrs.map((t) => [t.number, t.catchUp.verdict]), [[570, 'needs hand fix'], [1049, 'works']]);
  assert.ok(existsSync(join(out, 'evidence/catch-up.json')));
  assert.match(readFileSync(join(out, 'report.md'), 'utf8'), /\| needs hand fix `merge with M\^ conflicts in: ui\/server\.mjs` \|$/m);
});

test('--catch-up-from is reused only when its M^ is the dev commit and its M tree is the migration tree', async () => {
  assert.equal(parseArgs(['run', '--catch-up-from', 'x.json']).catchUpFrom, join(process.cwd(), 'x.json'));
  const dir = mkdtempSync(join(tmpdir(), 'readiness-cu-'));
  const file = (mTree) => { const f = join(dir, `${mTree[0]}.json`); writeFileSync(f, JSON.stringify({ mParent: SHA, m: 'b'.repeat(40), mTree, rows: [{ key: '#1049', verdict: 'works', reasons: [] }] })); return f; };
  const calls = [];
  const { report } = await go(fakeDeps({ calls }), { catchUpFrom: file(SHA) });
  assert.ok(!calls.includes('catchUpAll'));
  assert.equal(report.openPrs[0].catchUp.verdict, 'works');
  const calls2 = [];
  await go(fakeDeps({ calls: calls2 }), { catchUpFrom: file('9'.repeat(40)) });
  assert.ok(calls2.includes('catchUpAll'));
});

test('the parity row is parity and the crawl: a failing crawl fails it, both passing pass it', async () => {
  const { report, out } = await go(fakeDeps());
  const row = report.checks.find((c) => c.id === 'parity');
  assert.equal(row.status, 'pass');
  assert.match(row.detail, /; crawl PASS: 3 screens, 2\/2 routes/);
  assert.ok(row.evidence.some((e) => e.href === 'crawl/report.md'));
  assert.ok(existsSync(join(out, 'crawl/report.md')));
  const bad = await go(fakeDeps({ crawl: { ...CRAWL, pass: false } }));
  const r2 = bad.report.checks.find((c) => c.id === 'parity');
  assert.equal(r2.status, 'fail'); assert.match(r2.detail, /crawl FAIL/);
});

test('--crawl-from is reused only when its A and first B trees are the base and migrated trees', async () => {
  assert.equal(parseArgs(['run', '--crawl-from', 'c']).crawlFrom, join(process.cwd(), 'c'));
  const dir = (tree) => { const d = mkdtempSync(join(tmpdir(), 'readiness-crawl-')); writeFileSync(join(d, 'report.json'), JSON.stringify({ ...CRAWL, bs: [{ spec: 'x', tree }, { spec: 'package:.', tree: null }] })); writeFileSync(join(d, 'report.md'), 'reused\n'); mkdirSync(join(d, 'a1')); writeFileSync(join(d, 'records.ndjson'), ''); return d; };
  const calls = [];
  const { report, out } = await go(fakeDeps({ calls }), { crawlFrom: dir(SHA) });
  assert.ok(!calls.some((c) => / crawl /.test(c)), calls.join('\n'));
  assert.match(report.checks.find((c) => c.id === 'parity').detail, /\(verify:919 row h, same trees\)/);
  assert.equal(readFileSync(join(out, 'crawl/report.md'), 'utf8'), 'reused\n');
  assert.ok(!existsSync(join(out, 'crawl/a1')) && !existsSync(join(out, 'crawl/records.ndjson')));
  const calls2 = [];
  await go(fakeDeps({ calls: calls2 }), { crawlFrom: dir('9'.repeat(40)) });
  assert.ok(calls2.some((c) => / crawl /.test(c)));
});
