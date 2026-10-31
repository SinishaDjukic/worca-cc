// test/verify-919.test.mjs — tools/verify-919.mjs in-process with fakes: rows a–j, the table, the gaps and the exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runVerify, main, parityGaps, renderTable, ROWS } from '../tools/verify-919.mjs';
import { EXPECTED_SHOTS, FLOW_NAMES } from '../tools/parity/compare.mjs';

const HEAD = 'h'.repeat(40); const DEV = 'd'.repeat(40);
const goodParity = (timed) => ({ pass: true, routeDiffs: [], visualDiffs: [], failedFlows: [], signedOutProblems: [], problems: [],
  visual: Array.from({ length: EXPECTED_SHOTS }, () => ({ pixels: 0 })),
  flows: ['a', 'b'].flatMap((side) => FLOW_NAMES.map((name) => ({ name, side, ok: true }))),
  routeCounts: { a: { listed: 9, probed: 9, skipped: 0 }, b: { listed: 9, probed: 9, skipped: 0 } },
  timingGated: timed, timings: { boot: { a: 900, b: 905 }, pages: { 'chat-home': { a: 300, b: 301 }, runs: { a: 280, b: 282 } } } });
const REGISTER = [{ file: 'test/git-sync.test.mjs', test: 'a timed-out fetch kills its whole process group …', symptom: 's', alone: 'fails alone too' }];
const put = (f, s) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s); };

function fakes({ hashes = ['f'.repeat(40), 'f'.repeat(40)], skip = null, shots = EXPECTED_SHOTS, suiteLog = 'ℹ pass 1\nℹ fail 0\n', splitThrows = false } = {}) {
  const calls = []; let dry = 0;
  const run = (cmd, args) => { calls.push([cmd, ...args].join(' '));
    if (args[0] === 'rev-parse') return { code: 0, stdout: `${args[1] === 'HEAD' ? HEAD : DEV}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' }; };
  const runLogged = (cmd, args, file) => {
    const line = [cmd, ...args].join(' '); calls.push(line); let text = 'ok\n'; let code = 0;
    const at = (k) => args[args.indexOf(k) + 1];
    if (line.includes('--check --stats')) text = 'moved 430/441 route statements (98%), ui/server.mjs after the split: 9972 lines — spike gate passed (>= 95% moved, ceiling 9972 lines)\n';
    else if (line.includes('--dry-run')) put(at('--json'), JSON.stringify({ ok: true, treeHash: hashes[dry++] }));
    else if (line.includes('tools/test.mjs')) text = args.length > 1 ? 'ℹ fail 0\n' : suiteLog;
    else if (line.includes('tools/parity.mjs')) { const o = at('--out'); const timed = !args.includes('--quick') && !line.includes('package:');
      const rep = goodParity(timed); rep.visual = rep.visual.slice(0, shots); put(join(o, 'report.json'), JSON.stringify(rep)); put(join(o, 'report.md'), 'PASS\n'); }
    else if (cmd === 'npm' && /^e2e:/.test(args[1] ?? '')) text = args[1] === skip ? `${args[1]}: SKIP — no Firefox found\n` : 'passed\n';
    else if (line.includes('tools/readiness.mjs')) { const o = at('--out');
      put(join(o, 'report.json'), JSON.stringify({ verdict: { value: 'go', failing: [] } })); put(join(o, 'report.md'), '# go\n'); }
    put(file, text); return { code, text };
  };
  return { calls, deps: { run, runLogged, cloneAt: () => {}, npmCi: () => {}, buildExtension: () => ({ code: 0 }),
    applySplit: async () => { if (splitThrows) throw new Error('planSplit: boom'); return {}; },
    commitMigration: () => 'm'.repeat(40), rehearseRollback: () => ({ ok: true, reverted: 'r'.repeat(40), diff: '', status: '', cleaned: '' }),
    register: () => REGISTER, scripts: () => ({ 'e2e:extension': 'x', 'e2e:extension:update-linux': 'y', 'e2e:firefox-smoke': 'z' }) } };
}
const out = () => join(mkdtempSync(join(tmpdir(), 'v919-')), 'out');
const go = (f) => runVerify({ root: '/repo', out: out(), log: () => {}, deps: f.deps });

test('all green: rows a–j in order, one table, pass; readiness gets --dev-ref when HEAD is not origin/dev', async () => {
  const f = fakes(); const r = await go(f);
  assert.deepEqual(r.rows.map((x) => x.id), ROWS.map(([id]) => id));
  assert.ok(r.rows.every((x) => x.ok), JSON.stringify(r.rows.filter((x) => !x.ok)));
  assert.equal(r.pass, true);
  assert.ok(f.calls.some((c) => c.includes('tools/readiness.mjs run') && c.includes(`--dev-ref ${HEAD}`)));
  assert.ok(!f.calls.some((c) => / post\b/.test(c)), 'never posts');
  assert.equal(readFileSync(join(r.out, 'verify-919.md'), 'utf8').split('\n').filter((l) => /^\| [a-j]\. /.test(l)).length, 10);
});

test('a failing split tree fails d–i and the run still reaches j: it stops at nothing', async () => {
  const f = fakes({ splitThrows: true }); const r = await go(f);
  const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  for (const id of ['d', 'e', 'f', 'h', 'i']) assert.equal(byId[id].ok, false, id);    // g packs this checkout, not the split
  assert.equal(byId.g.ok, true); assert.equal(byId.j.ok, true); assert.equal(r.pass, false);
});

test('c fails when the two dry runs give different tree hashes', async () => {
  const r = await go(fakes({ hashes: ['1'.repeat(40), '2'.repeat(40)] }));
  assert.equal(r.rows.find((x) => x.id === 'c').ok, false);
});

test('h fails when an e2e suite prints SKIP (a missing browser is a fail)', async () => {
  const r = await go(fakes({ skip: 'e2e:firefox-smoke' }));
  const h = r.rows.find((x) => x.id === 'h');
  assert.equal(h.ok, false); assert.match(h.number, /skipped: e2e:firefox-smoke/);
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

test('main: a bad argument exits 2, a non-empty out dir exits 3', async () => {
  assert.equal(await main(['--nope'], { log: () => {} }), 2);
  const d = mkdtempSync(join(tmpdir(), 'v919-full-')); writeFileSync(join(d, 'x'), '');
  assert.equal(await main(['--out', d], { log: () => {} }), 3);
});

test('renderTable: one row per check, a pipe in a number is escaped', () => {
  const t = renderTable([{ id: 'a', check: 'fetch', ok: true, number: 'dev c82347c7c700 | x', evidence: 'evidence/a-fetch.log' }], {});
  assert.match(t, /^\| a\. fetch \| pass \| dev c82347c7c700 \\\| x \| evidence\/a-fetch\.log \|$/m);
});

test('extension/dist does not leak into parity: g removes the build it made, i drops the e2e build before its parity', async () => {
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
  assert.equal(seen['parity-reverted'], false, 'i compares two trees with no extension build');
  assert.ok(!existsSync(join(root, 'extension/dist')), 'g leaves the checkout as it found it');
  assert.ok(r.rows.every((x) => x.ok));
});

test('g keeps an extension/dist that was there before the run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'v919-root-')); put(join(root, 'extension/dist/mine.txt'), 'x');
  await runVerify({ root, out: out(), log: () => {}, deps: fakes().deps });
  assert.ok(existsSync(join(root, 'extension/dist/mine.txt')));
});
