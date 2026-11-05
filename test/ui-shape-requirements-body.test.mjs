// test/ui-shape-requirements-body.test.mjs — the Requirements step's card (ui/public/shape/requirements-body.mjs): criteria
// rows first, the decisions as one OptionList worded for the lead, Agree and plan the only primary, the empty and error
// states, and the answers it posts. The data is the mock engine's: 8 criteria over 6 prefixes and 3 decisions.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderPlanBody } from '../ui/public/shape/plan-body.mjs';
import { renderRequirementsBody } from '../ui/public/shape/requirements-body.mjs';
import { questionFocusTarget } from '../ui/public/shape/step-card.mjs';
import { _resetAnswerer } from '../ui/public/answerer.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));
const realFetch = globalThis.fetch;
beforeEach(() => { _resetAnswerer(); });
afterEach(() => { globalThis.fetch = realFetch; });

const CRITERIA = [
  ['R-po-1', 'A person can export their own runs as CSV'], ['R-po-2', 'The export names every run by its title'],
  ['R-arch-1', 'The export reads the stored runs only'], ['R-ux-1', 'The export button says what it downloads'],
  ['R-qa-1', 'A test proves the CSV columns'], ['R-sec-1', 'The export never includes secrets'],
  ['R-sec-2', 'Only project members can export'], ['R-ops-1', 'Turning the flag off removes the export'],
];
const check = (over = {}) => ({ ok: true, passed: 8, total: 8,
  items: CRITERIA.map(([id, text]) => ({ id, label: `${id} · ${text}`, pass: true })),
  criteria: CRITERIA.map(([id, text]) => ({ id, text })), ...over });
const DECISIONS = [
  { id: 'd-1', text: 'Email in export', options: [{ value: 'leave-out', label: 'Leave them out' }, { value: 'include', label: 'Include them' }],
    recommended: 'leave-out', criteria: ['R-sec-1'], from: ['security', 'ux'] },
  { id: 'd-2', text: 'Who may export: everyone with project:read?', plain: 'Who may export: everyone who can see the project?',
    options: [{ value: 'members', label: 'Require project:read', plain: 'Anyone who can see the project' }, { value: 'owner', label: 'Owner only' }],
    recommended: 'members', criteria: ['R-sec-2'], from: ['security'] },
  { id: 'd-3', text: 'Gate the export on project:read or project:write',
    options: [{ value: 'read', label: 'project:read' }, { value: 'write', label: 'project:write' }], recommended: 'read' },
];
const ask = (over = {}) => ({ id: 'q-req-1', kind: 'plan', nodeId: 'requirements', executionId: 'e1',
  plan: { file: '/x/requirements.md', round: 1, revisable: true, nodeId: 'requirements', criteria: check(), decisions: DECISIONS, lead: 'product', ...over } });

function setup({ pq = ask(), submit } = {}) {
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  const root = doc.createElement('div');
  root.appendChild(panel);
  doc.body.appendChild(root);
  const calls = { submit: [] };
  const deps = { doc, run: {}, extras: true, fetchPlan: async () => null, title: 'Your turn: agree the requirements', chip: 'Requirements',
    submit: submit ? (p) => { calls.submit.push(p); return submit(p, panel); } : async (p) => { calls.submit.push(p); return true; } };
  renderPlanBody(panel, pq, deps);
  return { panel, root, calls, $: (s) => panel.querySelector(s), $$: (s) => [...panel.querySelectorAll(s)] };
}
const keyOn = (el, key) => { const e = new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };
const text = (panel) => panel.textContent;

test('a requirements ask is dispatched from renderPlanBody; the plan ask is not', () => {
  const r = setup();
  assert.ok(r.$('.shape-reqs'), 'the requirements body');
  assert.equal(r.$('.ask-mcard-title').textContent, 'Your turn: agree the requirements');
  assert.equal(r.$('.ask-mcard-kind').textContent, 'Requirements');
  const plain = setup({ pq: { id: 'p', kind: 'plan', plan: { round: 1, revisable: true } } });
  assert.equal(plain.$('.shape-reqs'), null);
  assert.ok(plain.$('.plan-body'));
});

test('R-ux-2: the sub line states both counts; the criteria rows come before the first decision, unfolded, with no tab stop', () => {
  const { $, $$, panel } = setup();
  assert.equal($('.plan-sub').textContent, '8 agreed by the perspectives · 3 need you · as Product');
  const rows = $$('.plan-check-row');
  assert.equal(rows.length, 8);
  assert.equal(rows[0].querySelector('.plan-check-label').textContent, 'R-po-1 · A person can export their own runs as CSV');
  assert.equal($('.plan-checks').hidden, false);
  assert.equal($$('.plan-checks :is(button, [tabindex])').length, 0);
  const firstQ = $('.chat-rc-q');
  assert.equal(rows[7].compareDocumentPosition(firstQ) & 4, 4, 'rows precede the decisions');
  assert.equal($('.chat-rc-q-head').textContent, '3 need you');
  assert.equal($$('.qblock').length, 3);
  assert.equal(panel.querySelector('.qpanel-foot.plan-actions') !== null, true);
});

test('the sub line: "none need you" at 0 decisions and no OptionList; no "as" without a known lead', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ lead: null }) });
  const r = setup({ pq: ask({ decisions: [], lead: undefined }) });
  await flush();
  assert.equal(r.$('.plan-sub').textContent, '8 agreed by the perspectives · none need you');
  assert.equal(r.$('.chat-rc-q'), null);
  assert.equal(r.$('.qanswered'), null, 'no picks hint without decisions');
});

test('R-ux-3/4: Worca\'s pick is pre-picked, marked recommended and data-preset; a person re-picking it removes only data-preset', () => {
  const { $, $$ } = setup();
  const t = (q, v) => $(`[data-q="${q}"] .qopt[data-value="${v}"]`);
  assert.deepEqual([t('d-1', 'leave-out').getAttribute('aria-pressed'), t('d-1', 'leave-out').dataset.preset, t('d-1', 'leave-out').querySelector('.qrec')?.textContent],
    ['true', '1', 'recommended']);
  assert.equal(t('d-1', 'include').querySelector('.qrec'), null);
  assert.deepEqual($$('.qopts').map((g) => g.getAttribute('aria-label').length > 0), [true, true, true]);
  const before = t('d-1', 'leave-out').cloneNode(true);
  t('d-1', 'leave-out').click();
  before.removeAttribute('data-preset');
  assert.equal(t('d-1', 'leave-out').outerHTML, before.outerHTML);
  assert.equal(t('d-2', 'members').dataset.preset, '1');
});

test('Agree and plan is the only primary and posts every pick; a changed pick is sent as picked', async () => {
  const { $, $$, calls } = setup();
  assert.equal($$('.btn-primary').length, 1);
  assert.equal($('.btn-primary').textContent, 'Agree and plan');
  assert.equal($('.qanswered').textContent, 'Worca\'s picks marked · change any');
  assert.equal($('.plan-ask-changes').className.includes('btn-quiet'), true);
  $('.plan-approve').click();
  await flush();
  assert.deepEqual(calls.submit, [{ decision: 'approve', decisions: { 'd-1': 'leave-out', 'd-2': 'members', 'd-3': 'read' } }]);
  const again = setup();
  again.$('[data-q="d-2"] .qopt[data-value="owner"]').click();
  again.$('.plan-approve').click();
  await flush();
  assert.equal(again.calls.submit[0].decisions['d-2'], 'owner');
});

test('Ask for changes opens the typed row; Send changes posts revise with the picks; empty text posts nothing', async () => {
  const { $, calls } = setup();
  assert.equal($('.plan-typed').hidden, true);
  $('.plan-ask-changes').click();
  assert.equal($('.plan-typed').hidden, false);
  assert.equal($('.plan-feedback').getAttribute('aria-label'), 'Changes to the requirements');
  $('.plan-revise').click();
  assert.equal(calls.submit.length, 0);
  assert.equal($('.plan-err').textContent, 'Write what should change first');
  $('.plan-feedback').value = 'Also cover XLSX';
  $('.plan-revise').click();
  await flush();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: 'Also cover XLSX', decisions: { 'd-1': 'leave-out', 'd-2': 'members', 'd-3': 'read' } }]);
});

test('R-ux-6: 0 criteria shows the empty state; Agree and plan is aria-disabled, explained, and posts nothing', async () => {
  const { $, calls } = setup({ pq: ask({ criteria: check({ total: 0, passed: 0, items: [], criteria: [] }), decisions: [] }) });
  assert.equal($('.plan-sub').textContent, '0 agreed by the perspectives · none need you · as Product');
  assert.equal($('.empty-line .el-t').textContent, 'No requirements were written.');
  assert.equal($('.plan-check-row'), null);
  const agree = $('.plan-approve');
  assert.equal(agree.getAttribute('aria-disabled'), 'true');
  assert.equal(agree.title, 'Nothing to agree yet: ask for changes');
  assert.equal($('.qanswered').textContent, 'Nothing to agree yet: ask for changes');
  assert.equal(agree.getAttribute('aria-describedby'), $('.qanswered').id);
  agree.click();
  await flush();
  assert.equal(calls.submit.length, 0);
});

test('a failing criteria check keeps the ✕ rows and blocks Agree and plan with the count', async () => {
  const bad = check({ ok: false, passed: 7, total: 8 });
  bad.items[7] = { id: 'R-ops-1', label: 'R-ops-1 · listed twice', pass: false };
  const { $, $$, calls } = setup({ pq: ask({ criteria: bad }) });
  assert.equal($$('.plan-check-row:not(.ok)').length, 1);
  assert.equal($('.plan-approve').getAttribute('aria-disabled'), 'true');
  assert.equal($('.qanswered').textContent, '1 to fix: ask for changes');
  $('.plan-approve').click();
  await flush();
  assert.equal(calls.submit.length, 0);
  assert.equal($('.plan-ask-changes').hidden, false, 'Ask for changes is the way on');
});

test('R-ux-6: plan.error shows the error state; Try again is the primary and posts retry; there is no Agree and plan', async () => {
  const { $, $$, calls } = setup({ pq: ask({ criteria: undefined, decisions: [], error: { message: 'requirements.md was not written' } }) });
  assert.equal($('.empty-line.is-err .el-t').textContent, 'Could not load the requirements.');
  assert.match($('.empty-line.is-err').textContent, /requirements\.md was not written/);
  assert.equal($('.plan-approve'), null);
  assert.equal($('.plan-check-row'), null);
  assert.equal($$('.btn-primary').length, 1);
  assert.equal($('.btn-primary').textContent, 'Try again');
  assert.ok($('.plan-ask-changes'));
  $('.btn-primary').click();
  await flush();
  assert.deepEqual(calls.submit, [{ decision: 'retry' }]);
  const locked = setup({ pq: ask({ criteria: undefined, decisions: [], error: { message: 'x' }, revisable: false }) });
  assert.equal(locked.$('.plan-ask-changes'), null);
});

test('R-qa-7: a product lead never sees project:read in a question or an option; plain twins win', () => {
  const { panel, $$ } = setup({ pq: ask({ lead: 'product' }) });
  const shown = [...panel.querySelectorAll('.qtext-t, .chat-q-opt-label, .qopts')].map((e) => e.textContent + (e.getAttribute('aria-label') || '')).join('\n');
  assert.doesNotMatch(shown, /project:read|project:write/);
  assert.equal($$('.qtext-t')[1].textContent, 'Who may export: everyone who can see the project?');
  assert.equal($$('[data-q="d-2"] .chat-q-opt-label')[0].textContent, 'Anyone who can see the project');
  assert.equal($$('[data-q="d-3"] .chat-q-opt-label')[0].textContent, 'Option 1');
});

test('plan.lead architect: decision 3 keeps its label as written', () => {
  const { $, $$ } = setup({ pq: ask({ lead: 'architect' }) });
  assert.equal($$('[data-q="d-3"] .chat-q-opt-label')[0].textContent, 'project:read');
  assert.equal($$('.qtext-t')[1].textContent, 'Who may export: everyone with project:read?');
  assert.match($('.plan-sub').textContent, /as Engineering$/);
});

test('I4: with no plan.lead, no decision paints before the profile answers; then the profile\'s lead words them', async () => {
  let answer;
  globalThis.fetch = (url) => new Promise((res) => { answer = () => res({ ok: true, status: 200, json: async () => ({ lead: 'product' }) }); });
  const r = setup({ pq: ask({ lead: undefined }) });
  await flush();
  assert.equal(r.$('.chat-rc-q'), null, 'no question text yet');
  assert.doesNotMatch(text(r.panel), /project:read|Email in export/);
  assert.equal(r.$$('.plan-check-row').length, 8, 'the criteria rows do not wait');
  assert.equal(r.$('.plan-approve').getAttribute('aria-disabled'), 'true', 'nothing to agree to before the decisions show');
  answer();
  await flush(); await flush();
  assert.equal(r.$$('.qblock').length, 3);
  assert.doesNotMatch(text(r.panel), /project:read/);
  assert.equal(r.$('.plan-approve').hasAttribute('aria-disabled'), false);
  assert.match(r.$('.plan-sub').textContent, /as Product$/);
});

test('while the profile loads, Agree and plan says Loading your role… (note, title, describedby) and posts nothing', async () => {
  _resetAnswerer({ timeoutMs: 50 });
  globalThis.fetch = () => new Promise(() => {});
  const r = setup({ pq: ask({ lead: undefined }) });
  const agree = r.$('.plan-approve');
  assert.equal(agree.getAttribute('aria-disabled'), 'true');
  assert.equal(r.$('.qanswered').textContent, 'Loading your role…');
  assert.equal(agree.title, 'Loading your role…');
  assert.equal(agree.getAttribute('aria-describedby'), r.$('.qanswered').id);
  agree.click();
  await flush();
  assert.equal(r.calls.submit.length, 0);
  await new Promise((res) => setTimeout(res, 70));
});

test('a profile that times out or fails words the decisions plainly, with no \'as\', and unblocks Agree and plan', async () => {
  for (const [name, arrange] of [
    ['timeout', () => { _resetAnswerer({ timeoutMs: 20 }); globalThis.fetch = () => new Promise(() => {}); }],
    ['failure', () => { _resetAnswerer(); globalThis.fetch = async () => { throw new Error('offline'); }; }],
  ]) {
    arrange();
    const r = setup({ pq: ask({ lead: undefined }) });
    await new Promise((res) => setTimeout(res, 40));
    assert.equal(r.$$('.qblock').length, 3, `${name}: the decisions paint once`);
    assert.doesNotMatch(text(r.panel), /project:read/, name);
    assert.equal(r.$$('.qtext-t')[1].textContent, 'Who may export: everyone who can see the project?', name);
    assert.doesNotMatch(r.$('.plan-sub').textContent, / as /, name);
    const agree = r.$('.plan-approve');
    assert.equal(agree.hasAttribute('aria-disabled'), false, name);
    assert.equal(agree.hasAttribute('title'), false, name);
    assert.equal(r.$('.qanswered').textContent, 'Worca\'s picks marked · change any', name);
  }
});

test('0 agreed criteria with failing checks shows the ✕ rows, not the empty state, and blocks with \'N to fix\'', () => {
  const bad = check({ ok: false, passed: 0, total: 1, items: [{ id: 'R-ops-1', label: 'R-ops-1 · listed twice', pass: false }], criteria: [] });
  const { $, $$ } = setup({ pq: ask({ criteria: bad, decisions: [] }) });
  assert.equal($('.empty-line'), null);
  assert.equal($$('.plan-check-row:not(.ok)').length, 1);
  assert.equal($('.plan-approve').getAttribute('aria-disabled'), 'true');
  assert.equal($('.qanswered').textContent, '1 to fix: ask for changes');
});

test('the "why" line: two roles disagree, one role by its label, "your area" when it is the lead\'s', () => {
  const { $$ } = setup({ pq: ask({ lead: 'security' }) });
  assert.deepEqual($$('.qwhy').map((e) => e.textContent), ['Security and Design disagree', 'Security · your area']);
});

test('OptionList keys: ←/→ move and pick, Home/End jump, a letter picks, Enter picks and never posts', async () => {
  const { $$, $, calls } = setup();
  const tiles = $$('[data-q="d-1"] .qopt');
  tiles[0].focus();
  keyOn(tiles[0], 'ArrowRight');
  assert.equal(tiles[1].getAttribute('aria-pressed'), 'true');
  keyOn(tiles[1], 'Home');
  assert.equal(tiles[0].getAttribute('aria-pressed'), 'true');
  keyOn(tiles[0], 'End');
  assert.equal(tiles[1].getAttribute('aria-pressed'), 'true');
  keyOn(tiles[1], 'a');
  assert.equal(tiles[0].getAttribute('aria-pressed'), 'true');
  keyOn(tiles[0], 'Enter');
  await flush();
  assert.equal(calls.submit.length, 0);
  assert.equal($('.qpanel-foot.plan-actions').parentElement.classList.contains('plan-body'), true);
});

test('the focus target is Agree and plan, not a tile or the nested panel', () => {
  const { root, $ } = setup();
  assert.equal(questionFocusTarget(root), $('.plan-approve'));
});

test('a 422 on decisions.d-2 shows its message in the requirements card\'s plan-err', () => {
  const { panel, $ } = setup();
  panel.__plan.setErrors([{ path: 'decisions.d-2', message: 'Pick one of the listed options' }]);
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').textContent, 'Pick one of the listed options');
  panel.__plan.setErrors([]);
  assert.equal($('.plan-err').hidden, true);
});

test('a 422 through Agree and plan keeps the field message; a second click sends again', async () => {
  // app.js postAnswer's 422 branch: paint the field errors through the plan renderer, then resolve false
  const { $, calls } = setup({ submit: async (p, panel) => {
    panel.__plan.setErrors([{ path: 'decisions.d-2', message: 'Pick one of the listed options' }]);
    return false;
  } });
  $('.plan-approve').click();
  await flush();
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').textContent, 'Pick one of the listed options');
  $('.plan-approve').click();
  await flush();
  assert.equal(calls.submit.length, 2, 'the busy guard released');
});

test('renderRequirementsBody announces itself like the plan card: step-primary on build, plan-answer on a send', async () => {
  const panel = doc.createElement('div');
  const seen = [];
  panel.addEventListener('step-primary', () => seen.push('step-primary'));
  panel.addEventListener('plan-answer', (e) => seen.push(e.detail.decision));
  renderRequirementsBody(panel, ask(), { doc, run: {}, title: 't', chip: 'c', submit: async () => true });
  panel.querySelector('.plan-approve').click();
  await flush();
  assert.deepEqual(seen, ['step-primary', 'approve']);
});

test('a requirements ask that cannot be revised gives the blocked reason without the ask-for-changes hint', () => {
  const { $ } = setup({ pq: ask({ revisable: false, criteria: check({ total: 0, passed: 0, items: [], criteria: [] }), decisions: [] }) });
  assert.equal($('.plan-ask-changes'), null);
  assert.equal($('.plan-approve').title, 'Nothing to agree yet');
});

/** Every member of every selector list in `css` that fades aria-disabled on a bare .btn / .btn-primary. */
const globalFades = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').split('{').slice(0, -1)
  .flatMap((chunk) => chunk.slice(chunk.lastIndexOf('}') + 1).split(','))
  .map((m) => m.trim())
  .filter((m) => /^\.btn(-primary)?\[aria-disabled="true"\](:hover)?$/.test(m));

test('the aria-disabled fade is scoped to the Shaper requirements buttons, not every .btn', () => {
  const css = readFileSync(new URL('../ui/public/design-system/buttons-component.css', import.meta.url), 'utf8');
  assert.deepEqual(globalFades(css), []);
  assert.match(css, /\.shape-reqs \.btn\[aria-disabled="true"\]\{opacity:\.45/);
  assert.deepEqual(globalFades('.x,.btn[aria-disabled="true"]{opacity:.45}'), ['.btn[aria-disabled="true"]'], 'the comma form is caught');
});

test('requirements-body does not import plan-body (no cycle)', () => {
  const src = readFileSync(new URL('../ui/public/shape/requirements-body.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\/plan-body\.mjs'/);
  assert.match(src, /import \{ buildFeedbackRow \} from '\.\/feedback-row\.mjs'/);
});
