// test/run-slots-owner.test.mjs — a run slot's owner is its process AND that process's start time:
// a pid reused by a new process (a restarted container's fresh pid namespace) does not keep the slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotOwnerAlive } from '../src/core/run-slots.mjs';
import { processStartTicks } from '../src/core/agent-groups.mjs';

test('a dead pid frees the slot regardless of start time', () => {
  assert.equal(slotOwnerAlive({ id: 'a', pid: 4242, startTicks: 10 }, { alive: () => false, startTicks: () => 10 }), false);
});

test('a live pid with no recorded start time keeps the slot (pre-upgrade slot files, macOS)', () => {
  assert.equal(slotOwnerAlive({ id: 'a', pid: 4242 }, { alive: () => true, startTicks: () => 99 }), true);
  assert.equal(slotOwnerAlive({ id: 'a', pid: 4242, startTicks: null }, { alive: () => true, startTicks: () => 99 }), true);
});

test('a live pid whose start time matches keeps the slot; a different start time is a reused pid', () => {
  assert.equal(slotOwnerAlive({ id: 'a', pid: 4242, startTicks: 10 }, { alive: () => true, startTicks: () => 10 }), true);
  assert.equal(slotOwnerAlive({ id: 'a', pid: 4242, startTicks: 10 }, { alive: () => true, startTicks: () => 11 }), false);
});

test('where /proc has no answer for a live pid the pid rules', () => {
  assert.equal(slotOwnerAlive({ id: 'a', pid: 4242, startTicks: 10 }, { alive: () => true, startTicks: () => null }), true);
});

test('the real process: its own slot, recorded with its real start time, is alive', () => {
  assert.equal(slotOwnerAlive({ id: 'me', pid: process.pid, startTicks: processStartTicks(process.pid) }), true);
});
