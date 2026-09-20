// test/chat-schedule.test.mjs — scheduled-run notifications render as chat messages.
// (/runs listing scheduled runs is covered in chat-command-router.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSchedule } from '../src/core/chat/renderers.mjs';

test('renderSchedule: problem vs info, clipped', () => {
  const p = renderSchedule({ severity: 'problem', title: 'Nightly', message: 'was due at 02:00. Worca was not running.' });
  assert.equal(p.severity, 'warning');
  assert.match(JSON.stringify(p.body), /Schedule:\*\* Nightly/);
  const i = renderSchedule({ severity: 'info', title: 'x'.repeat(90), message: 'y'.repeat(400) });
  assert.equal(i.severity, 'info');
  assert.match(JSON.stringify(i.body), /…/);
});
