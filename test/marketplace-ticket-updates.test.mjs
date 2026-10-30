// test/marketplace-ticket-updates.test.mjs — Ticket updates in the manage sheet (plans/ticket-updates-design.md boards 1, 3, 4,
// 5 A–E; D2, D4, D12; §10, §11): the section on its own, then (Task 16) inside the manage sheet.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { sheetHarness, ok, fail, settle, deferred } from './helpers/marketplace-sheet-harness.mjs';
import { createTicketUpdates } from '../ui/public/marketplace/ticket-updates-section.mjs';
import { createManageSheet } from '../ui/public/marketplace/manage-sheet.mjs';
import { ICONS } from '../ui/public/icons.mjs';
import { ROW, DETAIL, INVENTORY } from './helpers/marketplace-manage-fixtures.mjs';
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
  // approved board 1: a trash can on each remove button; a 12 px + before Add projects… and Add a project rule
  const glyph = (el) => [el.className, el.getAttribute('aria-hidden'), el.querySelector('svg').getAttribute('width'), el.querySelector('svg').innerHTML];
  assert.deepEqual(m.$$('.mk-tu-remove').map((b) => glyph(b.firstElementChild)), [['ic', 'true', '16', ICONS.trash], ['ic', 'true', '16', ICONS.trash]]);
  assert.deepEqual(['.mk-tu-add-projects', '.mk-tu-add-rule'].map((q) => glyph(m.$(q).firstChild)), [['ic', 'true', '12', ICONS.plus], ['ic', 'true', '12', ICONS.plus]],
    'the icon comes first, before the words');
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
  assert.equal(m.tu.body().rules.length, 3, 'a row without a project is not sent');
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

test('WCAG 3.2.2: arrowing through the closed Project select keeps the row pending; Enter commits, focus to the move select', async () => {
  const m = await section(tuRoutes(tuGet({ saved: true, rules: [ALL_DONE, SHOP_RULE] })));
  m.$('.mk-tu-add-rule').click();
  await settle();
  const sel = m.rows().at(-1).querySelector('select.mk-tu-project');
  const before = m.tu.body().rules;
  const key = (k) => sel.dispatchEvent(new m.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key('ArrowDown');
  sel.value = 'CRM';
  sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(m.rows().at(-1).querySelector('select.mk-tu-project'), sel, 'still the picker row');
  assert.equal(m.doc.activeElement, sel);
  assert.deepEqual(m.tu.body().rules, before);
  key('Enter');
  const crm = m.rowFor('CRM');
  assert.ok(crm, 'committed');
  assert.equal(m.doc.activeElement, crm.querySelector('.mk-tu-move'));
  assert.deepEqual(m.tu.body().rules.at(-1), { project: 'CRM', label: 'Customer portal', moment: 'finished', target: { kind: 'category', value: 'done' } });
});

test('WCAG 3.2.2: a typed pick commits on blur; Tab into the row lands on its move select, Tab out stays where it goes', async () => {
  for (const into of [true, false]) {
    const m = await section(tuRoutes(tuGet({ saved: true, rules: [ALL_DONE, SHOP_RULE] })));
    m.$('.mk-tu-add-rule').click();
    await settle();
    const row = m.rows().at(-1);
    const sel = row.querySelector('select.mk-tu-project');
    sel.dispatchEvent(new m.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    sel.value = 'OPS';
    sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
    const next = into ? row.querySelector('.mk-tu-move') : m.$('.mk-tu-add-projects');
    next.focus();
    await settle();
    const ops = m.rowFor('OPS');
    assert.ok(ops, 'committed on blur');
    assert.equal(m.doc.activeElement, into ? ops.querySelector('.mk-tu-move') : next);
    assert.notEqual(m.doc.activeElement, m.doc.body);
    assert.equal(m.tu.body().rules.at(-1).project, 'OPS');
  }
});

test("WCAG 3.2.2: a press on the new row's remove button after a typed pick removes the row, it does not commit the pick", async () => {
  const m = await section(tuRoutes(tuGet({ saved: true, rules: [ALL_DONE, SHOP_RULE] })));
  m.$('.mk-tu-add-rule').click();
  await settle();
  const row = m.rows().at(-1);
  const sel = row.querySelector('select.mk-tu-project');
  sel.dispatchEvent(new m.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  sel.value = 'OPS';
  sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  const rm = row.querySelector('.mk-tu-remove');
  rm.focus();   // the mousedown's focus; the click follows after the blur's timer
  await settle();
  assert.ok(rm.isConnected, 'not committed yet');
  rm.click();
  assert.deepEqual([m.rowFor('OPS'), m.$('.mk-tu-newrow')], [undefined, null]);
  assert.deepEqual(m.tu.body().rules.map((r) => r.project), ['', 'SHOP']);
  assert.equal(m.doc.activeElement, m.$('.mk-tu-add-rule'));
});

test('S11: removing the new row when Add a project rule has just become disabled: focus to the row above, never <body>', async () => {
  const m = await section();
  m.$('.mk-tu-add-projects').click();
  await settle();
  m.pick('OPS');
  m.doc.querySelector('.mk-tu-done').click();
  m.$('.mk-tu-add-rule').click();
  await settle();
  // OPS leaves the projects you work on: SHOP and CRM have rules, but the pending row keeps Add enabled
  m.$('.mk-tu-chip[data-value="OPS"] .mk-tu-x').click();
  assert.equal(m.$('.mk-tu-add-rule').disabled, false);
  m.rows().at(-1).querySelector('.mk-tu-remove').click();
  assert.equal(m.$('.mk-tu-add-rule').disabled, true, 'every project you work on has a rule now');
  assert.equal(m.doc.activeElement, m.rowFor('CRM').querySelector('.mk-tu-remove'));
  assert.equal(m.$('.mk-tu-newrow'), null);
});

const SHIPPED = { kind: 'status', value: '10099', label: 'Shipped', category: 'done' };
test('board 5 E: a stored status the project no longer has keeps its name; the line under the row; picking another clears it', async () => {
  const m = await section(tuRoutes(tuGet({ saved: true, projects: [], rules: [ALL_DONE, { project: 'CRM', label: 'Customer portal', moment: 'finished', target: SHIPPED },
    { project: 'OPS', label: 'Operations', moment: 'finished', target: { kind: 'none' } }] })));
  await settle();
  const row = m.rowFor('CRM');
  const btn = row.querySelector('.mk-tu-move');
  const line = row.querySelector('.mk-tu-gone');
  assert.equal(btn.textContent, 'Shipped', 'the select shows the stored name');
  assert.equal(line.textContent, 'CRM has no status named Shipped any more. Pick another; until then a run leaves CRM tickets where they are and says so in its comment.');
  assert.equal(btn.getAttribute('aria-describedby'), line.id);
  assert.deepEqual([statusCalls(m, 'CRM'), statusCalls(m, 'OPS')], [1, 0], 'only a rule that names a status is checked');
  assert.equal(m.tu.dirty(), false, 'Save still works; nothing changed');
  btn.click();
  await settle();
  assert.equal(statusCalls(m, 'CRM'), 1, 'the check filled the cache');
  [...m.doc.querySelectorAll('.mk-tu-movepop [role="option"]')].find((o) => o.textContent === 'Released').click();
  assert.deepEqual([row.querySelector('.mk-tu-gone'), btn.hasAttribute('aria-describedby')], [null, false]);
});

test('board 5 E: four projects at a time; a project that cannot be read marks nothing', async () => {
  const gate = deferred();
  let running = 0;
  let most = 0;
  const slow = () => async () => { running += 1; most = Math.max(most, running); await gate.p; running -= 1; return ok({ statuses: [] }); };
  const keys = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const more = Object.fromEntries(keys.map((k) => [`GET ${TU}/statuses${TU_Q}&project=${k}`, slow()]));
  more[`GET ${TU}/statuses${TU_Q}&project=P6`] = async () => { running += 1; most = Math.max(most, running); await gate.p; running -= 1;
    return fail(502, { error: 'Worca could not reach Jira: the API token was refused.', kind: 'auth' }); };
  const m = await section(tuRoutes(tuGet({ saved: true, rules: [ALL_DONE, ...keys.map((k) => ({ project: k, label: k, moment: 'finished',
    target: { kind: 'status', value: '7', label: 'Gone', category: 'done' } }))] }), more));
  assert.equal(running, 4);
  gate.resolve();
  await settle(30);
  assert.equal(most, 4);
  assert.deepEqual(keys.map((k) => !!m.rowFor(k).querySelector('.mk-tu-gone')), [true, true, true, true, true, false]);
});

// ---- inside the manage sheet (D12) ----
const JROW = { ...ROW, name: 'jira-source', subdir: 'plugins/jira-source', latest: null };
const JDETAIL = { ...DETAIL, plugin: JROW, inventory: { ...INVENTORY, taskSources: [{ id: 'jira', displayName: 'Jira', secrets: ['token'] }] } };
const JSCHEMA = [
  { key: 'baseUrl', type: 'text', label: 'Jira URL', secret: false, required: true, default: null, help: null, options: [] },
  { key: 'email', type: 'text', label: 'Account email', secret: false, required: false, default: null, help: null, options: [] },
  { key: 'token', type: 'text', label: 'API token', secret: true, required: true, default: null, help: null, options: [] },
  { key: 'transitionOnComplete', type: 'text', label: 'Transition on completion', secret: false, required: false, default: null,
    help: 'Optional. A transition or status name (e.g. Done) to move the issue to.', options: [] }];
const jconfig = (profile = 'acme') => ok({ sources: [{ id: 'jira', multiProfile: true, profile, profiles: [{ id: 'acme', label: 'Acme' }, { id: 'beta', label: 'Beta' }],
  schema: JSCHEMA, values: { baseUrl: 'https://acme.atlassian.net', email: 'ann@example.test', token: { set: true }, transitionOnComplete: 'Resolve' } }], channels: [] });
async function sheet(routes = {}, { flags = 'ticketUpdates', get = SAVED } = {}) {
  const h = sheetHarness({ trackDom, plugins: [JROW], routes: { 'GET /api/plugins/jira-source': ok(JDETAIL), 'GET /api/plugins/jira-source/config': jconfig(),
    ...tuRoutes(get), ...routes } });
  h.doc.documentElement.dataset.flags = flags;
  const manage = createManageSheet({ doc: h.doc, win: h.window, page: h.page, deps: h.deps, wait: h.wait, now: h.now });
  await manage.open('jira-source', { opener: h.doc.getElementById('opener') });
  await settle();
  const $ = (s) => h.doc.querySelector(`#mk-sheet ${s}`);
  const field = (key) => [...h.doc.querySelectorAll('#mk-sheet .field[data-field]')].find((r) => r.dataset.field === key);
  const type = (key, value) => { const c = $(`[data-key="${key}"]`); c.value = value; c.dispatchEvent(new h.window.Event('input', { bubbles: true })); };
  const puts = () => h.calls.filter((c) => c[0] === 'PUT').map((c) => c[1]);
  return { ...h, manage, $, field, type, puts };
}

test('D12: the section sits after Test connection when the flag is on; off, nothing and no call', async () => {
  let m = await sheet();
  const tu = m.$('[data-group="source:jira"] .mk-tu');
  assert.ok(tu && !tu.hidden);
  assert.ok(tu.previousElementSibling.classList.contains('mk-test-row'));
  assert.equal(m.$('.mk-tu-head .mk-meta').textContent, 'Acme (acme)');
  m = await sheet({}, { flags: '' });
  assert.equal(m.$('.mk-tu'), null);
  assert.equal(m.calls.some((c) => String(c[1]).includes('/ticket-updates')), false);
});

test('D4: after the first save the old field reads "Moved to Ticket updates.", its label stays, and Save never sends it', async () => {
  let m = await sheet();
  const row = m.field('transitionOnComplete');
  assert.equal(row.querySelector('label').textContent, 'Transition on completion');
  assert.equal(row.querySelector('label').hasAttribute('for'), false, 'the label names no control that is gone');
  assert.equal(row.querySelector('[data-key]'), null);
  assert.equal(row.querySelector('small.hint'), null, 'Deviation 5 (S14): the help went with its control');
  assert.equal(row.querySelector('.mk-tu-moved').textContent, 'Moved to Ticket updates.');
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.puts()], [false, []], 'nothing changed: the sheet just closes');
  m = await sheet();
  m.type('baseUrl', 'https://acme2.atlassian.net');
  m.$('[data-act="save"]').click();
  await settle();
  const put = m.calls.find((c) => c[0] === 'PUT');
  assert.equal(put[1], '/api/plugins/jira-source/config');
  assert.equal('transitionOnComplete' in put[2].values, false);
  m = await sheet({}, { get: tuGet() });
  assert.ok(m.field('transitionOnComplete').querySelector('[data-key="transitionOnComplete"]'), 'nothing saved yet: the old field stays');
});

test('D12: Save sends the config PUT first, then the ticket-updates PUT; a refused config save sends nothing more', async () => {
  let m = await sheet({ 'PUT /api/plugins/jira-source/config': ok({ ok: true }), [`PUT ${TU}`]: ok({ ok: true }) });
  m.type('baseUrl', 'https://acme2.atlassian.net');
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(m.puts(), ['/api/plugins/jira-source/config', TU]);
  const body = m.calls.find((c) => c[1] === TU)[2];
  assert.deepEqual([body.sourceId, body.profile, body.projects], ['jira', 'acme', [{ value: 'SHOP', label: 'Shop' }]]);
  assert.deepEqual([m.manage.isOpen(), m.notified.map((n) => n.title)], [false, ['Settings saved.']]);
  m = await sheet({ 'PUT /api/plugins/jira-source/config': fail(400, { error: 'the Jira URL must start with https://' }) });
  m.type('baseUrl', 'ftp://x');
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(m.puts(), ['/api/plugins/jira-source/config'], 'no ticket-updates PUT after a refused config save');
  assert.equal(m.$('.mk-save-err .mk-wash-text').textContent, 'the Jira URL must start with https://');
  assert.equal(m.manage.isOpen(), true);
});

test('D12: only the section changed: one PUT; a refused one shows the error wash under Settings and the sheet stays', async () => {
  let m = await sheet({ [`PUT ${TU}`]: fail(400, { error: 'All projects needs exactly one rule.' }) });
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(m.puts(), [TU]);
  assert.equal(m.$('[data-sec="settings"] .mk-save-err .mk-wash-text').textContent, 'All projects needs exactly one rule.');
  assert.equal(m.manage.isOpen(), true);
  m = await sheet({ [`PUT ${TU}`]: ok({ ok: true }) }, { get: tuGet({ legacy: { ...LEGACY, target: { typed: 'Resolve' } } }) });
  m.doc.getElementById('mk-sheet').dispatchEvent(new m.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.deepEqual([m.manage.isOpen(), m.doc.querySelector('dialog.discard-modal')], [false, null], 'carried over is not a change: closing asks nothing');
});

test('D12: a profile switch repaints the section for that profile; a section change asks before switching', async () => {
  const BETA_Q = '?sourceId=jira&profile=beta';
  const m = await sheet({ 'GET /api/plugins/jira-source/config?profile=beta': jconfig('beta'),
    [`GET ${TU}${BETA_Q}`]: ok(tuGet({ connection: 'new', profile: { id: 'beta', label: 'Beta' }, legacy: null })) });
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  const sel = m.$('.mk-profile-sel');
  sel.value = 'beta';
  sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  assert.ok(m.calls.some((c) => c[0] === 'confirm' && c[1] === 'Discard unsaved changes?'), 'the section was dirty');
  assert.equal(m.$('.mk-tu-head .mk-meta').textContent, 'Beta (beta)');
  assert.equal(m.$('.mk-tu-new').textContent, "Save this connection first. Ticket updates read Jira's projects and statuses through it.");
  assert.equal(m.doc.querySelectorAll('.mk-tu').length, 1, 'the old section is gone');
});

test('S13: a Test connection that saves the connection turns state A into the live section without reopening', async () => {
  let saved = false;
  const m = await sheet({ 'PUT /api/plugins/jira-source/config': async () => { saved = true; return ok({ ok: true }); },
    [`GET ${TU}${TU_Q}`]: async () => ok(saved ? SAVED : tuGet({ connection: 'new', legacy: null })),
    'POST /api/sources/call': ok({ ok: true, result: { ok: true } }) });
  assert.ok(m.$('.mk-tu-new'), 'state A');
  m.type('baseUrl', 'https://acme2.atlassian.net');
  m.$('.mk-test').click();
  await settle();
  assert.deepEqual([m.$('.mk-tu-new'), !!m.$('.mk-tu-rules'), m.doc.querySelectorAll('#mk-sheet .mk-tu').length], [null, true, 1]);
  assert.ok(m.$('.mk-tu').previousElementSibling.classList.contains('mk-test-row'), 'still right after Test connection');
});

test('D4: a value typed into the old field before the section answered is kept, not dropped silently; a profile switch mid-save leaves the new section alone', async () => {
  const gate = deferred();
  let m = await sheet({ [`GET ${TU}${TU_Q}`]: async () => { await gate.p; return ok(SAVED); } });
  m.type('transitionOnComplete', 'Close');
  gate.resolve();
  await settle();
  const c = m.field('transitionOnComplete').querySelector('[data-key="transitionOnComplete"]');
  assert.deepEqual([c && c.value, m.field('transitionOnComplete').querySelector('.mk-tu-moved')], ['Close', null], 'the edit stays and is saved as typed');
  const put = deferred();
  const BETA_Q = '?sourceId=jira&profile=beta';
  m = await sheet({ [`PUT ${TU}`]: async () => { await put.p; return ok({ ok: true }); },
    'GET /api/plugins/jira-source/config?profile=beta': jconfig('beta'),
    [`GET ${TU}${BETA_Q}`]: ok(tuGet({ profile: { id: 'beta', label: 'Beta' }, legacy: { ...LEGACY, target: { typed: 'Resolve' } } })) });
  m.$('.mk-tu-chip[data-value="CRM"] .mk-tu-x').click();
  m.$('[data-act="save"]').click();
  await settle();
  const sel = m.$('.mk-profile-sel');
  sel.value = 'beta';
  sel.dispatchEvent(new m.window.Event('change', { bubbles: true }));
  await settle();
  const beta = m.$('.mk-tu');
  assert.equal(beta.querySelector('.mk-tu-head .mk-meta').textContent, 'Beta (beta)');
  put.resolve();
  await settle();
  assert.ok(beta.querySelector('.mk-tu-carried'), "acme's save is not marked on beta's section: its carried-over note stays");
});

test('14b review: a section change no DOM change event reports (a keyboard pick committed on Enter) makes the sheet dirty, and Save sends it', async () => {
  const m = await sheet({ [`PUT ${TU}`]: ok({ ok: true }) }, { get: tuGet({ saved: true, rules: [ALL_DONE, SHOP_RULE] }) });
  m.$('.mk-tu-add-rule').click();
  await settle();
  const sel = m.$('.mk-tu-newrow select.mk-tu-project');
  const key = (k) => sel.dispatchEvent(new m.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key('ArrowDown');
  sel.value = 'CRM';   // no change or input event: the pick commits on Enter alone
  key('Enter');
  assert.ok(m.$('.mk-tu-rule[data-project="CRM"]'), 'committed');
  m.doc.getElementById('mk-sheet').dispatchEvent(new m.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.ok(m.doc.querySelector('dialog.discard-modal'), 'the sheet counts it as a change: closing asks');
  m.doc.querySelector('dialog.discard-modal .discard-keep').click();
  await settle();
  assert.equal(m.manage.isOpen(), true);
  m.$('[data-act="save"]').click();
  await settle();
  assert.deepEqual(m.puts(), [TU]);
  assert.deepEqual(m.calls.find((c) => c[1] === TU)[2].rules.at(-1),
    { project: 'CRM', label: 'Customer portal', moment: 'finished', target: { kind: 'category', value: 'done' } });
  assert.equal(m.manage.isOpen(), false);
});

test('D12: Add profile and Remove profile repaint the section with the group', async () => {
  const GAMMA_Q = '?sourceId=jira&profile=gamma';
  const gamma = ok({ sources: [{ ...jconfig().data.sources[0], profile: 'gamma', profiles: [{ id: 'acme', label: 'Acme' }, { id: 'gamma', label: 'Gamma' }] }], channels: [] });
  const m = await sheet({ 'POST /api/plugins/jira-source/profiles': ok({ ok: true }), 'GET /api/plugins/jira-source/config?profile=gamma': gamma,
    [`GET ${TU}${GAMMA_Q}`]: ok(tuGet({ connection: 'new', profile: { id: 'gamma', label: 'Gamma' }, legacy: null })),
    'DELETE /api/plugins/jira-source/profiles/gamma?sourceId=jira': ok({ ok: true }) });
  m.deps.promptModal = async () => ({ id: 'gamma', label: 'Gamma' });
  m.$('.mk-profile-add').click();
  await settle();
  assert.deepEqual([m.$('.mk-tu-head .mk-meta').textContent, !!m.$('.mk-tu-new'), m.doc.querySelectorAll('.mk-tu').length], ['Gamma (gamma)', true, 1]);
  m.$('.mk-profile-del').click();
  await settle();
  assert.deepEqual([m.$('.mk-tu-head .mk-meta').textContent, !!m.$('.mk-tu-rules'), m.doc.querySelectorAll('.mk-tu').length], ['Acme (acme)', true, 1]);
});
