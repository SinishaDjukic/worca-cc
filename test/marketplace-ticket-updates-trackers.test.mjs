// test/marketplace-ticket-updates-trackers.test.mjs — PR 1's Ticket updates section, unchanged, for azure-boards-source and
// github-source (plans/ticket-updates-pr2-plan.md decision 5): a single-profile source, owner/repo keys in the statuses URL, a
// carried-over yes/no setting, and a select-type old field that gives way to "Moved to Ticket updates.". No UI code changes in
// PR 2: a failure here means the section needs a change, which needs an approved mock first.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { sheetHarness, ok, settle } from './helpers/marketplace-sheet-harness.mjs';
import { createTicketUpdates } from '../ui/public/marketplace/ticket-updates-section.mjs';
import { createManageSheet } from '../ui/public/marketplace/manage-sheet.mjs';
import { ROW, DETAIL } from './helpers/marketplace-manage-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
const GH = '/api/plugins/github-source/ticket-updates';
const GH_STATUSES = [{ value: 'open', label: 'Open', category: 'todo' }, { value: 'completed', label: 'Closed', category: 'done' },
  { value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' }];
const NOT_PLANNED = { kind: 'status', value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' };
const GH_SAVED = { available: true, connection: 'saved', profile: { id: 'default', label: 'GitHub Issues' }, saved: true,
  projects: [{ value: 'Acme/API', label: 'API' }],
  rules: [{ project: '', moment: 'finished', target: { kind: 'category', value: 'done' } },
    { project: 'Acme/API', label: 'API', moment: 'finished', target: NOT_PLANNED }],
  legacy: { field: 'closeOnComplete', label: 'Close issue on completion', target: null } };
const ghRoutes = (get = GH_SAVED) => ({ [`GET ${GH}?sourceId=github`]: ok(get),
  [`GET ${GH}/statuses?sourceId=github&project=Acme%2FAPI`]: ok({ statuses: GH_STATUSES }) });

test('github-source: one connection (no profile id), owner/repo as a chip and a rule, its statuses asked by the encoded key', async () => {
  const h = sheetHarness({ trackDom, routes: ghRoutes() });
  const tu = createTicketUpdates({ doc: h.doc, api: h.deps.api, plugin: 'github-source', sourceId: 'github', tracker: 'GitHub Issues' });
  h.doc.body.append(tu.el);
  assert.equal((await tu.load()).available, true);
  await settle();
  assert.equal(tu.el.querySelector('.mk-tu-head .mk-meta').textContent, 'GitHub Issues', 'a single-profile source: its name, no "(default)"');
  const chip = tu.el.querySelector('.mk-tu-chip');
  assert.deepEqual([chip.dataset.value, chip.querySelector('.mk-tu-key').textContent, chip.querySelector('.mk-tu-cname').textContent], ['Acme/API', 'Acme/API', 'API']);
  assert.deepEqual([...tu.el.querySelectorAll('.mk-tu-rule')].map((r) => r.dataset.project).filter(Boolean), ['Acme/API']);
  assert.ok(h.calls.some((c) => c[1] === `${GH}/statuses?sourceId=github&project=Acme%2FAPI`), 'the gone check asks with the key encoded');
  assert.equal(tu.el.querySelector('.mk-tu-gone'), null, 'Closed as not planned is still one of its statuses');
  assert.equal(tu.dirty(), false);
  assert.deepEqual(tu.body(), { sourceId: 'github', projects: GH_SAVED.projects, rules: GH_SAVED.rules }, 'no profile in the body');
});

test('azure-boards-source: closeOnComplete yes is carried over as Any Done status, with the note naming the old field; not dirty', async () => {
  const AZ = '/api/plugins/azure-boards-source/ticket-updates';
  const get = { available: true, connection: 'saved', profile: { id: 'work', label: 'Work' }, saved: false, projects: [], rules: [],
    legacy: { field: 'closeOnComplete', label: 'Close work item on completion', target: { category: 'done' } } };
  const h = sheetHarness({ trackDom, routes: { [`GET ${AZ}?sourceId=azure-boards&profile=work`]: ok(get) } });
  const tu = createTicketUpdates({ doc: h.doc, api: h.deps.api, plugin: 'azure-boards-source', sourceId: 'azure-boards', profile: 'work',
    tracker: 'Azure Boards' });
  h.doc.body.append(tu.el);
  await tu.load();
  await settle();
  assert.equal(tu.el.querySelector('.mk-tu-carried').textContent,
    'Filled in from the old Close work item on completion setting. Nothing changes until you save; after that, the old setting is no longer used.');
  assert.deepEqual(tu.body().rules, [{ project: '', moment: 'finished', target: { kind: 'category', value: 'done' } }]);
  assert.equal(tu.dirty(), false, '§10 B: carried over is not a change');
});

// ---- inside the manage sheet: the old select field ----
const GCONFIG = { sources: [{ id: 'github', multiProfile: false, profile: null, profiles: [],
  schema: [{ key: 'token', type: 'text', label: 'GitHub token', secret: true, required: false, default: null, help: null, options: [] },
    { key: 'closeOnComplete', type: 'select', label: 'Close issue on completion', secret: false, required: false, default: 'no',
      help: 'Yes closes the issue (state_reason: completed) when a pipeline finishes successfully', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }],
  values: { token: { set: true }, closeOnComplete: 'yes' } }], channels: [] };

test('D4 for a select: after the first save, Close issue on completion reads "Moved to Ticket updates." and Save never sends it', async () => {
  const h = sheetHarness({ trackDom, plugins: [{ ...ROW, latest: null }], routes: { 'GET /api/plugins/github-source': ok(DETAIL),
    'GET /api/plugins/github-source/config': ok(GCONFIG), ...ghRoutes() } });
  h.doc.documentElement.dataset.flags = 'ticketUpdates';
  const manage = createManageSheet({ doc: h.doc, win: h.window, page: h.page, deps: h.deps, wait: h.wait, now: h.now });
  await manage.open('github-source', { opener: h.doc.getElementById('opener') });
  await settle();
  assert.ok(h.doc.querySelector('#mk-sheet [data-group="source:github"] .mk-tu:not([hidden])'), 'the section is there for github-source');
  const row = [...h.doc.querySelectorAll('#mk-sheet .field[data-field]')].find((r) => r.dataset.field === 'closeOnComplete');
  assert.equal(row.querySelector('label').textContent, 'Close issue on completion');
  assert.deepEqual([row.querySelector('[data-key]'), row.querySelector('.select-wrap'), row.querySelector('small.hint')], [null, null, null]);
  assert.equal(row.querySelector('.mk-tu-moved').textContent, 'Moved to Ticket updates.');
  h.doc.querySelector('#mk-sheet [data-act="save"]').click();
  await settle();
  assert.deepEqual([manage.isOpen(), h.calls.filter((c) => c[0] === 'PUT')], [false, []], 'nothing changed: the sheet just closes');
});
