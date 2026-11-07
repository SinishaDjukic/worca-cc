// test/ui-tool-overview-app.test.mjs — the tool panel's Overview in the real app (issue 1064): app.js + index.html under
// jsdom (chat-panel-boot). One row per app.js wiring line: the strip's Overview icon, the head meter's route, the overview
// fetch, and the deps the sections reach (runs, files, out files, Stop, Actions, the setting, a no-project chat, a run).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildThreadOverview } from '../src/core/ask/overview.mjs';
import { NO_PREVIEW } from '../ui/public/artifacts/stage.mjs';

const PK = 'app-0000aaaa';
const TID = 'ask_0000ab0e';
const NOPROJ = 'ask_0000ab0f';
const WSCHAT = 'ask_0000ab10';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 300) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(5); } return false; };
const OVERVIEW = {
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
const PDF_TEXT = '%PDF-1.4\n%%EOF\n';
const outDirs = [];
after(() => { for (const d of outDirs) rmSync(d, { recursive: true, force: true }); });
/** The Overview built by the REAL builder (D7) over rows shaped the way show_files stores them (store.mjs rowToAttachment):
 *  report.pdf shown AND saved in the out folder, live.pdf only saved, shot.png shown. A server regression reddens the
 *  jsdom rows too. */
async function realOverview() {
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

async function boot({ url = `http://localhost:4317/#chat/${TID}`, settings = () => ({}), blocks = [], running = () => [], more = null, rows, detail, local = null, runArtifacts = [], overview = OVERVIEW } = {}) {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
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

test('in the real app: the chat head strip starts with Overview; it opens the Overview and fetches the chat\'s overview once', async () => {
  const a = await boot();
  const strip = a.doc.querySelector('.chat-head [data-tool-icons]');
  assert.ok(strip.firstElementChild.classList.contains('tool-icon-overview'), strip.innerHTML.slice(0, 200));
  assert.equal(strip.firstElementChild.disabled, false);
  await a.openOverview();
  assert.equal(a.panel().hidden, false);
  assert.equal(a.panel().querySelector('.tool-body').dataset.kind, 'overview');
  assert.ok(await until(() => a.rowsOf('runs').length === 1));
  assert.deepEqual(a.rec.overview, [TID], 'one fetch per mount, for this chat');
  assert.ok(a.rowsOf('environment').includes('app'), 'projectOf: the project row');
  assert.ok(a.rowsOf('environment').includes('feat/first'), 'the followed run\'s branch');
  assert.deepEqual(a.rec.resolve.map((b) => b.refs), [['gh:o/r#7']], 'resolveRefs: the chip lookup');
});

test('in the real app: the head meter opens the Overview with Context expanded (no popover)', async () => {
  const a = await boot();
  const meter = a.doc.querySelector('.chat-head-meter');
  assert.equal(meter.hasAttribute('aria-haspopup'), false);
  meter.click();
  await a.settle(12);
  assert.equal(a.panel().hidden, false);
  assert.equal(a.doc.querySelector('.ask-pop-ctx'), null);
  assert.ok(await until(() => a.sec('context')?.querySelector('.tov-head')?.getAttribute('aria-expanded') === 'true'));
  assert.ok(a.sec('context').querySelector('.tov-body .ask-ctx-stat[data-stat="used"]'), 'the shared renderer');
  assert.equal(a.doc.activeElement, a.sec('context').querySelector('.tov-head'), 'the focus is on Context');
});

test('in the real app: a new chat\'s head meter keeps the popover; the side column ring keeps it too', async () => {
  const fresh = await boot({ url: 'http://localhost:4317/#chat/new' });
  fresh.doc.querySelector('.chat-head-meter').click();
  await fresh.settle(6);
  assert.ok(fresh.doc.querySelector('.ask-pop-ctx'), 'the popover');
  assert.equal(fresh.panel().hidden, true, 'the panel stays closed');
  const a = await boot({ more: (u) => (u.split('?')[0].endsWith('/api/workflows') ? { ok: true, status: 200, json: async () => ({ workflows: [] }) } : null) });
  a.go('runs');
  await a.settle(8);
  a.doc.getElementById('topnav-ask').click();
  await a.settle(8);
  const ring = a.doc.querySelector('#ask-side [data-ask-ctx-btn]');
  assert.ok(ring, 'the ring in the side column');
  ring.click();
  await a.settle(6);
  assert.ok(a.doc.querySelector('.ask-pop-ctx'), 'the popover');
  assert.equal(a.doc.querySelector('.tool-panel [data-tov-section]'), null, 'no Overview');
});

test('in the real app: a run row routes to the run page; an artifact opens a Files tab labelled Chat copy (twice: one tab)', async () => {
  const a = await boot();
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('runs').querySelector('.tov-row').click();
  await a.settle(6);
  assert.match(a.window.location.hash, /^#(history\/app-0000aaaa\/aaaa0001|running\/r-1)/, a.window.location.hash);
  a.go(`chat/${TID}`);
  await a.settle(12);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('artifacts').querySelectorAll('.tov-row')[0].click();
  await a.settle(12);
  assert.ok(await until(() => /Chat copy/.test(a.panel().textContent)), a.panel().textContent.slice(0, 300));
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('artifacts').querySelectorAll('.tov-row')[0].click();
  await a.settle(12);
  const files = a.model().tabs.filter((t) => t.kind === 'files' && t.state.att === 'att_00000001');
  assert.equal(files.length, 1, 'an open copy focuses its tab (I8)');
});

/** Overview › Runs built by the REAL builder: Parent (PR 7) with two watch fix rounds; Other with three; a fix card whose
 *  origin was not started here; a tracked run with a PR; a run a reply named. */
async function runsOverview() {
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

test('in the real app: Overview › Runs nests auto-fix runs under their run (own cost, more than 2 folded) and ends with a collapsed Mentioned group whose PRs are not listed', async () => {
  const a = await boot({ overview: await runsOverview() });
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('runs').length === 5), JSON.stringify(a.rowsOf('runs')));
  const metas = (id) => [...a.sec(id).querySelectorAll('.tov-item:not([hidden]) .tov-meta')].map((n) => n.textContent);
  assert.deepEqual(a.rowsOf('runs'), ['Parent', 'Auto-fix 1', 'Auto-fix 2', 'Other', '3 auto-fixes']);
  assert.deepEqual(metas('runs'), ['Done · $2.00', 'Done · $0.50', 'Running · implement · $0.75', 'Done · $1.00', 'Latest: Done']);
  assert.equal(a.sec('runs').querySelectorAll('.tov-item.is-child .tov-child').length, 3, 'the child rows carry the arrow');
  const m = a.sec('mentioned');
  const order = [...a.doc.querySelectorAll('.tool-panel .tov-sec')].map((x) => x.dataset.tovSection);
  assert.equal(order.indexOf('mentioned'), order.indexOf('runs') + 1);
  assert.equal(m.hidden, false);
  assert.ok(m.classList.contains('is-collapsed') && m.classList.contains('is-quiet'));
  assert.equal(m.querySelector('.tov-count').textContent, '4');
  assert.deepEqual(a.rowsOf('mentioned').sort(), ['Auto-fix 1', 'Named one', 'Origin elsewhere', 'Tracked one']);
  assert.ok(metas('mentioned').every((t) => !/\$/.test(t)), JSON.stringify(metas('mentioned')));
  assert.ok(await until(() => a.rowsOf('prs').length === 1));
  assert.deepEqual(a.rowsOf('prs'), ['o/r#7'], 'neither the tracked run\'s PR nor the fix card\'s');
  m.querySelector('.tov-head').click();
  assert.equal(m.querySelector('.tov-box').hidden, false);
  [...m.querySelectorAll('.tov-row')].find((r) => r.textContent.includes('Named one')).click();
  await a.settle(6);
  assert.match(a.window.location.hash, /^#history\/app-0000aaaa\/dddd0002/, a.window.location.hash);
});

test('in the real app: the Overview\'s shown PDF opens its chat copy in a Files tab and renders it (no NO_PREVIEW); a never-shown out PDF renders from the tool route', async () => {
  const a = await boot({ overview: await realOverview() });
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3), JSON.stringify(a.rowsOf('artifacts')));
  assert.deepEqual([...a.rowsOf('artifacts')].sort(), ['live.pdf', 'report.pdf', 'shot.png'], 'the shown report.pdf is listed once');
  const rowOf = (name) => [...a.sec('artifacts').querySelectorAll('.tov-row')].find((r) => r.querySelector('.tov-text').textContent === name);
  rowOf('report.pdf').click();
  await a.settle(12);
  const tab = () => a.model().tabs.find((t) => t.kind === 'files' && t.state.att === 'att_00000001');
  assert.ok(tab(), JSON.stringify(a.model().tabs));
  assert.equal(tab().state.attKind, 'pdf');
  assert.ok(await until(() => /Chat copy/.test(a.panel().textContent)), a.panel().textContent.slice(0, 300));
  assert.ok(await until(() => a.panel().querySelector('embed[type="application/pdf"]')), a.panel().querySelector('.tool-body')?.innerHTML.slice(0, 400));
  assert.ok(a.panel().querySelector('embed[type="application/pdf"]').getAttribute('src').startsWith(`/api/ask/threads/${TID}/attachments/`));
  assert.ok(!a.panel().textContent.includes(NO_PREVIEW), 'no NO_PREVIEW');
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  rowOf('live.pdf').click();
  await a.settle(12);
  assert.ok(a.model().tabs.some((t) => t.kind === 'files' && t.state.root === 'out'), JSON.stringify(a.model().tabs));
  assert.ok(await until(() => a.panel().querySelector('embed[type="application/pdf"]')?.getAttribute('src')?.startsWith('/api/tools/raw/')),
    a.panel().querySelector('.tool-body')?.innerHTML.slice(0, 400));
});

test('in the real app: the Overview row and the card open the same tab for the same file', async () => {
  const item = { attId: 'att_00000001', name: 'report.pdf', kind: 'pdf', mime: 'application/pdf', bytes: PDF_TEXT.length, source: true };
  const a = await boot({ overview: await realOverview(), blocks: [{ kind: 'card', id: 'card_00000001', state: 'shown', card: { type: 'files', title: 'report.pdf', items: [item] } }] });
  assert.ok(await until(() => a.doc.querySelector('.ask-filescard-name')));
  a.doc.querySelector('.ask-filescard-name').click();
  await a.settle(12);
  assert.equal(a.model().tabs.filter((t) => t.kind === 'files').length, 1, JSON.stringify(a.model().tabs));
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  [...a.sec('artifacts').querySelectorAll('.tov-row')].find((r) => r.querySelector('.tov-text').textContent === 'report.pdf').click();
  await a.settle(12);
  const files = a.model().tabs.filter((t) => t.kind === 'files' && t.state.att === 'att_00000001');
  assert.equal(files.length, 1, 'one tab per file (I7)');
  assert.equal(files[0].state.attKind, 'pdf', 'the card\'s tab keeps its kind');
  assert.ok(await until(() => a.panel().querySelector('embed[type="application/pdf"]')), a.panel().querySelector('.tool-body')?.innerHTML.slice(0, 400));
  assert.ok(!a.panel().textContent.includes(NO_PREVIEW));
});

test('in the real app: an out file opens with root=out; an image opens the pop-up; the setting off still opens a Files tab for a shown non-image (clarify answer 2), and an image still opens the pop-up', async () => {
  const a = await boot();
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('artifacts').querySelectorAll('.tov-row')[2].click();
  await a.settle(12);
  assert.ok(await until(() => a.rec.file.some((u) => /root=out/.test(u) && /path=report\.md/.test(u))), a.rec.file.join(' | '));
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').length === 3));
  a.sec('artifacts').querySelectorAll('.tov-row')[1].click();
  await a.settle(8);
  assert.ok(a.doc.querySelector('.viewer-modal.apv:not(.hidden)'), 'the image pop-up');
  const off = await boot({ settings: () => ({ chatLinksInPanel: false }) });
  await off.openOverview();
  assert.ok(await until(() => off.rowsOf('artifacts').length === 3));
  off.sec('artifacts').querySelectorAll('.tov-row')[0].click();
  await off.settle(12);
  assert.equal(off.doc.querySelector('.viewer-modal.apv:not(.hidden)'), null, 'setting off: no pop-up for a non-image');
  assert.deepEqual(off.model().tabs.filter((t) => t.kind === 'files').map((t) => t.state.att), ['att_00000001'], 'setting off: a Files tab');
  await off.openOverview();
  assert.ok(await until(() => off.rowsOf('artifacts').length === 3));
  off.sec('artifacts').querySelectorAll('.tov-row')[1].click();
  await off.settle(8);
  assert.ok(off.doc.querySelector('.viewer-modal.apv:not(.hidden)'), 'setting off: an image still opens the pop-up');
});

test('in the real app: Background lists the chat\'s running command (Stop posts the stop route) and its run\'s Actions (Stop posts the instance stop)', async () => {
  const CMD = { kind: 'card', id: 'card_000000c1', state: 'command', card: { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'app', cwd: '/tmp/app', warning: null } };
  const a = await boot({ blocks: [CMD], running: () => [{ instanceId: 'inst_1', runId: 'aaaa0001', kind: 'service', label: 'Web', url: 'http://localhost:4417/', startedAt: new Date().toISOString() },
    { instanceId: 'inst_2', runId: 'ffff0000', kind: 'task', label: 'Other', startedAt: new Date().toISOString() }] });
  a.dispatch({ type: 'hello', runs: [] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').length === 2), JSON.stringify(a.rowsOf('background')));
  assert.deepEqual(a.rowsOf('background'), ['npm test', 'Web']);
  const stops = a.sec('background').querySelectorAll('.tov-stop');
  stops[0].click();
  stops[1].click();
  await a.settle(8);
  assert.ok(a.rec.stops.some((p) => p.endsWith('/api/terminal/sessions/t-0000000001/stop')), a.rec.stops.join());
  assert.ok(a.rec.actionStops.some((p) => p.endsWith('/api/actions/instances/inst_1/stop')), a.rec.actionStops.join());
});

test('in the real app: a no-project chat gets the Overview (its tools stay disabled)', async () => {
  const a = await boot({ url: `http://localhost:4317/#chat/${NOPROJ}` });
  const strip = a.doc.querySelector('.chat-head [data-tool-icons]');
  assert.equal(strip.querySelector('.tool-icon-overview').disabled, false);
  assert.equal(strip.querySelector('.tool-icon[data-tool-kind="terminal"]').disabled, true);
  await a.openOverview();
  assert.equal(a.panel().querySelector('.tool-body').dataset.kind, 'overview');
  assert.ok(await until(() => a.rowsOf('environment').includes('No project')));
  assert.deepEqual(a.rec.overview, [NOPROJ]);
});

test('in the real app: the run page Overview shows its branch and PR', async () => {
  const { KEY, ROW } = await import('./helpers/chat-panel-boot.mjs');
  const a = await boot({ url: `http://localhost:4317/#history/${KEY}/${ROW.id}`, rows: [ROW] });
  await a.settle(12);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('environment').includes(ROW.branch)), JSON.stringify(a.rowsOf('environment')));   // historyRow: the History row's branch
  assert.ok(a.rec.askRuns.some((p) => p.endsWith(`/api/ask/runs/${ROW.id}`)), a.rec.askRuns.join());
  assert.ok(await until(() => a.rowsOf('pr').includes('o/r#9')), JSON.stringify(a.rowsOf('pr')));
});

test('in the real app: a live run overlays the saved row (runStore); a workspace chat names its workspace (workspaceOf)', async () => {
  const { liveRun } = await import('./helpers/chat-panel-boot.mjs');
  const a = await boot();
  a.dispatch({ type: 'hello', runs: [liveRun({ runId: 'r-1', pipelineId: 'aaaa0001', title: 'First run', status: 'running', projectDir: '/tmp/app' })] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => /Running/.test(a.sec('runs')?.querySelector('.tov-meta')?.textContent || '')), a.sec('runs')?.textContent);
  const w = await boot({ url: `http://localhost:4317/#chat/${WSCHAT}` });
  w.dispatch({ type: 'workspaces-changed' });   // the chat page loads workspace names on demand
  await w.settle(8);
  await w.openOverview();
  assert.ok(await until(() => w.rowsOf('environment').includes('Shop')), JSON.stringify(w.rowsOf('environment')));
});

test('in the real app: Background follows the Actions list (onActions); a service row opens a Browser tab (openService); a command row shows its shell (showSession)', async () => {
  const CMD = { kind: 'card', id: 'card_000000c1', state: 'command', card: { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'app', cwd: '/tmp/app', warning: null } };
  let acts = [];
  const a = await boot({ blocks: [CMD], running: () => acts });
  a.dispatch({ type: 'hello', runs: [] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').length === 1), JSON.stringify(a.rowsOf('background')));
  acts = [{ instanceId: 'inst_1', runId: 'aaaa0001', kind: 'service', label: 'Web', url: 'http://localhost:4417/', startedAt: new Date().toISOString() }];
  a.dispatch({ type: 'actions-changed' });
  assert.ok(await until(() => a.rowsOf('background').includes('Web')), 'the new service row');
  const web = [...a.sec('background').querySelectorAll('.tov-row')].find((r) => r.textContent.includes('Web'));
  web.click();
  await a.settle(12);
  assert.ok(a.model().tabs.some((t) => t.kind === 'browser' && t.state.url === 'http://localhost:4417/'), JSON.stringify(a.model().tabs));
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').includes('npm test')));
  [...a.sec('background').querySelectorAll('.tov-row')].find((r) => r.textContent.includes('npm test')).click();
  await a.settle(12);
  assert.equal(a.panel().querySelector('.tool-body').dataset.kind, 'terminal', 'its shell\'s tab');
});

test('in the real app: a run artifact opens the run artifact viewer (openRunArtifact)', async () => {
  const { KEY, ROW } = await import('./helpers/chat-panel-boot.mjs');
  const a = await boot({ url: `http://localhost:4317/#history/${KEY}/${ROW.id}`, rows: [ROW], runArtifacts: [{ kind: 'plan', relPath: 'plan.md', bytes: 10, nodeId: 'n_plan', cycle: 1 }] });
  await a.settle(12);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('artifacts').includes('plan.md')), JSON.stringify(a.rowsOf('artifacts')));
  a.sec('artifacts').querySelector('.tov-row').click();
  await a.settle(12);
  assert.ok(await until(() => a.doc.querySelector('.viewer-modal.apv:not(.hidden)')), 'the artifact viewer');
});

test('in the real app: a project page Overview lists its live runs, then History (liveRunsOf, historyRows)', async () => {
  const { KEY, ROW, liveRun } = await import('./helpers/chat-panel-boot.mjs');
  const tools = { v: 1, tabs: [], active: {}, prefs: { width: 460 }, open: [`project:${KEY}`] };
  const a = await boot({ url: `http://localhost:4317/#projects/${KEY}`, rows: [ROW], local: { 'worca-cc.tools': JSON.stringify(tools) } });
  a.dispatch({ type: 'hello', runs: [liveRun({ runId: 'r-live', pipelineId: 'beef0001', title: 'Live one', projectDir: '/tmp/proj' })] });
  await a.settle(12);
  if (a.panel().hidden || a.panel().querySelector('.tool-body').dataset.kind !== 'overview') { a.go(`projects/${KEY}`); await a.settle(12); }
  assert.equal(a.panel().querySelector('.tool-body').dataset.kind, 'overview', 'the project\'s no-tab view');
  assert.ok(await until(() => a.rowsOf('runs').length === 2), JSON.stringify(a.rowsOf('runs')));
  assert.deepEqual(a.rowsOf('runs'), ['Live one', ROW.title]);
});

test('in the real app: a Background meta reads the clock (now): a service started 2 min ago shows its uptime', async () => {
  const a = await boot({ running: () => [{ instanceId: 'inst_1', runId: 'aaaa0001', kind: 'service', label: 'Web', url: 'http://localhost:4417/', startedAt: new Date(Date.now() - 125000).toISOString() }] });
  a.dispatch({ type: 'hello', runs: [] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').includes('Web')), JSON.stringify(a.rowsOf('background')));
  const meta = [...a.sec('background').querySelectorAll('.tov-row')].find((r) => r.textContent.includes('Web')).querySelector('.tov-meta').textContent;
  assert.match(meta, /^2m \d+s$/, meta);
});

test('in the real app: a command\'s done frame drops its Background row at once (commands is emitted after the card updates)', async () => {
  const CMD = { kind: 'card', id: 'card_000000c1', state: 'command', card: { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'app', cwd: '/tmp/app', warning: null } };
  const a = await boot({ blocks: [CMD] });
  a.dispatch({ type: 'hello', runs: [] });
  await a.settle(8);
  await a.openOverview();
  assert.ok(await until(() => a.rowsOf('background').includes('npm test')), JSON.stringify(a.rowsOf('background')));
  a.dispatch({ type: 'ask-command', threadId: TID, command: { blockId: 't-0000000001:1', sessionId: 't-0000000001', status: 'done', exitCode: 0, tail: '', command: 'npm test', startedAt: new Date().toISOString() } });
  await a.settle(2);
  assert.deepEqual(a.rowsOf('background'), [], 'no row for the finished command');
});

test('in the real app: Context\'s actions are the chat panel\'s: one worktree refresh per mount, the trash removes it, a topic routes', async () => {
  const WT = { worktreeId: 'wt_00000001', projectKey: PK, ref: 'dev', commit: 'abcdef1234567', path: '/tmp/wt/app', createdAt: null };
  const { ok } = await import('./helpers/chat-panel-boot.mjs');
  const gets = [];
  const dels = [];
  const a = await boot({ more: (u, opts) => {
    const path = u.split('?')[0];
    const m = (opts.method || 'GET').toUpperCase();
    if (path.endsWith(`/api/ask/threads/${TID}`) && m === 'GET') {
      gets.push(path);
      return ok({ thread: { id: TID, title: 'Overview chat', createdAt: 't', updatedAt: 't', context: { pinned: true, projectKey: PK },
        contexts: [{ kind: 'project', id: 'proj-alpha-abcd1234', label: 'Alpha' }], totals: { ctx: 120400, ctxWindow: 1000000, turns: 1, costUsd: 0.4 } },
      attachments: [], runLinks: [], worktrees: [WT], inFlight: null, messages: [{ id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: 'Done.', blocks: [], status: 'done', createdAt: 't' }] });
    }
    if (path.endsWith(`/api/ask/threads/${TID}/worktrees/${WT.worktreeId}`) && m === 'DELETE') { dels.push(path); return ok({ ok: true }); }
    return null;
  } });
  const before = gets.length;
  a.doc.querySelector('.chat-head-meter').click();
  await a.settle(12);
  assert.ok(await until(() => a.sec('context')?.querySelector('.tov-body .ask-wt-row')), 'the worktree row');
  await a.settle(12);
  assert.equal(gets.length, before + 1, 'refresh: one worktrees GET when Context opens');
  a.dispatch({ type: 'ask-worktrees', threadId: TID, worktrees: [WT] });   // a later redraw of Context
  await a.settle(12);
  await wait(40);
  assert.ok(a.sec('context').querySelector('.tov-body .ask-wt-row'));
  assert.equal(gets.length, before + 1, 'no second refresh on a redraw (once per mount)');
  a.sec('context').querySelector('.tov-body .ask-wt-row .ask-thread-trash').click();
  await a.settle(6);
  a.doc.getElementById('confirm-ok').click();
  assert.ok(await until(() => dels.length === 1), 'removeWorktree: the DELETE');
  a.sec('context').querySelector('.tov-body .ask-ctx-topic').click();
  await a.settle(6);
  assert.equal(a.window.location.hash, '#projects/proj-alpha-abcd1234', 'openTopic: the topic\'s page');
});
