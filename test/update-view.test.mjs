// test/update-view.test.mjs
// The About card's manual update models (issue #841): the version picker rows, the default pick,
// the action per pick, and the Update row per status and eligibility. Pure: no jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerRows, defaultSelection, pickAction, updateRowModel, manualCommand, changesModel, changesLoading, FAST_PACE_NOTE, CHANGES_UNAVAILABLE, CHANGES_OFF, CHANGES_LOADING } from '../ui/public/update-view.mjs';

const distTags = { latest: '1.14.0', rc: '1.15.0-rc.2' };
const V = [
  { version: '1.15.0-rc.2', channel: 'rc', relation: 'newer', belowLatest: false, autoRestart: true, publishedAt: '2026-10-22T00:00:00.000Z' },
  { version: '1.15.0-rc.1', channel: 'rc', relation: 'newer', belowLatest: false, autoRestart: true, publishedAt: null },
  { version: '1.14.0', channel: 'stable', relation: 'newer', belowLatest: false, autoRestart: true, publishedAt: null },
  { version: '1.14.0-rc.3', channel: 'rc', relation: 'newer', belowLatest: true, autoRestart: true, publishedAt: null },
  { version: '1.13.2', channel: 'stable', relation: 'newer', belowLatest: true, autoRestart: false, publishedAt: null },
  { version: '1.13.1', channel: 'stable', relation: 'current', belowLatest: true, autoRestart: false, publishedAt: null },
  { version: '1.13.0', channel: 'stable', relation: 'older', belowLatest: true, autoRestart: false, publishedAt: null },
];
const info = { canUpdate: true, reason: null, message: '', autoRestartMin: '1.14.0', startCommand: 'worca ui' };

test('stable list hides older until asked; current is listed but disabled; latest tagged', () => {
  const rows = pickerRows({ versions: V, distTags, channel: 'stable', showOlder: false });
  assert.deepEqual(rows.map((r) => r.version), ['1.14.0', '1.13.2', '1.13.1']);
  assert.equal(rows.find((r) => r.version === '1.13.1').disabled, true);
  assert.equal(rows[0].tag.text, 'Latest stable');
  assert.ok(pickerRows({ versions: V, distTags, channel: 'stable', showOlder: true }).some((r) => r.version === '1.13.0'));
});

test('rc list: rc newer than latest stable; older rc behind the toggle; newest carries the rc tag', () => {
  const rows = pickerRows({ versions: V, distTags, channel: 'rc', showOlder: false });
  assert.deepEqual(rows.map((r) => r.version), ['1.15.0-rc.2', '1.15.0-rc.1']);
  assert.equal(rows[0].tag.text, 'Newest RC');
});

test('defaultSelection: latest on Stable, rc tag on RC; nothing when latest is not newer (ahead / up to date)', () => {
  assert.equal(defaultSelection({ versions: V, distTags, channel: 'stable' }), '1.14.0');
  assert.equal(defaultSelection({ versions: V, distTags, channel: 'rc' }), '1.15.0-rc.2');
  const ahead = V.map((v) => (v.version === '1.14.0' ? { ...v, relation: 'older' } : v));
  assert.equal(defaultSelection({ versions: ahead, distTags, channel: 'stable' }), null);
});

test('pickAction: update / rc / roll back / pre-1.14 warning; shared disables; other reasons switch to the command', () => {
  const by = Object.fromEntries(V.map((v) => [v.version, v]));
  assert.deepEqual([pickAction(by['1.14.0'], info).label, pickAction(by['1.14.0'], info).tone], ['Update to 1.14.0', 'info']);
  assert.equal(pickAction(by['1.15.0-rc.2'], info).tone, 'warn');
  const back = pickAction(by['1.13.0'], info);
  assert.equal(back.label, 'Roll back to 1.13.0');
  assert.match(back.text, /older version/);
  assert.match(back.text, /cannot start again by itself.*worca ui/);
  assert.equal(pickAction(by['1.14.0'], { ...info, canUpdate: false, reason: 'shared', message: 'Updates are turned off on a shared install. Whoever runs this Worca updates it.' }).disabled, true);
  assert.equal(pickAction(by['1.14.0'], { ...info, canUpdate: false, reason: 'not-writable', message: 'x' }).mode, 'command');
  assert.equal(pickAction(by['1.14.0'], { ...info, canUpdate: false, reason: 'mock', message: 'Updates are off in mock mode.' }).disabled, true, 'mock: disabled, no command');
  assert.equal(pickAction(null, info).disabled, true);
});

test('updateRowModel: outdated eligible / up to date + rc / ahead / shared / cannot update / source', () => {
  const vsOut = { status: 'outdated', current: '1.13.1', latest: '1.14.0' };
  const m = updateRowModel({ vs: vsOut, info: { ...info, distTags } });
  assert.deepEqual(m.primary, { label: 'Update to 1.14.0', version: '1.14.0', disabled: false });
  assert.equal(m.choose, true); assert.equal(m.command, null);
  const up = updateRowModel({ vs: { status: 'up-to-date', current: '1.14.0', latest: '1.14.0' }, info: { ...info, distTags, rcNewer: true } });
  assert.equal(up.primary, null);
  assert.match(up.note, /latest stable.*1\.15\.0-rc\.2/);
  const ahead = updateRowModel({ vs: { status: 'ahead', current: '1.15.0-rc.1', latest: '1.14.0' }, info: { ...info, distTags } });
  assert.equal(ahead.primary, null, 'clarify answer: no primary button when ahead');
  const shared = updateRowModel({ vs: vsOut, info: { ...info, distTags, canUpdate: false, reason: 'shared', message: 'Updates are turned off on a shared install. Whoever runs this Worca updates it.' } });
  assert.equal(shared.primary.disabled, true); assert.equal(shared.command, null); assert.match(shared.note, /shared install/);
  const cant = updateRowModel({ vs: vsOut, info: { ...info, distTags, canUpdate: false, reason: 'not-supervised', message: 'not started with worca ui' }, chosen: '1.15.0-rc.2' });
  assert.equal(cant.primary, null);
  assert.equal(cant.command, manualCommand('1.15.0-rc.2'));
  const cantUp = updateRowModel({ vs: { status: 'up-to-date', current: '1.14.0', latest: '1.14.0' },
    info: { ...info, distTags, canUpdate: false, reason: 'not-writable', message: "npm's global folder is not writable without sudo, so Worca cannot update itself. Update from a terminal:" } });
  assert.equal(cantUp.command, null);
  assert.doesNotMatch(cantUp.note, /:$/, 'no dangling "Update from a terminal:" without a command');
  const src = updateRowModel({ vs: { status: 'source', current: '1.14.0' }, info: { ...info, canUpdate: false, reason: 'source', message: 'git pull' } });
  assert.deepEqual([src.choose, src.command], [false, null]);
  assert.equal(updateRowModel({ vs: null, info }).hidden, true);
});

// "What changes for you" in the update confirm (GET /api/app/update/preview → changes).
const feedRel = (version, n) => ({ version, date: '2026-11-05', sub: '', url: `https://docs.worca.dev/changelog/${version}/`,
  sections: Array.from({ length: n }, (_, i) => ({ kicker: 'Chat', title: `Change ${i + 1}` })) });

test('the fixed texts', () => {
  assert.equal(FAST_PACE_NOTE, 'Worca is developed at a fast pace. Screens, labels and where things sit can change between versions.');
  assert.equal(CHANGES_UNAVAILABLE, 'The list of changes could not be loaded. Read the release notes before you update.');
  assert.equal(CHANGES_OFF, 'Worca does not check for updates here, so the list of changes is not loaded. Read the release notes before you update.');
  assert.equal(CHANGES_LOADING, 'Loading the list of changes…');
});

test('changesModel: ok → the note, the heading and at most 8 lines per release', () => {
  const m = changesModel({ state: 'ok', from: '1.16.0', to: '1.18.0', rollback: false, targetListed: true, releases: [feedRel('1.18.0', 11), feedRel('1.17.0', 2)] });
  assert.equal(m.note, FAST_PACE_NOTE);
  assert.equal(m.heading, 'What changes for you · 1.16.0 → 1.18.0');
  assert.equal(m.message, null);
  assert.deepEqual(m.releases.map((r) => [r.version, r.lines.length, r.more]), [['1.18.0', 8, 3], ['1.17.0', 2, 0]]);
  assert.deepEqual(m.releases[1].lines[0], { kicker: 'Chat', title: 'Change 1' });
  assert.equal(m.releases[0].url, 'https://docs.worca.dev/changelog/1.18.0/');
  assert.equal(m.releases[0].date, '2026-11-05');
});

test('changesModel: unavailable, missing or garbled → the note, the heading and the could-not-load text', () => {
  for (const c of [{ state: 'unavailable', rollback: false, releases: [] }, null, undefined, 'x', { state: 'ok', releases: 'x' }, { state: 'ok', releases: [] }]) {
    assert.deepEqual(changesModel(c), { note: FAST_PACE_NOTE, heading: 'What changes for you', releases: [], message: CHANGES_UNAVAILABLE });
  }
});

test('changesModel: update checks off (or mock) → says nothing was tried, not that it failed', () => {
  assert.deepEqual(changesModel({ state: 'off', from: '1.16.0', to: '1.18.0', rollback: false, releases: [] }),
    { note: FAST_PACE_NOTE, heading: 'What changes for you · 1.16.0 → 1.18.0', releases: [], message: CHANGES_OFF });
});

test('changesLoading: the same parts the answer fills, so nothing moves when it lands', () => {
  assert.deepEqual(changesLoading(), { note: FAST_PACE_NOTE, heading: 'What changes for you', releases: [], message: CHANGES_LOADING });
});

test('changesModel: a rollback shows nothing', () => {
  assert.deepEqual(changesModel({ state: 'none', rollback: true, releases: [] }), { note: null, heading: null, releases: [], message: null });
});

test('changesModel: a stable target the feed does not list says so, without promising it will come', () => {
  const MISSING = '1.19.0 is not in this list. Read the release notes before you update.';
  assert.deepEqual(changesModel({ state: 'none', from: '1.18.0', to: '1.19.0', rollback: false, targetListed: false, releases: [] }),
    { note: FAST_PACE_NOTE, heading: 'What changes for you · 1.18.0 → 1.19.0', releases: [], message: MISSING });
  const m = changesModel({ state: 'ok', from: '1.17.0', to: '1.19.0', rollback: false, targetListed: false, releases: [feedRel('1.18.0', 1)] });
  assert.equal(m.message, MISSING);
  assert.deepEqual(m.releases.map((r) => r.version), ['1.18.0']);
});

test('changesModel: a release-candidate target names it as one', () => {
  const m = changesModel({ state: 'ok', from: '1.17.0', to: '1.19.0-rc.2', rollback: false, prerelease: true, targetListed: false, releases: [feedRel('1.18.0', 1)] });
  assert.equal(m.message, 'Release candidates such as 1.19.0-rc.2 are not in this list. Read the release notes before you update.');
  assert.doesNotMatch(m.message, /yet/);
});

test('changesModel: a release without a changelog link gets none; junk sections are dropped', () => {
  const m = changesModel({ state: 'ok', from: '1.0.0', to: '1.1.0', releases: [{ version: '1.1.0', url: 'javascript:alert(1)', sections: [null, { title: 5 }, { kicker: 7, title: 'Kept' }] }] });
  assert.equal(m.releases[0].url, null);
  assert.deepEqual(m.releases[0].lines, [{ kicker: '', title: 'Kept' }]);
});
