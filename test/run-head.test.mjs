// test/run-head.test.mjs — slice 3: the run page card's head (status words, head buttons, View PR ▾ items) and its
// read-only tracker, over the request's state table. Pure: no app boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { headModel, trackerModel, renderTracker, renderHeadButtons, prMenuItems, trackerWatchWords, canResolvePr,
  showsFixConflicts, hdPrWatchLabel } from '../ui/public/run-head.mjs';

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
const doc = () => new JSDOM('<!doctype html><body><div class="rd-track"></div><div class="acts"></div></body>').window.document;
const steps = (f) => {
  const d = doc();
  const host = d.querySelector('.rd-track');
  renderTracker(host, trackerModel(f), {});
  return [...host.querySelectorAll('.rd-track-step')];
};
const cls = (s) => s.className.replace('rd-track-step ', '');

const TABLE = {
  working: [F({ m: M('working', { pulse: true }) }), 'live', null, []],
  ready: [F(), 'ready', 'Ready to ship · not in dev yet', ['try']],
  pending: [F({ prInput: 'PENDING' }), 'ready', 'Ready to ship · not in dev yet', ['try']],
  push: [F({ push: true }), 'push', 'Ready to ship · in main here, not on the remote', ['try']],
  'pr closed': [F({ pr: { ...OPEN, state: 'CLOSED' } }), 'pr-closed', 'Ready to ship · the PR was closed', ['try']],
  'in review': [F({ m: M('in-review'), pr: OPEN, prStatus: { status: { label: 'Review required' }, watch: null } }), 'in-review', 'In review · waiting for a review', []],
  conflicts: [F({ m: CONFLICTS, pr: OPEN, prStatus: { watch: { watching: false, status: 'idle' } } }), 'conflicts', 'Needs you · conflicts with dev', ['fix-conflicts']],
  'watch stopped': [F({ m: STOPPED_WATCH, pr: OPEN, prStatus: { watch: { watching: true, status: 'needs-person' } } }), 'watch-stopped', null, ['ask-changes']],
  merged: [F({ m: M('merged', { dot: 'violet' }), pr: { ...OPEN, state: 'MERGED' } }), 'merged', 'Merged · your changes are in dev', []],
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
  assert.deepEqual(headModel(F({ push: true })).cta, { state: 'push', label: 'Push main' });
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

test('head: Watch stopped keeps the model line and draws Ask for changes disabled, titled for the chat', () => {
  const h = headModel(TABLE['watch stopped'][0]);
  assert.equal(h.status, null);
  assert.deepEqual(h.after.map((b) => [b.id, !!b.primary, !!b.disabled, b.title]), [['ask-changes', true, true, "Ask for changes from the run's chat"]]);
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

test('needle (b): three steps with the node classes for ready, in review, conflicts, merged and closed', () => {
  const d = doc();
  const cases = {
    ready: [F(), ['is-current is-ready', 'is-future', 'is-future']],
    'in review': [F({ m: M('in-review'), pr: OPEN }), ['is-done', 'is-current is-ready', 'is-future']],
    conflicts: [F({ m: M('needs-you', { prNeeds: true, pr: { id: 'conflicts' } }), pr: OPEN }), ['is-done', 'is-problem', 'is-future']],
    merged: [F({ m: M('merged'), pr: { ...OPEN, state: 'MERGED' } }), ['is-done', 'is-done', 'is-current is-merged']],
    closed: [F({ pr: { ...OPEN, state: 'CLOSED' } }), ['is-done', 'is-closed', 'is-future']],
  };
  for (const [name, [facts, want]] of Object.entries(cases)) {
    const host = d.querySelector('.rd-track');
    renderTracker(host, trackerModel(facts), {});
    const s = [...host.querySelectorAll('.rd-track-step')];
    assert.equal(s.length, 3, name);
    assert.deepEqual(s.map(cls), want, name);
  }
});

test('tracker: kept work on a stopped or failed run keeps its Download patch and Commit it yourself; stopped alone hides', () => {
  const kept = { provisional: false, recovery: { href: '/api/x/recovery-patch', download: 'p.patch' } };
  const stopped = steps(F({ m: M('stopped'), kept }));
  assert.equal(stopped.length, 3);
  assert.equal(cls(stopped[0]), 'is-problem');
  assert.equal(stopped[0].querySelector('a.rd-track-link').textContent, 'Download patch');
  assert.equal(stopped[0].querySelector('a.rd-track-link').getAttribute('download'), 'p.patch');
  assert.equal(stopped[0].querySelector('button.rd-track-act').textContent, 'Commit it yourself');
  const failed = steps(F({ m: FAILED, kept }));
  assert.equal(cls(failed[0]), 'is-failed');
  assert.ok(failed[0].querySelector('a.rd-track-link'));
  assert.ok(failed[0].querySelector('button.rd-track-act'));
  assert.equal(trackerModel(F({ m: M('stopped') })), null);
  assert.equal(trackerModel(F({ m: M('waiting') })), null);
  assert.equal(trackerModel(F({ mode: 'none', gitChrome: false })), null);
});

test('tracker: Watch stopped explains the disabled Ask for changes in visible text on the PR step', () => {
  const s = steps(TABLE['watch stopped'][0]);
  assert.equal(cls(s[1]), 'is-problem');
  assert.match(s[1].textContent, /Ask for changes from the run's chat/);
  assert.match(s[1].textContent, /Watch stopped/);
});

test('tracker: the folder path has 2 steps; a workspace draws one named row per member', () => {
  const f = steps(TABLE.folder[0]);
  assert.equal(f.length, 2);
  assert.deepEqual(f.map(cls), ['is-done', 'is-current is-ready']);
  assert.deepEqual(steps(F({ mode: 'folder', gitChrome: false, folder: { state: 'discarded', total: 3 } })).map(cls), ['is-done', 'is-closed']);
  const d = doc();
  const host = d.querySelector('.rd-track');
  renderTracker(host, trackerModel(TABLE.workspace[0]), {});
  const rows = [...host.querySelectorAll('.rd-track-row.has-name')];
  assert.deepEqual(rows.map((r) => r.querySelector('.rd-track-name').textContent), ['app', 'api']);
  assert.equal(rows[0].querySelectorAll('.rd-track-step').length, 3);
});

test('tracker: workspace rows read their own PR status (one member conflicts, the other is clean)', () => {
  const f = F({ m: M('in-review'), workspace: { members: [
    { key: 'a', name: 'app', pr: OPEN, prStatus: { mergeable: 'CONFLICTING', watch: null } },
    { key: 'b', name: 'api', pr: { ...OPEN, number: 867 }, prStatus: { mergeable: 'MERGEABLE', watch: null } }] } });
  const d = doc();
  const host = d.querySelector('.rd-track');
  renderTracker(host, trackerModel(f), {});
  const rows = [...host.querySelectorAll('.rd-track-row')];
  assert.equal(cls(rows[0].querySelectorAll('.rd-track-step')[1]), 'is-problem');
  assert.equal(cls(rows[1].querySelectorAll('.rd-track-step')[1]), 'is-current is-ready');
});

test('tracker: a run that needs you for one member\'s conflicts leaves the clean member done and ready, not in progress', () => {
  const f = F({ m: M('needs-you', { prNeeds: true }), workspace: { members: [
    { key: 'a', name: 'app', pr: OPEN, prStatus: { mergeable: 'CONFLICTING', watch: null } },
    { key: 'b', name: 'api', pr: { ...OPEN, number: 867 }, prStatus: { mergeable: 'MERGEABLE', watch: null } }] } });
  const d = doc();
  const host = d.querySelector('.rd-track');
  renderTracker(host, trackerModel(f), {});
  const [a, b] = [...host.querySelectorAll('.rd-track-row')].map((r) => [...r.querySelectorAll('.rd-track-step')].map(cls));
  assert.deepEqual(a, ['is-done', 'is-problem', 'is-future']);
  assert.deepEqual(b, ['is-done', 'is-current is-ready', 'is-future']);
  // A run asking a question (needs-you, no PR reason) is still live for every member.
  const live = trackerModel({ ...f, m: M('needs-you') });
  for (const row of live.rows) assert.equal(row.steps[0].node, 'working');
});

test('tracker and head: hostile PR labels, member names and branch names render as inert text', () => {
  const evil = '<img src=x onerror="globalThis.__pwned=1">';
  const d = doc();
  const host = d.querySelector('.rd-track');
  renderTracker(host, trackerModel(F({ m: M('in-review'), base: evil, pr: OPEN, prStatus: { status: { label: evil, detail: evil }, watch: null },
  })), {});
  assert.equal(host.querySelector('img'), null);
  assert.match(host.textContent, /<img src=x/);
  renderTracker(host, trackerModel(F({ m: M('in-review'), workspace: { members: [{ key: 'a', name: evil, pr: OPEN, prStatus: null }] } })), {});
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelector('.rd-track-name').textContent, evil);
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

test('tracker: below Advanced the Watch words are plain text; at Advanced idle Watching opens the ▾ menu', () => {
  const watching = (level, status) => steps(F({ level, m: M('in-review'), pr: OPEN, prStatus: { watch: { watching: true, status } } }))[1];
  assert.equal(watching('simple', 'idle').querySelector('.rd-track-watch'), null);
  assert.doesNotMatch(watching('simple', 'idle').textContent, /Watching/);
  const fixing = watching('simple', 'fixing');
  assert.equal(fixing.querySelector('.rd-track-watch'), null);
  assert.equal(fixing.querySelector('span.rd-track-tx.is-run').textContent, 'Fixing');
  const adv = watching('advanced', 'idle').querySelector('button.rd-track-watch');
  assert.ok(adv);
  assert.equal(adv.textContent, 'Watching');
});

test('tracker: the PR step links #866 in a new tab, and a fixing watch links its fix run', () => {
  const d = doc();
  const host = d.querySelector('.rd-track');
  const f = F({ m: M('in-review'), pr: OPEN, prStatus: { watch: { watching: true, status: 'fixing', activePipelineId: 'p9' } } });
  renderTracker(host, trackerModel(f), { fixRunHref: (pid) => `#history/k/${pid}` });
  const pr = host.querySelector('a.rd-track-pr');
  assert.equal(pr.textContent, '#866');
  assert.equal(pr.target, '_blank');
  const fix = [...host.querySelectorAll('a.rd-track-link')].find((a) => a.textContent === 'View fix run');
  assert.equal(fix.getAttribute('href'), '#history/k/p9');
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
  assert.deepEqual(two.filter((i) => /^Open PR/.test(i.label || '')).map((i) => i.label), ['Open PR #866', 'Open PR #867']);
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
