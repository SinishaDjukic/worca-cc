// test/ui-group-page-route.test.mjs — runs redesign slice 4 (D16): #feature/:id and #group/:id render the group page
// (ui/public/group-page.mjs) into the feature page's section, for features, user
// groups and Run-after chains; its Decisions tab (D15) and its Ship for a user group (D6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/run-page-boot.mjs';
import { REPLAY_FRAMES } from './helpers/run-states.mjs';
import { SIXTEEN_RUN_LINKS } from './helpers/shape-sixteen-runs.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

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

/** A ready small-runs feature of `slices` for the flag-on cases; `over` goes into ship.smallRuns. */
const smallBoot = (slices, over = {}) => {
  const acceptance = { items: [], agreed: [], entries: [], covered: [], ready: true, marked: 0, total: 0 };
  const smallRuns = { confirmed: [], owned: [], waiting: [], blocked: false, reason: null, met: { met: 0, total: 0 }, care: null, base: 'main', order: [], ...over };
  return boot((url) => (url.startsWith('/api/pr/remotes') ? json({ ok: true, chain: ['main'], remotes: [], defaults: {} })
    : url.startsWith('/api/shape/features/feat_1') ? json({ ...FEATURE, total: slices.length, done: slices.length, slices,
      ship: { ...FEATURE.ship, acceptance, smallRuns } }) : handler(url)));
};
const openDialog = async (ctx) => {
  pageOf(ctx).querySelector('.gpage-card .rd-pr-slot [data-rd-cta]').click();
  await ctx.settle(10);
  const modal = ctx.window.document.getElementById('shipit-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  return { one: modal.querySelector('.shipit-prs input[value="one"]'), stacked: modal.querySelector('.shipit-prs input[value="stacked"]'),
    why: modal.querySelector('.shipit-prs-one-why'), more: modal.querySelector('.shipit-prs-stacked-label') };
};

// First in the file on purpose: onFlagChange listeners are shared by every app boot, so a live toggle is tested before any
// other app instance exists.
test('small runs, flag on: the line offers One, follows a live Labs toggle, and the dialog enables One', async () => {
  const ctx = await smallBoot([1, 2].map((i) => ({ index: i, pipelineId: `p${i}`, pr: null })));
  applyFlags({ shaperSmallRuns: true }, ctx.window.document);
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  const line = () => pageOf(ctx).querySelector('.gpage-ship').textContent;
  assert.equal(line(), 'Merge in order 1 → 2, or ship as one PR');
  applyFlags({ shaperSmallRuns: false }, ctx.window.document);
  await ctx.settle(6);
  assert.equal(line(), 'Merge in order 1 → 2', 'turned off on the open page');
  applyFlags({ shaperSmallRuns: true }, ctx.window.document);
  await ctx.settle(6);
  assert.equal(line(), 'Merge in order 1 → 2, or ship as one PR', 'and on again');
  const d = await openDialog(ctx);
  assert.deepEqual([d.one.disabled, d.stacked.disabled, d.why.hidden], [false, false, true]);
});

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

test('Shaper requirements s3: the header Create PR follows the ledger lock; a shape-feature frame unlocks it', async () => {
  const ledger = (marked) => ({ items: [], agreed: [{ id: 'R-po-1' }, { id: 'R-ux-1' }], entries: [], covered: [], ready: marked === 2, marked, total: 2 });
  let acceptance = ledger(0);
  const ctx = await boot((url) => (url.startsWith('/api/shape/features/feat_1')
    ? json({ ...FEATURE, ship: { ...FEATURE.ship, acceptance } }) : handler(url)));
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  const cta = () => pageOf(ctx).querySelector('.gpage-card .rd-pr-slot [data-rd-cta]');
  assert.ok(cta(), 'the header has its Create PR');
  assert.equal(cta().disabled, true, 'locked while requirements are unmarked');
  assert.equal(cta().classList.contains('btn-primary'), false, 'not primary while locked');
  assert.equal(cta().title, 'Mark every requirement before you create the PR · 2 left');
  acceptance = ledger(2);
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(6);
  assert.equal(cta().disabled, false, 'every requirement marked: enabled');
  assert.equal(cta().classList.contains('btn-primary'), true, 'and primary again');
  ctx.go('feature/feat_1/overview');                              // the Overview view's own refetch carries the lock
  await ctx.settle(6);
  acceptance = ledger(1);
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(6);
  assert.equal(cta().disabled, true, 'a mark taken back elsewhere locks it again');
  assert.equal(cta().title, 'Mark every requirement before you create the PR · 1 left');
});

test('D1, flag off: a small-runs feature\'s header follows the small-runs ledger (run-owned ids never lock it) and offers no One', async () => {
  // acceptance counts every agreed id, run-owned ones included: only the confirmed ids a person marks may lock the head.
  const acceptance = { items: [], agreed: [{ id: 'R-po-1' }, { id: 'R-po-2' }, { id: 'R-comp-4' }], entries: [], covered: [], ready: false, marked: 0, total: 3 };
  const sr = (blocked) => ({ confirmed: [], owned: [], waiting: blocked ? ['R-comp-4'] : [], blocked, reason: blocked ? 'Waiting for Compliance to confirm R-comp-4' : null,
    met: { met: 2, total: 3 }, care: null, base: 'main', order: [] });
  let smallRuns = sr(true);
  const ctx = await boot((url) => (url.startsWith('/api/pr/remotes') ? json({ ok: true, chain: ['main'], remotes: [], defaults: {} })
    : url.startsWith('/api/shape/features/feat_1') ? json({ ...FEATURE, slices: [{ index: 1, pipelineId: 'p1', pr: null }, { index: 2, pipelineId: 'p2', pr: null }],
      ship: { ...FEATURE.ship, acceptance, smallRuns } }) : handler(url)));
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  const cta = () => pageOf(ctx).querySelector('.gpage-card .rd-pr-slot [data-rd-cta]');
  assert.equal(cta().disabled, true, 'locked while a confirmed requirement waits');
  assert.equal(cta().title, 'Mark every requirement before you create the PR · 1 left', 'only the person-marked id counts');
  assert.equal(pageOf(ctx).querySelector('.gpage-ship').textContent, 'Merge in order 1 → 2', 'One is refused for small runs (STACKED_ONLY)');
  smallRuns = sr(false);
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(6);
  assert.equal(cta().disabled, false, 'every confirmed requirement marked: enabled though the owned ids stay unmarked');
  assert.equal(cta().classList.contains('btn-primary'), true);
  cta().click();
  await ctx.settle(10);
  const modal = ctx.window.document.getElementById('shipit-modal');
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').disabled, true, 'One is off');
  assert.equal(modal.querySelector('.shipit-prs-one-why').textContent, 'small runs ship a PR per run', 'flag off: the reason as before');
  assert.doesNotMatch(modal.querySelector('.shipit-prs-hint').textContent, /one PR is easier/, 'the hint never suggests the disabled One');
});

test('small runs, flag on, along the real branches: a carried run\'s open PR turns One off and is named', async () => {
  const slices = [1, 2, 3].map((i) => ({ index: i, pipelineId: `p${i}`,
    pr: i === 2 ? { url: 'https://github.com/me/repo/pull/40', number: 40, state: 'OPEN' } : null }));
  const row = (i) => ({ index: i, pipelineId: `p${i}`, title: `Slice ${i}`, pr: null, onto: null });
  const ctx = await smallBoot(slices, { order: [row(1), row(3)], along: true });
  const root = ctx.window.document.documentElement;
  root.dataset.flags = `${root.dataset.flags || ''} shaperSmallRuns`;      // on from the start: no listener of an earlier boot runs
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  const d = await openDialog(ctx);
  assert.deepEqual([d.one.disabled, d.why.textContent], [true, 'Run 2 already has pull request #40 open']);
  assert.deepEqual([d.stacked.disabled, d.more.textContent], [false, '2 stacked'], 'the count stays the listed runs\'');
});

// Slice 5 (R-po-2): the app hands ship.smallRuns.carried to the dialog.
test('small runs, flag on: the feature\'s Ship dialog names the carried run with its open PR and reads Create 4 PRs', async () => {
  const pr = { url: 'https://github.com/me/repo/pull/40', number: 40, state: 'OPEN' };
  const line = "Run 2's work ships in run 3's pull request (#40 is open)";
  const slices = [1, 2, 3, 4, 5].map((i) => ({ index: i, pipelineId: `p${i}`, pr: i === 2 ? pr : null }));
  const row = (i) => ({ index: i, pipelineId: `p${i}`, title: `Slice ${i}`, pr: null, onto: null });
  const ctx = await smallBoot(slices, { order: [1, 3, 4, 5].map(row), along: true, newPrs: 4,
    carried: [{ index: 2, by: 3, title: 'Slice 2', pr, line }] });
  const root = ctx.window.document.documentElement;
  root.dataset.flags = `${root.dataset.flags || ''} shaperSmallRuns`;      // on from the start: no listener of an earlier boot runs
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  await openDialog(ctx);
  const modal = ctx.window.document.getElementById('shipit-modal');
  assert.deepEqual([...modal.querySelectorAll('.shipit-prs-carried small.hint')].map((x) => x.textContent), [line]);
  // Slice 7 (D16, owner direction): the carried line names #40; the note and One's reason name no number.
  assert.equal(modal.querySelector('.shipit-prs-kept')?.textContent, 'The open pull request is not counted.');
  assert.equal(modal.querySelector('.shipit-prs-one-why').textContent, 'Run 2 already has a pull request open');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 4 PRs');
});

test('slice 4: along the real branches, the feature dialog counts the listed runs: 4 runs, run 2 carried, Create 3 PRs', async () => {
  const acceptance = { items: [], agreed: [], entries: [], covered: [], ready: true, marked: 0, total: 0 };
  const row = (i) => ({ index: i, pipelineId: `p${i}`, title: `Slice ${i}`, pr: null, onto: null });
  const smallRuns = { confirmed: [], owned: [], waiting: [], blocked: false, reason: null, met: { met: 0, total: 0 }, care: null, base: 'main',
    order: [row(1), row(3), row(4)], along: true };
  const ctx = await boot((url) => (url.startsWith('/api/pr/remotes') ? json({ ok: true, chain: ['main'], remotes: [], defaults: {} })
    : url.startsWith('/api/shape/features/feat_1') ? json({ ...FEATURE, total: 4, done: 4, slices: [1, 2, 3, 4].map((i) => ({ index: i, pipelineId: `p${i}`, pr: null })),
      ship: { ...FEATURE.ship, acceptance, smallRuns } }) : handler(url)));
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  pageOf(ctx).querySelector('.gpage-card .rd-pr-slot [data-rd-cta]').click();
  await ctx.settle(10);
  const modal = ctx.window.document.getElementById('shipit-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 3 PRs');
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

// ── Shaper small runs D3: the Requirements and Decisions tabs of a marked feature ─────────────────────────────────────
const shown = (owner, word, mark) => ({ owner, role: null, word, text: `${owner} · ${word}`, mark });
const D3_SR = (w2 = 'being built') => ({
  owned: [{ id: 'R-po-1', text: 'People see it', run: 1, status: 'holds', shown: shown('run 1', 'met', 'check') },
    { id: 'R-po-2', text: 'People export it', run: 2, status: 'holds', shown: shown('run 2', w2, w2 === 'met' ? 'check' : 'live') }],
  confirmed: [{ id: 'R-comp-1', text: 'A signed copy is kept', role: 'compliance', roleLabel: 'Compliance', state: 'waiting', mark: null, reason: null, at: null,
    shown: { owner: 'confirmed by a person', role: 'Compliance', word: 'Compliance', text: 'confirmed by a person · Compliance', mark: 'wait' } }],
  waiting: ['R-comp-1'], blocked: true, reason: 'Waiting for Compliance to confirm R-comp-1', met: { met: 2, total: 3 }, unmet: [],
  care: { choice: "Balanced · Worca's pick", outcome: null, line: "Care: Balanced · Worca's pick" }, base: 'main', order: [],
});
const D3_FEATURE = (w2, log = [{ key: 'outline', run: null, text: 'Split into 2 runs', detail: [] }, { key: 'r2', run: 2, text: 'Plan approved', detail: [] }]) => ({
  ...FEATURE, ready: false, log, requirementKinds: [{ id: 'R-po-1', kind: 'owned', run: 1 }, { id: 'R-po-2', kind: 'owned', run: 2 }, { id: 'R-comp-1', kind: 'confirmed', role: 'compliance' }],
  slices: [{ index: 1, pipelineId: 'p1', pr: null }, { index: 2, pipelineId: 'p2', pr: null }], ship: { ...FEATURE.ship, ready: false, smallRuns: D3_SR(w2) } });
// The members carry a project key, so a run with a pipeline has its own #history/ page.
const d3Member = (i) => ({ ...member(i), projectKey: 'acme' });
const D3_GROUPS = (extra = []) => ({ groups: [{ ...GROUPS.groups[0], members: [d3Member(1), d3Member(2), ...extra] }, GROUPS.groups[1]] });
async function d3Boot({ flag = true, feature = () => D3_FEATURE('being built'), extra = () => null, groups = D3_GROUPS() } = {}) {
  const calls = { feature: 0 };
  const ctx = await boot((url, o) => {
    const x = extra(url, o);
    if (x) return x;
    if (url.startsWith('/api/run-groups')) return json(groups);
    if (url.startsWith('/api/shape/features/feat_1')) { calls.feature += 1; return feature(calls.feature); }
    return handler(url, o);
  });
  const { applyFlags } = await import('../ui/public/flags.mjs');
  applyFlags({ shaperSmallRuns: flag }, ctx.window.document);
  return { ctx, calls };
}
const reqNote = (ctx, id) => pageOf(ctx).querySelector(`.gpage-requirements [data-key="${id}"] .plan-check-detail`)?.textContent;
const liveP2 = (ctx, status) => {
  ctx.dispatch({ type: 'hello', runs: [{ runId: 'r2', pipelineId: 'p2', title: 'Slice 2', projectDir: '/tmp/p', status, kind: 'run', startedAt: '2026-01-01T00:00:00Z' }] });
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p2', status, steps: [], active: [] });
};

test('D3: a marked feature with the flag on shows Runs, Requirements, Decisions, Cost, Log; #feature/ID/requirements selects Requirements (aria-selected=true); Decisions paints the feature log; Runs lists the planning run as run 1', async () => {
  const { ctx } = await d3Boot({ feature: () => json(D3_FEATURE('being built')) });
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.deepEqual([...gp.querySelectorAll('.gpage-tabs .rd-tab')].map((t) => t.textContent), ['Runs', 'Requirements', 'Decisions', 'Cost', 'Log']);
  assert.equal(gp.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'requirements');
  assert.equal(ctx.window.location.hash, '#feature/feat_1/requirements');
  assert.equal(reqNote(ctx, 'R-po-2'), 'run 2 · being built');
  const link = gp.querySelector('.gpage-requirements [data-key="R-po-1"] a.rd-fact-link');
  assert.equal(link.getAttribute('href'), '#history/acme/p1');
  assert.equal(link.getAttribute('href'), gp.querySelector('.run-member[data-key="p1"] .run-member-title').getAttribute('href'), 'run 1\'s own page, as its Runs row links it');
  ctx.go('feature/feat_1/decisions');
  await ctx.settle(10);
  const dec = gp.querySelector('.gpage-decisions');
  assert.ok(dec.classList.contains('shape-feature-decisions'));
  assert.deepEqual([...dec.querySelectorAll(':scope > ul > li .plan-check-label')].map((x) => x.textContent), ["Care: Balanced · Worca's pick", 'Split into 2 runs', 'Plan approved']);
  assert.equal(dec.querySelector('.gpage-decision'), null, 'not the per-run receipts');
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  assert.equal(gp.querySelector('.run-member .run-member-title').textContent.includes('Slice 1'), true, 'run 1 first');
});

test('D3: a planned run with no page yet (a waiting ticket) reads its run N as plain text, not a link back to the feature', async () => {
  const groups = D3_GROUPS([{ ...d3Member(3), pipelineId: null, ticketId: 't3', status: 'scheduled' }]);
  const f = D3_FEATURE('being built');
  f.ship.smallRuns.owned.push({ id: 'R-po-3', text: 'People share it', run: 3, status: 'holds', shown: shown('run 3', 'to do', 'wait') });
  f.requirementKinds.push({ id: 'R-po-3', kind: 'owned', run: 3 });
  const { ctx } = await d3Boot({ feature: () => json(f), groups });
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  const row = pageOf(ctx).querySelector('.gpage-requirements [data-key="R-po-3"]');
  assert.ok(row, 'R-po-3 rendered');
  assert.equal(row.querySelector('a'), null, 'no link for a run with no page');
  assert.equal(reqNote(ctx, 'R-po-3'), 'run 3 · to do');
  assert.ok(pageOf(ctx).querySelector('.gpage-requirements [data-key="R-po-1"] a.rd-fact-link'), 'a run with a page still links');
});

test('S16-T5 (R-po-6): a run that has not started has no run page: its row on the feature page and in the Runs list opens the feature', async () => {
  const waiting = { ...d3Member(3), pipelineId: null, ticketId: 't3', status: 'scheduled' };
  const groups = { groups: [{ ...D3_GROUPS([waiting]).groups[0], smallRuns: true }, GROUPS.groups[1]] };
  // The Runs list lists a group only once one of its runs is a live, scheduled or saved row: run 1 is saved.
  const saved = [{ id: 'p1', projectKey: 'acme', title: 'Slice 1', status: 'done', mtime: Date.now() }];
  const { ctx } = await d3Boot({ feature: () => json(D3_FEATURE('being built')), groups,
    extra: (url) => (url.startsWith('/api/history') ? json({ pipelines: saved }) : null) });
  ctx.go('feature/feat_1');
  await ctx.settle(10);
  const hrefs = (row) => [...row.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  const noRunPage = (row, where) => {
    assert.deepEqual(hrefs(row).filter((h) => h.startsWith('#running/') || h.startsWith('#history/')), [], `${where}: no run page link`);
  };
  const row = pageOf(ctx).querySelector('.gpage-runs .run-member[data-key="t3"]');
  assert.ok(row, 'the waiting run has a row on the feature page');
  assert.equal(row.querySelector('.run-member-title').getAttribute('href'), '#feature/feat_1');
  noRunPage(row, 'feature page');
  assert.equal(pageOf(ctx).querySelector('.gpage-runs .run-member[data-key="p1"] .run-member-title').getAttribute('href'), '#history/acme/p1',
    'a started run still links its own page');
  // The same member in the Runs list (the group row, expanded).
  const list = () => ctx.window.document.getElementById('runs-list');
  const toggle = list().querySelector('.runs-item[data-row-key*="feat_1"] .runs-expand');
  assert.ok(toggle, 'the feature\'s group row is listed');
  if (toggle.getAttribute('aria-expanded') !== 'true') {
    toggle.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
    await ctx.settle(6);
  }
  const members = [...list().querySelectorAll('.runs-item[data-row-key*="feat_1"] > .runs-members > .runs-item')];
  const member = (n) => members.find((m) => m.querySelector('.runs-row-title').textContent === `${n} · Slice ${n}`);
  assert.ok(member(3), `the waiting run is a member row: ${members.map((m) => m.textContent).join(' | ')}`);
  assert.equal(member(3).querySelector('a.runs-row').getAttribute('href'), '#feature/feat_1');
  noRunPage(member(3), 'Runs list');
  assert.equal(member(1).querySelector('a.runs-row').getAttribute('href'), '#history/acme/p1');
});

test('D3: a member state frame refetches the feature and flips R-po-2 from being built to met; a shape-feature frame changing one word repaints the open tab', async () => {
  let w2 = 'being built';
  const { ctx, calls } = await d3Boot({ feature: () => json(D3_FEATURE(w2)) });
  liveP2(ctx, 'running');
  await ctx.settle(6);
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  assert.equal(reqNote(ctx, 'R-po-2'), 'run 2 · being built');
  const before = calls.feature;
  w2 = 'met';
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p2', status: 'done', steps: [], active: [] });
  await ctx.settle(10);
  assert.ok(calls.feature > before, 'the member key change refetched the feature');
  assert.equal(reqNote(ctx, 'R-po-2'), 'run 2 · met');
  const settled = calls.feature;
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p2', status: 'done', steps: [], active: [] });
  await ctx.settle(6);
  assert.equal(calls.feature, settled, 'the same key fetches nothing');
  w2 = 'paused';
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(10);
  assert.equal(reqNote(ctx, 'R-po-2'), 'run 2 · paused');
});

test('D3: a failed refetch keeps the last rows and the next member key change retries', async () => {
  let w2 = 'being built';
  let down = false;
  const { ctx, calls } = await d3Boot({ feature: () => (down ? json({ error: 'busy' }, 503) : json(D3_FEATURE(w2))) });
  liveP2(ctx, 'running');
  await ctx.settle(6);
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  down = true;
  w2 = 'met';
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p2', status: 'paused', steps: [], active: [] });
  await ctx.settle(10);
  const failed = calls.feature;
  assert.equal(reqNote(ctx, 'R-po-2'), 'run 2 · being built', 'the last rows stay');
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p2', status: 'paused', steps: [], active: [] });
  await ctx.settle(6);
  assert.equal(calls.feature, failed, 'the same key does not retry on every frame');
  down = false;
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p2', status: 'done', steps: [], active: [] });
  await ctx.settle(10);
  assert.ok(calls.feature > failed);
  assert.equal(reqNote(ctx, 'R-po-2'), 'run 2 · met');
});

test('D3: an older feature fetch that answers last never overwrites a newer one (member refetch vs shape-feature frame)', async () => {
  let w2 = 'being built';
  let hold = null;
  const { ctx, calls } = await d3Boot({ feature: () => {
    const body = D3_FEATURE(w2);
    if (!hold) return json(body);
    const h = hold; hold = null;
    return new Promise((r) => { h.release = () => r(json(body)); });
  } });
  liveP2(ctx, 'running');
  await ctx.settle(6);
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  const before = calls.feature;
  const slow = {};
  hold = slow;                                       // the member refetch reads 'being built' and answers late
  ctx.dispatch({ type: 'state', runId: 'r2', id: 'p2', status: 'paused', steps: [], active: [] });
  await ctx.settle(6);
  assert.ok(calls.feature > before && slow.release, 'the member refetch is in flight');
  w2 = 'met';
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(10);
  assert.equal(reqNote(ctx, 'R-po-2'), 'run 2 · met');
  slow.release();
  await ctx.settle(10);
  assert.equal(reqNote(ctx, 'R-po-2'), 'run 2 · met', 'the stale answer is dropped');
});

test('D3: opening Requirements fetches the feature once (the mount\'s fetch seeds the member key)', async () => {
  const { ctx, calls } = await d3Boot({ feature: () => json(D3_FEATURE('being built')) });
  liveP2(ctx, 'running');
  await ctx.settle(6);
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  assert.equal(calls.feature, 1);
  ctx.go('feature/feat_1/decisions');
  await ctx.settle(10);
  assert.equal(calls.feature, 1, 'one member key for both tabs');
});

test('D3: a marked feature with the flag off has no Requirements tab', async () => {
  const { ctx } = await d3Boot({ flag: false, feature: () => json(D3_FEATURE('being built')) });
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.equal(gp.querySelector('.rd-tab[data-tab="requirements"]'), null);
  assert.equal(gp.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'runs');
  ctx.go('feature/feat_1/decisions');
  await ctx.settle(10);
  assert.equal(gp.querySelector('.gpage-decisions').classList.contains('shape-feature-decisions'), false, 'dev\'s Decisions');
});

test('D3: a Decisions deep link whose receipts resolve after the feature keeps the feature log', async () => {
  let releaseFeature; let releaseDecisions;
  const { ctx } = await d3Boot({
    feature: () => new Promise((r) => { releaseFeature = () => r(new Response(JSON.stringify(D3_FEATURE('being built')), { status: 200, headers: { 'content-type': 'application/json' } })); }),
    extra: (url) => (url.startsWith('/api/night-decisions')
      ? new Promise((r) => { releaseDecisions = () => r(new Response(JSON.stringify({ decisions: [{ id: 'd1', pipelineId: 'p1', kind: 'clarify', question: 'Which DB?', answer: 'Postgres', decidedBy: 'away', at: '2026-10-18T10:00:00Z' }] }), { status: 200, headers: { 'content-type': 'application/json' } })); })
      : null),
  });
  ctx.go('feature/feat_1/decisions');
  await ctx.settle(4);
  ctx.dispatch({ type: 'run-groups-changed' });     // a repaint while the feature is still in flight: the receipts start
  await ctx.settle(8);
  assert.ok(releaseDecisions, 'paintGroupDecisions started');
  releaseFeature();
  await ctx.settle(10);
  const dec = pageOf(ctx).querySelector('.gpage-decisions');
  assert.ok(dec.querySelector('[data-fact="care"]'), 'the feature log');
  releaseDecisions();
  await ctx.settle(10);
  assert.ok(dec.querySelector('[data-fact="care"]'), 'the late receipts did not paint over it');
  assert.equal(dec.querySelector('.gpage-decision'), null);
});

test('D3: a requirements deep link shows Loading group… until the feature resolves', async () => {
  let release;
  const { ctx } = await d3Boot({ feature: () => new Promise((r) => { release = () => r(new Response(JSON.stringify(D3_FEATURE('being built')), { status: 200, headers: { 'content-type': 'application/json' } })); }) });
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(4);
  ctx.dispatch({ type: 'run-groups-changed' });
  await ctx.settle(8);
  assert.equal(pageOf(ctx).querySelector('.gpage'), null, 'no Runs flash');
  assert.equal(pageOf(ctx).querySelector('.feature-page-loading').textContent, 'Loading group…');
  release();
  await ctx.settle(10);
  assert.equal(pageOf(ctx).querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'requirements');
  assert.equal(ctx.window.location.hash, '#feature/feat_1/requirements');
});

// ── fail closed: an agreed requirement with no run and no person ──
test('fail closed: the feature page of an owner-less feature disables Create PR, says why and nowhere reads "Ready to ship"', async () => {
  const reason = 'R-po-2 is owned by no run and confirmed by no person';
  const sr = { ...D3_SR('met'), confirmed: [], waiting: [], blocked: true, reason, unowned: ['R-po-2'], order: [{ index: 1 }, { index: 2 }] };
  sr.owned = [sr.owned[0], { id: 'R-po-2', text: 'People export it', run: null, status: 'unowned',
    shown: { owner: 'no run', role: null, word: 'confirmed by no person', text: 'owned by no run · confirmed by no person', mark: 'x' } }];
  const groups = { groups: [{ ...D3_GROUPS().groups[0], smallRuns: true, hold: reason }, GROUPS.groups[1]] };
  const { ctx } = await d3Boot({ groups, feature: () => json({ ...D3_FEATURE('met'), ship: { ...FEATURE.ship, ready: false, smallRuns: sr } }) });
  ctx.go('feature/feat_1');
  await ctx.settle(10);
  const gp = pageOf(ctx).querySelector('.gpage');
  const cta = gp.querySelector('.gpage-card .rd-pr-slot [data-rd-cta]');
  assert.ok(cta);
  assert.equal(cta.disabled, true);
  assert.equal(cta.classList.contains('btn-primary'), false);
  // Slice 7: the hover-only .rd-tip is hidden at rest, so it is not part of what the page shows.
  const visible = () => [...gp.querySelectorAll('.gpage-head, .gpage-card')].map((x) => { const c = x.cloneNode(true); c.querySelectorAll('.rd-tip').forEach((t) => t.remove()); return c.textContent; }).join(' ');
  assert.equal(visible().split(reason).length - 1, 1, 'the reason, once');
  assert.doesNotMatch(visible(), /Ready to ship/);
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  assert.equal(gp.querySelector('.shape-feature-reqs-cap').textContent, '2 requirements · 1 owned by a run · 0 you confirm · 1 owned by no run');
  assert.equal(reqNote(ctx, 'R-po-2'), 'owned by no run · confirmed by no person');
  // The member rows of a finished feature keep their own words (Step 7); the list row is held too.
  const row = ctx.window.document.querySelector('.runs-item[data-row-key="chain:feat_1"] > a.runs-row');
  if (row) assert.doesNotMatch(row.textContent, /Ready to ship/);
});

// ── item 5 (D10): the Verifier's stop is answerable on the feature page ──
const V_STOP = { id: 'verify-3', kind: 'gate', nodeId: 'n_verify', issues: [], stop: { reason: 'check', run: null, node: 'n_verify', pick: 'another', head: 'Verifier · 1 gap left',
  text: 'One requirement does not hold.', findingsLine: '1 gap open', gaps: [{ id: 'R-po-2', why: 'no email' }], options: [
    { value: 'another', label: 'Fix again', sub: 'One more round', go: 'Fix again', short: 'fix again', payload: { decision: 'another' } },
    { value: 'continue', label: 'Accept as is', sub: 'Ships with it', go: 'Accept as is', short: 'accepted', payload: { decision: 'continue' } }] } };
const verifierRun = { runId: 'rv', pipelineId: 'pv', title: 'Run tags · Verifier', projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z', pendingQuestion: V_STOP };
test('D10: with no current run, the Verifier\'s open stop is asked and answered on the feature page; flag off: as today', async () => {
  for (const flag of [true, false]) {
    const posts = [];
    const extra = (url, o) => {
      if (url === '/api/shape/pipelines/pv/slice') return json({ verifier: true, featureId: 'feat_1', threadId: null });
      if (url.startsWith('/api/answer')) { posts.push(JSON.parse(o.body)); return json({ ok: true }); }
      return null;
    };
    const { ctx } = await d3Boot({ flag, extra, feature: () => json(D3_FEATURE('met')) });
    ctx.dispatch({ type: 'hello', runs: [verifierRun] });
    ctx.go('feature/feat_1');
    await ctx.settle(12);
    const slot = pageOf(ctx).querySelector('.gpage-question');
    if (!flag) { assert.equal(slot.hidden, true); continue; }
    assert.equal(slot.hidden, false, 'the question shows');
    assert.ok(slot.textContent.includes('Verifier · 1 gap left'));
    slot.querySelector('.btn-primary').dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
    await ctx.settle(6);
    assert.deepEqual(posts.map((x) => [x.runId, x.id, x.payload.decision]), [['rv', 'verify-3', 'another']]);
  }
});

test('D10: a cached miss of the Verifier\'s run is asked again once per question, and the feature page then asks it', async () => {
  let gets = 0;
  const extra = (url) => (url === '/api/shape/pipelines/pv/slice'
    ? (gets += 1, gets === 1 ? json({ error: 'not a slice' }, 404) : json({ verifier: true, featureId: 'feat_1', threadId: null })) : null);
  const { ctx } = await d3Boot({ extra, feature: () => json(D3_FEATURE('met')) });
  ctx.dispatch({ type: 'hello', runs: [verifierRun] });
  ctx.go('feature/feat_1');
  await ctx.settle(12);
  const slot = pageOf(ctx).querySelector('.gpage-question');
  assert.equal(slot.hidden, false, `${gets} GETs`);
  assert.ok(slot.textContent.includes('Verifier · 1 gap left'));
  assert.equal(slot.querySelectorAll('.qopt').length, 2);
  await ctx.settle(6);
  assert.equal(gets, 2, 'asked again once, not on every paint');
});

// ── item 6: a run's stop on the feature page: one head (the stop's), one primary, no Re-plan beside it ──
const P_STOP = { id: 'plan-n_refine-2', kind: 'plan', nodeId: 'n_refine', plan: { round: 1, file: 'p.md', check: { ok: false, passed: 3, total: 8, items: [{ label: 'Has tests', pass: false }] } },
  stop: { reason: 'check', run: 2, node: 'n_refine', pick: 'revise', head: 'Run 2 · the plan check did not pass', text: 'The plan passes 3 of 8 checks.', findingsLine: '5 checks to fix', options: [
    { value: 'revise', label: 'Re-plan', sub: 'The Planner fixes it', go: 'Re-plan', short: 're-plan', payload: { decision: 'revise', feedback: 'fix', source: 'check' } },
    { value: 'approve', label: 'Approve as is', sub: 'Builds it', go: 'Approve as is', short: 'approved as is', payload: { decision: 'approve' } }] } };
const stopRun = (pendingQuestion = P_STOP) => ({ runId: 'r2', pipelineId: 'p2', title: 'Slice 2', projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z', pendingQuestion });
const smallGroups = (over = {}) => ({ groups: [{ ...D3_GROUPS().groups[0], smallRuns: true, ...over }, GROUPS.groups[1]] });
const shownButtons = (root) => [...root.querySelectorAll('button')].filter((b) => !b.hidden && !b.closest('[hidden], .hidden'));
test('item 6: a stop on the feature page marks its slot; one primary, the bar offers no Re-plan; flag off: dev\'s page', async () => {
  for (const flag of [true, false]) {
    const { ctx } = await d3Boot({ flag, groups: flag ? smallGroups() : D3_GROUPS(), feature: () => json({ ...D3_FEATURE('being built'), open: true, halted: { index: 2, state: 'stopped', waiting: [] } }) });
    ctx.dispatch({ type: 'hello', runs: [stopRun()] });
    ctx.go('feature/feat_1');
    await ctx.settle(12);
    const gp = pageOf(ctx).querySelector('.gpage');
    const slot = gp.querySelector('.gpage-question');
    assert.equal(slot.hidden, false);
    assert.equal('stop' in slot.dataset, flag, `flag ${flag}`);
    assert.equal(slot.querySelectorAll('.ask-mcard-title').length, 1);
    const bar = shownButtons(gp.querySelector('.gpage-actions')).map((b) => b.textContent);
    const primaries = shownButtons(gp).filter((b) => b.classList.contains('btn-primary')).map((b) => b.textContent);
    if (flag) { assert.deepEqual(bar, []); assert.deepEqual(primaries, ['Re-plan']); }
    else assert.ok(bar.length >= 1, 'dev\'s bar keeps its answer');
    gp.querySelector('.gpage-more').dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
    await ctx.settle(6);
    const items = [...ctx.window.document.querySelectorAll('[role^="menuitem"]')].map((x) => x.textContent.trim());
    assert.equal(items.some((x) => /Re-plan the rest/.test(x)), !flag, items.join(' | '));
    if (!flag) continue;
    ctx.dispatch({ type: 'question-resolved', runId: 'r2', id: P_STOP.id });
    await ctx.settle(6);
    assert.equal('stop' in slot.dataset, false, 'released');
  }
});

test('item 6: .qpanel-head is hidden only under a stop on the feature page', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
  assert.deepEqual(css.match(/^.*\.gpage-question.*$/gm).filter((l) => !l.trim().startsWith('/*')), ['div.gpage-question[data-stop] .qpanel-head{display:none;}']);
});

test('item 7: the feature page and the Runs list say the card\'s word for a stop; a shape-feature frame refreshes it; a stale server word never outlives the answer', async () => {
  let slice = { kind: null, state: 'approval', stop: { reason: 'check', held: false } };
  let gets = 0;
  const groups = () => ({ groups: [{ ...D3_GROUPS().groups[0], smallRuns: true, members: [{ ...d3Member(1), slice: { kind: null, state: 'done' } }, { ...d3Member(2), status: 'running', slice }] }, GROUPS.groups[1]] });
  const { ctx } = await d3Boot({ feature: () => json(D3_FEATURE('being built')), extra: (url) => (url.startsWith('/api/run-groups') ? (gets += 1, json(groups())) : null) });
  ctx.dispatch({ type: 'hello', runs: [stopRun()] });
  ctx.go('feature/feat_1');
  await ctx.settle(12);
  const words = () => [...pageOf(ctx).querySelectorAll('.gpage-runs .run-member-state')].map((x) => x.textContent);
  assert.deepEqual(words(), ['done', 'waiting for you']);
  slice = { kind: null, state: 'approval', stop: { reason: 'check', held: true, after: 1 } };
  const before = gets;
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(8);
  assert.ok(gets > before, 'the groups were read again');
  assert.deepEqual(words(), ['done', 'after run 1']);
  // The answer reached the run: this tab's live run asks nothing more, so the server's older word is dropped.
  ctx.dispatch({ type: 'question-resolved', runId: 'r2', id: P_STOP.id });
  await ctx.settle(6);
  assert.notEqual(words()[1], 'after run 1');
  const n = gets;
  ctx.dispatch({ type: 'shape-feature', id: 'feat_other' });
  await ctx.settle(6);
  assert.equal(gets, n, 'another feature\'s frame reads no groups');
});

test('item 8: a small-runs feature\'s head reads Create 2 PRs, disabled with the reason in the page\'s text, then enabled and primary after the mark', async () => {
  const order = [{ index: 1, pipelineId: 'p1', title: 'A', pr: null, onto: null }, { index: 2, pipelineId: 'p2', title: 'B', pr: null, onto: null }];
  let smallRuns = { ...D3_SR('met'), order };
  const { ctx } = await d3Boot({ groups: smallGroups(), feature: () => json({ ...D3_FEATURE('met'), ship: { ...FEATURE.ship, smallRuns } }) });
  ctx.go('feature/feat_1');
  await ctx.settle(10);
  const gp = pageOf(ctx).querySelector('.gpage');
  const cta = () => gp.querySelector('.gpage-card .rd-pr-slot [data-rd-cta]');
  const reason = 'Waiting for Compliance to confirm R-comp-1';
  const tip = () => gp.querySelector('.gpage-card .rd-pr-slot .rd-tip')?.textContent;
  assert.deepEqual([cta().textContent, cta().disabled, cta().title, tip()], ['Create 2 PRs', true, '', reason]);
  assert.ok(gp.querySelector('.gpage-card .run-status').textContent.includes(reason), 'the reason is visible, not only a tooltip');
  smallRuns = { ...smallRuns, waiting: [], blocked: false, reason: null, confirmed: smallRuns.confirmed.map((c) => ({ ...c, state: 'confirmed', mark: 'met' })) };
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(8);
  assert.deepEqual([cta().textContent, cta().disabled, cta().classList.contains('btn-primary')], ['Create 2 PRs', false, true]);
  assert.equal(gp.querySelector('.gpage-card .run-status').textContent.includes(reason), false);
});

test('slice 5: the head\'s Create N PRs counts the new PRs: a listed run with an open PR and newPrs 3 reads Create 3 PRs', async () => {
  const pr = { url: 'https://github.com/me/repo/pull/40', number: 40, state: 'OPEN' };
  const order = [1, 2, 3, 4].map((i) => ({ index: i, pipelineId: `p${i}`, title: `S${i}`, pr: i === 2 ? pr : null, onto: null }));
  const smallRuns = { ...D3_SR('met'), order, newPrs: 3 };
  const { ctx } = await d3Boot({ groups: smallGroups(), feature: () => json({ ...D3_FEATURE('met'), ship: { ...FEATURE.ship, smallRuns } }) });
  ctx.go('feature/feat_1');
  await ctx.settle(10);
  const cta = pageOf(ctx).querySelector('.gpage .gpage-card .rd-pr-slot [data-rd-cta]');
  assert.equal(cta.textContent, 'Create 3 PRs');
});

// ── the Verifier's stop and several stops on the feature page ──
const V_SLICE = (url) => (url === '/api/shape/pipelines/pv/slice' ? json({ verifier: true, featureId: 'feat_1', threadId: null }) : null);
const READY_SR = () => ({ ...D3_SR('met'), confirmed: [], waiting: [], blocked: false, reason: null, order: [{ index: 1, pipelineId: 'p1', title: 'A', pr: null, onto: null }, { index: 2, pipelineId: 'p2', title: 'B', pr: null, onto: null }] });
const notReady = (verify, status = 'active') => ({ ...D3_FEATURE('met'), status, ...(verify ? { verify: { state: verify } } : {}), ship: { ...FEATURE.ship, ready: false, smallRuns: READY_SR() } });
const clickOn = (ctx, n) => n.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));

test('the Verifier\'s question survives schedules-changed and another feature\'s frame: the pick, the panel and the focus stay', async () => {
  const { ctx } = await d3Boot({ groups: smallGroups(), feature: () => json(notReady('asking')), extra: V_SLICE });
  ctx.dispatch({ type: 'hello', runs: [verifierRun] });
  ctx.go('feature/feat_1');
  await ctx.settle(12);
  const slot = pageOf(ctx).querySelector('.gpage-question');
  const primary = () => slot.querySelector('.btn-primary').textContent;
  const tile = [...slot.querySelectorAll('.qopt')].find((t) => t.dataset.value === 'continue');
  clickOn(ctx, tile);
  await ctx.settle(4);
  assert.equal(primary(), 'Accept as is');
  tile.focus();
  for (const frame of [{ type: 'schedules-changed' }, { type: 'shape-feature', id: 'feat_other' }]) {
    ctx.dispatch(frame);
    await ctx.settle(12);
    assert.equal(slot.hidden, false, frame.type);
    assert.equal(primary(), 'Accept as is', frame.type);
    assert.ok(tile.isConnected, `${frame.type}: the same panel`);
    assert.equal(ctx.window.document.activeElement, tile, frame.type);
  }
});

test('a feature that is not ready to ship: one primary, Create N PRs locked with the reason, nowhere "Ready to ship"; ready again unlocks it', async () => {
  let body = notReady('asking');
  const { ctx } = await d3Boot({ groups: smallGroups(), feature: () => json(body), extra: V_SLICE });
  ctx.dispatch({ type: 'hello', runs: [verifierRun] });
  ctx.go('feature/feat_1');
  await ctx.settle(12);
  const gp = pageOf(ctx).querySelector('.gpage');
  const cta = () => gp.querySelector('.gpage-card .rd-pr-slot [data-rd-cta]');
  const status = () => gp.querySelector('.gpage-card .run-status').textContent;
  const primaries = () => shownButtons(gp).filter((b) => b.classList.contains('btn-primary')).map((b) => b.textContent);
  assert.deepEqual(primaries(), ['Fix again']);
  assert.deepEqual([cta().textContent, cta().disabled, cta().title, gp.querySelector('.gpage-card .rd-pr-slot .rd-tip')?.textContent],
    ['Create 2 PRs', true, '', 'The Verifier waits for your answer']);
  assert.match(status(), /The Verifier waits for your answer/);
  assert.doesNotMatch(status(), /Ready to ship/);
  // Still checking: no question, the same lock with its own reason.
  body = notReady('verifying');
  ctx.dispatch({ type: 'question-resolved', runId: 'rv', id: V_STOP.id });
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(10);
  assert.deepEqual([cta().disabled, primaries()], [true, []]);
  assert.match(status(), /The Verifier is checking the feature/);
  // `ready` alone moved: the head repaints.
  body = { ...notReady('clean'), ship: { ...FEATURE.ship, ready: true, smallRuns: READY_SR() } };
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(10);
  assert.deepEqual([cta().disabled, primaries()], [false, ['Create 2 PRs']]);
  assert.match(status(), /Ready to ship/);
});

test('the open, unanswered stop is the page\'s question, whichever member is current; the one on screen stays', async () => {
  const run = (n, pendingQuestion) => ({ runId: `r${n}`, pipelineId: `p${n}`, title: `Slice ${n}`, projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z', ...(pendingQuestion ? { pendingQuestion } : {}) });
  const stopOf = (n) => ({ ...P_STOP, id: `plan-${n}`, stop: { ...P_STOP.stop, run: n, head: `Run ${n} · the plan check did not pass` } });
  const live = (n, held) => ({ ...d3Member(n), status: 'running', slice: { kind: null, state: 'approval', ...(held === undefined ? {} : { stop: { reason: 'check', held, ...(held ? { after: 2 } : {}) } }) } });
  // Run 1 works again, run 2 stops on its own question.
  let members = [live(1), live(2, false)];
  const posts = [];
  const { ctx } = await d3Boot({ feature: () => json(D3_FEATURE('being built')), extra: (url, o) => {
    if (url.startsWith('/api/run-groups')) return json({ groups: [{ ...smallGroups().groups[0], members }, GROUPS.groups[1]] });
    if (url.startsWith('/api/answer')) { posts.push(JSON.parse(o.body)); return json({ ok: true }); }
    return null;
  } });
  ctx.dispatch({ type: 'hello', runs: [run(1), run(2, stopOf(2))] });
  ctx.go('feature/feat_1');
  await ctx.settle(12);
  const slot = pageOf(ctx).querySelector('.gpage-question');
  assert.equal(slot.hidden, false, 'run 2\'s question is on the page');
  assert.ok(slot.textContent.includes('Run 2 · the plan check did not pass'));
  // Run 1 stops too: the question on screen is not swapped under the person.
  ctx.dispatch({ type: 'question', runId: 'r1', ...stopOf(1) });
  await ctx.settle(8);
  assert.ok(slot.textContent.includes('Run 2 · the plan check did not pass'));
  // Run 2's answer is held: run 1's open stop takes the place.
  members = [live(1, false), live(2, true)];
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(12);
  assert.ok(slot.textContent.includes('Run 1 · the plan check did not pass'), slot.textContent);
  assert.equal(slot.querySelectorAll('.qopt').length, P_STOP.stop.options.length, 'a member run\'s stop draws its tiles');
  clickOn(ctx, slot.querySelector('.btn-primary'));
  await ctx.settle(6);
  assert.deepEqual(posts.map((x) => [x.runId, x.id]), [['r1', 'plan-1']]);
});

test('a member current through its PR does not hide the Verifier\'s question', async () => {
  const failing = { number: 7, url: 'https://github.com/a/b/pull/7', state: 'OPEN', checks: { state: 'failing', failed: 1, total: 2 } };
  const groups = smallGroups({ members: [{ ...d3Member(1), pr: failing }, d3Member(2)] });
  const { ctx } = await d3Boot({ groups, feature: () => json(notReady('asking')), extra: V_SLICE });
  ctx.dispatch({ type: 'hello', runs: [verifierRun] });
  ctx.go('feature/feat_1');
  await ctx.settle(12);
  const slot = pageOf(ctx).querySelector('.gpage-question');
  assert.equal(pageOf(ctx).querySelector('.gpage-card .run-status').dataset.state, 'needs-you', 'a member is current through its PR');
  assert.equal(slot.hidden, false);
  assert.ok(slot.textContent.includes('Verifier · 1 gap left'));
});


// ---- Shaper small runs s4 (R-ux-1, R-arch-4): the feature page's Runs tab reads the shared run status ----
const S4_SLICE = (over) => ({ state: 'planned', kind: 'build', buildsOn: [], waitsFor: [], cannotStart: null, nextTurn: false, stop: null, ...over });
const s4Members = () => [
  { ...d3Member(1), status: 'done', slice: S4_SLICE({ state: 'done' }) },
  { ...d3Member(2), pipelineId: 'p2', status: 'running', slice: S4_SLICE({ state: 'approval', buildsOn: [1], stop: { reason: 'requirement', held: false } }) },
  { ...d3Member(3), pipelineId: 'p3', status: 'running', slice: S4_SLICE({ state: 'held', buildsOn: [1], stop: { reason: 'check', held: true, after: 2 } }) },
  { ...d3Member(4), pipelineId: 'p4', status: 'error', slice: S4_SLICE({ state: 'error', buildsOn: [1] }) },
];
const s4Groups = () => ({ groups: [{ ...GROUPS.groups[0], smallRuns: true, members: s4Members() }, GROUPS.groups[1]] });

test('s4: a marked feature with the flag on draws the held ring, "?" and "!" in the Runs tab; with the flag off no row has data-mark', async () => {
  for (const flag of [true, false]) {
    const { ctx } = await d3Boot({ flag, feature: () => json(D3_FEATURE('being built')), groups: s4Groups() });
    ctx.go('feature/feat_1');
    await ctx.settle(10);
    const runs = pageOf(ctx).querySelector('.gpage-runs');
    assert.ok(runs, 'the Runs tab painted');
    if (flag) {
      assert.ok(runs.querySelector('.status-dot.is-dashed-ring'), 'a held answer: the dashed ring');
      assert.ok(runs.querySelector('.status-dot[data-symbol="question"]'));
      assert.ok(runs.querySelector('.status-dot[data-symbol="alert"]'));
      assert.equal(runs.querySelectorAll('.status-dot[data-symbol="question"]').length, 1, 'the held answer shows no "?"');
      assert.equal(runs.querySelector('.run-member[data-key="p3"] .run-member-state').textContent, 'after run 2');
    } else {
      assert.equal(runs.querySelector('[data-mark]'), null);
      assert.equal(runs.querySelector('.is-dashed-ring, .is-ink-ring'), null);
    }
  }
});

// ── Shaper small runs slice 7 (R-po-5): the app hands the marked feature page its state line and need-you count ───────
const s7Sl = (index, state, over = {}) => ({ index, title: `Slice ${index}`, state, pipelineId: state === 'planned' ? null : `p${index}`,
  ticketId: `t${index}`, pr: null, kind: 'build', waitsFor: [], buildsOn: [], nextTurn: false, cannotStart: false, stop: null, ...over });
const s7Stop = (reason) => ({ stop: { reason, held: false } });
const S7_SLICES = [s7Sl(1, 'done'), s7Sl(2, 'approval', s7Stop('requirement')), s7Sl(4, 'questions', s7Stop('check')), s7Sl(5, 'error'),
  s7Sl(6, 'running'), s7Sl(9, 'planned', { nextTurn: true }), s7Sl(11, 'questions', s7Stop('check'))];
const s7Ask = (index, failed = false) => ({ index, runId: failed ? null : `r${index}`, pipelineId: `p${index}`, id: failed ? null : `q${index}`,
  kind: failed ? null : 'gate', reason: failed ? null : 'check', failed, holdsUp: [] });
const S7_ASKS = [s7Ask(2), s7Ask(4), s7Ask(5, true), s7Ask(11)];
const s7Feature = (asks) => ({ ...FEATURE, status: 'active', total: 7, done: 1, slices: S7_SLICES, asks, ask: asks[0] || null,
  ship: { ready: false, mode: null, smallRuns: { owned: [], confirmed: [], waiting: [], blocked: false, reason: null, order: [], care: null } } });
const S7_STATUS = { done: 'done', approval: 'running', questions: 'running', running: 'running', error: 'error', planned: 'scheduled' };
const S7_GROUPS = { groups: [{ ...GROUPS.groups[0], smallRuns: true, members: S7_SLICES.map((sl) => ({ ...member(sl.index), pipelineId: sl.pipelineId,
  ticketId: sl.pipelineId ? null : sl.ticketId, status: S7_STATUS[sl.state], ticket: sl.pipelineId ? null : { status: 'scheduled' }, slice: sl })) }] };
/** Run 6's live frames: a Care plan graph with the code reviewer active, so its word is "reviewing". */
function s7LiveRun6(ctx) {
  const node = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, ports: { inputs: [], outputs: [] } });
  ctx.dispatch({ type: 'hello', runs: [{ runId: 'r6', pipelineId: 'p6', title: 'Slice 6', projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' }] });
  ctx.dispatch({ type: 'state', runId: 'r6', id: 'p6', status: 'running',
    stepper: { version: 2, template: { id: 'wf_shape_slice_req' }, careRun: { position: 'balanced' }, graph: { nodes: [node('n_impl', 'implementer'), node('n_review', 'reviewer')], wires: [] } },
    steps: [{ key: 'x:n_review:1', executionId: 'x:n_review:1', nodeId: 'n_review', ordinal: 1, cycle: 1, status: 'start', startedAt: '2026-01-01T00:00:00Z' }],
    active: [{ nodeId: 'n_review', executionId: 'x:n_review:1' }] });
}

test('s7: the marked feature page shows "Run 6 reviewing · next: run 9" and "4 need you" once; a shape-feature frame alone moves both, and at zero the chip goes', async () => {
  let feature = s7Feature(S7_ASKS);
  let late = null;      // while set, the feature answers only after the run groups did (and repainted the page)
  const { ctx } = await d3Boot({ feature: () => (late ? new Promise((r) => late.push(() => r(json(feature)))) : json(feature)), groups: S7_GROUPS });
  const frame = async () => {
    late = [];
    ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
    await ctx.settle(10);
    assert.ok(late.length, 'the frame refetched the feature');
    const held = late;
    late = null;
    for (const release of held) release();
    await ctx.settle(10);
  };
  s7LiveRun6(ctx);
  await ctx.settle(6);
  ctx.go('feature/feat_1');
  await ctx.settle(10);
  const gp = pageOf(ctx).querySelector('.gpage');
  const detail = () => gp.querySelector('.gpage-card .run-status-detail').textContent;
  const chips = () => [...gp.querySelectorAll('.rd-title-row [data-need]')].map((c) => c.textContent);
  assert.equal(gp.querySelector('.run-member[data-key="p6"] .run-member-state').textContent, 'reviewing', 'the fixture: run 6\'s snapshot is loaded');
  assert.equal(detail(), 'Run 6 reviewing · next: run 9');
  assert.deepEqual(chips(), ['4 need you']);
  assert.equal(gp.textContent.match(/\bneed you/g)?.length, 1);   // no trailing \b: the chip's text runs into the next word
  // Run 4's stop is answered in another view and the turn moves to run 10: only the feature frame says so.
  feature = { ...s7Feature(S7_ASKS.filter((a) => a.index !== 4)), slices: [...S7_SLICES.map((x) => (x.index === 9 ? { ...x, nextTurn: false } : x)), s7Sl(10, 'planned', { nextTurn: true })] };
  await frame();
  assert.equal(detail(), 'Run 6 reviewing · next: run 10');
  assert.deepEqual(chips(), ['3 need you']);
  feature = s7Feature([]);
  await frame();
  assert.equal(gp.querySelector('[data-need]'), null, 'nothing at zero');
});

test('s7 R-arch-9: with the flag off the marked feature page has no count and keeps today\'s line', async () => {
  const { ctx } = await d3Boot({ flag: false, feature: () => json(s7Feature(S7_ASKS)), groups: S7_GROUPS });
  s7LiveRun6(ctx);
  await ctx.settle(6);
  ctx.go('feature/feat_1');
  await ctx.settle(10);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.ok(gp, 'the group page rendered');
  assert.equal(gp.querySelector('[data-need]'), null);
  assert.doesNotMatch(gp.querySelector('.gpage-card .run-status').textContent, /next: run/);
});

// A run held on a clash: the feature page's card, under Requirements (the old overview address opens it), shows the
// reason each shape-feature frame brings.
test('the marked feature page\'s Requirements shows the held reason, and a frame that changes only the reason repaints it', async () => {
  const slices = S7_SLICES.map((x) => (x.index === 9 ? s7Sl(9, 'held', { pipelineId: null }) : x));
  const held = (reason) => ({ ...s7Feature([]), slices, held: { index: 9, ticketId: 't9', ...(reason ? { reason } : {}) } });
  let feature = held(null);
  const { ctx } = await d3Boot({ feature: () => json(feature), groups: S7_GROUPS });
  ctx.go('feature/feat_1/overview');
  await ctx.settle(10);
  const why = () => pageOf(ctx).querySelector('.gpage-panel[data-tab="requirements"] .gpage-overview .shape-feature-held-why')?.textContent;
  assert.equal(why(), 'Run 9 waits for you to start', 'the fixture: the card draws the held row');
  for (const reason of ['runs 2 and 4 clash in src/a.mjs', 'runs 2 and 4 clash in src/b.mjs']) {
    feature = held(reason);
    ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
    await ctx.settle(10);
    assert.equal(why(), `Run 9 is held: ${reason}`);
  }
});

// ── Shaper small runs slice 10 (R-ux-3): the app hands the marked feature page its slices for "Show order" ───────────
const s10Slices = () => SIXTEEN_RUN_LINKS.map(({ run, dependsOn }) => s7Sl(run, 'planned', { buildsOn: [...dependsOn], waitsFor: [...dependsOn] }));
const s10Feature = (marked) => ({ ...FEATURE, status: 'active', total: 16, done: 0, slices: s10Slices(), asks: [], ask: null,
  ship: { ready: false, mode: null, ...(marked ? { smallRuns: D3_SR() } : {}) } });
const s10Groups = (marked) => ({ groups: [{ ...GROUPS.groups[0], ...(marked ? { smallRuns: true } : {}),
  members: s10Slices().map((sl) => ({ ...member(sl.index), pipelineId: null, ticketId: sl.ticketId, status: 'scheduled',
    ticket: { status: 'scheduled' }, ...(marked ? { slice: sl } : {}) })) }, GROUPS.groups[1]] });
/** The 16-run feature page, opened. The Runs layout is the narrow slide, where bare #runs is the list itself (side by
 *  side it reopens this very page) and the page root is kept for the way back. */
async function s10Open({ flag = true, marked = true } = {}) {
  const { ctx, calls } = await d3Boot({ flag, feature: () => json(s10Feature(marked)), groups: s10Groups(marked) });
  ctx.window.document.getElementById('runs-shell').dataset.layout = 'slide';
  ctx.go('feature/feat_1');
  await ctx.settle(10);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.ok(gp, 'the group page rendered');
  assert.equal(gp.querySelectorAll('.gpage-runs .run-member').length, 16, 'the fixture: all 16 runs are on the Runs tab');
  assert.ok(calls.feature >= 1, 'the fixture: the feature view was fetched');
  return { ctx, gp };
}
const s10Toggle = (ctx) => {
  const t = pageOf(ctx).querySelector('.gpage-order-toggle');
  assert.ok(t, 'the Runs tab offers Show order');
  return t;
};
function s10Assert(ctx, open, why) {
  const t = s10Toggle(ctx);
  assert.equal(t.getAttribute('aria-expanded'), String(open), why);
  assert.equal(t.textContent, open ? 'Hide order' : 'Show order', why);
  assert.equal(pageOf(ctx).querySelectorAll('.rom').length, open ? 1 : 0, why);
}
const s10Go = async (ctx, hash) => { ctx.go(hash); await ctx.settle(10); };

test('s10: a marked 16-run feature\'s Runs tab offers Show order, closed', async () => {
  const { ctx } = await s10Open();
  s10Assert(ctx, false, 'first open');
  assert.equal(pageOf(ctx).querySelectorAll('.gpage-order-toggle').length, 1);
  s10Toggle(ctx).click();
  s10Assert(ctx, true, 'after a click');
  assert.equal(pageOf(ctx).querySelectorAll('.rom .rom-run').length, 16);
});

test('s10: flag off → no Show order', async () => {
  const { ctx } = await s10Open({ flag: false });
  assert.equal(pageOf(ctx).querySelector('.gpage-order'), null);
});

test('s10: flag on, unmarked feature → no Show order', async () => {
  const { ctx } = await s10Open({ marked: false });
  assert.equal(pageOf(ctx).querySelector('.gpage-order'), null);
});

test('s10: a tab switch inside the page, and a feature frame, keep it open', async () => {
  const { ctx } = await s10Open();
  s10Toggle(ctx).click();
  await s10Go(ctx, 'feature/feat_1/decisions');
  await s10Go(ctx, 'feature/feat_1');
  s10Assert(ctx, true, 'back on the Runs tab');
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(10);
  s10Assert(ctx, true, 'after a shape-feature frame');
});

test('s10: closed again after #runs and back', async () => {
  const { ctx, gp } = await s10Open();
  s10Toggle(ctx).click();
  s10Assert(ctx, true, 'opened');
  await s10Go(ctx, 'runs');
  assert.equal(ctx.window.location.hash, '#runs', 'the fixture: the Runs list, not this page again');
  await s10Go(ctx, 'feature/feat_1');
  assert.equal(pageOf(ctx).querySelector('.gpage'), gp, 'the fixture: the same page root is kept');
  s10Assert(ctx, false, 'back from #runs');
  s10Toggle(ctx).click();
  s10Assert(ctx, true, 'opened again');
  await s10Go(ctx, 'chat/new');
  await s10Go(ctx, 'feature/feat_1');
  s10Assert(ctx, false, 'back from #chat/new');
});

// ── Shaper small runs slice 8 (R-ux-1): a held or released resume changes only the slice's resume fields ─────────
test('s8: a feature frame that only adds heldResume or resumeAfter to run 6 repaints the feature page rows', async () => {
  const slices = (six = {}) => [s7Sl(1, 'done'), s7Sl(4, 'running'), s7Sl(6, 'paused', six)];
  const view = (six) => ({ ...s7Feature([]), total: 3, done: 1, slices: slices(six) });
  const groups = { groups: [{ ...GROUPS.groups[0], smallRuns: true, members: slices().map((sl) => ({ ...member(sl.index), pipelineId: sl.pipelineId,
    status: sl.state, slice: sl })) }] };
  let feature = view();
  let stall = false;      // once set, the run groups never answer: only the feature fetch can repaint the page
  const { ctx, calls } = await d3Boot({ feature: () => json(feature), groups,
    extra: (url) => (stall && url.startsWith('/api/run-groups') ? new Promise(() => {}) : null) });
  ctx.go('feature/feat_1');
  await ctx.settle(10);
  const title = pageOf(ctx).querySelector('.gpage-title');
  assert.equal(pageOf(ctx).querySelectorAll('.gpage-runs .run-member').length, 3, 'the fixture: the Runs tab painted');
  stall = true;
  // Every paint of the group page writes its title again: count those writes.
  // The callback receives the records the observer delivers (takeRecords alone would miss the delivered ones).
  let writes = 0;
  const observer = new ctx.window.MutationObserver((records) => { writes += records.length; });
  observer.observe(title, { childList: true, characterData: true, subtree: true });
  const frame = async (next) => {
    feature = next;
    const before = calls.feature;
    await ctx.settle(2);
    writes = 0;
    ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
    await ctx.settle(10);
    assert.ok(calls.feature > before, 'the frame refetched the feature');
    return writes + observer.takeRecords().length > 0;
  };
  assert.equal(await frame(view()), false, 'control: the same view repaints nothing');
  assert.equal(await frame(view({ resumeAfter: 4 })), true, 'resumeAfter appears');
  assert.equal(await frame(view({ heldResume: { after: 4 } })), true, 'the resume is held');
  assert.equal(await frame(view({ heldResume: { after: 2 } })), true, 'held behind another run');
  assert.equal(await frame(view()), true, 'the hold is gone');
  observer.disconnect();
});

// ── Shaper small runs slice 11 (R-ux-2): the page's footer Resume says which run it would wait for ───────────────
const S11_STATUS = { ...S7_STATUS, paused: 'paused', stopped: 'stopped' };
/** Six runs. `states[k-1]` is run k's slice state, `over[k]` its extra slice fields; the view halts at run `halted`. */
const s11View = (states, over, halted) => ({ ...s7Feature([]), total: 6, done: states.filter((s) => s === 'done').length,
  halted: { index: halted, state: states[halted - 1], waiting: [] }, slices: states.map((st, i) => s7Sl(i + 1, st, over[i + 1])) });
const s11Groups = (view) => ({ groups: [{ ...GROUPS.groups[0], smallRuns: true, members: view.slices.map((sl) => ({ ...member(sl.index), pipelineId: sl.pipelineId,
  ticketId: sl.pipelineId ? null : sl.ticketId, status: S11_STATUS[sl.state], ticket: sl.pipelineId ? null : { status: 'scheduled' }, slice: sl })) }] });
// The Verifier's state: runs 1–3 done, run 4 paused, run 5 not started, run 6 working.
const S11_PAUSED_FIRST = ['done', 'done', 'done', 'paused', 'planned', 'running'];
/** The feature page on its Overview tab, where the footer and the Shaper view's own controls are both mounted. `show(next)`
 *  delivers a feature frame; the run groups stop answering first, so only the feature fetch can repaint the page. */
async function s11Page(first) {
  let feature = first;
  let stall = false;
  const { ctx, calls } = await d3Boot({ feature: () => json(feature), groups: s11Groups(first),
    extra: (url) => (stall && url.startsWith('/api/run-groups') ? new Promise(() => {}) : null) });
  ctx.go('feature/feat_1/overview');
  await ctx.settle(12);
  const footer = () => [...pageOf(ctx).querySelectorAll('.gpage-actions [data-model-action="resume"]')].filter((b) => !b.hidden);
  const resumes = () => shownButtons(pageOf(ctx).querySelector('.gpage')).filter((b) => /^Resume\b/.test(b.textContent)).map((b) => b.textContent);
  const show = async (next) => {
    stall = true;
    feature = next;
    const before = calls.feature;
    ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
    await ctx.settle(10);
    assert.ok(calls.feature > before, 'the frame refetched the feature');
  };
  return { ctx, footer, resumes, show };
}

test('s11 (R-ux-2): paused run 4 before working run 6: the page shows 1 Resume, in the footer, reading "Resume after run 6"', async () => {
  const { footer, resumes } = await s11Page(s11View(S11_PAUSED_FIRST, { 4: { resumeAfter: 6 } }, 4));
  assert.equal(footer().length, 1, 'the fixture: the footer offers run 4\'s Resume');
  assert.equal(footer()[0].textContent, 'Resume after run 6');
  assert.deepEqual(resumes(), ['Resume after run 6'], 'one Resume on the page, never the view\'s as well');
});

test('s11 (R-ux-2): the focused footer Resume is relabelled in place: plain "Resume" without resumeAfter and once held', async () => {
  const view = (four) => s11View(S11_PAUSED_FIRST, { 4: four }, 4);
  const { ctx, footer, resumes, show } = await s11Page(view({ resumeAfter: 6 }));
  const button = footer()[0];
  assert.equal(button.textContent, 'Resume after run 6');
  button.focus();
  for (const [name, four, label] of [
    ['no resumeAfter', {}, 'Resume'],
    ['the preview is back', { resumeAfter: 6 }, 'Resume after run 6'],
    ['the resume is held', { heldResume: { after: 6 } }, 'Resume'],
  ]) {
    await show(view(four));
    assert.deepEqual(resumes(), [label], name);
    assert.equal(footer()[0], button, `${name}: the same button`);
    assert.equal(ctx.window.document.activeElement, button, `${name}: it keeps the focus`);
  }
});

test('s11 (R-ux-2): the label is the one of the run the footer resumes, not of the run the view halts at', async () => {
  // Run 3 stopped halts the view; the footer's Resume acts on paused run 4.
  const states = ['done', 'done', 'stopped', 'paused', 'planned', 'running'];
  const { footer, resumes } = await s11Page(s11View(states, { 4: { resumeAfter: 6 } }, 3));
  assert.equal(footer().length, 1, 'the fixture: the footer offers run 4\'s Resume');
  assert.deepEqual(resumes(), ['Resume after run 6']);
});

test('R-ux-2 example: on run 6, the control reads that it resumes after run 4 (run 4 working: no footer Resume, 1 Resume on the page)', async () => {
  const states = ['done', 'done', 'done', 'running', 'planned', 'paused'];
  const { footer, resumes } = await s11Page(s11View(states, { 6: { resumeAfter: 4 } }, 6));
  assert.deepEqual(footer().map((b) => b.textContent), []);
  assert.deepEqual(resumes(), ['Resume after run 4']);
});

// ── Feature page slice 6 (R-ux-3, R-arch-2): Runs · Requirements · Decisions · Cost · Log, Mark and ship ──────────
const S6_TABS = ['Runs', 'Requirements', 'Decisions', 'Cost', 'Log'];
const S6_RUNS = (n) => Array.from({ length: n }, (_, i) => i + 1);
const s6Log = () => [{ key: 'outline', run: null, text: 'Split into 6 runs', detail: [] }, { key: 'r1-plan', run: 1, text: 'Plan approved', detail: [] }];
/** The small-runs ledger of a ready feature: one confirmed requirement, waiting for its mark unless `state` says so. */
const s6Ledger = (n, state = 'waiting') => {
  const base = D3_SR('met');
  const done = state === 'confirmed';
  return { ...base,
    confirmed: [{ ...base.confirmed[0], state, mark: done ? 'met' : null,
      shown: { ...base.confirmed[0].shown, word: done ? 'met' : 'Compliance', text: `confirmed by a person · ${done ? 'met' : 'Compliance'}`, mark: done ? 'check' : 'wait' } }],
    waiting: done ? [] : ['R-comp-1'], blocked: !done, reason: done ? null : 'Waiting for Compliance to confirm R-comp-1',
    order: S6_RUNS(n).map((i) => ({ index: i, pipelineId: `p${i}`, title: `Slice ${i}`, pr: null, onto: null })) };
};
const s6Feature = ({ n = 6, state = 'waiting', ship = {}, log = s6Log(), over = {} } = {}) => ({ ...D3_FEATURE('met'), status: 'done', total: n, done: n, log,
  slices: S6_RUNS(n).map((i) => ({ index: i, title: `Slice ${i}`, state: 'done', pipelineId: `p${i}`, pr: null })),
  ship: { ...FEATURE.ship, ready: true, mode: null, smallRuns: s6Ledger(n, state), ...ship }, ...over });
/** `n` runs at $2 plus the Verifier rounds `checks` ([pipelineId, round, usd, status]), as /api/run-groups sends them. */
const s6Cost = (n, checks) => ({
  usd: n * 2 + checks.reduce((a, c) => a + c[2], 0),
  byPipeline: Object.fromEntries([...S6_RUNS(n).map((i) => [`p${i}`, 2]), ...checks.map(([id, , usd]) => [id, usd])]),
  checks: Object.fromEntries(checks.map(([id, round, , status], i) => [id, { round, at: `2026-10-18T0${i + 1}:00:00Z`, status }])),
});
const S6_CHECKS = [['pv1', 1, 1, 'done'], ['pv2', 2, 0.5, 'done']];
const s6Groups = (n = 6, cost = s6Cost(n, S6_CHECKS)) => ({ groups: [{ ...GROUPS.groups[0], smallRuns: true, members: S6_RUNS(n).map(d3Member), cost }, GROUPS.groups[1]] });
const s6History = (n) => S6_RUNS(n).map((i) => ({ id: `p${i}`, projectKey: 'acme', title: `Slice ${i}`, status: 'done', mtime: Date.now() }));

async function s6Open({ n = 6, feature = () => json(s6Feature({ n })), groups = s6Groups(n), hash = 'feature/feat_1', flag = true, level = '' } = {}) {
  const { ctx, calls } = await d3Boot({ flag, groups, feature,
    extra: (url) => (url.startsWith('/api/history') ? json({ pipelines: s6History(n) }) : null) });
  const doc = ctx.window.document;
  if (level) { doc.documentElement.dataset.level = level; doc.dispatchEvent(new ctx.window.Event('worca:level')); }
  const scrolls = [];
  ctx.window.Element.prototype.scrollIntoView = function (arg) { scrolls.push({ node: this, arg }); };
  ctx.go(hash);
  await ctx.settle(12);
  const gp = () => pageOf(ctx).querySelector('.gpage');
  const q = (sel) => pageOf(ctx).querySelector(sel);
  const go = async (to) => { ctx.go(to); await ctx.settle(10); };
  return { ctx, calls, doc, scrolls, gp, q, go };
}
const s6Shown = (gp) => [...gp.querySelectorAll('.gpage-tabs .rd-tab')].filter((t) => !t.hidden).map((t) => t.textContent);
const s6Selected = (gp) => gp.querySelector('.rd-tab[aria-selected="true"]').dataset.tab;
const s6CostRows = (p) => [...p.gp().querySelectorAll('.gpage-panel[data-tab="cost"] .gpage-cost tbody tr')]
  .map((r) => [r.querySelector('td[data-label="Run"]').textContent, r.querySelector('td[data-label="Cost"]').textContent]);
const s6Foot = (p) => p.q('.gpage-panel[data-tab="cost"] .gpage-cost tfoot')?.textContent;
const s6Card = (p) => p.q('.gpage-panel[data-tab="requirements"] [data-ship-card]');
const s6Button = (p) => p.q('.gpage-bar .gpage-markship');
const s6Lines = (p) => [...p.gp().querySelectorAll('.gpage-panel[data-tab="logs"] ol.shape-feature-log .chat-rc-log-text')].map((x) => x.textContent);

test('R-ux-3 example: a feature with an open mark shows the five tabs and "Mark and ship"; the button opens Requirements at the Ship card; Cost lists 6 runs plus 2 Verifier rounds and a total equal to their sum; Log holds today\'s log lines and the step log', async () => {
  const p = await s6Open();
  assert.deepEqual(s6Shown(p.gp()), S6_TABS);
  assert.equal(s6Button(p)?.textContent, 'Mark and ship');
  await p.go('feature/feat_1/cost');
  assert.equal(s6Selected(p.gp()), 'cost');
  const rows = s6CostRows(p);
  assert.equal(rows.length, 8, JSON.stringify(rows));
  rows.slice(0, 6).forEach(([run], i) => assert.match(run, new RegExp(`${i + 1}.*Slice ${i + 1}`)));
  assert.deepEqual(rows.slice(6), [['Verifier · round 1', '$1.00'], ['Verifier · round 2', '$0.50']]);
  const sum = rows.reduce((a, [, cost]) => a + Number(cost.slice(1)), 0);
  assert.equal(sum, 13.5);
  assert.match(s6Foot(p), /Total\s*\$13\.50/);
  await p.go('feature/feat_1/logs');
  assert.equal(s6Selected(p.gp()), 'logs');
  const logs = p.q('.gpage-panel[data-tab="logs"]');
  assert.equal(logs.querySelector('ul.gpage-logs').hidden, false);
  assert.deepEqual([...logs.querySelectorAll('ul.gpage-logs a')].map((a) => a.textContent), Array(6).fill('Open logs'));
  assert.equal(logs.querySelector('h2.section-title')?.textContent, 'Step log');
  const list = logs.querySelector('ol.chat-rc-log.shape-feature-log');
  assert.equal(list.getAttribute('aria-label'), 'Steps');
  assert.deepEqual(s6Lines(p), ['Split into 6 runs', 'Plan approved']);
  assert.ok(logs.querySelector('ul.gpage-logs').compareDocumentPosition(list) & p.ctx.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await p.go('feature/feat_1');
  s6Button(p).click();
  await p.ctx.settle(12);
  assert.equal(p.ctx.window.location.hash, '#feature/feat_1/requirements');
  assert.equal(s6Selected(p.gp()), 'requirements');
  assert.ok(s6Card(p), 'the Ship card is in Requirements');
  assert.equal(p.doc.activeElement, s6Card(p));
});

test('R-arch-2 example: 5 runs at $2, a Verifier round at $1 and a failed round at $0.50 read $11.50 on the Cost tab, the Total cost fact and the group row', async () => {
  const cost = s6Cost(5, [['pvfail', 1, 0.5, 'error'], ['pvdone', 1, 1, 'done']]);
  const p = await s6Open({ n: 5, groups: s6Groups(5, cost), hash: 'feature/feat_1/cost' });
  assert.equal(s6Selected(p.gp()), 'cost');
  assert.match(s6Foot(p), /Total\s*\$11\.50/);
  const rows = s6CostRows(p);
  assert.equal(rows.length, 7, 'each pipeline once');
  assert.deepEqual(rows.slice(5), [['Verifier · round 1 · failed', '$0.50'], ['Verifier · round 1', '$1.00']]);
  assert.equal(p.q('.gpage-card .rd-kv-row[data-fact="cost"] .rd-kv-v').textContent, '$11.50');
  assert.equal(p.doc.querySelector('.runs-item[data-row-key="chain:feat_1"] > a.runs-row .runs-cost')?.textContent, '$11.50');
});

test('R-ux-3: Mark and ship opens Requirements with the Ship card first, scrolled into view and focused; a second click on Requirements does it again', async () => {
  const p = await s6Open();
  const b = s6Button(p);
  assert.ok(b, 'Mark and ship shows with an open mark');
  assert.ok(b.classList.contains('btn-primary'));
  b.click();
  await p.ctx.settle(12);
  assert.equal(p.ctx.window.location.hash, '#feature/feat_1/requirements');
  const card = s6Card(p);
  assert.ok(card);
  assert.equal(card.closest('[hidden]'), null, 'on screen');
  assert.equal(card.getAttribute('tabindex'), '-1');
  assert.equal(p.doc.activeElement, card);
  assert.deepEqual(p.scrolls.filter((x) => x.node === card).map((x) => x.arg), [{ block: 'start' }]);
  const panel = p.q('.gpage-panel[data-tab="requirements"]');
  assert.equal(panel.firstElementChild, p.q('.gpage-overview'));
  assert.equal(panel.firstElementChild.querySelector('.shape-feature').firstElementChild, card, 'the Ship card is the panel\'s first element');
  assert.ok(card.compareDocumentPosition(panel.querySelector('.shape-feature-reqs')) & p.ctx.window.Node.DOCUMENT_POSITION_FOLLOWING, 'above the requirement folds');
  assert.equal(panel.querySelector('ol.shape-feature-log'), null, 'the step log moved to Log');
  // Already on Requirements: the hash stays and the card takes the focus again.
  s6Button(p).focus();
  s6Button(p).click();
  await p.ctx.settle(12);
  assert.equal(p.ctx.window.location.hash, '#feature/feat_1/requirements');
  assert.equal(p.doc.activeElement, s6Card(p));
  assert.equal(p.scrolls.filter((x) => x.node === s6Card(p)).length, 2);
});

test('R-ux-3: the header keeps what it has today beside Mark and ship', async () => {
  const p = await s6Open();
  const b = s6Button(p);
  assert.ok(b);
  assert.equal(b.nextElementSibling, p.q('.gpage-bar > .gpage-actions'));
  for (const kept of ['.gpage-back', '.rd-crumbs', '.gpage-stop', '.gpage-more']) assert.ok(p.q(`.gpage-bar > ${kept}`), kept);
  assert.equal(p.q('.gpage-more').hidden, false);
  assert.match(p.q('.gpage-card .rd-pr-slot [data-rd-cta]').textContent, /^Create 6 PRs/);
  assert.deepEqual([...p.gp().querySelectorAll('.gpage-card > .rd-kv > .rd-kv-row:not([hidden]) .rd-kv-k')].map((x) => x.textContent).filter((x) => x !== 'Project'),
    ['Runs', 'Total cost']);
});

test('R-ux-3: no open mark, no Mark and ship: every mark made, the Verifier not passed, or already shipped', async () => {
  const cases = {
    'every mark made': s6Feature({ state: 'confirmed' }),
    'the Verifier has gaps': s6Feature({ ship: { ready: false }, over: { status: 'active', verify: { state: 'gaps' } } }),
    'already shipped': s6Feature({ ship: { ready: false, mode: 'stacked' } }),
  };
  for (const [name, body] of Object.entries(cases)) {
    const p = await s6Open({ feature: () => json(body) });
    for (const tab of ['', '/requirements', '/cost']) {
      await p.go(`feature/feat_1${tab}`);
      assert.deepEqual(s6Shown(p.gp()), S6_TABS, name);
      assert.equal(p.q('.gpage-markship'), null, `${name} ${tab}`);
    }
  }
});

test('R-ux-3: Mark and ship goes with the last mark, and a focused button hands the focus to the selected tab', async () => {
  let state = 'waiting';
  const p = await s6Open({ feature: () => json(s6Feature({ state })) });
  assert.ok(s6Button(p));
  s6Button(p).focus();
  state = 'confirmed';
  p.ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await p.ctx.settle(12);
  assert.equal(p.q('.gpage-markship'), null);
  assert.equal(p.doc.activeElement, p.q('.rd-tab[data-tab="runs"]'));
});

test('R-ux-3: Simple and Advanced show the same five tabs; Log holds the step log and no Open logs row', async () => {
  for (const level of ['simple', 'advanced']) {
    const p = await s6Open({ level, hash: 'feature/feat_1/logs' });
    assert.deepEqual(s6Shown(p.gp()), S6_TABS, level);
    assert.equal(s6Selected(p.gp()), 'logs', level);
    assert.ok(s6Button(p), `${level}: Mark and ship`);
    assert.equal(p.q('.gpage-panel[data-tab="logs"] ul.gpage-logs').hidden, true, level);
    assert.deepEqual(s6Lines(p), ['Split into 6 runs', 'Plan approved'], level);
  }
});

test('R-ux-3: with no step lines Log says "No steps yet."; a feature frame brings the list and later lines', async () => {
  let log = [];
  const p = await s6Open({ feature: () => json(s6Feature({ log })), hash: 'feature/feat_1/logs' });
  const logs = () => p.q('.gpage-panel[data-tab="logs"]');
  const empty = () => [...logs().querySelectorAll('p.muted')].map((x) => x.textContent);
  assert.deepEqual(empty(), ['No steps yet.']);
  assert.equal(logs().querySelector('ol.shape-feature-log'), null);
  assert.doesNotMatch(logs().textContent, /Step log/);
  for (const next of [s6Log().slice(0, 1), s6Log()]) {
    log = next;
    p.ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
    await p.ctx.settle(12);
    assert.deepEqual(s6Lines(p), next.map((l) => l.text));
    assert.deepEqual(empty(), []);
    assert.equal(logs().querySelector('h2.section-title').textContent, 'Step log');
    assert.equal(logs().querySelectorAll('ol.shape-feature-log').length, 1);
  }
});

test('R-ux-3: the old #feature/ID/overview address opens Requirements with the Ship card', async () => {
  const p = await s6Open({ hash: 'feature/feat_1/overview' });
  assert.equal(s6Selected(p.gp()), 'requirements');
  assert.equal(p.gp().querySelector('.rd-tab[data-tab="overview"]'), null);
  assert.ok(s6Card(p));
});

test('R-ux-3: a cost, logs or overview deep link shows Loading group… until the feature resolves', async () => {
  for (const [hash, tab] of [['cost', 'cost'], ['logs', 'logs'], ['overview', 'requirements']]) {
    const held = [];
    const { ctx } = await d3Boot({ groups: s6Groups(), feature: () => new Promise((r) => { held.push(() => r(new Response(JSON.stringify(s6Feature()), { status: 200, headers: { 'content-type': 'application/json' } }))); }) });
    ctx.go(`feature/feat_1/${hash}`);
    await ctx.settle(4);
    ctx.dispatch({ type: 'run-groups-changed' });
    await ctx.settle(8);
    assert.equal(pageOf(ctx).querySelector('.gpage'), null, `${hash}: no Runs flash`);
    assert.equal(pageOf(ctx).querySelector('.feature-page-loading').textContent, 'Loading group…', hash);
    for (const release of held.splice(0)) release();
    await ctx.settle(10);
    assert.equal(s6Selected(pageOf(ctx).querySelector('.gpage')), tab, hash);
  }
});

test('R-ux-3: Runs, then Requirements, then Log fetch the feature once; Requirements paints from the page\'s view with no loading line; another host still fetches', async () => {
  // Every fetch after the first never answers: what Requirements and Log show can only come from the stored view.
  const p = await s6Open({ feature: (n) => (n === 1 ? json(s6Feature()) : new Promise(() => {})) });
  await p.go('feature/feat_1/requirements');
  assert.ok(s6Card(p), 'painted with no second fetch');
  assert.equal(p.gp().querySelector('.feature-page-loading'), null);
  assert.equal(p.calls.feature, 1);
  await p.go('feature/feat_1/logs');
  assert.deepEqual(s6Lines(p), ['Split into 6 runs', 'Plan approved']);
  assert.equal(p.calls.feature, 1);
  const plans = p.doc.createElement('div');
  p.doc.body.appendChild(plans);
  p.ctx.window.__shapeFeature.mount(plans, 'feat_1');
  await p.ctx.settle(5);
  assert.equal(p.calls.feature, 2, 'the Plans tab and Chat hosts fetch as today');
});

test('R-ux-3: the flag turned off on the open page brings back Overview and Logs at the next feature frame', async () => {
  const p = await s6Open({ hash: 'feature/feat_1/requirements' });
  assert.deepEqual(s6Shown(p.gp()), S6_TABS);
  const overview = p.q('.gpage-overview');
  const { applyFlags } = await import('../ui/public/flags.mjs');
  applyFlags({ shaperSmallRuns: false }, p.doc);
  p.ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await p.ctx.settle(12);
  assert.deepEqual(s6Shown(p.gp()), ['Runs', 'Overview', 'Decisions', 'Logs']);
  assert.equal(p.q('.gpage-markship, .gpage-cost, .gpage-steplog'), null);
  assert.equal(p.q('.gpage-panel[data-tab="overview"] .gpage-overview'), overview, 'the same node');
});

// R-qa-1: with the flag off, a small-runs feature's page keeps the tabs, fetches and loading lines of checkpoint 217b540b4.
test('R-ux-3 flag off: a small-runs feature with an open mark keeps Runs, Overview, Decisions, Logs and no Mark and ship', async () => {
  const p = await s6Open({ flag: false });
  assert.deepEqual(s6Shown(p.gp()), ['Runs', 'Overview', 'Decisions', 'Logs']);
  for (const tab of ['overview', 'logs', 'cost']) {
    await p.go(`feature/feat_1/${tab}`);
    assert.equal(s6Selected(p.gp()), tab === 'cost' ? 'runs' : tab);
    assert.equal(p.q('.gpage-markship, .gpage-cost, .gpage-steplog, .rd-tab[data-tab="cost"]'), null, tab);
  }
});

test('R-ux-3 flag off: an overview deep link fetches the feature twice and says "Loading feature…" while the card loads', async () => {
  const p = await s6Open({ flag: false, hash: 'feature/feat_1/overview', feature: (n) => (n === 1 ? json(s6Feature()) : new Promise(() => {})) });
  assert.equal(p.calls.feature, 2);
  assert.equal(p.q('.gpage-panel[data-tab="overview"] .gpage-overview .feature-page-loading')?.textContent, 'Loading feature…');
});

test('R-ux-3 flag off: a cost, logs or overview deep link paints the page while the feature is still loading', async () => {
  for (const hash of ['cost', 'logs', 'overview']) {
    const { ctx } = await d3Boot({ flag: false, groups: s6Groups(), feature: () => new Promise(() => {}) });
    ctx.go(`feature/feat_1/${hash}`);
    await ctx.settle(4);
    ctx.dispatch({ type: 'run-groups-changed' });
    await ctx.settle(8);
    const gp = pageOf(ctx).querySelector('.gpage');
    assert.ok(gp, `${hash}: no loading hold`);
    assert.equal(s6Selected(gp), hash === 'cost' ? 'runs' : hash);
  }
});

// ── Slice 7 (R-ux-1, R-arch-4): confirm in place ─────────────────────────────────────────────────────────────────
const S7C_HOLD = 'Needs your confirmation: R-ux-2';
const S7C_REASON = 'Waiting for you to confirm R-ux-2';
const S7C_HREF = '#feature/feat_1/requirements/ship';
/** s6Feature with R-ux-2 (Design) as the one requirement a person confirms, waiting for its mark: what the server
 *  sends for a ready marked feature with the flag on. */
const s7cFeature = ({ n = 6, over = {} } = {}) => {
  const base = s6Ledger(n, 'waiting');
  const smallRuns = { ...base, waiting: ['R-ux-2'], reason: S7C_REASON,
    confirmed: [{ ...base.confirmed[0], id: 'R-ux-2', text: 'The words say who confirms', role: 'design', roleLabel: 'Design',
      shown: { owner: 'confirmed by a person', role: 'Design', word: 'waiting for you to confirm', text: 'waiting for you to confirm · Design', mark: 'wait' } }] };
  return s6Feature({ n, ship: { smallRuns }, over: { requirementKinds: [{ id: 'R-po-1', kind: 'owned', run: 1 }, { id: 'R-po-2', kind: 'owned', run: 2 },
    { id: 'R-ux-2', kind: 'confirmed', role: 'design' }], hasChat: true, ...over } });
};
const s7cGroups = (n = 6, over = {}) => { const g = s6Groups(n); return { groups: [{ ...g.groups[0], hold: S7C_HOLD, ...over }, g.groups[1]] }; };
const s7cOpen = (opts = {}) => s6Open({ feature: () => json(s7cFeature()), groups: s7cGroups(), ...opts });
const s7cLink = (p) => p.q('.gpage-card .run-status a.run-status-link');
const s7cRow = (p) => p.doc.querySelector('.runs-item[data-row-key="chain:feat_1"] > a.runs-row');

test('s7 R-ux-1: a waiting confirmation reads Needs your confirmation and nowhere Ready to ship', async () => {
  const p = await s7cOpen();
  const link = s7cLink(p);
  assert.ok(link, 'the head\'s reason is a link');
  assert.equal(link.textContent, S7C_HOLD);
  assert.ok(p.q('.gpage-card .run-status .run-status-head .status-dot').classList.contains('is-amber'), 'the needs-you tone');
  assert.equal(p.q('.gpage-card .run-status .status-sym'), null, 'no "?": nothing asks');
  assert.doesNotMatch(p.gp().textContent, /Ready to ship/);
  const row = s7cRow(p);
  assert.ok(row, 'the Runs list lists the group');
  assert.ok(row.textContent.includes(S7C_HOLD), row.textContent);
  assert.doesNotMatch(row.textContent, /Ready to ship/);
  await p.go('feature/feat_1/requirements');
  assert.doesNotMatch(p.gp().textContent, /Ready to ship/);
  assert.equal(reqNote(p.ctx, 'R-ux-2'), 'waiting for you to confirm · Design');
});

test('s7 R-ux-1: the reason links to the Ship card on Requirements', async () => {
  const p = await s7cOpen();
  assert.equal(s6Selected(p.gp()), 'runs');
  const link = s7cLink(p);
  assert.ok(link);
  assert.equal(link.getAttribute('href'), S7C_HREF);
  link.click();
  await p.ctx.settle(12);
  assert.equal(s6Selected(p.gp()), 'requirements');
  const card = s6Card(p);
  assert.ok(card, 'the Ship card is in Requirements');
  const scrolled = () => p.scrolls.filter((x) => x.node.matches('[data-ship-card]')).map((x) => x.arg);
  assert.deepEqual(scrolled(), [{ block: 'start' }]);
  assert.equal(p.doc.activeElement, card);
  assert.equal(p.ctx.window.location.hash, '#feature/feat_1/requirements', 'the address drops /ship once revealed');
  await p.go('feature/feat_1/requirements/ship');
  assert.equal(scrolled().length, 2, 'the same address again reveals it again');
  assert.equal(p.ctx.window.location.hash, '#feature/feat_1/requirements');
});

test('s7: only /requirements/ship reveals the Ship card from an address; any other third segment is ignored', async () => {
  const p = await s7cOpen({ hash: 'feature/feat_1/requirements/zzz' });
  assert.equal(s6Selected(p.gp()), 'requirements');
  assert.equal(p.scrolls.filter((x) => x.node.matches('[data-ship-card]')).length, 0);
  await p.go('feature/feat_1/requirements/ship');
  assert.equal(p.scrolls.filter((x) => x.node.matches('[data-ship-card]')).length, 1, 'and /ship does');
});

test('s7: a /requirements/ship deep link reveals the Ship card once the feature has loaded', async () => {
  const p = await s7cOpen({ hash: 'feature/feat_1/requirements/ship' });
  assert.equal(s6Selected(p.gp()), 'requirements');
  assert.equal(p.doc.activeElement, s6Card(p));
  assert.equal(p.ctx.window.location.hash, '#feature/feat_1/requirements');
});

test('s7: following the reason link sends no request', async () => {
  const p = await s7cOpen();
  const link = s7cLink(p);
  assert.ok(link);
  const sent = p.ctx.calls.length;
  link.click();
  await p.ctx.settle(12);
  assert.equal(s6Selected(p.gp()), 'requirements');
  // Every navigation re-reads the sidebar's counts (GET /api/counts); following the link adds nothing else.
  assert.deepEqual(p.ctx.calls.slice(sent).map((c) => `${c.opts.method || 'GET'} ${c.url}`).filter((c) => c !== 'GET /api/counts'), []);
});

test('s7 R-ux-1: the disabled Create N PRs has a styled tip, no native title, and none once the mark lands', async () => {
  let body = s7cFeature();
  let groups = s7cGroups();
  const { ctx } = await d3Boot({ groups: smallGroups(), feature: () => json(body), extra: (url) => (url.startsWith('/api/run-groups') ? json(groups)
    : url.startsWith('/api/history') ? json({ pipelines: s6History(6) }) : null) });
  ctx.go('feature/feat_1');
  await ctx.settle(12);
  const gp = pageOf(ctx).querySelector('.gpage');
  const cta = () => gp.querySelector('.gpage-card .rd-pr-slot > [data-rd-cta]');
  assert.ok(cta(), 'the locked control stays a direct child of the PR slot');
  assert.equal(cta().disabled, true);
  assert.equal(cta().getAttribute('title'), null);
  const tips = () => gp.querySelectorAll('.rd-tip');
  assert.equal(tips().length, 1);
  const [tip] = tips();
  assert.equal(tip.parentElement, cta().parentElement);
  assert.equal(tip.getAttribute('role'), 'tooltip');
  assert.equal(tip.textContent, S7C_REASON);
  assert.ok(tip.id);
  assert.equal(cta().getAttribute('aria-describedby'), tip.id);
  const status = gp.querySelector('.gpage-card .run-status');
  for (const n of [status, status.querySelector('.run-status-detail'), status.querySelector('a.run-status-link')]) {
    assert.ok(n, 'the reason line');
    assert.equal(n.getAttribute('title'), null);
  }
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(10);
  assert.equal(tips().length, 1, 'a repaint adds no second tip');
  const base = s7cFeature();
  body = { ...base, ship: { ...base.ship, smallRuns: { ...base.ship.smallRuns, waiting: [], blocked: false, reason: null,
    confirmed: base.ship.smallRuns.confirmed.map((c) => ({ ...c, state: 'confirmed', mark: 'met' })) } } };
  groups = { groups: [s6Groups(6).groups[0], GROUPS.groups[1]] };
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  ctx.dispatch({ type: 'run-groups-changed' });
  await ctx.settle(12);
  assert.equal(cta().disabled, false);
  assert.equal(tips().length, 0);
  assert.equal(cta().getAttribute('aria-describedby'), null);
  assert.equal(gp.querySelector('a.run-status-link'), null, 'the link goes with the hold');
  assert.match(gp.querySelector('.gpage-card .run-status').textContent, /Ready to ship/);
});

/** Opens a 3-run feature page whose run 3 is live: History has runs 1 and 2, the hello carries run 3. */
async function s7cLive(body, groups) {
  const p = await s6Open({ n: 2, feature: () => json(body), groups });
  p.ctx.dispatch({ type: 'hello', runs: [{ runId: 'r3', pipelineId: 'p3', title: 'Slice 3', projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' }] });
  p.ctx.dispatch({ type: 'run-groups-changed' });
  await p.ctx.settle(12);
  return p;
}
const s7cMembers = () => [1, 2, 3].map((i) => ({ ...d3Member(i), status: i === 3 ? 'running' : 'done' }));
const s7cRunning = (over = {}) => {
  const base = s7cFeature({ n: 3 });
  return { ...base, status: 'active', done: 2, slices: base.slices.map((s) => (s.index === 3 ? { ...s, state: 'running' } : s)),
    ship: { ...base.ship, ready: false }, ...over };
};

test('s7: a live run keeps its own words while a confirmation waits', async () => {
  const p = await s7cLive(s7cRunning(), s7cGroups(3, { members: s7cMembers() }));
  assert.equal(s7cLink(p), null);
  assert.doesNotMatch(p.q('.gpage-card .run-status').textContent, /Needs your confirmation/);
});

test('s7 R-arch-4: a chat-less feature\'s card pointers open its feature page', async () => {
  const groups = { groups: [{ ...s6Groups(3).groups[0], members: s7cMembers() }, GROUPS.groups[1]] };
  for (const [hasChat, tail] of [[true, 'here and in the chat.'], [false, 'on this page.']]) {
    const p = await s7cLive(s7cRunning({ hasChat }), groups);
    const line = `Ship card comes when all 3 runs are done, ${tail}`;
    assert.equal(p.q('.gpage-ship').textContent, line, `hasChat ${hasChat}: the Runs tab's ship line`);
    await p.go('feature/feat_1/requirements');
    assert.equal(p.q('.gpage-panel[data-tab="requirements"] [data-ship-card="waiting"]')?.textContent, line, `hasChat ${hasChat}: the waiting Ship card`);
    if (!hasChat) {
      assert.doesNotMatch(p.gp().textContent, /here and in the chat/);
      const pointers = [...p.gp().querySelectorAll('a[href]')].filter((a) => /\bcard\b|feature page/i.test(a.textContent));
      for (const a of pointers) assert.ok(a.getAttribute('href').startsWith('#feature/feat_1'), a.outerHTML);
    }
  }
});
