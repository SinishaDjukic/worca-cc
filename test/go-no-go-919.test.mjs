// test/go-no-go-919.test.mjs — the #919 go/no-go: every gate from its inputs; a missing input fails its gate; GO only when all pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gates, renderGoNoGo, parseVerifyMd, FROZEN_DEV } from '../tools/go-no-go-919.mjs';

const rowsAtoL = 'abcdefghijkl'.split('').map((id) => ({ id, check: id, ok: true, number: id === 'b' ? '100% moved, 10119 lines' : 'n', evidence: `evidence/${id}.log` }));
const crawl = { pass: true, externalApps: { stubbed: 9, canary: [] }, masks: [{ id: 'x', field: 'png', why: 'raster noise, DOM identical' }],
  coverage: { screens: 3000, routes: { registered: 138, visited: 138, unvisited: [], unfillable: [] }, elements: { found: 51000, exercised: 9000, skipped: 42000, byReason: { 'duplicate of …': 40000, disabled: 2000 } } } };
const inputs = (o = {}) => ({
  verify: { pass: true, dev: FROZEN_DEV, notLocal: [{ row: 'i', name: 'e2e:firefox-smoke', ci: 'firefox-e2e' }], rows: rowsAtoL },
  crawl, crawlLog: 'crawl: side a1 done\n', stubSmoke: { externalApps: { stubbed: 2, canary: [] } },
  readiness: { verdict: { value: 'go' }, checks: ['gh-auth', 'split-check', 'dry-run-repeatable', 'equivalence', 'docs-and-package', 'suite-migrated', 'parity', 'open-prs', 'rollback', 'baseline']
    .map((id) => ({ id, status: 'pass', detail: id === 'parity' ? 'PASS; crawl PASS (verify:919 row h, same trees)' : 'ok' })) },
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
  const since = gates(inputs({ sinceCrawl: ['tools/verify-919.mjs'] })).find((x) => x.gate === 'readiness-reuse');
  assert.equal(since.ok, true); assert.match(since.number, /1 file\(s\) changed since/);
  assert.equal(gates(inputs({ tests: { stub: 0, firefoxWorkflow: 1, visualMasksDoc: 0 } })).find((x) => x.gate === 'firefox-e2e-on-ship').ok, false);
});

test('a verify run without every row a–l, or malformed reports, fail a gate instead of passing or throwing', () => {
  const v = inputs().verify;
  const noL = gates(inputs({ verify: { ...v, rows: v.rows.filter((r) => r.id !== 'l') } })).find((r) => r.gate === 'verify-rows');
  assert.equal(noL.ok, false); assert.match(noL.number, /missing rows: l/);
  assert.equal(gates(inputs()).find((r) => r.gate === 'verify-rows').ok, true);
  const bad = gates(inputs({ readiness: { verdict: { value: 'go' } }, crawl: { ...crawl, coverage: { screens: 1, routes: {}, elements: { found: 1, exercised: 1, skipped: 0 } } } }));
  assert.match(bad.find((r) => r.gate === 'readiness').number, /^missing: checks/);
  assert.match(bad.find((r) => r.gate === 'crawl-coverage').number, /^missing: /);
});

const PARTIAL = `# verify:919 · origin/dev ${FROZEN_DEV} · HEAD 3d00119794b4919dcc0caf704d67ab09f14c66cd

| Check | Result | Number | Evidence |
|---|---|---|---|
| a. fetch | pass | origin/dev bf92e1579378 | evidence/a-fetch.log |
| b. gate | pass | 100% moved, 10119 lines | evidence/b-gate.log |
| d. suite-split | FAIL | fail 17 (9 flaky); 8 NOT in the register: test/x.test.mjs | evidence/d-suite-split.log |
`;

test('a pending reason goes into the evidence of every missing gate, and only those', () => {
  const rows = gates(inputs({ verify: null, crawl: null, readiness: null, pending: 'T1 running (row h ≈ 45 h)' }));
  const missing = rows.filter((r) => /^missing: /.test(r.number));
  assert.ok(missing.length >= 5, JSON.stringify(rows));
  for (const r of missing) assert.match(r.evidence, /pending: T1 running \(row h ≈ 45 h\)$/, r.gate);
  assert.ok(!rows.some((r) => !/missing/.test(r.number) && /pending:/.test(r.evidence)));
  assert.equal(gates(inputs({ verify: null })).find((r) => r.gate === 'verify').evidence, '—');
  // firefox-e2e-on-ship reads its CI listing from verify-919.json, so without it the gate says so and carries the reason
  const ff = rows.find((r) => r.gate === 'firefox-e2e-on-ship');
  assert.equal(ff.ok, false); assert.match(ff.number, /verify lists it as CI: missing verify-919\.json$/);
  assert.match(ff.evidence, /^\.github\/workflows\/firefox-e2e\.yml; pending: T1 running/);
});

test('a partial verify table: its rows count as gates, row b feeds the size cap, notes join a row, and the run is still missing', () => {
  const partial = parseVerifyMd(PARTIAL);
  assert.equal(partial.dev, FROZEN_DEV);
  assert.deepEqual(partial.rows.map((r) => [r.id, r.ok]), [['a', true], ['b', true], ['d', false]]);
  const rows = gates(inputs({ verify: null, verifyPartial: partial, pending: 'T1 running', notes: { d: 'classified: run-root load flakes, 46/46 alone' } }));
  const g = (id) => rows.find((r) => r.gate === id);
  assert.equal(g('verify-a').ok, true); assert.match(g('verify-a').number, /\(partial T1\)$/);
  assert.equal(g('verify-d').ok, false); assert.match(g('verify-d').evidence, /^verify\/evidence\/d-suite-split\.log; classified: run-root load flakes, 46\/46 alone$/);
  assert.equal(g('verify').ok, false); assert.match(g('verify').number, /^missing: verify-919\.json \(partial table: rows a, b, d\)$/);
  assert.equal(g('size-cap').ok, true); assert.match(g('size-cap').number, /^10119 lines, ceiling 10119/);
  assert.ok(!rows.some((r) => r.gate === 'verify-dev'));
  // a finished verify-919.json wins over the partial table
  assert.equal(gates(inputs({ verifyPartial: partial })).find((r) => r.gate === 'verify-d').ok, true);
  assert.deepEqual(parseVerifyMd('no table'), { dev: null, rows: [] });
});
