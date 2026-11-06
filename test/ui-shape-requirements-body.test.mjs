// test/ui-shape-requirements-body.test.mjs — the Requirements step's card (ui/public/shape/requirements-body.mjs): the
// decisions first, as one OptionList worded for the lead with each answer's persona and reason, then the agreed requirements
// folded by persona, one primary at a time, the empty and error states, and the answers it posts. The data is the mock
// engine's: 8 criteria over 6 prefixes and 3 decisions.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderPlanBody } from '../ui/public/shape/plan-body.mjs';
import { renderRequirementsBody } from '../ui/public/shape/requirements-body.mjs';
import { answerFieldOpen, questionFocusTarget } from '../ui/public/shape/step-card.mjs';
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
const visible = (e) => !e.closest('[hidden]');
const twoOptions = (a, b) => [{ id: 'd-1', text: 'One', options: [{ value: 'a', label: 'A', ...a }, { value: 'b', label: 'B', ...b }], recommended: 'a' }];
const dts = ($$) => $$('.shape-reqs-agreed > dt').map((e) => e.textContent);
const FOLD = '.plan-check-line .plan-fold-text';
/** The check with these extra items, in criteriaCheck's shape (a passing row per criterion, then the failing ones). */
const failingCheck = (...items) => {
  const c = check({ ok: false });
  c.items.push(...items.map(([id, words]) => ({ id, label: `${id} · ${words}`, pass: false })));
  return c;
};

test('a requirements ask is dispatched from renderPlanBody; the plan ask is not', () => {
  const r = setup();
  assert.ok(r.$('.shape-reqs'), 'the requirements body');
  assert.equal(r.$('.ask-mcard-title').textContent, 'Your turn: agree the requirements');
  assert.equal(r.$('.ask-mcard-kind').textContent, 'Requirements');
  const plain = setup({ pq: { id: 'p', kind: 'plan', plan: { round: 1, revisable: true } } });
  assert.equal(plain.$('.shape-reqs'), null);
  assert.ok(plain.$('.plan-body'));
});

test('R-ux-2: decisions come before the agreed fold, which starts folded, with no tab stop in its rows', () => {
  const { $, $$, panel } = setup();
  const firstQ = $('.chat-rc-q');
  const line = $('.plan-check-line');
  assert.equal(firstQ.compareDocumentPosition(line) & 4, 4, 'decisions precede the fold');
  assert.equal(line.nextElementSibling, $('.plan-checks'));
  assert.equal($('.plan-sub').compareDocumentPosition(firstQ) & 4, 4, 'the sub line precedes the decisions');
  assert.equal($('.plan-checks').compareDocumentPosition($('.qpanel-foot.plan-actions')) & 4, 4, 'the foot is last');
  assert.equal($$('.plan-check-row').length, 8);
  assert.equal($('.plan-checks').hidden, true);
  assert.equal($$('.plan-checks :is(button, [tabindex])').length, 0);
  assert.equal($$('.qblock').length, 3);
  assert.equal(panel.querySelector('.qpanel-foot.plan-actions') !== null, true);
});

test('sub line: 3 decisions need you · as Product; 1 decision needs you; No decisions need you; no agreed count', async () => {
  assert.equal(setup().$('.plan-sub').textContent, '3 decisions need you · as Product');
  assert.equal(setup({ pq: ask({ decisions: DECISIONS.slice(0, 1) }) }).$('.plan-sub').textContent, '1 decision needs you · as Product');
  assert.equal(setup({ pq: ask({ decisions: [] }) }).$('.plan-sub').textContent, 'No decisions need you · as Product');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ lead: null }) });
  const r = setup({ pq: ask({ decisions: [], lead: undefined }) });
  await flush();
  assert.equal(r.$('.plan-sub').textContent, 'No decisions need you');
  assert.doesNotMatch(r.$('.plan-sub').textContent, /agreed/);
  assert.equal(r.$('.chat-rc-q'), null);
  assert.equal(r.$('.qanswered'), null, 'no note without a reason for one');
});

test('decisions: no heading or disc, section named Decisions, no question numbers; preset and recommended kept', () => {
  const { $, $$ } = setup();
  assert.equal($('.chat-rc-q-head'), null);
  assert.equal($('.chat-rc-q').getAttribute('aria-label'), 'Decisions');
  assert.equal($('.chat-rc-q').hasAttribute('aria-labelledby'), false);
  assert.equal($('.qn'), null);
  assert.equal($$('.qopt[data-preset="1"]').length, 3);
  assert.equal($$('.qrec').length, 3);
});

test('an answer shows Persona: reason; a name alone; a reason alone; one line with neither; a code-only reason counts as none', () => {
  const subs = (decisions, lead = 'product') => setup({ pq: ask({ decisions, lead }) }).$$('.qopt').map((t) => t.querySelector('.chat-q-opt-sub')?.textContent ?? null);
  assert.deepEqual(subs(twoOptions({ persona: 'security', reason: 'emails are personal data' }, { persona: 'ux' })), ['Security: emails are personal data', 'Design']);
  assert.deepEqual(subs(twoOptions({ reason: 'it is simpler' }, {})), ['it is simpler', null]);
  assert.deepEqual(subs(twoOptions({ persona: 'security', reason: '`foo_bar()`' }, { reason: '`foo_bar()`' })), ['Security', null]);
  assert.deepEqual(subs(twoOptions({ persona: 'security', reason: '`foo_bar()`' }, { reason: '`foo_bar()`' }), 'architect'), ['Security', null], 'for every lead');
  assert.deepEqual(subs(twoOptions({ persona: 'not-a-key', reason: 'x' }, {})), ['not-a-key: x', null], 'an unknown key shows as written');
});

test('reasons follow lead wording: Product reads read access and Engineering project:read; the label never repeats as the reason', () => {
  const data = twoOptions({ plain: 'Anyone who can see it', persona: 'security', reason: 'only project:read is enough' }, {});
  const sub = (lead) => setup({ pq: ask({ decisions: data, lead }) }).$('.chat-q-opt-sub').textContent;
  assert.equal(sub('product'), 'Security: only read access is enough');
  assert.equal(sub('architect'), 'Security: only project:read is enough');
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
  assert.deepEqual($$('.btn-primary').filter(visible).map((b) => b.textContent), ['Agree and plan']);
  assert.deepEqual([$('.qanswered').hidden, $('.qanswered').textContent], [true, ''], 'the picks note is gone');
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
  assert.equal($('.plan-sub').textContent, 'No decisions need you · as Product');
  assert.equal($('.plan-check-line'), null, 'no fold');
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

test('a failing id: 7 agreed · 1 to fix, opens by itself, its persona first with detail, Ask for changes primary, Agree plain, blocked and explained, no visible note', async () => {
  const { $, $$, calls, root } = setup({ pq: ask({ criteria: failingCheck(['R-ops-1', 'listed twice']) }) });
  assert.equal($(FOLD).textContent, '7 agreed · 1 to fix · Product 2 · Engineering 1 · Design 1 · QA 1 · Security 2 · DevOps 1');
  const counts = $(FOLD).textContent.split(' · ').slice(2).map((part) => Number(part.split(' ').pop()));
  assert.equal(counts.reduce((a, n) => a + n, 0), 7 + 1, 'the persona counts sum to agreed + failing');
  assert.deepEqual([$('.plan-check-line').getAttribute('aria-expanded'), $('.plan-checks').hidden], ['true', false]);
  assert.deepEqual(dts($$), ['DevOps', 'Product', 'Engineering', 'Design', 'QA', 'Security']);
  const rows = $$('.plan-check-row');
  assert.equal(rows.length, 8, 'one id is one row');
  assert.deepEqual([rows[0].classList.contains('ok'), rows[0].querySelector('.plan-check-label').textContent, rows[0].querySelector('.plan-check-detail').textContent],
    [false, 'Turning the flag off removes the export', 'listed twice']);
  assert.equal($$('.plan-check-row:not(.ok)').length, 1);
  const ask_ = $('.plan-ask-changes');
  const agree = $('.plan-approve');
  assert.equal(ask_.classList.contains('btn-primary'), true);
  assert.equal(ask_.classList.contains('btn-quiet'), false);
  assert.equal(agree.classList.contains('btn-primary'), false);
  assert.equal($$('.btn-primary').filter(visible).length, 1);
  assert.deepEqual([agree.getAttribute('aria-disabled'), agree.title], ['true', '1 to fix: ask for changes']);
  assert.deepEqual([$('.qanswered').hidden, $('.qanswered').textContent], [true, '1 to fix: ask for changes'], 'hidden, still the description');
  assert.equal(agree.getAttribute('aria-describedby'), $('.qanswered').id);
  assert.equal(questionFocusTarget(root), ask_);
  agree.click();
  await flush();
  assert.equal(calls.submit.length, 0);
  assert.equal(ask_.hidden, false, 'Ask for changes is the way on');
});

test('failing rows: details of one id join; failing rows lead their group; the lead stays after a failing persona; a lost id keeps its id as the label', () => {
  const lost = failingCheck(['R-sec-2', 'listed twice'], ['R-sec-2', 'more than 6 for one perspective'], ['R-po-3', 'agreed in the spec but missing']);
  const { $, $$ } = setup({ pq: ask({ criteria: lost, lead: 'qa' }) });
  assert.match($(FOLD).textContent, /^7 agreed · 2 to fix · QA 1 · Product 3 · Engineering 1 · Design 1 · Security 2 · DevOps 1$/);
  assert.deepEqual(dts($$), ['Product', 'Security', 'QA', 'Engineering', 'Design', 'DevOps'], 'a failing persona comes before the lead\'s; the fold line keeps the lead first');
  const groups = $$('.shape-reqs-agreed > dd');
  const po = [...groups[0].querySelectorAll('.plan-check-row')];
  assert.deepEqual([po[0].querySelector('.plan-check-label').textContent, po[0].querySelector('.plan-check-detail').textContent, po[0].hasAttribute('title'), po[0].querySelector('.sr-only')],
    ['R-po-3', 'agreed in the spec but missing', false, null]);
  const sec = [...groups[1].querySelectorAll('.plan-check-row')];
  assert.deepEqual(sec.map((r) => r.querySelector('.plan-check-label').textContent), ['Only project members can export', 'The export never includes secrets']);
  assert.equal(sec[0].querySelector('.plan-check-detail').textContent, 'listed twice · more than 6 for one perspective');
});

test('revisable:false failing: 1 to fix stays visible as text, no primary, click posts nothing', async () => {
  const { $, $$, calls } = setup({ pq: ask({ revisable: false, criteria: failingCheck(['R-ops-1', 'listed twice']) }) });
  assert.equal($('.plan-ask-changes'), null);
  assert.equal($$('.btn-primary').length, 0);
  const agree = $('.plan-approve');
  assert.deepEqual([agree.getAttribute('aria-disabled'), agree.title], ['true', '1 to fix']);
  assert.deepEqual([$('.qanswered').hidden, $('.qanswered').textContent], [false, '1 to fix']);
  agree.click();
  await flush();
  assert.equal(calls.submit.length, 0);
});

test('fold line reads 8 agreed · Product 2 · … · DevOps 1, folded by default', () => {
  const { $ } = setup();
  assert.equal($(FOLD).textContent, '8 agreed · Product 2 · Engineering 1 · Design 1 · QA 1 · Security 2 · DevOps 1');
  assert.deepEqual([$('.plan-check-line').getAttribute('aria-expanded'), $('.plan-checks').hidden], ['false', true]);
  $('.plan-check-line').click();
  assert.deepEqual([$('.plan-check-line').getAttribute('aria-expanded'), $('.plan-checks').hidden], ['true', false]);
});

test('fold unfolded: a dl of persona then rows, lead\'s persona first, and it reorders when the lead loads without closing', async () => {
  const known = setup({ pq: ask({ lead: 'security' }) });
  assert.equal(known.$('.plan-checks > dl.shape-reqs-agreed').tagName, 'DL');
  assert.deepEqual(dts(known.$$), ['Security', 'Product', 'Engineering', 'Design', 'QA', 'DevOps']);
  assert.deepEqual(known.$$('.shape-reqs-agreed > dd').map((d) => d.querySelectorAll('.plan-check-row').length), [2, 2, 1, 1, 1, 1]);
  assert.match(known.$(FOLD).textContent, /^8 agreed · Security 2 · Product 2/);

  let answer;
  globalThis.fetch = () => new Promise((res) => { answer = () => res({ ok: true, status: 200, json: async () => ({ lead: 'qa' }) }); });
  const late = setup({ pq: ask({ lead: undefined }) });
  await flush();
  assert.deepEqual(dts(late.$$), ['Product', 'Engineering', 'Design', 'QA', 'Security', 'DevOps'], 'no lead yet: first appearance');
  late.$('.plan-check-line').click();
  answer();
  await flush(); await flush();
  assert.deepEqual(dts(late.$$)[0], 'QA');
  assert.match(late.$(FOLD).textContent, /^8 agreed · QA 1 · Product 2/);
  assert.deepEqual([late.$('.plan-check-line').getAttribute('aria-expanded'), late.$('.plan-checks').hidden], ['true', false], 'stays open');
});

test('a row\'s label has no R- id; its title and sr-only span do', () => {
  const { $$ } = setup();
  const [row] = $$('.plan-check-row');
  assert.equal(row.querySelector('.plan-check-label').textContent, 'A person can export their own runs as CSV');
  assert.equal(row.title, 'R-po-1');
  assert.equal(row.querySelector('.sr-only').textContent, 'R-po-1');
  assert.equal($$('.plan-check-label').some((l) => /R-[a-z]+-\d/.test(l.textContent)), false);
});

test('an unknown prefix groups under Other, last; an item with no id too; persona counts add up', () => {
  const c = check();
  c.items.unshift({ id: 'R-zzz-1', label: 'R-zzz-1 · Odd one', pass: true }, { label: 'No id at all', pass: true });
  const { $, $$ } = setup({ pq: ask({ criteria: c, lead: 'ux' }) });
  assert.equal($(FOLD).textContent, '10 agreed · Design 1 · Product 2 · Engineering 1 · QA 1 · Security 2 · DevOps 1 · Other 2');
  assert.deepEqual(dts($$).at(-1), 'Other');
  const other = [...$$('.shape-reqs-agreed > dd').at(-1).querySelectorAll('.plan-check-row')];
  assert.deepEqual(other.map((r) => [r.querySelector('.plan-check-label').textContent, r.title]), [['Odd one', 'R-zzz-1'], ['No id at all', '']]);
  const counts = $(FOLD).textContent.split(' · ').slice(1).map((p) => Number(p.split(' ').at(-1)));
  assert.equal(counts.reduce((a, b) => a + b, 0), 10);
  assert.equal($$('.plan-check-row').length, 10, 'nothing is dropped');
});

test('Ask for changes open: Send changes the only primary, foot hidden, a 422 message visible; Cancel brings the foot back and focuses the button', () => {
  for (const pq of [ask(), ask({ criteria: failingCheck(['R-ops-1', 'listed twice']) })]) {
    const { $, $$, panel } = setup({ pq });
    const foot = $('.qpanel-foot.plan-actions');
    const opener = $('.plan-ask-changes');
    opener.click();
    assert.equal(foot.hidden, true);
    assert.equal($('.plan-typed').hidden, false);
    assert.deepEqual($$('.btn-primary').filter(visible).map((b) => b.textContent), ['Send changes']);
    assert.equal(doc.activeElement, $('.plan-feedback'));
    panel.__plan.setErrors([{ path: 'decisions.d-2', message: 'Pick one of the listed options' }]);
    assert.equal(visible($('.plan-err')), true);
    let footAtFocus = null;
    opener.addEventListener('focus', () => { footAtFocus = foot.hidden; });
    $('.plan-typed-cancel').click();
    assert.deepEqual([foot.hidden, $('.plan-typed').hidden, opener.hidden, footAtFocus, doc.activeElement === opener], [false, true, false, false, true]);
    assert.equal($$('.btn-primary').filter(visible).length, 1);
  }
});

test('Ask for changes open: the card tells its host, and the question focus goes to the field, never the hidden foot', () => {
  for (const pq of [ask(), ask({ criteria: failingCheck(['R-ops-1', 'listed twice']) })]) {
    const { $, panel, root } = setup({ pq });
    const told = [];
    panel.addEventListener('step-primary', () => told.push($('.qpanel-foot.plan-actions').hidden));
    assert.equal(answerFieldOpen(root), false);
    $('.plan-ask-changes').click();
    assert.equal(answerFieldOpen(root), true);
    assert.equal(questionFocusTarget(root), $('.plan-feedback'));
    $('.plan-typed-cancel').click();
    assert.equal(answerFieldOpen(root), false);
    assert.deepEqual(told, [true, false], 'one repaint per change, after the foot has changed');
  }
});

test('an id listed three times says so once', () => {
  const { $ } = setup({ pq: ask({ criteria: failingCheck(['R-ops-1', 'listed twice'], ['R-ops-1', 'listed twice']) }) });
  assert.equal($('.plan-check-row:not(.ok) .plan-check-detail').textContent, 'listed twice');
});

test('R-ux-6: plan.error shows the error state; Try again is the primary and posts retry; there is no Agree and plan', async () => {
  const { $, $$, calls } = setup({ pq: ask({ criteria: undefined, decisions: [], error: { message: 'requirements.md was not written' } }) });
  assert.equal($('.empty-line.is-err .el-t').textContent, 'Could not load the requirements.');
  assert.match($('.empty-line.is-err').textContent, /requirements\.md was not written/);
  assert.equal($('.plan-approve'), null);
  assert.equal($('.plan-check-row'), null);
  assert.deepEqual($$('.btn-primary').filter(visible).map((b) => b.textContent), ['Try again']);
  assert.ok($('.plan-ask-changes'));
  $('.plan-retry').click();
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
  assert.equal($$('.qtext-t')[2].textContent, 'Gate the export on read access or write access');
  assert.equal($$('[data-q="d-3"] .chat-q-opt-label')[0].textContent, 'Read access');
  assert.equal($$('[data-q="d-3"] .chat-q-opt-label')[1].textContent, 'Write access');
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
    assert.deepEqual([r.$('.qanswered').hidden, r.$('.qanswered').textContent], [true, ''], name);
  }
});

test('0 agreed criteria with failing checks shows the ✕ rows, not the empty state, and blocks with \'N to fix\'', () => {
  const bad = check({ ok: false, passed: 0, total: 1, items: [{ id: 'R-ops-1', label: 'R-ops-1 · listed twice', pass: false }], criteria: [] });
  const { $, $$ } = setup({ pq: ask({ criteria: bad, decisions: [] }) });
  assert.equal($('.empty-line'), null);
  assert.equal($$('.plan-check-row:not(.ok)').length, 1);
  assert.equal($(FOLD).textContent, '0 agreed · 1 to fix · DevOps 1');
  assert.equal($('.plan-check-label').textContent, 'R-ops-1');
  assert.equal($('.plan-check-detail').textContent, 'listed twice');
  assert.equal($('.plan-approve').getAttribute('aria-disabled'), 'true');
  assert.equal($('.qanswered').textContent, '1 to fix: ask for changes');
});

test('a decision with no per-option data keeps the whyOf line; one with a persona or a reason drops it', () => {
  const { $$ } = setup({ pq: ask({ lead: 'security' }) });
  assert.deepEqual($$('.qwhy').map((e) => e.textContent), ['Security and Design disagree', 'Security · your area']);
  const from = { from: ['security', 'ux'] };
  for (const extra of [{ persona: 'security' }, { reason: 'because' }]) {
    const r = setup({ pq: ask({ decisions: [{ ...twoOptions({}, extra)[0], ...from }] }) });
    assert.equal(r.$('.qwhy'), null);
  }
  assert.equal(setup({ pq: ask({ decisions: [{ ...twoOptions({}, {})[0], ...from }] }) }).$('.qblock .chat-q-opt-sub'), null, 'no sub line either');
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

test('the card\'s CSS: every new rule is under .shape-reqs and stacks with the .chat-q.chat-rc-q prefix', () => {
  const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.split('{').slice(0, -1).flatMap((c) => c.slice(c.lastIndexOf('}') + 1).split(',')).map((m) => m.trim());
  const card = /\.(qblock|qtext|qopts?|qrec|qanswered|qpanel-foot|chat-q-opt-sub|shape-reqs-[a-z]+)\b/;
  const loose = selectors.filter((m) => card.test(m) && !m.startsWith('.shape-reqs'));
  assert.deepEqual(loose, [], 'no other host gets these rules');
  // (0,4,0): the two-column rule inside @container chat-q is (0,3,0), and shape-it.css loads before it.
  for (const t of ['.qpanel', '.qblock', '.qblock + .qblock', '.qtext', '.qopts']) {
    assert.ok(selectors.includes(`.shape-reqs .chat-q.chat-rc-q ${t}`), t);
  }
  assert.match(css, /\.shape-reqs \.chat-q\.chat-rc-q \.qopts\{grid-column:1;/);
  assert.match(css, /\.shape-reqs \.chat-q\.chat-rc-q \.qblock:has\(\.qopt\.sel:not\(\[data-preset\]\)\) \.qtext::after\{content:none;/, 'the Answered pill, (0,6,1)');
  assert.match(css, /\.shape-reqs \.chat-q-opt-sub\{font-family:var\(--sans\);/);
});

test('requirements-body does not import plan-body (no cycle)', () => {
  const src = readFileSync(new URL('../ui/public/shape/requirements-body.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\/plan-body\.mjs'/);
  assert.match(src, /import \{ buildFeedbackRow \} from '\.\/feedback-row\.mjs'/);
});
