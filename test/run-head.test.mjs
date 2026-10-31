// test/run-head.test.mjs — slice 3: the run page card's head (status words, head buttons, View PR ▾ items) and its
// read-only route of where the work is (s2), over the request's state table. Pure: no app boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { headModel, groupHead, routeModel, routeGroupOf, landingOf, prRef, renderRoute, routeOpenWanted, setRouteOpen, ROUTE_OPEN_KEY,
  renderHeadButtons, prMenuItems, trackerWatchWords, canResolvePr, showsFixConflicts, hdPrWatchLabel, ASK_IN_CHAT, verdictWords } from '../ui/public/run-head.mjs';
import { icon } from '../ui/public/icons.mjs';   // the remote icon check

const M = (state, extra = {}) => ({ state, word: state, dot: 'green', line: '', actions: [], pr: null, prNeeds: false, ...extra });
const F = (extra = {}) => ({ m: M('ready'), mode: 'git', gitChrome: true, level: 'expert', workspace: null, base: 'dev', source: 'main',
  pr: null, prInput: 'NONE', prStatus: null, watch: null, canCreatePr: true, push: false, notMergedBack: false,
  kept: null, folder: null, canTry: true, ...extra });
const OPEN = { state: 'OPEN', url: 'https://github.com/o/r/pull/866', number: 866 };
const CONFLICTS = M('needs-you', { prNeeds: true, pr: { id: 'conflicts' } });
const STOPPED_WATCH = M('needs-you', { prNeeds: true, actions: ['open-pr', 'ask-changes'], pr: { id: 'conflicts' },
  line: 'Needs you · Watch stopped · 3 fix runs, needs a person' });
const FAILED = M('failed', { dot: 'red', line: 'Build · failed · Implementation' });
const ids = (h) => [...h.before, ...h.after].map((b) => b.id);
const doc = () => new JSDOM('<!doctype html><body><div class="acts"></div></body>').window.document;

const TABLE = {
  working: [F({ m: M('working', { pulse: true }) }), 'live', null, []],
  ready: [F(), 'ready', 'Ready to ship · not in dev yet', ['try']],
  pending: [F({ prInput: 'PENDING' }), 'ready', 'Ready to ship · not in dev yet', ['try']],
  push: [F({ push: true }), 'push', 'Ready to ship', ['try']],
  'pr closed': [F({ pr: { ...OPEN, state: 'CLOSED' } }), 'pr-closed', 'Ready to ship · the PR was closed', ['try']],
  'in review': [F({ m: M('in-review'), pr: OPEN, prStatus: { status: { label: 'Review required' }, watch: null } }), 'in-review', 'In review · waiting for a review', []],
  conflicts: [F({ m: CONFLICTS, pr: OPEN, prStatus: { watch: { watching: false, status: 'idle' } } }), 'conflicts', 'Needs you · conflicts with dev', ['fix-conflicts']],
  'watch stopped': [F({ m: STOPPED_WATCH, pr: OPEN, prStatus: { watch: { watching: true, status: 'needs-person' } } }), 'watch-stopped', 'Needs you', ['ask-changes']],
  merged: [F({ m: M('merged', { dot: 'violet' }), pr: { ...OPEN, state: 'MERGED' } }), 'merged', 'Merged', []],
  kept: [F({ kept: { provisional: false } }), 'kept', 'Needs you · the changes could not be committed', ['discard-kept', 'apply-kept']],
  'kept provisional': [F({ kept: { provisional: true } }), 'kept', 'Needs you · the changes could not be committed', []],
  'not merged back': [F({ notMergedBack: true }), 'not-merged-back', 'Needs you · not merged back into main', ['how-to-merge']],
  folder: [F({ mode: 'folder', gitChrome: false, folder: { state: 'pending', total: 14 } }), 'folder', 'Ready · 14 files changed in a copy', ['discard-folder', 'apply-folder']],
  failed: [F({ m: FAILED }), 'failed', 'Failed · Build · Implementation', ['report']],
  workspace: [F({ m: M('in-review'), canCreatePr: false, workspace: { members: [
    { key: 'a', name: 'app', pr: { ...OPEN, state: 'MERGED' } }, { key: 'b', name: 'api', pr: { ...OPEN, number: 867 } }] } }),
  'workspace', 'In review · 1 of 2 merged', []],
};

test('head: every state of the request table gives its key, status line and head buttons, with at most 1 primary', () => {
  for (const [name, [f, key, line, want]] of Object.entries(TABLE)) {
    const h = headModel(f);
    assert.equal(h.key, key, name);
    assert.equal(h.status ? h.status.line : null, line, name);
    assert.deepEqual(ids(h), want, name);
    const primaries = [...h.before, ...h.after].filter((b) => b.primary).length + (h.cta && h.cta.state !== 'view' && h.cta.state !== 'merged' && h.cta.state !== 'none' ? 1 : 0);
    assert.ok(primaries <= 1, `${name}: ${primaries} primaries`);
  }
});

test('head: Ready on its own branch is Try it, then Create PR as the one primary', () => {
  const h = headModel(F());
  assert.equal(h.key, 'ready');
  assert.equal(h.status.line, 'Ready to ship · not in dev yet');
  assert.deepEqual(h.before.map((b) => b.id), ['try']);
  assert.deepEqual(h.cta, { state: 'create' });
  assert.deepEqual(h.after, []);
});

test('head: the PR control per state (pending, push, view ▾, merged ▾, create beside How to merge, workspace View PRs)', () => {
  assert.deepEqual(headModel(F({ prInput: 'PENDING' })).cta, { state: 'pending' });
  // A short label; the tooltip names the branch, and the record's push state (record.push) paints it.
  assert.deepEqual(headModel(F({ push: true })).cta, { state: 'push', label: 'Push', title: 'Push to main', disabled: false });
  assert.deepEqual(headModel(F({ push: true, pushState: { state: 'pushed', remote: 'origin' } })).cta,
    { state: 'push', label: 'Pushed to origin', title: 'main is on origin', disabled: true });
  assert.equal(headModel(F({ push: true, pushState: { state: 'diverged', remote: 'origin' } })).cta.disabled, true);
  assert.deepEqual(headModel(F({ m: M('in-review'), pr: OPEN })).cta, { state: 'view', href: OPEN.url, menu: true });
  assert.deepEqual(headModel(F({ m: M('merged'), pr: { ...OPEN, state: 'MERGED' } })).cta, { state: 'merged', href: OPEN.url, menu: true });
  assert.deepEqual(headModel(F({ notMergedBack: true })).cta, { state: 'create' });
  assert.equal(headModel(F({ notMergedBack: true, canCreatePr: false })).cta, null);
  assert.deepEqual(headModel(TABLE.workspace[0]).cta, { state: 'view', label: 'View PRs', menu: true, ws: true });
  const ship = headModel({ ...TABLE.workspace[0], canCreatePr: true });
  assert.deepEqual(ship.after.map((b) => [b.id, !!b.primary]), [['ship', true]]);
  assert.equal(headModel(F({ m: M('in-review'), pr: OPEN })).status.line, 'In review', 'In review until the verdict is read');
  assert.equal(headModel(F({ canTry: false })).before.length, 0);
});

test('Watch stopped: the head says Needs you (the route says why) and draws Ask for changes disabled', () => {
  const h = headModel(TABLE['watch stopped'][0]);
  assert.equal(h.status.line, 'Needs you');
  assert.deepEqual(h.after.map((b) => [b.id, !!b.primary, !!b.disabled, b.title]), [['ask-changes', true, true, "Ask for changes from the run's chat"]]);
});

test('head: the In review detail is GitHub verdict only; the checks line stays in the route', () => {
  const at = (status) => headModel(F({ m: M('in-review'), pr: OPEN, prStatus: { status, watch: null } })).status.line;
  assert.equal(at({ label: 'Checks running · 7 of 12 done, 1 skipped' }), 'In review');
  assert.equal(at({ label: 'Checks failing · 2 of 12 failed' }), 'In review');
  assert.equal(at({ label: 'Review required' }), 'In review · waiting for a review');
  assert.equal(at({ label: 'Changes requested' }), 'In review · changes requested');
  assert.equal(at({ label: 'Ready to merge', detail: 'All 14 checks passed' }), 'In review · ready to merge');
  const pr = routeModel(F({ m: M('in-review'), pr: OPEN, prStatus: { checks: { state: 'pending' }, status: { label: 'Checks running · 7 of 12 done' } } }))
    .rows.find((r) => r.kind === 'pr');
  assert.equal(say(pr.second), 'Checks running · 7 of 12 done', "said once: in the route's pull request row");
});

test('head: Merged, Watch stopped and Push leave their detail to the route', () => {
  assert.equal(TABLE.merged[2], 'Merged');
  assert.match(say(routeModel(TABLE.merged[0]).fold.parts), /^Merged into dev/, 'the base is in the route');
  assert.ok(routeModel(F({ push: true })).rows.some((r) => r.kind === 'remote'), 'the Push path says where');
  assert.deepEqual(verdictWords({ label: 'Checks running · 1 of 2 done' }), '');
});

test('head: kept work wins over the run end state (done, stopped, failed); a live run still comes first', () => {
  const kept = { provisional: false };
  for (const m of [M('stopped', { dot: 'dark-grey' }), M('ready')]) {
    const h = headModel(F({ m, kept }));
    assert.equal(h.key, 'kept', m.state);
    assert.equal(h.status.line, 'Needs you · the changes could not be committed', m.state);
    assert.deepEqual(ids(h), ['discard-kept', 'apply-kept'], m.state);
  }
  const f = headModel(F({ m: FAILED, kept }));
  assert.equal(f.key, 'kept');
  assert.equal(f.status.line, 'Failed · Build · Implementation');
  assert.deepEqual(ids(f), ['discard-kept', 'apply-kept', 'report']);
  assert.equal(headModel(F({ m: M('working'), kept })).key, 'live');
  for (const m of [FAILED, M('stopped')]) {
    assert.deepEqual(ids(headModel(F({ m, mode: 'folder', gitChrome: false, folder: { state: 'pending', total: 14 } }))).filter((x) => x !== 'report'),
      ['discard-folder', 'apply-folder'], m.state);
  }
});

test('head: hostile branch names render as inert text', () => {
  const evil = '<img src=x onerror="globalThis.__pwned=1">';
  const d = doc();
  const acts = d.querySelector('.acts');
  renderHeadButtons(acts, headModel(F({ notMergedBack: true, source: evil })), null, {});
  assert.equal(acts.querySelector('img'), null);
  assert.equal(headModel(F({ base: evil })).status.line, `Ready to ship · not in ${evil} yet`);
});

test('renderHeadButtons: a rebuild keeps the slot in place, so a focused item inside it (the open ▾ menu) keeps focus', () => {
  const d = doc();
  const host = d.querySelector('.acts');
  const slot = d.createElement('div');
  slot.className = 'rd-pr-slot';
  const item = d.createElement('button');
  slot.append(item);
  const conflicts = (watching) => headModel(F({ m: CONFLICTS, pr: OPEN, prStatus: { watch: { watching, status: 'idle' } } }));
  renderHeadButtons(host, conflicts(false), slot, {});
  assert.deepEqual([...host.children].map((c) => c.dataset.head || c.className), ['rd-pr-slot', 'fix-conflicts']);
  item.focus();
  renderHeadButtons(host, conflicts(true), slot, {});
  assert.deepEqual([...host.children].map((c) => c.dataset.head || c.className), ['rd-pr-slot']);
  assert.equal(d.activeElement, item, 'the item in the slot keeps the focus');
  renderHeadButtons(host, headModel(F({ kept: { provisional: false } })), slot, {});
  assert.deepEqual([...host.children].map((c) => c.dataset.head || c.className), ['discard-kept', 'rd-pr-slot', 'apply-kept']);
  assert.equal(d.activeElement, item);
});

test('trackerWatchWords: Watching, Fixing, Resolving conflicts and Watch stopped; null when off or idle without the switch', () => {
  assert.deepEqual(trackerWatchWords({ watching: true, status: 'idle' }), { text: 'Watching', tone: '' });
  assert.deepEqual(trackerWatchWords({ watching: true, status: 'fixing' }), { text: 'Fixing', tone: 'run' });
  assert.deepEqual(trackerWatchWords({ watching: true, status: 'fixing', resolving: true }), { text: 'Resolving conflicts', tone: 'run' });
  assert.deepEqual(trackerWatchWords({ watching: true, status: 'needs-person' }), { text: 'Watch stopped', tone: 'bad' });
  assert.equal(trackerWatchWords({ watching: false, status: 'idle' }), null);
  assert.equal(trackerWatchWords(null), null);
  assert.equal(trackerWatchWords({ watching: true, status: 'idle' }, { idle: false }), null);
  assert.equal(hdPrWatchLabel({ watching: true, status: 'idle' }), '');
});

test('canResolvePr and showsFixConflicts: one rule for the head and the ▾ menu', () => {
  assert.equal(canResolvePr(null), false);
  assert.equal(canResolvePr({ watching: true, status: 'idle' }), false);
  assert.equal(canResolvePr({ watching: true, status: 'fixing' }), false);
  assert.equal(canResolvePr({ watching: false, status: 'idle' }), true);
  assert.equal(canResolvePr({ watching: true, status: 'needs-person' }), true);
  for (const w of [null, { watching: true, status: 'idle' }, { watching: false, status: 'idle' }, { watching: true, status: 'needs-person' }]) {
    const h = headModel(F({ m: CONFLICTS, pr: OPEN, prStatus: { watch: w } }));
    assert.equal(h.after.some((b) => b.id === 'fix-conflicts'), canResolvePr(w), JSON.stringify(w));
  }
  const needsPerson = { watching: true, status: 'needs-person' };
  assert.equal(showsFixConflicts(STOPPED_WATCH, needsPerson), false);
  assert.equal(canResolvePr(needsPerson), true);
  assert.equal(showsFixConflicts(CONFLICTS, { watching: false, status: 'idle' }), true);
  for (const name of ['conflicts', 'watch stopped', 'in review']) {
    const f = TABLE[name][0];
    assert.equal(headModel(f).after.some((b) => b.id === 'fix-conflicts'), showsFixConflicts(f.m, f.prStatus.watch), name);
  }
});

test('prMenuItems: Watch switch at Advanced and Expert only, Fix conflicts when asked, one block per workspace member', () => {
  const noop = () => {};
  const h = { onWatch: noop, onCopy: noop, onOpen: noop, onResolve: noop };
  const one = (p, level) => prMenuItems([{ key: '', name: '', number: 866, url: OPEN.url, open: true, watch: { watching: false }, conflicts: false, ...p }], { level, ...h });
  for (const level of ['advanced', 'expert']) {
    const items = one({}, level);
    assert.equal(items[0].header, 'Pull request #866');
    assert.equal(items.filter((i) => i.switch).length, 1, level);
    assert.equal(items.find((i) => i.switch).label, 'Watch');
  }
  assert.equal(one({}, 'simple').filter((i) => i.switch).length, 0);
  assert.deepEqual(one({}, 'simple').filter((i) => i.label).map((i) => i.label), ['Copy PR link']);
  assert.ok(one({ conflicts: true }, 'simple').some((i) => i.label === 'Fix conflicts'));
  const two = prMenuItems([
    { key: 'a', name: 'app', number: 866, url: OPEN.url, open: true, watch: null },
    { key: 'b', name: 'api', number: 867, url: OPEN.url, open: true, watch: null }], { level: 'expert', ...h });
  assert.deepEqual(two.filter((i) => i.header).map((i) => i.header), ['app · Pull request #866', 'api · Pull request #867']);
  assert.deepEqual(two.filter((i) => /^View PR #/.test(i.label || '')).map((i) => i.label), ['View PR #866', 'View PR #867']);
  assert.equal(two.some((i) => /^Open PR/.test(i.label || '')), false);
  const failed = one({ watch: null, watchFailed: true }, 'advanced').find((i) => i.label === 'Watch unavailable');
  assert.ok(failed && failed.disabled);
  assert.equal(failed.title, "Could not read this pull request's status");
  assert.equal(one({ watch: null, watchFailed: true }, 'simple').some((i) => i.label === 'Watch unavailable'), false);
});

test('renderHeadButtons: before, the slot, after; rebuilt only on change, and a rebuilt button keeps the focus', () => {
  const d = doc();
  const host = d.querySelector('.acts');
  const slot = d.createElement('div');
  slot.className = 'rd-pr-slot';
  const clicks = [];
  const h = headModel(F({ kept: { provisional: false } }));
  renderHeadButtons(host, h, slot, { onHead: (id) => clicks.push(id) });
  assert.deepEqual([...host.children].map((c) => c.dataset.head || c.className), ['discard-kept', 'rd-pr-slot', 'apply-kept']);
  assert.equal(host.querySelectorAll('.btn-primary').length, 1);
  host.querySelector('[data-head="apply-kept"]').click();
  assert.deepEqual(clicks, ['apply-kept']);
  const first = host.querySelector('[data-head="discard-kept"]');
  renderHeadButtons(host, h, slot, {});
  assert.equal(host.querySelector('[data-head="discard-kept"]'), first, 'same buttons: no rebuild');
  first.focus();
  renderHeadButtons(host, headModel(F({ m: FAILED, kept: { provisional: false } })), slot, {});
  assert.notEqual(host.querySelector('[data-head="discard-kept"]'), first);
  assert.equal(d.activeElement, host.querySelector('[data-head="discard-kept"]'));
  renderHeadButtons(host, headModel(F({ m: M('working') })), slot, {});
  assert.equal(host.hidden, true);
});

test('groupHead (one ship flow): Create PR, View PR ▾, View PRs ▾; a partly shipped group keeps Create PR as a head button', () => {
  const pr = (n, o = {}) => ({ key: `p${n}`, name: `Run ${n}`, number: n, url: `u${n}`, open: true, merged: false, ...o });
  assert.deepEqual(groupHead({ state: 'ready', prs: [] }).cta, { state: 'create' });
  assert.deepEqual(groupHead({ state: 'ready', prs: [] }).after, []);
  const partly = groupHead({ state: 'ready', prs: [pr(1)] });
  assert.deepEqual(partly.cta, { state: 'view', href: 'u1', menu: true });
  assert.deepEqual(partly.after.map((b) => [b.id, b.label, !!b.primary]), [['ship', 'Create PR', true]]);
  assert.deepEqual(groupHead({ state: 'in-review', prs: [pr(1), pr(2)] }).cta, { state: 'view', label: 'View PRs', menu: true, ws: true });
  assert.deepEqual(groupHead({ state: 'in-review', prs: [pr(1), pr(2)] }).after, []);
  assert.deepEqual(groupHead({ state: 'merged', prs: [pr(1, { open: false, merged: true })] }).cta, { state: 'merged', href: 'u1', menu: true });
  assert.equal(groupHead({ state: 'working', prs: [] }).cta, null);
});

test('prMenuItems with onWatchAll / onCopyAll: each PR as today, then Watch PRs (Advanced) and Copy PR links', () => {
  const prs = [{ key: 'a', name: 'Run 1', number: 12, url: 'u1', open: true, watch: null },
    { key: 'b', name: 'Run 2', number: 13, url: 'u2', open: true, watch: null, conflicts: true }];
  const noop = () => {};
  const labels = (level, extra = { onWatchAll: noop, onCopyAll: noop }) => prMenuItems(prs, { level, onWatch: noop, onCopy: noop, onOpen: noop, onResolve: noop, ...extra })
    .map((i) => (i.sep ? '—' : i.header || i.label));
  assert.deepEqual(labels('advanced'), ['Run 1 · Pull request #12', 'View PR #12', 'Copy PR link', '—',
    'Run 2 · Pull request #13', 'View PR #13', 'Copy PR link', 'Fix conflicts', '—', 'Watch PRs', 'Copy PR links']);
  assert.deepEqual(labels('basic').slice(-2), ['—', 'Copy PR links']);
  assert.equal(labels('advanced', {}).includes('Copy PR links'), false, 'the workspace menu is unchanged');
});


const PR = (n, state = 'OPEN', repo = 'worca/worka-cc') => ({ state, url: `https://github.com/${repo}/pull/${n}`, number: n });
const FEATURE = (extra = {}) => ({ kind: 'feature', position: 2, total: 3, prev: { label: 'Run 1', href: '#history/w/p1' },
  buildsOn: true, root: 'dev', shipMode: null, prevPrMerged: false, ...extra });
const say = (ps) => ps.map((p) => p.text).join('');
const placeOf = (ps) => ps.map((p) => p.text).join(' ');
const shape = (r) => r && { rows: r.rows.map((x) => [x.kind, x.state, placeOf(x.place), say(x.second)]),
  fold: r.fold ? [r.fold.state, say(r.fold.parts)] : null, current: r.current };
const KEPT = { provisional: false, recovery: { href: '/api/x/recovery-patch', download: 'p.patch' } };
const RUN2 = { branch: 'feat/run-2-command-summaries-helper-job', source: 'feat/command-summaries-in-chat-911', base: 'feat/command-summaries-in-chat-911' };
const WS = (members, m = M('in-review')) => F({ m, canCreatePr: false, workspace: { members } });
const WM = (key, name, extra = {}) => ({ key, name, branch: 'feat/checkout-v2', target: 'main', affected: true, pr: null, prStatus: null, ...extra });
const PR_ROW = (s = 'future', line = 'Opens when the changes are done') => ['pr', s, 'Pull request', line];
const LANDS = ['target', 'future', 'dev', 'Lands here when the pull request is merged'];

const ROUTE_CASES = {
  '1 no branch yet': [F({ m: M('working'), branch: '' }), { rows: [
    ['branch', 'future', "This run's branch", 'Created when the agents start building'], PR_ROW(), LANDS], fold: null, current: -1 }],
  '2 working': [F({ m: M('working', { pulse: true }), branch: 'feat/run-card-where-the-work-is' }), { rows: [
    ['branch', 'working', 'feat/run-card-where-the-work-is', "This run's branch · the agents are working here"], PR_ROW(), LANDS], fold: null, current: 0 }],
  '3 a run in a feature': [F({ m: M('working'), ...RUN2, group: FEATURE() }), { rows: [
    ['branch', 'working', RUN2.branch, "This run's branch · builds on Run 1 · the agents are working here"],
    PR_ROW('future', "Opens from the feature's Ship card once all 3 runs are done"),
    ['target', 'future', 'dev', 'Lands here when the feature ships']], fold: null, current: 0 }],
  '4 PR needs you': [F({ m: M('needs-you', { prNeeds: true }), branch: 'fix/git-sync-fetch-timeout-kills-process-group', pr: PR(912),
    prStatus: { checks: { state: 'failing' }, status: { label: '2 checks failing', tone: 'bad' }, watch: { watching: true, status: 'fixing', activePipelineId: 'p-fix' } } }), { rows: [
    ['branch', 'done', 'fix/git-sync-fetch-timeout-kills-process-group', "This run's branch · changes done"],
    ['pr', 'problem', 'Pull request worca/worka-cc#912', '2 checks failing · Fixing · View fix run'], LANDS], fold: null, current: 1 }],
  '5 PR with reviewers': [F({ m: M('in-review'), branch: 'feat/runs-list-keyboard-select', pr: PR(914),
    prStatus: { checks: { state: 'passing' }, status: { label: 'Review required', detail: '4 checks passed', tone: 'ok' }, watch: null } }), { rows: [
    ['branch', 'done', 'feat/runs-list-keyboard-select', "This run's branch · changes done"],
    ['pr', 'review', 'Pull request worca/worka-cc#914', '4 checks passed'], LANDS], fold: null, current: 1 }],
  '6 failed, work kept': [F({ m: FAILED, branch: 'feat/run-card-where-the-work-is', kept: KEPT }), { rows: [
    ['branch', 'failed', 'feat/run-card-where-the-work-is', 'Changes not committed · Download patch · Commit it yourself'],
    PR_ROW('future', 'Not opened'), ['target', 'future', 'dev', 'Not merged']], fold: null, current: 0 }],
  '7 same as source': [F({ push: true, source: 'dev' }), { rows: [
    ['branch', 'done', 'dev', 'Committed here on this machine'],
    ['remote', 'future', 'origin/dev', 'Not pushed yet · Push from the button above']], fold: null, current: 0 }],
  '7b not merged back': [F({ notMergedBack: true, source: 'dev', branch: 'feat/x' }), { rows: [
    ['branch', 'done', 'feat/x', "This run's branch · changes done"],
    ['branch', 'problem', 'dev', 'Not merged back yet · How to merge from the button above'],
    ['remote', 'future', 'origin/dev', 'Not pushed yet']], fold: null, current: 1 }],
  '7c pushed folds': [F({ push: true, source: 'dev', pushState: { state: 'pushed', remote: 'origin' } }), { rows: [
    ['branch', 'done', 'dev', 'Committed here on this machine'], ['remote', 'done', 'origin/dev', 'Pushed']],
    fold: ['done', 'Pushed to origin/dev'], current: 1 }],
  '8 folder project': [F({ mode: 'folder', gitChrome: false, folder: { state: 'pending', total: 5, dir: '~/Projects/site' } }), { rows: [
    ['folder', 'done', "The run's copy", '5 files changed'],
    ['folder', 'future', '~/Projects/site', 'Ready to apply · Apply or Discard from the button above']], fold: null, current: 0 }],
  '8b folder applied folds': [F({ mode: 'folder', gitChrome: false, folder: { state: 'applied', total: 5, dir: '~/Projects/site' } }), { rows: [
    ['folder', 'done', "The run's copy", '5 files changed'], ['folder', 'done', '~/Projects/site', 'Applied']],
    fold: ['done', 'Applied to ~/Projects/site'], current: 1 }],
  '9 feature shipped stacked': [F({ m: M('in-review'), ...RUN2, pr: PR(916), group: FEATURE({ shipMode: 'stacked' }),
    prStatus: { status: { label: 'Review required', detail: '1 approval needed', tone: '' }, watch: null } }), { rows: [
    ['branch', 'done', RUN2.branch, "This run's branch · builds on Run 1"],
    ['pr', 'review', 'Pull request worca/worka-cc#916', "1 approval needed · stacked on Run 1's pull request"],
    ['target', 'future', 'dev', "Lands here after Run 1's pull request merges"]], fold: null, current: 1 }],
  '10 feature shipped as one PR': [F({ m: M('in-review'), ...RUN2, pr: PR(915), group: FEATURE({ shipMode: 'one' }),
    prStatus: { status: { label: 'Review required', detail: '1 approval needed', tone: '' }, watch: null } }), { rows: [
    ['branch', 'done', RUN2.branch, "This run's branch · builds on Run 1"],
    ['pr', 'review', "The feature's pull request worca/worka-cc#915", '1 approval needed · carries all 3 runs'], LANDS], fold: null, current: 1 }],
  '11 workspace': [WS([WM('a', 'api', { pr: PR(41, 'OPEN', 'acme/api'), prStatus: { mergeable: 'CONFLICTING', watch: null } }),
    WM('w', 'web', { pr: PR(88, 'MERGED', 'acme/web') }), WM('d', 'docs', { affected: false })], M('needs-you', { prNeeds: true })), { rows: [
    ['pr', 'problem', 'api feat/checkout-v2 → main', 'Pull request acme/api#41 · conflicts with main'],
    ['pr', 'merged', 'web feat/checkout-v2 → main', 'Pull request acme/web#88 · merged'],
    ['branch', 'future', 'docs', 'No changes in this repository']], fold: null, current: 0 }],
  '12 merged folded': [F({ m: M('merged'), branch: 'feat/run-card-drop-repeated-facts', pr: PR(905, 'MERGED') }), { rows: [
    ['branch', 'done', 'feat/run-card-drop-repeated-facts', "This run's branch · changes done"],
    ['pr', 'done', 'Pull request worca/worka-cc#905', 'Merged'], ['target', 'merged', 'dev', 'Merged here']],
    fold: ['merged', 'Merged into dev · worca/worka-cc#905'], current: 2 }],
  '13 PR closed folded': [F({ branch: 'feat/x', pr: PR(901, 'CLOSED') }), { rows: [
    ['branch', 'done', 'feat/x', "This run's branch · changes done"],
    ['pr', 'closed', 'Pull request worca/worka-cc#901', 'Closed without merging'], ['target', 'future', 'dev', 'Not merged']],
    fold: ['closed', 'worca/worka-cc#901 closed without merging'], current: 1 }],
  '14 workspace, every repository merged': [WS([WM('a', 'api', { pr: PR(41, 'MERGED', 'acme/api') }), WM('w', 'web', { pr: PR(88, 'MERGED', 'acme/web') }),
    WM('d', 'docs', { affected: false })], M('merged')), { rows: [
    ['pr', 'merged', 'api feat/checkout-v2 → main', 'Pull request acme/api#41 · merged'],
    ['pr', 'merged', 'web feat/checkout-v2 → main', 'Pull request acme/web#88 · merged'],
    ['branch', 'future', 'docs', 'No changes in this repository']],
    fold: ['merged', 'Merged in 2 repositories · acme/api#41 · acme/web#88'], current: 1 }],
  'chain run': [F({ m: M('working'), branch: 'feat/c2', source: 'feat/c1', base: 'feat/c1', group: FEATURE({ kind: 'chain', total: 2 }) }), { rows: [
    ['branch', 'working', 'feat/c2', "This run's branch · builds on Run 1 · the agents are working here"],
    PR_ROW('future', "Opens from the chain's Ship card once all 2 runs are done"),
    ['target', 'future', 'dev', 'Lands here when the chain ships']], fold: null, current: 0 }],
  'group still loading': [F({ m: M('merged'), ...RUN2, pr: PR(915, 'MERGED'), groupPending: true }), { rows: [
    ['branch', 'done', RUN2.branch, "This run's branch · changes done"],
    ['pr', 'done', 'Pull request worca/worka-cc#915', 'Merged'], ['target', 'merged', 'The base branch', 'Merged here']],
    fold: ['merged', 'Merged into the base branch · worca/worka-cc#915'], current: 2 }],
};

test('route: every mocked case returns its rows, states, status lines, fold and current row', () => {
  // 14 mocked cases + 7b, 7c, 8b, the chain run and the group-still-loading case: a dropped case fails here.
  assert.equal(Object.keys(ROUTE_CASES).length, 19);
  for (const [name, [f, want]] of Object.entries(ROUTE_CASES)) assert.deepEqual(shape(routeModel(f)), want, name);
});

test('route: edge rows — a live workspace, a discarded folder, a failed folder run, a stacked PR with no previous run', () => {
  const live = routeModel(WS([WM('a', 'api'), WM('w', 'web', { branch: '' })], M('working')));
  assert.deepEqual(shape(live).rows.map((r) => r.slice(1)), [['working', 'api feat/checkout-v2', 'The agents are working here'],
    ['working', 'web', 'The agents are working here']]);
  assert.equal(live.fold, null);
  const gone = routeModel(F({ mode: 'folder', gitChrome: false, folder: { state: 'discarded', total: 2, dir: '/p' } }));
  assert.deepEqual(shape(gone).fold, ['closed', 'Discarded, your folder was not changed']);
  assert.equal(gone.rows[1].state, 'closed');
  assert.equal(routeModel(F({ mode: 'folder', gitChrome: false, m: FAILED, folder: { state: 'pending', total: 0 } })).rows[0].state, 'failed');
  const lone = routeModel(F({ m: M('in-review'), ...RUN2, pr: PR(916), group: FEATURE({ shipMode: 'stacked', prev: null, buildsOn: false }) }));
  assert.equal(say(lone.rows[2].second), 'Lands here when the pull request is merged', 'no previous run: no "after Run N"');
});

test('route: hidden for a stopped run without kept work, a waiting run and a project without git; a stopped run with kept work shows', () => {
  assert.equal(routeModel(F({ m: M('stopped') })), null);
  assert.equal(routeModel(F({ m: M('waiting') })), null);
  assert.equal(routeModel(F({ mode: 'none', gitChrome: false })), null);
  assert.equal(shape(routeModel(F({ m: M('stopped'), kept: KEPT, branch: 'feat/x' }))).rows[0][1], 'problem');
});

test('route: a feature run built on Run 1\'s branch never reads "Merged into" that branch; dev is where it lands', () => {
  const prev = 'feat/command-summaries-in-chat-911';
  // Every visible word of the route, parts joined as the DOM joins them (a JSON regex cannot see across parts).
  const texts = (r) => [...r.rows.flatMap((x) => [placeOf(x.place), say(x.second)]), r.fold ? say(r.fold.parts) : ''].join('|');
  const runs = [F({ m: M('merged'), ...RUN2, group: FEATURE() }), F({ m: M('ready'), ...RUN2, group: FEATURE() }),
    F({ m: M('merged'), ...RUN2, pr: PR(915, 'MERGED'), group: FEATURE({ shipMode: 'one' }) }),
    F({ m: M('merged'), ...RUN2, pr: PR(915, 'MERGED'), groupPending: true }),
    // M1: Run 1's History row is missing (archived): whether Run 2 builds on it is unknown, root unknown too.
    F({ m: M('merged'), ...RUN2, pr: PR(915, 'MERGED'), group: FEATURE({ buildsOn: null, root: '' }) }),
    F({ m: M('merged'), ...RUN2, group: FEATURE({ buildsOn: null, root: '' }) })];
  for (const f of runs) {
    const r = routeModel(f);
    assert.ok(!texts(r).includes(prev), `the previous run's branch is nowhere in: ${texts(r)}`);
    const line = (headModel(f).status && headModel(f).status.line) || '';
    assert.ok(!line.includes(prev), `nor in the head line: ${line}`);
  }
  for (const f of runs.slice(0, 3)) assert.equal(routeModel(f).rows.at(-1).place[0].text, 'dev');
  // Negative control: the same run with no group facts at all (the old landing, f.base) does name it, so the check bites.
  const old = routeModel(F({ m: M('merged'), ...RUN2, pr: PR(915, 'MERGED') }));
  assert.ok(texts(old).includes(`Merged into ${prev}`), 'without the group the fold falls back to f.base');
  assert.equal(say(routeModel(F({ m: M('ready'), ...RUN2, group: FEATURE() })).rows[2].second), 'Lands here when the feature ships');
  const shipped = routeModel(F({ m: M('merged'), ...RUN2, pr: PR(915, 'MERGED'), group: FEATURE({ shipMode: 'one' }) }));
  assert.equal(say(shipped.fold.parts), 'Merged into dev · worca/worka-cc#915');
  assert.equal(headModel(F({ m: M('merged'), ...RUN2, pr: PR(915, 'MERGED'), group: FEATURE() })).status.line, 'Merged', 'the route says where');
  // Root unknown (History not loaded): a place word, never the previous run's branch.
  const unknown = routeModel(F({ m: M('ready'), ...RUN2, group: FEATURE({ root: '' }) }));
  assert.equal(placeOf(unknown.rows[2].place), "The feature's base branch");
  assert.equal(landingOf(F({ ...RUN2, group: FEATURE({ root: '' }) })), '');
  assert.equal(landingOf(F({ ...RUN2, group: FEATURE({ buildsOn: null, root: '' }) })), '', 'builds-on unknown: never f.base');
  assert.equal(landingOf(F({ ...RUN2, group: FEATURE({ buildsOn: null }) })), 'dev', 'builds-on unknown: the root is still right');
  // A conflicting stacked PR names its real base (the PR's), the status line's words unchanged.
  const conf = F({ m: CONFLICTS, ...RUN2, pr: PR(916), prStatus: { watch: { watching: false, status: 'idle' } }, group: FEATURE({ shipMode: 'stacked' }) });
  assert.equal(headModel(conf).status.line, `Needs you · conflicts with ${prev}`);
});

test('route: stacked lands after Run N\'s PR merges, then when its own PR merges', () => {
  const f = (prevPrMerged) => F({ m: M('in-review'), ...RUN2, pr: PR(916), group: FEATURE({ shipMode: 'stacked', prevPrMerged }) });
  assert.equal(say(routeModel(f(false)).rows[2].second), "Lands here after Run 1's pull request merges");
  assert.equal(say(routeModel(f(true)).rows[2].second), 'Lands here when the pull request is merged');
  assert.doesNotMatch(say(routeModel(f(true)).rows[1].second), /stacked on/);
});

test('routeGroupOf: previous run, builds-on, the feature\'s base and ship mode from loaded History rows', () => {
  const members = [{ position: 1, pipelineId: 'p1', href: '#history/w/p1' }, { position: 2, pipelineId: 'p2', href: '#history/w/p2' }, { position: 3, pipelineId: 'p3', href: '' }];
  const home = (kind = 'feature', i = 1, extra = {}) => ({ row: { groupKind: kind, members: members.map((x, j) => (j === i ? { ...x, ...extra } : x)) },
    get member() { return this.row.members[i]; }, position: i + 1, total: 3 });
  const H = (prs = {}) => (id) => ({ p1: { branch: 'feat/command-summaries-in-chat-911', sourceBranch: 'dev', pr: prs.p1 || null },
    p2: { branch: 'feat/run-2', sourceBranch: 'feat/command-summaries-in-chat-911', pr: prs.p2 || null },
    p3: { branch: 'feat/run-3', sourceBranch: 'feat/run-2', pr: prs.p3 || null } })[id] || null;
  const src = 'feat/command-summaries-in-chat-911';
  assert.deepEqual(routeGroupOf(home(), { sourceBranch: src, histOf: H() }), { kind: 'feature', position: 2, total: 3,
    prev: { label: 'Run 1', href: '#history/w/p1' }, buildsOn: true, root: 'dev', shipMode: null, prevPrMerged: false });
  const one = PR(915);
  assert.equal(routeGroupOf(home(), { sourceBranch: src, histOf: H({ p1: one, p2: one, p3: one }) }).shipMode, 'one');
  const g = routeGroupOf(home(), { sourceBranch: src, histOf: H({ p1: PR(914, 'MERGED'), p2: PR(916) }) });
  assert.deepEqual([g.shipMode, g.prevPrMerged], ['stacked', true]);
  assert.equal(routeGroupOf(home(), { sourceBranch: 'dev', histOf: H() }).buildsOn, false, 'a follow-up run starts from the base');
  assert.equal(routeGroupOf(home('chain', 1, { stacks: true }), { sourceBranch: src, histOf: () => null }).buildsOn, true, 'no History: the chain flag');
  assert.equal(routeGroupOf(home('chain', 1, { stacks: true }), { sourceBranch: src, histOf: () => null }).root, '');
  // M1: Run 1 has no History row (archived, or /api/history not answered) and the member carries no chain flag: unknown.
  const only2 = (id) => (id === 'p2' ? H()(id) : null);
  assert.equal(routeGroupOf(home(), { sourceBranch: src, histOf: only2 }).buildsOn, null, 'no previous row, no flag: unknown');
  assert.equal(routeGroupOf(home('chain', 1, { stacks: false }), { sourceBranch: src, histOf: only2 }).buildsOn, false, 'the chain flag decides');
  assert.equal(routeGroupOf(home('user'), { sourceBranch: src, histOf: H() }), null);
  assert.equal(routeGroupOf(home('feature', 0), { sourceBranch: 'dev', histOf: H() }).root, 'dev');
  assert.equal(routeGroupOf(null), null);
});

test('prRef: owner/repo#N for GitHub, #N elsewhere', () => {
  assert.equal(prRef(PR(912)), 'worca/worka-cc#912');
  assert.equal(prRef({ url: 'https://dev.azure.com/o/p/_git/r/pullrequest/7', number: 7 }), '#7');
  assert.equal(prRef({ url: 'https://dev.azure.com/o/p/_git/r/pullrequest/7', number: null }), '#7', 'a PR opened in this session has no number yet');
  assert.equal(prRef({ url: 'https://bitbucket.org/acme/api/pull-requests/12', number: null }), '#12');
  assert.equal(prRef({ url: 'https://bitbucket.org/acme/api/pull-requests/12/overview', number: null }), '#12');
});

const routeWin = () => new JSDOM('<!doctype html><body><div class="rd-route" hidden></div><div class="rd-route b" hidden></div></body>',
  { url: 'http://localhost/' }).window;

test('route DOM: an ordered list, aria-current on the current row, the full branch in title, copy copies it', () => {
  const win = routeWin();
  const host = win.document.querySelector('.rd-route');
  const copied = [];
  renderRoute(host, routeModel(ROUTE_CASES['4 PR needs you'][0]), { storage: win.localStorage, onCopy: (b, name) => copied.push([b.className, name]) });
  assert.equal(host.hidden, false);
  assert.equal(host.querySelector('.rd-route-label').textContent, 'Where the work is');
  const ol = host.querySelector('ol.rd-route-list');
  assert.equal(ol.children.length, 3);
  const cur = ol.querySelectorAll('li[aria-current="step"]');
  assert.equal(cur.length, 1);
  assert.equal(cur[0], ol.children[1], 'the pull request row is current');
  assert.deepEqual([...ol.querySelectorAll('.rd-route-dot')].map((d) => d.getAttribute('aria-label')), ['Done', 'Needs you', 'Not yet']);
  const name = ol.querySelector('.rd-route-name');
  assert.equal(name.title, 'fix/git-sync-fetch-timeout-kills-process-group');
  const copy = ol.querySelector('button.rd-route-copy');
  assert.equal(copy.getAttribute('aria-label'), 'Copy branch name fix/git-sync-fetch-timeout-kills-process-group');
  copy.click();
  assert.deepEqual(copied, [['btn btn-sm btn-quiet copy-btn btn-icon rd-route-copy', 'fix/git-sync-fetch-timeout-kills-process-group']]);
  assert.equal(ol.querySelectorAll('button.rd-route-copy').length, 1, 'copy only on the run\'s own branch');
  const pr = ol.children[1].querySelector('a.rd-fact-link');
  assert.equal(pr.getAttribute('href'), 'https://github.com/worca/worka-cc/pull/912');
  assert.equal(pr.target, '_blank');
  // The list is named by its visible label.
  assert.equal(ol.getAttribute('aria-labelledby'), host.querySelector('.rd-route-label').id);
  assert.notEqual(host.querySelector('.rd-route-label').id, '');
  // Case 5: the new "With reviewers" word and the blue review circle (D9, D10).
  renderRoute(host, routeModel(ROUTE_CASES['5 PR with reviewers'][0]), { storage: win.localStorage });
  const dots5 = [...host.querySelectorAll('.rd-route-dot')];
  assert.deepEqual(dots5.map((d) => d.getAttribute('aria-label')), ['Done', 'With reviewers', 'Not yet']);
  assert.ok(dots5[1].classList.contains('is-review'));
  // Hidden case.
  renderRoute(host, routeModel(F({ m: M('stopped') })), { storage: win.localStorage });
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
});

test('route DOM: an end state folds; Show route opens the rows, keeps focus, and is remembered for the next run', () => {
  const win = routeWin();
  const store = win.localStorage;
  const [a, b] = win.document.querySelectorAll('.rd-route');
  renderRoute(a, routeModel(ROUTE_CASES['12 merged folded'][0]), { storage: store });
  assert.equal(a.querySelector('ol'), null);
  assert.equal(a.querySelector('.rd-route-fold').textContent, 'Merged into dev · worca/worka-cc#905');
  const t = a.querySelector('button.rd-route-toggle');
  assert.equal(t.textContent, 'Show route');
  assert.equal(t.getAttribute('aria-expanded'), 'false');
  t.focus();
  t.click();
  assert.equal(a.querySelectorAll('ol.rd-route-list > li').length, 3);
  assert.equal(win.document.activeElement, a.querySelector('button.rd-route-toggle'), 'the rebuilt toggle keeps focus');
  assert.equal(a.querySelector('button.rd-route-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(store.getItem(ROUTE_OPEN_KEY), '1');
  assert.equal(routeOpenWanted(store), true);
  // Another run's page reads the same choice.
  renderRoute(b, routeModel(ROUTE_CASES['13 PR closed folded'][0]), { storage: store });
  assert.equal(b.querySelectorAll('ol.rd-route-list > li').length, 3);
  b.querySelector('button.rd-route-toggle').click();
  assert.equal(store.getItem(ROUTE_OPEN_KEY), '0');
  assert.ok(b.querySelector('.rd-route-fold'));
  // A route in progress has no toggle, whatever the choice.
  setRouteOpen(false, store);
  renderRoute(a, routeModel(ROUTE_CASES['2 working'][0]), { storage: store });
  assert.equal(a.querySelector('.rd-route-toggle'), null);
  assert.ok(a.querySelector('ol'));
});

test('route DOM: every control the facts rows had sits in a route row\'s second line', () => {
  const win = routeWin();
  const host = win.document.querySelector('.rd-route');
  const calls = [];
  const h = { storage: win.localStorage, onCommit: () => calls.push('commit'), onWatch: (el) => calls.push(`watch:${el.textContent}`),
    fixRunHref: (pid) => `#history/w/${pid}`, onFixRun: (e, pid) => calls.push(`fix:${pid}`) };
  const second = (el) => assert.ok(el && el.closest('.rd-route-second'), `${el && el.textContent} is in a second line`);
  // Download patch, Commit it yourself.
  renderRoute(host, routeModel(F({ m: FAILED, branch: 'feat/x', kept: KEPT })), h);
  const patch = host.querySelector('a.rd-fact-link[download="p.patch"]');
  assert.equal(patch.textContent, 'Download patch'); second(patch);
  const commit = host.querySelector('button.rd-fact-act');
  assert.equal(commit.textContent, 'Commit it yourself'); second(commit);
  commit.click();
  // Checks label/detail (prSecond), Watching ▾ at Advanced, View fix run.
  renderRoute(host, routeModel(F({ m: M('in-review'), branch: 'feat/x', pr: PR(914), level: 'advanced',
    prStatus: { checks: { state: 'failing' }, status: { label: 'Review required', detail: '2 checks failing', tone: 'bad' }, watch: { watching: true, status: 'idle' } } })), h);
  const checks = [...host.querySelectorAll('.rd-fact-tx.is-bad')].find((x) => x.textContent === '2 checks failing'); second(checks);
  const watch = host.querySelector('button.rd-fact-watch');
  assert.match(watch.textContent, /Watching/); second(watch);
  watch.click();
  renderRoute(host, routeModel(F({ m: M('in-review'), branch: 'feat/x', pr: PR(914), level: 'advanced',
    prStatus: { watch: { watching: true, status: 'fixing', activePipelineId: 'p-fix' } } })), h);
  const fix = [...host.querySelectorAll('a.rd-fact-link')].find((x) => x.textContent === 'View fix run');
  assert.equal(fix.getAttribute('href'), '#history/w/p-fix'); second(fix);
  fix.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  // Below Advanced the Watch words are plain text, no menu.
  renderRoute(host, routeModel(F({ m: M('in-review'), branch: 'feat/x', pr: PR(914), level: 'simple',
    prStatus: { watch: { watching: true, status: 'fixing', activePipelineId: 'p-fix' } } })), h);
  assert.equal(host.querySelector('button.rd-fact-watch'), null);
  // ASK_IN_CHAT and resolveError, each on its own line.
  renderRoute(host, routeModel(F({ m: STOPPED_WATCH, branch: 'feat/x', pr: PR(866),
    prStatus: { watch: { watching: true, status: 'needs-person' }, resolveError: 'Could not merge dev in' } })), h);
  const lines = [...host.querySelectorAll('.rd-route-second .is-line')].map((x) => x.textContent);
  assert.deepEqual(lines, [ASK_IN_CHAT, 'Could not merge dev in']);
  for (const x of host.querySelectorAll('.rd-route-second .is-line')) second(x);
  assert.deepEqual(calls, ['commit', 'watch:Watching', 'fix:p-fix']);
});

test('route DOM: hostile branch, member and PR text renders as inert text', () => {
  const win = routeWin();
  const host = win.document.querySelector('.rd-route');
  const evil = '<img src=x onerror=alert(1)>';
  renderRoute(host, routeModel(WS([WM('a', evil, { branch: evil, pr: PR(41, 'OPEN', 'acme/api'), prStatus: { status: { label: evil } } })])), { storage: win.localStorage });
  renderRoute(win.document.querySelectorAll('.rd-route')[1], routeModel(F({ m: M('working'), branch: evil })), { storage: win.localStorage });
  assert.equal(win.document.querySelector('img'), null);
  assert.match(win.document.body.textContent, /<img src=x/);
});

test('route DOM: the remote row draws the remote icon; focus keys are unique across workspace rows', () => {
  const win = routeWin();
  const [a, b] = win.document.querySelectorAll('.rd-route');
  renderRoute(a, routeModel(ROUTE_CASES['7 same as source'][0]), { storage: win.localStorage });
  const want = icon(win.document, 'remote', 11, 'ic rd-route-ic').innerHTML;
  assert.equal(a.querySelectorAll('.rd-route-dot')[1].querySelector('.rd-route-ic').innerHTML, want);
  const st = { watch: { watching: true, status: 'idle' } };
  renderRoute(b, routeModel({ ...WS([WM('a', 'api', { pr: PR(41, 'OPEN', 'acme/api'), prStatus: st }),
    WM('w', 'web', { pr: PR(88, 'OPEN', 'acme/web'), prStatus: st })], M('in-review')), level: 'advanced' }), { storage: win.localStorage });
  const keys = [...b.querySelectorAll('[data-route]')].map((x) => x.dataset.route);
  assert.deepEqual(keys, ['watch-0', 'watch-1'], 'one Watching ▾ per member row, each with its own key');
  // Two hosts, two label ids.
  assert.notEqual(a.querySelector('.rd-route-label').id, b.querySelector('.rd-route-label').id);
});

test('route: Show route falls back to memory only when the store throws', () => {
  const broken = { getItem() { throw new Error('private'); }, setItem() { throw new Error('private'); } };
  setRouteOpen(true, broken);
  assert.equal(routeOpenWanted(broken), true);
  setRouteOpen(false, broken);
  assert.equal(routeOpenWanted(broken), false);
  setRouteOpen(true, broken);                       // the memo now says open: a working store must not read it
  const store = new Map();
  const ok = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.equal(routeOpenWanted(ok), false, 'a fresh store reads folded');
  setRouteOpen(false, broken);
});

test('route CSS: 20px circles, an ellipsis on mono names, sentence-case 12px --ink-2 label, the copied tick', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.rd-route-dot\{[^}]*width:20px;height:20px;/);
  assert.match(css, /\.rd-route-name\{[^}]*text-overflow:ellipsis;/);
  assert.match(css, /\.rd-route-row\.is-linked::before\{background:var\(--green\);\}/);
  assert.match(css, /\.rd-route\[hidden\]\{display:none;\}/);
  assert.match(css, /\.rd-route-label\{font-size:var\(--fs-meta\);color:var\(--ink-2\);\}/);
  assert.match(css, /\.rd-route-second\{[^}]*overflow-wrap:anywhere;/);
  // the copied tick is the shared copy button's (copy-button.mjs, design-system.md › Copy button)
  assert.match(css, /\.copy-btn:is\(\.copied,\.copy-miss\) \.ico-copy\{display:none;\}/);
  assert.match(css, /\.copy-btn\.copied \.ico-check\{display:inline-flex;color:var\(--green-ink\);\}/);
  assert.doesNotMatch(css, /\.rd-route[^{]*\{[^}]*text-transform:uppercase/);
  // Split needles, so the removed-symbol grep (Testing) finds no line in this file either.
  assert.doesNotMatch(css, new RegExp(['\\.rd-' + 'track', '\\.rd-page-' + 'branch'].join('|')), 'the tracker and the Branch chip are gone');
});

test('CSS: fact labels never wrap', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /^\.rd-kv-k\{[^}]*white-space:nowrap;/m);
});
