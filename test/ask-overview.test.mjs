// test/ask-overview.test.mjs — a chat's Overview facts (issue 1064, src/core/ask/overview.mjs): the runs it started (not
// the ones it only follows, not the PR watch's fix runs, plus the runs its recurring schedules fired), their PRs and the
// applied PR cards, the files it showed and saved, and the followed run's branch. Injected readers; a mkdtemp folder for
// the output walk.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildThreadOverview, listOutFiles, OVERVIEW_LIMIT } from '../src/core/ask/overview.mjs';

const TID = 'ask_0000aaaa';
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-overview-')); dirs.push(d); return d; };

const row = (id, over = {}) => ({ id, title: `Run ${id}`, status: 'done', phase: 'done', total_cost_usd: 1.5, started_at: `2026-10-0${id.at(-1)}T00:00:00.000Z`,
  project_key: 'app-0000aaaa', target: 'project', branch: JSON.stringify({ source: 'dev', feature: `feat/${id}` }), outcome: null, resume_point: null, deleted_at: null, ...over });
function deps(over = {}) {
  const rows = new Map([
    ['aaaa0001', row('aaaa0001')],
    ['aaaa0002', row('aaaa0002', { outcome: JSON.stringify({ runEngine: 'cursor' }), total_cost_usd: 0 })],
    ['aaaa0003', row('aaaa0003')],
    ['aaaa0004', row('aaaa0004', { target: 'workspace', project_key: null, workspace_meta: JSON.stringify({ workspaceId: 'wks-1', projects: [{ projectKey: 'a' }], branches: { a: { feature: 'feat/ws' } } }) })],
    ['aaaa0005', row('aaaa0005')],
  ]);
  const links = [
    { threadId: TID, runId: 'r-1', pipelineId: 'aaaa0001', cardId: 'card_1', status: 'done' },
    { threadId: TID, runId: 'r-2', pipelineId: 'aaaa0002', cardId: 'card_2', status: 'done' },
    { threadId: TID, runId: 'r-3', pipelineId: 'aaaa0003', cardId: null, status: 'done' },          // track_run: followed only
    { threadId: TID, runId: 'r-5', pipelineId: 'aaaa0005', cardId: 'card_fix', status: 'done' },    // a PR watch fix run
  ];
  const prs = { aaaa0001: { url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN', draft: true }, aaaa0004: { url: 'https://github.com/o/w/pull/2', number: 2, state: 'MERGED' } };
  return {
    listRunLinks: () => links,
    isPrFix: (l) => l.cardId === 'card_fix',
    findPipelineRowById: (id) => rows.get(id) || null,
    scheduleRunIds: () => ['aaaa0004'],
    readPrState: (id) => prs[id] || null,
    listMessages: () => [{ id: 'm1', blocks: [
      { kind: 'card', id: 'card_pr', state: 'applied', card: { type: 'pull-request', pipelineId: 'aaaa0001', result: { url: 'https://github.com/o/r/pull/7', draft: false } } },
      { kind: 'card', id: 'card_pr2', state: 'applied', card: { type: 'pull-request', pipelineId: 'zzzz9999', title: 'Other', result: { url: 'https://github.com/o/r/pull/9', draft: true } } },
      { kind: 'card', id: 'card_pr3', state: 'proposed', card: { type: 'pull-request', result: null } },
    ] }],
    listAttachments: () => [
      { id: 'att_1', messageId: null, hasSource: true, name: 'plan.md', bytes: 10, kind: 'text', mime: 'Markdown', createdAt: '2026-10-05T00:00:00.000Z' },
      { id: 'att_2', messageId: 'm0', hasSource: false, name: 'upload.png', bytes: 5, kind: 'image', mime: 'image/png', createdAt: '2026-10-06T00:00:00.000Z' },
      { id: 'att_3', messageId: null, hasSource: false, name: 'shot.png', bytes: 5, kind: 'image', mime: 'image/png', createdAt: '2026-10-07T00:00:00.000Z' },
    ],
    outDir: () => join(tmpdir(), 'worca-overview-none-0000'),
    followedRunOf: () => 'run:aaaa0003',
    ...over,
  };
}

test('started links only, minus PR fix, plus schedule-fired runs; newest first; cost null for an engine that reports none', async () => {
  const o = await buildThreadOverview(TID, deps());
  assert.deepEqual(o.runs.map((r) => r.pipelineId), ['aaaa0004', 'aaaa0002', 'aaaa0001'], 'tracked aaaa0003 and fix run aaaa0005 absent');
  const r1 = o.runs.find((r) => r.pipelineId === 'aaaa0001');
  assert.deepEqual(r1, { runId: 'r-1', pipelineId: 'aaaa0001', title: 'Run aaaa0001', status: 'done', phase: 'done', costUsd: 1.5, runEngine: 'claude',
    startedAt: '2026-10-01T00:00:00.000Z', href: '#history/app-0000aaaa/aaaa0001', branch: 'feat/aaaa0001' });
  assert.equal(o.runs.find((r) => r.pipelineId === 'aaaa0002').costUsd, null, 'cursor reports no cost');
  assert.equal(o.runs.find((r) => r.pipelineId === 'aaaa0002').runEngine, 'cursor');
  const ws = o.runs.find((r) => r.pipelineId === 'aaaa0004');
  assert.equal(ws.href, '#history/workspaces/wks-1/aaaa0004');
  assert.equal(ws.branch, 'feat/ws');
  assert.equal(ws.runId, 'aaaa0004', 'a schedule-fired run has no link: its pipeline id');
  const gone = await buildThreadOverview(TID, deps({ findPipelineRowById: (id) => (id === 'aaaa0001' ? null : row(id, { deleted_at: id === 'aaaa0002' ? 'x' : null })) }));
  assert.deepEqual(gone.runs.map((r) => r.pipelineId), ['aaaa0004'], 'missing and deleted rows are left out');
});

test('PRs from runs and applied cards, deduped by url, labels and states', async () => {
  const o = await buildThreadOverview(TID, deps());
  assert.deepEqual(o.prs, [
    { url: 'https://github.com/o/w/pull/2', label: 'o/w#2', refKey: 'gh:o/w#2', title: 'Run aaaa0004', state: 'merged', runId: 'aaaa0004', source: 'run' },
    { url: 'https://github.com/o/r/pull/7', label: 'o/r#7', refKey: 'gh:o/r#7', title: 'Run aaaa0001', state: 'draft', runId: 'r-1', source: 'run' },
    { url: 'https://github.com/o/r/pull/9', label: 'o/r#9', refKey: 'gh:o/r#9', title: 'Other', state: 'draft', runId: null, source: 'card' },
  ]);
  const odd = await buildThreadOverview(TID, deps({ readPrState: () => null, listMessages: () => [{ blocks: [{ kind: 'card', state: 'applied', card: { type: 'pull-request', result: { url: 'https://example.com/pr/1' } } }] }] }));
  assert.deepEqual(odd.prs.map((p) => [p.label, p.refKey, p.state]), [['https://example.com/pr/1', null, 'open']]);
});

test('artifacts: shown copies + out files, newest first, limit 50 + total', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'report.md'), 'x');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'b.txt'), 'yy');
  utimesSync(join(dir, 'report.md'), new Date('2026-10-09T00:00:00Z'), new Date('2026-10-09T00:00:00Z'));
  utimesSync(join(dir, 'sub', 'b.txt'), new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
  const o = await buildThreadOverview(TID, deps({ outDir: () => dir }));
  assert.deepEqual(o.artifacts, [
    { source: 'out', path: 'report.md', name: 'report.md', bytes: 1, at: '2026-10-09T00:00:00.000Z' },
    { source: 'shown', attId: 'att_1', name: 'plan.md', bytes: 10, kind: 'text', mime: 'Markdown', at: '2026-10-05T00:00:00.000Z' },
    { source: 'out', path: 'sub/b.txt', name: 'b.txt', bytes: 2, at: '2026-10-01T00:00:00.000Z' },
  ], 'an upload and an unsourced screenshot are not artifacts');
  assert.equal(o.artifactsTotal, 3);
  const many = Array.from({ length: 73 }, (_, i) => ({ id: `att_${i}`, messageId: null, hasSource: true, name: `f${i}.md`, bytes: 1, kind: 'text', mime: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  const big = await buildThreadOverview(TID, deps({ listAttachments: () => many }));
  assert.equal(OVERVIEW_LIMIT, 50);
  assert.equal(big.artifacts.length, 50);
  assert.equal(big.artifactsTotal, 73);
  assert.equal(big.artifacts[0].name, 'f72.md');
});

test('limit 50 on runs and PRs', async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `b${String(i).padStart(7, '0')}`);
  const o = await buildThreadOverview(TID, deps({ listRunLinks: () => ids.map((p, i) => ({ runId: `r${i}`, pipelineId: p, cardId: 'c' })),
    findPipelineRowById: (id) => row(id, { started_at: new Date(Date.UTC(2026, 0, 1, 0, Number(id.slice(1)))).toISOString() }),
    readPrState: (id) => ({ url: `https://github.com/o/r/pull/${Number(id.slice(1)) + 1}`, state: 'OPEN' }), scheduleRunIds: () => [], listMessages: () => [], followedRunOf: () => null }));
  assert.equal(o.runs.length, 50);
  assert.equal(o.runs[0].pipelineId, 'b0000059');
  assert.equal(o.prs.length, 50);
});

test('followedRun branch; none when the chat follows no run', async () => {
  const o = await buildThreadOverview(TID, deps());
  assert.deepEqual(o.environment, { followedRun: { pipelineId: 'aaaa0003', title: 'Run aaaa0003', branch: 'feat/aaaa0003' } });
  const none = await buildThreadOverview(TID, deps({ followedRunOf: () => null }));
  assert.deepEqual(none.environment, { followedRun: null });
});

test('listOutFiles skips links, dot-folders, caps; a missing folder is []', async () => {
  const dir = tmp();
  const outside = tmp();
  writeFileSync(join(outside, 'secret.txt'), 'no');
  writeFileSync(join(dir, 'a.txt'), 'a');
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.git', 'HEAD'), 'x');
  mkdirSync(join(dir, 'd1', 'd2', 'd3', 'd4', 'd5'), { recursive: true });
  writeFileSync(join(dir, 'd1', 'd2', 'd3', 'deep.txt'), 'x');
  writeFileSync(join(dir, 'd1', 'd2', 'd3', 'd4', 'd5', 'too-deep.txt'), 'x');
  symlinkSync(outside, join(dir, 'link-dir'));
  symlinkSync(join(outside, 'secret.txt'), join(dir, 'link-file.txt'));
  const files = await listOutFiles(dir);
  assert.deepEqual(files.map((f) => f.path).sort(), ['a.txt', 'd1/d2/d3/deep.txt']);
  assert.ok(files.every((f) => typeof f.at === 'string' && Number.isInteger(f.bytes) && f.name === f.path.split('/').at(-1)));
  const capDir = tmp();
  for (let i = 0; i < 12; i++) writeFileSync(join(capDir, `f${i}.txt`), 'x');
  assert.equal((await listOutFiles(capDir, { max: 5 })).length, 5);
  assert.deepEqual(await listOutFiles(join(dir, 'nope')), []);
  assert.deepEqual(await listOutFiles(join(dir, 'link-dir')), [], 'the folder itself a link: nothing');
});
