// test/split-go-no-go.test.mjs — the #919 go/no-go: every gate from its inputs; a missing input fails its gate; GO only when all pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gates, renderGoNoGo, parseVerifyMd, parseWaivers, applyWaivers, FROZEN_DEV, T3_COVERS } from '../tools/split-go-no-go.mjs';

const rowsAtoL = 'abcdefghijkl'.split('').map((id) => ({ id, check: id, ok: true, number: id === 'b' ? '100% moved, 10119 lines' : 'n', evidence: `evidence/${id}.log` }));
const crawl = { pass: true, externalApps: { stubbed: 9, canary: [] }, masks: [{ id: 'x', field: 'png', why: 'raster noise, DOM identical' }],
  coverage: { screens: 3000, routes: { registered: 138, visited: 138, unvisited: [], unfillable: [] }, elements: { found: 51000, exercised: 9000, skipped: 42000, byReason: { 'duplicate of …': 40000, disabled: 2000 } } } };
const inputs = (o = {}) => ({
  verify: { pass: true, dev: FROZEN_DEV, notLocal: [{ row: 'i', name: 'e2e:firefox-smoke', ci: 'firefox-e2e' }], rows: rowsAtoL },
  crawl, crawlLog: 'crawl: side a1 done\n', stubSmoke: { externalApps: { stubbed: 2, canary: [] } },
  readiness: { verdict: { value: 'go' }, checks: ['gh-auth', 'split-check', 'dry-run-repeatable', 'equivalence', 'docs-and-package', 'suite-migrated', 'parity', 'open-prs', 'rollback', 'baseline']
    .map((id) => ({ id, status: 'pass', detail: id === 'parity' ? 'PASS; crawl PASS (split:verify row h, same trees)' : 'ok' })) },
  t2: { pass: true, flows: ['pages', 'chat', 'run', 'history', 'setting', 'labs'].map((id) => ({ id, ok: true, detail: 'same structure and status; 0 new console errors', evidence: 't2/report.md' })) },
  tests: { stub: 0, firefoxWorkflow: 0, visualMasksDoc: 0 },
  raises: [{ to: 10085, commit: 'c82347c7c' }, { to: 10118, commit: 'b76706df6' }, { to: 10119, commit: '405db5a4d' }], ceiling: 10119,
  isAncestor: () => true, ...o });

test('all inputs green: GO, with one row per gate the request names', () => {
  const rows = gates(inputs());
  assert.ok(rows.every((r) => r.ok), JSON.stringify(rows.filter((r) => !r.ok)));
  for (const g of ['stub', 'verify-a', 'verify-l', 'crawl-coverage', 'masks', 't2-pages', 't2-labs', 'readiness-gh-auth', 'readiness-baseline', 'readiness-reuse', 'firefox-e2e-on-ship', 'size-cap'])
    assert.ok(rows.some((r) => r.gate === g), g);
  assert.match(renderGoNoGo(rows).md.split('\n')[0], /^# GO — all \d+ gates pass$/);
});

test('unclear is fail: every missing input fails its own gate and the verdict', () => {
  for (const k of ['verify', 'crawl', 'readiness', 't2', 'stubSmoke']) {
    const rows = gates(inputs({ [k]: null }));
    assert.ok(rows.some((r) => !r.ok && /missing/.test(r.number)), k);
    assert.match(renderGoNoGo(rows).md, /^# NO-GO — \d+ of \d+ gates fail: /);
  }
});

test('stub: a real launch, no stubbed launch, an EMFILE line or a failing stub test fails it', () => {
  const g = (o) => gates(inputs(o)).find((r) => r.gate === 'stub');
  assert.equal(g({}).ok, true); assert.match(g({}).number, /9 stubbed in the crawl, 2 in the smoke, 0 real; 0 EMFILE\/ENFILE\/pty lines/);
  assert.equal(g({ crawl: { ...crawl, externalApps: { stubbed: 9, canary: ['open -a Terminal'] } } }).ok, false);
  assert.equal(g({ stubSmoke: { externalApps: { stubbed: 0, canary: [] } } }).ok, false);
  assert.equal(g({ crawlLog: 'Error: spawn EMFILE\n' }).ok, false);
  assert.equal(g({ tests: { stub: 1, firefoxWorkflow: 0, visualMasksDoc: 0 } }).ok, false);
  // a crawl report without externalApps (crawled without the stub) is a failing row, never a TypeError
  assert.match(g({ crawl: { ...crawl, externalApps: undefined } }).number, /^missing: externalApps/);
  const noMasks = gates(inputs({ crawl: { ...crawl, masks: undefined } }));
  assert.equal(noMasks.find((r) => r.gate === 'masks').ok, false);
});

test('masks: an unexplained mask or an undocumented visual mask fails; the number lists the reasons', () => {
  const g = (o) => gates(inputs(o)).find((r) => r.gate === 'masks');
  assert.match(g({}).number, /1 crawl masks \(raster noise, DOM identical: 1\); 0 unexplained; visual masks documented/);
  assert.equal(g({ crawl: { ...crawl, masks: [{ id: 'x', field: 'dom', why: 'unexplained' }] } }).ok, false);
  assert.equal(g({ tests: { stub: 0, firefoxWorkflow: 0, visualMasksDoc: 1 } }).ok, false);
});

test('size cap: over 10085 needs every raise above it on bf92e1579 and the last raise equal to the ceiling', () => {
  const g = (o) => gates(inputs(o)).find((r) => r.gate === 'size-cap');
  assert.equal(g({}).ok, true); assert.match(g({}).number, /10119 lines, ceiling 10119; raised by b76706df6, 405db5a4d \(on bf92e1579\); owner sign-off: checklist A3/);
  assert.equal(g({ isAncestor: (c) => c !== '405db5a4d' }).ok, false);
  assert.equal(g({ ceiling: 10200 }).ok, false);
  assert.equal(g({ raises: [{ to: 10119 }] }).ok, false);
});

test('readiness reuse: a second crawl (no "same trees") fails; firefox-e2e on Ship needs the workflow test and the CI listing', () => {
  const r = inputs(); r.readiness.checks.find((c) => c.id === 'parity').detail = 'PASS; crawl PASS';
  assert.equal(gates(r).find((x) => x.gate === 'readiness-reuse').ok, false);
  r.readiness.checks.find((c) => c.id === 'parity').detail = 'PASS; crawl PASS (split:verify row h, reuse rule)';
  const rule = gates(r).find((x) => x.gate === 'readiness-reuse');
  assert.equal(rule.ok, true); assert.match(rule.number, /\(reuse rule; no second crawl\)/);
  const nobody = inputs(); Object.assign(nobody.readiness.checks.find((c) => c.id === 'parity'), { status: 'waived' });
  assert.equal(gates(nobody).find((x) => x.gate === 'readiness-reuse').ok, false, 'a waived parity row without an owner is a failing gate, never a crash');
  assert.equal(gates(inputs({ tests: { stub: 0, firefoxWorkflow: 1, visualMasksDoc: 0 } })).find((x) => x.gate === 'firefox-e2e-on-ship').ok, false);
});

test('a verify run without every row a–l, or malformed reports, fail a gate instead of passing or throwing', () => {
  const v = inputs().verify;
  const noL = gates(inputs({ verify: { ...v, rows: v.rows.filter((r) => r.id !== 'l') } })).find((r) => r.gate === 'verify-rows');
  assert.equal(noL.ok, false); assert.match(noL.number, /^11 of 12 rows accounted/);
  const l = gates(inputs({ verify: { ...v, rows: v.rows.filter((r) => r.id !== 'l') } })).find((r) => r.gate === 'verify-l');
  assert.equal(l.ok, false); assert.equal(l.number, 'missing: row l');
  assert.equal(gates(inputs()).find((r) => r.gate === 'verify-rows').ok, true);
  const bad = gates(inputs({ readiness: { verdict: { value: 'go' } }, crawl: { ...crawl, coverage: { screens: 1, routes: {}, elements: { found: 1, exercised: 1, skipped: 0 } } } }));
  assert.match(bad.find((r) => r.gate === 'readiness').number, /^missing: checks/);
  assert.match(bad.find((r) => r.gate === 'crawl-coverage').number, /^missing: /);
});

const PARTIAL = `# split:verify · origin/dev ${FROZEN_DEV} · HEAD 3d00119794b4919dcc0caf704d67ab09f14c66cd

| Check | Result | Number | Evidence |
|---|---|---|---|
| a. fetch | pass | origin/dev bf92e1579378 | evidence/a-fetch.log |
| b. gate | pass | 100% moved, 10119 lines | evidence/b-gate.log |
| d. suite-split | FAIL | fail 17 (9 flaky); 8 NOT in the register: test/x.test.mjs | evidence/d-suite-split.log |
`;

test('a partial verify table (T1): its rows are carried under the reuse rule, T3 covers b, c and d, row b feeds the size cap', () => {
  const partial = parseVerifyMd(PARTIAL);
  assert.equal(partial.dev, FROZEN_DEV);
  assert.deepEqual(partial.rows.map((r) => [r.id, r.ok]), [['a', true], ['b', true], ['d', false]]);
  const rows = gates(inputs({ verify: null, verifyEarlier: partial, reuse: { valid: true, dev: FROZEN_DEV, reasons: [], trees: [{ label: 'unsplit' }] } }));
  const g = (id) => rows.find((r) => r.gate === id);
  assert.equal(g('verify-a').ok, true); assert.match(g('verify-a').number, /carried from T1 under the reuse rule\)$/);
  assert.match(g('verify-d').number, /covered by readiness-suite-migrated/);     // T3 stands in for b, c, d
  for (const id of 'efghijkl') assert.match(g(`verify-${id}`).number, new RegExp(`^missing: row ${id}$`));
  assert.match(g('verify-rows').number, /^4 of 12 rows accounted: this round —; T3 b, c, d; replaced —; T1 a/);
  assert.equal(g('size-cap').ok, true); assert.match(g('size-cap').number, /^10119 lines, ceiling 10119/);   // row b from T1
  assert.equal(g('reuse-rule').ok, true);
  assert.ok(!rows.some((r) => r.gate === 'verify-dev'));
  assert.deepEqual(parseVerifyMd('no table'), { dev: null, rows: [] });
});

const W = { owner: 'Emil Angelov', reason: 'byte-identical CSS/HTML, JS untouched, identical ordered route table, rows e/f 0/0/0, row g pass, T2 6/6 0 console errors, ~45 h cost' };
const t1md = '# split:verify · origin/dev ' + FROZEN_DEV + ' · HEAD x\n\n| Check | Result | Number | Evidence |\n|---|---|---|---|\n'
  + 'abcdefghi'.split('').map((id) => `| ${id}. ${id} | ${'dfh'.includes(id) ? 'FAIL' : 'pass'} | ${id === 'b' ? '100% moved, 10119 lines' : 'n'} | evidence/${id}.log |`).join('\n') + '\n';
// this round's fresh partial split-verify.json (Step 3): a, h (waived), i, j, k, l ran; b–g not run
const fresh = (o = {}) => ({ fresh: true, pass: true, dev: FROZEN_DEV, notLocal: [{ row: 'i', name: 'e2e:firefox-smoke', ci: 'firefox-e2e' }],
  rows: 'abcdefghijkl'.split('').map((id) => ('bcdefg'.includes(id) ? { id, check: id, ok: false, notRun: true, number: 'not run (--only a,i,j,k,l)', evidence: '—' }
    : id === 'h' ? { id, check: 'crawl', ok: true, waived: W, number: `WAIVED by ${W.owner}: ${W.reason} (no crawl spawned)`, evidence: 'evidence/h-crawl-waived.txt' }
      : { id, check: id, ok: true, number: 'n', evidence: `evidence/${id}.log`, ...o[id] })) });

test('--waive parses GATE=OWNER:REASON; a malformed or unknown waiver is a usage error', () => {
  assert.deepEqual(parseWaivers(['--waive', 'verify-h=Emil Angelov:why: with a colon']), { 'verify-h': { owner: 'Emil Angelov', reason: 'why: with a colon' } });
  assert.throws(() => parseWaivers(['--waive', 'verify-h']), /--waive needs GATE=OWNER:REASON/);
  assert.throws(() => applyWaivers(gates(inputs()), { 'no-such-gate': W }), /--waive: no gate no-such-gate/);
});

test('a waived failing gate is WAIVED, not a fail; the verdict says GO with a "Waived gates" line; a passing gate is not waived', () => {
  const rows = applyWaivers(gates(inputs({ crawl: null })), { 'crawl-coverage': W, masks: W, 'verify-a': W });
  const cov = rows.find((x) => x.gate === 'crawl-coverage');
  assert.equal(cov.status, 'waived'); assert.equal(cov.ok, true);
  assert.match(cov.number, /^WAIVED by Emil Angelov: byte-identical .* \(was: not produced: crawl report \(coverage\)\)$/);
  assert.equal(rows.find((x) => x.gate === 'verify-a').status, 'pass');
  const stub = rows.find((x) => x.gate === 'stub');   // no crawl and no h waiver: the stub gate still fails
  const { verdict, md, json } = renderGoNoGo(rows.filter((x) => x !== stub));
  assert.match(verdict, /^GO — \d+ of \d+ gates pass, 2 waived$/);
  assert.match(md, /^Waived gates: crawl-coverage \(Emil Angelov: byte-identical/m);
  assert.match(md, /\| crawl-coverage \| WAIVED \|/);
  assert.ok(!/missing:/.test(md));
  assert.deepEqual(json.waived.map((x) => x.gate), ['crawl-coverage', 'masks']);
});

test('readiness parity waived → readiness-parity and readiness-reuse are WAIVED under the verify-h waiver', () => {
  const r = inputs();
  Object.assign(r.readiness.checks.find((c) => c.id === 'parity'), { status: 'waived', waived: { owner: 'Emil Angelov', reason: 'crawl waived' }, detail: 'PASS: …; crawl WAIVED by Emil Angelov: crawl waived' });
  const rows = gates(r, { 'verify-h': W });
  assert.equal(rows.find((x) => x.gate === 'readiness-parity').status, 'waived');
  const reuse = rows.find((x) => x.gate === 'readiness-reuse');
  assert.equal(reuse.status, 'waived'); assert.deepEqual(reuse.waived, W);
  assert.match(reuse.number, /no crawl ran \(crawl waived\); row h waiver/);
});

test('round 6 accounting: fresh a, h, i, j, k, l; T3 covers b, c, d; --row replaces e and f; T1 carries g; none reads missing', () => {
  const rows = applyWaivers(gates(inputs({ verify: fresh(), verifyEarlier: parseVerifyMd(t1md), reuse: { valid: true, dev: FROZEN_DEV, reasons: [], trees: [{ label: 'unsplit' }] },
    rowOverrides: { e: { ok: true, number: '0 route, 0 visual, 0 flow diffs', evidence: 'e-row/report.md', from: 'parity-quick' },
      f: { ok: true, number: '0 route, 0 visual, 0 flow diffs', evidence: 'f-row/report.md', from: 'f-rerun' } } }), { 'verify-h': W }), { 'verify-h': W });
  const by = (g) => rows.find((x) => x.gate === g);
  for (const id of 'ijkl') { assert.equal(by(`verify-${id}`).status, 'pass', id); assert.match(by(`verify-${id}`).number, /\(this round\)$/); }
  assert.equal(by('verify-d').status, 'pass'); assert.match(by('verify-d').number, /covered by readiness-suite-migrated \(T3, renamed split\)/);
  assert.match(by('verify-f').number, /\(f-rerun\)$/);
  assert.equal(by('verify-g').status, 'pass'); assert.match(by('verify-g').number, /carried from T1 under the reuse rule/);
  assert.equal(by('verify-h').status, 'waived');
  assert.equal(by('verify-rows').status, 'pass'); assert.match(by('verify-rows').number, /^12 of 12 rows accounted/);
  assert.equal(by('reuse-rule').status, 'pass');
  assert.equal(by('firefox-e2e-on-ship').status, 'pass');
  assert.equal(by('size-cap').status, 'pass');
  assert.ok(!rows.some((x) => /^missing:/.test(x.number)));
  assert.deepEqual(Object.keys(T3_COVERS), ['b', 'c', 'd']);
});

test('a row the fresh run failed stays FAIL; carried T1 rows fail without a valid reuse rule', () => {
  const rows = gates(inputs({ verify: fresh({ j: { ok: false, number: 'fixture needs a hand fix' } }), verifyEarlier: parseVerifyMd(t1md), reuse: null }));
  const by = (g) => rows.find((x) => x.gate === g);
  assert.equal(by('verify-j').ok, false);
  assert.equal(by('verify-g').ok, false); assert.match(by('verify-g').number, /reuse rule not shown/);
  assert.equal(by('reuse-rule').ok, false);
});

test('row h waived: crawl-coverage never reads a partial crawl as coverage; masks read --masks-crawl', () => {
  const chat = { ...inputs().crawl, coverage: { screens: 80, routes: { registered: 4, visited: 4, unvisited: [], unfillable: [] }, elements: { found: 632, exercised: 632 } } };
  const rows = applyWaivers(gates(inputs({ verify: fresh(), crawl: null, masksCrawl: chat }), { 'verify-h': W }), { 'verify-h': W, 'crawl-coverage': W });
  const cov = rows.find((x) => x.gate === 'crawl-coverage');
  assert.equal(cov.status, 'waived');
  assert.match(cov.number, /\(was: not produced: full crawl report \(row h waived\)\)$/);
  assert.doesNotMatch(cov.number, /routes 4\/4/);
  assert.match(rows.find((x) => x.gate === 'masks').evidence, /^masks-crawl\//);
});

test('stub with row h waived: judged on the smoke and the test alone, the crawl part names the waiver', () => {
  const rows = gates(inputs({ crawl: null, crawlLog: null }), { 'verify-h': W });
  const stub = rows.find((x) => x.gate === 'stub');
  assert.equal(stub.ok, true); assert.match(stub.number, /crawl part: row h waived/);
});

test('main: a bad --waive, --row or unknown waived gate is exit 2; --row and --masks-crawl are copied under OUT and labels name real folders', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const { main } = await import('../tools/split-go-no-go.mjs');
  const { EXPECTED_SHOTS, FLOW_NAMES } = await import('../tools/parity/compare.mjs');
  const P = mkdtempSync(join(tmpdir(), 'gng-')); const put = (f, s) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof s === 'string' ? s : JSON.stringify(s)); };
  put(join(P, 'verify/split-verify.json'), { ...fresh(), crawl: 'waived' }); put(join(P, 'verify/crawl/report.json'), inputs().crawl);   // a stale crawl: never read
  put(join(P, 'verify/readiness/report.json'), inputs().readiness); put(join(P, 't2/report.json'), inputs().t2);
  put(join(P, 'smoke.json'), inputs().stubSmoke); put(join(P, 'chat/report.json'), inputs().crawl); put(join(P, 'chat/report.md'), '# chat\n');
  put(join(P, 'quick/report.json'), { pass: true, routeDiffs: [], visualDiffs: [], failedFlows: [], visual: Array.from({ length: EXPECTED_SHOTS }, () => ({})),
    flows: ['a', 'b'].flatMap((side) => FLOW_NAMES.map((name) => ({ name, side }))), routeCounts: { a: { probed: 1 }, b: { probed: 1 } } });
  const run = () => ({ code: 0, stdout: '', stderr: '' }); const lines = []; const log = (l) => lines.push(l);
  const base = ['--verify', join(P, 'verify'), '--readiness', join(P, 'verify/readiness'), '--t2', join(P, 't2'), '--stub-smoke', join(P, 'smoke.json'), '--out', join(P, 'go')];
  assert.equal(await main([...base, '--waive', 'verify-h'], { log, run }), 2);
  assert.equal(await main([...base, '--row', `h=${join(P, 'quick')}`], { log, run }), 2);
  assert.equal(await main([...base, '--waive', 'no-gate=E:r'], { log, run }), 2);
  await main([...base, '--masks-crawl', join(P, 'chat'), '--row', `e=${join(P, 'quick')}`, '--waive', `verify-h=${W.owner}:${W.reason}`], { log, run });
  const json = JSON.parse(readFileSync(join(P, 'go/split-go-no-go.json'), 'utf8'));
  assert.deepEqual(readdirSync(join(P, 'go')).filter((n) => /(^|[-_.])\d{3,}([-_.]|$)/.test(n)), [], 'run-artifact names carry no issue number');
  const g = (id) => json.gates.find((x) => x.gate === id);
  assert.match(g('verify-e').number, /^e: 0 route, 0 visual, 0 flow diffs \(quick\)$/); assert.equal(g('verify-e').evidence, 'e-row/report.md');
  assert.ok(existsSync(join(P, 'go/e-row/report.json')) && existsSync(join(P, 'go/masks-crawl/report.md')));
  assert.match(g('crawl-coverage').number, /^missing: full crawl report \(row h waived\)$/);
  assert.equal(g('verify-a').evidence, 'verify/evidence/a.log'); assert.equal(g('readiness-gh-auth').evidence, 'verify/readiness/report.md');
});

test('--renamed: a byte-identical rename keeps rows i–l valid and says so; a rename that changed served output fails them', () => {
  const same = { valid: true, dev: FROZEN_DEV, reasons: [], trees: [{ label: 'unsplit' }, { label: 'cycle-1-split' }, { label: 'renamed-split' }] };
  const rows = gates(inputs({ renamed: same }));
  const g = (id) => rows.find((x) => x.gate === id);
  assert.equal(g('rename').ok, true);
  assert.match(g('rename').number, /served CSS, index\.html and route table identical on unsplit, cycle-1-split, renamed-split/);
  for (const id of ['i', 'j', 'k', 'l']) {
    assert.equal(g(`verify-${id}`).ok, true, id);
    assert.match(g(`verify-${id}`).number, /; stays valid after the rename: behaviour byte-identical \(gate rename\)$/, id);
  }
  assert.doesNotMatch(g('verify-a').number, /stays valid/);
  const moved = gates(inputs({ renamed: { ...same, valid: false, reasons: ['served CSS differs on renamed-split'] } }));
  assert.equal(moved.find((x) => x.gate === 'rename').ok, false);
  assert.match(moved.find((x) => x.gate === 'rename').number, /served CSS differs/);
  for (const id of ['i', 'j', 'k', 'l']) assert.equal(moved.find((x) => x.gate === `verify-${id}`).ok, false, id);
  assert.equal(gates(inputs()).some((x) => x.gate === 'rename'), false, 'no --renamed: no gate');
});
