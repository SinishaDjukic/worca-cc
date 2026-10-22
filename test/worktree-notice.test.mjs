// test/worktree-notice.test.mjs — the summary card's worktree notice, pure: the model from a run's
// retained-work / checkout facts, the renderer (detached DOM, textContent only), the copy helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  worktreeNoticeModel, renderWorktreeNotice, memberLabel, recoveryPatchKind, uncommittedPatchName,
  applyConfirmMessage, applyOutcome, NOTICE_TITLES, worktreeRowState,
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

test('checkout: where, since when, why things are refused; Discard + Get the diff + the Actions tab (Advanced)', () => {
  const calls = [];
  const el = host(renderWorktreeNotice(worktreeNoticeModel({ checkout: CHECKOUT }), {
    doc, when: (iso) => `@${iso}`,
    handlers: { onReleaseCheckout: (m) => calls.push(['release', m.projectKey, m.external]), onDiff: (m) => calls.push(['diff', m.projectKey]),
      onOpenActions: () => calls.push(['tab']) },
  }));
  assert.equal(el.querySelector('h4').textContent, NOTICE_TITLES.checkout);
  assert.match(el.textContent, /worca-cc\/x is checked out in a worktree since @2026-10-14T08:00:00Z/);
  assert.match(el.textContent, /Worktree: \/h\/runs\/ab\/repos\/app/);
  assert.match(el.textContent, /Check out, Archive and a new run on this branch are refused/);
  assert.deepEqual(labels(el), ['Discard', 'Get the diff', 'Actions tab ›']);
  assert.equal(el.querySelector('.wt-actions-row').dataset.minLevel, 'advanced', 'only the tab link is level-gated');
  for (const b of el.querySelectorAll('button')) b.click();
  assert.deepEqual(calls, [['release', 'app-0cea65fb', false], ['diff', 'app-0cea65fb'], ['tab']]);
});

test('a linked folder is named as yours and offers Unlink, never Discard', () => {
  const el = host(renderWorktreeNotice(worktreeNoticeModel({ checkout: LINKED }), {
    doc, handlers: { onReleaseCheckout: () => {}, onDiff: () => {} } }));
  assert.equal(el.querySelector('h4').textContent, NOTICE_TITLES.linked);
  assert.match(el.textContent, /checked out in your folder/);
  assert.match(el.textContent, /Your folder: \/Users\/ada\/app/);
  assert.deepEqual(labels(el), ['Unlink', 'Get the diff']);
});

test('a workspace lists its members', () => {
  const two = { members: [CHECKOUT.members[0], { ...CHECKOUT.members[0], projectKey: 'api-11111111', worktreeDir: '/h/runs/ab/repos/api', branch: 'worca-cc/x' }] };
  const el = host(renderWorktreeNotice(worktreeNoticeModel({ checkout: two, workspace: true }), { doc, handlers: { onDiff: () => {} } }));
  assert.deepEqual([...el.querySelectorAll('.wt-members strong')].map((s) => s.textContent), ['app', 'api']);
  assert.equal(labels(el).filter((l) => l === 'Get the diff').length, 2, 'one per member');
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
