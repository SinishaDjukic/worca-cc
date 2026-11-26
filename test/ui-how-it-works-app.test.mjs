// test/ui-how-it-works-app.test.mjs — the "How it works" explainers in the real app.js boot: the
// button per route, nothing opens by itself, one quiet POST on open, the mark, Show me, the level
// confirm, Settings reset and the Workspaces hookup.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { confirmDialog, cancelDialog } from './helpers/confirm-modal.mjs';
import { bootApp, settle, click, WS_ONE } from './helpers/onboarding-app-boot.mjs';
import { AREA_GUIDES } from '../ui/public/how-it-works/area-guides.mjs';

const trackDom = useDomRelease(afterEach);
const boot = (opts = {}) => bootApp({ trackDom, flags: ['design', 'requirements'], ...opts });

// The route each area's button is shown on. Runs owns four list routes; the rest are their own.
const ROUTE_OF = { runs: 'history' };
const hashOf = (area) => ROUTE_OF[area] || area;
const AREAS = Object.keys(AREA_GUIDES);
const modal = (doc) => doc.getElementById('how-it-works-modal');
const visibleButtons = (doc) => ['howto-btn', 'wfv-howto-btn'].map((id) => doc.getElementById(id)).filter((b) => b && !b.hidden);
// The explainer's own Done button, whichever step it is on.
const finishGuide = (win, doc) => { const next = () => modal(doc).querySelector('.wg-next'); while (next().textContent !== 'Done') click(win, next()); click(win, next()); };

test('every area shows one How it works button; nothing opens by itself (R-po-1, R-po-5, I-1)', async () => {
  const { doc, show } = await boot();
  for (const area of AREAS) {
    await show(hashOf(area));
    assert.equal(modal(doc), null, `${area}: no modal on a first visit`);
    const shown = visibleButtons(doc).map((b) => b.id);
    if (area === 'workspaces') assert.deepEqual(shown, [], 'Workspaces has its in-page button only');
    else if (area === 'workflows') assert.deepEqual(shown, ['wfv-howto-btn'], 'Workflows shows its editor-bar button');
    else assert.deepEqual(shown, ['howto-btn'], `${area}: exactly one button in the top bar`);
  }
  await show('getting-started');
  assert.deepEqual(visibleButtons(doc), [], 'a page without an explainer has no button');
});

test('click opens that area\'s explainer; the steps and every close path work (R-po-2, R-po-7)', async () => {
  const { window, doc, show } = await boot();
  for (const area of ['chat', 'schedules', 'models', 'requirements']) {
    await show(area);
    click(window, visibleButtons(doc)[0]);
    assert.equal(modal(doc).dataset.area, area);
    assert.equal(modal(doc).querySelector('.wg-step-of').textContent, `1 of ${AREA_GUIDES[area].steps.length}`);
    click(window, modal(doc).querySelector('.wg-next'));
    assert.equal(modal(doc).querySelector('.wg-step-of').textContent, `2 of ${AREA_GUIDES[area].steps.length}`);
    click(window, modal(doc).querySelector('.wg-back'));
    click(window, modal(doc).querySelector('.wg-close'));
    assert.equal(modal(doc), null, `${area}: × closes`);
  }
  await show('stats');
  click(window, visibleButtons(doc)[0]);
  click(window, modal(doc).querySelector('.wg-skip'));
  assert.equal(modal(doc), null, 'Skip closes on the first screen');
});

test('the design start opens the Design guide, not the Chat one', async () => {
  const { window, doc, show } = await boot();
  await show('chat/new/design');
  click(window, visibleButtons(doc)[0]);
  assert.equal(modal(doc).dataset.area, 'design');
});

test('opening, stepping and closing send one quiet POST, change no route and lose no typing (I-2, R-po-9)', async () => {
  const { window, doc, show, posts, requests } = await boot();
  await show('new');
  const title = doc.getElementById('title');
  title.value = 'Fix the login bug';
  const before = requests.length;
  const hash = window.location.hash;
  click(window, visibleButtons(doc)[0]);
  await settle();
  click(window, modal(doc).querySelector('.wg-next'));
  click(window, modal(doc).querySelector('.wg-close'));
  await settle();
  const sent = requests.slice(before);
  assert.deepEqual(sent.map((r) => `${r.method} ${r.url.split('?')[0]}`), ['POST /api/onboarding'], 'only the seen POST');
  assert.deepEqual(posts, [{ guidesSeen: { new: true } }]);
  assert.equal(window.location.hash, hash, 'no route change');
  assert.equal(title.value, 'Fix the login bug', 'the typed title survives');
  assert.equal(doc.getElementById('gsSettingsMsg').textContent.includes('error'), false);
  await show('workflows');
  const name = doc.getElementById('wfv-name');
  name.value = 'My flow';
  click(window, doc.getElementById('wfv-howto-btn'));
  click(window, modal(doc).querySelector('.wg-close'));
  assert.equal(name.value, 'My flow', 'a Workflows entry survives');
});

test('the mark shows until the first open; after a reload with the server\'s status it stays gone (R-po-8)', async () => {
  const first = await boot();
  await first.show('schedules');
  const mark = (ctx) => ctx.doc.getElementById('howto-btn').dataset.new;
  assert.equal(mark(first), 'true', 'new until opened');
  assert.equal(first.doc.querySelector('#howto-btn .howto-new').hidden, false);
  click(first.window, first.doc.getElementById('howto-btn'));
  await settle();
  assert.equal(mark(first), 'false', 'gone as soon as it opens');
  click(first.window, modal(first.doc).querySelector('.wg-close'));
  const second = await boot({ guidesSeen: first.server.guidesSeen });
  await second.show('schedules');
  assert.equal(mark(second), 'false', 'a reload keeps it gone');
  await second.show('stats');
  assert.equal(mark(second), 'true', 'another area is still new');
});

test('Show me starts the tour after the modal is gone, even when the step is done (R-po-10)', async () => {
  // "project" is done in the stub's status (so its tour starts even when the step is done); "run" is not.
  for (const area of ['projects', 'new']) {
    const { window, doc, show } = await boot();
    await show(hashOf(area));
    click(window, doc.getElementById('howto-btn'));
    while (modal(doc).querySelector('.wg-next').textContent !== 'Done') click(window, modal(doc).querySelector('.wg-next'));
    const tour = modal(doc).querySelector('.wg-tour');
    assert.equal(tour?.textContent, 'Show me in the product', `${area}: the last screen offers the tour`);
    assert.equal(doc.querySelector('.guide-layer'), null, 'no tour yet');
    click(window, tour);
    assert.equal(modal(doc), null, `${area}: the modal is gone first`);
    await settle();
    const layer = doc.querySelector('.guide-layer.spotlight');
    assert.ok(layer, `${area}: the guide started with a spotlight`);
    assert.ok(layer.dataset.target, `${area}: the spotlight names its target`);
    assert.ok(doc.querySelector(layer.dataset.target), `${area}: the first-hop target exists on the page`);
  }
});

test('a tour that needs a higher mode shows the level confirm first (R-13, A-5)', async () => {
  const { window, doc, show } = await boot({ level: 'simple' });
  await show('team-policy');
  click(window, doc.getElementById('howto-btn'));
  while (modal(doc).querySelector('.wg-next').textContent !== 'Done') click(window, modal(doc).querySelector('.wg-next'));
  click(window, modal(doc).querySelector('.wg-tour'));
  await settle();
  assert.equal(modal(doc), null);
  const confirm = doc.getElementById('confirm-modal');
  assert.equal(confirm.classList.contains('hidden'), false, 'the confirm opens');
  assert.match(confirm.textContent, /Switch to Expert/);
  await cancelDialog(window);
});

test('Runs ends on Done and closes; every Runs route shows the same explainer (R-po-4)', async () => {
  const { window, doc, show } = await boot();
  await show('history');
  click(window, doc.getElementById('howto-btn'));
  const texts = [...modal(doc).querySelectorAll('.wg-title')].map((t) => t.textContent);
  finishGuide(window, doc);
  assert.equal(modal(doc), null, 'Done closes it');
  const again = await boot();
  await again.show('running');
  click(again.window, again.doc.getElementById('howto-btn'));
  assert.deepEqual([...modal(again.doc).querySelectorAll('.wg-title')].map((t) => t.textContent), texts);
  assert.equal(modal(again.doc).dataset.area, 'runs');
});

test('an onboarding-changed frame repaints the marks (R-po-12)', async () => {
  const ctx = await boot();
  await ctx.show('stats');
  const btn = ctx.doc.getElementById('howto-btn');
  assert.equal(btn.dataset.new, 'true');
  ctx.server.guidesSeen.stats = true;                  // another tab opened it
  ctx.frame({ type: 'onboarding-changed' });
  await new Promise((r) => setTimeout(r, 400));
  await settle();
  assert.equal(btn.dataset.new, 'false');
});

test('Workspaces: its button opens the shared dialog with Show me; the tour goes nowhere near the wizard (R-po-13)', async () => {
  const { window, doc, show, posts } = await boot({ seen: true, workspaces: WS_ONE });
  await show('workspaces');
  click(window, doc.getElementById('ws-howto-btn'));
  await settle();
  const m = doc.getElementById('workspace-guide-modal');
  assert.ok(m, 'the walkthrough opened');
  assert.deepEqual(posts.at(-1), { workspaceGuideSeen: true }, 'the same body as before');
  while (m.querySelector('.wg-next').textContent !== 'Done') click(window, m.querySelector('.wg-next'));
  const tour = m.querySelector('.wg-tour');
  assert.ok(tour, 'Show me is offered on the last screen');
  click(window, tour);
  await settle();
  assert.equal(doc.getElementById('workspace-guide-modal'), null);
  assert.notEqual(window.location.hash, '#workspace-create', 'the tour does not route to the wizard');
});

test('deleting the last workspace keeps the Workspaces explainer seen in the guide map (D-5)', async () => {
  const ctx = await boot({ seen: true, guidesSeen: { workspaces: true }, workspaces: WS_ONE });
  await ctx.show('workspaces/wks-alpha-00000001');
  click(ctx.window, ctx.doc.querySelector('#ws-detail .ws-delete'));
  await confirmDialog(ctx.window);
  await settle();
  assert.equal(ctx.server.guidesSeen.workspaces, true);
  assert.equal(ctx.doc.getElementById('ws-howto-btn').dataset.new, 'false', 'the mark does not return');
});

test('Settings › Getting started "Show again" resets the guides, and says so (D-7)', async () => {
  const { window, doc, posts, server } = await bootApp({ trackDom, guidesSeen: { chat: true, runs: true }, hidden: true });
  assert.match(doc.querySelector('#getting-started-card .gs-settings-text').textContent, /How it works/);
  click(window, doc.getElementById('gsShowAgain'));
  await settle();
  assert.deepEqual(posts[0], { guidesReset: true, hidden: false });
  assert.deepEqual(server.guidesSeen, {});
  assert.equal(window.location.hash, '#getting-started');
  const open = await bootApp({ trackDom, guidesSeen: { chat: true } });
  click(open.window, open.doc.getElementById('gsShowAgain'));
  await settle();
  assert.deepEqual(open.posts[0], { guidesReset: true });
});
