// test/models-jobs-view.test.mjs — drawing the Jobs tab (models-menu P6 Task 4, DESIGN JOB-1…JOB-10): the harness
// tiles and the default button, the three role tiles, the Steps / Helper jobs / Design cards with their rows, the
// more-line and the save bar, each block at its interface level; and the "Override a step / helper job" menu with
// its search field, its groups and the jobs that already have a model of their own.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderJobs, openOverrideMenu } from '../ui/public/models/jobs-view.mjs';
import { buildJobs } from '../ui/public/models/jobs-model.mjs';
import { ENGINE_NAMES, engineLabel } from '../src/shared/engine-switch.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };

// The fixtures of test/models-jobs-model.test.mjs (Task 3).
const CAT = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'], hidden: true },
  { id: 'my-gw', label: 'My GW', custom: 'global', efforts: ['medium', 'high'] },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];
const SETTINGS = { runEngine: null, modelRoles: { claude: { deep: { model: 'claude-opus-5-5', effort: 'xhigh' } } },
  stepModels: { claude: { reviewer: { model: 'claude-opus-5-5', effort: 'max' }, implementer: { effort: 'high' } } },
  titleModel: 'claude-haiku-4-5', autoWorkflowModel: '', prDescriptionModel: '', agentGenModel: { model: null, effort: null },
  secondOpinionModel: null, memoryDefrag: { model: 'claude-haiku-4-5', effort: null }, designModels: {},
  utilityModels: { codex: { overview: { model: 'gpt-6.1-sol' } } } };
const STEPS = [{ key: 'planner', label: 'Plan' }, { key: 'refiner', label: 'Refine' }, { key: 'implementer', label: 'Implement' },
  { key: 'reviewer', label: 'Review' }, { key: 'manualTestsChecklist', label: 'Manual tests checklist' }];
const ALL_READY = ENGINE_NAMES.map((name) => ({ name, label: engineLabel(name), ready: true }));
const DATA = (settings, flags = {}, extra = {}) => ({ settings, steps: STEPS, catalog: CAT, engines: ALL_READY, locks: [], flags,
  testable: new Set(['claude-opus-5-5', 'claude-haiku-4-5']), ...extra });
const VIEW = (engine) => ({ engine, showAll: { steps: false, helpers: false }, revealed: new Set() });
const showAll = (engine, part) => ({ ...VIEW(engine), showAll: { steps: part === 'steps', helpers: part === 'helpers' } });
const build = (settings, engine = 'claude', { flags = {}, draft = {}, view = VIEW(engine), extra = {} } = {}) => buildJobs(DATA(settings, flags, extra), draft, view);

const draw = (vm, opts = {}) => {
  const doc = docOf();
  const root = renderJobs(vm, { doc, engines: ALL_READY, ...opts });
  doc.body.append(root);
  return { doc, root };
};
const rowOf = (root, part, id) => root.querySelector(`#jobs-${part} .mdl-job-row[data-setting="${id}"]`);
const texts = (nodes) => [...nodes].map((n) => n.textContent.trim());
const key = (doc, target, k) => {
  const ev = new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
};

test('1. blocks, order and interface levels', () => {
  const vm = build(SETTINGS, 'claude', { flags: { design: true } });
  const { root } = draw(vm);
  assert.ok(root.matches('div.mdl-jobs'));
  assert.ok(root.querySelector('.mdl-hx [data-engine="claude"][aria-pressed="true"]'), 'the picked harness is pressed');
  assert.equal(root.querySelector('.mdl-hx [data-engine="claude"] .mdl-hx-state').textContent, 'Ready · Default for new runs', 'the tiles know the engines and the default');
  // Harness, the harness line, Roles, the three cards, the save bar: in this order.
  const blocks = [...root.children].map((c) => c.id || c.className || c.firstElementChild.textContent);
  assert.deepEqual(blocks, ['Harness', 'mdl-jobs-line', 'jobs-roles', 'jobs-steps', 'jobs-helpers', 'jobs-design', 'mdl-savebar']);
  assert.equal(root.querySelector('.mdl-hx').parentElement.dataset.minLevel, 'expert');
  assert.equal(root.querySelector('.mdl-hx').parentElement.querySelector('h2.mdl-sect').textContent, 'Harness');
  assert.equal(root.querySelector('.mdl-jobs-line').dataset.minLevel, 'expert');
  assert.equal(root.querySelector('#jobs-roles').dataset.minLevel, 'simple');
  assert.equal(root.querySelector('#jobs-roles > h2.mdl-sect').textContent, 'Roles');
  assert.deepEqual(texts(root.querySelectorAll('#jobs-roles .mdl-tiles > button.mdl-tile .mdl-tile-role')), ['Deep thinking', 'Everyday tasks', 'Quick jobs']);
  assert.deepEqual([...root.querySelectorAll('section.card.drows.mdl-job-card')].map((c) => [c.dataset.section, c.querySelector('h2').textContent, c.dataset.minLevel]),
    [['steps', 'Steps', 'advanced'], ['helpers', 'Helper jobs', 'advanced'], ['design', 'Design', 'advanced']]);
  // The default harness: pressed and not offered again.
  const def = root.querySelector('.mdl-jobs-line > button.btn.btn-sm.mdl-default-btn');
  assert.equal(def.textContent, 'Default for new runs');
  assert.equal(def.getAttribute('aria-pressed'), 'true');
  assert.equal(def.disabled, true);
  // A role tile: its setting, the picker it opens, the model with its mark and chevron, the effort.
  const deep = root.querySelector('#jobs-roles .mdl-tile[data-setting="models.claude.roles.deep"]');
  assert.equal(deep.getAttribute('aria-label'), 'Deep thinking: Opus 5.5, xhigh effort');
  assert.equal(deep.getAttribute('aria-haspopup'), 'menu');
  assert.equal(deep.querySelector('.mdl-tile-sub').textContent, 'Plans and reviews');
  assert.equal(deep.querySelector('.mdl-tile-model').textContent, 'Opus 5.5');
  assert.ok(deep.querySelector('.mdl-tile-model .mdl-mark') && deep.querySelector('.mdl-tile-model .ic'), 'mark and chevron');
  assert.equal(deep.querySelector('.mdl-tile-eff').textContent, 'xhigh effort');
  const quick = root.querySelector('#jobs-roles .mdl-tile[data-setting="models.claude.roles.quick"]');
  assert.equal(quick.getAttribute('aria-label'), "Quick jobs: each job's own default");
  assert.equal(quick.querySelector('.mdl-tile-model').textContent, "Each job's own default");
  assert.equal(quick.querySelector('.mdl-tile-model .mdl-mark'), null, 'no mark without a model');
  assert.equal(quick.querySelector('.mdl-tile-eff').textContent, '');
  // Design always shows both rows and says nothing about the rest: no more-line (no band, no stray hairline).
  assert.equal(root.querySelectorAll('#jobs-design .mdl-job-row').length, 2);
  assert.equal(root.querySelector('#jobs-design .mdl-more-line'), null);
  assert.equal(root.querySelector('#jobs-design .mdl-override'), null);
});

test('1b. the harness line: readiness words, the default button and its lock', () => {
  const engines = [{ name: 'codex', label: 'OpenAI Codex', ready: false, reason: 'its CLI is not installed.' }];
  const vm = build(SETTINGS, 'codex', { extra: { engines } });
  let { root } = draw(vm, { engines });
  assert.equal(root.querySelector('.mdl-jobs-reason').textContent, "OpenAI Codex can't start runs yet: its CLI is not installed.");
  let def = root.querySelector('.mdl-default-btn');
  assert.equal(def.getAttribute('aria-pressed'), 'false');
  assert.equal(def.disabled, false);
  assert.equal(root.querySelector('.mdl-hx [data-engine="codex"][aria-pressed="true"]') !== null, true);
  const locks = [{ name: 'codex', reason: 'Off while the credential broker is on' }];
  ({ root } = draw(build(SETTINGS, 'codex', { extra: { engines, locks } }), { engines, locks }));
  def = root.querySelector('.mdl-default-btn');
  assert.equal(def.disabled, true);
  assert.equal(def.title, 'Off while the credential broker is on');
  assert.equal(root.querySelector('.mdl-hx [data-engine="codex"]').disabled, true, 'the locks reach the tiles');
});

test('2. an overridden row and a following row', () => {
  const vm = build(SETTINGS, 'claude', { view: showAll('claude', 'steps') });
  const { root } = draw(vm);
  const rev = rowOf(root, 'steps', 'models.claude.steps.reviewer');
  assert.ok(rev.matches('div.drow.mdl-job-row'));
  assert.match(rev.querySelector('.mdl-job-txt').textContent, /Review\s*Instead of Deep thinking/);
  assert.equal(rev.querySelector('.mdl-job-name').textContent, 'Review');
  assert.equal(rev.querySelector('.mdl-job-sub').textContent, 'Instead of Deep thinking');
  const pick = rev.querySelector('.drow-control > button.mdl-pick');
  assert.equal(pick.getAttribute('aria-label'), 'Model for Review: Opus 5.5, effort max');
  assert.equal(pick.getAttribute('aria-haspopup'), 'menu');
  assert.equal(pick.classList.contains('inherit'), false);
  assert.ok(pick.querySelector('.mdl-mark'), 'an own model wears its mark');
  assert.equal(pick.querySelector('.mdl-pick-text').textContent, 'Opus 5.5');
  assert.match(pick.querySelector('.mdl-pick-eff').textContent, /^\s*· max$/);
  const testBtn = rev.querySelector('.drow-control > button.btn.btn-quiet.btn-sm.mdl-job-test');
  assert.equal(testBtn.textContent, 'Test');
  assert.equal(testBtn.getAttribute('aria-label'), 'Test the model for Review');
  const clear = rev.querySelector('.drow-control > button.btn.btn-quiet.btn-sm.btn-icon.mdl-job-clear[aria-label="Remove the override for Review"]');
  assert.ok(clear && clear.querySelector('.ic'), 'the clear button is an icon');
  assert.equal(clear.textContent.trim(), '', 'no glyph typed as text');
  // An own effort with no model: no Test (nothing to test), still its clear button.
  const impl = rowOf(root, 'steps', 'models.claude.steps.implementer');
  assert.equal(impl.querySelector('.mdl-pick').getAttribute('aria-label'), "Model for Implement: The workflow's model, effort high");
  assert.equal(impl.querySelector('.mdl-pick .mdl-mark'), null);
  assert.equal(impl.querySelector('.mdl-job-test'), null);
  assert.ok(impl.querySelector('.mdl-job-clear'));
  // A row that follows its role: dashed picker, the role's words, no sub, no Test, no clear.
  const plan = rowOf(root, 'steps', 'models.claude.steps.planner');
  assert.ok(plan.querySelector('.mdl-pick.inherit'));
  assert.equal(plan.querySelector('.mdl-pick').getAttribute('aria-label'), 'Model for Plan: From Deep thinking · Opus 5.5, effort xhigh');
  assert.equal(plan.querySelector('.mdl-pick .mdl-mark'), null);
  assert.equal(plan.querySelector('.mdl-job-sub').textContent, '');
  assert.equal(plan.querySelector('.mdl-job-test'), null);
  assert.equal(plan.querySelector('.mdl-job-clear'), null);
  // Own rows first, then the rest in list order.
  assert.deepEqual([...root.querySelectorAll('#jobs-steps .mdl-job-row')].map((r) => r.dataset.setting.split('.').pop()),
    ['implementer', 'reviewer', 'planner', 'refiner', 'manualTestsChecklist']);
  const more = root.querySelector('#jobs-steps .mdl-more-line');
  assert.equal(more.querySelector('span').textContent, "2 more follow their role · 1 uses Worca's default");
  const toggle = more.querySelector('button.btn.btn-quiet.btn-sm.mdl-show-all');
  assert.equal(toggle.textContent, 'Show less');
  assert.equal(toggle.dataset.minLevel, 'expert');
  assert.equal(root.querySelector('#jobs-steps').lastElementChild, more, 'the more-line ends the card');
  // Folded: only the own rows, and the toggle offers them all.
  const folded = draw(build(SETTINGS)).root;
  assert.equal(folded.querySelectorAll('#jobs-steps .mdl-job-row').length, 2);
  assert.equal(folded.querySelector('#jobs-steps .mdl-show-all').textContent, 'Show all');
  const head = folded.querySelector('#jobs-steps > .card-head.mdl-card-h');
  assert.deepEqual([...head.children].map((c) => c.tagName + (c.className ? `.${c.className.split(' ').join('.')}` : '')),
    ['H2', 'SPAN.badge', 'BUTTON.btn.btn-sm.mdl-override']);
  assert.equal(head.querySelector('.badge').textContent, '5');
  assert.equal(head.querySelector('.mdl-override').textContent, 'Override a step');
  assert.ok(head.querySelector('.mdl-override .ic'), 'the plus is an icon');
});

test('2b. a model reached through a provider wears its vendor\'s mark (the /api/config row\'s upstreamModel)', () => {
  const catalog = [...CAT, { id: 'gw-one', label: 'Gateway one', custom: 'global', upstreamModel: 'openai/gpt-x' }];
  const settings = { ...SETTINGS, modelRoles: { claude: { deep: { model: 'gw-one' } } }, stepModels: { claude: { reviewer: { model: 'gw-one' } } } };
  const { root } = draw(build(settings, 'claude', { extra: { catalog } }));
  const tileMark = root.querySelector('.mdl-tile[data-setting="models.claude.roles.deep"] .mdl-mark');
  const rowMark = rowOf(root, 'steps', 'models.claude.steps.reviewer').querySelector('.mdl-pick .mdl-mark');
  for (const mark of [tileMark, rowMark]) {
    assert.equal(mark.classList.contains('own'), false, 'not the worca mark of a model of your own');
    assert.equal(mark.querySelector('img').getAttribute('alt'), 'OpenAI', 'the vendor of upstreamModel (its id and name say nothing)');
  }
  assert.ok(rowMark.classList.contains('sm') && !tileMark.classList.contains('sm'), 'small in the picker, the tile size on a role tile');
});

test('3. helper jobs on Cursor: the note, no override, no rows', () => {
  const { root } = draw(build(SETTINGS, 'cursor'));
  assert.match(root.querySelector('#jobs-helpers > p.mdl-job-note').textContent, /^Cursor runs its helper jobs/);
  assert.equal(root.querySelector('#jobs-helpers .mdl-override'), null);
  assert.equal(root.querySelector('#jobs-helpers .mdl-job-row'), null);
  assert.equal(root.querySelector('#jobs-helpers .mdl-more-line'), null);
  assert.equal(root.querySelector('#jobs-helpers .badge').textContent, '0');
  // Claude's helper card has no note.
  assert.equal(draw(build(SETTINGS)).root.querySelector('#jobs-helpers .mdl-job-note'), null);
});

test('4. the save bar shows only with unsaved changes', () => {
  let { root } = draw(build(SETTINGS));
  assert.equal(root.querySelector('.mdl-savebar').hidden, true);
  ({ root } = draw(build(SETTINGS, 'claude', { draft: { 'models.claude.roles.quick': { model: 'claude-haiku-4-5' } } })));
  const bar = root.querySelector('.mdl-savebar');
  assert.equal(bar.hidden, false);
  assert.equal(bar.querySelector('span.note').textContent, '1 unsaved change');
  assert.deepEqual(texts(bar.querySelectorAll('button')), ['Discard', 'Save']);
  assert.ok(bar.querySelector('button.btn.mdl-discard') && bar.querySelector('button.btn.btn-primary.mdl-save'));
  assert.equal(root.querySelector('#jobs-roles .mdl-tile[data-setting="models.claude.roles.quick"] .mdl-tile-model').textContent, 'Haiku 4.5');
});

const GROUPS = ['Follow Deep thinking', 'Follow Quick jobs', 'Follow Everyday tasks', "Use Worca's default"];
const visible = (pop, sel) => [...pop.querySelectorAll(sel)].filter((n) => !n.hidden);
const headingWords = (h) => { const c = h.cloneNode(true); c.querySelector('.mdl-over-n')?.remove(); return c.textContent.trim(); };
const itemNamed = (pop, name) => [...pop.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.startsWith(name));

function openSteps(engine = 'claude') {
  const vm = build(SETTINGS, engine);
  const { doc, root } = draw(vm);
  const anchor = root.querySelector('#jobs-steps .mdl-override');
  const picks = [];
  const section = vm.sections.find((s) => s.key === 'steps');
  const handle = openOverrideMenu({ doc, win: doc.defaultView, anchor, section, onPick: (id) => picks.push(id) });
  return { doc, root, anchor, picks, handle, pop: doc.querySelector('.mdl-over-pop') };
}

test('5. the override menu groups, searches and disables what is taken', () => {
  const { doc, anchor, picks, pop } = openSteps();
  assert.ok(pop.matches('div.menu.mdl-over-pop[role="dialog"]'));
  assert.equal(pop.parentElement, doc.body);
  assert.equal(pop.getAttribute('aria-label'), 'Override a step');
  assert.equal(anchor.getAttribute('aria-expanded'), 'true');
  const list = pop.querySelector('[role="menu"]');
  assert.ok(list);
  const field = pop.querySelector('input.input.input-sm[type="search"]');
  assert.equal(field.placeholder, 'Find a step');
  assert.equal(field.getAttribute('aria-label'), 'Find a step');
  assert.equal(doc.activeElement, field, 'the field takes the focus');
  // Headings: a non-empty ordered subset of the four, each with its count.
  const heads = visible(list, '.menu-h');
  const words = heads.map(headingWords);
  assert.ok(words.length > 0);
  assert.deepEqual(words, GROUPS.filter((g) => words.includes(g)));
  for (const h of heads) assert.match(h.querySelector('.mdl-over-n').textContent, /^\d+$/);
  assert.equal(heads.reduce((n, h) => n + Number(h.querySelector('.mdl-over-n').textContent), 0), 5, 'every step is listed');
  // Plan follows Deep thinking (its role) and sits under that heading.
  const deepHead = heads.find((h) => headingWords(h) === 'Follow Deep thinking');
  assert.equal(deepHead.querySelector('.mdl-over-n').textContent, '3');
  // Taken: disabled and says why.
  const review = itemNamed(list, 'Review');
  assert.equal(review.disabled, true);
  assert.equal(review.getAttribute('aria-disabled'), 'true');
  assert.match(review.textContent, /has its own model/);
  assert.equal(review.querySelector('.mdl-over-hint').textContent, 'has its own model');
  assert.equal(itemNamed(list, 'Plan').disabled, false);
  // A synthetic click on a taken item does nothing.
  review.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(picks, []);
  // Nothing matches.
  field.value = 'zzz';
  field.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  assert.deepEqual(visible(list, '[role="menuitem"]'), []);
  assert.deepEqual(visible(list, '.menu-h').map((h) => h.textContent), ['No step matches']);
  // "plan": only Plan and its heading, the count follows the filter.
  field.value = 'plan';
  field.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  assert.deepEqual(texts(visible(list, '[role="menuitem"]')), ['Plan']);
  assert.deepEqual(visible(list, '.menu-h').map(headingWords), ['Follow Deep thinking']);
  assert.equal(visible(list, '.menu-h')[0].querySelector('.mdl-over-n').textContent, '1');
  let at = null;
  const plan = itemNamed(list, 'Plan');
  picks.push = (id) => { at = { id, open: !!doc.querySelector('.mdl-over-pop'), focus: doc.activeElement === anchor }; };
  plan.click();
  assert.deepEqual(at, { id: 'models.claude.steps.planner', open: false, focus: true }, 'removed and refocused before onPick');
  assert.equal(doc.querySelector('.mdl-over-pop'), null);
  assert.equal(anchor.getAttribute('aria-expanded'), 'false');
});

test('5b. the override menu: keys, Escape, an outside press, the helper card has no field', () => {
  let { doc, anchor, picks, pop, handle } = openSteps();
  const field = pop.querySelector('input[type="search"]');
  key(doc, field, 'ArrowDown');
  assert.equal(doc.activeElement, visible(pop, '[role="menuitem"]').find((b) => !b.disabled), 'ArrowDown goes to the first enabled item');
  const enabled = visible(pop, '[role="menuitem"]').filter((b) => !b.disabled);
  key(doc, doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement, enabled[1]);
  key(doc, doc.activeElement, 'ArrowUp');
  assert.equal(doc.activeElement, enabled[0]);
  key(doc, doc.activeElement, 'ArrowUp');
  assert.equal(doc.activeElement, field, 'ArrowUp from the first item goes back to the field');
  assert.ok(pop.style.left && pop.style.top, 'placed at the button');
  // Escape: removed, the focus back on the button, the key stops here.
  let later = 0;
  doc.addEventListener('keydown', () => { later += 1; });
  const ev = key(doc, doc.activeElement, 'Escape');
  assert.equal(ev.defaultPrevented, true);
  assert.equal(later, 0);
  assert.equal(doc.querySelector('.mdl-over-pop'), null);
  assert.equal(doc.activeElement, anchor);
  assert.deepEqual(picks, []);
  handle.close();
  // Closed: Escape is the page's again, and the button opens it again.
  key(doc, doc, 'Escape');
  assert.equal(later, 1);
  const again = openOverrideMenu({ doc, win: doc.defaultView, anchor, section: build(SETTINGS).sections[0], onPick() {} });
  assert.ok(doc.querySelector('.mdl-over-pop'), 'a closed menu is forgotten');
  again.close();
  assert.equal(doc.querySelector('.mdl-over-pop'), null);
  // A press on its own button keeps it open; a second open on that button closes it (a toggle).
  ({ doc, anchor, pop } = openSteps());
  anchor.dispatchEvent(new doc.defaultView.MouseEvent('pointerdown', { bubbles: true }));
  assert.ok(doc.querySelector('.mdl-over-pop'));
  const steps = build(SETTINGS).sections.find((s) => s.key === 'steps');
  openOverrideMenu({ doc, win: doc.defaultView, anchor, section: steps, onPick() {} });
  assert.equal(doc.querySelector('.mdl-over-pop'), null);
  assert.equal(anchor.getAttribute('aria-expanded'), 'false');
  // Focus moving outside closes it without moving the focus back.
  ({ doc, anchor, pop } = openSteps());
  const away = doc.createElement('button');
  doc.body.append(away);
  away.focus();
  assert.equal(doc.querySelector('.mdl-over-pop'), null);
  assert.equal(doc.activeElement, away);
  // An outside press closes it without moving the focus.
  ({ doc, anchor, picks, pop } = openSteps());
  const elsewhere = doc.createElement('div');
  doc.body.append(elsewhere);
  elsewhere.dispatchEvent(new doc.defaultView.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(doc.querySelector('.mdl-over-pop'), null);
  assert.notEqual(doc.activeElement, anchor, 'the focus is not moved back to the button');
  assert.equal(anchor.getAttribute('aria-expanded'), 'false');
  // A press inside keeps it open.
  ({ doc, pop } = openSteps());
  pop.querySelector('.menu-h').dispatchEvent(new doc.defaultView.MouseEvent('pointerdown', { bubbles: true }));
  assert.ok(doc.querySelector('.mdl-over-pop'));
  // Helper jobs: no field, the focus on the first enabled item, Titles is taken.
  const vm = build(SETTINGS, 'claude', { flags: {} });
  const drawn = draw(vm);
  const hAnchor = drawn.root.querySelector('#jobs-helpers .mdl-override');
  assert.equal(hAnchor.textContent, 'Override a helper job');
  const helpers = vm.sections.find((s) => s.key === 'helpers');
  openOverrideMenu({ doc: drawn.doc, win: drawn.doc.defaultView, anchor: hAnchor, section: helpers, onPick() {} });
  const hPop = drawn.doc.querySelector('.mdl-over-pop');
  assert.equal(hPop.getAttribute('aria-label'), 'Override a helper job');
  assert.equal(hPop.querySelector('input'), null);
  assert.equal(drawn.doc.activeElement, visible(hPop, '[role="menuitem"]').find((b) => !b.disabled));
  assert.equal(itemNamed(hPop, 'Titles').disabled, true);
});

test('5c. the override menu lists the four groups in one order, whatever order its choices come in', () => {
  // The Memory defragmenter step is the one step that follows Quick jobs (model-roles.mjs QUICK_STEP_KEYS); the
  // Second-opinion reviewer, a helper job, the one choice with no role ("Use Worca's default").
  const steps = [{ key: 'memoryDefragmenter', label: 'Memory defragment' }, ...STEPS];
  const vm = build(SETTINGS, 'claude', { extra: { steps } });
  const { doc, root } = draw(vm);
  const anchor = root.querySelector('#jobs-steps .mdl-override');
  const own = vm.sections.find((s) => s.key === 'steps');
  const second = vm.sections.find((s) => s.key === 'helpers').choices.find((c) => c.group === null);
  assert.equal(second.name, 'Second-opinion reviewer');
  // Backwards: the choices meet the groups as Everyday, Deep, Quick, none.
  const choices = [second, ...own.choices].reverse();
  assert.deepEqual(choices.map((c) => c.group), ['everyday', 'deep', 'everyday', 'deep', 'deep', 'quick', null]);
  openOverrideMenu({ doc, win: doc.defaultView, anchor, section: { ...own, choices }, onPick() {} });
  const list = doc.querySelector('.mdl-over-pop [role="menu"]');
  assert.deepEqual(visible(list, '.menu-h').map(headingWords), GROUPS);
  assert.deepEqual(visible(list, '.menu-h').map((h) => h.querySelector('.mdl-over-n').textContent), ['3', '1', '2', '1']);
  // Each choice right under its own heading.
  const shown = [...list.children].filter((n) => !n.hidden).map((n) => (n.matches('.menu-h') ? `# ${headingWords(n)}` : n.firstElementChild.textContent));
  assert.deepEqual(shown, ['# Follow Deep thinking', 'Review', 'Refine', 'Plan', '# Follow Quick jobs', 'Memory defragment',
    '# Follow Everyday tasks', 'Manual tests checklist', 'Implement', "# Use Worca's default", 'Second-opinion reviewer']);
});

test('#1450: a role tile on a Worca default or "Let Claude Code decide" says so in its aria-label', () => {
  const roleDefaults = { claude: { deep: { model: 'claude-opus-5-5' }, everyday: { model: 'claude-sonnet-5-5' }, quick: { model: 'claude-haiku-4-5' } } };
  const vm = build({ runEngine: null, roleDefaults, claudeAuth: 'signed-in', modelRoles: { claude: { everyday: { cliDecides: true } } } });
  const { root } = draw(vm);
  const tile = (r) => root.querySelector(`#jobs-roles .mdl-tile[data-setting="models.claude.roles.${r}"]`);
  assert.equal(tile('deep').getAttribute('aria-label'), 'Deep thinking: Worca default · Opus 5.5');
  assert.equal(tile('everyday').getAttribute('aria-label'), 'Everyday tasks: Let Claude Code decide');
  assert.equal(tile('everyday').querySelector('.mdl-tile-name').textContent, 'Let Claude Code decide');
});
