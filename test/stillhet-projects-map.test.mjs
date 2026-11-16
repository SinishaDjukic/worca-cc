// Stillhet slice 9 D5: the pure mapping between a project page's "How its tasks run" sentences and dev's project
// settings (GET/PATCH /api/projects/:key/settings), and its default tags and Labels answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SET_KEYS, setsOf, patchOf, defaultsOf, readinessOf, readinessLine, metricsOf, policyOf, endsOf, knownOf, timeWord } from '../ui/public/stillhet/live/projects-map.mjs';

const state = (own = {}, user = {}) => {
  const ids = ['pr.open', 'run.engine', 'pipelineCostLimitUsd', 'memory.team', 'runUserClaudeSettings'];
  const DEF = { 'pr.open': 'none', 'run.engine': 'claude', pipelineCostLimitUsd: null, 'memory.team': false, runUserClaudeSettings: false };
  const layers = Object.fromEntries(ids.map((id) => [id, { project: own[id], user: user[id], default: DEF[id] }]));
  const effective = Object.fromEntries(ids.map((id) => { const v = own[id] !== undefined ? own[id] : user[id] !== undefined ? user[id] : DEF[id]; return [id, { value: v, source: own[id] !== undefined ? 'project' : 'user' }]; }));
  return { own, effective, layers, roles: [] };
};

test('SET_KEYS is the frozen D5 table: each sentence names its dev setting', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(SET_KEYS).map(([k, v]) => [k, v.id])), { pr: 'pr.open', engine: 'run.engine', cap: 'pipelineCostLimitUsd', memory: 'memory.team', setup: 'runUserClaudeSettings' });
  assert.ok(Object.isFrozen(SET_KEYS));
});

test('setsOf: each sentence reads its word and the word it inherits; a value of the project\'s own is marked own', () => {
  const s = setsOf(state({ 'pr.open': 'draft' }, { pipelineCostLimitUsd: 50 }), false);
  assert.deepEqual(s.pr, { value: 'create a draft PR', yours: 'open no PR', own: true });
  assert.deepEqual(s.cap, { value: '$50', yours: '$50', own: false });
  assert.equal(setsOf(state()).cap.value, 'no cap');
  assert.equal(setsOf(state({ 'run.engine': 'codex' })).engine.value, 'Codex');
  assert.equal(setsOf(state({ 'memory.team': 'only' }), true).memory.value, 'the team\'s notes');
  assert.equal(setsOf(state({ runUserClaudeSettings: true })).setup.value, 'on');
  assert.equal(setsOf(state({ pipelineCostLimitUsd: 35 })).cap.value, '$35', 'a cap outside the list still reads');
});

test('patchOf: a word becomes its setting\'s value; an unknown word throws', () => {
  assert.deepEqual(patchOf('memory', 'the team\'s notes'), { 'memory.team': 'only' });
  assert.deepEqual(patchOf('memory', 'its own notes'), { 'memory.team': false });
  assert.deepEqual(patchOf('cap', 'no cap'), { pipelineCostLimitUsd: null });
  assert.deepEqual(patchOf('pr', 'create a PR ready for review'), { 'pr.open': 'ready' });
  assert.deepEqual(patchOf('engine', 'Gemini CLI'), { 'run.engine': 'gemini' });
  assert.deepEqual(patchOf('setup', 'off'), { runUserClaudeSettings: false });
  assert.throws(() => patchOf('pr', 'open a PR to the moon'));
  assert.throws(() => patchOf('branch', '{type}/{slug}'));
});

test('defaultsOf: tags in the design\'s key: value form and labels, labels [] when absent', () => {
  assert.deepEqual(defaultsOf({ tags: ['team:web'] }), { tags: ['team: web'], labels: [] });
  assert.deepEqual(defaultsOf({ tags: ['a:b'], labels: ['x'] }), { tags: ['a: b'], labels: ['x'] });
  assert.deepEqual(defaultsOf(null), { tags: [], labels: [] });
});

// ---- B4.5: a project page's facts (readiness, team metrics, team policy), its ended tasks and its early record ----
const REPORT = {
  level: 'partial', checkedAt: '2026-11-14T09:00:00.000Z',
  engines: { codex: { used: true, level: 'partial', reasons: [{ kind: 'config', text: 'has AGENTS.md' }] }, claude: { used: true, level: 'ready', reasons: [{ kind: 'run-engine', text: 'runs tasks' }] }, gemini: { used: false, level: 'unused', reasons: [] }, copilot: { used: false, level: 'locked', locked: true, reasons: [] } },
  checks: [
    { id: 'a', title: 'Has a README', scope: 'repository', status: 'fail', severity: 'blocker', fix: 'Add a README.md' },
    { id: 'b', title: 'Has tests', scope: 'repository', status: 'fail', severity: 'warn', fix: 'Add a test command' },
    { id: 'c', title: 'Has a lockfile', scope: 'repository', status: 'fail', severity: 'info' },
    { id: 'd', title: 'Ignored by git', scope: 'repository', status: 'pass', severity: 'warn' },
    { id: 'e', title: 'Claude instructions', scope: 'tool', engine: 'claude', status: 'fail', severity: 'warn' },
    { id: 'f', title: 42, scope: 'repository', status: 'fail', severity: 'warn' },
    { id: 'g', title: 'Odd severity', scope: 'repository', status: 'fail', severity: 'loud' },
  ],
  counts: { mustFix: 1, shouldFix: 2, passed: 5, applicable: 9 },
};

test('F-6-15 readinessOf: off, none, a full report grouped, the run engine first, junk dropped', () => {
  assert.equal(readinessOf(null), null);
  assert.equal(readinessOf('x'), null);
  assert.deepEqual(readinessOf({ disabled: true }), { off: true });
  assert.deepEqual(readinessOf({ readiness: null }), { none: true });
  assert.deepEqual(readinessOf({}), { none: true });
  const r = readinessOf({ readiness: REPORT });
  assert.equal(r.level, 'partial');
  assert.equal(r.word, 'Partly ready');
  assert.deepEqual([r.mustFix, r.shouldFix, r.passed, r.applicable], [1, 2, 5, 9]);
  assert.deepEqual(r.tools, [{ name: 'Claude Code', word: 'Ready' }, { name: 'OpenAI Codex', word: 'Partly ready' }], 'the run engine first');
  assert.deepEqual(r.notJudged, ['Gemini CLI'], 'a locked engine is not offered');
  assert.deepEqual(r.failing, { must: [{ title: 'Has a README', fix: 'Add a README.md' }], should: [{ title: 'Has tests', fix: 'Add a test command' }], advice: [{ title: 'Has a lockfile', fix: '' }] }, 'repository failures only; a non-string title and an unknown severity are dropped');
  assert.equal(r.checkedAt, REPORT.checkedAt);
  assert.equal(readinessOf({ readiness: { ...REPORT, level: 'ready' } }).word, 'Agent-ready');
  assert.equal(readinessOf({ readiness: { ...REPORT, level: 'not-ready' } }).word, 'Not agent-ready');
  assert.equal(readinessOf({ readiness: { ...REPORT, level: 'odd' } }).level, 'unknown');
  assert.equal(readinessOf({ readiness: { level: 'unknown' } }).word, 'Not judged yet');
  const bare = readinessOf({ readiness: { level: 'ready' } });
  assert.deepEqual([bare.tools, bare.notJudged, bare.failing.must, bare.mustFix], [[], [], [], 0], 'a report with no engines, checks or counts');
});

test('F-6-15 readinessLine: the word then the counts, zeros dropped; none failing reads N of M checks pass', () => {
  const r = readinessOf({ readiness: REPORT });
  assert.equal(readinessLine(r), 'Partly ready · 1 must fix, 2 should fix');
  assert.equal(readinessLine({ ...r, mustFix: 0 }), 'Partly ready · 2 should fix');
  assert.equal(readinessLine({ ...r, word: 'Agent-ready', mustFix: 0, shouldFix: 0 }), 'Agent-ready · 5 of 9 checks pass');
  assert.equal(readinessLine({ off: true }), '');
  assert.equal(readinessLine({ none: true }), 'Not judged yet');
  assert.equal(readinessLine(null), '');
});

test('F-6-15 metricsOf: every state in classic\'s words, its scope and its last push', () => {
  const on = { hasOrigin: true, enabled: true, pending: 0, runs: 3, lastSyncAt: '2026-11-14T07:00:00.000Z' };
  assert.equal(metricsOf(null), null);
  assert.deepEqual(metricsOf(on), { state: 'on', word: 'on · 3 tasks', scope: 'this project', lastPush: '2026-11-14T07:00:00.000Z' });
  assert.equal(metricsOf({ ...on, runs: 1 }).word, 'on · 1 task');
  assert.equal(metricsOf({ ...on, runs: null }).word, 'on');
  assert.equal(metricsOf({ ...on, record: false }).word, 'on · yours excluded');
  assert.deepEqual(metricsOf({ hasOrigin: false, enabled: false }), { state: 'no-origin', word: 'not available', scope: '', lastPush: null });
  assert.deepEqual(metricsOf({ hasOrigin: true, enabled: false }), { state: 'off', word: 'off', scope: '', lastPush: null });
  assert.deepEqual(metricsOf({ ...on, delegateTo: 'acme/gateway' }), { state: 'delegated', word: 'via acme/gateway', scope: 'via acme/gateway', lastPush: '2026-11-14T07:00:00.000Z' });
  assert.equal(metricsOf({ ...on, delegateTo: 'acme/gateway', delegateState: 'invalid' }).state, 'delegate-invalid');
  assert.equal(metricsOf({ ...on, delegateTo: 'acme/gateway', delegateState: 'invalid' }).word, 'delegate invalid');
  assert.deepEqual([metricsOf({ ...on, blocked: 'CONFIG_UNKNOWN' }).state, metricsOf({ ...on, blocked: 'CONFIG_UNKNOWN' }).word], ['blocked', 'on · not recording']);
  assert.deepEqual([metricsOf({ ...on, pending: 2, lastError: 'rejected' }).state, metricsOf({ ...on, pending: 2, lastError: 'rejected' }).word], ['rejected', 'push failed']);
  assert.deepEqual([metricsOf({ ...on, pending: 2 }).state, metricsOf({ ...on, pending: 2 }).word], ['pending', 'on · 2 pending push']);
  assert.equal(metricsOf({ ...on, lastSyncAt: null }).lastPush, null);
});

test('F-6-15 policyOf: unlisted is null; off, home, follows and unread in classic\'s words', () => {
  const scopes = (row) => ({ projects: [{ key: 'k1', hasOrigin: true, ...row }] });
  assert.equal(policyOf(null, 'k1'), null);
  assert.equal(policyOf(scopes({ present: true }), 'other'), null);
  assert.deepEqual(policyOf(scopes({ present: false }), 'k1'), { state: 'off', word: 'off', scope: '', updatedAt: null });
  assert.deepEqual(policyOf(scopes({ present: true, home: 'acme/policy', updatedAt: '2026-11-13T00:00:00.000Z' }), 'k1'), { state: 'home', word: 'home', scope: 'acme/policy', updatedAt: '2026-11-13T00:00:00.000Z' });
  assert.deepEqual(policyOf(scopes({ present: true, delegateTo: 'acme/gateway' }), 'k1'), { state: 'follows', word: 'follows acme/gateway', scope: 'acme/gateway', updatedAt: null });
  assert.deepEqual([policyOf(scopes({ present: false, unread: true }), 'k1').state, policyOf(scopes({ present: false, unread: true }), 'k1').word], ['blocked', 'on · unresolved']);
  assert.equal(policyOf(scopes({ present: true, blocked: 'DOC_UNKNOWN' }), 'k1').word, 'on · not read yet');
  assert.equal(policyOf(scopes({ hasOrigin: false }), 'k1').word, 'not available');
  assert.equal(policyOf(scopes({ present: true, unknownSchema: true }), 'k1').word, 'needs a newer Worca');
  assert.equal(policyOf(scopes({ present: true, delegateTo: 'x/y', delegateState: 'invalid' }), 'k1').word, 'follow invalid');
});

test('F-6-15 endsOf: done, stopped and failed counted; other states are not ended', () => {
  assert.deepEqual(endsOf(['ready', 'approved', 'merged', 'kept', 'labelled', 'stopped', 'discarded', 'failed', 'working', 'question', 'paused', 'failing', 'scheduled']), { done: 5, stopped: 2, failed: 1 });
  assert.deepEqual(endsOf(['noproject']), { done: 1, stopped: 0, failed: 0 }, 'dev\'s done with no branch left (finished-nogit) is done too');
  assert.deepEqual(endsOf([]), { done: 0, stopped: 0, failed: 0 });
});

test('F-6-19 knownOf: the early record from GET /api/projects, origin reading, missing or folder', () => {
  const answer = { projects: [{ key: 'k1', name: 'shop', path: '/src/shop', displayPath: '~/src/shop', exists: true, vcs: 'git' }, { key: 'k2', name: 'gone', path: '/x', exists: false, vcs: 'git' }, { key: 'k3', name: 'notes', path: '/n', exists: true, vcs: 'none', workMode: 'folder' }] };
  const k1 = knownOf(answer, 'k1');
  assert.deepEqual([k1.id, k1.name, k1.kind, k1.path, k1.origin, k1.early], ['k1', 'shop', 'Git', '~/src/shop', 'reading', true]);
  assert.equal(knownOf(answer, 'k2').origin, 'missing');
  assert.equal(knownOf(answer, 'k3').origin, 'folder');
  assert.equal(knownOf(answer, 'nope'), null);
  assert.equal(knownOf(null, 'k1'), null);
});

test('F-6-15 timeWord: the last push in relative words', () => {
  const now = Date.parse('2026-11-14T09:00:00.000Z');
  assert.equal(timeWord('2026-11-14T08:59:40.000Z', now), 'just now');
  assert.equal(timeWord('2026-11-14T08:45:00.000Z', now), '15 min ago');
  assert.equal(timeWord('2026-11-14T07:00:00.000Z', now), '2 h ago');
  assert.equal(timeWord('2026-11-12T09:00:00.000Z', now), '2 days ago');
  assert.equal(timeWord('2026-11-13T09:00:00.000Z', now), '1 day ago');
  assert.equal(timeWord('nonsense', now), '');
});
