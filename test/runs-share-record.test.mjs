// test/runs-share-record.test.mjs — the run-sharing record v1 (run sharing s1, §2a): a 14-key allow-list, no free text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORD_KEYS, RECORD_MAX_BYTES, RECORD_VERSION, END_STATUSES, TERMINAL_STATUSES,
  recordFromHarness, recordFromRow, cleanPrUrl, serializeRecord, sameRecord, sanitizeRecord,
} from '../src/core/runs-share/record.mjs';

const PK = '0123456789abcdef';
const NOW = new Date('2026-11-07T10:00:00.000Z');
const TOKEN = 'ghp_FAKEtoken1234567890abcdefABCDEF123456';

function harness(state = {}, extra = {}) {
  return {
    pipeline: { id: 'a1b2c3d4', dir: null, promptText: `fix it ${TOKEN}` },
    claude: { mock: false },
    members: [{ projectKey: 'shop-12345678', projectDir: '/repos/shop' }],
    workflowId: 'wf_default',
    resolved: { template: { id: 'wf_custom', name: `Custom ${TOKEN}` } },
    state: {
      status: 'running', phase: 'build', title: `Title ${TOKEN}`, prompt: `Prompt ${TOKEN}`,
      totalCostUsd: 1.23456, startedAt: '2026-11-07T09:00:00.000Z', updatedAt: '2026-11-07T09:59:00.000Z',
      steps: [{ label: `Step ${TOKEN}`, nodeId: 'n1', status: 'running' }],
      stepper: { graph: { nodes: [{ id: 'n1', label: `Node ${TOKEN}` }] } },
      ...state,
    },
    ...extra,
  };
}
const build = (state, extra, opts = {}) => recordFromHarness(harness(state, extra), { personKey: PK, startedBy: 'Ana', prUrl: null, now: NOW, ...opts });

test('the serialized record holds exactly the 14 allow-listed keys, sorted, newline-terminated', () => {
  assert.equal(RECORD_KEYS.length, 14);
  assert.equal(RECORD_VERSION, 1);
  assert.equal(RECORD_MAX_BYTES, 2048);
  assert.ok(Object.isFrozen(RECORD_KEYS));
  assert.deepEqual([...RECORD_KEYS], [...RECORD_KEYS].sort());
  const rec = build();
  const text = serializeRecord(rec);
  assert.ok(text.endsWith('\n'));
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed), [...RECORD_KEYS]);
  assert.deepEqual(parsed, {
    v: 1, runId: 'a1b2c3d4', personKey: PK, workflowId: 'wf_custom', status: 'running', phase: 'build',
    stage: parsed.stage, progress: parsed.progress, costUsd: 1.23, startedBy: 'Ana',
    startedAt: '2026-11-07T09:00:00.000Z', updatedAt: NOW.toISOString(), finishedAt: null, prUrl: null,
  });
  assert.ok(parsed.progress === null || (parsed.progress >= 0 && parsed.progress <= 1));
});

test('a fake token in the prompt, title and step labels never reaches the bytes', () => {
  const text = serializeRecord(build());
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes('ghp_'), false);
});

test('status mapping: idle/created/starting are not published; error stays; paused has no finishedAt; done has one', () => {
  for (const s of ['idle', 'created', 'starting']) assert.equal(build({ status: s }), null, s);
  assert.equal(build({ status: 'error' }).status, 'error');
  assert.equal(build({ status: 'weird' }).status, 'running');
  const paused = build({ status: 'paused' });
  assert.equal(paused.status, 'paused');
  assert.equal(paused.finishedAt, null);
  const done = build({ status: 'done' });
  assert.equal(done.finishedAt, '2026-11-07T09:59:00.000Z');
  assert.ok(END_STATUSES.includes('paused') && !TERMINAL_STATUSES.includes('paused'));
  assert.deepEqual([...TERMINAL_STATUSES].sort(), ['done', 'error', 'interrupted', 'stopped']);
});

test('field patterns: a bad workflow id or phase becomes null; cost is rounded and never negative', () => {
  const rec = build({ phase: 'Build Phase!', totalCostUsd: -3 }, { resolved: null, workflowId: 'has space' });
  assert.equal(rec.phase, null);
  assert.equal(rec.workflowId, null);
  assert.equal(rec.costUsd, 0);
  assert.equal(build({}, { resolved: null }).workflowId, 'wf_default');
  assert.equal(build({}, {}, { startedBy: `x\u0007${'y'.repeat(200)}` }).startedBy.length, 80);
  assert.equal(build({}, {}, { startedBy: `a\u0000b` }).startedBy, 'ab');
});

test('cleanPrUrl keeps https only, without userinfo, query or fragment, at most 300 chars', () => {
  assert.equal(cleanPrUrl('javascript:x'), null);
  assert.equal(cleanPrUrl('https://u:p@h/x'), null);
  assert.equal(cleanPrUrl('http://h/x'), null);
  assert.equal(cleanPrUrl('https://h/p?token=t#f'), 'https://h/p');
  assert.equal(cleanPrUrl(`https://h/${'a'.repeat(300)}`), null);
  assert.equal(cleanPrUrl(null), null);
  assert.equal(cleanPrUrl('not a url'), null);
  assert.equal(build({}, {}, { prUrl: 'https://github.com/o/r/pull/7?x=1' }).prUrl, 'https://github.com/o/r/pull/7');
});

test('a bad run id or person key builds nothing (no path from it)', () => {
  assert.equal(build({}, { pipeline: { id: '../x' } }), null);
  assert.equal(build({}, {}, { personKey: PK.slice(1) }), null);
  assert.equal(recordFromRow({ id: '../x', status: 'done' }, { personKey: PK, now: NOW }), null);
});

test('skipped runs: mock, workspace, no project key', () => {
  assert.equal(build({}, { claude: { mock: true } }), null);
  assert.equal(build({}, { isWorkspace: true }), null);
  assert.equal(build({}, { members: [{ projectKey: null, projectDir: '/x' }] }), null);
});

test('recordFromRow: the same shape from a pipelines row, stage/progress null', () => {
  const rec = recordFromRow({ id: 'a1b2c3d4', status: 'done', phase: 'review', total_cost_usd: 2.005, started_at: '2026-11-07T09:00:00.000Z', updated_at: '2026-11-07T09:30:00.000Z', stepper: JSON.stringify({ template: { id: 'wf_x' } }), title: TOKEN, prompt: TOKEN },
    { personKey: PK, startedBy: null, prUrl: 'https://h/p', now: NOW });
  assert.deepEqual(Object.keys(rec).sort(), [...RECORD_KEYS]);
  assert.equal(rec.stage, null);
  assert.equal(rec.progress, null);
  assert.equal(rec.workflowId, 'wf_x');
  assert.equal(rec.finishedAt, '2026-11-07T09:30:00.000Z');
  assert.equal(rec.prUrl, 'https://h/p');
  assert.equal(serializeRecord(rec).includes(TOKEN), false);
  assert.notEqual(sanitizeRecord(JSON.parse(serializeRecord(rec))), null, 'a row record reads back');
  assert.equal(recordFromRow({ id: 'a1b2c3d4', status: 'done', workspace_key: 'ws-1' }, { personKey: PK, now: NOW }), null, 'a workspace row is skipped (D18)');
});

test('a record over the byte cap throws RECORD_TOO_LARGE', () => {
  const rec = build();
  assert.throws(() => serializeRecord(rec, 64), (e) => e.code === 'RECORD_TOO_LARGE');
  assert.throws(() => serializeRecord({ ...rec, startedBy: 'x'.repeat(3000) }), (e) => e.code === 'RECORD_TOO_LARGE');
});

test('sameRecord ignores updatedAt only', () => {
  const a = build();
  assert.equal(sameRecord(a, { ...a, updatedAt: '2030-01-01T00:00:00.000Z' }), true);
  assert.equal(sameRecord(a, { ...a, costUsd: 9 }), false);
  assert.equal(sameRecord(a, null), false);
});

test('sanitizeRecord: exact key set and types', () => {
  const rec = JSON.parse(serializeRecord(build()));
  assert.deepEqual(sanitizeRecord(rec), rec);
  assert.equal(sanitizeRecord({ ...rec, title: 'x' }), null, 'an extra key');
  const missing = { ...rec }; delete missing.prUrl;
  assert.equal(sanitizeRecord(missing), null, 'a missing key');
  assert.equal(sanitizeRecord({ ...rec, prUrl: 'https://h/p?token=t' }), null);
  assert.equal(sanitizeRecord({ ...rec, status: 'idle' }), null);
  assert.equal(sanitizeRecord({ ...rec, runId: '../x' }), null);
  assert.equal(sanitizeRecord({ ...rec, progress: 2 }), null);
  assert.equal(sanitizeRecord(null), null);
});
