// test/ui-no-project-run-page.test.mjs — P3: a run without a project in History and on the run page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, go, settle, ROW, DETAIL, ok, click, secOf } from './helpers/history-detail-boot.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';

const NP_KEY = 'no-project-00000000';
const NP_DIR = '/h/.worca-cc/runs/abcd1234/work';
const NP_ROW = { ...ROW, id: 'abcd1234', projectKey: NP_KEY, projectName: 'No project', projectDir: NP_DIR, branch: null, sourceBranch: null,
  survived: false, title: 'Q3 Hiring Deck', workMode: 'none' };
const NP_DETAIL = { ...DETAIL, state: { ...DETAIL.state, id: 'abcd1234', title: 'Q3 Hiring Deck', workMode: 'none', projectKey: NP_KEY, projectDir: NP_DIR,
  branch: { workMode: 'none', runRootMode: 'detached' } }, artifacts: [{ kind: 'work', relPath: 'work/deck.html' }] };
const arms = (url) => {
  if (url.endsWith(`/api/history/${NP_KEY}/abcd1234`)) return ok(NP_DETAIL);
  if (url.endsWith('/api/history')) return ok({ pipelines: [NP_ROW], ghAvailable: false });
  if (url.includes('/api/runs/abcd1234/artifacts')) return ok({ runId: 'abcd1234', truncated: false,
    artifacts: [{ kind: 'work', relPath: 'work/deck.html', bytes: 86016, nodeId: null, stepKey: null, cycle: null }] });
  if (url.endsWith('/api/projects')) return ok({ projects: [], runsRoot: '/h/.worca-cc/runs' });
  return null;
};

test('a saved run without a project opens Details on Artifacts, at Simple level, with no git chrome', async () => {
  const ctx = await boot({ fetchHandler: (u) => arms(u) || ok({}) });
  ctx.window.document.documentElement.dataset.level = 'simple';
  go(ctx.window, `history/${NP_KEY}/abcd1234/details`);
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const keys = [...doc.querySelectorAll('#hist-detail .hd-tab')].map((b) => b.dataset.sec);
  assert.ok(keys.includes('artifacts'));
  for (const k of ['diff', 'actions', 'changes']) assert.equal(keys.includes(k), false, k);
  assert.equal(doc.querySelector('#hist-detail .hd-tab.active').dataset.sec, 'artifacts');
  assert.equal(doc.querySelector('#hist-detail .rd-page-meta .kind-chip.kind-none').textContent, 'No project');
  assert.doesNotMatch(doc.querySelector('#hist-detail .rd-page-meta').firstChild.data, /work/);
  const branch = doc.querySelector('#hist-detail .rd-page-branch');
  assert.ok(!branch || branch.hidden);
  const after = doc.querySelector('#hist-detail .hd-after');
  assert.equal(after.hidden, true, 'no Run after: a run without a project cannot be chained');
  assert.equal(after.onclick, null);
});

test('a finished run without a project: its Overview never says it did not complete; Archive says its files go', async () => {
  const ctx = await boot({ fetchHandler: (u) => arms(u) || ok({}) });
  go(ctx.window, `history/${NP_KEY}/abcd1234/details`);
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="overview"]'));
  await settle(ctx.window, 4);
  const sec = secOf(doc, 'overview');
  assert.ok(sec && sec.querySelector('.hd-ov-grid'), 'the Overview painted');
  assert.equal(sec.querySelector('.hd-ov-verdict'), null, 'no results.json: its files are the result, no verdict line');
  assert.doesNotMatch(sec.textContent, /did not complete/);
  assert.equal(doc.querySelector('#hist-detail .rd-sheet .run-status').dataset.text, 'Finished', 'never Ready to ship');
  assert.equal(doc.querySelectorAll('#hist-detail [data-model-action="ship"]').length, 0, 'no Ship it');
  click(ctx.window, doc.querySelector('#hist-detail .hd-archive'));
  await settle(ctx.window, 4);
  const msg = doc.querySelector('#confirm-message').textContent;
  assert.match(msg, /It moves out of Runs\. The files it made and its run artifacts \(logs, results\) are removed\./);
  assert.doesNotMatch(msg, /branch|worktree|PR/, 'no git words for a run that has none (U17)');
  doc.querySelector('#confirm-cancel').click();
  await settle(ctx.window);
});

test('an archived run without a project: Restore says its files were removed, with no git words', async () => {
  const archived = { ...NP_DETAIL, state: { ...NP_DETAIL.state, archivedAt: '2026-10-18T10:00:00.000Z' } };
  const ctx = await boot({ fetchHandler: (u) => (u.endsWith(`/api/history/${NP_KEY}/abcd1234`) ? ok(archived) : (arms(u) || ok({}))) });
  go(ctx.window, `history/${NP_KEY}/abcd1234/details`);
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hd-restore'));
  await settle(ctx.window, 4);
  const msg = doc.querySelector('#confirm-message').textContent;
  assert.match(msg, /The files it made and its run artifacts \(logs, results\) were removed by the archive and are not rebuilt\./);
  assert.doesNotMatch(msg, /branch|worktree|PR/, 'no git words for a run that has none (U17)');
  doc.querySelector('#confirm-cancel').click();
  await settle(ctx.window);
});

test('the Runs list groups it under No project with the No project chip', async () => {
  const ctx = await boot({ local: { 'worca-cc.runs.view': JSON.stringify({ show: 'all', groupBy: 'project', person: '' }) }, fetchHandler: (u) => arms(u) || ok({}) });
  go(ctx.window, 'history');
  await settle(ctx.window, 6);
  const head = ctx.window.document.querySelector(`.runs-sec[data-section="project:${NP_KEY}"] .runs-sec-head`);   // View › Group by Project
  assert.equal(head.querySelector('.runs-sec-title').textContent, 'No project');
  assert.equal(head.querySelector('.kind-chip.kind-none').textContent, 'No project');
});

test('a live run without a project: Artifacts first; its saved data reads the reserved key', async () => {
  const seen = [];
  // No History row yet: a finished run that has one opens as History (#history/<key>/<id>), never on the run page.
  const ctx = await bootApp({ fetchHandler: (u) => { seen.push(u); return u.endsWith('/api/history') ? ok({ pipelines: [], ghAvailable: false }) : (arms(u) || ok({})); } });
  ctx.window.document.documentElement.dataset.level = 'simple';
  helloRun(ctx, { runId: 'r-np', pipelineId: 'abcd1234', workMode: 'none', projectDir: NP_DIR, status: 'done' });
  go(ctx.window, 'running/r-np/details');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#run-detail .rd-tab.active').dataset.sec, 'artifacts');
  assert.equal([...doc.querySelectorAll('#run-detail .rd-tab')].some((b) => b.dataset.sec === 'diff'), false);
  assert.equal(doc.querySelector('#run-detail .rd-after').hidden, true, 'no Run after on the live page either');
  assert.ok(seen.some((u) => u.endsWith(`/api/history/${NP_KEY}/abcd1234`)), seen.join('\n'));
  assert.equal(doc.querySelector('#run-detail .rd-meta .rd-project'), null, 'its work folder is never named as a project (P3-D10)');
  click(ctx.window, doc.querySelector('#run-detail .rd-tab[data-sec="overview"]'));
  await settle(ctx.window, 6);
  const tags = [...doc.querySelectorAll('#run-detail .hd-ov-chips .hd-ov-tag')].map((t) => t.textContent);
  assert.ok(tags.includes('No project') && !tags.includes('work'), tags.join(' | '));
});

test('a live run first seen as a git run, then found to have no project, reopens on Artifacts (the rebuild drops the auto-opened Overview)', async () => {
  const ctx = await bootApp({ fetchHandler: (u) => (u.endsWith('/api/history') ? ok({ pipelines: [], ghAvailable: false }) : (arms(u) || ok({}))) });
  ctx.window.document.documentElement.dataset.level = 'simple';
  helloRun(ctx, { runId: 'r-np2', status: 'running' });
  go(ctx.window, 'running/r-np2/details');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#run-detail .rd-tab.active').dataset.sec, 'overview', 'built as a git run first');
  ctx.dispatch({ type: 'state', runId: 'r-np2', pipelineId: 'abcd1234', workMode: 'none', projectDir: NP_DIR, status: 'running' });
  await settle(ctx.window, 6);
  assert.equal(doc.querySelector('#run-detail .rd-tab.active').dataset.sec, 'artifacts');
  assert.equal([...doc.querySelectorAll('#run-detail .rd-tab')].some((b) => b.dataset.sec === 'diff'), false);
});

test('a resume ticket of a run without a project says No project in Schedules, never its folder name', async () => {
  const at = new Date(Date.now() + 3600_000).toISOString();
  const ticket = { id: '11111111-2222-3333-4444-555555555555', kind: 'once', scheduleId: null, title: 'Q3 Hiring Deck', projectKey: NP_KEY, projectDir: NP_DIR,
    workspaceId: null, runAt: at, scheduledFor: at, status: 'scheduled', ifMissed: 'run', graceMin: 360, attempts: 0, retryAt: null, queued: false, forced: false,
    ownerPid: null, pipelineId: null, resumePipelineId: 'abcd1234', failReason: null,
    summary: { target: 'project', workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'deck', source: null, sourceBranch: null, featureBranch: null, memoryScope: null, mock: false, extras: 0 } };
  const ctx = await boot({ fetchHandler: (u) => {
    if (u.includes('/api/notifications')) return ok({ notifications: [], unread: 0 });
    if (u.endsWith('/api/schedules')) return ok({ schedules: [], tickets: [ticket], chains: [], counts: { scheduled: 1 } });
    return arms(u) || ok({});
  } });
  globalThis.DOMParser = ctx.window.DOMParser;   // the rows' icons parse SVG through it (schedules-view.mjs svgIcon)
  go(ctx.window, 'schedules/once');
  await settle(ctx.window, 6);
  const text = ctx.window.document.getElementById('schedules-once').textContent;
  assert.match(text, /No project · Default/);
  assert.doesNotMatch(text, /Project · work/);
});
