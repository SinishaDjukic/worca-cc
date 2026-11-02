// test/verify-919.test.mjs — tools/verify-919.mjs in-process with fakes: rows a–l, the table, the gaps and the exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runVerify, main, parityGaps, renderTable, crawlGaps, ROWS } from '../tools/verify-919.mjs';
import { EXPECTED_SHOTS, FLOW_NAMES } from '../tools/parity/compare.mjs';

const HEAD = 'h'.repeat(40); const DEV = 'd'.repeat(40);
const goodParity = (timed) => ({ pass: true, routeDiffs: [], visualDiffs: [], failedFlows: [], signedOutProblems: [], problems: [],
  visual: Array.from({ length: EXPECTED_SHOTS }, () => ({ pixels: 0 })),
  flows: ['a', 'b'].flatMap((side) => FLOW_NAMES.map((name) => ({ name, side, ok: true }))),
  routeCounts: { a: { listed: 9, probed: 9, skipped: 0 }, b: { listed: 9, probed: 9, skipped: 0 } },
  timingGated: timed, timings: { boot: { a: 900, b: 905 }, pages: { 'chat-home': { a: 300, b: 301 }, runs: { a: 280, b: 282 } } } });
const goodCrawl = () => ({ pass: true, control: true, a: { spec: 'tree:.', tree: 't'.repeat(40) }, bs: [{ spec: 'tree:split', tree: 's'.repeat(40) }, { spec: 'package:.', tree: null }],
  masks: [{ id: 'x', field: 'dom', path: '0.1' }], minutes: 60,
  comparisons: [{ label: 'split', pass: true, diffs: [] }, { label: 'package', pass: true, diffs: [] }],
  coverage: { screens: 120, routes: { registered: 90, visited: 90, unvisited: [], unfillable: [] }, elements: { found: 4000, exercised: 1500, skipped: 2500, byReason: {} } } });
const pwReport = (st) => ({ suites: [{ title: 'visual.spec.mjs', specs: [{ title: 'sidebar light', tests: [{ projectName: '', status: st }] }] }] });
const PW_SCRIPT = 'node tools/build-extension.mjs --test --browser chrome && playwright test -c e2e/extension/playwright.config.mjs';
const works = (key, extra = {}) => ({ key, verdict: 'works', reasons: [], moved: [{ from: 'ui/server.mjs', to: ['ui/routes/settings.mjs'] }], tests: { ran: true }, ...extra });
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
const out = () => join(mkdtempSync(join(tmpdir(), 'v919-')), 'out');
// a real root: g and h build extension/dist into it, and h copies that build into the split tree
const go = (f, extra = {}) => {
  f.root = mkdtempSync(join(tmpdir(), 'v919-root-'));
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
  assert.equal(readFileSync(join(r.out, 'verify-919.md'), 'utf8').split('\n').filter((l) => /^\| [a-l]\. /.test(l)).length, 12);
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
  assert.equal(f.calls.filter((c) => c.startsWith('npm run e2e:extension')).length, 3, 'before once (rows i and k share it), after in i and in k');
  const bad = (await go(fakes({ e2eAfter: 'expected' }))).rows.find((x) => x.id === 'i');
  assert.equal(bad.ok, false); assert.match(bad.number, /NOT same before\/after .*sidebar light: unexpected before, expected after/);
});

test('--firefox-in-ci: the Firefox suite never runs; i and k pass and say so; the table tail, json and log line name CI', async () => {
  const f = fakes(); const lines = [];
  const r = await go(f, { log: (l) => lines.push(l), firefoxInCi: true });
  assert.ok(!f.calls.some((c) => c.includes('npm run e2e:firefox-smoke')), 'never run in any tree');
  for (const id of ['i', 'k']) {
    const x = r.rows.find((y) => y.id === id);
    assert.equal(x.ok, true, id); assert.match(x.number, /e2e:firefox-smoke: CI job firefox-e2e, not run locally/, id);
  }
  assert.ok(readFileSync(join(r.out, 'verify-919.md'), 'utf8').trimEnd().endsWith(
    'Not run locally (not a pass): e2e:firefox-smoke in rows i (was h) and k (was i) → CI job firefox-e2e (.github/workflows/firefox-e2e.yml)'));
  assert.deepEqual(JSON.parse(readFileSync(join(r.out, 'verify-919.json'), 'utf8')).notLocal,
    [{ row: 'i', name: 'e2e:firefox-smoke', ci: 'firefox-e2e' }, { row: 'k', name: 'e2e:firefox-smoke', ci: 'firefox-e2e' }]);
  assert.ok(f.calls.find((c) => c.includes('tools/readiness.mjs run')).includes('--firefox-in-ci'));
  assert.match(lines.at(-1), /verify:919 PASS, except 1 suite left to CI \(firefox-e2e\) \(/);
});

test('h: a crawl diff, no control pass or an unvisited route fails it; a clean crawl names both comparisons and the coverage', async () => {
  const h = (await go(fakes())).rows.find((x) => x.id === 'h');
  assert.equal(h.ok, true); assert.match(h.number, /120 screens, 90\/90 routes, .*split 0 diffs, package 0 diffs/);
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
  assert.match(j.number, /^fixture works: ui\/server\.mjs → ui\/routes\/settings\.mjs; open PRs: 1 work, 1 need a hand fix$/);
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
  assert.match(lines.join('\n'), /usage: npm run verify:919 \[-- --out DIR\] \[--keep\] \[--firefox-in-ci\]/);
  let got = null;
  assert.equal(await main(['--firefox-in-ci', '--out', out()], { log: () => {}, verify: async (o) => { got = o; return { pass: true }; } }), 0);
  assert.equal(got.firefoxInCi, true);
  const d = mkdtempSync(join(tmpdir(), 'v919-full-')); writeFileSync(join(d, 'x'), '');
  assert.equal(await main(['--out', d], { log: () => {} }), 3);
});

test('renderTable: one row per check, a pipe in a number is escaped', () => {
  const t = renderTable([{ id: 'a', check: 'fetch', ok: true, number: 'dev c82347c7c700 | x', evidence: 'evidence/a-fetch.log' }], {});
  assert.match(t, /^\| a\. fetch \| pass \| dev c82347c7c700 \\\| x \| evidence\/a-fetch\.log \|$/m);
});

test('extension/dist does not leak into parity: g and h remove the build they made, k drops the e2e build before its parity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'v919-root-')); const f = fakes(); const seen = {};
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
  const root = mkdtempSync(join(tmpdir(), 'v919-root-')); put(join(root, 'extension/dist/mine.txt'), 'x');
  await runVerify({ root, out: out(), log: () => {}, deps: fakes().deps });
  assert.ok(existsSync(join(root, 'extension/dist/mine.txt')));
});
