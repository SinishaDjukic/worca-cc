// test/helpers/tool-overview-boot.mjs — the shared boot and fixtures of ui-tool-overview-app.test.mjs and ui-tool-overview-app-more.test.mjs (split to keep each host file near 12 tests).
import { after } from 'node:test';
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildThreadOverview } from '../../src/core/ask/overview.mjs';
// Static, so its afterEach (each test's jsdom window released, its timers stopped) is a file-level hook.
import { bootChat, ok } from './chat-panel-boot.mjs';

export const PK = 'app-0000aaaa';
export const TID = 'ask_0000ab0e';
export const NOPROJ = 'ask_0000ab0f';
export const WSCHAT = 'ask_0000ab10';
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const until = async (fn, tries = 300) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(5); } return false; };
export const OVERVIEW = {
  environment: { followedRun: { pipelineId: 'aaaa0001', title: 'First run', branch: 'feat/first' } },
  runs: [{ runId: 'r-1', pipelineId: 'aaaa0001', title: 'First run', status: 'done', phase: 'done', costUsd: 1, runEngine: 'claude', startedAt: 't', href: `#history/${PK}/aaaa0001`, branch: 'feat/first' }],
  prs: [{ url: 'https://github.com/o/r/pull/7', label: 'o/r#7', refKey: 'gh:o/r#7', title: 'First run', state: 'open', runId: 'r-1', source: 'run' }],
  artifacts: [
    { source: 'shown', attId: 'att_00000001', name: 'notes.md', bytes: 10, kind: 'markdown', mime: 'text/markdown', at: '2026-10-05T00:00:00.000Z' },
    { source: 'shown', attId: 'att_00000002', name: 'shot.png', bytes: 10, kind: 'image', mime: 'image/png', at: '2026-10-04T00:00:00.000Z' },
    { source: 'out', path: 'report.md', name: 'report.md', bytes: 3, at: '2026-10-03T00:00:00.000Z' },
  ],
  artifactsTotal: 3,
};
export const PDF_TEXT = '%PDF-1.4\n%%EOF\n';
export const outDirs = [];
after(() => { for (const d of outDirs) rmSync(d, { recursive: true, force: true }); });
/** The Overview built by the REAL builder (D7) over rows shaped the way show_files stores them (store.mjs rowToAttachment):
 *  report.pdf shown AND saved in the out folder, live.pdf only saved, shot.png shown. A server regression reddens the
 *  jsdom rows too. */
export async function realOverview() {
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'worca-ovapp-')));
  outDirs.push(out);
  writeFileSync(join(out, 'report.pdf'), PDF_TEXT);
  writeFileSync(join(out, 'live.pdf'), PDF_TEXT);
  const att = (id, name, kind, mime) => ({ id, threadId: TID, messageId: null, name, bytes: PDF_TEXT.length, kind, mime, hasSource: true, createdAt: '2026-10-05T00:00:00.000Z' });
  return buildThreadOverview(TID, {
    listRunLinks: () => [], isPrFix: () => false, findPipelineRowById: () => null, scheduleRunIds: () => [], readPrState: () => null,
    listMessages: () => [], followedRunOf: () => null,
    listAttachments: () => [att('att_00000001', 'report.pdf', 'binary', 'application/pdf'), att('att_00000002', 'shot.png', 'image', 'image/png')],
    outDir: () => out,
    sourcePathOf: (tid, id) => (id === 'att_00000001' ? join(out, 'report.pdf') : null),
  });
}

export async function boot({ url = `http://localhost:4317/#chat/${TID}`, settings = () => ({}), blocks = [], running = () => [], more = null, rows, detail, local = null, runArtifacts = [], overview = OVERVIEW } = {}) {
  const rec = { overview: [], att: [], file: [], stops: [], actionStops: [], askRuns: [], resolve: [] };
  const thread = (id) => ({ id, title: id === NOPROJ ? 'Loose' : 'Overview chat', createdAt: 't', updatedAt: 't',
    context: id === NOPROJ ? null : id === WSCHAT ? { pinned: true, workspaceId: 'wks-shop' } : { pinned: true, projectKey: PK }, totals: { ctx: 120400, ctxWindow: 1000000, turns: 1, costUsd: 0.4 } });
  const ctx = await bootChat({ url, ...(rows ? { rows } : {}), ...(detail ? { detail } : {}), ...(local ? { local } : {}), arms: (u, opts) => {
    const extra = more ? more(u, opts) : null;
    if (extra) return extra;
    const path = u.split('?')[0];
    const m = (opts.method || 'GET').toUpperCase();
    for (const id of [TID, NOPROJ, WSCHAT]) {
      if (path.endsWith(`/api/ask/threads/${id}`) && m === 'GET') {
        return ok({ thread: thread(id), attachments: [], runLinks: [], worktrees: [], inFlight: null,
          messages: [{ id: 'askm_00000001', threadId: id, seq: 1, role: 'assistant', text: 'Done.', blocks, status: 'done', createdAt: 't' }] });
      }
      if (path.endsWith(`/api/ask/threads/${id}/overview`)) { rec.overview.push(id); return ok(id === TID ? overview : { environment: { followedRun: null }, runs: [], prs: [], artifacts: [], artifactsTotal: 0 }); }
    }
    if (path.includes('/api/ask/runs/')) { rec.askRuns.push(path); return ok({ state: { status: 'done', branch: { feature: 'feat/run-page' } }, live: null, extras: { pr: { url: 'https://github.com/o/r/pull/9', state: 'OPEN' }, artifacts: runArtifacts } }); }
    if (path.endsWith('/api/ask/refs/resolve')) { rec.resolve.push(JSON.parse(opts.body)); return ok({ refs: {} }); }
    if (path.includes('/attachments/')) { rec.att.push(u); return ok({ text: 'copy text\n' }); }
    if (path.endsWith('/api/projects')) return ok({ projects: [{ key: PK, name: 'app', path: '/tmp/app' }, { key: 'proj-alpha-abcd1234', name: 'Alpha', path: '/tmp/proj' }] });
    if (path.endsWith('/api/workspaces')) return ok({ workspaces: [{ id: 'wks-shop', name: 'Shop', members: [] }] });
    if (path.endsWith('/api/terminal') && m === 'GET') return ok({ enabled: true, pty: { available: true, reason: null }, maxSessions: 16,
      sessions: [{ id: 't-0000000001', scope: 'project', projectKey: PK, createdBy: `ask:${TID}`, label: 'app', status: 'running', mode: 'pty', createdAt: '2026-10-03T10:00:00.000Z' }] });
    if (path.endsWith('/api/tools/file') && /path=live\.pdf/.test(u)) { rec.file.push(u); return ok({ path: 'live.pdf', size: PDF_TEXT.length, text: PDF_TEXT, binary: false, truncated: false, root: { label: 'Output' } }); }
    if (path.endsWith('/api/tools/file')) { rec.file.push(u); return ok({ path: 'report.md', size: 3, text: '# r', truncated: false, root: { label: 'Chat output' } }); }
    if (path.endsWith('/api/tools/files')) return ok({ entries: [], root: { label: 'app' } });
    if (path.endsWith('/api/tools/tabs')) return ok({ tabs: m === 'PUT' ? JSON.parse(opts.body).tabs : [] });
    if (path.endsWith('/api/actions/running')) return ok(running());
    if (path.includes('/api/actions/instances/') && m === 'POST') { rec.actionStops.push(path); return ok({ ok: true }); }
    if (path.includes('/api/terminal/sessions/') && m === 'POST') { rec.stops.push(path); return ok({ ok: true }); }
    if (path.includes(`/api/ask/threads/${TID}/commands/`)) return ok({ blockId: 't-0000000001:1', sessionId: 't-0000000001', status: 'running', exitCode: null, tail: '', command: 'npm test', startedAt: new Date().toISOString() });
    if (path.endsWith('/api/settings')) return ok(settings());
    return null;
  } });
  await ctx.settle(12);
  const doc = ctx.window.document;
  const panel = () => doc.querySelector('.tool-panel');
  const sec = (id) => doc.querySelector(`.tool-panel [data-tov-section="${id}"]`);
  const rowsOf = (id) => [...doc.querySelectorAll(`.tool-panel [data-tov-section="${id}"] .tov-item:not([hidden]) .tov-text`)].map((n) => n.textContent);
  const model = () => JSON.parse(ctx.window.localStorage.getItem('worca-cc.tools') || '{"tabs":[]}');
  const openOverview = async () => {
    const b = [...doc.querySelectorAll('.tool-icon-overview')].find((x) => !x.closest('[hidden], .hidden')) || doc.querySelector('.tool-icon-overview');
    b.click();
    await ctx.settle(12);
  };
  return { ...ctx, doc, rec, panel, sec, rowsOf, model, openOverview };
}

export async function runsOverview() {
  const row = (id, title, over = {}) => ({ id, title, status: 'done', phase: 'done', total_cost_usd: 1, started_at: '2026-10-01T00:00:00.000Z', project_key: PK, target: 'project',
    branch: JSON.stringify({ source: 'dev', feature: `feat/${id}` }), outcome: null, resume_point: null, deleted_at: null, ...over });
  const round = (origin, n, over = {}) => row(`f${origin.at(-1)}00000${n}`, 'fix', { branch: JSON.stringify({ roundOf: { pipelineId: origin, round: n, by: 'watch' } }), total_cost_usd: 0.25 * n, ...over });
  const rows = [row('aaaa0001', 'Parent', { total_cost_usd: 2, started_at: '2026-10-03T00:00:00.000Z' }), row('aaaa0002', 'Other'),
    round('aaaa0001', 2), round('aaaa0001', 3, { status: 'running', phase: 'implement' }), round('aaaa0002', 2), round('aaaa0002', 3), round('aaaa0002', 4),
    row('cccc0001', 'Origin elsewhere'), row('cccc0002', 'card fix'), row('dddd0001', 'Tracked one', { status: 'running', phase: 'test' }), row('dddd0002', 'Named one')];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return buildThreadOverview(TID, {
    listRunLinks: () => [{ threadId: TID, runId: 'r-1', pipelineId: 'aaaa0001', cardId: 'card_1' }, { threadId: TID, runId: 'r-2', pipelineId: 'aaaa0002', cardId: 'card_2' },
      { threadId: TID, runId: 'r-cf', pipelineId: 'cccc0002', cardId: 'card_fix' }, { threadId: TID, runId: 'r-t', pipelineId: 'dddd0001', cardId: null }],
    isPrFix: (l) => l.cardId === 'card_fix', prFixOf: (l) => (l.cardId === 'card_fix' ? { originPipelineId: 'cccc0001', prUrl: 'https://github.com/o/r/pull/30' } : null),
    findPipelineRowById: (id) => byId.get(id) || null, scheduleRunIds: () => [],
    readPrState: (id) => (id === 'aaaa0001' ? { url: 'https://github.com/o/r/pull/7', state: 'OPEN' } : id === 'dddd0001' ? { url: 'https://github.com/o/r/pull/31', state: 'OPEN' } : null),
    roundsOf: (ids) => { const out = new Map(); for (const r of rows) { const m = JSON.parse(r.branch).roundOf; if (m && ids.includes(m.pipelineId)) out.set(m.pipelineId, [...(out.get(m.pipelineId) || []), { pipelineId: r.id, round: m.round, by: m.by }]); } return out; },
    listMessages: () => [{ id: 'm1', role: 'assistant', text: 'The earlier attempt was dddd0002.', blocks: [] }], followedRunOf: () => null,
    listAttachments: () => [], outDir: () => join(tmpdir(), 'worca-ovapp-none-0000'),
  });
}
