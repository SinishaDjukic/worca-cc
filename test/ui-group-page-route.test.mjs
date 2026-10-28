// test/ui-group-page-route.test.mjs — runs redesign slice 4 (D16): #feature/:id and #group/:id render the group page
// (ui/public/group-page.mjs) into the feature page's section, for features, user
// groups and Run-after chains; its Decisions tab (D15) and its Ship for a user group (D6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/run-page-boot.mjs';
import { REPLAY_FRAMES } from './helpers/run-states.mjs';

const member = (i) => ({ position: i, title: `Slice ${i}`, pipelineId: `p${i}`, ticketId: null, status: 'done', pr: null, ticket: null, adhoc: false, after: null });
const GROUPS = { groups: [
  { id: 'feat_1', kind: 'feature', title: 'Run tags', projectKey: null, planning: null, members: [member(1), member(2)], cost: { usd: 1.5, byPipeline: {} } },
  { id: 'g_1', kind: 'user', title: 'Hotfixes', projectKey: null, planning: null, members: [member(3), member(4)], cost: { usd: 0, byPipeline: {} } },
] };
const FEATURE = { id: 'feat_1', title: 'Run tags', projectKey: 'acme', status: 'active', approveEach: false, total: 2, done: 2, halted: null,
  open: false, replacedBy: null, replan: null, ship: { ready: true, mode: null, prUrl: null, suggested: 'one', linesAdded: 10 }, slices: [] };
const json = (b, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }));
const handler = (url) => (url.startsWith('/api/run-groups') ? json(GROUPS)
  : url.startsWith('/api/shape/features/feat_1') ? json(FEATURE)
  : url.startsWith('/api/shape/features/') ? json({ error: 'unknown feature' }, 404) : null);

async function boot(fetchHandler = handler) {
  const ctx = await bootApp({ fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });
  await ctx.settle();
  return ctx;
}
// Run 3 (D1): the group page renders inside the Runs pane.
const pageOf = (ctx) => ctx.window.document.querySelector('#runs-pane #group-detail');

test('#feature/:id for an existing feature renders the group page (Runs tab first)', async () => {
  const ctx = await boot();
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.ok(gp, 'the group page rendered');
  assert.ok(ctx.window.document.querySelector('#runs-pane[data-kind="group"]'), 'the pane shows the group page');
  assert.equal(gp.querySelector('.gpage-title').textContent, 'Run tags');
  assert.equal(gp.querySelector('.kind-chip').textContent, 'Feature');   // run 3 (D7): the group's kind
  assert.equal(gp.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'runs');
  assert.equal(gp.querySelector('.gpage-ship').textContent, 'Merge in order 1 → 2, or ship as one PR');
  ctx.go('feature/feat_1/overview');
  await ctx.settle(6);
  const view = gp.querySelector('.gpage-panel[data-tab="overview"] .shape-feature');
  assert.ok(view, 'Overview hosts the Shaper view');
  ctx.dispatch({ type: 'run-groups-changed' });                  // a reload repaints the page
  await ctx.settle(6);
  assert.equal(gp.querySelector('.gpage-panel[data-tab="overview"] .shape-feature'), view, 'a repaint never remounts the Shaper view');
});

test('#feature/:id for an unknown id says so; #group/:id renders a user group without Overview', async () => {
  const ctx = await boot();
  ctx.go('feature/feat_gone');
  await ctx.settle(6);
  assert.equal(pageOf(ctx).querySelector('.feature-page-gone').textContent.trim(), 'This feature no longer exists. Open the Runs list');
  assert.ok(pageOf(ctx).querySelector('.gpage-bar .gpage-back'), 'the gone state keeps the bar\'s Back');
  ctx.go('group/g_1');
  await ctx.settle(6);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.equal(gp.querySelector('.kind-chip').textContent, 'Group');
  assert.equal(gp.querySelector('.rd-tab[data-tab="overview"]').hidden, true);
  ctx.go('group/p:gone');
  await ctx.settle(6);
  assert.equal(pageOf(ctx).querySelector('.feature-page-gone').textContent.trim(), 'This chain has finished. Its runs are in the Runs list. Open the Runs list');
});

test('offline: a failed /api/run-groups shows the error with Try again, not "no longer exists" (§5a.2)', async () => {
  for (const [name, fail] of [['rejected', () => Promise.reject(new TypeError('Failed to fetch'))], ['503', () => json({ error: 'busy' }, 503)]]) {
    for (const route of ['group/g_1', 'feature/feat_1']) {
      let down = true;
      const h = (url, o) => (down && (url.startsWith('/api/run-groups') || url.startsWith('/api/shape/features/')) ? fail() : handler(url, o));
      const ctx = await boot(h);
      ctx.go(route);
      await ctx.settle(6);
      const page = pageOf(ctx);
      const err = page.querySelector('.feature-page-error');
      assert.ok(err, `${name} ${route}: the error state`);
      assert.match(err.textContent, /^Could not load this group: Worca's server could not be reached\. It loads when the connection is back\./);
      assert.equal(page.querySelector('.feature-page-gone'), null, `${name} ${route}: never "no longer exists" while unreachable`);
      const retry = err.querySelector('button');
      assert.equal(retry.textContent, 'Try again');
      assert.match(retry.className, /\bbtn\b.*\bbtn-sm\b.*\bbtn-secondary\b/);
      down = false;
      retry.click();
      await ctx.settle(8);
      assert.ok(pageOf(ctx).querySelector('.gpage'), `${name} ${route}: Try again renders the page once the server answers`);
      assert.equal(pageOf(ctx).querySelector('.feature-page-error'), null);
    }
  }
});

test('gone offers a way back: an answered "no such group" links the Runs list', async () => {
  const ctx = await boot();
  ctx.go('group/g_gone');
  await ctx.settle(6);
  const a = pageOf(ctx).querySelector('.feature-page-gone a[href="#runs"]');
  assert.ok(a, 'a link to the Runs list');
  assert.equal(a.textContent, 'Open the Runs list');
});

test('Logs follows the run page\'s Expert Logs tab: hidden at Advanced (/logs shows Runs), back at Expert without a reload', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  const setLevel = (lv) => { doc.documentElement.dataset.level = lv; doc.dispatchEvent(new ctx.window.Event('worca:level')); };
  setLevel('advanced');
  ctx.go('group/g_1/logs');
  await ctx.settle(6);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.equal(gp.querySelector('.rd-tab[data-tab="logs"]').hidden, true);
  assert.equal(gp.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'runs');
  setLevel('expert');
  await ctx.settle(4);
  assert.equal(gp.querySelector('.rd-tab[data-tab="logs"]').hidden, false);
  assert.equal(gp.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'logs');
});

test('#group/:chainId deep link loads the chains first; never "no longer exists" for a real chain', async () => {
  const CHAIN = { id: 'chain_1', title: 'Two in a row', members: [
    { position: 1, title: 'First', pipelineId: 'p7', ticketId: null, state: 'done' },
    { position: 2, title: 'Second', pipelineId: null, ticketId: 't8', state: 'waiting', after: 1 }] };
  const chainHandler = (url, o) => (url.startsWith('/api/schedules') ? json({ schedules: [], tickets: [], chains: [CHAIN], counts: {} }) : handler(url, o));
  const ctx = await bootApp({ fetchHandler: chainHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });
  await ctx.settle();
  ctx.go('group/chain_1');                                       // straight from boot: schedulesView never loaded
  await ctx.settle(8);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.ok(gp, 'the chain page rendered');
  assert.equal(gp.querySelector('.kind-chip').textContent, 'Chain');
});

test('a finished member\'s row goes to its History page, not back to the group page', async () => {
  const hist = [{ id: 'p1', projectKey: 'acme', title: 'Slice 1', status: 'done', mtime: Date.now() }];
  const h = (url, o) => (url.startsWith('/api/history') ? json({ pipelines: hist }) : handler(url, o));
  const ctx = await boot(h);
  await ctx.settle(4);
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  const link = pageOf(ctx).querySelector('.run-member[data-key="p1"] .run-member-title');
  assert.equal(link.getAttribute('href'), '#history/acme/p1');
  link.click();
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#history/acme/p1', 'clicking the row\'s link opens the run');
});

test('slice 3: Create PR on a ready user group opens the group dialog; the combine check paints One off with its reason; separate posts once', async () => {
  const hist = [3, 4].map((i) => ({ id: `p${i}`, projectKey: 'acme', title: `Slice ${i}`, status: 'done', mtime: Date.now() }));
  const posts = [];
  const combines = [];
  const ctx = await boot((url, o = {}) => {
    if (url.startsWith('/api/history')) return json({ pipelines: hist });
    if (url.startsWith('/api/run-groups/g_1/combine')) { combines.push(url); return json({ n: 2, oneOff: 'The runs conflict in f.txt', line: '', base: 'dev', files: ['f.txt'] }); }
    if (url.startsWith('/api/run-groups/g_1/ship')) { posts.push({ url, body: JSON.parse(o.body) }); return json({ ok: true, mode: 'separate', prs: ['u3', 'u4'] }); }
    return handler(url, o);
  });
  await ctx.settle(4);
  ctx.go('group/g_1');
  await ctx.settle(6);
  const hash = ctx.window.location.hash;
  const page = pageOf(ctx);
  assert.equal(page.querySelector('.gpage-actions [data-model-action="ship"]:not([hidden])'), null, 'no Create PR in the bar (D10)');
  page.querySelector('.gpage-card .rd-pr-slot button').click();
  await ctx.settle(4);
  const modal = ctx.window.document.getElementById('shipit-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(combines.length, 1);
  assert.equal(modal.querySelector('.shipit-title').textContent, 'Create 2 PRs');
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '2 separate');
  assert.equal(modal.querySelector('.shipit-base').textContent, "Each run's own base branch");
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').disabled, true);
  assert.equal(modal.querySelector('.shipit-prs-one-why').textContent, 'The runs conflict in f.txt');
  modal.querySelector('.shipit-ok').click();
  await ctx.settle(4);
  // No project settings answer in this stub, so Watch PR defaults off and the payload is the mode alone.
  assert.deepEqual(posts, [{ url: '/api/run-groups/g_1/ship', body: { mode: 'separate' } }]);
  assert.equal(ctx.window.location.hash, hash);
});

test('slice 3: a combine check that fails (500) keeps One off with "Could not check…"; separate stays checked', async () => {
  const hist = [3, 4].map((i) => ({ id: `p${i}`, projectKey: 'acme', title: `Slice ${i}`, status: 'done', mtime: Date.now() }));
  const ctx = await boot((url, o = {}) => {
    if (url.startsWith('/api/history')) return json({ pipelines: hist });
    if (url.startsWith('/api/run-groups/g_1/combine')) return json({ error: 'git exploded' }, 500);
    return handler(url, o);
  });
  await ctx.settle(4);
  ctx.go('group/g_1');
  await ctx.settle(6);
  pageOf(ctx).querySelector('.gpage-card .rd-pr-slot button').click();
  await ctx.settle(4);
  const modal = ctx.window.document.getElementById('shipit-modal');
  const why = modal.querySelector('.shipit-prs-one-why');
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').disabled, true);
  assert.equal(why.hidden, false);
  assert.ok(why.textContent.startsWith('Could not check whether the runs combine'), why.textContent);
  assert.match(why.textContent, /git exploded/);
  assert.equal(modal.querySelector('.shipit-prs input[value="stacked"]').checked, true);
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 2 PRs');
});

test('Decisions: one section per member with a decision or a receipt; a live member\'s receipts come from its run', async () => {
  const DECISION = { id: 'd1', pipelineId: 'p1', kind: 'clarify', question: 'Which DB?', answer: 'Postgres', decidedBy: 'away', at: '2026-10-18T10:00:00Z' };
  const decisions = (url, o) => (url.startsWith('/api/night-decisions')
    ? json({ decisions: url.includes('pipelineId=p1') ? [DECISION] : [] }) : handler(url, o));
  const ctx = await boot(decisions);
  ctx.go('feature/feat_1/decisions');
  await ctx.settle(8);
  assert.equal(pageOf(ctx).querySelectorAll('.gpage-decision').length, 1, 'p1\'s away-mode decision');
  // p2 goes live with the recorded run's last frame: its plan and review receipts, with no decision fetched for it.
  const last = REPLAY_FRAMES[REPLAY_FRAMES.length - 1];
  ctx.dispatch({ type: 'hello', runs: [{ runId: 'r2', pipelineId: 'p2', title: 'Slice 2', projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' }] });
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p2', status: 'running', stepper: last.stepper, steps: last.steps, active: [], progressFacts: last.progressFacts });
  await ctx.settle(8);
  const secs = [...pageOf(ctx).querySelectorAll('.gpage-decision')];
  assert.equal(secs.length, 2);
  assert.ok([...secs[1].querySelectorAll('li.gpage-receipt')].some((li) => li.textContent === 'Plan accepted'));
});

test('slice 3: a failed /api/run-groups reload keeps the page (same .gpage node, no error, no rebuild)', async () => {
  for (const fail of [() => json({ error: 'busy' }, 500), () => Promise.reject(new TypeError('Failed to fetch'))]) {
    let down = false;
    const ctx = await boot((url) => (down && url.startsWith('/api/run-groups') ? fail() : handler(url)));
    ctx.go('feature/feat_1');
    await ctx.settle(6);
    const gp = pageOf(ctx).querySelector('.gpage');
    assert.ok(gp, 'the page rendered');
    const before = ctx.calls.filter((c) => c.url.startsWith('/api/run-groups')).length;
    down = true;
    ctx.dispatch({ type: 'run-groups-changed' });
    await ctx.settle(6);
    assert.ok(ctx.calls.filter((c) => c.url.startsWith('/api/run-groups')).length > before, 'the failed reload was really requested');
    assert.equal(pageOf(ctx).querySelector('.gpage'), gp, 'the same page node');
    assert.equal(pageOf(ctx).querySelector('.feature-page-error'), null, 'no "could not load" swap');
  }
});
