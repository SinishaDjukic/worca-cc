// test/worktree-notice.test.mjs — the summary card's worktree notice, pure: the model from a run's
// retained-work / checkout facts, the renderer (detached DOM, textContent only), the copy helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  worktreeNoticeModel, renderWorktreeNotice, memberLabel, recoveryPatchKind, uncommittedPatchName,
  applyConfirmMessage, applyOutcome, NOTICE_TITLES, worktreeRowState, checkoutRowValue, TRY_IT_ROW,
} from '../ui/public/worktree-notice.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const host = (frag) => { const d = doc.createElement('div'); d.append(frag); return d; };
const RETAINED = { reason: 'commit_failed', members: [{ projectKey: 'app-0cea65fb', worktreeDir: '/tmp/wt', branch: 'worca-cc/x',
  step: 'commit', message: 'pre-commit hook failed', at: '2026-10-14T09:00:00Z' }] };
const CHECKOUT = { members: [{ projectKey: 'app-0cea65fb', worktreeDir: '/h/runs/ab/repos/app', branch: 'worca-cc/x', at: '2026-10-14T08:00:00Z' }] };
const LINKED = { members: [{ ...CHECKOUT.members[0], worktreeDir: '/Users/ada/app', external: true }] };
const labels = (el) => [...el.querySelectorAll('button')].map((b) => b.textContent);

test('model: retained work wins over a checkout; nothing held is null', () => {
  assert.equal(worktreeNoticeModel({}), null);
  assert.equal(worktreeNoticeModel({ retained: { members: [] }, checkout: { members: [] } }), null);
  const m = worktreeNoticeModel({ retained: RETAINED, checkout: CHECKOUT, recoveryPatch: 'retained' });
  assert.equal(m.kind, 'retained');
  assert.deepEqual(m.members, [{ projectKey: 'app-0cea65fb', label: '', branch: 'worca-cc/x', dir: '/tmp/wt',
    step: 'commit', message: 'pre-commit hook failed', at: '2026-10-14T09:00:00Z' }]);
  const c = worktreeNoticeModel({ checkout: LINKED, workspace: true, names: { 'app-0cea65fb': 'App' } });
  assert.equal(c.kind, 'checkout');
  assert.equal(c.members[0].external, true);
  assert.equal(c.members[0].label, 'App', 'a workspace member is named');
});

test('memberLabel: the History name, else the key without its hash', () => {
  assert.equal(memberLabel('web-0cea65fb', { 'web-0cea65fb': 'Web app' }), 'Web app');
  assert.equal(memberLabel('web-0cea65fb'), 'web');
  assert.equal(memberLabel(null), 'Project');
  assert.equal(memberLabel('constructor', {}), 'constructor');
});

test('retained: says the work is only in the worktree, names git\'s message, offers Apply / patch / Discard', () => {
  const calls = [];
  const el = host(renderWorktreeNotice(worktreeNoticeModel({ retained: RETAINED, recoveryPatch: 'retained' }), {
    doc, recovery: { kind: 'retained', href: '/api/runs/ab/recovery-patch?projectKey=app-0cea65fb', download: 'retained-work-ab.patch' },
    handlers: { onApply: (b) => calls.push(['apply', b.tagName]), onDiscardRetained: () => calls.push(['discard']) },
    when: (iso) => `@${iso}`,
  }));
  assert.equal(el.querySelector('h4').textContent, NOTICE_TITLES.retained);
  assert.match(el.textContent, /exist only in its worktree, not on worca-cc\/x/);
  assert.match(el.textContent, /A pull request opened now would not include them/);
  assert.match(el.textContent, /Check out, Archive and a new run on this branch are refused/);
  assert.match(el.textContent, /git commit: pre-commit hook failed/);
  assert.match(el.textContent, /Worktree: \/tmp\/wt/);
  assert.match(el.textContent, /Since @2026-10-14T09:00:00Z/);
  assert.match(el.textContent, /git -C '\/tmp\/wt' add -A/, 'the manual recipe stays, folded');
  assert.deepEqual(labels(el), ['Apply to branch', 'Discard worktree']);
  assert.ok(el.querySelector('.hist-discard'), 'the Discard button keeps its class');
  const link = el.querySelector('.retained-patch-link a');
  assert.equal(link.textContent, 'Download the recovery patch');
  assert.equal(link.getAttribute('download'), 'retained-work-ab.patch');
  el.querySelector('.wt-apply').click();
  el.querySelector('.hist-discard').click();
  assert.deepEqual(calls, [['apply', 'BUTTON'], ['discard']]);
});

test('retained, provisional: the facts but no actions', () => {
  const el = host(renderWorktreeNotice(worktreeNoticeModel({ retained: RETAINED, provisional: true }), {
    doc, handlers: { onApply: () => {}, onDiscardRetained: () => {} } }));
  assert.deepEqual(labels(el), []);
  assert.equal(el.querySelector('.wt-actions'), null);
});

const when = (iso) => `@${iso.slice(11, 16)}`;

test('a checkout renders nothing on the glance: the Actions tab owns it', () => {
  for (const co of [CHECKOUT, LINKED]) {
    const el = host(renderWorktreeNotice(worktreeNoticeModel({ checkout: co }), { doc, handlers: {} }));
    assert.equal(el.childNodes.length, 0);
    assert.doesNotMatch(el.textContent, /worktree/i);
  }
});

test('checkoutRowValue: local copy, linked folder, several members, none', () => {
  assert.equal(checkoutRowValue(CHECKOUT, { when }), 'Local copy open · since @08:00');
  assert.equal(checkoutRowValue(LINKED, { when }), 'Linked to your folder · since @08:00');
  const two = { members: [CHECKOUT.members[0], { ...CHECKOUT.members[0], projectKey: 'api-11111111', at: '2026-10-14T07:30:00Z' }] };
  assert.equal(checkoutRowValue(two, { when }), '2 local copies open · since @07:30', 'the earliest checkout');
  const mixed = { members: [CHECKOUT.members[0], { ...LINKED.members[0], projectKey: 'api-11111111' }] };
  assert.equal(checkoutRowValue(mixed, { when }), '2 local copies open · since @08:00');
  assert.equal(checkoutRowValue({ members: [{ ...CHECKOUT.members[0], at: null }] }, { when }), 'Local copy open');
  assert.equal(checkoutRowValue(null, { when, canTry: true }), TRY_IT_ROW);
  assert.equal(TRY_IT_ROW, 'Try it on this machine');
  assert.equal(checkoutRowValue({ members: [] }, { when, canTry: false }), '');
});

test('data is text: a hostile git message renders inert', () => {
  const evil = { members: [{ ...RETAINED.members[0], message: '<img src=x onerror=alert(1)>' }] };
  const el = host(renderWorktreeNotice(worktreeNoticeModel({ retained: evil }), { doc }));
  assert.equal(el.querySelector('img'), null);
  assert.match(el.textContent, /<img src=x/);
});

test('helpers: recovery patch kind, the diff file name, the Apply confirm and outcome copy', () => {
  assert.equal(recoveryPatchKind([{ kind: 'diff-patch' }, { kind: 'retained-work-patch' }]), 'retained');
  assert.equal(recoveryPatchKind([{ kind: 'diff-patch' }]), 'diff');
  assert.equal(recoveryPatchKind(null), null);
  assert.equal(uncommittedPatchName('worca-cc/x y'), 'uncommitted-worca-cc-x-y.patch');
  assert.match(applyConfirmMessage(worktreeNoticeModel({ retained: RETAINED })), /onto worca-cc\/x/);
  assert.deepEqual(applyOutcome({ applied: [], failed: [] }), { tone: 'info', title: 'Nothing left to apply', detail: 'The retained worktree is already gone.' });
  const ok = applyOutcome({ applied: [{ projectKey: 'app-0cea65fb', branch: 'worca-cc/x', sha: 'abcdef0123456789', committed: true, hooksBypassed: false }], failed: [] });
  assert.deepEqual(ok, { tone: 'ok', title: 'Work applied to the branch', detail: 'Committed abcdef0123 on worca-cc/x.' });
  const mb = applyOutcome({ applied: [{ projectKey: 'app-0cea65fb', branch: 'worca-cc/h', sha: 'abcdef0123456789', committed: true,
    mergeBack: { merged: false, kind: 'diverged', reason: 'main has new commits since the run started', source: 'main' } }], failed: [] });
  assert.equal(mb.tone, 'warn');
  assert.match(mb.detail, /not merged back into main: main has new commits/);
});

test('worktreeRowState: one word for the Overview row from the notice model (F-2)', () => {
  const co = worktreeNoticeModel({ checkout: { members: [{ branch: 'b', worktreeDir: '/w/co' }] } });
  assert.deepEqual(worktreeRowState(co, { dir: '/w/old' }), { word: 'checked out', dir: '/w/co' });
  const re = worktreeNoticeModel({ retained: { members: [{ branch: 'b', worktreeDir: '/w/re' }] } });
  assert.equal(worktreeRowState(re).word, 'retained');
  assert.equal(worktreeRowState(re).dir, '/w/re');
  assert.deepEqual(worktreeRowState(null), { word: 'released', dir: '' });
  assert.deepEqual(worktreeRowState(null, { live: true, dir: '/w/x', removed: false }), { word: 'active', dir: '/w/x' });
});
