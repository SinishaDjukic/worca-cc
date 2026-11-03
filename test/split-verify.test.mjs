// test/split-verify.test.mjs — tools/split-verify.mjs in-process with fakes: rows a–l, the table, the gaps and the exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runVerify, main, parityGaps, renderTable, crawlGaps, ROWS } from '../tools/split-verify.mjs';
import { EXPECTED_SHOTS, FLOW_NAMES } from '../tools/parity/compare.mjs';

const HEAD = 'h'.repeat(40); const DEV = 'd'.repeat(40);
const goodParity = (timed) => ({ pass: true, routeDiffs: [], visualDiffs: [], failedFlows: [], signedOutProblems: [], problems: [],
  visual: Array.from({ length: EXPECTED_SHOTS }, () => ({ pixels: 0 })),
  flows: ['a', 'b'].flatMap((side) => FLOW_NAMES.map((name) => ({ name, side, ok: true }))),
  routeCounts: { a: { listed: 9, probed: 9, skipped: 0 }, b: { listed: 9, probed: 9, skipped: 0 } },
  timingGated: timed, timings: { boot: { a: 900, b: 905 }, pages: { 'chat-home': { a: 300, b: 301 }, runs: { a: 280, b: 282 } } } });
const goodCrawl = () => ({ pass: true, control: true, a: { spec: 'tree:.', tree: 't'.repeat(40) }, bs: [{ spec: 'tree:split', tree: 's'.repeat(40) }, { spec: 'package:.', tree: null }],
  masks: [{ id: 'x', field: 'dom', path: '0.1', why: 'a number differs (count or time)' }], minutes: 60, externalApps: { stubbed: 4, canary: [] },
  comparisons: [{ label: 'split', level: 'full', pass: true, diffs: [] }, { label: 'package', level: 'screen', pass: true, diffs: [] }],
  coverage: { screens: 120, routes: { registered: 90, visited: 90, unvisited: [], unfillable: [] }, elements: { found: 4000, exercised: 1500, skipped: 2500, byReason: {} } } });
const pwReport = (st) => ({ suites: [{ title: 'visual.spec.mjs', specs: [{ title: 'sidebar light', tests: [{ projectName: '', status: st }] }] }] });
const PW_SCRIPT = 'node tools/build-extension.mjs --test --browser chrome && playwright test -c e2e/extension/playwright.config.mjs';
const works = (key, extra = {}) => ({ key, verdict: 'works', reasons: [], moved: [{ from: 'ui/server.mjs', to: ['ui/routes/settings/config.mjs'] }], tests: { ran: true }, ...extra });
const REGISTER = [{ file: 'test/git-sync.test.mjs', test: 'a timed-out fetch kills its whole process group …', symptom: 's', alone: 'fails alone too' }];
const put = (f, s) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s); };

function fakes({ hashes = ['f'.repeat(40), 'f'.repeat(40)], skip = null, shots = EXPECTED_SHOTS, suiteLog = 'ℹ pass 1\nℹ fail 0\n', splitThrows = false,
  crawl = goodCrawl(), e2eAfter = 'unexpected', smokeFails = false, fixture = works('fixture'), prs = [works('#7'), { ...works('#8'), verdict: 'needs hand fix', reasons: ['merge with M^ conflicts in: ui/server.mjs'] }] } = {}) {
  const calls = []; let dry = 0;
  const run = (cmd, args) => { calls.push([cmd, ...args].join(' '));
    if (args[0] === 'rev-parse') return { code: 0, stdout: `${args[1] === 'HEAD' ? HEAD : DEV}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' }; };
  const runLogged = (cmd, args, file, o = {}) => {
    const line = [cmd, ...args].join(' '); calls.push(line); let text = 'ok\n'; let code = 0;
    const at = (k) => args[args.indexOf(k) + 1];
    if (line.includes('--check --stats')) text = 'moved 430/441 route statements (98%), ui/server.mjs after the split: 9972 lines — spike gate passed (>= 95% moved, ceiling 9972 lines)\n';
    else if (line.includes('--dry-run')) put(at('--json'), JSON.stringify({ ok: true, treeHash: hashes[dry++] }));
    else if (line.includes('tools/test.mjs')) text = args.length > 1 ? 'ℹ fail 0\n' : suiteLog;
    else if (line.includes('tools/parity.mjs crawl') || line.includes('tools/parity.mjs\0crawl') || (args.includes('tools/parity.mjs') && args.includes('crawl'))) { const o2 = at('--out'); put(join(o2, 'report.json'), JSON.stringify(crawl)); put(join(o2, 'report.md'), 'crawl\n'); }
    else if (line.includes('tools/parity.mjs')) { const o2 = at('--out'); const timed = !args.includes('--quick') && !line.includes('package:');
      const rep = goodParity(timed); rep.visual = rep.visual.slice(0, shots); put(join(o2, 'report.json'), JSON.stringify(rep)); put(join(o2, 'report.md'), 'PASS\n'); }
    else if (cmd === 'npm' && /^e2e:/.test(args[1] ?? '')) {
      text = args[1] === skip ? `${args[1]}: SKIP — no Firefox found\n` : 'passed\n';
      if (args[1] === 'e2e:firefox-smoke' && smokeFails) code = 1;
      const json = o.env?.PLAYWRIGHT_JSON_OUTPUT_NAME;
      if (json) { put(json, JSON.stringify(pwReport(o.cwd?.endsWith('before') ? 'unexpected' : e2eAfter))); code = 1; }   // dev's darwin baselines: fails on both trees
    }
    else if (line.includes('tools/readiness.mjs')) { const o2 = at('--out');
      put(join(o2, 'report.json'), JSON.stringify({ verdict: { value: 'go', failing: [] } })); put(join(o2, 'report.md'), '# go\n'); }
    put(file, text); return { code, text };
  };
  return { calls, deps: { run, runLogged, cloneAt: () => {}, npmCi: () => {}, buildExtension: () => ({ code: 0 }),
    applySplit: async () => { if (splitThrows) throw new Error('planSplit: boom'); return {}; },
    commitMigration: () => 'm'.repeat(40), rehearseRollback: () => ({ ok: true, reverted: 'r'.repeat(40), diff: '', status: '', cleaned: '' }),
    catchUpFixture: async (o) => { calls.push(`catchUpFixture ${o.out}`); return fixture; },
    catchUpAll: async (o) => { calls.push(`catchUpAll ${o.out} splitter=${o.ctx.splitter}`); return prs; },
    register: () => REGISTER, scripts: () => ({ 'e2e:extension': PW_SCRIPT, 'e2e:extension:update-linux': 'y', 'e2e:firefox-smoke': 'node tools/firefox-smoke.mjs' }) } };
}
const out = () => join(mkdtempSync(join(tmpdir(), 'split-verify-')), 'out');
// a real root: g and h build extension/dist into it, and h copies that build into the split tree
const go = (f, extra = {}) => {
  f.root = mkdtempSync(join(tmpdir(), 'split-verify-root-'));
  const build = f.deps.buildExtension;
  f.deps.buildExtension = (file) => { put(join(f.root, 'extension/dist/chrome/manifest.json'), '{}'); return build(file); };
  return runVerify({ root: f.root, out: out(), log: () => {}, deps: f.deps, ...extra });
};

test('all green: rows a–l in order, one table, pass; readiness gets --dev-ref when HEAD is not origin/dev', async () => {
  const f = fakes(); const r = await go(f);
  assert.deepEqual(ROWS.map(([id, c]) => `${id} ${c}`), ['a fetch', 'b gate', 'c dry-run-repeatable', 'd suite-split', 'e parity-quick', 'f parity-full',
    'g parity-package', 'h crawl', 'i e2e-split', 'j catch-up', 'k rollback', 'l readiness']);
  assert.deepEqual(r.rows.map((x) => x.id), ROWS.map(([id]) => id));
  assert.ok(r.rows.every((x) => x.ok), JSON.stringify(r.rows.filter((x) => !x.ok)));
  assert.equal(r.pass, true);
  assert.ok(f.calls.some((c) => c.includes('tools/readiness.mjs run') && c.includes(`--dev-ref ${HEAD}`)));
  assert.ok(!f.calls.some((c) => / post\b/.test(c)), 'never posts');
  assert.equal(readFileSync(join(r.out, 'split-verify.md'), 'utf8').split('\n').filter((l) => /^\| [a-l]\. /.test(l)).length, 12);
  const l = f.calls.find((c) => c.includes('tools/readiness.mjs run'));
  assert.ok(l.includes(`--crawl-from ${join(r.out, 'crawl')}`) && l.includes(`--catch-up-from ${join(r.out, 'catch-up', 'all.json')}`), l);
  assert.ok(!l.includes('--firefox-in-ci'));
  assert.ok(f.calls.some((c) => c.includes('npm run e2e:firefox-smoke')));
  assert.ok(!f.calls.some((c) => /\bpush\b/.test(c)), 'never pushes');
  assert.equal(r.rows.find((x) => x.id === 'l').evidence, 'readiness/report.md');
});

test('a failing split tree fails d–f and h–k and the run still reaches l: it stops at nothing', async () => {
  const f = fakes({ splitThrows: true }); const r = await go(f);
  const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  for (const id of ['d', 'e', 'f', 'h', 'i', 'j', 'k']) assert.equal(byId[id].ok, false, id);    // g packs this checkout, not the split
  assert.equal(byId.g.ok, true); assert.equal(byId.l.ok, true); assert.equal(r.pass, false);
});

test('c fails when the two dry runs give different tree hashes', async () => {
  const r = await go(fakes({ hashes: ['1'.repeat(40), '2'.repeat(40)] }));
  assert.equal(r.rows.find((x) => x.id === 'c').ok, false);
});

test('i fails when an e2e suite prints SKIP or fails (a missing browser is a fail), without --firefox-in-ci', async () => {
  const i = (await go(fakes({ skip: 'e2e:firefox-smoke' }))).rows.find((x) => x.id === 'i');
  assert.equal(i.ok, false); assert.match(i.number, /e2e:firefox-smoke SKIPPED/);
  const i2 = (await go(fakes({ smokeFails: true }))).rows.find((x) => x.id === 'i');
  assert.equal(i2.ok, false); assert.match(i2.number, /e2e:firefox-smoke FAIL/);
});

test('i: e2e:extension failing identically before and after passes (same before/after); one status off fails it', async () => {
  const f = fakes(); const r = await go(f);
  const i = r.rows.find((x) => x.id === 'i');
  assert.equal(i.ok, true); assert.match(i.number, /e2e:extension same before\/after \(0 pass, 1 fail, 0 images identical\)/);
  assert.equal(f.calls.filter((c) => c.startsWith('npm run e2e:extension')).length, 2, 'before once, after in i (row k runs no e2e)');
  const bad = (await go(fakes({ e2eAfter: 'expected' }))).rows.find((x) => x.id === 'i');
  assert.equal(bad.ok, false); assert.match(bad.number, /NOT same before\/after .*sidebar light: unexpected before, expected after/);
});

test('--firefox-in-ci: the Firefox suite never runs; i passes and says so; the table tail, json and log line name CI', async () => {
  const f = fakes(); const lines = [];
  const r = await go(f, { log: (l) => lines.push(l), firefoxInCi: true });
  assert.ok(!f.calls.some((c) => c.includes('npm run e2e:firefox-smoke')), 'never run in any tree');
  const i = r.rows.find((y) => y.id === 'i');
  assert.equal(i.ok, true); assert.match(i.number, /e2e:firefox-smoke: CI job firefox-e2e, not run locally/);
  assert.ok(readFileSync(join(r.out, 'split-verify.md'), 'utf8').trimEnd().endsWith(
    'Not run locally (not a pass): e2e:firefox-smoke in rows i (was h) → CI job firefox-e2e (.github/workflows/firefox-e2e.yml)'));
  assert.deepEqual(JSON.parse(readFileSync(join(r.out, 'split-verify.json'), 'utf8')).notLocal,
    [{ row: 'i', name: 'e2e:firefox-smoke', ci: 'firefox-e2e' }]);
  assert.ok(!f.calls.find((c) => c.includes('tools/readiness.mjs run')).includes('--firefox-in-ci'), 'readiness runs no e2e (D9)');
  assert.match(lines.at(-1), /split:verify PASS, except 1 suite left to CI \(firefox-e2e\) \(/);
});

test('h: a crawl diff, no control pass or an unvisited route fails it; a clean crawl names both comparisons and the coverage', async () => {
  const h = (await go(fakes())).rows.find((x) => x.id === 'h');
  assert.equal(h.ok, true); assert.match(h.number, /120 screens, 90\/90 routes, .*split 0 diffs, package \(screens\) 0 diffs/);
  assert.equal(h.evidence, 'crawl/report.md');
  const c = goodCrawl();
  for (const bad of [{ ...c, pass: false, comparisons: [{ ...c.comparisons[0], pass: false, diffs: [{ id: 'x', field: 'dom' }] }, c.comparisons[1]] },
    { ...c, control: false }, { ...c, coverage: { ...c.coverage, routes: { ...c.coverage.routes, unvisited: ['#workspaces/w1'] } } }]) {
    assert.equal((await go(fakes({ crawl: bad }))).rows.find((x) => x.id === 'h').ok, false, JSON.stringify(crawlGaps(bad)));
  }
  assert.deepEqual(crawlGaps({ ...c, control: false }), ['no control pass']);
});

test('j: the fixture decides the row; an open PR needing a hand fix does not fail it and is counted', async () => {
  const f = fakes(); const r = await go(f);
  const j = r.rows.find((x) => x.id === 'j');
  assert.equal(j.ok, true);
  assert.match(j.number, /^fixture works: ui\/server\.mjs → ui\/routes\/settings\/config\.mjs; open PRs: 1 work, 1 need a hand fix$/);
  assert.ok(f.calls.some((c) => c.startsWith('catchUpAll ') && c.endsWith(`splitter=${f.root}`)), "root at HEAD is M^'s splitter");
  const bad = (await go(fakes({ fixture: { ...works('fixture'), verdict: 'needs hand fix', reasons: ['3-way apply conflicts in: x'] } }))).rows.find((x) => x.id === 'j');
  assert.equal(bad.ok, false); assert.match(bad.number, /fixture needs hand fix \(3-way apply conflicts in: x\)/);
});

test('f fails when the full parity run lacks a screenshot pair', async () => {
  const r = await go(fakes({ shots: EXPECTED_SHOTS - 1 }));
  assert.match(r.rows.find((x) => x.id === 'f').number, /17 shot pairs, expected 18/);
});

test('d passes on a register failure, names it with its entry and reruns its file alone', async () => {
  const log = '✖ failing tests:\n\ntest at test/git-sync.test.mjs:10:1\n✖ a timed-out fetch kills its whole process group (780ms)\nℹ fail 1\n';
  const f = fakes({ suiteLog: log }); const r = await go(f);
  const d = r.rows.find((x) => x.id === 'd');
  assert.equal(d.ok, true); assert.match(d.number, /fail 1 \(1 flaky; 1\/1 solo green\)/);
  assert.ok(f.calls.some((c) => c.endsWith('tools/test.mjs test/git-sync.test.mjs')));
  const ev = JSON.parse(readFileSync(join(r.out, 'evidence/d-suite-split-flaky.json'), 'utf8'));
  assert.equal(ev[0].entry.alone, 'fails alone too'); assert.equal(ev[0].soloRerun, 'pass');
});

test('parityGaps: quick and package runs are not timing-gated; a full tree run must be', () => {
  assert.deepEqual(parityGaps(goodParity(false), { timing: false }), []);
  assert.deepEqual(parityGaps(goodParity(false), { timing: true }), ['timings not gated']);
});

test('main: a bad argument exits 2 and names --firefox-in-ci in the usage, a non-empty out dir exits 3', async () => {
  const lines = [];
  assert.equal(await main(['--nope'], { log: (l) => lines.push(l) }), 2);
  assert.match(lines.join('\n'), /usage: npm run split:verify \[-- --out DIR\] \[--keep\] \[--firefox-in-ci\]/);
  let got = null;
  assert.equal(await main(['--firefox-in-ci', '--out', out()], { log: () => {}, verify: async (o) => { got = o; return { pass: true }; } }), 0);
  assert.equal(got.firefoxInCi, true);
  const d = mkdtempSync(join(tmpdir(), 'split-verify-full-')); writeFileSync(join(d, 'x'), '');
  assert.equal(await main(['--out', d], { log: () => {} }), 3);
});

test('renderTable: one row per check, a pipe in a number is escaped', () => {
  const t = renderTable([{ id: 'a', check: 'fetch', ok: true, number: 'dev c82347c7c700 | x', evidence: 'evidence/a-fetch.log' }], {});
  assert.match(t, /^\| a\. fetch \| pass \| dev c82347c7c700 \\\| x \| evidence\/a-fetch\.log \|$/m);
});

test('extension/dist does not leak into parity: g and h remove the build they made, k drops the e2e build before its parity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'split-verify-root-')); const f = fakes(); const seen = {};
  const inner = f.deps.runLogged;
  f.deps.buildExtension = () => { put(join(root, 'extension/dist/chrome/manifest.json'), '{}'); return { code: 0 }; };
  f.deps.runLogged = (cmd, args, file, o) => {
    if (cmd === 'npm' && /^e2e:/.test(args[1] ?? '')) put(join(o.cwd, 'extension/dist/chrome-test/manifest.json'), '{}');
    if (args.includes('tools/parity.mjs')) seen[args[args.indexOf('--out') + 1].split('/').at(-1)] = existsSync(join(root, 'extension/dist')) || existsSync(join(args[args.indexOf('--b') + 1].slice(5), 'extension/dist'));
    return inner(cmd, args, file, o);
  };
  const r = await runVerify({ root, out: out(), keep: true, log: () => {}, deps: f.deps });
  assert.equal(seen['parity-package'], true, 'g packs with its own build');
  assert.equal(seen.crawl, true, 'h crawls the package with its own build');
  assert.equal(seen['parity-reverted'], false, 'k compares two trees with no extension build');
  assert.ok(!existsSync(join(root, 'extension/dist')), 'g leaves the checkout as it found it');
  assert.ok(r.rows.every((x) => x.ok));
});

test('g keeps an extension/dist that was there before the run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'split-verify-root-')); put(join(root, 'extension/dist/mine.txt'), 'x');
  await runVerify({ root, out: out(), log: () => {}, deps: fakes().deps });
  assert.ok(existsSync(join(root, 'extension/dist/mine.txt')));
});

test('h runs the split at full depth and the package at screen level, four workers by default', async () => {
  const f = fakes(); await go(f);
  const h = f.calls.find((c) => c.includes('tools/parity.mjs crawl'));
  assert.match(h, /--b tree:\S+trees\/split --b-screens package:\. --out /); assert.doesNotMatch(h, /--workers/);
});

test('crawlGaps: needs one full and one screen comparison, the stub, no real launch and no unexplained mask', () => {
  const c = goodCrawl();
  assert.deepEqual(crawlGaps(c), []);
  assert.match(crawlGaps({ ...c, comparisons: [c.comparisons[0], { ...c.comparisons[1], level: 'full' }] }).join(), /2 full, 0 screen/);
  assert.match(crawlGaps({ ...c, externalApps: undefined }).join(), /no app stub/);
  assert.match(crawlGaps({ ...c, externalApps: { stubbed: 1, canary: ['open -a Terminal'] } }).join(), /1 real app launch/);
  assert.match(crawlGaps({ ...c, masks: [{ id: 'x', field: 'dom', why: 'unexplained' }] }).join(), /1 unexplained mask/);
});

test('k is the empty diff, the suite and a quick parity: no e2e, no full parity, no crawl', async () => {
  const f = fakes(); const r = await go(f);
  const k = r.rows.find((x) => x.id === 'k');
  assert.equal(k.ok, true); assert.match(k.number, /^diff empty; suite fail 0; quick parity pass$/);
  const kParity = f.calls.filter((c) => c.includes('parity-reverted'));
  assert.equal(kParity.length, 1); assert.match(kParity[0], /--quick/);
});

test('--only reruns the named rows, carries the rest, and refuses another HEAD', async () => {
  const f = fakes(); const first = await go(f);
  const f2 = fakes(); f2.root = f.root;
  const r = await runVerify({ root: f.root, out: first.out, only: new Set(['e', 'h']), prev: JSON.parse(readFileSync(join(first.out, 'split-verify.json'), 'utf8')), log: () => {}, deps: f2.deps });
  assert.deepEqual(r.rows.filter((x) => !x.carried).map((x) => x.id), ['e', 'h']);
  assert.ok(!f2.calls.some((c) => c.includes('tools/test.mjs')), 'd and k are carried: no suite');
  assert.ok(existsSync(join(first.out, 'prev-1', 'crawl', 'report.json')), 'the old crawl is kept aside');
  assert.match(readFileSync(join(first.out, 'split-verify.md'), 'utf8'), /\| d\. suite-split \| pass \(earlier\) \|/);
  // row i is carried, so its notLocal entry is carried too (the go/no-go reads it)
  const f3 = fakes(); f3.root = f.root; const ci = await go(f3, { firefoxInCi: true });
  await runVerify({ root: f.root, out: ci.out, only: new Set(['e']), prev: JSON.parse(readFileSync(join(ci.out, 'split-verify.json'), 'utf8')), log: () => {}, deps: fakes().deps });
  assert.deepEqual(JSON.parse(readFileSync(join(ci.out, 'split-verify.json'), 'utf8')).notLocal.map((x) => x.row), ['i']);
  const lines = [];
  assert.equal(await main(['--out', first.out, '--only', 'e'], { log: (l) => lines.push(l), head: () => 'x'.repeat(40), isAncestor: () => false }), 3);
  assert.match(lines.join('\n'), /not an ancestor of HEAD/);
  assert.equal(await main(['--only', 'e'], { log: () => {} }), 2);
  assert.equal(await main(['--out', first.out, '--only', 'z'], { log: () => {}, head: () => HEAD, isAncestor: () => true }), 2);
});

test('two chained --only runs: each carried row keeps the head it ran on, and the tail lists the changes since that head', async () => {
  const at = (head) => { const f = fakes(); const inner = f.deps.run;
    f.deps.run = (cmd, args, o) => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, stdout: `${head}\n`, stderr: '' };
      if (args[0] === 'diff') return { code: 0, stdout: `${{ [`${'1'.repeat(40)} ${head}`]: 'tools/a.mjs\ntools/b.mjs\n', [`${'2'.repeat(40)} ${head}`]: 'tools/b.mjs\n' }[`${args[2]} ${args[3]}`] ?? ''}`, stderr: '' };
      return inner(cmd, args, o); };
    return f; };
  const [S1, S2, S3] = ['1', '2', '3'].map((c) => c.repeat(40));
  const f1 = at(S1); const first = await go(f1);
  const prev = () => JSON.parse(readFileSync(join(first.out, 'split-verify.json'), 'utf8'));
  const f2 = at(S2); await runVerify({ root: f1.root, out: first.out, only: new Set(['e']), prev: prev(), log: () => {}, deps: f2.deps });
  const f3 = at(S3); const r = await runVerify({ root: f1.root, out: first.out, only: new Set(['f']), prev: prev(), log: () => {}, deps: f3.deps });
  const by = Object.fromEntries(r.rows.map((x) => [x.id, x.ranOn]));
  assert.deepEqual([by.a, by.e, by.f], [S1, S2, S3]);
  const md = readFileSync(join(first.out, 'split-verify.md'), 'utf8');
  assert.match(md, new RegExp(`Carried rows ran on ${S1} \\(rows a, b, c, d, g, h, i, j, k, l\\); changed since: tools/a\\.mjs, tools/b\\.mjs`));
  assert.match(md, new RegExp(`Carried rows ran on ${S2} \\(rows e\\); changed since: tools/b\\.mjs`));
  assert.deepEqual(prev().rows.map((x) => x.ranOn), r.rows.map((x) => x.ranOn), 'split-verify.json keeps ranOn for the next rerun');
});

test('main: --only into an empty --out is a fresh partial run; a non-empty --out without split-verify.json stays exit 3', async () => {
  const seen = [];
  const verify = async (o) => { seen.push(o); return { pass: true }; };
  const empty = mkdtempSync(join(tmpdir(), 'split-verify-fresh-'));
  assert.equal(await main(['--only', 'i,j,k,l', '--firefox-in-ci', '--waive-crawl', 'Emil Angelov:row h waived', '--out', empty], { log: () => {}, verify }), 0);
  assert.equal(seen[0].fresh, true);
  assert.deepEqual([...seen[0].only], ['i', 'j', 'k', 'l']);
  assert.deepEqual(seen[0].waiveCrawl, { owner: 'Emil Angelov', reason: 'row h waived' });
  const busy = mkdtempSync(join(tmpdir(), 'split-verify-busy-')); writeFileSync(join(busy, 'split-verify.md'), '# t1');
  assert.equal(await main(['--only', 'i', '--out', busy], { log: () => {}, verify }), 3);
  assert.equal(await main(['--waive-crawl', 'no-colon'], { log: () => {}, verify }), 2);
});

test('fresh partial run with the crawl waived: a, i, j, k, l run; h is WAIVED and spawns nothing; b–g are not run; l gets --waive-crawl', async () => {
  const f = fakes(); const calls = f.calls;
  const out = mkdtempSync(join(tmpdir(), 'split-verify-fresh-'));
  const r = await runVerify({ root: mkdtempSync(join(tmpdir(), 'split-verify-root-')), out, only: new Set(['i', 'j', 'k', 'l']), fresh: true, firefoxInCi: true,
    waiveCrawl: { owner: 'Emil Angelov', reason: 'row h waived' }, log: () => {}, deps: f.deps });
  const by = (id) => r.rows.find((x) => x.id === id);
  assert.deepEqual(r.rows.map((x) => x.id), [...'abcdefghijkl']);
  for (const id of 'bcdefg') assert.equal(by(id).notRun, true, id);
  assert.equal(by('h').ok, true); assert.deepEqual(by('h').waived, { owner: 'Emil Angelov', reason: 'row h waived' });
  assert.match(by('h').number, /^WAIVED by Emil Angelov: row h waived \(no crawl spawned\)$/);
  assert.ok(!calls.some((c) => /parity\.mjs crawl/.test(c)), 'no crawl');
  const l = calls.find((c) => /readiness\.mjs run/.test(c));
  assert.match(l, /--waive-crawl Emil Angelov:row h waived/); assert.doesNotMatch(l, /--crawl-from/);
  const json = JSON.parse(readFileSync(join(out, 'split-verify.json'), 'utf8'));
  assert.equal(json.fresh, true); assert.deepEqual(json.rerun, ['a', 'i', 'j', 'k', 'l']);
  assert.equal(json.crawl, 'waived'); assert.equal(r.pass, true);
  assert.match(readFileSync(join(out, 'split-verify.md'), 'utf8'), /\| b\. gate \| not run \|/);
  assert.match(readFileSync(join(out, 'split-verify.md'), 'utf8'), /\| h\. crawl \| WAIVED \|/);
});

test('row h without a waiver passes --dev to the crawl; row l names a waived parity row', async () => {
  const f = fakes(); await go(f);
  assert.match(f.calls.find((c) => /parity\.mjs crawl/.test(c)), new RegExp(`--dev ${DEV}`));
  const g = fakes(); const rl = g.deps.runLogged;
  g.deps.runLogged = (cmd, args, file, o) => {
    const r = rl(cmd, args, file, o);
    if (args.includes('tools/readiness.mjs')) put(join(args[args.indexOf('--out') + 1], 'report.json'), JSON.stringify({ verdict: { value: 'go', failing: [] }, checks: [{ id: 'parity', status: 'waived', waived: { owner: 'Emil Angelov', reason: 'r' } }] }));
    return r;
  };
  const r = await go(g, { only: new Set(['l']), fresh: true, waiveCrawl: { owner: 'Emil Angelov', reason: 'r' } });
  assert.match(r.rows.find((x) => x.id === 'l').number, /^verdict go; parity ⚠ waived \(crawl WAIVED by Emil Angelov\)/);
});
