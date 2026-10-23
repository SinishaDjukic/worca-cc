// worca Chat P4: Escape closes the run panel when pressed inside it (or with focus nowhere). It does not
// when a dialog is up, a menu is open, a field or a waiting question holds the focus, the key was typed outside
// the panel (the composer), or the panel is not on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootChat, liveRun, hello, openPanel, panelOf, screenOf, click, esc, ROW } from './helpers/chat-panel-boot.mjs';

// A form ask with a conditional textarea (test/ui-ask-form-panel.test.mjs's, as P3's ui-chat-run-controls reuses it).
const FORM_ASK = { type: 'question', runId: 'r1', id: 'questions-x:n_plan:2-r1', askId: 'questions-x_n_plan_2-r1', kind: 'form', agent: 'planner', nodeId: 'n_plan', surface: 'any',
  form: 'review-mockups', version: 1, title: 'Review mockups', data: { summary: 'Two directions.' },
  layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'changes' } }],
  answerSchema: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['approve', 'changes'] }, notes: { type: 'string', maxLength: 4000 } } },
  files: [] };
// A two-node v2 graph for the Workflow tab (ui-chat-panel.test.mjs's).
const agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
const STEPPER = { version: 2, template: { id: 'wf_k', name: 'K' }, graph: {
  nodes: [agent('n_plan', 'planner'), { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] } };
// Phone width for the nav drawer: only app.js's PHONE_NAV_QUERY matches.
const phoneMedia = (q) => ({ media: q, matches: q === '(max-width:760px)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

async function bootLive() {
  const ctx = await bootChat();
  hello(ctx, [liveRun()]);
  await ctx.settle();
  return ctx;
}

test('Escape inside the panel closes it and steps the address back', async () => {
  const ctx = await bootLive();
  await openPanel(ctx, 'r1');
  esc(ctx, ctx.window.document.activeElement);   // focus moved into the panel when it opened
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(ctx.window.location.hash, '#chat');
});

test('Escape while the Stop dialog is up leaves the panel open', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  click(ctx, screen.querySelector('.rd-stop'));
  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  esc(ctx, ctx.window.document.activeElement || ctx.window.document.body);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
});

test('Escape typed outside the panel is not the panel\'s', async () => {
  const ctx = await bootLive();
  await openPanel(ctx, 'r1');
  const doc = ctx.window.document;
  const outside = doc.createElement('button');   // stands in for the composer
  doc.querySelector('[data-view="chat"]').appendChild(outside);
  outside.focus();
  esc(ctx, outside);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
});

test("Escape while any .viewer-modal is up (P5's artifact popup) is the popup's, and the panel stays", async () => {
  const ctx = await bootLive();
  await openPanel(ctx, 'r1');
  const doc = ctx.window.document;
  const popup = doc.createElement('div');   // stands in for P5's body-level div.viewer-modal.apv[data-artifact-viewer]
  popup.className = 'viewer-modal apv';
  popup.setAttribute('data-artifact-viewer', '');
  doc.body.appendChild(popup);
  esc(ctx, doc.activeElement);   // focus is still in the panel
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
  popup.remove();
  esc(ctx, doc.activeElement);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true, 'with the popup gone, Escape is the panel\'s again');
});

test('Escape typed in an answer field keeps the panel and the draft; a select in the bar keeps it too', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  ctx.dispatch(FORM_ASK);
  await ctx.settle();
  // The waiting question's panel: under the Details header once Task 8 lands, in the hidden glance before.
  const panel = screen.querySelector('.rd-questions .qpanel');
  panel.querySelectorAll('.af-choice')[1].dispatchEvent(new ctx.window.Event('click', { bubbles: true }));   // "changes" reveals the notes
  await ctx.settle();
  const notes = panel.querySelector('textarea');
  assert.ok(notes, 'the notes field');
  notes.focus();
  notes.value = 'half a thought';
  esc(ctx, notes);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
  assert.ok(notes.isConnected, 'the screen was not emptied');
  assert.equal(notes.value, 'half a thought');
  esc(ctx, screen.querySelector('.rd-night'));   // the bar's Away mode select
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
});

test('Escape with the Resume menu open and focus elsewhere in the panel closes the menu, not the panel', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  const more = screen.querySelector('.rd-resume-more');
  const menu = screen.querySelector('.rd-resume-menu');
  click(ctx, more);
  assert.equal(menu.hidden, false);
  panelOf(ctx).focus();                              // focus left the menu
  esc(ctx, panelOf(ctx));
  await ctx.settle();
  assert.equal(menu.hidden, true);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(panelOf(ctx).hidden, false);
});

test("Escape while the phone nav drawer is open is the drawer's", async () => {
  const ctx = await bootChat({ matchMedia: phoneMedia });
  hello(ctx, [liveRun()]);
  await ctx.settle();
  await openPanel(ctx, 'r1');
  const body = ctx.window.document.body;
  click(ctx, ctx.window.document.getElementById('mbar-menu'));
  assert.ok(body.classList.contains('nav-open'), 'the drawer is open');
  esc(ctx, body);
  await ctx.settle();
  assert.equal(body.classList.contains('nav-open'), false, 'the drawer closed');
  assert.equal(panelOf(ctx).hidden, false, 'the panel stays');
});

test('Escape with the ⋯ menu open closes the menu only', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  const doc = ctx.window.document;
  click(ctx, screen.querySelector('.hd-bar-more'));
  assert.ok(doc.querySelector('body > .wfv-menu'));
  esc(ctx, doc.activeElement);                       // focus is on the menu's first item (openMenu)
  await ctx.settle();
  assert.equal(doc.querySelector('body > .wfv-menu'), null);
  assert.equal(panelOf(ctx).hidden, false, 'openMenu stops its Escape: the panel stays');
});

test('Escape on a button of a half-answered waiting question keeps the panel and the answer', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  ctx.dispatch(FORM_ASK);
  await ctx.settle();
  const panel = screen.querySelector('.rd-questions .qpanel');
  const changes = panel.querySelectorAll('.af-choice')[1];
  changes.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  await ctx.settle();
  const notes = panel.querySelector('textarea');
  notes.value = 'half a thought';
  changes.focus();
  esc(ctx, changes);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
  assert.ok(notes.isConnected);
  assert.equal(notes.value, 'half a thought');
});

test('Escape is taken (defaultPrevented) and hands focus back to the opener', async () => {
  const ctx = await bootLive();
  const doc = ctx.window.document;
  ctx.go('chat');
  await ctx.settle();
  const opener = doc.createElement('button');
  doc.querySelector('[data-view="chat"]').appendChild(opener);
  opener.focus();
  ctx.window.__np.routeChatRunPanel(['r1']);
  const ev = esc(ctx, doc.activeElement);
  assert.equal(ev.defaultPrevented, true);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(doc.activeElement, opener);
});

test('Escape with focus nowhere (body) closes the panel', async () => {
  const ctx = await bootLive();
  await openPanel(ctx, 'r1');
  ctx.window.document.activeElement.blur();
  esc(ctx, ctx.window.document.body);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, true);
  assert.equal(ctx.window.location.hash, '#chat');
});

test('Escape on another page never routes to Chat', async () => {
  const ctx = await bootLive();
  ctx.go('runs');
  await ctx.settle(6);
  esc(ctx, ctx.window.document.body);
  await ctx.settle(4);
  assert.equal(ctx.window.location.hash, '#runs');
});

test('Escape while the Stop dialog is up, with focus nowhere, leaves the panel open', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  click(ctx, screen.querySelector('.rd-stop'));
  const doc = ctx.window.document;
  if (doc.activeElement && doc.activeElement !== doc.body) doc.activeElement.blur();
  esc(ctx, doc.body);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
});

for (const [name, make] of [
  ['an open <dialog>', (d) => { const x = d.createElement('dialog'); x.setAttribute('open', ''); return x; }],
  ['a running guide (.guide-layer)', (d) => { const x = d.createElement('div'); x.className = 'guide-layer'; return x; }],
]) {
  test(`Escape while ${name} is up leaves the panel open`, async () => {
    const ctx = await bootLive();
    await openPanel(ctx, 'r1');
    const doc = ctx.window.document;
    doc.body.appendChild(make(doc));
    esc(ctx, doc.activeElement);
    await ctx.settle();
    assert.equal(panelOf(ctx).hidden, false);
  });
}

test('Escape typed in the Logs search keeps the panel', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1/logs');
  const search = screen.querySelector('.log-search');
  assert.ok(search);
  search.focus();
  esc(ctx, search);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/logs');
});

test("Escape in the Workflow tab's step log drawer closes the drawer only; the panel stays", async () => {
  const ctx = await bootLive();
  ctx.dispatch({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: STEPPER, active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }],
    steps: [{ key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1, status: 'running', activeMs: 0 }] });
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1/workflow');
  const drawer = screen.querySelector('.rd-sec[data-sec="workflow"] .wf-log-drawer');
  assert.ok(drawer, 'the Workflow tab carries the drawer');
  screen.querySelector('.rd-graph [data-node-id="n_plan"]').click();
  assert.equal(drawer.hidden, false, 'a card click opened the drawer');
  const body = drawer.querySelector('.wf-log-body');
  body.focus();
  esc(ctx, body);
  await ctx.settle();
  assert.equal(drawer.hidden, true, 'the drawer closed');
  assert.equal(panelOf(ctx).hidden, false, 'the panel stays');
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/workflow');
});

test('Escape in a contenteditable field keeps the panel', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  const ed = ctx.window.document.createElement('div');
  ed.setAttribute('contenteditable', 'true');
  screen.querySelector('.rd-details').appendChild(ed);
  esc(ctx, ed);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
});

test('Escape on a button inside a diff-comment composer keeps the panel (and the draft)', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  const doc = ctx.window.document;
  const box = doc.createElement('div');
  box.className = 'hd-cmt-composer';
  const btn = doc.createElement('button');
  box.appendChild(btn);
  screen.querySelector('.hd-details').appendChild(box);
  btn.focus();
  esc(ctx, btn);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
});

test('Escape that closes the Resume menu hands focus to its caret', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  const more = screen.querySelector('.rd-resume-more');
  click(ctx, more);
  panelOf(ctx).focus();
  esc(ctx, panelOf(ctx));
  await ctx.settle();
  assert.equal(ctx.window.document.activeElement, more);
});

test('Escape that closes the ⋯ menu resets and focuses its trigger', async () => {
  const ctx = await bootChat({ rows: [ROW] });
  hello(ctx, []);
  await ctx.settle(6);
  const screen = await openPanel(ctx, ROW.id, 8);
  const more = screen.querySelector('.hd-bar-more');
  click(ctx, more);
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  esc(ctx, ctx.window.document.activeElement);
  await ctx.settle();
  assert.equal(ctx.window.document.querySelector('body > .wfv-menu'), null);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(ctx.window.document.activeElement, more);
  assert.equal(panelOf(ctx).hidden, false);
});

test('Escape with the cost breakdown open closes it, not the panel', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  const doc = ctx.window.document;
  const header = screen.querySelector('.rd-header');
  const btn = doc.createElement('button');
  btn.className = 'cost-bd-btn';
  const pop = doc.createElement('div');
  pop.className = 'cost-pop';
  header.append(btn, pop);
  panelOf(ctx).focus();
  esc(ctx, panelOf(ctx));
  await ctx.settle();
  assert.equal(pop.hidden, true);
  assert.equal(panelOf(ctx).hidden, false);
});

test('Escape with a composer popover open (focus nowhere) closes the popover, not the panel', async () => {
  const ctx = await bootLive();
  await openPanel(ctx, 'r1');
  const doc = ctx.window.document;
  const ring = doc.querySelector('[data-chat-page] [data-ask-ctx-btn]');
  assert.ok(ring, 'the composer context ring');
  click(ctx, ring);
  await ctx.settle();
  assert.ok(doc.querySelector('[data-chat-page] .ask-pop'), 'the popover is open');
  doc.activeElement.blur();
  esc(ctx, doc.body);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false, 'the panel stays');
  assert.equal(doc.querySelector('[data-chat-page] .ask-pop'), null, 'the popover closed');
});

test('only Escape closes the panel: Tab, Enter and letters on its controls never do', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  const tab = screen.querySelector('.rd-tab[data-sec="diff"]');
  for (const key of ['Tab', 'Enter', 'a', 'ArrowRight']) {
    for (const target of [tab, panelOf(ctx), ctx.window.document.body]) {
      target.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await ctx.settle();
      assert.equal(panelOf(ctx).hidden, false, `${key} on ${target.tagName}`);
    }
  }
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1');
});

test('Escape in any textarea of the panel keeps it and the draft (not only answers and comments)', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  const ta = ctx.window.document.createElement('textarea');
  screen.querySelector('.rd-details').appendChild(ta);
  ta.value = 'half a thought';
  ta.focus();
  esc(ctx, ta);
  await ctx.settle();
  assert.equal(panelOf(ctx).hidden, false);
  assert.equal(ta.value, 'half a thought');
});

test('Escape that closes the Resume menu is taken (defaultPrevented)', async () => {
  const ctx = await bootChat();
  hello(ctx, [liveRun({ status: 'paused' })]);
  await ctx.settle();
  const screen = await openPanel(ctx, 'r1');
  click(ctx, screen.querySelector('.rd-resume-more'));
  panelOf(ctx).focus();
  const ev = esc(ctx, panelOf(ctx));
  await ctx.settle();
  assert.equal(screen.querySelector('.rd-resume-menu').hidden, true);
  assert.equal(ev.defaultPrevented, true);
});

test('Escape that closes the cost breakdown hands focus back to its button', async () => {
  const ctx = await bootLive();
  const screen = await openPanel(ctx, 'r1');
  const doc = ctx.window.document;
  const header = screen.querySelector('.rd-header');
  const btn = doc.createElement('button');
  btn.className = 'cost-bd-btn';
  const pop = doc.createElement('div');
  pop.className = 'cost-pop';
  header.append(btn, pop);
  panelOf(ctx).focus();
  esc(ctx, panelOf(ctx));
  await ctx.settle();
  assert.equal(pop.hidden, true);
  assert.equal(doc.activeElement, btn);
});
