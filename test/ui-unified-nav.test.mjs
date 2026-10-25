// test/ui-unified-nav.test.mjs — the unified page head in the real app (docs/design-system.md Navigation): the top bar's
// breadcrumb, one tab strip with its tab in the address, the old addresses as redirects, going up, focus, and the Chat
// run panel left as it was. The in-process twin of tools/verify-feature-page-cdp.mjs (which checks the layout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, settle, KEY, ROW, TABS_DETAIL, RESULTS, detailHash, fail } from './helpers/history-detail-boot.mjs';
import { bootChat, liveRun, hello, openPanel, click as panelClick } from './helpers/chat-panel-boot.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { ROUTES, tabKey, engineTab } from '../ui/public/nav/routes.mjs';

const json = (b, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }));
const trail = (doc) => [...doc.querySelectorAll('#topnav-crumbs .nav-trail a')].map((a) => a.textContent);
const rdTab = (doc, sec) => doc.querySelector(`#run-detail .rd-tab[data-sec="${sec}"]`);
const selected = (doc, host) => doc.querySelector(`${host} .ph-tabs [role="tab"][aria-selected="true"]`)?.dataset.sec;
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
const setLevel = (doc, lv) => { doc.documentElement.dataset.level = lv; doc.dispatchEvent(new doc.defaultView.Event('worca:level')); };

// A live git run, open on its page. `extra` seeds the hello row.
async function live(hash = 'running/r1', extra = {}, opts = {}) {
  const ctx = await bootApp(opts);
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', projectDir: '/tmp/p', ...extra });
  ctx.go(hash);
  await ctx.settle(6);
  return { ctx, doc: ctx.window.document, w: ctx.window };
}

test('#running/r1: the trail is Runs, the head holds the title row, the bar and Summary first; no Details mode', async () => {
  const { doc } = await live();
  assert.deepEqual(trail(doc), ['Runs']);
  assert.equal(doc.getElementById('topnav-title').hidden, true, 'the section name shows once');
  const rd = doc.querySelector('#run-detail .rd');
  const first = rd.querySelector('.ph-tabs [role="tab"]');
  assert.equal(first.dataset.sec, 'overview');
  assert.match(first.textContent, /Summary/);
  assert.equal(first.getAttribute('aria-selected'), 'true');
  assert.ok(rd.querySelector('.ph .rd-title-row .rd-page-title'));
  assert.ok(rd.querySelector('.ph-actions > .rd-bar'));
  assert.equal(rd.dataset.presentation, 'page');
  assert.equal(rd.hasAttribute('data-mode'), false);
  assert.equal(rd.querySelector('.ph-tabs [role="tablist"]').getAttribute('aria-label'), 'Run sections');
});

test('a deep link to a tab mounts one head on that tab; an old address is rewritten in place, with no history entry', async () => {
  const { ctx, doc, w } = await live('running/r1/diff');
  assert.equal(doc.querySelectorAll('#run-detail .ph').length, 1);
  assert.equal(selected(doc, '#run-detail'), 'diff');
  const before = w.history.length;
  ctx.go('running/r1/details/qa');
  await ctx.settle(4);
  assert.equal(w.location.hash, '#running/r1/qa');
  assert.equal(selected(doc, '#run-detail'), 'qa');
  assert.equal(w.history.length, before + 1, 'only the test\'s own navigation: the rewrite replaced it');
});

test('a tab click pushes its address and activates the tab once; the keys move between the shown tabs', async () => {
  const { ctx, doc, w } = await live();
  const screen = doc.querySelector('#run-detail .rd');
  const tabs = w.__np.detailTabsOf(screen);
  const real = tabs.activate;
  const opened = [];
  tabs.activate = (k) => { opened.push(k); return real(k); };
  const before = w.history.length;
  rdTab(doc, 'diff').click();
  await ctx.settle(4);
  assert.equal(w.location.hash, '#running/r1/diff');
  assert.equal(w.history.length, before + 1);
  assert.deepEqual(opened, ['diff'], 'one activation, through the route');
  key(w, rdTab(doc, 'diff'), 'ArrowRight');
  await ctx.settle(4);
  const shown = [...doc.querySelectorAll('#run-detail .ph-tabs [role="tab"]')].filter((t) => !t.hidden).map((t) => t.dataset.sec);
  assert.equal(selected(doc, '#run-detail'), shown[shown.indexOf('diff') + 1]);
  // Simple level: the keys skip the tabs it hides; End and Home push their addresses.
  setLevel(doc, 'simple');
  await ctx.settle(4);
  rdTab(doc, 'overview').click();
  await ctx.settle(4);
  const simple = [...doc.querySelectorAll('#run-detail .ph-tabs [role="tab"]')].filter((t) => !t.hidden && ['simple', undefined].includes(t.dataset.minLevel)).map((t) => t.dataset.sec);
  key(w, rdTab(doc, 'overview'), 'ArrowLeft');
  await ctx.settle(4);
  assert.equal(selected(doc, '#run-detail'), simple.at(-1), 'ArrowLeft from Summary wraps to the last tab the level shows');
  key(w, rdTab(doc, simple.at(-1)), 'Home');
  await ctx.settle(4);
  assert.equal(w.location.hash, '#running/r1');
  key(w, rdTab(doc, 'overview'), 'End');
  await ctx.settle(4);
  assert.equal(w.location.hash, `#running/r1/${tabKey('running', simple.at(-1))}`);
});

test('every shown run tab maps into its route row, live and saved', async () => {
  const { doc } = await live();
  for (const t of doc.querySelectorAll('#run-detail .ph-tabs [role="tab"]')) {
    assert.ok(ROUTES.running.tabs.keys.includes(tabKey('running', t.dataset.sec)), t.dataset.sec);
    assert.equal(engineTab('running', tabKey('running', t.dataset.sec)), t.dataset.sec);
  }
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(ctx, '');
  for (const t of ctx.window.document.querySelectorAll('#hist-detail .ph-tabs [role="tab"]')) {
    assert.ok(ROUTES.history.tabs.keys.includes(tabKey('history', t.dataset.sec)), t.dataset.sec);
    assert.equal(engineTab('history', tabKey('history', t.dataset.sec)), t.dataset.sec);
  }
});

test('a tab the level hides, a tab the run does not offer, and a level change away from the open tab: Summary, replaced', async () => {
  const { ctx, doc, w } = await live('running/r1/agents');
  assert.equal(selected(doc, '#run-detail'), 'agents');
  const before = w.history.length;
  setLevel(doc, 'simple');                                    // reselectHiddenDetailTabs
  await ctx.settle(4);
  assert.equal(selected(doc, '#run-detail'), 'overview');
  assert.equal(w.location.hash, '#running/r1');
  assert.equal(w.history.length, before);
  ctx.go('running/r1/agents');                                // still Simple
  await ctx.settle(4);
  assert.equal(selected(doc, '#run-detail'), 'overview');
  assert.equal(w.location.hash, '#running/r1');
  setLevel(doc, 'expert');
  ctx.go('running/r1/changes');                               // a git run has no Changes
  await ctx.settle(4);
  assert.equal(selected(doc, '#run-detail'), 'overview');
  assert.equal(w.location.hash, '#running/r1');
});

test('a waiting question marks Summary with ? while another tab is open; the Needs-you Answer lands on the question', async () => {
  const pq = { id: 'clarify-1', kind: 'clarify', questions: [{ id: 'q1', question: 'Which store?', options: ['a', 'b', ''], allowFreeText: true }] };
  const { ctx, doc, w } = await live('running/r1/diff', { pendingQuestion: pq });
  const badge = () => rdTab(doc, 'overview').querySelector('.rd-tab-badge')?.textContent || '';
  assert.equal(badge(), '?');
  assert.equal(rdTab(doc, 'overview').title, 'Waiting for your answer');
  const row = doc.querySelector('#runs-list a.runs-row[data-run-id="r1"]');
  row.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await ctx.settle(6);
  assert.equal(w.location.hash, '#running/r1');
  assert.equal(selected(doc, '#run-detail'), 'overview');
  assert.ok(doc.activeElement && doc.activeElement.closest('.rd-questions'), 'focus is in the question');
  ctx.dispatch({ type: 'question-resolved', runId: 'r1', id: 'clarify-1' });
  await ctx.settle(4);
  assert.equal(badge(), '', 'the ? goes with the question');
  assert.equal(rdTab(doc, 'overview').hasAttribute('title'), false);
});

test('the head\'s Answer on another tab opens Summary with a pushed address and focuses the question', async () => {
  const pq = { id: 'clarify-1', kind: 'clarify', questions: [{ id: 'q1', question: 'Which store?', options: ['a', 'b', ''], allowFreeText: true }] };
  const { ctx, doc, w } = await live('running/r1/diff', { pendingQuestion: pq });
  const answer = [...doc.querySelectorAll('#run-detail .ph-actions .rd-actions button')].find((b) => /Answer/.test(b.textContent));
  assert.ok(answer, 'the head offers Answer');
  const before = w.history.length;
  answer.click();
  await ctx.settle(6);
  assert.equal(w.location.hash, '#running/r1');
  assert.equal(w.history.length, before + 1);
  assert.equal(selected(doc, '#run-detail'), 'overview');
  assert.ok(doc.activeElement && doc.activeElement.closest('.rd-questions'), 'focus is in the question');
});

const FEATURE = { groups: [{ id: 'feat_1', kind: 'feature', title: 'Run tags', projectKey: null, planning: null, cost: { usd: 0, byPipeline: {} },
  members: [1, 2, 3].map((i) => ({ position: i, title: `Slice ${i}`, pipelineId: `p${i}`, ticketId: null, status: i === 1 ? 'done' : 'running',
    pr: null, ticket: null, adhoc: false, after: null })) }] };

test('a slice run: the trail ends at its feature, the h1 drops "Run 2 · ", the trail survives a tab change; Escape goes up', async () => {
  const { ctx, doc, w } = await live('running/r1', { pipelineId: 'p2', title: 'Run 2 · Pin charts' },
    { fetchHandler: (url) => (url.startsWith('/api/run-groups') ? json(FEATURE) : null) });
  await ctx.settle(6);
  assert.deepEqual(trail(doc), ['Runs', 'Run tags']);
  assert.equal(doc.querySelector('#topnav-crumbs .nav-up').textContent, 'Run tags');
  const h1 = doc.querySelector('#run-detail .ph .rd-page-title');
  assert.equal(h1.textContent, 'Pin charts');
  assert.equal(h1.title, 'Run 2 · Pin charts');
  assert.equal(doc.querySelector('#run-detail .rd-title-row .kind-chip').textContent, 'Run 2 of 3');
  rdTab(doc, 'diff').click();
  await ctx.settle(4);
  assert.deepEqual(trail(doc), ['Runs', 'Run tags'], 'the parent survives a tab change');
  doc.getElementById('runs-shell').dataset.layout = 'slide';
  doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await ctx.settle(4);
  assert.equal(w.location.hash, '#feature/feat_1');
});

test('going up in the slide layout: the Runs crumb shows the list itself, its pane kept, focus on the row; Escape the same', async () => {
  for (const how of ['crumb', 'escape']) {
    const ctx = await bootApp();
    helloRun(ctx, { runId: 'r1', pipelineId: 'p1', projectDir: '/tmp/p' });
    const { window: w } = ctx;
    const doc = w.document;
    ctx.showRunning();
    await ctx.settle(4);
    doc.getElementById('runs-shell').dataset.layout = 'slide';
    const pane = doc.getElementById('runs-list-pane');
    doc.querySelector('#runs-list a.runs-row[data-run-id="r1"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await ctx.settle(6);
    assert.equal(doc.activeElement, doc.querySelector('#run-detail .ph .rd-page-title'), `${how}: the h1 has focus`);
    if (how === 'crumb') doc.querySelector('#topnav-crumbs .nav-trail a[data-crumb="runs"]').click();
    else doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await ctx.settle(6);
    assert.equal(w.location.hash, '#runs', `${how}: the list, not the remembered run`);
    assert.equal(doc.getElementById('runs-list-pane'), pane, `${how}: the same list pane`);
    assert.equal(doc.getElementById('run-shell').classList.contains('detail-open'), false);
    assert.equal(doc.activeElement && doc.activeElement.dataset.runId, 'r1', `${how}: focus back on the row`);
  }
});

test('side by side: a run opened from its row keeps focus on the row, and Escape leaves the page alone', async () => {
  const ctx = await bootApp();
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', projectDir: '/tmp/p' });
  const { window: w } = ctx;
  const doc = w.document;
  ctx.showRunning();
  await ctx.settle(4);
  doc.getElementById('runs-shell').dataset.layout = 'split';
  const row = doc.querySelector('#runs-list a.runs-row[data-run-id="r1"]');
  row.focus();
  row.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await ctx.settle(6);
  assert.equal(doc.activeElement && doc.activeElement.dataset.runId, 'r1');
  doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await ctx.settle(4);
  assert.equal(w.location.hash, '#running/r1');
});

test('saved: an old Q&A address opens the saved Q&A; a bare one Summary; a tab before the record loads waits for it', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  const doc = ctx.window.document;
  await openDetail(ctx, 'details/clarify');
  await settle(ctx.window, 4);
  assert.equal(ctx.window.location.hash, `#${detailHash}/qa`);
  assert.equal(selected(doc, '#hist-detail'), 'clarify', 'the engine keeps its clarify key');
  await openDetail(ctx, '');
  assert.equal(selected(doc, '#hist-detail'), 'overview');
  // The record loads only when the test releases it (a timer could run out under load before the first check).
  let release;
  const held = new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => TABS_DETAIL }); });
  const slow = await bootDetail({ detail: TABS_DETAIL, deepLink: false,
    arms: (url) => (url.endsWith(`/api/history/${KEY}/${ROW.id}`) ? held : null) });
  const sdoc = slow.window.document;
  const before = slow.window.history.length;
  slow.window.location.hash = `${detailHash}/logs`;
  slow.window.dispatchEvent(new slow.window.Event('hashchange'));
  await settle(slow.window, 2);
  assert.equal(sdoc.querySelector('#hist-detail .hd').dataset.wantTab, 'logs', 'the tab waits for the record');
  release();
  await settle(slow.window, 6);
  assert.equal(selected(sdoc, '#hist-detail'), 'logs');
  assert.equal(slow.window.history.length, before + 1, 'only the navigation itself');
});

test('saved: focus lands on the h1 after a navigation into the page; a tab click keeps it on the tab', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  const doc = ctx.window.document;
  doc.body.focus();
  await openDetail(ctx, '');
  await settle(ctx.window, 4);
  assert.equal(doc.activeElement, doc.querySelector('#hist-detail .ph .rd-page-title'));
  const tab = doc.querySelector('#hist-detail .hd-tab[data-sec="diff"]');
  tab.focus();
  tab.click();
  await settle(ctx.window, 4);
  assert.equal(doc.activeElement, tab);
});

test('saved: the page context names the run and its tab; Summary reads as the glance', async () => {
  const ctx = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(ctx, 'diff');
  const pc = ctx.window.__np.chat.getPageContext();
  assert.equal(pc.pipelineId, ROW.id);
  assert.equal(pc.projectKey, KEY);
  assert.equal(pc.runPage, 'diff');
  await openDetail(ctx, '');
  assert.equal(ctx.window.__np.chat.getPageContext().runPage, 'glance');
});

test('saved: a run that does not load shows its error under the trail Runs, with no tab strip and no Back', async () => {
  const ctx = await bootDetail({ arms: (url) => (url.endsWith(`/api/history/${KEY}/missing`) ? fail(404, { error: 'pipeline not found' }) : null) });
  const doc = ctx.window.document;
  ctx.window.location.hash = `history/${KEY}/missing`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle(ctx.window, 6);
  assert.equal(doc.querySelector('#hist-detail .hd-error').hidden, false);
  assert.equal(doc.querySelector('#hist-detail .ph-tabs [role="tab"]'), null);
  assert.deepEqual(trail(doc), ['Runs']);
  assert.equal(doc.querySelector('.hd-back'), null);
  assert.equal(doc.querySelector('#hist-detail .ph .rd-page-title').textContent, 'missing');
  assert.equal(doc.querySelector('#hist-detail .rd-title-row .kind-chip'), null, 'no kind chip for a run that is not there');
  assert.equal(doc.querySelector('#hist-detail .hd-bar-more').hidden, true, 'no ⋯ for a run that is not there');
  assert.equal(doc.querySelector('#hist-detail .hd-glance .rd-sheet').hidden, true, 'no empty card under the error');
});

test('the live run that finishes on Q&A hands off to the saved Q&A', async () => {
  const rows = [{ ...ROW, id: 'p1', status: 'done' }];
  const ctx = await bootApp({ fetchHandler: (url) => (url.endsWith('/api/history') ? json({ pipelines: rows, ghAvailable: false }) : null) });
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', projectDir: '/tmp/proj', status: 'done' });
  ctx.go('running/r1/qa');
  await ctx.settle(10);
  assert.match(ctx.window.location.hash, /^#history\/[^/]+\/p1\/qa$/);
});

const groupHandler = (url) => (url.startsWith('/api/run-groups') ? json(FEATURE)
  : url.startsWith('/api/shape/features/feat_1') ? json({ id: 'feat_1' }) : null);
async function group(hash, runs = []) {
  const ctx = await bootApp({ fetchHandler: groupHandler });
  applyFlags({ shapeFirst: true }, ctx.window.document);
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: true }, runs });
  await ctx.settle();
  ctx.window.document.body.focus();
  ctx.go(hash);
  await ctx.settle(8);
  return { ctx, doc: ctx.window.document, w: ctx.window, gp: ctx.window.document.querySelector('#group-detail .gpage') };
}

test('#feature/feat_1: the trail is Runs, the tabs sit in the head, the h1 has focus once it loads; tab clicks and keys push', async () => {
  const { ctx, doc, w, gp } = await group('feature/feat_1');
  assert.deepEqual(trail(doc), ['Runs']);
  assert.equal(gp.firstElementChild, gp.querySelector(':scope > .ph'), 'the head is the page\'s first child');
  assert.ok(gp.querySelector('.ph-actions > .gpage-bar'));
  assert.ok(gp.querySelector('.ph-tabs > .gpage-tabs[role="tablist"]'));
  assert.equal(gp.dataset.tab, 'runs');
  assert.equal(doc.activeElement, gp.querySelector('.gpage-title'), 'focus on the h1 once the group loaded');
  const before = w.history.length;
  gp.querySelector('.rd-tab[data-tab="decisions"]').click();
  await ctx.settle(6);
  assert.equal(w.location.hash, '#feature/feat_1/decisions');
  assert.equal(w.history.length, before + 1);
  assert.equal(gp.dataset.tab, 'decisions');
  const tab = gp.querySelector('.rd-tab[data-tab="decisions"]');
  tab.focus();
  ctx.dispatch({ type: 'run-groups-changed' });                // another paint keeps focus on the tab
  await ctx.settle(6);
  assert.equal(doc.activeElement, tab);
  key(w, gp.querySelector('.rd-tab[data-tab="runs"]'), 'ArrowLeft');
  await ctx.settle(6);
  const shown = [...gp.querySelectorAll('.gpage-tabs [role="tab"]')].filter((t) => !t.hidden).map((t) => t.dataset.tab);
  assert.equal(gp.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, shown.at(-1), 'ArrowLeft from Runs wraps');
});

test('a group address with an encodable id is rewritten in place; a member\'s Logs link is the canonical tab address', async () => {
  const { gp } = await group('feature/feat_1/logs', [{ runId: 'r2', pipelineId: 'p2', title: 'Slice 2', projectDir: '/tmp/p',
    status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' }]);
  const hrefs = [...gp.querySelectorAll('.gpage-logs a')].map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('#running/r2/logs'), hrefs.join(' '));
  assert.ok(hrefs.every((h) => !/\/details\//.test(h)), hrefs.join(' '));
  const ctx = await bootApp({ fetchHandler: groupHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });
  await ctx.settle();
  const before = ctx.window.history.length;
  ctx.window.location.hash = 'group/p:p0/logs';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#group/p%3Ap0/logs');
  assert.equal(ctx.window.history.length, before + 1, 'only the navigation itself: the rewrite replaced it');
});

test('the Chat run panel keeps its Details mode, no head and replaceState tabs; Open full page lands on the page tab', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/logs');
  const doc = ctx.window.document;
  assert.equal(screen.dataset.presentation, 'panel');
  assert.equal(screen.dataset.mode, 'details');
  assert.equal(screen.querySelector('.ph'), null);
  assert.ok(screen.querySelector('.rd-header'));
  assert.equal(doc.getElementById('topnav-crumbs').hidden, true);
  const before = ctx.window.history.length;
  panelClick(ctx, screen.querySelector('.rd-tab[data-sec="workflow"]'));
  await ctx.settle(4);
  assert.equal(ctx.window.history.length, before, 'a panel tab replaces the address');
  panelClick(ctx, screen.querySelector('.rd-tab[data-sec="logs"]'));
  await ctx.settle(4);
  panelClick(ctx, screen.querySelector('.crp-full'));
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#running/r1/logs');
  assert.equal(doc.querySelector('#run-detail .rd-tab.active').dataset.sec, 'logs');
  assert.ok(doc.querySelector('#run-detail .rd .ph'));
});

test('a link to another tab pushes its address, so Back returns and the tab the address names still opens on a click', async () => {
  // Live: a graph footer row opens Logs (focusLogExecution), a pushed address; Summary then opens on its click.
  const { ctx, doc, w } = await live();
  const before = w.history.length;
  w.__np.focusLogExecution({ run: w.__np.getRun('r1') }, 'x:plan:1', 'plan');
  await ctx.settle(4);
  assert.equal(w.location.hash, '#running/r1/logs');
  assert.equal(w.history.length, before + 1, 'a pushed entry: Back returns to Summary');
  assert.equal(selected(doc, '#run-detail'), 'logs');
  rdTab(doc, 'overview').click();
  await ctx.settle(4);
  assert.equal(w.location.hash, '#running/r1');
  assert.equal(selected(doc, '#run-detail'), 'overview');
  // Saved: the footer row and Open the diff do the same.
  const s = await bootDetail({ detail: { ...TABS_DETAIL, results: { ...RESULTS, newFiles: ['src/a.mjs'], changedFiles: ['src/b.mjs'] } } });
  const sdoc = s.window.document;
  await openDetail(s, '');
  await settle(s.window, 4);
  const sBefore = s.window.history.length;
  s.window.__np.focusLogExecution({ run: {}, record: ROW }, 'x:plan:1', 'plan');
  await settle(s.window, 4);
  assert.equal(s.window.location.hash, `#${detailHash}/logs`);
  assert.equal(s.window.history.length, sBefore + 1);
  assert.equal(selected(sdoc, '#hist-detail'), 'logs');
  sdoc.querySelector('#hist-detail .hd-tab[data-sec="overview"]').click();
  await settle(s.window, 4);
  assert.equal(selected(sdoc, '#hist-detail'), 'overview');
  const open = [...sdoc.querySelectorAll('#hist-detail .hd-ov-files .link-btn')].find((b) => b.textContent === 'Open the diff');
  assert.ok(open, 'Summary lists the files with Open the diff');
  open.click();
  await settle(s.window, 4);
  assert.equal(s.window.location.hash, `#${detailHash}/diff`);
  assert.equal(selected(sdoc, '#hist-detail'), 'diff');
  assert.equal(s.window.history.length, sBefore + 3);
});

test('a page draws the Details header in Summary, under the facts row: its cost, branch, Publish and base check stay reachable', async () => {
  const { doc } = await live();
  const rd = doc.querySelector('#run-detail .rd');
  const header = rd.querySelector('.rd-header');
  assert.equal(header.parentElement, rd.querySelector('.rd-glance .rd-facts').parentElement);
  assert.equal(header.previousElementSibling, rd.querySelector('.rd-glance .rd-facts'));
  assert.ok(header.querySelector('.rd-meta') && header.querySelector('.rd-sync'), 'the cost line and Sync are in Summary');
  const s = await bootDetail({ detail: TABS_DETAIL });
  await openDetail(s, '');
  const hd = s.window.document.querySelector('#hist-detail .hd');
  const hh = hd.querySelector('.hd-header');
  assert.ok(hh.closest('.hd-glance'), 'the saved header is in Summary');
  for (const sel of ['.hd-publish', '.hd-push', '.hd-base-check', '.hd-meta', '.hd-published']) assert.ok(hd.querySelector(`.hd-glance ${sel}`), sel);
  // The panel keeps its header under its Details mode (no move).
  const css = (await import('node:fs')).readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.rd-sheet > :is\(\.rd-header,\.hd-header\) :is\(\.rd-title,\.hd-title,\.rd-status,\.hd-sic,\.auto-badge,\.hd-pr,\.hd-pr-link\)\{display:none;\}/,
    'what the page head says is not drawn twice');
  assert.doesNotMatch(css, /\[data-presentation="page"\] :is\(\.rd-header,\.hd-header/, 'no rule hides the header on a page');
});
