// test/stillhet-coverage.test.mjs — gate.coverage (docs/rail/gate.md): every classic control in
// plans/rail/coverage/classic-controls.json is classified against Stillhet (wired, planned, not offered by decision, MISSING);
// today's MISSING list is the frozen baseline test/fixtures/stillhet-coverage-baseline.json, which only shrinks, and each of
// its controls names an open finding (COV-N) in plans/rail/findings.md and plans/rail/test-results/PLAN.md.
// Static and fast: no browser, no server (tools/classic-inventory.mjs; its --walk is run by hand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as C from '../tools/classic-inventory.mjs';

const read = (rel) => readFileSync(join(C.ROOT, rel), 'utf8');
const controls = JSON.parse(read(C.CONTROLS));
const baseline = JSON.parse(read(C.BASELINE));
const cx = C.classifyIndex();
const classified = controls.map((c) => ({ ...c, ...C.classify(cx, c) }));

test('looksLabel: words and sentence labels, never a class list or an id', () => {
  for (const s of ['Add project', 'Several folders…', 'add to group', '+ New', 'Cancel']) assert.equal(C.looksLabel(s), true, s);
  for (const s of ['btn btn-sm', 'btn-quiet', 'proj-add-save', 'is-open', 'API_KEY', '{x}']) assert.equal(C.looksLabel(s), false, s);
});

test('docRoutes: route mentions in prose, with params and a trailing wildcard', () => {
  assert.deepEqual(C.docRoutes('`POST /api/runs/:id/terminal`, `/api/proxy/*` and /api/x.'), ['/api/runs/:id/terminal', '/api/proxy/*', '/api/x']);
});

test('classify: a Stillhet fetch is wired, a wiring row decides, an unnamed route is MISSING, a view control takes its place', () => {
  const cx2 = { stillhetRoutes: new Map([['/api/a/:id', 'stillhet/live/a.mjs']]), live: 'keepAwake', plans: [{ cite: 'PLAN.md B9', text: 'wire `/api/c`', routes: ['/api/c'] }],
    rows: [{ section: 'Tasks capabilities', id: 'B', status: 'not offered', routes: ['/api/b/*'], line: '' }], overrides: new Map(), keyMemo: new Map(), routeMemo: new Map() };
  const ctl = (routes, keys = [], page = 'Tasks') => ({ id: 'x', page, routes, keys });
  assert.equal(C.classify(cx2, ctl(['/api/a/:param'])).status, 'wired');
  assert.equal(C.classify(cx2, ctl(['/api/b/x/y'])).status, 'not offered');
  assert.equal(C.classify(cx2, ctl(['/api/c'])).status, 'planned');
  assert.deepEqual(C.classify(cx2, ctl(['/api/a/:param', '/api/d'])).missing, ['route /api/d']);
  assert.equal(C.classify(cx2, ctl([], ['keepAwake'])).status, 'wired');
  assert.equal(C.classify(cx2, ctl(['/api/settings'], ['nope'])).status, 'MISSING');
  assert.equal(C.classify(cx2, ctl([], [], 'Settings')).status, 'planned');
  assert.equal(C.classify(cx2, ctl([], [], 'Nowhere')).status, null);
});

test('the inventory is current: the static scan finds exactly the static controls in classic-controls.json', () => {
  const scanned = C.scanStatic().map((c) => c.id);
  const stored = controls.filter((c) => c.file).map((c) => c.id);
  const added = scanned.filter((id) => !stored.includes(id)), gone = stored.filter((id) => !scanned.includes(id));
  assert.deepEqual({ added, gone }, { added: [], gone: [] }, 'run node tools/classic-inventory.mjs and commit plans/rail/coverage/');
});

test('every classic control has a classification', () => {
  const none = classified.filter((c) => !C.STATUSES.includes(c.status)).map((c) => `${c.id}: ${c.where}`);
  assert.deepEqual(none, [], 'give its page a Stillhet place (PAGES) or add a `## Classic controls` row in plans/rail/stillhet-wiring.md');
});

test('MISSING only shrinks: every MISSING control is in the baseline, and the baseline holds nothing that is no longer MISSING', () => {
  const miss = C.missingIds(classified);
  const grew = miss.filter((id) => !(id in baseline));
  const shrank = Object.keys(baseline).filter((id) => !miss.includes(id));
  assert.deepEqual(grew, [], 'a classic control Stillhet does not carry: wire it, plan it (a findings.md row naming its route) or decide it (a stillhet-wiring.md row)');
  assert.deepEqual(shrank, [], 'covered now: run node tools/classic-inventory.mjs --update to lower the baseline');
});

test('each MISSING control names an open finding in findings.md and its PLAN.md batch', () => {
  const ledger = read('plans/rail/findings.md');
  const open = ledger.slice(ledger.indexOf('## Open'), ledger.indexOf('## Closed'));
  const plan = read('plans/rail/test-results/PLAN.md');
  const ids = [...new Set(Object.values(baseline))];
  for (const id of ids) {
    assert.match(id, /^COV-\d+$/, `finding id ${id}`);
    assert.ok(new RegExp(`\\b${id}\\b`).test(open), `${id} has an Open row in plans/rail/findings.md`);
    assert.ok(new RegExp(`\\b${id}\\b`).test(plan), `${id} is in a PLAN.md batch`);
  }
});
