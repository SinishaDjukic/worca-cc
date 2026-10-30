// test/marketplace-ticket-updates.test.mjs — Ticket updates in the manage sheet (plans/ticket-updates-design.md boards 1, 3, 4,
// 5 A–E; D2, D4, D12; §10, §11): the section on its own, then (Task 16) inside the manage sheet.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { sheetHarness, ok, fail, settle, deferred } from './helpers/marketplace-sheet-harness.mjs';
import { createTicketUpdates } from '../ui/public/marketplace/ticket-updates-section.mjs';
import { TU, TU_Q, RESOLVED, LEGACY, ALL_DONE, SHOP_RULE, tuGet, SAVED, tuRoutes } from './helpers/ticket-updates-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
async function section(routes = tuRoutes()) {
  const h = sheetHarness({ trackDom, routes });
  const tu = createTicketUpdates({ doc: h.doc, api: h.deps.api, plugin: 'jira-source', sourceId: 'jira', profile: 'acme', tracker: 'Jira' });
  h.doc.body.append(tu.el);
  const info = await tu.load();
  await settle();
  const $ = (s) => tu.el.querySelector(s);
  const $$ = (s) => [...tu.el.querySelectorAll(s)];
  const rows = () => $$('.mk-tu-rule');
  const rowFor = (key) => rows().find((r) => r.dataset.project === key);
  // the popover's rows are the options (role="option", aria-selected; the tick is decorative), so a click on the row toggles it
  const pick = (value) => h.doc.querySelector(`.mk-tu-prow[data-value="${value}"]`).click();
  return { ...h, tu, info, $, $$, rows, rowFor, pick };
}
const statusCalls = (m, key) => m.calls.filter((c) => c[1] === `${TU}/statuses${TU_Q}&project=${key}`).length;

test('board 1: a saved connection: header and meta, the projects as chips, the rules list; not dirty', async () => {
  const m = await section();
  assert.deepEqual(m.info, { available: true, saved: true, connection: 'saved', legacyField: 'transitionOnComplete' });
  const head = m.doc.getElementById(m.tu.el.getAttribute('aria-labelledby'));
  assert.deepEqual([m.tu.el.tagName, head.textContent, m.$('.mk-tu-head .mk-meta').textContent], ['SECTION', 'Ticket updates', 'Acme (acme)']);
  assert.equal(m.$('.mk-tu-sub').textContent, "What Worca does to a ticket when a run that writes back finishes. A project's own rule wins over All projects.");
  assert.deepEqual(m.$$('.mk-tu-h').map((n) => n.textContent), ['Projects you work on', 'When a run finishes successfully']);
  assert.deepEqual(m.$$('.mk-tu-chip').map((c) => [c.getAttribute('role'), c.querySelector('.mk-tu-key').textContent, c.querySelector('.mk-tu-cname').textContent,
    c.querySelector('.mk-tu-x').getAttribute('aria-label')]), [['listitem', 'SHOP', 'Shop', 'Remove SHOP'], ['listitem', 'CRM', 'Customer portal', 'Remove CRM']]);
  assert.equal(m.$('.mk-tu-add-projects').textContent, 'Add projects…');
  assert.ok(m.$$('.mk-tu-projects .hint').some((n) => n.textContent === 'New run, Requirements export and import list only these. None picked = all projects.'));
  assert.equal(m.$('.mk-tu-rules').getAttribute('role'), 'list');
  assert.deepEqual(m.rows().map((r) => [r.getAttribute('role'), r.querySelector('.mk-tu-key, .mk-tu-rname').textContent,
    r.querySelector('.mk-tu-move').textContent]),
  [['listitem', 'All projects', 'Any Done status'], ['listitem', 'SHOP', 'Resolved'], ['listitem', 'CRM', "Don't move"]]);
  assert.equal(m.rows()[0].querySelector('.mk-tu-rsub').textContent, 'Unless a project below says otherwise');
  assert.equal(m.doc.getElementById(m.rowFor('SHOP').querySelector('.mk-tu-move').getAttribute('aria-labelledby')).textContent, 'SHOP: move to');
  assert.equal(m.$('.mk-tu-hint').textContent, "Any Done status: one the ticket can reach, never Won't Do, Rejected or Duplicate. When a move asks for a Resolution, Worca fills in Done, Fixed or Complete. Every update is the last line of Worca's comment on the ticket.");
  assert.equal(m.$('.mk-tu-carried'), null);
  assert.equal(m.tu.dirty(), false);
});

test('board 5 A: a connection not saved yet shows only the line; nothing else is asked', async () => {
  const m = await section(tuRoutes(tuGet({ connection: 'new', legacy: null })));
  assert.equal(m.info.connection, 'new');
  assert.deepEqual([...m.tu.el.children].map((n) => n.className), ['mk-sec-head mk-tu-head', 'hint mk-tu-new']);
  assert.equal(m.$('.mk-tu-new').textContent, "Save this connection first. Ticket updates read Jira's projects and statuses through it.");
  assert.deepEqual(m.calls.map((c) => `${c[0]} ${c[1]}`), [`GET ${TU}${TU_Q}`]);
  assert.equal(m.tu.dirty(), false);
});

test('not available (no capability, or the GET failed): the section stays hidden', async () => {
  let m = await section(tuRoutes(tuGet({ available: false })));
  assert.deepEqual([m.info, m.tu.el.hidden], [{ available: false }, true]);
  m = await section(tuRoutes(SAVED, { [`GET ${TU}${TU_Q}`]: fail(502, { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' }) }));
  assert.deepEqual([m.info, m.tu.el.hidden], [{ available: false }, true]);
});

test('board 5 B: carried over: filled in, the note above the rules, not dirty until a change; Save sends it as shown', async () => {
  let m = await section(tuRoutes(tuGet({ legacy: { ...LEGACY, target: { typed: 'Resolve' } } })));
  assert.equal(m.rows()[0].querySelector('.mk-tu-move').textContent, 'Resolve (as typed)');
  const note = m.$('.mk-tu-carried');
  assert.equal(note.textContent, 'Filled in from the old Transition on completion setting. Nothing changes until you save; after that, the old setting is no longer used.');
  assert.equal(note.querySelector('strong').textContent, 'Transition on completion');
  assert.ok(note.compareDocumentPosition(m.$('.mk-tu-rules')) & 4, 'the note sits above the rules');
  assert.equal(m.tu.dirty(), false, 'closing the sheet asks nothing');
  m.$('.mk-tu-add-projects').click();
  await settle();
  m.pick('SHOP');
  assert.equal(m.tu.dirty(), true);
  const body = m.tu.body();
  assert.deepEqual(body, { sourceId: 'jira', profile: 'acme', projects: [{ value: 'SHOP', label: 'Shop' }],
    rules: [{ project: '', moment: 'finished', target: { kind: 'typed', value: 'Resolve' } }] }, 'the All projects row as shown, typed value included');
  m.tu.markSaved(body);
  assert.deepEqual([m.tu.dirty(), m.$('.mk-tu-carried')], [false, null]);
  m = await section(tuRoutes(tuGet({ legacy: { ...LEGACY, target: { category: 'done' } } })));
  assert.equal(m.rows()[0].querySelector('.mk-tu-move').textContent, 'Any Done status');
  m = await section(tuRoutes(tuGet()));
  assert.deepEqual([m.rows()[0].querySelector('.mk-tu-move').textContent, m.$('.mk-tu-carried')], ["Don't move", null]);
});

test('D2: removing a project keeps its rule; focus goes to Add projects…', async () => {
  const m = await section();
  m.$('.mk-tu-chip[data-value="SHOP"] .mk-tu-x').click();
  assert.deepEqual(m.$$('.mk-tu-chip').map((c) => c.dataset.value), ['CRM']);
  assert.equal(m.doc.activeElement, m.$('.mk-tu-add-projects'));
  assert.equal(m.tu.dirty(), true);
  const body = m.tu.body();
  assert.deepEqual(body.projects, [{ value: 'CRM', label: 'Customer portal' }]);
  assert.deepEqual(body.rules.map((r) => r.project), ['', 'SHOP', 'CRM'], 'a choice is never dropped silently');
});

test('board 3 from the section: a toggle adds a chip at once; the footer counts the picks', async () => {
  const m = await section();
  assert.deepEqual(['aria-haspopup', 'aria-expanded'].map((a) => m.$('.mk-tu-add-projects').getAttribute(a)), ['dialog', 'false']);
  m.$('.mk-tu-add-projects').click();
  await settle();
  assert.equal(m.$('.mk-tu-add-projects').getAttribute('aria-expanded'), 'true');
  assert.equal(m.doc.querySelector('.mk-tu-pcount').textContent, '2 picked · 6 projects on Acme');
  m.pick('OPS');
  assert.deepEqual(m.$$('.mk-tu-chip').map((c) => [c.dataset.value, c.querySelector('.mk-tu-cname').textContent]),
    [['SHOP', 'Shop'], ['CRM', 'Customer portal'], ['OPS', 'Operations']]);
  assert.equal(m.doc.querySelector('.mk-tu-pcount').textContent, '3 picked · 6 projects on Acme');
  m.$('.mk-tu-add-projects').click();
  assert.equal(m.doc.querySelector('.mk-tu-projpop'), null, 'a second press closes it');
});

test('destroy closes an open projects popover and an open move list (no document listener left behind)', async () => {
  const m = await section();
  m.$('.mk-tu-add-projects').click();
  await settle();
  assert.ok(m.doc.querySelector('.mk-tu-projpop'));
  m.tu.destroy();
  assert.deepEqual([m.doc.querySelector('.mk-tu-projpop'), m.$('.mk-tu-add-projects').getAttribute('aria-expanded')], [null, 'false']);
  const n = await section();
  const btn = n.rowFor('CRM').querySelector('.mk-tu-move');
  btn.click();
  await settle();
  assert.ok(n.doc.querySelector('.mk-tu-movepop'));
  n.tu.destroy();
  assert.deepEqual([n.doc.querySelector('.mk-tu-movepop'), btn.getAttribute('aria-expanded')], [null, 'false']);
});

test("picking a status: the project's statuses load once per opening; the body takes its id, name and category; markSaved cleans", async () => {
  const m = await section();
  const btn = m.rowFor('SHOP').querySelector('.mk-tu-move');
  btn.click();
  await settle();
  [...m.doc.querySelectorAll('.mk-tu-movepop [role="option"]')].find((o) => o.textContent === 'Done').click();
  assert.equal(btn.textContent, 'Done');
  btn.click();
  await settle();
  btn.click();
  assert.equal(statusCalls(m, 'SHOP'), 1);
  const body = m.tu.body();
  assert.deepEqual(body.rules[1].target, { kind: 'status', value: '10001', label: 'Done', category: 'done' });
  assert.equal(m.tu.dirty(), true);
  m.tu.markSaved(body);
  assert.equal(m.tu.dirty(), false);
});
