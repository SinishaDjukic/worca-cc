// test/ui-workspace-guide.test.mjs — FEAT-7 "How workspaces work": the module (copy, sample map,
// navigation, close paths) in a bare jsdom, then the Workspaces page flows in a full app.js boot.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { confirmDialog } from './helpers/confirm-modal.mjs';
import { bootApp as bootShared, WS_ONE } from './helpers/onboarding-app-boot.mjs';
import { changeOrder } from '../src/shared/workspace-map/order.mjs';
import {
  WORKSPACE_GUIDE_STEPS, SAMPLE_PROJECTS, SAMPLE_LINKS, sampleChangeOrder, shouldAutoOpenWorkspaceGuide, openWorkspaceGuide,
} from '../ui/public/workspace-guide.mjs';

const trackDom = useDomRelease(afterEach);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));
const key = (win, node, k, extra = {}) => node.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const allText = WORKSPACE_GUIDE_STEPS.map((s) => [s.title, ...s.paras].join(' ')).join(' ');

function bare() {
  const dom = trackDom(new JSDOM('<!doctype html><body><button id="opener">How workspaces work</button></body>', { url: 'http://localhost/', pretendToBeVisual: true }));
  const { window } = dom;
  const opener = window.document.getElementById('opener');
  opener.focus();
  return { window, doc: window.document, opener };
}
function openBare(mode = 'learn') {
  const ctx = bare();
  const closes = [];
  const h = openWorkspaceGuide({ doc: ctx.doc, mode, onClose: (how) => closes.push(how) });
  const q = (sel) => ctx.doc.querySelector(`#workspace-guide-modal ${sel}`);
  return { ...ctx, h, closes, q };
}

// ---- part 1: the module ----

test('copy: 3–4 screens covering every required point, in plain product words (R-po-2,3,4,5,8,12)', async () => {
  await checkRows([
    { name: 'R-po-8: 3 to 4 screens', run: () => { assert.ok(WORKSPACE_GUIDE_STEPS.length >= 3 && WORKSPACE_GUIDE_STEPS.length <= 4); } },
    { name: 'R-po-2: a workspace groups 2 to 40 projects', run: () => { assert.match(allText, /workspace is a named group of 2 to 40 related projects/); } },
    { name: 'R-po-3: API calls, messages, packages, shared data; evidence; confidence', run: () => {
      for (const re of [/API/, /messages/, /package/, /sharing its data/, /evidence/, /confidence level/]) assert.match(allText, re);
    } },
    { name: 'R-po-4: change order is providers before users and guides which projects a run changes', run: () => {
      assert.match(allText, /suggested change order/);
      assert.match(allText, /provide something come before the projects that use it/);
      assert.match(allText, /which projects each change goes into/);
    } },
    { name: 'R-po-5: the scan never changes the projects', run: () => { assert.match(allText, /never changes your projects/); } },
    { name: 'R-po-12 + manual links: confirm, reject, add on the Map; manual counts the same', run: () => {
      assert.match(allText, /Map/);
      for (const re of [/Confirm/, /reject/, /add any the scan missed/, /add by hand count the same as scanned ones/]) assert.match(allText, re);
    } },
    { name: 'plain language: no scan stage or confidence enum names', run: () => {
      assert.doesNotMatch(allText, /\b(extract|survey|catalog|usage|join|synth|exact|verified|heuristic|inferred)\b/i);
    } },
  ]);
});

test('sample map: made-up projects joined by labelled links; its change order is the real rule (R-po-14, R-po-4, A-5)', async () => {
  const { q, h } = openBare();
  h.goTo(WORKSPACE_GUIDE_STEPS.findIndex((s) => s.art === 'map'));
  const svg = q('svg.wg-map');
  assert.ok(svg, 'a screen shows the sample map');
  assert.equal(svg.querySelectorAll('.wg-node').length, SAMPLE_PROJECTS.length);
  assert.ok(SAMPLE_PROJECTS.length >= 3);
  const labels = [...svg.querySelectorAll('.wg-link .wg-label')].map((t) => t.textContent);
  assert.equal(labels.length, SAMPLE_LINKS.length);
  assert.ok(labels.every((t) => t.trim().length > 0), 'every link is labelled');
  assert.deepEqual([...svg.querySelectorAll('.wg-node text')].map((t) => t.textContent), ['Web shop', 'Payments service', 'Design kit', 'Email service']);
  assert.match(q('.wg-caption').textContent, /sample map with made-up projects, not yours/);
  const keys = SAMPLE_PROJECTS.map((p) => p.key);
  assert.deepEqual(changeOrder(keys, SAMPLE_LINKS).order, [['design-kit', 'email'], ['payments'], ['web-shop']]);
  assert.deepEqual(sampleChangeOrder(), [['Design kit', 'Email service'], ['Payments service'], ['Web shop']]);
  h.goTo(WORKSPACE_GUIDE_STEPS.findIndex((s) => s.art === 'order'));
  assert.deepEqual([...q('.wg-order').children].map((li) => li.textContent), ['Design kit, Email service', 'Payments service', 'Web shop']);
});

test('navigation: "N of M", Back/Next, last button per mode (R-po-8, R-po-9)', async () => {
  const n = WORKSPACE_GUIDE_STEPS.length;
  const { window, q, closes } = openBare('learn');
  assert.equal(q('.wg-step-of').textContent, `1 of ${n}`);
  assert.equal(q('.wg-back').disabled, true);
  click(window, q('.wg-next'));
  assert.equal(q('.wg-step-of').textContent, `2 of ${n}`);
  assert.equal(q('.wg-back').disabled, false);
  click(window, q('.wg-back'));
  assert.equal(q('.wg-step-of').textContent, `1 of ${n}`);
  key(window, q('.wg-next'), 'ArrowRight');
  assert.equal(q('.wg-step-of').textContent, `2 of ${n}`);
  for (let i = 2; i < n; i++) click(window, q('.wg-next'));
  assert.equal(q('.wg-step-of').textContent, `${n} of ${n}`);
  assert.equal(q('.wg-next').textContent, 'Done');
  click(window, q('.wg-next'));
  assert.deepEqual(closes, ['finish']);
  const c = openBare('create');
  c.h.goTo(n - 1);
  assert.equal(c.q('.wg-next').textContent, 'Create workspace');
});

test('every way out closes once, removes the modal and returns focus (R-po-7)', async () => {
  await checkRows([
    { name: 'Skip on the first screen → skip', run: () => {
      const { window, doc, q, closes, opener } = openBare('create');
      click(window, q('.wg-skip'));
      assert.deepEqual(closes, ['skip']);
      assert.equal(doc.getElementById('workspace-guide-modal'), null);
      assert.equal(doc.activeElement, opener);
    } },
    { name: '× → close', run: () => {
      const { window, q, closes } = openBare();
      click(window, q('.wg-close'));
      assert.deepEqual(closes, ['close']);
    } },
    { name: 'Escape → close, and a document Escape listener (the spotlight tour) never sees it', run: () => {
      const { window, doc, q, closes } = openBare();
      let reached = 0;
      doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') reached++; });
      key(window, q('.wg-next'), 'Escape');
      assert.deepEqual(closes, ['close']);
      assert.equal(reached, 0);
    } },
    { name: 'a backdrop click (press and release on the scrim) → close', run: async () => {
      const { window, doc, closes } = openBare();
      const modal = doc.getElementById('workspace-guide-modal');
      await new Promise((r) => setTimeout(r, 500));
      modal.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      click(window, modal);
      assert.deepEqual(closes, ['close']);
    } },
    { name: 'a backdrop click right after opening (a double-click on Create) is ignored', run: () => {
      const { window, doc, closes } = openBare();
      const modal = doc.getElementById('workspace-guide-modal');
      modal.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      click(window, modal);
      assert.deepEqual(closes, []);
      assert.ok(doc.getElementById('workspace-guide-modal'));
    } },
    { name: 'a second close is a no-op', run: () => {
      const { h, closes } = openBare();
      h.close(); h.close('skip');
      assert.deepEqual(closes, ['close']);
    } },
  ]);
});

test('shouldAutoOpenWorkspaceGuide: only a KNOWN unseen flag with no workspace', () => {
  assert.equal(shouldAutoOpenWorkspaceGuide({ seen: false, workspaceCount: 0 }), true);
  assert.equal(shouldAutoOpenWorkspaceGuide({ seen: true, workspaceCount: 0 }), false);
  assert.equal(shouldAutoOpenWorkspaceGuide({ seen: false, workspaceCount: 2 }), false);
  assert.equal(shouldAutoOpenWorkspaceGuide({ seen: null, workspaceCount: 0 }), false, 'unknown never blocks creation');
  assert.equal(shouldAutoOpenWorkspaceGuide({ workspaceCount: 0 }), false);
});

// ---- part 2: the Workspaces page, full app.js boot (pattern: test/ui-workspaces.test.mjs:54-79) ----

// The boot harness is shared (test/helpers/onboarding-app-boot.mjs); this adds the walkthrough's `finish`.
async function bootApp(opts = {}) {
  const ctx = await bootShared({ trackDom, ...opts });
  const guide = ctx.guide;
  const finish = () => { for (let i = 0; i < WORKSPACE_GUIDE_STEPS.length; i++) click(ctx.window, guide().querySelector('.wg-next')); };
  return { ...ctx, finish };
}

test('first Create with no workspace: the walkthrough first, then the wizard (R-po-1, R-po-9, R-po-11, R-po-16)', async () => {
  const { window, doc, show, posts, guide, finish } = await bootApp({ seen: false });
  await show('workspaces');
  assert.equal(guide(), null, 'R-po-11: opening the page opens nothing');
  const howto = doc.getElementById('ws-howto-btn');
  const label = howto.cloneNode(true);
  label.querySelector('.howto-new')?.remove();
  assert.equal(label.textContent.trim(), 'How workspaces work', 'the words are unchanged; the mark is a separate span');
  const wsMark = howto.querySelector('.howto-new');
  assert.equal(wsMark.textContent, '', 'the mark is a dot with no text child');
  assert.equal(wsMark.getAttribute('aria-hidden'), 'true');
  assert.equal(howto.getAttribute('aria-label'), wsMark.hidden ? 'How workspaces work' : 'How workspaces work, new');
  assert.equal(howto.closest('.ws-top-actions'), doc.getElementById('ws-create-btn').closest('.ws-top-actions'), 'R-po-16: beside Create workspace');
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  assert.ok(guide(), 'R-po-1: the walkthrough opened');
  assert.equal(guide().dataset.mode, 'create');
  assert.equal(window.location.hash, '#workspaces', 'the wizard is not shown yet');
  assert.deepEqual(posts.at(-1), { workspaceGuideSeen: true }, 'opening counts as seen');
  finish();
  await settle();
  assert.equal(guide(), null);
  assert.equal(window.location.hash, '#workspace-create', 'R-po-9: straight into the wizard');
});

test('Skip on the first screen → wizard; and counts as seen: the next Create opens the wizard directly (R-po-9, R-po-10)', async () => {
  const { window, doc, show, guide } = await bootApp({ seen: false });
  await show('workspaces');
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  click(window, guide().querySelector('.wg-skip'));
  await settle();
  assert.equal(window.location.hash, '#workspace-create');
  await show('workspaces');
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  assert.equal(guide(), null);
  assert.equal(window.location.hash, '#workspace-create');
});

test('Create goes straight to the wizard when seen, when workspaces exist, or when the server cannot say (R-po-10)', async () => {
  for (const opts of [{ seen: true }, { seen: false, workspaces: WS_ONE }, { onboardingDown: true }]) {
    const { window, doc, show, guide } = await bootApp(opts);
    await show('workspaces');
    click(window, doc.getElementById('ws-create-btn'));
    await settle();
    assert.equal(guide(), null, JSON.stringify(opts));
    assert.equal(window.location.hash, '#workspace-create', JSON.stringify(opts));
  }
});

test('on request: opens with or without workspaces; closing returns to the list; it then counts as seen (R-po-6, R-po-7, R-po-17)', async () => {
  const { window, doc, show, posts, guide } = await bootApp({ seen: false });
  await show('workspaces');
  const howto = doc.getElementById('ws-howto-btn');
  howto.focus();
  click(window, howto);
  await settle();
  assert.equal(guide().dataset.mode, 'learn');
  assert.deepEqual(posts.at(-1), { workspaceGuideSeen: true });
  click(window, guide().querySelector('.wg-close'));
  await settle();
  assert.equal(guide(), null);
  assert.equal(window.location.hash, '#workspaces', 'R-po-7: back where they were');
  assert.equal(doc.activeElement, howto, 'focus comes home');
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  assert.equal(guide(), null, 'R-po-17: no second showing');
  assert.equal(window.location.hash, '#workspace-create');
  const withWs = await bootApp({ seen: true, workspaces: WS_ONE });
  await withWs.show('workspaces');
  click(withWs.window, withWs.doc.getElementById('ws-howto-btn'));
  await settle();
  assert.ok(withWs.guide(), 'R-po-6: available to a user with workspaces too');
});

test('Close (×) after Create stays on the list and enters nothing; the next Create opens the wizard (R-po-7)', async () => {
  const { window, doc, show, guide } = await bootApp({ seen: false });
  await show('workspaces');
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  click(window, guide().querySelector('.wg-close'));
  await settle();
  assert.equal(window.location.hash, '#workspaces');
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  assert.equal(window.location.hash, '#workspace-create');
});

test('deleting the last workspace makes the next Create a first time again (R-po-13)', async () => {
  const { window, doc, show, guide } = await bootApp({ seen: true, workspaces: WS_ONE });
  await show('workspaces/wks-alpha-00000001');
  click(window, doc.querySelector('#ws-detail .ws-delete'));
  await confirmDialog(window);
  await settle();
  assert.equal(window.location.hash, '#workspaces');
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  assert.ok(guide(), 'the walkthrough opens before the wizard');
});

test('the wizard and a workspace page offer no way to open the walkthrough (R-po-15)', async () => {
  const { doc, show } = await bootApp({ seen: true, workspaces: WS_ONE });
  await show('workspace-create');
  const wizard = doc.querySelector('[data-view="workspace-create"]');
  assert.doesNotMatch(wizard.textContent, /How workspaces work/);
  assert.equal(wizard.querySelector('#ws-howto-btn'), null);
  await show('workspaces/wks-alpha-00000001');
  const page = doc.getElementById('ws-detail');
  assert.doesNotMatch(page.textContent, /How workspaces work/);
  assert.equal(doc.querySelectorAll('#ws-howto-btn').length, 1, 'one entry point, on the list screen');
  assert.ok(doc.getElementById('ws-howto-btn').closest('.ws-screen-list'));
});

// ---- part 3: the tour button and the "new" mark (D-5, D-9, I-7, A-8) ----

const mark = (doc) => doc.getElementById('ws-howto-btn').querySelector('.howto-new');
const toLastScreen = (window, doc) => {
  const m = doc.getElementById('workspace-guide-modal');
  for (let i = 0; i < WORKSPACE_GUIDE_STEPS.length - 1; i++) click(window, m.querySelector('.wg-next'));
  return m;
};

test('learn mode last screen: "Done" then "Show me in the product", the tour being the primary action (D-9)', async () => {
  const { window, doc, show } = await bootApp({ seen: true, workspaces: WS_ONE });
  await show('workspaces');
  click(window, doc.getElementById('ws-howto-btn'));
  await settle();
  const m = toLastScreen(window, doc);
  const next = m.querySelector('.wg-next');
  const tour = m.querySelector('.wg-tour');
  assert.equal(next.textContent, 'Done');
  assert.equal(next.classList.contains('btn-primary'), false, 'the shell gives the primary look to the tour here');
  assert.equal(tour.textContent, 'Show me in the product');
  assert.ok(tour.classList.contains('btn-primary'));
  assert.ok(next.compareDocumentPosition(tour) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'Done comes first');
});

test('create mode last screen: "Create workspace" stays primary, Show me is a secondary button before it (D-9)', async () => {
  const { window, doc, show } = await bootApp({ seen: false });
  await show('workspaces');
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  const m = toLastScreen(window, doc);
  const next = m.querySelector('.wg-next');
  const tour = m.querySelector('.wg-tour');
  assert.equal(next.textContent, 'Create workspace');
  assert.ok(next.classList.contains('btn-primary'));
  assert.equal(tour.textContent, 'Show me in the product');
  assert.equal(tour.classList.contains('btn-primary'), false, 'secondary, not primary');
  assert.ok(tour.compareDocumentPosition(next) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'the tour button comes before Create workspace');
});

test('"Show me in the product" starts the workspace tour and does not route to the wizard (I-7)', async () => {
  for (const [name, open] of [['learn', async ({ window, doc }) => click(window, doc.getElementById('ws-howto-btn'))],
    ['create', async ({ window, doc }) => click(window, doc.getElementById('ws-create-btn'))]]) {
    const ctx = await bootApp({ seen: name === 'learn', workspaces: name === 'learn' ? WS_ONE : [] });
    await ctx.show('workspaces');
    await open(ctx);
    await settle();
    const m = toLastScreen(ctx.window, ctx.doc);
    assert.equal(ctx.doc.querySelector('.guide-layer'), null, `${name}: no tour yet`);
    click(ctx.window, m.querySelector('.wg-tour'));
    await settle();
    assert.equal(ctx.guide(), null, `${name}: the walkthrough is gone`);
    assert.ok(ctx.doc.querySelector('.guide-layer'), `${name}: the workspace tour started`);
    assert.notEqual(ctx.window.location.hash, '#workspace-create', `${name}: not routed to the wizard`);
  }
});

test('the mark: shown until the first open, gone after it (D-5)', async () => {
  const { window, doc, show, posts } = await bootApp({ seen: false });
  await show('workspaces');
  assert.equal(mark(doc).hidden, false, 'new before it is ever opened');
  assert.equal(doc.getElementById('ws-howto-btn').dataset.new, 'true');
  click(window, doc.getElementById('ws-howto-btn'));
  await settle();
  assert.deepEqual(posts.at(-1), { workspaceGuideSeen: true });
  assert.equal(mark(doc).hidden, true, 'gone once opened');
  assert.equal(doc.getElementById('ws-howto-btn').dataset.new, 'false');
});

test('seen before this release (only workspaceGuideSeen:true, no map entry) shows no mark (A-8, D-5)', async () => {
  const { doc, show, server } = await bootApp({ seen: true, guidesSeen: {} });
  assert.deepEqual(server.guidesSeen, {});
  await show('workspaces');
  assert.equal(mark(doc).hidden, true);
  assert.equal(doc.getElementById('ws-howto-btn').dataset.new, 'false');
});

test('auto-open from Create clears the mark (A-8)', async () => {
  const { window, doc, show, guide } = await bootApp({ seen: false });
  await show('workspaces');
  assert.equal(mark(doc).hidden, false);
  click(window, doc.getElementById('ws-create-btn'));
  await settle();
  assert.ok(guide(), 'the walkthrough auto-opened');
  assert.equal(mark(doc).hidden, true, 'the mark is gone after the auto-open');
});
