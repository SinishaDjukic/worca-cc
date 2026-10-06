// test/ui-running-auto.test.mjs — an Auto run: the deciding placeholder on the run page
// (spec §7.3; the list row carries no graph), the row's Needs-you word while the proposal waits,
// and the "Auto → ‹name›" header badge on the run page (spec §7.5). Boot: test/helpers/run-page-boot.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { proposalFor } from './helpers/auto-proposal-fixture.mjs';
import { bootApp, helloRun, runCard } from './helpers/run-page-boot.mjs';
import { checkRows } from './helpers/rows.mjs';

const wins = [];
afterEach(() => { for (const w of wins.splice(0)) w.close(); });

async function boot(opts) {
  const ctx = await bootApp(opts);
  wins.push(ctx.window);
  return ctx;
}

const RUN_ID = 'run-aaa';
const settle = async (window, n = 3) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function helloRunning(ctx, extra = {}) { helloRun(ctx, { runId: RUN_ID, ...extra }); }
const cardOf = (ctx) => runCard(ctx, RUN_ID);
const inNeeds = (ctx) => ctx.window.document.querySelector(`#runs-list .runs-needs .runs-row[data-run-id="${RUN_ID}"]`);
const rowWord = (row) => row.querySelector('.runs-row-sub').textContent.split(' · ')[0];
// The run page's header badge (the list row has none).
const rdBadge = (ctx) => ctx.window.document.querySelector('#run-detail .rd-row1 .auto-badge');
// The deciding placeholder / run graph lives on the run page's Workflow tab only (the list card has no graph).
const pageHost = (ctx) => ctx.window.document.querySelector('#run-detail .rd-graph .run-flow');
async function openPage(ctx) {
  ctx.go(`running/${RUN_ID}/details/workflow`); await settle(ctx.window);
  return pageHost(ctx);
}

// The bootstrap manifest exactly as buildGraphManifest() emits it for the empty Auto template.
const DECIDING = { version: 2, template: { id: 'wf_auto', name: 'Auto' }, auto: { status: 'deciding', humanInLoop: true }, graph: { nodes: [], wires: [] }, bookends: { preflight: true, done: true }, steps: [{ kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] }, { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] }], feedbacks: [] };

test('a deciding Auto run paints the orb placeholder, not an empty graph; the label follows the pending proposal', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning(); await settle(ctx.window);
  assert.ok(cardOf(ctx), 'the run is listed');
  assert.equal(cardOf(ctx).querySelector('.run-flow'), null, 'the list row carries no graph host');
  assert.equal(cardOf(ctx).querySelector('.auto-deciding'), null, 'and no placeholder');
  const host = await openPage(ctx);
  assert.ok(host.classList.contains('auto-deciding-host'));
  assert.ok(!host.classList.contains('gv-host'), 'no run graph mounted on the host');
  assert.equal(host.querySelector('.gv-stage'), null, 'no renderer mounted');
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Auto is deciding the workflow…');
  assert.ok(host.querySelector('.ask-orb'), 'the thinking orb');
  ctx.dispatch({ type: 'question', runId: RUN_ID, id: 'auto-1', kind: 'workflow', workflow: proposalFor() });
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Waiting for your decision');
  ctx.showRunning(); await settle(ctx.window);
  assert.ok(inNeeds(ctx), 'the waiting proposal puts the run in Needs you');
  assert.equal(rowWord(cardOf(ctx)), 'Workflow review', 'the row points at the proposal');
});

test('the real manifest replaces the placeholder with the graph (the orb is stopped, the host class dropped)', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  await openPage(ctx);
  assert.ok(pageHost(ctx).classList.contains('auto-deciding-host'), 'the placeholder first');
  const p = proposalFor();
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', stepper: { ...p.manifest, auto: { status: 'decided', via: 'created', rounds: 1, humanInLoop: true, workflowId: 'wf_x' } }, steps: [], subAgents: [] });
  const host = pageHost(ctx);
  assert.ok(!host.classList.contains('auto-deciding-host'));
  assert.equal(host.querySelector('.auto-deciding'), null);
  assert.ok(host.querySelector('.gv-stage'), 'the run graph mounted');
});

// A classifier failure parks the run with auto.status still 'deciding' (spec D17 / §5.6,
// the errors-pause policy) — as does a user pause. isLive(r) is false there, so the SAME
// host that already owns a live orb must give it up, and the copy must not claim the
// decision is gone: resume() re-enters _decideTopology.
test('a run parked while deciding drops the orb and says so; resuming brings the orb back', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  await openPage(ctx);
  assert.ok(pageHost(ctx).querySelector('.ask-orb'), 'live: the thinking orb');
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'paused', pauseReason: 'error', steps: [], subAgents: [] });
  let host = pageHost(ctx);
  assert.ok(host.classList.contains('auto-deciding-host'), 'still the placeholder, not an empty graph');
  assert.equal(host.querySelector('.ask-orb'), null, 'no orb spinning on a parked run');
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Paused before deciding');
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', steps: [], subAgents: [] });
  host = pageHost(ctx);
  assert.ok(host.querySelector('.ask-orb'), 'the orb is rebuilt when the run goes live again');
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Auto is deciding the workflow…');
});

test('a run STOPPED while deciding is frozen: no orb, and A24’s "did not decide" line', async () => {
  const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING }); ctx.showRunning();
  // finishRun repaints the stepper one last time while the page still exists; hold the
  // host, because a stopped run leaves the live list on the very next render.
  const host = await openPage(ctx);
  ctx.dispatch({ type: 'done', runId: RUN_ID, status: 'stopped' });
  assert.equal(host.querySelector('.ask-orb'), null, 'a stopped run would spin its canvas forever');
  assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Auto did not decide a workflow');
});

const DECIDED = (p) => ({ ...p.manifest, template: { id: 'wf_theme', name: 'Theme switch' }, auto: { status: 'decided', via: 'created', rounds: 1, humanInLoop: true, workflowId: 'wf_theme' } });

test('the run page header badge reads "Auto" while deciding and "Auto → name" after adoption; a saved-workflow run hides it', async () => {
  await checkRows([
    { name: 'badge: "Auto" while deciding, "Auto → name" after adoption — on the Running detail', run: async () => {
      const ctx = await boot(); helloRunning(ctx, { stepper: DECIDING });
      ctx.go(`running/${RUN_ID}`); await settle(ctx.window);
      const badge = rdBadge(ctx);
      assert.ok(badge, 'the run page header carries the badge');
      assert.equal(badge.hidden, false); assert.equal(badge.textContent, 'Auto'); assert.equal(badge.title, 'Auto is deciding the workflow');
      ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', stepper: DECIDED(proposalFor()), steps: [], subAgents: [] });
      await settle(ctx.window);
      assert.equal(rdBadge(ctx).textContent, 'Auto → Theme switch'); assert.equal(rdBadge(ctx).title, 'Auto created the workflow "Theme switch"');
      ctx.window.location.hash = `running/${RUN_ID}`; ctx.window.dispatchEvent(new ctx.window.Event('hashchange')); await settle(ctx.window);
      const rd = ctx.window.document.querySelector('#run-detail .rd-row1 .auto-badge');
      assert.equal(rd.hidden, false); assert.equal(rd.textContent, 'Auto → Theme switch');
    } },
    { name: 'a saved-workflow run shows no badge', run: async () => {
      const ctx = await boot(); helloRunning(ctx, { stepper: proposalFor().manifest });
      ctx.go(`running/${RUN_ID}`); await settle(ctx.window);
      assert.ok(rdBadge(ctx), 'the run page header carries the badge slot');
      assert.equal(rdBadge(ctx).hidden, true);
    } },
  ]);
});

// A workspace run forces fan-out on the agents that run per project (proposal.mjs `fanOutLocked`):
// the tunables row shows the switch on, locked, and says why on hover.
test('a workspace-run proposal paints a locked fan-out switch titled "Runs per project on a workspace"', async () => {
  const ctx = await boot();
  helloRunning(ctx, { stepper: DECIDING, kind: 'workspace-run', workspaceId: 'wks-team-00000001' });
  ctx.go(`running/${RUN_ID}`); await settle(ctx.window);
  const p = proposalFor();
  const [lockedId, freeId] = p.order;
  p.nodes[lockedId] = { ...p.nodes[lockedId], fanOut: true, canFanOut: false, fanOutLocked: true };
  ctx.dispatch({ type: 'question', runId: RUN_ID, id: 'auto-1', kind: 'workflow', workflow: p }); await settle(ctx.window);
  const panel = ctx.window.document.querySelector('#run-detail .rd-questions .qpanel');
  assert.ok(panel, 'the proposal panel renders on a workspace run');
  const fanOf = (id) => panel.querySelector(`.qtune tr[data-node-id="${id}"] input[aria-label^="Fan-out"]`);
  const locked = fanOf(lockedId);
  assert.equal(locked.checked, true);
  assert.equal(locked.disabled, true);
  assert.equal(locked.dataset.locked, '1');
  assert.equal(locked.closest('label.qtune-sw').title, 'Runs per project on a workspace');
  assert.equal(fanOf(freeId).closest('label.qtune-sw').title, '', 'an unlocked row carries no title');
});
