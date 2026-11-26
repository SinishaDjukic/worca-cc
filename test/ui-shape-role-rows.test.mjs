// test/ui-shape-role-rows.test.mjs — the ONE role-rows component (ui/public/shape/role-rows.mjs, #990 slice 3): the
// plan card's per-role fold (fixed / disputed / open counts, once each) and one conflict decision card per pair of
// contradicting findings, in the Clarify card grammar. jsdom, in-process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildRoleFold, buildConflictCards } from '../ui/public/shape/role-rows.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const f = (id, status, extra = {}) => ({ id, severity: 'major', title: id, section: 'Rollout', fix: `fix ${id}`, status, ...extra });
const role = (key, label, findings) => ({ key, label, skipped: false, checklist: [], findings });
const REVIEWS = { rounds: [{ pass: 1, round: 1, plan: 'p', roles: [
  role('security', 'Security', [f('security-1-1', 'fixed', { fixedIn: 2 }), f('security-1-2', 'fixed', { fixedIn: 2 }),
    f('security-1-3', 'disputed', { reason: 'The plan already gates it behind a flag.' }), f('security-1-4', 'open')]),
  role('ux', 'UX', [f('ux-1-1', 'disputed', { reason: 'conflict, left to the person' })]),
  role('qa', 'QA', []),
] }] };
const CONFLICT = { id: 'conflict-1', findings: ['security-1-3', 'ux-1-1'], roles: ['security', 'ux'], section: 'Rollout',
  question: 'Roll out behind a flag, or to everyone?', options: ['Behind a flag', 'To everyone'] };
const withConflicts = (conflicts) => ({ rounds: [{ ...REVIEWS.rounds[0], conflicts }] });
const LABELS = { security: 'Security', ux: 'UX', qa: 'QA' };
const labelOf = (k) => LABELS[k] || k;

test('buildRoleFold returns null without a review', () => {
  assert.equal(buildRoleFold(doc, null), null);
  assert.equal(buildRoleFold(doc, { rounds: [] }), null);
});

test('one row per role, each count once', () => {
  const { line, rows } = buildRoleFold(doc, REVIEWS);
  assert.ok(line.classList.contains('plan-role-line'));
  assert.ok(rows.classList.contains('plan-roles'));
  assert.equal(line.querySelector('.plan-fold-text').textContent, 'Reviewed by 3 roles · 1 open');
  const list = [...rows.querySelectorAll('.plan-check-row')];
  assert.equal(list.length, 3);
  const labels = list.map((r) => r.querySelector('.plan-check-label').textContent);
  assert.deepEqual(labels, ['Security · 2 fixed · 1 disputed · 1 open', 'UX · 1 disputed', 'QA · no findings']);
  for (const word of ['fixed', 'disputed', 'open']) assert.equal(labels[0].split(word).length - 1, 1, word);
  assert.equal(list[0].querySelector('.plan-check-mark').textContent, '!', 'an open major');
  assert.equal(list[1].querySelector('.plan-check-mark').textContent, '', 'a disputed finding is not open');
  assert.equal(rows.querySelectorAll('.plan-check-show').length, 2, 'no Show without findings');
});

test('a disputed finding shows its reason and a disputed status chip; fixed says its version', () => {
  const { rows } = buildRoleFold(doc, REVIEWS);
  const show = rows.querySelector('.plan-check-show');
  const list = rows.querySelector('.plan-findings');
  assert.equal(list.hidden, true);
  show.click();
  assert.equal(list.hidden, false);
  assert.equal(show.textContent, 'Hide');
  const items = [...list.querySelectorAll('.plan-finding')];
  assert.deepEqual(items.map((li) => li.querySelector('.plan-finding-status').textContent), ['fixed in v2', 'fixed in v2', 'disputed', 'open']);
  const disputed = items[2];
  assert.ok(disputed.querySelector('.plan-finding-status').classList.contains('disputed'));
  assert.equal(disputed.querySelector('.plan-finding-reason').textContent, 'The plan already gates it behind a flag.');
  assert.equal(items[3].querySelector('.plan-finding-reason'), null);
  assert.ok(items[0].querySelector('.plan-finding-status').classList.contains('fixed'));
});

test('a finding without a section reads the fallback', () => {
  const rr = { rounds: [{ pass: 1, round: 1, plan: 'p', roles: [role('qa', 'QA', [f('qa-1-1', 'open', { section: '' })])] }] };
  const { rows } = buildRoleFold(doc, rr, { sectionFallback: 'Plan' });
  assert.equal(rows.querySelector('.plan-finding-section').textContent, 'Plan');
});

test('buildConflictCards: null without conflicts', () => {
  assert.equal(buildConflictCards(doc, REVIEWS, { labelOf }), null);
  assert.equal(buildConflictCards(doc, null, { labelOf }), null);
});

test('one conflict renders one decision card, in the Clarify grammar; picks() returns the chosen option', () => {
  const cards = buildConflictCards(doc, withConflicts([CONFLICT]), { labelOf });
  const { el } = cards;
  assert.ok(el.classList.contains('plan-decisions'));
  assert.equal(el.getAttribute('role'), 'group');
  assert.equal(el.getAttribute('aria-label'), 'Decisions needed');
  const card = el.querySelectorAll('.plan-decision');
  assert.equal(card.length, 1);
  assert.equal(card[0].querySelector('.plan-decision-src').textContent, 'Security and UX disagree on Rollout');
  assert.equal(card[0].querySelectorAll('.qblock').length, 1);
  assert.match(card[0].querySelector('.qtext').textContent, /Roll out behind a flag, or to everyone\?/);
  const opts = [...card[0].querySelectorAll('.qopt')];
  assert.deepEqual(opts.map((o) => [o.textContent, o.dataset.key, o.getAttribute('aria-pressed'), o.type]),
    [['Behind a flag', 'A', 'false', 'button'], ['To everyone', 'B', 'false', 'button']]);
  assert.deepEqual(cards.picks(), []);
  assert.equal(cards.firstUnanswered(), card[0]);
  opts[1].click();
  assert.deepEqual(cards.picks(), [{ id: 'conflict-1', choice: 'To everyone' }]);
  assert.deepEqual(opts.map((o) => [o.getAttribute('aria-pressed'), o.classList.contains('sel')]), [['false', false], ['true', true]]);
  assert.equal(cards.firstUnanswered(), null);
  opts[0].click();
  assert.deepEqual(cards.picks(), [{ id: 'conflict-1', choice: 'Behind a flag' }], 'a second click changes the pick');
});

test('two conflicts: two cards; firstUnanswered is the first without a pick, and it can take focus', () => {
  const second = { ...CONFLICT, id: 'conflict-2', findings: ['security-1-4', 'ux-1-1'], question: 'Which log level?', options: ['Info', 'Debug'] };
  const cards = buildConflictCards(doc, withConflicts([CONFLICT, second]), { labelOf });
  const all = [...cards.el.querySelectorAll('.plan-decision')];
  assert.equal(all.length, 2);
  all[0].querySelector('.qopt').click();
  assert.equal(cards.firstUnanswered(), all[1]);
  doc.body.appendChild(cards.el);
  cards.firstUnanswered().focus();
  assert.equal(doc.activeElement, all[1]);
  cards.el.remove();
});

test('CSS: the disputed chip and the reason use light-dark tokens; .qopt is scoped to the decisions too', () => {
  const css = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => (new RegExp(`(?:^|[}\\s,])${sel.replace(/[.]/g, '\\.')}\\{([^}]*)\\}`).exec(css) || [])[1];
  const disputed = rule('.plan-finding-status.disputed');
  const reason = rule('.plan-finding-reason');
  assert.ok(disputed && reason, 'both rules exist');
  for (const body of [disputed, reason]) {
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const v of body.matchAll(/(?:color|background)\s*:\s*var\((--[\w-]+)\)/g)) assert.match(css, new RegExp(`${v[1]}:\\s*light-dark\\(`), v[1]);
  }
  assert.match(css, /:is\(\.rd-questions,\.chat-rc-q,\.plan-decisions\) \.qopt\{/);
});

// Small runs B3 (D16, D17): one fold per role on the Requirements card.
const roleGroup = (over = {}) => ({ key: 'security', perspective: 'security', label: 'Security', lead: false, summary: 'added 2', state: 'clean', findings: [],
  rows: [{ id: 'R-sec-1', label: 'Secrets never leave', pass: true, note: 'e.g. a token is masked', tip: 'R-sec-1 · e.g. a token is masked' }], ...over });

test('buildRequirementRoleFolds: 1 fold per group; head reads mark, name, summary, chevron; clean is closed with ✓ and its words', async () => {
  const { buildRequirementRoleFolds, FOLD_MARK_WORDS } = await import('../ui/public/shape/role-rows.mjs');
  const { el, folds } = buildRequirementRoleFolds(doc, [roleGroup({ lead: true, label: 'Engineering', key: 'engineering', perspective: 'architect' }), roleGroup(), roleGroup({ key: 'qa', label: 'QA', state: 'open' })]);
  assert.equal(folds.length, 3);
  assert.equal(el.querySelectorAll('.shape-role-fold').length, 3);
  const [eng, sec, qa] = folds;
  assert.deepEqual([...sec.line.children].map((c) => c.className), ['plan-check-mark ok', 'shape-role-fold-ic', 'shape-role-fold-name', 'plan-fold-text', 'plan-chev']);
  assert.equal(sec.line.querySelector('.plan-check-mark').getAttribute('aria-hidden'), 'true');
  assert.ok(sec.line.querySelector('.plan-check-mark svg'), 'the check icon');
  assert.equal(sec.line.querySelector('.sr-only').textContent, `, ${FOLD_MARK_WORDS.clean}`);
  assert.equal(sec.line.getAttribute('aria-expanded'), 'false');
  assert.equal(sec.rows.hidden, true);
  assert.match(eng.line.querySelector('.shape-role-fold-name').textContent, /^Engineering \(you ask as\)/);
  assert.doesNotMatch(sec.line.textContent, /you ask as/);
  assert.equal(qa.line.getAttribute('aria-expanded'), 'true');
  assert.equal(qa.line.querySelector('.plan-check-mark').textContent, '?');
  assert.equal(qa.line.querySelector('.sr-only').textContent, ', open objection');
  assert.deepEqual(FOLD_MARK_WORDS, { clean: 'nothing open', asks: 'has a question', open: 'open objection', example: 'no example yet' });
});

test('owner direction (role title): the perspective\'s icon sits before the name, aria-hidden; the name is ink at weight 600', async () => {
  const { buildRequirementRoleFolds } = await import('../ui/public/shape/role-rows.mjs');
  const { perspectiveByKey } = await import('../src/shared/shape/perspectives.mjs');
  const groups = [roleGroup({ perspective: 'security' }), roleGroup({ key: 'engineering', label: 'Engineering', perspective: 'architect' }),
    roleGroup({ key: 'release', label: 'Release', perspective: 'release' }), roleGroup({ key: 'x', label: 'X', perspective: null })];
  const [sec, eng, rel, none] = buildRequirementRoleFolds(doc, groups).folds;
  for (const [f, key] of [[sec, 'security'], [eng, 'architect'], [rel, 'release']]) {
    const ic = f.line.querySelector('.shape-role-fold-ic');
    assert.equal(ic.textContent, perspectiveByKey(key).icon, key);
    assert.equal(ic.getAttribute('aria-hidden'), 'true');
    assert.equal(ic.nextElementSibling.className, 'shape-role-fold-name', 'the icon comes right before the name');
  }
  assert.equal(none.line.querySelector('.shape-role-fold-ic'), null, 'no perspective, no icon');
  const css = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const name = css.match(/\.shape-role-fold-name\{([^}]*)\}/);
  assert.ok(name, 'a .shape-role-fold-name rule');
  assert.match(name[1], /color:var\(--ink\)/);
  assert.match(name[1], /font-weight:600/);
  assert.match(css, /\.shape-role-fold-ic\{[^}]*\}/);
});

test('buildRequirementRoleFolds keyboard: a native button head with no tabindex or role; click toggles aria-expanded both ways', async () => {
  const { buildRequirementRoleFolds } = await import('../ui/public/shape/role-rows.mjs');
  const [f] = buildRequirementRoleFolds(doc, [roleGroup()]).folds;
  assert.equal(f.line.tagName, 'BUTTON');
  assert.equal(f.line.getAttribute('type'), 'button');
  assert.equal(f.line.hasAttribute('tabindex'), false);
  assert.equal(f.line.hasAttribute('role'), false);
  f.line.click();
  assert.deepEqual([f.line.getAttribute('aria-expanded'), f.rows.hidden], ['true', false]);
  f.line.click();
  assert.deepEqual([f.line.getAttribute('aria-expanded'), f.rows.hidden], ['false', true]);
});

test('buildRequirementRoleFolds lists open objections through findingList, status "open"; setLead moves the marker', async () => {
  const { buildRequirementRoleFolds, findingList } = await import('../ui/public/shape/role-rows.mjs');
  assert.equal(typeof findingList, 'function');
  const finding = { id: 'security-3-1', severity: 'major', title: 'Secrets', section: 'R-sec-1', fix: 'Mask the token', status: 'open' };
  const [f] = buildRequirementRoleFolds(doc, [roleGroup({ state: 'open', findings: [finding] })]).folds;
  const list = f.rows.querySelector('.plan-findings');
  assert.equal(list.hidden, false);
  assert.equal(list.querySelector('.plan-finding-status').textContent, 'open');
  f.setLead(true);
  assert.match(f.line.textContent, /\(you ask as\)/);
  f.setLead(false);
  assert.doesNotMatch(f.line.textContent, /you ask as/);
});
