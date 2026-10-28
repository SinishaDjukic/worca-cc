// test/requirements-edits.test.mjs — the product owner's edits are ground truth (design D6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createFeature, getFeature, listTurns, updateFeature, appendTurn, setContext, createStart, getBrief, beginBrief, saveBriefResult,
} from '../src/core/requirements/store.mjs';
import {
  updateHeader, setSection, releaseSection, addCriterion, editCriterion, removeCriterion, setAssumption, setArchived, confirmOpenAssumptions, revertToStart,
  addToBrief,
} from '../src/core/requirements/edits.mjs';
import { emptySpec, nextIdNumber } from '../src/core/requirements/spec.mjs';
import { buildRoundPrompt } from '../src/core/requirements/round.mjs';
import { renderSpecMarkdown } from '../src/core/requirements/markdown.mjs';
import { startOrientation, settled, isBusy } from '../src/core/requirements/interview.mjs';

useTempHome(after);
const make = () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'k', title: 't', description: 'd' });
  return updateFeature(f.seq, { status: 'your_turn', criteriaSeq: 3, assumptionSeq: 1, spec: { ...emptySpec(),
    criteria: [{ id: 'R-po-3', text: 'c3' }], assumptions: [{ id: 'A-1', text: 'a1', status: 'open' }] } });
};

test('sections: an edit marks the section; release clears the mark', () => {
  const f = make();
  const g = setSection(f.seq, 'actors', 'Customer\nSupport', { by: 'po' });
  assert.deepEqual(g.spec.actors, ['Customer', 'Support']);
  assert.equal(g.spec.edited.actors, true);
  assert.equal(releaseSection(f.seq, 'actors').spec.edited.actors, undefined);
  assert.deepEqual(listTurns(f.seq).map((t) => [t.kind, t.payload.section, !!t.payload.released]),
    [['edit', 'actors', false], ['edit', 'actors', true]]);
  assert.throws(() => setSection(f.seq, 'criteria', []), (e) => e.code === 'BAD_REQUEST');
});

test('criteria: added with the next id, edited and removed only by the product owner', () => {
  const f = make();
  let g = addCriterion(f.seq, 'c4');
  assert.deepEqual(g.spec.criteria.at(-1), { id: 'R-po-4', text: 'c4', edited: true });
  g = removeCriterion(f.seq, 'R-po-4');
  g = addCriterion(f.seq, 'c5');
  assert.equal(g.spec.criteria.at(-1).id, 'R-po-5', 'a removed id is never reused');
  g = editCriterion(f.seq, 'R-po-3', 'c3 better');
  assert.deepEqual(g.spec.criteria[0], { id: 'R-po-3', text: 'c3 better', edited: true });
  assert.throws(() => editCriterion(f.seq, 'R-po-99', 'x'), (e) => e.code === 'NOT_FOUND');
  assert.throws(() => addCriterion(f.seq, '  '), (e) => e.code === 'BAD_REQUEST');
});

test('assumptions: confirm, reject, reopen', () => {
  const f = make();
  assert.equal(setAssumption(f.seq, 'A-1', 'confirmed').spec.assumptions[0].status, 'confirmed');
  assert.equal(setAssumption(f.seq, 'A-1', 'open').spec.assumptions[0].status, 'open');
  assert.throws(() => setAssumption(f.seq, 'A-1', 'maybe'), (e) => e.code === 'BAD_REQUEST');
  assert.throws(() => setAssumption(f.seq, 'A-9', 'confirmed'), (e) => e.code === 'NOT_FOUND');
  assert.equal(listTurns(f.seq).filter((t) => t.kind === 'assumption').length, 2);
});

test('header and archive; archived features refuse edits', () => {
  const f = make();
  assert.equal(updateHeader(f.seq, { title: 'New title' }).title, 'New title');
  assert.throws(() => updateHeader(f.seq, { title: '' }), (e) => e.code === 'BAD_REQUEST');
  assert.equal(setArchived(f.seq, true).status, 'archived');
  assert.throws(() => addCriterion(f.seq, 'x'), (e) => e.code === 'CONFLICT');
  assert.equal(setArchived(f.seq, false).status, 'your_turn');
  assert.equal(getFeature(f.seq).title, 'New title');
});

test('header edits are turns and reach the next round prompt', () => {
  const f = make();
  updateHeader(f.seq, { title: 'T2', scopeType: 'project', scopeKey: 'other' });
  updateHeader(f.seq, { description: 'D2' });
  updateHeader(f.seq, { title: 'T2' });   // no change: no turn
  const turns = listTurns(f.seq).filter((t) => t.kind === 'edit');
  assert.deepEqual(turns.map((t) => t.payload.header), [['title', 'scope'], ['description']]);
  const text = buildRoundPrompt({ feature: getFeature(f.seq), turns: listTurns(f.seq) });
  assert.match(text, /The product owner changed the title and the project or workspace\./);
  assert.match(text, /The product owner changed the description\./);
});

test('a refused edit appends no turn; every accepted edit appends exactly one', () => {
  const f = make();
  assert.throws(() => addCriterion(f.seq, ' '), (e) => e.code === 'BAD_REQUEST');
  assert.throws(() => editCriterion(f.seq, 'R-po-99', 'x'), (e) => e.code === 'NOT_FOUND');
  assert.throws(() => setAssumption(f.seq, 'A-1', 'maybe'), (e) => e.code === 'BAD_REQUEST');
  assert.equal(listTurns(f.seq).length, 0);
  addCriterion(f.seq, 'x'); setSection(f.seq, 'rules', 'r'); setAssumption(f.seq, 'A-1', 'confirmed');
  assert.equal(listTurns(f.seq).length, 3);
});

test('addCriterion follows the highest id present even when the counter lags', () => {
  const f = make();
  updateFeature(f.seq, { criteriaSeq: 0 });
  assert.equal(addCriterion(f.seq, 'n').spec.criteria.at(-1).id, 'R-po-4');
});

test('nextIdNumber: above both the counter and the highest id', () => {
  assert.equal(nextIdNumber(0, [], 'A-'), 1);
  assert.equal(nextIdNumber(5, [{ id: 'A-2' }], 'A-'), 6);
  assert.equal(nextIdNumber(1, [{ id: 'A-7' }, { id: 'R-po-9' }, { id: 'A-x' }, null], 'A-'), 8);
});

test('BUSY: edits and archiving are refused while a job runs', async () => {
  const f = make();
  setContext('project', 'k', { lookAtCode: false });
  let release;
  const gate = new Promise((res) => { release = res; });
  const d = { runClaudeImpl: async () => { await gate; return { text: '{"spec":{},"questions":[],"done":true}' }; },
    listModels: async () => [], listProjects: async () => [], workspaceTarget: async () => null,
    openLook: async () => null, openWorkspaceLook: async () => null, onChange: () => {} };
  const p = startOrientation(f.seq, {}, d);
  assert.equal(isBusy(f.seq), true);
  for (const fn of [() => setSection(f.seq, 'rules', 'x'), () => addCriterion(f.seq, 'x'), () => setArchived(f.seq, true)]) {
    assert.throws(fn, (e) => e.code === 'BUSY');
  }
  release();
  await p;
  await settled(f.seq);
});

test('restore returns a finished interview to done', () => {
  const f = make();
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  updateFeature(f.seq, { status: 'done' });
  assert.equal(setArchived(f.seq, true).status, 'archived');
  assert.equal(setArchived(f.seq, false).status, 'done');
});

test('assumptions: rejected is settable; releasing a never-edited section is harmless', () => {
  const f = make();
  assert.equal(setAssumption(f.seq, 'A-1', 'rejected').spec.assumptions[0].status, 'rejected');
  const g = releaseSection(f.seq, 'rules');
  assert.equal(g.spec.edited.rules, undefined);
  assert.deepEqual(Object.keys(g.spec.edited), []);
  assert.deepEqual(listTurns(f.seq).at(-1).payload, { section: 'rules', released: true });
});

test('a removed criterion keeps its text on the edit turn, and the next round prompt names it', () => {
  const f = make();
  removeCriterion(f.seq, 'R-po-3');
  const t = listTurns(f.seq).at(-1);
  assert.deepEqual(t.payload, { criterion: 'R-po-3', action: 'removed', text: 'c3' });
  const text = buildRoundPrompt({ feature: getFeature(f.seq), turns: listTurns(f.seq) });
  assert.match(text, /The product owner removed criterion R-po-3: c3/);
});

test('an updated title collapses newlines, so the Markdown heading cannot break', () => {
  const f = make();
  const g = updateHeader(f.seq, { title: 'Refund\n\n# not a heading' });
  assert.equal(g.title, 'Refund # not a heading');
  assert.equal(renderSpecMarkdown(g).split('\n')[0], `# ${g.id}: Refund # not a heading`);
});


test('confirmOpenAssumptions confirms only open ones in one turn; CONFLICT when none', () => {
  const f = make();
  updateFeature(f.seq, { spec: { ...getFeature(f.seq).spec, assumptions: [
    { id: 'A-1', text: 'a', status: 'open' }, { id: 'A-2', text: 'b', status: 'rejected' }, { id: 'A-3', text: 'c', status: 'open' }] } });
  const g = confirmOpenAssumptions(f.seq, { by: 'po' });
  assert.deepEqual(g.spec.assumptions.map((a) => a.status), ['confirmed', 'rejected', 'confirmed']);
  const t = listTurns(f.seq).filter((x) => x.kind === 'assumption');
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].payload, { ids: ['A-1', 'A-3'], status: 'confirmed' });
  assert.throws(() => confirmOpenAssumptions(f.seq), (e) => e.code === 'CONFLICT');
  setArchived(f.seq, true);
  assert.throws(() => confirmOpenAssumptions(f.seq), (e) => e.code === 'CONFLICT');
});

test('scope lock: once started, the project or workspace cannot change; other header edits still can', () => {
  const f = make();
  assert.equal(updateHeader(f.seq, { scopeType: 'project', scopeKey: 'k2' }).scopeKey, 'k2', 'before a start: allowed');
  createStart({ featureSeq: f.seq, version: 1, runId: `lock-${f.seq}`, spec: getFeature(f.seq).spec, title: 't', ready: true });
  const n = listTurns(f.seq).length;
  for (const scope of [{ scopeType: 'project', scopeKey: 'k3' }, { scopeType: 'workspace', scopeKey: 'k2' }]) {
    assert.throws(() => updateHeader(f.seq, { ...scope, title: 'X' }),
      (e) => e.code === 'CONFLICT' && e.message === 'this feature has been started; its project or workspace can no longer change');
  }
  assert.equal(listTurns(f.seq).length, n, 'a refused change appends nothing');
  assert.equal(getFeature(f.seq).title, 't');
  assert.equal(updateHeader(f.seq, { scopeType: 'project', scopeKey: 'k2', title: 'Same scope' }).title, 'Same scope');
});

test('revertToStart: the frozen spec comes back, counters stay, one edit turn; unknown version, busy-free checks', () => {
  const f = make();
  const frozen = getFeature(f.seq).spec;
  createStart({ featureSeq: f.seq, version: 1, runId: `rev-${f.seq}`, spec: frozen, title: 't', ready: true });
  addCriterion(f.seq, 'c4');
  setAssumption(f.seq, 'A-1', 'confirmed');
  setSection(f.seq, 'rules', 'r1');
  const g = revertToStart(f.seq, 1, { by: 'po' });
  assert.deepEqual(g.spec, frozen);
  assert.equal(g.criteriaSeq, 4);
  const t = listTurns(f.seq).at(-1);
  assert.deepEqual([t.kind, t.payload, t.by], ['edit', { reverted: 1 }, 'po']);
  assert.equal(addCriterion(f.seq, 'c5').spec.criteria.at(-1).id, 'R-po-5');
  const n = listTurns(f.seq).length;
  assert.throws(() => revertToStart(f.seq, 2), (e) => e.code === 'NOT_FOUND');
  assert.equal(listTurns(f.seq).length, n);
  setArchived(f.seq, true);
  assert.throws(() => revertToStart(f.seq, 1), (e) => e.code === 'CONFLICT');
});

// ── A7 D11: Add this to the brief ────────────────────────────────────────────────────────────────────────
const ORDERS = { name: 'Orders', text: 'checkout and history.', status: 'partly', files: ['src/o.js'], added: null, belongsTo: null };
function briefFor(scopeType, scopeKey, { areas = [ORDERS], edited = {}, sources = null } = {}) {
  const b = beginBrief(scopeType, scopeKey);
  return saveBriefResult(b.id, {
    sections: { product: 'A shop.', users: [{ name: 'Customer', can: 'orders.' }], terms: [], areas }, edited,
    sources: sources || [{ project: scopeKey, branch: 'main', ref: 'refs/heads/main', sha: 'abc1234def' }], files: ['src/o.js'],
  });
}
let briefScopes = 0;
/** What runOrientation stamps on a look: the scope it was made for and the brief it was made against. */
const stampOf = (f) => ({ scopeType: f.scopeType, scopeKey: f.scopeKey, briefId: getBrief(f.scopeType, f.scopeKey).id });
/** A feature in a fresh scope with a brief, after a closer look whose paths are the temp checkout's, absolute. */
function closerLooked({ scopeType = 'project', orientation = {}, brief = {} } = {}) {
  briefScopes += 1;
  const scopeKey = `brief-scope-${briefScopes}`;
  const b = briefFor(scopeType, scopeKey, brief);
  const f = createFeature({ scopeType, scopeKey, title: 'Gift message on an order', description: 'A note' });
  updateFeature(f.seq, { status: 'your_turn', orientation: {
    ...stampOf(f), summary: 'Orders carry no note yet.', skipped: null, area: 'Orders', at: '2026-10-20T10:00:00.000Z',
    files: ['/tmp/worca/tmp/requirements/auto-look-0000abcd/src/o.js',
      'C:\\Users\\po\\.worca\\tmp\\requirements\\auto-look-1234abcd\\src\\gift.js',
      'src/notes.js', '/etc/passwd', '../outside.js'],
    ...orientation,
  } });
  return { f: getFeature(f.seq), b, scopeType, scopeKey };
}

test('addToBrief: a new area named after the feature, under the look\'s area, files made relative; nothing replaced or marked edited', () => {
  const { f, b, scopeKey } = closerLooked({ brief: { edited: { users: true } } });
  const out = addToBrief(f.seq, { by: 'po' });
  assert.deepEqual(out, { scopeType: 'project', scopeKey });
  const now = getBrief('project', scopeKey);
  assert.equal(now.sections.areas.length, 2);
  assert.deepEqual(now.sections.areas[0], ORDERS, 'the model\'s "Orders" area is untouched');
  const added = now.sections.areas[1];
  const at = getFeature(f.seq).orientation.addedToBrief;
  assert.ok(typeof at === 'string' && at);
  assert.deepEqual(added, {
    name: 'Gift message on an order', belongsTo: 'Orders', text: 'Orders carry no note yet.', status: null,
    files: ['src/o.js', 'src/gift.js', 'src/notes.js'], added: { feature: f.id, at },
  });
  assert.deepEqual(now.edited, { users: true }, 'What exists today is not marked edited');
  assert.deepEqual(now.sections.users, b.sections.users);
  assert.equal(now.status, 'ready');
  assert.equal(now.madeAt, b.madeAt);
  const o = getFeature(f.seq).orientation;
  assert.equal(o.summary, 'Orders carry no note yet.');
  assert.equal(o.area, 'Orders');
  assert.throws(() => addToBrief(f.seq), (e) => e.code === 'CONFLICT' && e.message === 'Already added to the brief.');
  assert.equal(getBrief('project', scopeKey).sections.areas.length, 2);
});

test('addToBrief: no area named by the look gives belongsTo null; text and files are capped', () => {
  const many = Array.from({ length: 60 }, (_, i) => `/tmp/auto-look-0000abcd/src/f${i}.js`);
  const { f, scopeKey } = closerLooked({ orientation: { area: '', summary: 's'.repeat(3000), files: many } });
  addToBrief(f.seq);
  const added = getBrief('project', scopeKey).sections.areas.at(-1);
  assert.equal(added.belongsTo, null);
  assert.equal(added.text.length, 1000);
  assert.equal(added.files.length, 40);
  assert.equal(added.files[0], 'src/f0.js');
});

test('addToBrief: a workspace feature keeps repos/<member>/… paths of the brief\'s members only', () => {
  const { f, scopeKey } = closerLooked({ scopeType: 'workspace',
    brief: { sources: [{ project: 'api-1', branch: 'main', ref: 'refs/heads/main', sha: 'a' }, { project: 'web-2', branch: 'main', ref: 'refs/heads/main', sha: 'b' }] },
    orientation: { files: ['/tmp/auto-look-0000abcd/repos/api-1/src/o.js', 'C:\\t\\auto-look-1234abcd\\repos\\web-2\\app.js',
      '/tmp/auto-look-0000abcd/repos/gone-3/x.js', '/tmp/auto-look-0000abcd/README.md'] } });
  addToBrief(f.seq);
  assert.deepEqual(getBrief('workspace', scopeKey).sections.areas.at(-1).files, ['repos/api-1/src/o.js', 'repos/web-2/app.js']);
});

test('addToBrief refusals write nothing', async () => {
  const none = createFeature({ scopeType: 'project', scopeKey: 'brief-none', title: 't', description: 'd' });
  updateFeature(none.seq, { status: 'your_turn', orientation: { summary: 'x', files: [], skipped: null } });
  assert.throws(() => addToBrief(none.seq), (e) => e.code === 'CONFLICT' && e.message === 'This project has no product brief.');
  const making = beginBrief('project', 'brief-making');   // being made for the first time: not usable yet
  assert.equal(making.madeAt, null);
  const mf = createFeature({ scopeType: 'project', scopeKey: 'brief-making', title: 't', description: 'd' });
  updateFeature(mf.seq, { status: 'your_turn', orientation: { summary: 'x', files: [], skipped: null } });
  assert.throws(() => addToBrief(mf.seq), (e) => e.code === 'CONFLICT' && e.message === 'This project has no product brief.');

  const skipped = closerLooked({ orientation: { summary: '', files: [], skipped: 'brief', area: undefined } });
  assert.throws(() => addToBrief(skipped.f.seq), (e) => e.code === 'CONFLICT' && e.message === 'There is no closer look to add.');
  const noLook = closerLooked();
  updateFeature(noLook.f.seq, { orientation: null });
  assert.throws(() => addToBrief(noLook.f.seq), (e) => e.code === 'CONFLICT' && e.message === 'There is no closer look to add.');

  const full = closerLooked({ brief: { areas: Array.from({ length: 20 }, (_, i) => ({ ...ORDERS, name: `Area ${i}` })) } });
  assert.throws(() => addToBrief(full.f.seq), (e) => e.code === 'CONFLICT' && e.message === 'The brief already has 20 areas.');
  assert.equal(getBrief('project', full.scopeKey).sections.areas.length, 20);
  assert.equal(getFeature(full.f.seq).orientation.addedToBrief, undefined);

  const archived = closerLooked();
  setArchived(archived.f.seq, true);
  assert.throws(() => addToBrief(archived.f.seq), (e) => e.code === 'CONFLICT');
  assert.equal(getBrief('project', archived.scopeKey).sections.areas.length, 1);

  const busy = closerLooked();
  setContext('project', busy.scopeKey, { lookAtCode: false });
  let release;
  const gate = new Promise((res) => { release = res; });
  const d = { runClaudeImpl: async () => { await gate; return { text: '{"spec":{},"questions":[],"done":true}' }; },
    listModels: async () => [], listProjects: async () => [], workspaceTarget: async () => null,
    openLook: async () => null, openWorkspaceLook: async () => null, onChange: () => {} };
  const p = startOrientation(busy.f.seq, {}, d);
  assert.equal(isBusy(busy.f.seq), true);
  assert.throws(() => addToBrief(busy.f.seq), (e) => e.code === 'BUSY');
  release();
  await p;
  await settled(busy.f.seq);
  assert.equal(getBrief('project', busy.scopeKey).sections.areas.length, 1);
});

test('addToBrief again after a new closer look updates the feature\'s own area in place; Worca\'s areas are never replaced', () => {
  const { f, scopeKey } = closerLooked();
  const first = getBrief('project', scopeKey).sections.areas;
  addToBrief(f.seq);
  const once = getBrief('project', scopeKey).sections.areas;
  assert.equal(once.length, 2);
  const firstAt = once[1].added.at;
  // a new Look closer replaces the orientation: addedToBrief is gone, the summary, files and area are new
  updateFeature(f.seq, { orientation: { ...stampOf(f), summary: 'Orders now need a gift flag.', skipped: null, area: 'Checkout', at: '2026-10-21T10:00:00.000Z',
    files: ['/tmp/auto-look-0000abcd/src/gift-flag.js'] } });
  addToBrief(f.seq, { by: 'po' });
  const twice = getBrief('project', scopeKey).sections.areas;
  assert.equal(twice.length, 2, 'no duplicate');
  assert.deepEqual(twice[0], first[0], 'the model\'s area is untouched');
  assert.equal(twice[1].name, 'Gift message on an order');
  assert.equal(twice[1].belongsTo, 'Checkout');
  assert.equal(twice[1].text, 'Orders now need a gift flag.');
  assert.deepEqual(twice[1].files, ['src/gift-flag.js']);
  assert.equal(twice[1].added.feature, f.id);
  assert.equal(twice[1].added.at, getFeature(f.seq).orientation.addedToBrief);
  assert.ok(twice[1].added.at >= firstAt);
  // another feature's add still appends
  const other = createFeature({ scopeType: 'project', scopeKey, title: 'Wrap an order', description: 'd' });
  updateFeature(other.seq, { status: 'your_turn', orientation: { ...stampOf(other), summary: 'No wrapping.', files: [], skipped: null, area: 'Orders' } });
  addToBrief(other.seq);
  assert.equal(getBrief('project', scopeKey).sections.areas.length, 3);
});

test('addToBrief: with 20 areas a re-add of the feature\'s own area succeeds; a new one is refused', () => {
  const { f, scopeKey } = closerLooked({ brief: { areas: Array.from({ length: 19 }, (_, i) => ({ ...ORDERS, name: `Area ${i}` })) } });
  addToBrief(f.seq);
  assert.equal(getBrief('project', scopeKey).sections.areas.length, 20);
  updateFeature(f.seq, { orientation: { ...stampOf(f), summary: 'A second look.', files: [], skipped: null, area: 'Orders' } });
  addToBrief(f.seq);
  const areas = getBrief('project', scopeKey).sections.areas;
  assert.equal(areas.length, 20);
  assert.equal(areas[19].text, 'A second look.');
  assert.equal(areas[19].added.feature, f.id);
  const other = createFeature({ scopeType: 'project', scopeKey, title: 'Another', description: 'd' });
  updateFeature(other.seq, { status: 'your_turn', orientation: { ...stampOf(other), summary: 'x', files: [], skipped: null } });
  assert.throws(() => addToBrief(other.seq), (e) => e.code === 'CONFLICT' && e.message === 'The brief already has 20 areas.');
});

test('addToBrief refuses a closer look made for another scope, or before the brief (no brief id, or an earlier brief), writing nothing', () => {
  const unchanged = (x) => {
    assert.equal(getBrief(x.scopeType, x.scopeKey).sections.areas.length, 1);
    assert.equal(getFeature(x.f.seq).orientation.addedToBrief, undefined);
  };
  // the feature moved to another project (which has a brief too) after its look
  const moved = closerLooked();
  const there = closerLooked();
  updateHeader(moved.f.seq, { scopeType: 'project', scopeKey: there.scopeKey });
  assert.throws(() => addToBrief(moved.f.seq),
    (e) => e.code === 'CONFLICT' && e.message === 'This closer look was made for another project or workspace. Look again first.');
  unchanged(there);
  // a look made before the brief existed carries no brief id
  const early = closerLooked({ orientation: { briefId: null } });
  assert.throws(() => addToBrief(early.f.seq),
    (e) => e.code === 'CONFLICT' && e.message === 'This closer look was made before the product brief. Look again first.');
  unchanged(early);
  // ... and a look without any stamp (made before looks were stamped) is refused the same way
  const legacy = closerLooked();
  const { scopeType: _t, scopeKey: _k, briefId: _b, ...bare } = getFeature(legacy.f.seq).orientation;
  updateFeature(legacy.f.seq, { orientation: bare });
  assert.throws(() => addToBrief(legacy.f.seq), (e) => e.code === 'CONFLICT' && /^This closer look was made /.test(e.message));
  unchanged(legacy);
  // a look made against an earlier brief of the scope (deleted and made again since)
  const old = closerLooked({ orientation: { briefId: -1 } });
  assert.throws(() => addToBrief(old.f.seq),
    (e) => e.code === 'CONFLICT' && e.message === 'This closer look was made before the product brief. Look again first.');
  unchanged(old);
});

test("A8 D13: the product owner's edit of a criterion keeps its source", () => {
  const f = make();   // the file's helper
  updateFeature(f.seq, { spec: { ...f.spec, criteria: [{ id: 'R-po-3', text: 'From the tickets', source: 'support-tickets.pdf' }] } });
  editCriterion(f.seq, 'R-po-3', 'From the tickets, reworded');
  assert.deepEqual(getFeature(f.seq).spec.criteria[0], { id: 'R-po-3', text: 'From the tickets, reworded', edited: true, source: 'support-tickets.pdf' });
});

test('A3 D10: alsoInTx runs inside the edit with the written feature; a throw rolls the edit and its turn back', () => {
  const f = make();
  const seen = [];
  const g = addCriterion(f.seq, 'c9', { by: 'po', alsoInTx: (w) => seen.push(w.spec.criteria.at(-1).id) });
  assert.deepEqual(seen, [g.spec.criteria.at(-1).id]);
  for (const [name, run] of [
    ['setSection', (o) => setSection(f.seq, 'rules', ['x'], o)],
    ['addCriterion', (o) => addCriterion(f.seq, 'c10', o)],
    ['editCriterion', (o) => editCriterion(f.seq, 'R-po-3', 'c3 new', o)],
    ['removeCriterion', (o) => removeCriterion(f.seq, 'R-po-3', o)],
    ['setAssumption', (o) => setAssumption(f.seq, 'A-1', 'rejected', o)],
  ]) {
    const before = getFeature(f.seq);
    const turns = listTurns(f.seq).length;
    assert.throws(() => run({ by: 'po', alsoInTx: () => { throw new Error('mark failed'); } }), /mark failed/, name);
    assert.deepEqual(getFeature(f.seq).spec, before.spec, `${name}: the spec is unchanged`);
    assert.equal(getFeature(f.seq).criteriaSeq, before.criteriaSeq, `${name}: the counter is unchanged`);
    assert.equal(listTurns(f.seq).length, turns, `${name}: no turn`);
  }
});
