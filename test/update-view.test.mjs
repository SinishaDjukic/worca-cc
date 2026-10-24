// test/update-view.test.mjs
// The About card's manual update models (issue #841): the version picker rows, the default pick,
// the action per pick, and the Update row per status and eligibility. Pure: no jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerRows, defaultSelection, pickAction, updateRowModel, manualCommand } from '../ui/public/update-view.mjs';

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
