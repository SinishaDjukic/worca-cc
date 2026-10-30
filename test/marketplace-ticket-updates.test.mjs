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

test('board 1: each project rule has its remove button, All projects none; then Add a project rule', async () => {
  const m = await section();
  assert.deepEqual(m.rows().map((r) => r.querySelector('.mk-tu-remove')?.getAttribute('aria-label') ?? null),
    [null, 'Remove the SHOP rule', 'Remove the CRM rule']);
  assert.equal(m.$('.mk-tu-add-rule').textContent, 'Add a project rule');
  assert.ok(m.$('.mk-tu-add-rule').compareDocumentPosition(m.$('.mk-tu-hint')) & 4, 'the hint comes last');
});

test('board 4: Add a project rule: a Project select of the projects you work on without a rule; the move starts at Any Done status', async () => {
  const m = await section();
  assert.deepEqual([m.$('.mk-tu-add-rule').disabled, m.$('.mk-tu-add-hint').hidden, m.$('.mk-tu-add-hint').textContent],
    [true, false, 'Every project you work on has a rule.'], 'SHOP and CRM have rules');
  assert.equal(m.$('.mk-tu-add-rule').getAttribute('aria-describedby'), m.$('.mk-tu-add-hint').id);
  m.$('.mk-tu-add-projects').click();
  await settle();
  m.pick('OPS');
  m.doc.querySelector('.mk-tu-done').click();
  assert.deepEqual([m.$('.mk-tu-add-rule').disabled, m.$('.mk-tu-add-hint').hidden], [false, true]);
  m.$('.mk-tu-add-rule').click();
  await settle();
  const row = m.rows().at(-1);
  const sel = row.querySelector('select.mk-tu-project');
  assert.equal(m.doc.activeElement, sel);
  assert.equal(sel.getAttribute('aria-label'), 'Project');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent, o.disabled]), [['', 'Project', true], ['OPS', 'OPS · Operations', false]],
    'key, middle dot, name, as the boards (decided 2026-10-30)');
  assert.equal(row.querySelector('.mk-tu-move').textContent, 'Any Done status');
  assert.equal(m.doc.getElementById(row.querySelector('.mk-tu-move').getAttribute('aria-labelledby')).textContent, 'New rule: move to');
  assert.equal(row.querySelector('.mk-tu-remove').getAttribute('aria-label'), 'Remove the new rule');
  assert.equal(m.$('.mk-tu-newrow-hint').hidden, false);
  assert.equal(m.$('.mk-tu-newrow-hint').textContent, 'A project rule lists that project\'s own statuses. The project list is the projects you work on (all projects when none are picked).');
  assert.deepEqual(m.tu.body().rules.length, 3, 'a row without a project is not sent');
  sel.value = 'OPS';
  sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  const ops = m.rowFor('OPS');
  assert.deepEqual([ops.querySelector('.mk-tu-key').textContent, ops.querySelector('.mk-tu-rname').textContent, ops.querySelector('.mk-tu-move').textContent],
    ['OPS', 'Operations', 'Any Done status']);
  assert.equal(m.doc.activeElement, ops.querySelector('.mk-tu-move'));
  assert.deepEqual(m.tu.body().rules.at(-1), { project: 'OPS', label: 'Operations', moment: 'finished', target: { kind: 'category', value: 'done' } });
  assert.equal(m.$('.mk-tu-newrow-hint').hidden, true);
});

test('none picked: the new row lists all projects (loaded once), minus those with a rule', async () => {
  const m = await section(tuRoutes(tuGet({ saved: true, rules: [ALL_DONE, SHOP_RULE] })));
  m.$('.mk-tu-add-rule').click();
  const sel = m.rows().at(-1).querySelector('select.mk-tu-project');
  const live = m.rows().at(-1).querySelector('.mk-tu-plive');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ["Getting Acme's projects…"]);
  assert.deepEqual([live.getAttribute('aria-live'), live.textContent], ['polite', "Getting Acme's projects…"], '§10 C: said, not only shown');
  await settle();
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'CRM', 'OPS', 'SUP', 'MKT', 'DATA']);
  assert.equal(live.textContent, '');
  assert.equal(m.calls.filter((c) => c[1] === `${TU}/projects${TU_Q}`).length, 1);
});

test('removing a rule: the row goes, focus to Add a project rule', async () => {
  const m = await section();
  m.rowFor('CRM').querySelector('.mk-tu-remove').click();
  assert.equal(m.rowFor('CRM'), undefined);
  assert.equal(m.doc.activeElement, m.$('.mk-tu-add-rule'));
  assert.deepEqual(m.tu.body().rules.map((r) => r.project), ['', 'SHOP']);
});

test('S11: removing a rule while Add a project rule stays disabled moves the focus to the row above, never to <body>', async () => {
  // OPS is no longer a project you work on, but its rule stays (D2); SHOP, the only pick, has a rule, so Add stays disabled
  const m = await section(tuRoutes(tuGet({ saved: true, projects: [{ value: 'SHOP', label: 'Shop' }],
    rules: [ALL_DONE, SHOP_RULE, { project: 'OPS', label: 'Operations', moment: 'finished', target: { kind: 'none' } }] })));
  assert.equal(m.$('.mk-tu-add-rule').disabled, true);
  m.rowFor('OPS').querySelector('.mk-tu-remove').click();
  assert.equal(m.$('.mk-tu-add-rule').disabled, true);
  assert.equal(m.doc.activeElement, m.rowFor('SHOP').querySelector('.mk-tu-remove'), "the SHOP row's remove button");
  m.rowFor('SHOP').querySelector('.mk-tu-remove').click();
  assert.equal(m.$('.mk-tu-add-rule').disabled, false, 'SHOP has no rule now');
  assert.equal(m.doc.activeElement, m.$('.mk-tu-add-rule'));
});

test('a saved record wins over the old setting: no carried-over note; All projects shows the saved rule, not the typed value', async () => {
  const m = await section(tuRoutes(tuGet({ saved: true, rules: [ALL_DONE, SHOP_RULE], legacy: { ...LEGACY, target: { typed: 'Resolve' } } })));
  assert.equal(m.$('.mk-tu-carried'), null);
  assert.equal(m.rows()[0].querySelector('.mk-tu-move').textContent, 'Any Done status');
  assert.deepEqual(m.tu.body().rules[0], ALL_DONE);
  assert.equal(m.tu.dirty(), false);
});

test('destroy leaves the focus where it was, with a move list open or not', async () => {
  const m = await section();
  const btn = m.rowFor('CRM').querySelector('.mk-tu-move');
  btn.click();
  await settle();
  assert.ok(m.doc.querySelector('.mk-tu-movepop'));
  btn.focus();
  m.tu.destroy();
  assert.equal(m.doc.activeElement, btn);
  const n = await section();
  const rm = n.rowFor('SHOP').querySelector('.mk-tu-remove');
  rm.focus();
  n.tu.destroy();
  assert.equal(n.doc.activeElement, rm);
});
