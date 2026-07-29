// test/runner-args.test.mjs
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildEffortArgs } from '../src/core/claude-runner.mjs';

let prevFlag;
beforeEach(() => {
  prevFlag = process.env.WORCA_EFFORT_FLAG;
  delete process.env.WORCA_EFFORT_FLAG;
});
afterEach(() => {
  if (prevFlag === undefined) delete process.env.WORCA_EFFORT_FLAG;
  else process.env.WORCA_EFFORT_FLAG = prevFlag;
});

test('buildEffortArgs maps an effort to the default CLI flag', () => {
  assert.deepEqual(buildEffortArgs('xhigh'), ['--effort', 'xhigh']);
});

test('buildEffortArgs adds nothing when effort is empty', () => {
  assert.deepEqual(buildEffortArgs(''), []);
  assert.deepEqual(buildEffortArgs(undefined), []);
});

test('buildEffortArgs honors the WORCA_EFFORT_FLAG override', () => {
  process.env.WORCA_EFFORT_FLAG = '--reasoning-effort';
  assert.deepEqual(buildEffortArgs('high'), ['--reasoning-effort', 'high']);
});
