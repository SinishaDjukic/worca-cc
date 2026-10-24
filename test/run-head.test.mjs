// test/run-head.test.mjs — slice 3: the run page card's head (status words, head buttons, View PR ▾ items) and its
// read-only tracker, over the request's state table. Pure: no app boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { headModel, groupHead, trackerModel, factsModel, renderTracker, renderFacts, renderHeadButtons, prMenuItems, trackerWatchWords,
  canResolvePr, showsFixConflicts, hdPrWatchLabel } from '../ui/public/run-head.mjs';

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
const KV = ['kept', 'pr', 'checks', 'watch'].map((k) => `<div class="rd-kv-row" data-fact="${k}" hidden><dt class="rd-kv-k"></dt><dd class="rd-kv-v"></dd></div>`).join('');
const doc = () => new JSDOM(`<!doctype html><body><div class="rd-track"></div><dl class="rd-kv">${KV}</dl><div class="acts"></div></body>`).window.document;
const steps = (f) => {
  const d = doc();
  const host = d.querySelector('.rd-track');
  renderTracker(host, trackerModel(f));
  return [...host.querySelectorAll('.rd-track-step')];
};
/** The facts list after renderFacts: `row(key)` is the shown row's value (null when hidden), `merged` what onMerged got. */
const facts = (f, h = {}) => {
  const d = doc();
  const kv = d.querySelector('.rd-kv');
  let merged = null;
  renderFacts(kv, factsModel(f), { ...h, onMerged: (name) => { merged = name; } });
  const row = (key) => { const r = kv.querySelector(`[data-fact="${key}"]`); return r.hidden ? null : r.querySelector('.rd-kv-v'); };
  return { kv, row, merged, label: (key) => kv.querySelector(`[data-fact="${key}"] .rd-kv-k`).textContent };
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

test('tracker: kept work on a stopped or failed run is a Kept work fact (Download patch, Commit it yourself); stopped alone hides', () => {
  const kept = { provisional: false, recovery: { href: '/api/x/recovery-patch', download: 'p.patch' } };
  const stopped = steps(F({ m: M('stopped'), kept }));
  assert.equal(stopped.length, 3);
  assert.equal(cls(stopped[0]), 'is-problem');
  assert.equal(stopped[0].querySelector('a, button'), null, 'the step carries its label only');
  let commits = 0;
  const v = facts(F({ m: M('stopped'), kept }), { onCommit: () => { commits += 1; } }).row('kept');
  assert.equal(v.querySelector('a.rd-fact-link').textContent, 'Download patch');
  assert.equal(v.querySelector('a.rd-fact-link').getAttribute('download'), 'p.patch');
  const commit = v.querySelector('button.rd-fact-act');
  assert.equal(commit.textContent, 'Commit it yourself');
  commit.click();
  assert.equal(commits, 1);
  const failed = steps(F({ m: FAILED, kept }));
  assert.equal(cls(failed[0]), 'is-failed');
  assert.ok(facts(F({ m: FAILED, kept })).row('kept').querySelector('a.rd-fact-link'));
  assert.equal(facts(F({ m: M('working'), kept })).row('kept'), null, 'a live run offers no kept links');
  assert.equal(facts(F()).row('kept'), null);
  assert.equal(trackerModel(F({ m: M('stopped') })), null);
  assert.equal(trackerModel(F({ m: M('waiting') })), null);
  assert.equal(trackerModel(F({ mode: 'none', gitChrome: false })), null);
});

test('tracker: Watch stopped explains the disabled Ask for changes in visible text on the Watch fact', () => {
  const f = TABLE['watch stopped'][0];
  const s = steps(f);
  assert.equal(cls(s[1]), 'is-problem');
  assert.equal(s[1].textContent, 'Pull request');
  const w = facts(f).row('watch');
  assert.match(w.textContent, /Watch stopped/);
  const hint = w.querySelector('.is-line');
  assert.equal(hint.textContent, "Ask for changes from the run's chat");
});

test('tracker: the labels are static (Changes done · Pull request · Merged) in every PR state', () => {
  for (const f of [F(), F({ m: M('in-review'), pr: OPEN, base: 'release/2026.11-payments' }), TABLE.merged[0], F({ pr: { ...OPEN, state: 'CLOSED' } })]) {
    assert.deepEqual(steps(f).map((s) => s.querySelector('.rd-track-label').textContent), ['Changes done', 'Pull request', 'Merged']);
    assert.equal(steps(f).some((s) => s.children.length > 1), false, 'nothing under a step');
  }
});

test('facts: Merged names the base once the PR is merged (or the run is in its base); never for an open PR', () => {
  assert.equal(facts(TABLE.merged[0]).merged, 'dev');
  assert.equal(facts(F({ m: M('merged') })).merged, 'dev', 'in its base without a PR of its own');
  assert.equal(facts(F({ m: M('in-review'), pr: OPEN })).merged, '');
  assert.equal(facts(F()).merged, '');
  assert.equal(facts(F({ m: M('merged'), push: true })).merged, '', 'the push path has no Merged fact');
});

test('facts: the Pull request row is the shared PR chip (icon, PR #866, state word) linking to GitHub in a new tab', () => {
  const v = facts(F({ m: M('in-review'), pr: OPEN, prStatus: { checks: { state: 'passing', total: 14, failed: 0, pending: 0 }, status: { label: 'Ready to merge', detail: 'All 14 checks passed', tone: 'ok' } } })).row('pr');
  const a = v.querySelector('a.runs-pr.rd-fact-pr');
  assert.equal(a.getAttribute('href'), OPEN.url);
  assert.equal(a.target, '_blank');
  assert.equal(a.querySelector('.runs-pr-num').textContent, 'PR #866');
  assert.equal(a.querySelector('.runs-pr-word').textContent, 'Ready');
  assert.ok(a.classList.contains('is-ready'));
  const failing = facts(F({ m: M('in-review'), pr: OPEN, prStatus: { checks: { state: 'failing', total: 14, failed: 3, pending: 0 } } })).row('pr');
  assert.equal(failing.querySelector('.runs-pr-word').textContent, 'Checks failing');
  const merged = facts(TABLE.merged[0]).row('pr');
  assert.ok(merged.querySelector('a.runs-pr.is-merged'));
  const err = facts(F({ m: M('in-review'), pr: OPEN, prStatus: { resolveError: 'Could not resolve' } })).row('pr');
  assert.equal(err.querySelector('.rd-fact-tx.is-bad.is-line').textContent, 'Could not resolve');
});

test('facts: Checks is the checks line in its colour; the verdict stays in the status line; no Checks or Watch after merge', () => {
  const checks = (status, rollup) => facts(F({ m: M('in-review'), pr: OPEN, prStatus: { status, checks: rollup } })).row('checks');
  const passed = checks({ label: 'Review required', detail: 'All 14 checks passed', tone: 'wait' }, { state: 'passing' });
  assert.equal(passed.textContent, 'All 14 checks passed');
  assert.ok(passed.querySelector('.is-ok'));
  const failed = checks({ label: '3 of 14 checks failed', detail: '', tone: 'bad' }, { state: 'failing' });
  assert.equal(failed.textContent, '3 of 14 checks failed');
  assert.ok(failed.querySelector('.is-bad'));
  assert.ok(checks({ label: 'Checks running · 9 of 14 done', detail: '', tone: 'run' }, { state: 'pending' }).querySelector('.is-run'));
  assert.equal(checks({ label: 'Ready to merge', detail: '', tone: 'ok' }, null), null, 'no checks: no row, and never the verdict');
  const merged = facts({ ...TABLE.merged[0], prStatus: { status: { label: 'Ready to merge', detail: 'All 14 checks passed' }, checks: { state: 'passing' }, watch: { watching: true, status: 'idle' } } });
  assert.equal(merged.row('checks'), null);
  assert.equal(merged.row('watch'), null);
});

test('facts: a workspace lists one PR per line (name, chip) and Watch only for members whose watch acts', () => {
  const f = F({ m: M('in-review'), canCreatePr: false, workspace: { members: [
    { key: 'a', name: 'api', pr: OPEN, prStatus: { checks: { state: 'passing' }, watch: { watching: true, status: 'idle' } } },
    { key: 'b', name: 'web', pr: { ...OPEN, number: 87 }, prStatus: { checks: { state: 'failing' }, watch: { watching: true, status: 'fixing', activePipelineId: 'p9' } } },
    { key: 'c', name: 'docs', pr: null, prStatus: null }] } });
  const r = facts({ ...f, level: 'simple' }, { fixRunHref: (pid) => `#history/k/${pid}` });
  assert.equal(r.label('pr'), 'Pull requests');
  const list = r.row('pr').querySelector('.rd-fact-members');
  assert.deepEqual([...list.querySelectorAll('.rd-fact-member')].map((n) => n.textContent), ['api', 'web']);
  assert.deepEqual([...list.querySelectorAll('.runs-pr-num')].map((n) => n.textContent), ['PR #866', 'PR #87']);
  assert.equal(list.children.length, 4, 'name, value, name, value: one member per line');
  assert.equal(r.row('checks'), null, 'each chip carries its own state');
  const w = r.row('watch');
  assert.deepEqual([...w.querySelectorAll('.rd-fact-member')].map((n) => n.textContent), ['web'], 'idle Watching is Advanced+');
  assert.equal(w.querySelector('a.rd-fact-link').getAttribute('href'), '#history/k/p9');
  assert.equal(facts(F()).label('pr'), 'Pull request');
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
  const hostile = F({ m: M('in-review'), base: evil, pr: OPEN, prStatus: { status: { label: evil, detail: evil }, resolveError: evil, watch: null } });
  renderTracker(host, trackerModel(hostile));
  assert.equal(host.querySelector('img'), null);
  const kv = facts(hostile);
  assert.equal(kv.kv.querySelector('img'), null);
  assert.match(kv.row('checks').textContent, /<img src=x/);
  assert.match(kv.row('pr').textContent, /<img src=x/);
  const ws = F({ m: M('in-review'), workspace: { members: [{ key: 'a', name: evil, pr: OPEN, prStatus: null }] } });
  renderTracker(host, trackerModel(ws));
  assert.equal(host.querySelector('img'), null);
  assert.equal(host.querySelector('.rd-track-name').textContent, evil);
  assert.equal(facts(ws).row('pr').querySelector('.rd-fact-member').textContent, evil);
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

test('facts: below Advanced the Watch words are plain text; at Advanced idle Watching opens the ▾ menu', () => {
  const watching = (level, status, h) => facts(F({ level, m: M('in-review'), pr: OPEN, prStatus: { watch: { watching: true, status } } }), h).row('watch');
  assert.equal(watching('simple', 'idle'), null, 'idle Watching hides below Advanced');
  const fixing = watching('simple', 'fixing');
  assert.equal(fixing.querySelector('.rd-fact-watch'), null);
  assert.equal(fixing.querySelector('span.rd-fact-tx.is-run').textContent, 'Fixing');
  let opened = null;
  const adv = watching('advanced', 'idle', { onWatch: (el) => { opened = el; } }).querySelector('button.rd-fact-watch');
  assert.equal(adv.textContent, 'Watching');
  adv.click();
  assert.equal(opened, adv);
});

test('facts: a fixing watch links its fix run', () => {
  const f = F({ m: M('in-review'), pr: OPEN, prStatus: { watch: { watching: true, status: 'fixing', activePipelineId: 'p9' } } });
  const w = facts(f, { fixRunHref: (pid) => `#history/k/${pid}` }).row('watch');
  const fix = [...w.querySelectorAll('a.rd-fact-link')].find((a) => a.textContent === 'View fix run');
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

test('tracker: the last PR step reads Merged whatever the base (the base is the facts list\'s Merged row)', () => {
  const last = (f) => steps(f).at(-1).querySelector('.rd-track-label').textContent;
  assert.equal(last(F({ m: M('working', { pulse: true }), base: 'main' })), 'Merged');
  assert.equal(last(F({ m: M('working', { pulse: true }), base: '' })), 'Merged');
  assert.equal(last(F({ base: 'feature/very-long-integration-branch-name-for-the-billing-team' })), 'Merged');
});

test('CSS: a wrapping tracker label keeps its dot and line on the first line; fact labels never wrap', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /^\.rd-track-head\{[^}]*align-items:flex-start;/m, 'top-aligned, not centred on a wrapped label');
  assert.match(css, /^\.rd-kv-k\{[^}]*white-space:nowrap;/m);
});

test('tracker CSS: labels wrap inside their column at every width', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = css.match(/^\.rd-track-label\{([^}]*)\}/m);
  assert.ok(rule, 'the base label rule');
  assert.doesNotMatch(rule[1], /white-space:nowrap/, 'a nowrap label spills past the card');
  assert.match(rule[1], /min-width:0;/);
  assert.match(rule[1], /overflow-wrap:anywhere;/);
  assert.match(css, /^\.rd-track-steps\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) auto;/m, 'columns may shrink');
});

test('tracker CSS: the last step ends at the card\'s right edge, for 3 steps and the 2-step Folder row', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  // Only steps before the last draw a line, so the last column is its own width and the lines take the rest.
  assert.doesNotMatch(css, /\.rd-track-steps\{[^}]*repeat\(3,/, 'an equal third leaves the last column half empty');
  assert.match(css, /^\.rd-track-steps:not\(:has\(> :nth-child\(3\)\)\)\{grid-template-columns:minmax\(0,1fr\) auto;\}/m,
    'a 2-step row gets 2 columns, not 2 of 3');
  const folder = steps(TABLE.folder[0]);
  assert.equal(folder.length, 2);
  assert.equal(folder[1].querySelector('.rd-track-line'), null, 'the last step has no line');
});
