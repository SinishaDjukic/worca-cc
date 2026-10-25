// worca Chat P4: how the panel dresses the run screens. The banners, the facts row (Time · Cost · Changes)
// and the waiting question move under the Details header; the question is answerable (and focused by a Q&A
// route) there; a gate pip in the Workflow tab keeps the panel; dots only in the Workflow tab's graph well
// (U8); the style.css section sizes, sheets, pins, keeps the bar on one row and draws no edge lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootChat, liveRun, hello, openPanel, panelOf, screenOf, click, ROW } from './helpers/chat-panel-boot.mjs';

const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));

test('the facts row sits under the Details header; the glance stays hidden', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  const head = screen.querySelector('.rd-details > .crp-head');
  assert.ok(head, 'the panel head follows the Details header');
  assert.equal(head.previousElementSibling, screen.querySelector('.rd-header'));
  const facts = head.querySelector('.rd-facts');
  assert.ok(facts, 'the facts row moved out of the glance');
  assert.ok([...facts.querySelectorAll('.rd-stats > div > span')].some((s) => s.textContent === 'time'), 'Time is painted there');
  assert.equal(screen.querySelector('.rd-glance').hidden, true);
  assert.equal(screen.querySelectorAll('.rd-facts').length, 1);
  assert.equal(screen.querySelector('.rd-bar .rd-stop').title, 'Stop', 'the icon-only Stop keeps its word as a tooltip');
});

test('a waiting question shows in the panel head and is answered from there', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  ctx.dispatch({ type: 'question', runId: 'r1', id: 'gate-1', kind: 'gate',
    issues: [{ severity: 'minor', title: 'Naming', detail: 'foo -> bar' }] });
  await ctx.settle();
  const ask = screen.querySelector('.crp-head > .rd-questions');
  assert.ok(ask, 'the waiting question moved under the header');
  assert.equal(ask.hidden, false);
  const go = ask.querySelector('.qpanel .gate-continue');
  assert.ok(go);
  click(ctx, go);
  await ctx.settle();
  assert.equal(ctx.box.answers.length, 1);
  assert.equal(ctx.box.answers[0].id, 'gate-1');
  assert.deepEqual(ctx.box.answers[0].payload, { decision: 'continue' });
});

test('the saved screen gets the facts row in its head too', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  const head = screen.querySelector('.hd-details > .crp-head');
  assert.ok(head && head.querySelector('.rd-facts'));
  assert.equal(head.querySelector('.rd-questions'), null);
});

test('U8: the only graph wells (dotted) are in the Workflow tab or the hidden glance', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  click(ctx, screen.querySelector('.rd-tab[data-sec="workflow"]'));
  await ctx.settle();
  const wells = [...screen.querySelectorAll('.run-flow-wrap')];
  assert.ok(wells.some((w) => w.closest('.rd-sec[data-sec="workflow"]')), 'the Workflow tab has its graph well');
  for (const w of wells) assert.ok(w.closest('.rd-sec[data-sec="workflow"], .rd-glance'), 'no dotted well outside the Workflow tab');
});

test('style.css "Chat P4: run panel": width, 900px sheet, pinned tabs, scrolling details, no dots, no edge lines, reduced motion', () => {
  const css = readFileSync(cssPath, 'utf8');
  const banner = '/* ===== Chat P4: run panel ===== */';
  const start = css.indexOf(banner);
  assert.ok(start >= 0, 'the P4 section exists');
  const next = css.indexOf('/* ===== Chat P', start + banner.length);
  const sec = next === -1 ? css.slice(start) : css.slice(start, next);
  assert.match(sec, /\.chat-page\[data-panel="open"\] \.chat-panel\{[^}]*width:max\(440px,min\(44%,700px\)\)/);
  assert.match(sec, /@media \(max-width:900px\)\{\s*\.chat-page\[data-panel="open"\] \.chat-panel\{position:fixed;inset:0;/);
  assert.match(sec, /\.crp :is\(\.rd-bar,\.hd-bar\)\{position:static;/);
  assert.match(sec, /\.crp :is\(\.rd-details,\.hd-details\)\{[^}]*overflow-y:auto;/);
  assert.match(sec, /\.crp :is\(\.rd-tabs,\.hd-tabs\)\{top:0;/);
  assert.match(sec, /@media \(prefers-reduced-motion:reduce\)\{\s*\.chat-page\[data-panel="open"\] \.chat-panel\{animation:none;\}/);
  assert.match(sec, /animation:crp-in \.24s cubic-bezier\(\.2,\.7,\.3,1\) backwards;/, 'no transform is kept once the slide-in ends');
  assert.match(sec, /\.crp \.rd-questions \.gate-actions \.btn\{flex:0 1 auto;max-width:100%;white-space:normal;/, 'answer buttons wrap inside the card');
  assert.match(sec, /\.crp \.crp-head > :is\(\.rd-banners,\.hd-banners\):not\(:has\(> :not\(\[hidden\]\)\)\)\{display:none;\}/);
  assert.match(sec, /\.chat-page\[data-panel="open"\] \.chat-panel:focus\{outline:none;\}/);
  assert.match(sec, /\.crp \.rd-bar-end\{[^}]*flex-wrap:nowrap;/, 'the bar never wraps, paused (Resume split) included');
  assert.match(sec, /\.crp \.rd-bar-end > \.rd-night-wrap\{flex:0 1 auto;min-width:72px;\}/, 'the Away select gives way first');
  assert.match(sec, /\.crp \.rd-bar \.rd-night\{[^}]*min-width:0;/);
  assert.match(sec, /\.chat-page\[data-panel="open"\] \.chat-convo\{container:chat-convo \/ inline-size;\}/, 'the squeezed conversation is a container');
  assert.match(sec, /@container chat-convo \(max-width:520px\)\{\s*\.chat-page \.ask-meter-cost,\.chat-page \.ask-voice-caret,\.chat-page \.ask-model-btn-effort\{display:none;\}/, 'its composer drops what a phone drops');
  assert.match(sec, /@container chat-convo \(max-width:420px\)\{[^}]*\}\s*\.chat-page \.ask-composer-row > \.ask-meter\{display:none;\}/);
  assert.match(sec, /@container crp \(max-width:560px\)\{[^@]*\.crp :is\(\.rd-tab,\.hd-tab\) > svg\{display:none;\}/, 'two tab rows, not three, in a narrow panel');
  assert.doesNotMatch(sec, /radial-gradient/, 'U8: no dotted backgrounds in the panel');
  assert.doesNotMatch(sec, /border-left/, 'no coloured left-edge lines');
  assert.doesNotMatch(sec, /!important/);
});

test('the banners sit in the panel head: a run paused on an error shows its cause there', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused', pauseReason: 'error', pauseDetail: 'npm test failed' })]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  const banners = screen.querySelector('.rd-details > .crp-head > .rd-banners');
  assert.ok(banners, 'the banners moved out of the glance');
  assert.ok(banners.querySelector('.pause-error-banner'), 'the error-pause banner is painted there');
  assert.equal(screen.querySelectorAll('.rd-banners').length, 1);
});

test('the saved screen moves its banners to the head too', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  assert.ok(screen.querySelector('.hd-details > .crp-head > .hd-banners'));
  assert.equal(screen.querySelectorAll('.hd-banners').length, 1);
});

test('a Q&A route with a waiting question moves focus to it', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  ctx.dispatch({ type: 'question', runId: 'r1', id: 'gate-1', kind: 'gate', issues: [{ severity: 'minor', title: 'Naming', detail: 'foo -> bar' }] });
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/qa');
  assert.ok(screen.querySelector('.crp-head > .rd-questions').contains(ctx.window.document.activeElement));
});

test('a gate pip clicked in the panel Workflow tab keeps the panel on Details and its address', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, color: 'violet',
    ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
  const stepper = { version: 2, template: { id: 'wf_k', name: 'K' }, graph: {
    nodes: [agent('n_plan', 'planner'), { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
    wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] } };
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper, steps: [], active: [] });
  ctx.dispatch({ type: 'question', runId: 'r1', id: 'gate-1', kind: 'gate', issues: [{ severity: 'minor', title: 'Naming', detail: 'foo -> bar' }] });
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/workflow');
  const host = screen.querySelector('.rd-sec[data-sec="workflow"] .run-flow.gv-host');
  assert.ok(host, 'the Workflow graph is mounted');
  const pip = ctx.window.document.createElement('span');
  pip.className = 'ngate';
  pip.dataset.wireId = 'w1';
  host.appendChild(pip);
  click(ctx, pip);
  await ctx.settle();
  assert.equal(screen.dataset.mode, 'details');
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/workflow');
});

test("the saved screen's facts row in the panel head is painted (Time · Cost · Changes), not left empty", async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  const facts = screen.querySelector('.hd-details > .crp-head .rd-facts');
  assert.ok(facts, 'precondition: the row moved to the head');
  assert.ok(facts.children.length > 0 && facts.textContent.trim() !== '', 'its tiles are painted');
});

test('a routed tab under a waiting question scrolls the Details pane to the tab row (Expand → Workflow shows the graph, not the question)', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  ctx.dispatch({ type: 'question', runId: 'r1', id: 'gate-1', kind: 'gate', issues: [{ severity: 'minor', title: 'Naming', detail: 'foo -> bar' }] });
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  const pane = screen.querySelector('.rd-details');
  const tabs = screen.querySelector('.rd-tabs');
  // jsdom has no layout: the question block above the tabs is 1298px tall, the pane starts at 110px.
  let top = 0;
  Object.defineProperty(pane, 'scrollTop', { get: () => top, set: (v) => { top = v; }, configurable: true });
  pane.getBoundingClientRect = () => ({ top: 110 });
  tabs.getBoundingClientRect = () => ({ top: Math.max(110, 1408 - top) });   // sticky at the pane's top once reached
  await openPanel(ctx, 'r1');                        // Open run (no tab) again
  assert.equal(top, 0, 'Open run (no tab) shows the question first');
  await openPanel(ctx, 'r1/workflow');               // P3's Expand
  assert.equal(screen.querySelector('.rd-tab.active').dataset.sec, 'workflow');
  assert.equal(top, 1298, 'the tab row is at the top of the pane');
  await openPanel(ctx, 'r1/logs');                   // already there: the sticky row stays put
  assert.equal(top, 1298);
  ctx.dispatch({ type: 'question-resolved', runId: 'r1', id: 'gate-1' });
  await ctx.settle();
  top = 0;
  await openPanel(ctx, 'r1/diff');                   // no question above the tabs: nothing to scroll past
  assert.equal(top, 0);
});

test('below 900px the panel is a full-screen sheet: the page behind it is inert while it is open, and only what the panel made inert comes back', async () => {
  const sheet = (q) => ({ media: q, matches: q === '(max-width:900px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const ctx = await bootChat({ matchMedia: sheet });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  const doc = ctx.window.document;
  const behind = () => [doc.getElementById('side-rail'), ...doc.querySelectorAll('[data-chat-page] > :not([data-chat-panel])')];
  const topnav = doc.getElementById('topnav');
  topnav.setAttribute('inert', '');                  // inert for its own reason (e.g. the phone drawer)
  await openPanel(ctx, 'r1');
  assert.ok(behind().length >= 3);
  for (const n of behind()) assert.ok(n.hasAttribute('inert'), `${n.className} is inert behind the sheet`);
  assert.equal(panelOf(ctx).closest('[inert]'), null, 'the sheet itself stays live');
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  for (const n of behind()) assert.equal(n.hasAttribute('inert'), false, `${n.className} is live again`);
  assert.ok(topnav.hasAttribute('inert'), 'what was inert before the panel stays inert');

  // A wide window has no sheet: nothing behind the panel goes inert.
  const wide = await bootChat();
  hello(wide, [liveRun()]);
  await wide.settle();
  await openPanel(wide, 'r1');
  assert.equal(wide.window.document.getElementById('side-rail').hasAttribute('inert'), false);
  assert.equal(wide.window.document.querySelector('[data-chat-page] .chat-convo').hasAttribute('inert'), false);
});

test('style.css "Chat P4: run panel": the Logs filter row wraps in the panel and its selects keep their width', () => {
  const css = readFileSync(cssPath, 'utf8');
  const start = css.indexOf('/* ===== Chat P4: run panel ===== */');
  assert.ok(start >= 0, 'the P4 section exists');
  const sec = css.slice(start);
  assert.match(sec, /\.crp \.log-filters\{flex-wrap:wrap;row-gap:6px;\}/);
  assert.match(sec, /\.crp \.log-filters select\.log-f\{flex:0 0 auto;\}/);
});

test('the window narrowing into the sheet while the composer holds focus moves focus into the panel (inert would drop it to <body>)', async () => {
  let narrow = false;
  const subs = [];
  const mq = (q) => ({
    media: q,
    get matches() { return q === '(max-width:900px)' && narrow; },
    addEventListener(type, fn) { if (q === '(max-width:900px)' && type === 'change') subs.push(fn); },
    removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const ctx = await bootChat({ matchMedia: mq });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await openPanel(ctx, 'r1');
  const doc = ctx.window.document;
  const input = doc.querySelector('[data-chat-page] textarea.ask-input');
  input.focus();
  assert.equal(doc.activeElement, input, 'the user typed beside the panel');
  narrow = true;
  for (const fn of subs) fn({ matches: true, media: '(max-width:900px)' });
  assert.ok(doc.querySelector('[data-chat-page] .chat-convo').hasAttribute('inert'), 'the conversation is behind the sheet now');
  assert.equal(doc.activeElement, panelOf(ctx), 'focus is in the sheet, not on a control it covers');
  narrow = false;
  for (const fn of subs) fn({ matches: false, media: '(max-width:900px)' });
  assert.equal(doc.querySelector('[data-chat-page] .chat-convo').hasAttribute('inert'), false);
  assert.equal(doc.activeElement, panelOf(ctx));
});

test('opening the sheet from a control behind it still hands focus back to that control on Close', async () => {
  const sheet = (q) => ({ media: q, matches: q === '(max-width:900px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const ctx = await bootChat({ matchMedia: sheet });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  ctx.go('chat');
  await ctx.settle();
  const doc = ctx.window.document;
  const card = doc.createElement('button');            // stands in for the chat card's Open run, behind the sheet
  doc.querySelector('[data-chat-page] .chat-convo').appendChild(card);
  card.focus();
  await openPanel(ctx, 'r1');
  assert.equal(doc.activeElement, panelOf(ctx), 'focus moved into the sheet');
  click(ctx, screenOf(ctx).querySelector('.crp-close'));
  await ctx.settle();
  assert.equal(card.closest('[inert]'), null, 'released before the hand-back');
  assert.equal(doc.activeElement, card, 'focus is back on the opener');
});
