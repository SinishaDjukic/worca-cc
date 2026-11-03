// test/split-real-e2e.test.mjs — the T2 driver's pure parts: flow judging, the server env and the auto answers. The driver
// itself needs a real claude login and never runs in npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeFlow, realEnv, FLOWS, answerFor, SETTLED } from '../tools/split-real-e2e.mjs';

const side = (o = {}) => ({ ok: true, status: 'done', structure: { view: ['runs'], headings: ['h2:Runs'], tabs: [], buttons: 12 }, console: [], ...o });

test('judgeFlow: both ok, same structure and status, and no console error of B that A lacks', () => {
  assert.deepEqual(judgeFlow('run', side(), side()), { id: 'run', ok: true, detail: 'same structure and status; 0 new console errors' });
  assert.match(judgeFlow('run', side(), side({ ok: false, error: 'timeout' })).detail, /B failed: timeout/);
  assert.match(judgeFlow('run', side(), side({ status: 'error' })).detail, /status done ≠ error/);
  assert.match(judgeFlow('run', side(), side({ structure: { ...side().structure, tabs: ['tab:Diff'] } })).detail, /structure differs: tabs/);
  assert.match(judgeFlow('chat', side({ console: ['x'] }), side({ console: ['x', 'y'] })).detail, /1 new console error: y/);
  assert.equal(judgeFlow('chat', side({ console: ['x'] }), side({ console: ['x'] })).ok, true);
});

test('realEnv: temp HOME and WORCA_HOME, the given port, no mock, no host WORCA_* and no FORCE_COLOR', () => {
  const env = realEnv({ PATH: '/bin', PORT: '4317', FORCE_COLOR: '1', WORCA_MOCK: '1', WORCA_PIPELINE_DIR: '/x', HOME: '/real' }, { home: '/h', port: 4941, stubLog: '/h/s.ndjson' });
  assert.deepEqual([env.HOME, env.WORCA_HOME, env.PORT, env.WORCA_MOCK, env.WORCA_PIPELINE_DIR, env.FORCE_COLOR],
    ['/h', '/h', '4941', undefined, undefined, undefined]);
  assert.equal(env.WORCA_STUB_APPS_LOG, '/h/s.ndjson');
  assert.throws(() => realEnv({}, { home: '/h', port: 4317 }), /4317/);
});

test('the flows are the request\'s list', () => {
  assert.deepEqual(FLOWS, ['pages', 'chat', 'run', 'history', 'setting', 'labs']);
});

test('answerFor: questions/clarify get the first option text; a gate continues; other kinds have no auto answer', () => {
  assert.deepEqual(answerFor({ kind: 'questions', questions: [{ id: 'q1', options: ['', 'Keep it', 'Drop it'] }, { id: 'q2' }] }),
    { answers: [{ id: 'q1', choice: 'Keep it' }, { id: 'q2', choice: 'auto' }] });
  assert.deepEqual(answerFor({ kind: 'clarify', questions: [] }), { answers: [] });
  assert.deepEqual(answerFor({ kind: 'gate' }), { decision: 'continue' });
  for (const kind of ['recovery', 'form', 'workflow']) assert.equal(answerFor({ kind }), null, kind);
});

test('SETTLED is the server\'s settled set, paused and interrupted included', () => {
  assert.deepEqual(SETTLED, ['done', 'stopped', 'error', 'paused', 'interrupted']);
});
