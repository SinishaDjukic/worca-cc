// test/ui-branch-sync-model.test.mjs
// Sync before run (#527): the pure models behind the Source-branch pill, the Projects /
// Workspaces chips, the Ask proposal note, the run header's Sync label and the refusal copy.
// The models are plain functions; the DOM helpers at the end run under jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ago, syncPillModel, chipState, projectChipModel, worstChip, sourceRefNote,
  fetchFailureCopy, ffRefusalCopy, syncStageLabel, cssEscape,
  mountSyncRow, paintSyncRow, isSyncableBranchName, fetchedAgo, syncPrefsModel, syncPrefsPatch,
  runOutcomeModel, listRowModel, projectBarModel, wsRollupModel,
} from '../ui/public/branch-sync.mjs';
import { isSafeBranchName } from '../src/core/git-sync.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick } from './helpers/popups.mjs';

const block = (over = {}) => ({
  base: 'dev', remote: 'origin', state: 'up-to-date', ahead: 0, behind: 0,
  dirty: false, checkedOutHere: true, shallow: false, stale: false, ...over,
});

test('runOutcomeModel: what the run gets, per state and per choice (Origin · latest | Local copy)', () => {
  const o = (b, origin = true) => runOutcomeModel(b, { origin, base: 'dev' });
  assert.equal(o(undefined).text, 'Checking…');
  assert.equal(o(null).text, 'No remote · uses your local copy');
  assert.deepEqual([o(block()).text, o(block()).tone], ['Up to date', 'ok']);
  assert.deepEqual([o(block({ state: 'behind', behind: 3 })).text, o(block({ state: 'behind', behind: 3 })).tone],
    ['Gets 3 new commits from origin first', 'blue']);
  assert.deepEqual([o(block({ state: 'behind', behind: 1 }), false).text, o(block({ state: 'behind', behind: 1 }), false).tone],
    ['Misses 1 newer commit on origin', 'amber']);
  const div = block({ state: 'diverged', ahead: 1, behind: 5 });
  assert.equal(o(div).text, 'Your 1 unpushed commit is left out');
  assert.equal(o(block({ state: 'diverged', ahead: 2, behind: 5 })).text, 'Your 2 unpushed commits are left out');
  assert.deepEqual([o(div, false).text, o(div, false).note], ['Includes your 1 unpushed commit', 'Misses 5 newer commits on origin']);
  const fail = o(block({ state: 'diverged', ahead: 2, behind: 5, settings: { onDiverged: 'fail' } }));
  assert.deepEqual([fail.text, fail.tone, fail.blocked], ['Can’t start from origin', 'red', true]);
  assert.equal(o(block({ state: 'diverged', ahead: 2, behind: 5, settings: { onDiverged: 'fail' } }), false).blocked, false, 'Local copy unblocks');
  const off = o(block({ stale: true, fetchError: { kind: 'network' } }));
  assert.equal(off.retry, true);
  assert.match(off.text, /^Can’t reach origin · uses the last fetch/);
  assert.equal(o(block({ stale: true }), false).text, 'Uses your local dev');
  assert.equal(o(block({ state: 'no-upstream' })).text, 'Not on origin yet · uses your local copy');
  assert.equal(o(block({ state: 'unknown' })).text, 'Status unknown');
  // Dirty no longer hides behind: two facts, joined.
  const both = o(block({ state: 'behind', behind: 2, dirty: true }));
  assert.deepEqual([both.text, both.note], ['Gets 2 new commits from origin first', 'Uncommitted changes not included']);
  assert.equal(o(block({ dirty: true })).text, 'Uncommitted changes not included');
  assert.equal(o(block({ dirty: true, checkedOutHere: false })).text, 'Up to date', 'dirt elsewhere is not this checkout');
});

test('listRowModel: one action at most, and only one Worca can take', () => {
  const m = (over) => listRowModel(block(over));
  assert.deepEqual([m({}).label, m({}).action], ['Up to date', null]);
  assert.deepEqual([m({ state: 'behind', behind: 3 }).label, m({ state: 'behind', behind: 3 }).action], ['3 commits behind', 'sync']);
  assert.equal(m({ state: 'behind', behind: 3, settings: { beforeRun: false } }).hint, 'Runs start from your local copy');
  assert.deepEqual([m({ state: 'diverged', ahead: 2, behind: 5 }).action, m({ state: 'diverged', ahead: 2, behind: 5 }).hint],
    ['details', '2 ahead, 5 behind · next run will ask']);
  assert.match(m({ state: 'diverged', ahead: 1, behind: 1, settings: { onDiverged: 'fail' } }).hint, /won’t start/);
  assert.deepEqual([m({ stale: true }).label, m({ stale: true }).action], ['Can’t reach origin', 'retry']);
  const dirtyBehind = m({ state: 'behind', behind: 1, dirty: true });
  assert.deepEqual([dirtyBehind.label, dirtyBehind.action, dirtyBehind.dirty], ['1 commit behind', null, true]);
  assert.deepEqual([m({ dirty: true }).label, m({ dirty: true }).action], ['Uncommitted changes', null]);
  assert.equal(listRowModel(null).label, 'No remote');
});

test('projectBarModel: the Projects list bar — tone, the ref it is compared with, its action and filter group', () => {
  const m = (over) => projectBarModel(block(over));
  const pick = (x) => [x.tone, x.label, x.hint, x.actionLabel, x.vs, x.group];
  assert.deepEqual(pick(m({})), ['ok', 'Up to date', '', '', 'origin/dev', 'ok']);
  assert.deepEqual(pick(m({ state: 'behind', behind: 5 })), ['blue', '5 commits behind', 'Next run syncs it first', 'Sync', 'origin/dev', 'behind']);
  assert.equal(m({ state: 'behind', behind: 2, settings: { beforeRun: false } }).hint, 'Auto-sync is off · runs start from your local copy');
  const dirtyBehind = m({ state: 'behind', behind: 7, dirty: true });
  assert.deepEqual(pick(dirtyBehind), ['blue', '7 commits behind', 'Uncommitted changes, so Sync can’t move it · runs use committed code', '', 'origin/dev', 'behind']);
  assert.deepEqual(pick(m({ state: 'diverged', ahead: 3, behind: 8 })), ['amber', 'Diverged', '3 ahead, 8 behind · next run will ask', 'Review…', 'origin/dev', 'diverged']);
  assert.deepEqual(pick(m({ dirty: true })), ['peach', 'Uncommitted changes', 'Runs use committed code only', '', 'origin/dev', 'dirty']);
  assert.deepEqual(pick(m({ stale: true, fetchedAt: null })), ['grey', 'Can’t reach origin', 'Last fetched unknown (the last fetch failed)', 'Retry', 'origin/dev', 'offline']);
  // Not on the remote: nothing to compare with, so no "vs" line.
  assert.deepEqual(pick(m({ base: 'feature/x', state: 'no-upstream' })), ['grey', 'Not on origin yet', 'Runs use your local copy', '', '', 'local']);
  assert.deepEqual(pick(m({ base: null, state: 'unknown' })), ['grey', 'Status unknown', '', '', '', null]);
  assert.equal(projectBarModel(block({ remote: 'upstream', base: 'main' })).vs, 'upstream/main', 'the compared ref follows the payload\'s remote');
  // No remote: the bar says so instead of leaving a blank line.
  for (const b of [null, block({ remote: null, state: 'unknown' })]) {
    assert.deepEqual(pick(projectBarModel(b)), ['none', 'No git remote', 'Local folder · nothing to sync', '', '', 'local']);
  }
  // No answer yet.
  assert.deepEqual(pick(projectBarModel(undefined)), ['grey', 'Checking…', '', '', '', null]);
  assert.equal(projectBarModel(undefined).icon, 'spin');
});

test('wsRollupModel: one sentence, worst state sets the tone', () => {
  const rows = (...states) => states.map((s) => listRowModel(s));
  assert.deepEqual(wsRollupModel(rows(block(), block())), { text: 'All 2 up to date', tone: 'ok' });
  assert.deepEqual(wsRollupModel(rows(block({ state: 'diverged', ahead: 1, behind: 1 }), block({ state: 'behind', behind: 2 }), block({ dirty: true }))),
    { text: '1 diverged · 1 behind · 1 with uncommitted changes', tone: 'amber' });
  assert.deepEqual(wsRollupModel(rows(block({ state: 'behind', behind: 2 }), block())), { text: '1 behind · 1 up to date', tone: 'blue' });
  assert.equal(wsRollupModel([{ state: 'none' }]).text, 'Checking…');
});

test('syncPillModel: the four required colours, hidden without a remote, diverged amber', () => {
  assert.deepEqual(syncPillModel(block({ state: 'behind', behind: 3 }), { autoSync: true }),
    { tone: 'blue', label: '3 behind', state: 'behind' });
  assert.deepEqual(syncPillModel(block({ state: 'behind', behind: 3 }), { autoSync: false }),
    { tone: 'amber', label: '3 behind', state: 'behind-off' });
  assert.equal(syncPillModel(block()).tone, 'green');
  assert.equal(syncPillModel(block()).label, 'Up to date');
  assert.equal(syncPillModel(block({ state: 'ahead', ahead: 2 })).tone, 'green');
  assert.deepEqual(syncPillModel(block({ state: 'behind', behind: 3, stale: true })),
    { tone: 'grey', label: 'Offline', state: 'offline' });
  assert.equal(syncPillModel(block({ fetchError: { kind: 'auth' } })).label, 'Offline');
  assert.deepEqual(syncPillModel(block({ remote: null })), { hidden: true });
  assert.deepEqual(syncPillModel(null), { hidden: true });
  assert.deepEqual(syncPillModel(block({ state: 'diverged' })), { tone: 'amber', label: 'Diverged', state: 'diverged' });
  assert.equal(syncPillModel(block({ state: 'remote-only' })).label, 'Remote only');
  assert.equal(syncPillModel(block({ state: 'no-upstream' })).label, 'Not on origin');
  assert.equal(syncPillModel(block({ state: 'missing' })).label, 'Unknown');
  assert.equal(syncPillModel(block({ state: 'behind', behind: 5, shallow: true })).label, 'at least 5 behind');
});

// One table shared in spirit with §3.4's server chipState test: the two copies must agree.
const CHIP_TABLE = [
  [block(), 'ok'],
  [block({ state: 'behind', behind: 1 }), 'behind'],
  [block({ state: 'diverged' }), 'diverged'],
  [block({ dirty: true }), 'dirty'],
  [block({ stale: true }), 'offline'],
  [block({ state: 'no-upstream', base: 'feat/x' }), 'local'],
  [block({ state: 'missing' }), 'local'],
  [block({ state: 'remote-only' }), null],
  [block({ state: 'unknown' }), null],
  [block({ remote: null }), null],
];
test('projectChipModel + chipState table: texts/actions, no-upstream is a grey local chip, never green', async () => {
  await checkRows([
    { name: 'projectChipModel: texts and actions', run: () => {
      assert.deepEqual(projectChipModel(block()), { state: 'ok', tone: 'green', text: 'dev · up to date', action: 'Sync' });
      assert.deepEqual(projectChipModel(block({ state: 'behind', behind: 3 })),
        { state: 'behind', tone: 'blue', text: 'dev · 3 behind', action: 'Sync' });
      assert.deepEqual(projectChipModel(block({ base: 'main', state: 'diverged' })),
        { state: 'diverged', tone: 'amber', text: 'main · diverged', action: 'Review…' });
      assert.deepEqual(projectChipModel(block({ base: 'main', dirty: true })),
        { state: 'dirty', tone: 'amber', text: 'main · dirty', action: 'Sync' });
      assert.equal(projectChipModel(block({ remote: null })), null);
      assert.equal(projectChipModel(block({ state: 'unknown' })), null);
      assert.equal(projectChipModel(block({ state: 'remote-only' })), null, 'on the remote: no chip');
      assert.equal(projectChipModel(block({ stale: true })).text, 'dev · offline');
      assert.equal(projectChipModel(block({ dirty: true, checkedOutHere: false })).state, 'ok', 'a dirty tree elsewhere is not this base');
    } },
    { name: 'chipState table; no-upstream is a grey "not on the remote" chip, never green', run: () => {
      for (const [b, want] of CHIP_TABLE) assert.equal(chipState(b), want, JSON.stringify(b));
      assert.deepEqual(projectChipModel(block({ state: 'no-upstream', base: 'feat/x' })),
        { state: 'local', tone: 'grey', text: 'feat/x · not on the remote', action: 'Sync' });
    } },
  ]);
});

test('worstChip: the worst member wins, independent of order', () => {
  const a = block(); const b = block({ state: 'behind', behind: 2 }); const c = block({ state: 'diverged' });
  const d = block({ stale: true }); const e = block({ state: 'no-upstream' });
  assert.deepEqual(worstChip([a, b, c]), { state: 'diverged', tone: 'amber', text: 'diverged' });
  assert.deepEqual(worstChip([c, b, a]), worstChip([a, b, c]));
  assert.deepEqual(worstChip([a, b]), { state: 'behind', tone: 'blue', text: 'behind' });
  assert.equal(worstChip([e, d]).state, 'offline');
  assert.equal(worstChip([d, e]).state, 'offline');
  assert.equal(worstChip([a, e]).state, 'local');
  assert.equal(worstChip([e, a]).state, 'local');
  assert.equal(worstChip([block({ remote: null })]), null);
  assert.equal(worstChip([]), null);
  assert.equal(worstChip(null), null);
});

test('sync copy helpers: sourceRefNote, syncStageLabel, ffRefusalCopy and fetchFailureCopy (by kind, never stderr)', async () => {
  await checkRows([
    { name: 'sourceRefNote', run: () => {
      assert.equal(sourceRefNote(null), '');
      assert.equal(sourceRefNote({ ref: 'dev' }), '');
      assert.equal(sourceRefNote({ ref: 'origin/feat', remoteOnly: true }), 'from origin/feat (remote only)');
      assert.equal(sourceRefNote({ ref: 'dev', behind: 2 }), 'from dev (2 behind)');
      assert.equal(sourceRefNote({ ref: 'dev', behind: 2, stale: true }), 'from dev (2 behind, could not fetch: last known refs)');
    } },
    { name: 'syncStageLabel for all five results', run: () => {
      assert.equal(syncStageLabel(null), 'Sync');
      assert.equal(syncStageLabel({ result: 'fast-forwarded', commits: 3 }), 'Synced 3 commits');
      assert.equal(syncStageLabel({ result: 'fast-forwarded', commits: 1 }), 'Synced 1 commit');
      assert.equal(syncStageLabel({ result: 'remote-start', remote: 'origin' }, 'dev'), 'Started from origin/dev');
      assert.equal(syncStageLabel({ result: 'remote-start' }, 'main'), 'Started from origin/main');
      assert.equal(syncStageLabel({ result: 'fetch-failed' }), 'Sync: used the last fetch');
      assert.equal(syncStageLabel({ result: 'diverged' }), 'Sync: diverged');
      assert.equal(syncStageLabel({ result: 'up-to-date' }), 'Sync');
    } },
    { name: 'ffRefusalCopy: dirty, in-use, diverged, unknown kind, ok', run: () => {
      assert.match(ffRefusalCopy({ ok: false, kind: 'dirty' }, 'dev'), /^dev has uncommitted changes, so it was not moved\. Runs start from origin\/dev/);
      assert.match(ffRefusalCopy({ ok: false, kind: 'in-use' }, 'dev', 'upstream'), /checked out in another worktree.*upstream\/dev/);
      assert.equal(ffRefusalCopy({ ok: false, kind: 'diverged' }, 'dev'), 'dev has diverged from origin/dev. Nothing was moved.');
      assert.equal(ffRefusalCopy({ ok: false, kind: 'weird' }, 'dev'), 'Could not update dev.');
      assert.equal(ffRefusalCopy({ ok: true }, 'dev'), '');
      assert.equal(ffRefusalCopy(null, 'dev'), '');
    } },
    { name: 'fetchFailureCopy by kind, never stderr', run: () => {
      assert.match(fetchFailureCopy('auth'), /^Sign-in to origin failed/);
      assert.match(fetchFailureCopy('network', 'upstream'), /^upstream could not be reached/);
      assert.match(fetchFailureCopy('timeout'), /did not answer in time/);
      assert.match(fetchFailureCopy('failed'), /^Fetching origin failed/);
      assert.match(fetchFailureCopy(undefined), /^Fetching origin failed/);
    } },
  ]);
});

test('ago / fetchedAgo: relative times, clock skew clamps, a failed fetch with no time says so', async () => {
  await checkRows([
    { name: 'ago', run: () => {
      const now = Date.parse('2026-09-30T12:00:00Z');
      assert.equal(ago(null, now), 'never');
      assert.equal(ago('garbage', now), 'never');
      assert.equal(ago('2026-09-30T11:59:30Z', now), 'just now');
      assert.equal(ago('2026-09-30T12:00:30Z', now), 'just now', 'clock skew clamps to now');
      assert.equal(ago('2026-09-30T11:55:00Z', now), '5 min ago');
      assert.equal(ago('2026-09-30T09:00:00Z', now), '3 h ago');
      assert.equal(ago('2026-09-28T12:00:00Z', now), '2 d ago');
    } },
    { name: 'fetchedAgo: "never" only when nothing failed; a failed fetch with no time says so', run: () => {
      const now = Date.parse('2026-09-30T12:00:00Z');
      assert.equal(fetchedAgo({ fetchedAt: '2026-09-30T11:57:00Z' }, now), '3 min ago');
      assert.equal(fetchedAgo({ fetchedAt: null }, now), 'never');
      assert.equal(fetchedAgo({ fetchedAt: null, stale: true, fetchError: { kind: 'network' } }, now), 'unknown (the last fetch failed)');
      assert.equal(fetchedAgo({ fetchedAt: '2026-09-30T11:57:00Z', stale: true }, now), '3 min ago', 'a known time always wins');
    } },
  ]);
});

test('cssEscape works without window.CSS (jsdom) and escapes quotes', () => {
  assert.equal(cssEscape('plain-key_1'), 'plain-key_1');
  const out = cssEscape('a"b\\c');
  assert.ok(!/(^|[^\\])"/.test(out), `unescaped quote in ${out}`);
  assert.equal(cssEscape(null), '');
});

// ── DOM helpers (jsdom) ────────────────────────────────────────────────────
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));
async function dom(body = '') {
  const { JSDOM } = await import('jsdom');
  const d = new JSDOM(`<!doctype html><body>${body}</body>`, { url: 'http://localhost/' });
  for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'KeyboardEvent']) {
    Object.defineProperty(globalThis, k, { value: d.window[k], configurable: true, writable: true });
  }
  return d.window;
}
const ROW = `<div class="sync-row" id="sync-row" hidden>
  <button type="button" class="sync-pill grey" id="sync-pill"><span class="sdot"></span><span class="sync-pill-txt">Checking…</span></button>
  <button type="button" class="btn btn-sm sync-btn" id="sync-btn"><span>Sync</span></button>
  <label class="switch-row sync-auto"><input id="syncAuto" class="sw-input" type="checkbox" checked></label>
</div><button id="opener">open</button>`;

test('paintSyncRow/mountSyncRow: hidden without a remote, tone/label/busy/switch, Unknown disables Sync, wiring fires pill/sync/toggle', async () => {
  await checkRows([
    { name: 'paintSyncRow: hidden without a remote; tone, label, aria-label, busy and switch otherwise', run: async () => {
      const w = await dom(ROW);
      const host = w.document.getElementById('sync-row');
      assert.deepEqual(paintSyncRow(host, block({ remote: null })), { hidden: true });
      assert.equal(host.hidden, true);
      paintSyncRow(host, block({ state: 'behind', behind: 3 }), { autoSync: false, busy: true });
      assert.equal(host.hidden, false);
      const pill = w.document.getElementById('sync-pill');
      assert.equal(pill.className, 'sync-pill amber');
      assert.equal(pill.querySelector('.sync-pill-txt').textContent, '3 behind');
      assert.equal(pill.getAttribute('aria-label'), 'Sync status: 3 behind. Show details');
      const btn = w.document.getElementById('sync-btn');
      assert.ok(btn.classList.contains('busy')); assert.equal(btn.disabled, true);
      assert.equal(w.document.getElementById('syncAuto').checked, false);
      paintSyncRow(host, block({ state: 'behind', behind: 3 }), { autoSync: true });
      assert.equal(pill.className, 'sync-pill blue');
      assert.equal(btn.disabled, false);
    } },
    { name: 'mountSyncRow wires pill, Sync and the switch', run: async () => {
      const w = await dom(ROW);
      const host = w.document.getElementById('sync-row');
      const seen = [];
      mountSyncRow(host, { onPill: () => seen.push('pill'), onSync: () => seen.push('sync'), onToggle: (on) => seen.push(`toggle:${on}`) });
      w.document.getElementById('sync-pill').click();
      w.document.getElementById('sync-btn').click();
      const sw = w.document.getElementById('syncAuto');
      sw.checked = false; sw.dispatchEvent(new w.Event('change'));
      assert.deepEqual(seen, ['pill', 'sync', 'toggle:false']);
    } },
    { name: 'paintSyncRow: an Unknown pill disables Sync (the server would refuse it)', run: async () => {
      const { JSDOM } = await import('jsdom');
      const { window } = new JSDOM('<div id="r"><button class="sync-pill"><span class="sync-pill-txt"></span></button><button class="sync-btn"></button><input type="checkbox"></div>');
      const host = window.document.getElementById('r');
      paintSyncRow(host, block({ state: 'unknown' }));
      assert.equal(host.querySelector('.sync-btn').disabled, true);
      paintSyncRow(host, block({ state: 'behind', behind: 1 }));
      assert.equal(host.querySelector('.sync-btn').disabled, false);
    } },
  ]);
});

test('openSyncDialog: rows, commits as text, Escape/scrim close with focus return, onSync repaint and refusal note; offline auth copy + Retry, gone opener falls back', async () => {
  await checkRows([
    { name: 'openSyncDialog: rows, commits as text, Escape returns focus, scrim closes, onSync repaint and refusal note', run: async () => {
      const w = await dom(ROW);
      const { openSyncDialog } = await import('../ui/public/branch-sync.mjs');
      const opener = w.document.getElementById('opener'); opener.focus();
      const b = block({ state: 'behind', behind: 2, fetchedAt: new Date().toISOString(), remoteLabel: 'github.com/acme/web',
        incoming: [{ sha: 'abcdef1234', at: new Date().toISOString(), subject: '<b>x</b>', author: 'a' }] });
      let done = openSyncDialog({ title: 'Sync status', subtitle: 'web · dev', sync: b, autoSync: true, opener });
      const dlg = w.document.querySelector('[role=dialog]');
      assert.ok(dlg.classList.contains('sync-modal'));
      assert.equal(dlg.getAttribute('aria-labelledby'), 'sync-dlg-title');
      assert.ok(dlg.querySelector('.card.sync-card'));
      const dts = [...dlg.querySelectorAll('.sync-kv dt')].map((n) => n.textContent);
      assert.deepEqual(dts, ['Local base', 'origin/dev', 'Behind / ahead', 'Last fetched', 'Remote', 'Working tree', 'Auto-sync']);
      const li = dlg.querySelector('.sync-commits li');
      assert.equal(li.children[0].textContent, 'abcdef1');
      assert.equal(li.children[1].textContent, '<b>x</b>', 'subject is text, never markup');
      assert.equal(li.querySelector('b'), null);
      w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(await done, null);
      assert.equal(w.document.querySelector('[role=dialog]'), null);
      assert.equal(w.document.activeElement, opener);

      done = openSyncDialog({ sync: b, opener });
      const m2 = w.document.querySelector('.sync-modal');
      m2.dispatchEvent(new w.Event('click', { bubbles: true }));            // a release with no press: not an outside click
      assert.ok(m2.isConnected, 'a selection dragged out of the card does not close it');
      backdropClick(w, m2);                                                   // press + release on the scrim
      assert.equal(await done, null);

      // onSync returns nothing → the current block stays; returns a refused ff → the note explains.
      let answer;
      done = openSyncDialog({ sync: b, opener, onSync: async () => answer });
      const d3 = w.document.querySelector('.sync-modal');
      d3.querySelector('.sync-go').click(); await tick(2);
      assert.equal(d3.querySelector('.sync-pill-txt').textContent, '2 behind');
      answer = { ...b, ff: { ok: false, kind: 'dirty' } };
      d3.querySelector('.sync-go').click(); await tick(2);
      assert.match(d3.querySelector('.sync-note').textContent, /uncommitted changes/);
      assert.equal(d3.querySelector('.sync-note').hidden, false);
      d3.querySelector('.sync-x').click();
      await done;
    } },
    { name: 'openSyncDialog offline: auth copy and Retry; a gone opener falls back', run: async () => {
      const w = await dom(ROW);
      const { openSyncDialog } = await import('../ui/public/branch-sync.mjs');
      const opener = w.document.getElementById('opener');
      const fb = w.document.getElementById('sync-pill');
      const done = openSyncDialog({ sync: block({ stale: true, fetchError: { kind: 'auth' } }), opener, fallbackFocus: () => fb });
      const d = w.document.querySelector('.sync-modal');
      assert.match(d.querySelector('.sync-note').textContent, /^Sign-in to origin failed/);
      assert.equal(d.querySelector('.sync-go').textContent, 'Retry');
      assert.equal(d.querySelector('.sync-pill-txt').textContent, 'Offline');
      opener.remove();
      d.querySelector('.confirm-actions .btn').click();
      await done;
      assert.equal(w.document.activeElement, fb);
    } },
  ]);
});

test('chooseSyncRefusal: diverged → origin; forbidden → Cancel only; fetch-failed → last-fetch; Escape → null', async () => {
  const w = await dom();
  const { chooseSyncRefusal } = await import('../ui/public/branch-sync.mjs');
  const members = [{ projectKey: 'k', base: 'dev', remote: 'origin', ahead: 1, behind: 2 }];
  let p = chooseSyncRefusal({ code: 'sync-diverged', options: ['origin', 'cancel'], members });
  let m = w.document.querySelector('.sync-modal');
  assert.ok(m.querySelector('.qpanel'));
  assert.equal(m.querySelector('.qopt'), null);
  assert.match(m.textContent, /dev has diverged from origin\/dev \(1 ahead, 2 behind\)\./);
  const go = [...m.querySelectorAll('button')].find((b) => b.textContent === 'Start from origin/dev');
  assert.ok(go && go.classList.contains('btn-primary'));
  go.click();
  assert.equal(await p, 'origin');

  p = chooseSyncRefusal({ code: 'sync-diverged', options: ['cancel'], forbidden: true, members });
  m = w.document.querySelector('.sync-modal');
  assert.deepEqual([...m.querySelectorAll('button')].map((b) => b.textContent), ['Cancel']);
  assert.match(m.textContent, /does not allow starting from the remote/);
  m.querySelector('button').click();
  assert.equal(await p, null);

  p = chooseSyncRefusal({ code: 'sync-fetch-failed', fetchKind: 'auth', options: ['last-fetch', 'cancel'],
    members: [{ projectKey: 'a', projectName: 'A', base: 'dev', remote: 'origin', fetchKind: 'auth' },
      { projectKey: 'b', projectName: 'B', base: 'main', remote: 'origin', fetchKind: 'network' }] });
  m = w.document.querySelector('.sync-modal');
  assert.match(m.textContent, /A: Sign-in to origin failed/);
  assert.match(m.textContent, /B: origin could not be reached/);
  [...m.querySelectorAll('button')].find((b) => b.textContent === 'Start anyway').click();
  assert.equal(await p, 'last-fetch');

  p = chooseSyncRefusal({ code: 'sync-diverged', options: ['origin', 'cancel'], members });
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(await p, null);
  assert.equal(w.document.querySelector('.sync-modal'), null);
});

test('isSyncableBranchName is the twin of git-sync isSafeBranchName (the UI skips the 400)', () => {
  const names = ['dev', 'main', 'feat/x', 'release/1.0', 'a.b-c_d', 'plus+branch', 'with space', '', '-x', '/x', 'x/', 'x.',
    'x.lock', 'a/b.lock/c', 'a..b', 'a//b', '.hidden', 'a/.b', 'a'.repeat(256), 'a'.repeat(255), '0123456789abcdef0123456789abcdef01234567',
    'ümlaut', 'x~1', 'x^', 'x:y', 'x?', 'x*', 'x[', 'x\\y', null, undefined, 7];
  for (const n of names) assert.equal(isSyncableBranchName(n), isSafeBranchName(n), JSON.stringify(n));
});

test('syncPrefsModel / syncPrefsPatch: "" follows the instance default (named in the option); a value overrides it', () => {
  const view = { own: { onDiverged: 'fail' }, defaults: { beforeRun: false, onDiverged: 'origin' } };
  const m = syncPrefsModel(view);
  assert.equal(m.beforeRun.value, '', 'no own beforeRun: follows the default');
  assert.deepEqual(m.beforeRun.options[0], ['', 'Default (Off)']);
  assert.equal(m.onDiverged.value, 'fail');
  assert.deepEqual(m.onDiverged.options.map(([v]) => v), ['', 'ask', 'origin', 'fail']);
  assert.equal(m.onDiverged.options[0][1], 'Default (Start from origin)');
  assert.equal(syncPrefsModel({ own: { beforeRun: true }, defaults: {} }).beforeRun.value, 'true');
  assert.equal(syncPrefsModel(null).onDiverged.options[0][1], 'Default (Ask me)');
  assert.deepEqual(syncPrefsPatch('beforeRun', 'false'), { beforeRun: false });
  assert.deepEqual(syncPrefsPatch('beforeRun', 'true'), { beforeRun: true });
  assert.deepEqual(syncPrefsPatch('beforeRun', ''), { beforeRun: null });
  assert.deepEqual(syncPrefsPatch('onDiverged', 'origin'), { onDiverged: 'origin' });
  assert.deepEqual(syncPrefsPatch('onDiverged', ''), { onDiverged: null });
});

test('openSyncDialog prefs: "This project" loads, saves each select on change, repaints from the answer and shows a refusal', async () => {
  const w = await dom(ROW);
  const { openSyncDialog } = await import('../ui/public/branch-sync.mjs');
  const opener = w.document.getElementById('opener');
  const saves = [];
  let refuse = false;
  let own = {};
  const defaults = { beforeRun: true, onDiverged: 'ask' };
  const prefs = {
    load: async () => ({ own, defaults }),
    save: async (patch) => {
      saves.push(patch);
      if (refuse) throw new Error('sync.onDiverged must be one of ask | origin | fail');
      own = { ...own };
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete own[k]; else own[k] = v; }
      return { own, defaults };
    },
  };
  const done = openSyncDialog({ sync: block(), opener, prefs });
  const dlg = w.document.querySelector('.sync-modal');
  assert.equal(dlg.querySelector('.sync-prefs-head').textContent, 'This project');
  const before = dlg.querySelector('#syncPrefBeforeRun');
  const diverged = dlg.querySelector('#syncPrefOnDiverged');
  assert.equal(before.disabled, true, 'disabled until the settings load');
  await tick(2);
  assert.equal(before.disabled, false);
  assert.deepEqual([before.value, diverged.value], ['', '']);
  assert.equal(before.options[0].textContent, 'Default (On)');

  diverged.value = 'fail'; diverged.dispatchEvent(new w.Event('change')); await tick(2);
  assert.deepEqual(saves.at(-1), { onDiverged: 'fail' });
  assert.equal(diverged.value, 'fail');
  assert.equal(dlg.querySelector('.sync-prefs-msg').textContent, 'Saved for this project.');
  before.value = 'false'; before.dispatchEvent(new w.Event('change')); await tick(2);
  assert.deepEqual(saves.at(-1), { beforeRun: false });
  diverged.value = ''; diverged.dispatchEvent(new w.Event('change')); await tick(2);
  assert.deepEqual(saves.at(-1), { onDiverged: null }, 'Default resets the key');
  assert.deepEqual(own, { beforeRun: false });

  refuse = true;
  diverged.value = 'origin'; diverged.dispatchEvent(new w.Event('change')); await tick(2);
  const msg = dlg.querySelector('.sync-prefs-msg');
  assert.match(msg.textContent, /must be one of/);
  assert.ok(msg.classList.contains('err'));
  dlg.querySelector('.sync-x').click();
  assert.equal(await done, null);

  // No prefs option → no section.
  const d2 = openSyncDialog({ sync: block(), opener });
  assert.equal(w.document.querySelector('.sync-modal .sync-prefs'), null);
  w.document.querySelector('.sync-modal .sync-x').click();
  await d2;
});
