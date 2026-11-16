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
  const cx2 = { stillhetRoutes: new Map([['/api/a/:id', [['stillhet/live/task-live.mjs', 'runs']]]]), live: 'keepAwake', plans: [{ cite: 'PLAN.md B9', text: 'wire `/api/c`', routes: ['/api/c'] }],
    rows: [{ section: 'Tasks capabilities', id: 'B', status: 'not offered', routes: ['/api/b/*'], places: [], line: '' }], overrides: new Map(), keyMemo: new Map(), routeMemo: new Map() };
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

test('pageOf: Pinpoint\'s run surfaces (artifact viewer, Diff tab) are the run\'s page; Pinpoint itself stays Chat (COV-3)', () => {
  assert.equal(C.pageOf('ui/public/pinpoint-surfaces.mjs'), 'Tasks');
  assert.equal(C.pageOf('ui/public/pinpoint.mjs'), 'Chat');
});

test('placeOf: a folder of ui/public/stillhet/ is its place, a live/ file takes its place by name, shared code serves all', () => {
  assert.equal(C.placeOf('stillhet/projects/project-add.js'), 'projects');
  assert.equal(C.placeOf('ui/public/stillhet/live/task-live.mjs'), 'runs');
  assert.equal(C.placeOf('stillhet/live/run-options-live.mjs'), 'centers');
  assert.equal(C.placeOf('stillhet/live/live-adapter.mjs'), '*');
  assert.equal(C.placeOf('stillhet/boot.js'), '*');
});

test('a classic control is covered only from its own Stillhet place: the same route called from another place clears nothing', () => {
  // Stillhet as the open slices make it: Projects reads /api/fs/dirs, New task's ticket source calls the source routes, the task
  // page sends a run's direction; each with a `wired` row that names its own file.
  const cx2 = { live: '', plans: [], overrides: new Map(), keyMemo: new Map(), routeMemo: new Map(),
    stillhetRoutes: new Map([
      ['/api/fs/dirs', [['stillhet/live/projects-live.mjs', 'projects']]],
      ['/api/source-bindings', [['stillhet/live/run-options-live.mjs', 'centers']]],
      ['/api/sources/call', [['stillhet/live/run-options-live.mjs', 'centers']]],
      ['/api/runs/:param/directions', [['stillhet/live/task-live.mjs', 'runs']]],
      ['/api/runs/:param', [['stillhet/live/task-live.mjs', 'runs'], ['stillhet/live/chat-live.mjs', 'chat']]]]),
    rows: [
      { section: 'Dev surfaces', id: 'projects/project-add.js › Several folders…', status: 'wired', routes: ['/api/fs/dirs', '/api/projects/bulk'], places: ['projects'], line: '' },
      { section: 'Dev surfaces', id: "New task…'s ticket source", status: 'wired', routes: ['/api/sources', '/api/source-bindings', '/api/sources/call'], places: [], line: '' },
      { section: 'Dev surfaces', id: 'route › /api/runs/:param/directions', status: 'wired', routes: ['/api/runs/:param/directions'], places: ['runs'], line: '' }] };
  const of = (id) => { const c = controls.find((x) => x.id === id); assert.ok(c, id); return C.classify(cx2, c); };
  for (const id of ['ui/public/new-run/new.html › button › Browse…', 'ui/public/new-run/new.html › button › Several folders…',
    'ui/public/workflows/export.html › button › Browse…', 'ui/public/app.js › button › Retry', 'ui/public/app.js › button › Test connection',
    'ui/public/shape/plan-body.mjs › button › Full plan']) assert.equal(of(id).status, 'MISSING', id);
  assert.deepEqual(of('ui/public/new-run/new.html › button › Several folders…').missing, ['route /api/fs/dirs']);
  assert.equal(of('ui/public/projects/project-add.html › button › Several folders…').status, 'wired');
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
