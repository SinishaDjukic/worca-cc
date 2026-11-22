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

test('D1: a small-runs feature\'s header follows the small-runs ledger (run-owned ids never lock it) and offers no One', async () => {
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
  assert.doesNotMatch(modal.querySelector('.shipit-prs-hint').textContent, /one PR is easier/, 'the hint never suggests the disabled One');
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

test('D3: a marked feature with the flag on shows Runs, Requirements, Overview, Decisions; #feature/ID/requirements selects Requirements (aria-selected=true); Decisions paints the feature log; Runs lists the planning run as run 1', async () => {
  const { ctx } = await d3Boot({ feature: () => json(D3_FEATURE('being built')) });
  ctx.go('feature/feat_1/requirements');
  await ctx.settle(10);
  const gp = pageOf(ctx).querySelector('.gpage');
  assert.deepEqual([...gp.querySelectorAll('.gpage-tabs .rd-tab')].map((t) => t.textContent), ['Runs', 'Requirements', 'Overview', 'Decisions', 'Logs']);
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
