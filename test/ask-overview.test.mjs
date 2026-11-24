// test/ask-overview.test.mjs — a chat's Overview facts (issue 1064, src/core/ask/overview.mjs): the runs it started (not
// the ones it only follows, not the PR watch's fix runs, plus the runs its recurring schedules fired), their PRs and the
// applied PR cards, the files it showed and saved, and the followed run's branch. Injected readers; a mkdtemp folder for
// the output walk.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, utimesSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { mimeForPath } from '../src/shared/artifact-kinds.mjs';
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
    startedAt: '2026-10-01T00:00:00.000Z', href: '#history/app-0000aaaa/aaaa0001', branch: 'feat/aaaa0001', fixes: [] });
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
    { source: 'shown', attId: 'att_1', name: 'plan.md', bytes: 10, kind: 'markdown', mime: 'Markdown', at: '2026-10-05T00:00:00.000Z' },   // the card kind, not the storage kind
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

test('artifacts: a shown copy carries the card kind (pdf, office, svg, csv, html, json, diff), never the storage kind', async () => {
  const at = '2026-10-05T00:00:00.000Z';
  const copy = (id, name, kind, mime) => ({ id, messageId: null, hasSource: true, name, bytes: 9, kind, mime, createdAt: at });
  const stored = [
    copy('att_1', 'report.pdf', 'binary', 'application/pdf'),
    copy('att_2', 'deck.docx', 'binary', mimeForPath('deck.docx')),
    copy('att_3', 'logo.svg', 'image', 'image/svg+xml'),
    copy('att_4', 'data.csv', 'text', 'text/csv'),
    copy('att_5', 'page.html', 'text', 'text/html'),
    copy('att_6', 'data.json', 'text', 'application/json'),
    copy('att_7', 'change.diff', 'text', 'text/x-diff'),
  ];
  const o = await buildThreadOverview(TID, deps({ listAttachments: () => stored }));
  const kinds = Object.fromEntries(o.artifacts.map((a) => [a.attId, a.kind]));
  assert.deepEqual(kinds, { att_1: 'pdf', att_2: 'office', att_3: 'svg', att_4: 'csv', att_5: 'html', att_6: 'json', att_7: 'diff' });
  assert.deepEqual(o.artifacts.map((a) => a.mime), stored.map((a) => a.mime), 'the mime is the stored one');
});

/** An out folder reached through a symlinked PARENT (never a link itself: listOutFiles lists nothing then), holding a
 *  shown file, a never-shown one, a same-named copy shown from elsewhere and a shown file in a sub-folder. */
function dedupeFixture() {
  const real = realpathSync(tmp());
  const link = join(tmp(), 'parent-link');
  symlinkSync(dirname(real), link);
  const other = realpathSync(tmp());
  mkdirSync(join(real, 'sub'));
  for (const p of ['report.pdf', 'live.pdf', 'same.pdf', 'sub/deep.pdf']) writeFileSync(join(real, ...p.split('/')), '%PDF-1.4');
  writeFileSync(join(other, 'same.pdf'), '%PDF-1.4');
  const at = '2026-10-05T00:00:00.000Z';
  const copy = (id, name) => ({ id, messageId: null, hasSource: true, name, bytes: 8, kind: 'binary', mime: 'application/pdf', createdAt: at });
  const sources = { att_r: join(real, 'report.pdf'), att_s: join(other, 'same.pdf'), att_d: join(real, 'sub', 'deep.pdf') };
  return { real, other, sources, over: { listAttachments: () => [copy('att_r', 'report.pdf'), copy('att_s', 'same.pdf'), copy('att_d', 'deep.pdf')],
    outDir: () => join(link, basename(real)) } };
}

test('artifacts: an out file the chat showed is listed once, as its stored copy; a never-shown out file and a same-named copy shown from elsewhere keep their out rows; artifactsTotal counts once', async () => {
  const f = dedupeFixture();
  const asked = [];
  const o = await buildThreadOverview(TID, deps({ ...f.over, sourcePathOf: (tid, attId) => { asked.push([tid, attId]); return f.sources[attId] ?? null; } }));
  assert.deepEqual(o.artifacts.map((a) => [a.source, a.source === 'out' ? a.path : a.name]).sort(),
    [['out', 'live.pdf'], ['out', 'same.pdf'], ['shown', 'deep.pdf'], ['shown', 'report.pdf'], ['shown', 'same.pdf']]);
  assert.equal(o.artifactsTotal, 5);
  assert.deepEqual(asked.map(([t]) => t), [TID, TID, TID], 'asked for this chat');
  assert.deepEqual(asked.map(([, id]) => id).sort(), ['att_d', 'att_r', 'att_s']);
  const text = JSON.stringify(o);
  assert.ok(!text.includes(f.real) && !text.includes(f.other), 'no row carries a source path');
});

test('artifacts: the out folder gone between the listing and its realpath: no dedupe, every out row stays (no 500)', async () => {
  const f = dedupeFixture();
  let calls = 0;
  const outDir = () => { calls += 1; return calls === 1 ? f.over.outDir() : join(tmpdir(), 'worca-overview-gone-0000', 'out'); };
  const o = await buildThreadOverview(TID, deps({ ...f.over, outDir, sourcePathOf: (tid, attId) => f.sources[attId] ?? null }));
  assert.equal(calls, 2, 'listed once, realpath once');
  assert.deepEqual(o.artifacts.filter((a) => a.source === 'out').map((a) => a.path).sort(), ['live.pdf', 'report.pdf', 'same.pdf', 'sub/deep.pdf']);
});

test('artifacts: no sourcePathOf dep: nothing is dropped', async () => {
  const f = dedupeFixture();
  const o = await buildThreadOverview(TID, deps(f.over));
  assert.deepEqual(o.artifacts.filter((a) => a.source === 'out').map((a) => a.path).sort(), ['live.pdf', 'report.pdf', 'same.pdf', 'sub/deep.pdf']);
  assert.equal(o.artifactsTotal, 7);
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

// ── Overview › Runs: auto-fix runs nested under their parent, and the Mentioned group (direction dccb697a4) ─────────
const watchRound = (origin, round) => JSON.stringify({ source: 'dev', feature: `feat/${origin}`, roundOf: { pipelineId: origin, round, by: 'watch', kinds: ['ci'] } });
/** aaaa0001 started (PR 7) with two watch rounds; aaaa0002 started; a legacy fix card naming its origin aaaa0002; a
 *  legacy fix card with only the PR url of aaaa0001; a fix round of aaaa0006 (not started here) linked by its card; a
 *  user-asked round of aaaa0001 (no `by`), which is NOT an auto-fix; a fix whose parent row is gone. */
function fixDeps(over = {}) {
  const rows = new Map([
    ['aaaa0001', row('aaaa0001', { total_cost_usd: 1.5 })],
    ['aaaa0002', row('aaaa0002')],
    ['aaaa0006', row('aaaa0006', { title: 'Elsewhere' })],
    ['bbbb0001', row('bbbb0001', { branch: watchRound('aaaa0001', 3), total_cost_usd: 0.25, status: 'running', phase: 'implement', started_at: '2026-10-08T00:00:00.000Z' })],
    ['bbbb0002', row('bbbb0002', { branch: watchRound('aaaa0001', 2), total_cost_usd: 0.5, started_at: '2026-10-09T00:00:00.000Z' })],
    ['bbbb0003', row('bbbb0003', { total_cost_usd: 0.75, started_at: '2026-10-07T00:00:00.000Z' })],
    ['bbbb0004', row('bbbb0004', { total_cost_usd: 0.1, started_at: '2026-10-06T00:00:00.000Z' })],
    ['bbbb0005', row('bbbb0005', { branch: watchRound('aaaa0006', 2), started_at: '2026-10-05T00:00:00.000Z' })],
    ['bbbb0006', row('bbbb0006', { branch: JSON.stringify({ roundOf: { pipelineId: 'aaaa0001', round: 4 } }), started_at: '2026-10-04T00:00:00.000Z' })],
    ['bbbb0007', row('bbbb0007', { branch: watchRound('cccc0001', 2) })],
    ['bbbb0008', row('bbbb0008', { branch: JSON.stringify({ roundOf: { pipelineId: 'aaaa0002', round: 2 } }) })],
    ['bbbb0009', row('bbbb0009', { branch: watchRound('aaaa0001', 5), deleted_at: '2026-10-10T00:00:00.000Z' })],   // a deleted fix round
  ]);
  const fixCards = { card_f3: { originPipelineId: 'aaaa0002', prUrl: 'https://github.com/o/r/pull/8' }, card_f4: { prUrl: 'https://github.com/o/r/pull/7' }, card_f5: { prUrl: 'https://github.com/o/x/pull/1' }, card_f7: { originPipelineId: 'cccc0001' } };
  return deps({
    listRunLinks: () => [
      { threadId: TID, runId: 'r-1', pipelineId: 'aaaa0001', cardId: 'card_1' },
      { threadId: TID, runId: 'r-2', pipelineId: 'aaaa0002', cardId: 'card_2' },
      { threadId: TID, runId: 'r-f3', pipelineId: 'bbbb0003', cardId: 'card_f3' },
      { threadId: TID, runId: 'r-f4', pipelineId: 'bbbb0004', cardId: 'card_f4' },
      { threadId: TID, runId: 'r-f5', pipelineId: 'bbbb0005', cardId: 'card_f5' },
      { threadId: TID, runId: 'r-f7', pipelineId: 'bbbb0007', cardId: 'card_f7' },
      { threadId: TID, runId: 'r-r2', pipelineId: 'bbbb0002', cardId: 'card_r2' },     // a run card, yet the row is a watch round
      { threadId: TID, runId: 'r-8', pipelineId: 'bbbb0008', cardId: 'card_8' },       // a round the person started here
    ],
    isPrFix: (l) => Object.hasOwn(fixCards, l.cardId),
    prFixOf: (l) => fixCards[l.cardId] || null,
    findPipelineRowById: (id) => rows.get(id) || null,
    scheduleRunIds: () => [],
    readPrState: (id) => (id === 'aaaa0001' ? { url: 'https://github.com/o/r/pull/7', state: 'OPEN' } : id === 'aaaa0006' ? { url: 'https://github.com/o/x/pull/1', state: 'OPEN' } : null),
    roundsOf: (ids) => {
      const out = new Map();
      for (const r of rows.values()) {
        const m = JSON.parse(r.branch || '{}').roundOf;
        if (!m || !ids.includes(m.pipelineId)) continue;
        if (!out.has(m.pipelineId)) out.set(m.pipelineId, []);
        out.get(m.pipelineId).push({ round: m.round, pipelineId: r.id, status: r.status, request: '', ...(m.by === 'watch' ? { by: 'watch' } : {}) });
      }
      return out;
    },
    listMessages: () => [{ id: 'm1', role: 'assistant', text: 'The watch is on it: bbbb0001, and bbbb0003 before.', blocks: [] }],   // fixes named in a reply
    followedRunOf: () => null,
    ...over,
  });
}

test('auto-fix runs: nested under the run whose PR they fix (watch round marker, card origin, card PR url), ordered by round, own cost, never their own row', async () => {
  const o = await buildThreadOverview(TID, fixDeps());
  assert.deepEqual(o.runs.map((r) => r.pipelineId), ['bbbb0008', 'aaaa0002', 'aaaa0001'], 'no fix run is a started row; a round the person started is one');
  assert.deepEqual(o.runs[0].fixes, []);
  const r1 = o.runs.find((r) => r.pipelineId === 'aaaa0001');
  assert.deepEqual(r1.fixes, [
    { runId: 'r-r2', pipelineId: 'bbbb0002', n: 1, status: 'done', phase: 'done', costUsd: 0.5, runEngine: 'claude', startedAt: '2026-10-09T00:00:00.000Z', href: '#history/app-0000aaaa/bbbb0002' },
    { runId: 'bbbb0001', pipelineId: 'bbbb0001', n: 2, status: 'running', phase: 'implement', costUsd: 0.25, runEngine: 'claude', startedAt: '2026-10-08T00:00:00.000Z', href: '#history/app-0000aaaa/bbbb0001' },
    { runId: 'r-f4', pipelineId: 'bbbb0004', n: 3, status: 'done', phase: 'done', costUsd: 0.1, runEngine: 'claude', startedAt: '2026-10-06T00:00:00.000Z', href: '#history/app-0000aaaa/bbbb0004' },
  ], 'rounds 2, 3 (from the watch marker), then the legacy card matched by its PR url; a user-asked round is not an auto-fix');
  assert.equal(r1.costUsd, 1.5, 'the fixes\' cost is never added to the parent\'s');
  assert.deepEqual(o.runs.find((r) => r.pipelineId === 'aaaa0002').fixes.map((f) => [f.pipelineId, f.n, f.costUsd]), [['bbbb0003', 1, 0.75]], 'the card\'s originPipelineId wins over its PR url');
  assert.deepEqual(o.prs.filter((p) => p.source !== 'mentioned').map((p) => p.url), ['https://github.com/o/r/pull/7'], 'a fix run adds no PR');
  const text = JSON.stringify(o);
  assert.ok(!text.includes('bbbb0006'), 'a round the person asked for is not an auto-fix');
  assert.ok(!text.includes('bbbb0007') && !text.includes('cccc0001'), 'a fix whose parent row is gone is left out');
});

test('auto-fix runs: a fix whose parent was not started here goes under that parent in Mentioned (no cost); the PR url is never the only key for a parent elsewhere', async () => {
  const o = await buildThreadOverview(TID, fixDeps());
  assert.deepEqual(o.mentioned, [{ runId: 'aaaa0006', pipelineId: 'aaaa0006', title: 'Elsewhere', status: 'done', phase: 'done', href: '#history/app-0000aaaa/aaaa0006', source: 'fix',
    fixes: [{ runId: 'r-f5', pipelineId: 'bbbb0005', n: 1, status: 'done', phase: 'done', startedAt: '2026-10-05T00:00:00.000Z', href: '#history/app-0000aaaa/bbbb0005' }] }]);
  assert.deepEqual(o.prs.at(-1), { ...o.prs.at(-1), url: 'https://github.com/o/x/pull/1', source: 'mentioned' }, 'the mentioned parent\'s PR comes last, marked mentioned');
  const none = await buildThreadOverview(TID, fixDeps({ roundsOf: undefined, prFixOf: undefined }));
  assert.deepEqual(none.runs.map((r) => [r.pipelineId, r.fixes.map((f) => f.pipelineId)]), [['bbbb0008', []], ['aaaa0002', []], ['aaaa0001', ['bbbb0002', 'bbbb0001']]],
    'without the readers a fix card names no parent and is dropped as before; the linked and the named fix still read their round marker');
  assert.deepEqual(none.mentioned.map((m) => [m.pipelineId, m.fixes.map((f) => f.pipelineId)]), [['aaaa0006', ['bbbb0005']]], 'the round marker on the fix\'s own row still names its parent');
  assert.deepEqual(o.mentioned.map((m) => m.pipelineId), ['aaaa0006'], 'a fix named in a reply (a watch round or a fix card\'s run) is nested, never a Mentioned row');
});

test('mentioned: tracked links, the followed run and the runs replies named (links, #history, 8-hex; not in code, not user text, confirmed rows only); started runs never repeat; deduped; no cost; their PRs last, marked mentioned', async () => {
  const rows = new Map(['aaaa0001', 'aaaa0003', 'aaaa0006', 'aaaa0007', 'aaaa0008', 'aaaa0009', 'aaaa000a', 'aaaa000b', 'aaaa000c'].map((id, i) => [id, row(id, { started_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() })]));
  const reply = (text) => ({ id: `m-${text.length}`, role: 'assistant', text, blocks: [] });
  const o = await buildThreadOverview(TID, deps({
    listRunLinks: () => [{ threadId: TID, runId: 'r-1', pipelineId: 'aaaa0001', cardId: 'card_1' }, { threadId: TID, runId: 'r-3', pipelineId: 'aaaa0003', cardId: null }],
    isPrFix: () => false,
    findPipelineRowById: (id) => rows.get(id) || null,
    scheduleRunIds: () => [],
    followedRunOf: () => 'run:aaaa000b',
    readPrState: (id) => ({ url: `https://github.com/o/r/pull/${parseInt(id.slice(-1), 16)}`, state: 'OPEN' }),
    listMessages: () => [
      { id: 'u1', role: 'user', text: 'what about aaaa000c?', blocks: [] },
      reply('See [the run](#history/app-0000aaaa/aaaa0006) and #history/workspaces/wks-1/aaaa0007, then aaaa0008 and aaaa0003 and aaaa0001.'),
      reply('Not `aaaa0009` and not\n```\naaaa000a\n```\nnor ffff0000 (no row) nor deadbeef12.'),
      reply('aaaa0008 again.'),
    ],
  }));
  assert.deepEqual(o.runs.map((r) => r.pipelineId), ['aaaa0001']);
  assert.deepEqual(o.mentioned.map((m) => [m.pipelineId, m.source]), [['aaaa000b', 'followed'], ['aaaa0008', 'reply'], ['aaaa0007', 'reply'], ['aaaa0006', 'reply'], ['aaaa0003', 'link']],
    'newest first; the tracked link keeps its source when a reply names it too');
  assert.deepEqual(o.mentioned.find((m) => m.pipelineId === 'aaaa0003'), { runId: 'r-3', pipelineId: 'aaaa0003', title: 'Run aaaa0003', status: 'done', phase: 'done', href: '#history/app-0000aaaa/aaaa0003', source: 'link', fixes: [] });
  assert.ok(o.mentioned.every((m) => !('costUsd' in m)), 'no cost');
  assert.deepEqual(o.prs.filter((p) => p.source !== 'mentioned').map((p) => p.url), ['https://github.com/o/r/pull/1'], 'the started run\'s PR first');
  assert.ok(o.prs.slice(1).every((p) => p.source === 'mentioned'), 'then the mentioned runs\' PRs, marked');
  const started = await buildThreadOverview(TID, deps({ listRunLinks: () => [{ threadId: TID, runId: 'r-1', pipelineId: 'aaaa0001', cardId: 'card_1' }], isPrFix: () => false,
    findPipelineRowById: (id) => rows.get(id) || null, scheduleRunIds: () => [], followedRunOf: () => 'run:aaaa0001', listMessages: () => [] }));
  assert.deepEqual(started.mentioned, [], 'the followed run that was started here is not repeated');
});

test('mentioned: cap 50, newest first, one row per pipeline id', async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `c${String(i).padStart(7, '0')}`);
  const o = await buildThreadOverview(TID, deps({
    listRunLinks: () => [...ids.map((p, i) => ({ threadId: TID, runId: `r${i}`, pipelineId: p, cardId: null })),
      { threadId: TID, runId: 'live-1', pipelineId: null, cardId: 'c' }, { threadId: TID, runId: 'live-2', pipelineId: 'not-a-pipeline', cardId: null }],
    isPrFix: () => false, scheduleRunIds: () => [], followedRunOf: () => `run:${ids[0]}`,
    findPipelineRowById: (id) => row(id, { started_at: new Date(Date.UTC(2026, 0, 1, 0, Number(id.slice(1)))).toISOString() }),
    listMessages: () => [{ role: 'assistant', text: ids.join(' ') }],
  }));
  assert.equal(o.mentioned.length, 50);
  assert.equal(o.mentioned[0].pipelineId, 'c0000059');
  assert.equal(new Set(o.mentioned.map((m) => m.pipelineId)).size, 50);
  assert.deepEqual(o.runs, [], 'a link with no History id is neither started nor mentioned');
  assert.ok(o.mentioned.every((m) => /^c\d{7}$/.test(m.pipelineId)));
});

test('mentioned: a deleted run is never listed, whether a reply names it or a tracked link points to it; a live one beside it is', async () => {
  const rows = new Map([
    ['aaaa0001', row('aaaa0001')],
    ['aaaa0003', row('aaaa0003', { deleted_at: '2026-10-10T00:00:00.000Z' })],   // tracked, deleted
    ['aaaa0005', row('aaaa0005')],                                              // tracked, live
    ['aaaa0006', row('aaaa0006', { deleted_at: '2026-10-10T00:00:00.000Z' })],   // named in a reply, deleted
    ['aaaa0007', row('aaaa0007')],                                              // named in a reply, live
  ]);
  const o = await buildThreadOverview(TID, deps({
    listRunLinks: () => [{ threadId: TID, runId: 'r-1', pipelineId: 'aaaa0001', cardId: 'card_1' },
      { threadId: TID, runId: 'r-3', pipelineId: 'aaaa0003', cardId: null }, { threadId: TID, runId: 'r-5', pipelineId: 'aaaa0005', cardId: null }],
    isPrFix: () => false, findPipelineRowById: (id) => rows.get(id) || null, scheduleRunIds: () => [], followedRunOf: () => null,
    listMessages: () => [{ id: 'm1', role: 'assistant', text: 'See aaaa0006 and aaaa0007.', blocks: [] }],
  }));
  assert.deepEqual(o.mentioned.map((m) => [m.pipelineId, m.source]), [['aaaa0007', 'reply'], ['aaaa0005', 'link']]);
});

test('mentioned: a run only followed here still gets its watch fix rounds, read by roundsOf and never linked', async () => {
  const rows = new Map([
    ['aaaa0001', row('aaaa0001')],
    ['aaaa0006', row('aaaa0006', { title: 'Followed' })],
    ['bbbb0005', row('bbbb0005', { branch: watchRound('aaaa0006', 2), started_at: '2026-10-05T00:00:00.000Z' })],
  ]);
  const asked = [];
  const o = await buildThreadOverview(TID, deps({
    listRunLinks: () => [{ threadId: TID, runId: 'r-1', pipelineId: 'aaaa0001', cardId: 'card_1' }],
    isPrFix: () => false, findPipelineRowById: (id) => rows.get(id) || null, scheduleRunIds: () => [], followedRunOf: () => 'run:aaaa0006',
    listMessages: () => [],
    roundsOf: (ids) => { asked.push(...ids); return new Map(ids.includes('aaaa0006') ? [['aaaa0006', [{ round: 2, pipelineId: 'bbbb0005', status: 'done', request: '', by: 'watch' }]]] : []); },
  }));
  assert.deepEqual(asked.sort(), ['aaaa0001', 'aaaa0006'], 'the started and the mentioned run are both asked for');
  assert.deepEqual(o.runs.map((r) => [r.pipelineId, r.fixes]), [['aaaa0001', []]]);
  assert.deepEqual(o.mentioned, [{ runId: 'aaaa0006', pipelineId: 'aaaa0006', title: 'Followed', status: 'done', phase: 'done', href: '#history/app-0000aaaa/aaaa0006', source: 'followed',
    fixes: [{ runId: 'bbbb0005', pipelineId: 'bbbb0005', n: 1, status: 'done', phase: 'done', startedAt: '2026-10-05T00:00:00.000Z', href: '#history/app-0000aaaa/bbbb0005' }] }]);
});

test('mentioned: a started run past the 50 cap never moves to Mentioned, even when tracked and named in a reply', async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `d${String(i).padStart(7, '0')}`);   // d0000000 is the oldest
  const o = await buildThreadOverview(TID, deps({
    listRunLinks: () => [...ids.map((p, i) => ({ threadId: TID, runId: `r${i}`, pipelineId: p, cardId: 'c' })), { threadId: TID, runId: 'rt', pipelineId: ids[0], cardId: null }],
    isPrFix: () => false, scheduleRunIds: () => [], followedRunOf: () => null, readPrState: () => null,
    findPipelineRowById: (id) => row(id, { started_at: new Date(Date.UTC(2026, 0, 1, 0, Number(id.slice(1)))).toISOString() }),
    listMessages: () => [{ id: 'm1', role: 'assistant', text: `The first one, ${ids[0]}, is done.`, blocks: [] }],
  }));
  assert.equal(o.runs.length, 50);
  assert.ok(!o.runs.some((r) => r.pipelineId === ids[0]), 'the oldest is past the cap');
  assert.deepEqual(o.mentioned, [], 'it is still a started run, so it is not mentioned');
});

test('namedRunIds: run links, bare #history, 8-hex ids in assistant text, outside code', async () => {
  const { namedRunIds } = await import('../src/core/ask/overview.mjs');
  assert.deepEqual(namedRunIds([
    { role: 'assistant', text: '[a](#history/p-1/aaaa0001/details/diff) #history/workspaces/w/aaaa0002. aaaa0003 `aaaa0004` x/aaaa0005 #running/aaaa0006' },
    { role: 'user', text: 'aaaa0007' },
    { role: 'assistant', text: 'aaaa0003 [b](https://x.test/aaaa0008) [aaaa0009](https://x.test/p)' },
  ]), ['aaaa0001', 'aaaa0002', 'aaaa0003'], 'a link\'s label is not a run (the browser chips none)');
});

test('Artifacts › designs: the design chat\'s own, then the ones its side named (a reply outside code, a hand-off\'s result); never a person\'s text, never an unknown id', async () => {
  const { namedDesignIds } = await import('../src/core/ask/overview.mjs');
  const msgs = [
    { role: 'user', text: 'like d_00000000000a please', blocks: [] },
    { role: 'assistant', text: 'Made it: [the deck](#design/d_00000000000b). Not `d_00000000000c`.', blocks: [] },
    { role: 'system', text: '', blocks: [{ kind: 'tool', output: { ok: true, designId: 'd_00000000000d', link: '#design/d_00000000000d' } }] },
  ];
  assert.deepEqual(namedDesignIds(msgs), ['d_00000000000b', 'd_00000000000d']);
  const known = { d_00000000000b: { id: 'd_00000000000b', title: 'Launch deck', kind: 'presentation', updatedAt: '2026-10-09T00:00:00.000Z' },
    d_00000000000e: { id: 'd_00000000000e', title: 'Own page', kind: 'web', updatedAt: '2026-10-01T00:00:00.000Z' } };
  const o = await buildThreadOverview(TID, deps({ listMessages: () => msgs, designOfThread: () => 'd_00000000000e', getDesign: (id) => known[id] || null }));
  assert.deepEqual(o.artifacts.filter((a) => a.source === 'design').map((a) => [a.designId, a.name, a.kind]),
    [['d_00000000000b', 'Launch deck', 'presentation'], ['d_00000000000e', 'Own page', 'web']], 'newest first, with the files');
});

test('Artifacts › designs: the ones the chat asked for (the stored origin) are listed with no message naming them; one row each, an unseen one dropped', async () => {
  const known = { d_0000000000a1: { id: 'd_0000000000a1', title: 'Asked', kind: 'web', updatedAt: '2026-10-05T00:00:00.000Z' },
    d_0000000000a2: { id: 'd_0000000000a2', title: 'Asked and named', kind: 'web', updatedAt: '2026-10-04T00:00:00.000Z' } };
  const msgs = [{ role: 'assistant', text: 'Made [it](#design/d_0000000000a2).', blocks: [] }];
  const seen = [];
  const o = await buildThreadOverview(TID, deps({ listMessages: () => msgs,
    originDesignIds: (tid) => { seen.push(tid); return ['d_0000000000a1', 'd_0000000000a2', 'd_0000000000a3']; },
    getDesign: (id) => known[id] || null }));
  assert.deepEqual(seen, [TID]);
  assert.deepEqual(o.artifacts.filter((a) => a.source === 'design').map((a) => a.designId), ['d_0000000000a1', 'd_0000000000a2']);
});
