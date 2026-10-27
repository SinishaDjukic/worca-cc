// test/ui-chat-run-card.test.mjs — worca Chat P3: the chat run card view (createChatRunCard) over plain snapshots with
// stub controls and a stub card ctx — header, stats, agent chips, the Workflows graph well, the run controls, the
// inline question (answer, receipt, failure) and the result region; plus the pure helpers.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { snapshotFromState, PROGRESS_CARD_TYPE } from '../ui/public/ask-run-card.mjs';
import { createChatRunCard, createRunCardController, resultWord, resultLines, answerReceipt, autoChip, midTrunc, progressIdent, runRefOf } from '../ui/public/chat/run-card.mjs';
import { registerAskRenderer, askRendererFor, askKindOf } from '../ui/public/ask/registry.mjs';
import { RUN_STATE_ROWS, NOW } from './helpers/run-states.mjs';
import { runModel, groupModel } from '../src/shared/run-model.mjs';
import { renderGateCard, renderRecoveryCard, stepChip, stepTitle } from '../ui/public/shape/step-card.mjs';
import { renderPlanBody } from '../ui/public/shape/plan-body.mjs';
import { renderOutlineBody } from '../ui/public/shape/outline-body.mjs';
import { noteAnswer, namedAnswer, forgetAnswer } from '../ui/public/shape/step-receipt.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { ICONS } from '../ui/public/icons.mjs';
import { statusText } from '../ui/public/run-status-card.mjs';
/** The icons.mjs glyph a control leads with (its first child, an .ic span); '' when none. */
const glyphOf = (el) => { const svg = el && el.firstElementChild && el.firstElementChild.matches('.ic') ? el.firstElementChild.querySelector('svg') : null; return svg ? Object.keys(ICONS).find((k) => ICONS[k] === svg.innerHTML) || '' : ''; };

const RECORDED = JSON.parse(readFileSync(new URL('./fixtures/role-review/recorded-run.json', import.meta.url), 'utf8')).plan.roleReviews;

const trackDom = useDomRelease(afterEach);

const agent = (id, key, over = {}) => ({
  id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true }, ...over,
});
const END = { id: 'n_end', kind: 'end', key: null, x: 600, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } };
const MANIFEST = { version: 2, template: { id: 'wf_t', name: 'T' }, graph: {
  nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer', { x: 300, color: 'green' }), END],
  wires: [
    { id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_impl', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false },
  ] } };
const step = (over) => ({ key: over.executionId, stepIndex: null, cycle: over.ordinal ?? 1, status: 'done', activeMs: 1000, costUsd: 0.1, startedAt: '2026-08-26T10:00:00Z', ...over });
const STATE = (over = {}) => ({ id: 'abcd1234', title: 'Fix login', projectKey: 'proj-00000001', projectDir: '/repos/proj', status: 'running', stepper: MANIFEST,
  steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'running', runningSince: null, trigger: { wireIds: ['w1'] } })],
  active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }], totalCostUsd: 0.42, totalActiveMs: 65_000, startedAt: '2026-09-07T10:00:00Z', ...over });
const IDENT = { cardId: 'card_00000001', pipelineId: 'abcd1234', runId: 'run-uuid-1', projectKey: 'proj-00000001', workspaceId: null, title: 'Fix login', label: 'proj' };
const live = (over = {}, stateOver = {}, extras = null) => ({ ...snapshotFromState(STATE(stateOver), { now: 0, extras }), source: 'live', runId: 'run-uuid-1', ...over });
const done = (extras, over = {}) => live({ terminal: true, active: [], ...over }, { status: 'done', active: [], steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1 })] }, extras);
const settle = () => new Promise((r) => setTimeout(r, 0));

function mk({ controls = {}, ctx: ctxOver = {}, ident = {} } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><html><body></body></html>'));
  const doc = dom.window.document;
  const calls = [];
  const ctx = { openRunPanel: (...a) => calls.push(['panel', ...a]), openArtifact: (...a) => calls.push(['artifact', ...a]), announce: (t) => calls.push(['announce', t]), mountFeature: (host, id) => calls.push(['feature', host, id]), ...ctxOver };
  const refreshed = [];
  const card = createChatRunCard({ doc, win: dom.window, snapshot: null, ctx, controls, ident: { ...IDENT, ...ident }, refresh: () => refreshed.push(1) });
  doc.body.appendChild(card.el);
  const $ = (sel) => card.el.querySelector(sel);
  const $$ = (sel) => [...card.el.querySelectorAll(sel)];
  return { dom, doc, card, calls, refreshed, $, $$, win: dom.window };
}

// The run page's clarify registrant, as far as the card uses it: collect() reads the panel's answer slots.
registerAskRenderer('clarify', { render() {}, collect: (panel) => ({ answers: ((panel && panel.__answers) || []).map((s) => ({ id: s.id, question: s.question, choice: s.choice })) }) });

/** A stub controls.paintQuestion that mounts a fake question body the way app.js's renderQpanel would. */
function questionStub(q, html, answers = null) {
  const log = { painted: 0, released: 0 };
  return { log,
    paintQuestion(ref, host) {
      log.painted += 1;
      const panel = host.querySelector('.qpanel');
      if (panel.dataset.qid !== q.id) { panel.innerHTML = html; panel.classList.remove('hidden'); panel.dataset.qid = q.id; panel.__answers = answers; }
      return q;
    },
    releaseQuestion(host) { log.released += 1; const p = host.querySelector('.qpanel'); p.innerHTML = ''; delete p.dataset.qid; },
  };
}

/** A controls.paintQuestion that mounts the REAL step card (shaper-cards D4/D5): its own buttons post through a submit
 *  that notes the named receipt and resolves true, as app.js stepPost → postAnswer does. */
function stepStub(pq, render, extra = {}) {
  const log = { painted: 0, released: 0, posts: [] };
  return { log,
    paintQuestion(ref, host) {
      log.painted += 1;
      const panel = host.querySelector('.qpanel');
      if (panel.dataset.qid !== pq.id) {
        panel.replaceChildren();
        render(panel, pq, { doc: host.ownerDocument, run: {}, title: stepTitle(pq, 'Implementer'), chip: stepChip(pq, {}), tagLevel() {},
          confirm: async () => true, openFull() {}, fetchPlan: async () => null, markdown: { ensure: async () => false, render: () => ({ kind: 'plain' }) },
          ...extra, submit: async (payload) => { log.posts.push(payload); noteAnswer(ref.runId, pq, payload); return true; } });
        panel.classList.remove('hidden'); panel.dataset.qid = pq.id;
      }
      return { id: pq.id, kind: askKindOf(pq), heading: stepTitle(pq, 'Implementer'), step: 'Implementer', stepCard: true };
    },
    releaseQuestion(host) { log.released += 1; const p = host.querySelector('.qpanel'); p.replaceChildren(); delete p.dataset.qid; },
  };
}
const outlineSlice = (id) => ({ id, title: `Run ${id}`, goal: `Goal ${id}`, inScope: [], outOfScope: [], acceptance: ['works'], dependsOn: [], estimate: 'medium' });

test('resultLines: the result block says only what the status line does not', () => {
  const st = (m) => statusText(m);
  assert.deepEqual(resultLines({ title: 'In review', sub: '' }, st({ word: 'In review', line: 'In review' })), { title: '', sub: '' });
  assert.deepEqual(resultLines({ title: 'Failed', sub: 'Step: Build · see Logs for the error' }, st({ word: 'Failed', line: 'Build · failed · Implementation' })),
    { title: '', sub: 'Step: Build · see Logs for the error' });
  assert.deepEqual(resultLines({ title: 'Applied', sub: '3 files changed' }, st({ word: 'Applied', line: 'Applied · 3 files changed' })), { title: '', sub: '' });
  assert.deepEqual(resultLines({ title: 'PR closed', sub: 'Closed without merging' }, st({ word: 'Ready', line: 'Ready' })),
    { title: 'PR closed', sub: 'Closed without merging' });
});

test('chat run card: head, sub-line, stats, agent chips with model + cycle, Auto, the Workflows well, Open run and Expand', async () => {
  await checkRows([
    { name: 'a live snapshot paints the head, stats and chips; the graph is the run-hosts card well', run: async () => {
      const { card, $, calls } = mk();
      card.update(live());
      assert.ok(card.el.classList.contains('ask-card') && card.el.classList.contains('chat-rc'));
      // Runs redesign slice 4 (D10): dot · title · kind chip · Open; no kicker, no pill (one statement of status).
      assert.equal($('.ask-rc-kicker'), null);
      assert.equal($('.ask-rc-pill'), null);
      assert.equal($('.ask-rc-head > .status-dot').dataset.state, 'working');
      assert.equal($('.ask-rc-head > .kind-chip').hidden, true, 'a single run has no chip (#959)');
      assert.equal($('.chat-rc-status.run-status').dataset.state, 'working');
      assert.equal($('.ask-rc-title').textContent, 'Fix login');
      assert.equal($('.ask-rc-sub').textContent, 'proj');
      assert.equal($('.chat-rc-where').title, 'Run abcd1234');
      assert.equal($('.ask-rc-time').textContent, '1m 5s');
      assert.equal($('.ask-rc-cost').textContent, '$0.42');
      assert.equal($('.ask-rc-prog'), null, 'no Progress tile repeating the status line (Known bug 9)');
      assert.equal($('.chat-rc-agent .chat-rc-agent-name').textContent, 'Implementer');
      const well = $('.chat-rc-well');
      assert.equal(well.hidden, false);
      assert.ok(well.classList.contains('run-flow-wrap') && well.classList.contains('gv-wrap-card'), 'the run-hosts card mode, inside a .run-flow-wrap');
      assert.ok($('.chat-rc-graph .node[data-node-id="n_impl"]').classList.contains('is-active'));
      assert.equal(well.getAttribute('aria-label'), 'Workflow graph: Planner → Implementer');
      $('a.ask-rc-open').click();
      assert.equal(calls[0][0], 'panel');
      assert.deepEqual({ runId: calls[0][1].runId, pipelineId: calls[0][1].pipelineId, projectKey: calls[0][1].projectKey }, { runId: 'run-uuid-1', pipelineId: 'abcd1234', projectKey: 'proj-00000001' });
      assert.deepEqual(calls[0][2], {});
      assert.equal($('.chat-rc-expand').getAttribute('aria-label'), 'Expand');
      assert.equal($('a.ask-rc-open').textContent, 'Open ›');
    } },
    { name: 'chips name the model and the cycle; the agent a question waits on turns amber', run: async () => {
      const { card, $ } = mk();
      card.update(live({ active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2', label: 'Implementer', color: 'green', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', cycle: 2 }],
        pendingQuestion: { id: 'q-1', kind: 'questions', nodeId: 'n_impl', questions: [{}] } }));
      const chip = $('.chat-rc-agent');
      assert.equal(chip.querySelector('.chat-rc-agent-model').textContent, 'Opus 5.5');
      assert.equal(chip.querySelector('.chat-rc-agent-model').title, 'Opus 5.5', 'a model id the chip cuts off stays readable');
      assert.equal(chip.querySelector('.chat-rc-agent-cycle').textContent, 'cycle 2');
      assert.ok(chip.classList.contains('is-waiting'));
      assert.equal(chip.style.getPropertyValue('--c'), 'var(--amber)');
      assert.equal($('.chat-rc-status').dataset.state, 'needs-you');
      assert.match($('.chat-rc-status').dataset.text, /needs you · 1 question$/i);
    } },
    { name: 'Auto: the sub-line chip names the adopted workflow; while deciding the well says so and draws no graph — and, like the run page, says when the run waits, is parked or never decided', run: async () => {
      const { card, $ } = mk();
      card.update(live({ auto: { status: 'decided', via: 'created' } }));
      assert.equal($('.chat-rc-auto').hidden, false);
      assert.equal($('.chat-rc-auto').textContent, 'Auto → T');
      card.update(live({ auto: { status: 'deciding' }, stepper: null, decor: null, progress: null, active: [] }));
      assert.equal($('.chat-rc-auto').textContent, 'Auto');
      assert.equal($('.chat-rc-deciding').hidden, false);
      assert.equal($('.chat-rc-deciding').textContent, 'Auto is deciding the workflow');
      assert.equal($('.chat-rc-well').getAttribute('aria-label'), 'Auto is deciding the workflow', 'the deciding well is a named group');
      assert.equal($('.chat-rc-graph .gv-stage'), null);
      // The run page's A24 words (app.js paintAutoDeciding): never "deciding" on a run that waits, is parked or is over.
      const deciding = { auto: { status: 'deciding' }, stepper: null, decor: null, progress: null, active: [] };
      card.update(live({ ...deciding, pendingQuestion: { id: 'w-1', kind: 'workflow' } }));
      assert.equal($('.chat-rc-deciding').textContent, 'Waiting for your decision');
      card.update(live({ ...deciding, status: 'paused' }));
      assert.equal($('.chat-rc-deciding').textContent, 'Paused before deciding');
      card.update(live({ ...deciding, status: 'interrupted' }));
      assert.equal($('.chat-rc-deciding').textContent, 'Paused before deciding');
      card.update(live({ ...deciding, status: 'stopped', terminal: true }));
      assert.equal($('.chat-rc-deciding').textContent, 'Auto did not decide a workflow');
      assert.equal($('.chat-rc-well').getAttribute('aria-label'), 'Auto did not decide a workflow');
      card.update(live({ ...deciding, status: 'running' }));
      assert.equal($('.chat-rc-deciding').textContent, 'Auto is deciding the workflow', 'a resumed run decides again');
    } },
    { name: 'an engine that reports no cost reads "cost unknown"; a null update keeps the last paint', run: async () => {
      const { card, $ } = mk();
      card.update(live({ costUsd: null }));
      assert.equal($('.ask-rc-cost').textContent, 'cost unknown');
      card.update(null);
      assert.equal($('.ask-rc-title').textContent, 'Fix login', 'D24: never regress to Starting');
    } },
  ]);
});

test('chat run card Expand: the same live graph, large, in an overlay over the chat — nothing navigates, Esc / Close / the backdrop close it', async () => {
  const overlay = (doc) => doc.querySelector('body > .viewer-modal.chat-rc-zoom');
  const esc = (doc, win) => (doc.activeElement || doc.body).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await checkRows([
    { name: 'a click opens a body-level dialog holding the same run\'s graph in a monitor host with the zoom cluster; openRunPanel is not called', run: async () => {
      const { card, $, doc, calls, win } = mk();
      card.update(live());
      const href = win.location.href;
      const expand = $('.chat-rc-expand');
      assert.equal(expand.getAttribute('aria-haspopup'), 'dialog');
      expand.focus();
      expand.click();
      const ov = overlay(doc);
      assert.ok(ov, 'the overlay is open, outside the card');
      assert.equal(ov.getAttribute('role'), 'dialog');
      assert.equal(ov.getAttribute('aria-modal'), 'true');
      assert.equal(doc.getElementById(ov.getAttribute('aria-labelledby')).textContent, 'Fix login');
      const wrap = ov.querySelector('.run-flow-wrap');
      assert.ok(wrap.classList.contains('gv-wrap-monitor'), 'the run monitor host: its status styling, pan and zoom');
      assert.ok(wrap.querySelector(':scope > .gv-nav'), 'the .gv-nav cluster');
      assert.ok(ov.querySelector('.run-flow .node[data-node-id="n_impl"]').classList.contains('is-active'), 'the same run, live state');
      assert.equal(calls.filter((c) => c[0] === 'panel').length, 0, 'Expand never opens the run');
      assert.equal(win.location.href, href, 'the hash is unchanged');
      assert.equal(doc.activeElement, ov.querySelector('.chat-rc-zoom-close'), 'the focus moves into the dialog');
      assert.equal(ov.querySelector('.chat-rc-zoom-close').textContent, 'Close');
      expand.click();
      assert.equal(doc.querySelectorAll('.chat-rc-zoom').length, 1, 'one overlay at a time');
    } },
    { name: 'it stays live: a card update repaints the overlay\'s graph', run: async () => {
      const { card, doc, $ } = mk();
      card.update(live());
      $('.chat-rc-expand').click();
      card.update(done());
      const node = overlay(doc).querySelector('.run-flow .node[data-node-id="n_impl"]');
      assert.ok(node.classList.contains('is-done') && !node.classList.contains('is-active'), 'the step settled in the overlay too');
    } },
    { name: 'Escape closes it and the focus goes back to Expand', run: async () => {
      const { card, doc, $, win } = mk();
      card.update(live());
      $('.chat-rc-expand').focus();
      $('.chat-rc-expand').click();
      esc(doc, win);
      await settle();
      assert.equal(overlay(doc), null);
      assert.equal(doc.activeElement, $('.chat-rc-expand'));
    } },
    { name: 'Close and a backdrop click close it; a click inside the card does not', run: async () => {
      const { card, doc, $, win } = mk();
      card.update(live());
      $('.chat-rc-expand').click();
      overlay(doc).querySelector('.chat-rc-zoom-close').click();
      assert.equal(overlay(doc), null);
      assert.equal(doc.activeElement, $('.chat-rc-expand'));
      $('.chat-rc-expand').click();
      const ov = overlay(doc);
      const press = (el) => { el.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
      press(ov.querySelector('.wf-pop-card'));
      await settle();
      assert.ok(overlay(doc), 'a press on the dialog card is not an outside click');
      press(ov);
      await settle();
      assert.equal(overlay(doc), null);
      assert.equal(doc.activeElement, $('.chat-rc-expand'));
    } },
    { name: 'Tab and shift+Tab wrap around the dialog\'s controls; the focus never walks out into the chat', run: async () => {
      const { card, doc, $, win } = mk();
      card.update(live());
      $('.chat-rc-expand').click();
      const ov = overlay(doc);
      const stops = [...ov.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')].filter((n) => !n.closest('[hidden]'));
      const first = stops[0], last = stops[stops.length - 1];
      assert.equal(first, ov.querySelector('.chat-rc-zoom-open'), 'the first stop is Open run');
      assert.ok(last.closest('.gv-nav'), 'the last stop is in the zoom cluster');
      const tab = (shiftKey) => {
        const e = new win.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
        doc.activeElement.dispatchEvent(e);
        return e.defaultPrevented;
      };
      last.focus();
      assert.equal(tab(false), true);
      assert.equal(doc.activeElement, first, 'Tab on the last stop wraps to the first');
      assert.equal(tab(true), true);
      assert.equal(doc.activeElement, last, 'shift+Tab on the first stop wraps to the last');
      ov.querySelector('.chat-rc-zoom-close').focus();
      assert.equal(tab(false), false, 'a Tab between stops is left to the browser');
      assert.equal(doc.activeElement, ov.querySelector('.chat-rc-zoom-close'));
    } },
    { name: 'a close while Expand is hidden or gone does not refocus it, and never scrolls the chat', run: async () => {
      const { card, doc, $ } = mk();
      card.update(live());
      const expand = $('.chat-rc-expand');
      const seen = [];
      expand.focus = (opts) => seen.push(opts);
      expand.click();
      overlay(doc).querySelector('.chat-rc-zoom-close').click();
      assert.deepEqual(seen, [{ preventScroll: true }], 'Close refocuses Expand without scrolling');
      expand.click();
      card.update(live({ auto: { status: 'deciding' }, stepper: null, decor: null, progress: null, active: [] }));
      assert.equal(overlay(doc), null);
      assert.equal(seen.length, 1, 'a hidden Expand is not refocused');
      card.update(live());
      expand.click();
      card.destroy();
      assert.equal(overlay(doc), null);
      assert.equal(seen.length, 1, 'a card torn down does not refocus its Expand');
    } },
    { name: 'Open run is the one way on: it closes the overlay and opens the run\'s Workflow tab', run: async () => {
      const { card, doc, $, calls } = mk();
      card.update(live());
      $('.chat-rc-expand').click();
      overlay(doc).querySelector('.chat-rc-zoom-open').click();
      assert.equal(overlay(doc), null);
      const panel = calls.filter((c) => c[0] === 'panel');
      assert.equal(panel.length, 1);
      assert.equal(panel[0][1].pipelineId, 'abcd1234');
      assert.deepEqual(panel[0][2], { tab: 'workflow' });
    } },
    { name: 'Expand stays hidden while nothing is drawable; a graph that goes away or a card torn down takes the overlay with it', run: async () => {
      const { card, doc, $ } = mk();
      const deciding = { auto: { status: 'deciding' }, stepper: null, decor: null, progress: null, active: [] };
      card.update(live(deciding));
      assert.equal($('.chat-rc-expand').hidden, true);
      card.update(live());
      assert.equal($('.chat-rc-expand').hidden, false);
      $('.chat-rc-expand').click();
      card.update(live(deciding));
      assert.equal($('.chat-rc-expand').hidden, true);
      assert.equal(overlay(doc), null, 'no overlay of a graph the card no longer draws');
      card.update(live());
      $('.chat-rc-expand').click();
      card.destroy();
      assert.equal(overlay(doc), null);
    } },
  ]);
});

test('chat run card controls: Pause / Resume / Stop through `controls`, disabled by status, errors shown in the card', async () => {
  await checkRows([
    { name: 'running: Pause calls controls.pause(ref, button); a refusal is shown in the card', run: async () => {
      const seen = [];
      const { card, $ } = mk({ controls: { pause: (ref, btn) => { seen.push([ref.runId, btn]); return Promise.resolve('CANNOT_PAUSE'); } } });
      card.update(live());
      assert.equal($('.chat-rc-foot').hidden, false);
      assert.equal($('.chat-rc-pause').textContent, 'Pause');
      assert.equal($('.chat-rc-pause').disabled, false);
      assert.equal($('.chat-rc-stop').hidden, false);
      $('.chat-rc-pause').click();
      await settle();
      assert.deepEqual(seen, [['run-uuid-1', $('.chat-rc-pause')]]);
      assert.equal($('.chat-rc-err').hidden, false);
      assert.equal($('.chat-rc-err').textContent, 'Could not pause: CANNOT_PAUSE. Try again.');
    } },
    { name: 'an accepted pause keeps Pause off while the run still reads running (one POST); the next status re-arms the button', run: async () => {
      let n = 0;
      const { card, $ } = mk({ controls: { pause: () => { n += 1; return Promise.resolve(null); } } });
      card.update(live());
      $('.chat-rc-pause').click();
      await settle();
      assert.equal($('.chat-rc-pause').disabled, true, 'the pausing frame has not landed yet');
      assert.equal($('.chat-rc-pause').textContent, 'Pausing…');
      card.update(live());                                   // another frame, still `running`
      $('.chat-rc-pause').click();
      await settle();
      assert.equal(n, 1, 'one controls.pause call');
      assert.equal($('.chat-rc-err').hidden, true);
      card.update(live({ status: 'paused', active: [] }));
      assert.equal($('.chat-rc-pause').textContent, 'Resume');
      assert.equal($('.chat-rc-pause').disabled, false);
    } },
    { name: 'starting and pausing disable Pause; paused and interrupted offer Resume; interrupted disables Stop (R7)', run: async () => {
      const resumed = [];
      const { card, $ } = mk({ controls: { resume: (ref, btn) => { resumed.push(btn); return Promise.resolve(); } } });
      card.update(live({ status: 'starting', active: [] }));
      assert.equal($('.chat-rc-pause').disabled, true);
      card.update(live({ status: 'pausing' }));
      assert.equal($('.chat-rc-pause').textContent, 'Pausing…');
      assert.equal($('.chat-rc-pause').disabled, true);
      const resumes = [...card.el.querySelectorAll('[data-model-action="resume"]')].filter((b) => !b.hidden);
      assert.ok(resumes.length, 'the model lists resume while pausing');
      assert.deepEqual(resumes.filter((b) => !b.disabled).map((b) => b.className), [], 'no enabled Resume while still pausing (D4)');
      card.update(live({ status: 'paused', active: [] }));
      assert.equal($('.chat-rc-pause').textContent, 'Resume');
      assert.equal($('.chat-rc-pause').disabled, false);
      $('.chat-rc-pause').click();
      await settle();
      assert.deepEqual(resumed, [$('.chat-rc-pause')]);
      card.update(live({ status: 'interrupted', active: [] }));
      assert.equal($('.chat-rc-pause').textContent, 'Resume');
      assert.equal($('.chat-rc-stop').hidden, true, 'an interrupted run is never stoppable: the model offers Archive instead');
      assert.ok($('.chat-rc [data-model-action="archive"]'), 'Archive takes an interrupted run');
    } },
    { name: 'a run this tab holds no live model of (a REST snapshot) offers Stop only while paused: /api/stop {pipelineId} stops a paused row, never a run another process drives', run: async () => {
      const { card, $ } = mk();
      const rest = (over) => ({ ...live(over), source: 'rest', runId: null });
      for (const status of ['starting', 'running', 'pausing']) {
        card.update(rest({ status }));
        assert.equal($('.chat-rc-foot').hidden, false, status);
        assert.equal($('.chat-rc-stop').hidden, false, `${status}: the model lists Stop`);
        assert.equal($('.chat-rc-stop').disabled, true, `${status}: nothing in this tab can stop it`);
        assert.equal($('.chat-rc-stop').title, 'Open the run to stop it');
      }
      card.update(rest({ status: 'paused', active: [] }));
      assert.equal($('.chat-rc-stop').disabled, false, 'a paused row stops by pipeline id');
      card.update(live());
      assert.equal($('.chat-rc-stop').disabled, false, 'the live model arrived (hello): Stop is back');
      assert.equal($('.chat-rc-stop').title, 'Stop this run');
    } },
    { name: 'Stop calls controls.stop(ref, onStopped); onStopped asks the owner to refresh; a Ready run\'s Ship it is the result\'s Create pull request', run: async () => {
      let stopped = null;
      const { card, $, refreshed } = mk({ controls: { stop: (ref, onStopped) => { stopped = [ref.pipelineId, onStopped]; } } });
      card.update(live());
      $('.chat-rc-stop').click();
      assert.equal(stopped[0], 'abcd1234');
      stopped[1]();
      assert.equal(refreshed.length, 1);
      card.update(done(null));
      assert.equal($('.chat-rc-foot').hidden, true, 'the footer holds nothing: Ship it is the result\'s button');
      assert.equal($('.chat-rc-create-pr').dataset.modelAction, 'ship');
      // PR controls (design system): a small primary button led by the pr-create glyph at 14px.
      assert.deepEqual([...$('.chat-rc-create-pr').classList], ['btn', 'btn-sm', 'btn-primary', 'chat-rc-create-pr']);
      assert.equal(glyphOf($('.chat-rc-create-pr')), 'pr-create');
      assert.equal($('.chat-rc-create-pr .ic').style.width, '14px');
      assert.equal($('.chat-rc-create-pr').textContent, 'Create PR');
    } },
  ]);
});

test('chat run card question: the run page body mounts through controls.paintQuestion, answers go to controls.answer, a receipt follows the resolution', async () => {
  const CLARIFY = { id: 'q-1', kind: 'clarify', heading: 'A question from Planner', step: 'Planner' };
  const PQ = { id: 'q-1', kind: 'questions', nodeId: 'n_plan', questions: [{ id: 'q1', question: 'Which database?' }] };
  const BODY = '<button class="qopt">Postgres</button><div class="qpanel-foot"><button class="btn btn-primary" data-qpanel-submit>Submit</button></div>';
  await checkRows([
    { name: 'a clarify answer posts the collected answers under the QUESTION id, then the receipt counts them', run: async () => {
      const q = questionStub(CLARIFY, BODY, [{ id: 'q1', question: 'Which database?', choice: 'Postgres' }]);
      const answers = [];
      const { card, $, calls } = mk({ controls: { ...q, answer: (ref, id, payload) => { answers.push([ref.runId, id, payload]); return Promise.resolve(true); } } });
      card.update(live({ pendingQuestion: PQ }));
      assert.equal($('.chat-rc-q').hidden, false);
      assert.equal($('.chat-rc-q-head').textContent, 'A question from Planner');
      $('.chat-rc-q .btn-primary').click();
      await settle();
      assert.deepEqual(answers, [['run-uuid-1', 'q-1', { answers: [{ id: 'q1', question: 'Which database?', choice: 'Postgres' }] }]]);
      assert.deepEqual(calls.at(-1), ['announce', 'Answer sent']);
      card.update(live());
      assert.equal($('.chat-rc-receipt').hidden, false);
      assert.equal($('.chat-rc-receipt summary').textContent, '1 answer sent · Planner');
      assert.equal($('.chat-rc-receipt li').textContent, 'Which database? → Postgres');
      assert.ok(q.log.released >= 1, 'the panel was handed back');
    } },
    { name: 'an answer that does not land says so in the card and keeps the question', run: async () => {
      const q = questionStub(CLARIFY, BODY, [{ id: 'q1', question: 'Which database?', choice: '' }]);
      const { card, $ } = mk({ controls: { ...q, answer: () => Promise.resolve(false) } });
      card.update(live({ pendingQuestion: PQ }));
      $('.chat-rc-q .btn-primary').click();
      await settle();
      assert.equal($('.chat-rc-q-err').hidden, false);
      assert.equal($('.chat-rc-q-err').textContent, 'Answer not sent. It is still in the form; check the connection and send it again.');
      assert.equal($('.chat-rc-receipt').hidden, true);
      assert.ok($('.chat-rc-q .btn-primary'), 'the form is still there');
    } },
    { name: 'a question that goes away because the run paused or was interrupted leaves no "Answered" receipt; one answered elsewhere while the run goes on does', run: async () => {
      const q = questionStub(CLARIFY, BODY, []);
      const { card, $ } = mk({ controls: q });
      card.update(live({ pendingQuestion: PQ }));
      card.update(live({ status: 'paused', pendingQuestion: null, active: [] }));
      assert.equal($('.chat-rc-receipt').hidden, true);
      assert.equal($('.chat-rc-q').hidden, true);
      card.update(live({ pendingQuestion: PQ }));
      card.update(live({ status: 'interrupted', pendingQuestion: null, active: [] }));
      assert.equal($('.chat-rc-receipt').hidden, true);
      card.update(live({ pendingQuestion: PQ }));
      card.update(live());
      assert.equal($('.chat-rc-receipt').hidden, false);
      assert.equal($('.chat-rc-receipt summary').textContent, 'Answered · Planner');
    } },
    { name: 'the real gate card posts {decision} itself and the receipt names it: Another cycle started; the step head says it once', run: async () => {
      const pq = { id: 'rc-gate-1', kind: 'gate', nodeId: 'n_impl', issues: [] };
      const q = stepStub(pq, renderGateCard);
      const answers = [];
      const { card, $ } = mk({ controls: { ...q, answer: (ref, id, payload) => { answers.push([id, payload]); return Promise.resolve(true); } } });
      card.update(live({ pendingQuestion: pq }));
      assert.equal($('.chat-rc-q-head').hidden, true, 'stepCard: true hides the card\'s own heading');
      assert.equal($('.chat-rc-q .ask-mcard-title').textContent, 'Implementer needs a decision');
      $('.chat-rc-q .gate-another').click();
      await settle();
      assert.deepEqual(q.log.posts, [{ decision: 'another' }]);
      assert.deepEqual(answers, [], 'the card\'s delegate never double-posts a step card');
      card.update(live());
      assert.equal($('.chat-rc-receipt summary').textContent, 'Another cycle started');
      forgetAnswer('run-uuid-1', pq.id);
    } },
    { name: 'approving the real plan and Split cards leaves "Plan approved" and "Split into 3 runs"; none reads "Answered"', run: async () => {
      const plan = { id: 'rc-plan-1', kind: 'plan', nodeId: 'n_plan', plan: { round: 1, revisable: true, file: 'plans/p.md', check: null, perspectives: [] } };
      const split = { id: 'rc-split-1', kind: 'plan', nodeId: 'n_plan', plan: { round: 1, revisable: true,
        outline: { why: 'big', slices: [outlineSlice('s1'), outlineSlice('s2'), outlineSlice('s3')] } } };
      for (const [pq, render, want] of [[plan, renderPlanBody, 'Plan approved'], [split, renderOutlineBody, 'Split into 3 runs']]) {
        const q = stepStub(pq, render);
        const { card, $ } = mk({ controls: { ...q, answer: async () => true } });
        card.update(live({ pendingQuestion: pq }));
        $(pq === plan ? '.chat-rc-q .plan-approve' : '.chat-rc-q .outline-approve').click();
        await settle();
        assert.equal(q.log.posts.length, 1);
        card.update(live());
        assert.equal($('.chat-rc-receipt summary').textContent, want);
        assert.doesNotMatch($('.chat-rc-receipt summary').textContent, /Answered/);
        forgetAnswer('run-uuid-1', pq.id);
      }
    } },
    { name: 'the workflow body owns its buttons; a REST snapshot never mounts a question; a run that ends while asking leaves no receipt', run: async () => {
      const q = questionStub({ id: 'w-1', kind: 'workflow', heading: 'Review the workflow', step: '' }, '<button class="btn btn-primary" data-qpanel-submit>Accept</button>');
      const answers = [];
      const { card, $ } = mk({ controls: { ...q, answer: (...a) => { answers.push(a); return Promise.resolve(true); } } });
      card.update(live({ pendingQuestion: { id: 'w-1', kind: 'workflow' } }));
      $('.chat-rc-q .qpanel').classList.add('qpanel-workflow');
      $('.chat-rc-q .btn-primary').click();
      await settle();
      assert.deepEqual(answers, [], 'the workflow arm is not the card\'s delegate');
      card.update(live({ status: 'stopped', terminal: true, pendingQuestion: null, active: [] }));
      assert.equal($('.chat-rc-receipt').hidden, true);
      assert.equal($('.chat-rc-q').hidden, true);
      const before = q.log.painted;
      card.update({ ...live({ pendingQuestion: PQ }), source: 'rest' });
      assert.equal(q.log.painted, before, 'no live run model, no question body');
    } },
  ]);
});

test('chat run card result region: words, churn, top files → Diff, artifact chips → viewer, Create PR → Ship-it, View PR', async () => {
  const EXTRAS = { results: { filesChanged: 2, additions: 12, deletions: 3, checks: 0, topFiles: [
    { path: 'src/a.mjs', additions: 10, deletions: 2, status: 'M' }, { path: 'img/x.png', additions: 0, deletions: 0, status: 'A', binary: true }] },
  artifacts: [{ kind: 'prompt', relPath: 'prompt.md', bytes: 10, nodeId: null, cycle: null },
    { kind: 'review', relPath: 'reviews/a-very-long-implementation-review-cycle1.json', bytes: 20, nodeId: 'n_impl', cycle: 1 }],
  moreArtifacts: true, pr: null };
  await checkRows([
    { name: 'Ready to ship: the verdict, churn, files, chips and Create pull request (no card link)', run: async () => {
      const shipped = [];
      const { card, $, calls, refreshed } = mk({ controls: { prHost: () => true, openShipIt: (...a) => { shipped.push(a); return Promise.resolve(null); } } });
      card.update(done(EXTRAS));
      assert.equal($('.chat-rc-result').hidden, false);
      // Said once: the status line leads with "Ready to ship", so the verdict stands alone as the block's headline.
      assert.equal($('.chat-rc-res-title').textContent, 'Clean: no blocking issues flagged');
      assert.equal($('.chat-rc-res-sub'), null);
      assert.equal($('.chat-rc-res-churn').textContent, '+12 −3 · 2 files changed');
      const files = [...card.el.querySelectorAll('.chat-rc-file')];
      assert.deepEqual(files.map((f) => f.textContent), ['src/a.mjs+10−2', 'img/x.png']);
      files[0].click();
      assert.deepEqual(calls.at(-1).slice(0, 1).concat([calls.at(-1)[2]]), ['panel', { tab: 'diff' }]);
      const chips = [...card.el.querySelectorAll('.chat-rc-art')];
      assert.deepEqual(chips.map((c) => c.textContent), ['prompt.md', midTrunc('a-very-long-implementation-review-cycle1.json'), 'All artifacts']);
      chips[1].click();
      assert.equal(calls.at(-1)[0], 'artifact');
      assert.equal(calls.at(-1)[2].relPath, 'reviews/a-very-long-implementation-review-cycle1.json');
      assert.equal(calls.at(-1)[1].pipelineId, 'abcd1234');
      assert.equal(calls.at(-1)[1].nodeLabel('n_impl'), 'Implementer', 'P5: the step label rides on the artifact ref');
      chips[2].click();
      assert.deepEqual(calls.at(-1)[2], { tab: 'artifacts' });
      $('.chat-rc-create-pr').click();
      await settle();
      assert.equal(shipped.length, 1);
      assert.equal(shipped[0].length, 1, 'no card link from the run card (R9)');
      assert.equal(shipped[0][0].pipelineId, 'abcd1234');
      assert.equal(refreshed.length, 1, 're-read the PR once Ship-it is done');
      assert.equal($('.chat-rc-res-err').hidden, true);
    } },
    { name: 'a Ship it that cannot open ({opened:false, error}) says why in the card, and the PR is still re-read', run: async () => {
      const { card, $, refreshed } = mk({ controls: { prHost: () => true, openShipIt: async () => ({ opened: false, error: 'This run is not in History yet.' }) } });
      card.update(done(EXTRAS));
      $('.chat-rc-create-pr').click();
      await settle();
      assert.equal($('.chat-rc-res-err').hidden, false);
      assert.equal($('.chat-rc-res-err').textContent, 'This run is not in History yet.');
      assert.equal($('.chat-rc-create-pr').disabled, false);
      assert.equal(refreshed.length, 1);
    } },
    { name: 'no PR host → no Create; checks → "N things to check"; nothing changed → Done', run: async () => {
      const { card, $ } = mk({ controls: { prHost: () => false } });
      card.update(done({ ...EXTRAS, results: { ...EXTRAS.results, checks: 2 } }));
      assert.equal($('.chat-rc-create-pr'), null);
      assert.equal($('.chat-rc-res-sub').textContent, '2 things to check');
      card.update(done({ ...EXTRAS, results: { filesChanged: 0, additions: 0, deletions: 0, checks: 0, topFiles: [] } }));
      assert.equal($('.chat-rc-res-title').textContent, 'Done');
      assert.equal($('.chat-rc-res-sub').textContent, 'No files changed');
    } },
    { name: 'an open PR is In review with a View link; merged reads Merged; a non-http URL is never linked', run: async () => {
      const { card, $ } = mk({ controls: { prHost: () => true } });
      card.update(done({ ...EXTRAS, pr: { url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN' } }));
      assert.equal($('.chat-rc-res-text'), null, 'the status line says In review: the block repeats nothing');
      assert.ok($('.chat-rc-res-churn'), 'the churn still has its row');
      const a = $('a.chat-rc-view-pr');
      assert.equal(a.getAttribute('href'), 'https://github.com/o/r/pull/7');
      assert.equal(a.target, '_blank');
      assert.equal(a.rel, 'noopener');
      assert.equal($('.chat-rc-create-pr'), null);
      // PR controls: View PR is a small secondary button with the open PR's glyph, and the card's only View PR.
      assert.deepEqual([...a.classList], ['btn', 'btn-sm', 'chat-rc-view-pr']);
      assert.equal(glyphOf(a), 'pull-request');
      assert.equal(a.textContent, 'View PR');
      assert.deepEqual([...card.el.querySelectorAll('a, button')].filter((b) => !b.hidden && b.textContent === 'View PR'), [a]);
      assert.equal(a.dataset.modelAction, 'open-pr', 'the result\'s link is the model\'s open-pr');
      card.update(done({ ...EXTRAS, pr: { url: 'https://github.com/o/r/pull/7', number: 7, state: 'MERGED' } }));
      assert.equal($('.chat-rc-res-text'), null, 'the status line says Merged');
      assert.equal($('a.chat-rc-view-pr').textContent, 'View PR');
      assert.equal(glyphOf($('a.chat-rc-view-pr')), 'merge');
      assert.equal($('a.chat-rc-view-pr').hidden, false);
      card.update(done({ ...EXTRAS, pr: { url: 'javascript:alert(1)', number: 1, state: 'OPEN' } }));
      assert.equal($('a.chat-rc-view-pr'), null);
    } },
    { name: 'Stopped and Failed (naming the failed step)', run: async () => {
      const { card, $ } = mk();
      card.update(live({ status: 'stopped', terminal: true, active: [] }));
      assert.equal($('.chat-rc-res-head'), null, 'the status line says Stopped: no head row at all');
      assert.equal($('.chat-rc-result').hidden, false);
      const failed = snapshotFromState(STATE({ status: 'error', active: [], steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'error' })] }), { now: 0 });
      card.update(failed);
      assert.equal($('.chat-rc-res-title').textContent, 'Step: Implementer · see Logs for the error', 'the step stands alone as the headline');
      assert.equal($('.chat-rc-res-sub'), null);
    } },
  ]);
});

test('card wells: the footer accordion, rows and result link take no pointer (nothing is bound in a card)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.gv-wrap-card .run-flow.gv-host .gv-world .xtoggle,.gv-wrap-card .run-flow.gv-host .gv-world .xrow,'
    + '.gv-wrap-card .run-flow.gv-host .gv-world .xresult a{pointer-events:none;cursor:inherit;}'));
});

test('chat run card helpers: progressIdent, runRefOf, autoChip, resultWord, answerReceipt, midTrunc; destroy releases the graph and the question', async () => {
  await checkRows([
    { name: 'progressIdent: a track_run card and a started proposal', run: async () => {
      assert.deepEqual(progressIdent({ id: 'card_1', state: 'tracked', card: { type: 'progress', pipelineId: 'abcd1234', runId: 'r', projectKey: 'p', title: 'T', label: 'L' } }),
        { cardId: 'card_1', pipelineId: 'abcd1234', runId: 'r', projectKey: 'p', workspaceId: null, title: 'T', label: 'L' });
      assert.deepEqual(progressIdent({ id: 'card_2', state: 'started', runId: 'run-9', card: { projectKey: 'p', projectName: 'proj', brief: 'Fix it' } }),
        { cardId: 'card_2', pipelineId: null, runId: 'run-9', projectKey: 'p', workspaceId: null, title: 'Fix it', label: 'proj' });
    } },
    { name: 'runRefOf prefers the snapshot, falls back to the identity', run: async () => {
      assert.deepEqual(runRefOf(IDENT, null), { runId: 'run-uuid-1', pipelineId: 'abcd1234', projectKey: 'proj-00000001', workspaceId: null, projectDir: '', title: 'Fix login', branch: '', status: '' });
      assert.equal(runRefOf(IDENT, { runId: 'run-2', status: 'paused' }).runId, 'run-2');
    } },
    { name: 'autoChip / resultWord / answerReceipt / midTrunc tables', run: async () => {
      assert.equal(autoChip(null), null);
      assert.deepEqual(autoChip({ auto: { status: 'decided' }, stepper: { template: { name: 'Quick fix' } } }), { text: 'Auto → Quick fix', deciding: false });
      assert.equal(resultWord(null), null);
      assert.equal(resultWord({ status: 'running' }), null);
      assert.equal(resultWord({ status: 'interrupted' }), null, 'resumable: no result region');
      assert.equal(resultWord({ status: 'stopped' }).sub, '', 'Stopped adds nothing to the status line');
      noteAnswer('run-a', { id: 'rc-named-1', kind: 'gate', issues: [] }, { decision: 'continue' });
      assert.equal(answerReceipt(null, { id: 'rc-named-1', runId: 'run-a', step: 'Review' }), 'Accepted as is', 'the named note wins');
      assert.equal(answerReceipt({ kind: 'gate', payload: { decision: 'continue' } }, { id: 'rc-named-1', runId: 'run-a', step: 'Review' }), 'Accepted as is');
      assert.equal(answerReceipt(null, { id: 'rc-named-1', runId: 'run-b', step: 'Review' }), 'Answered · Review', 'another run\'s note never names this one');
      forgetAnswer('run-a', 'rc-named-1');
      assert.equal(namedAnswer('run-a', 'rc-named-1'), null);
      assert.equal(answerReceipt({ kind: 'gate', payload: { decision: 'continue' } }, { id: 'rc-named-1', runId: 'run-a', step: 'Review' }), 'Answer sent · Review', 'no gate arm left');
      assert.equal(answerReceipt({ named: 'Paused', payload: {} }, { id: 'rc-named-1', runId: 'run-a' }), 'Paused', 'a name read off the note before it was forgotten');
      assert.equal(answerReceipt({ kind: 'clarify', payload: { answers: [{ choice: 'a' }, { choice: '' }] } }, { step: 'Plan' }), '1 of 2 answered · Plan');
      assert.equal(answerReceipt({ kind: 'clarify', payload: { answers: [{ choice: '' }] } }, { step: 'Plan' }), 'Sent without answers · Plan');
      assert.equal(answerReceipt({ kind: 'form', payload: { values: {} } }, { heading: 'Review mockups' }), 'Answer sent · Review mockups');
      assert.equal(answerReceipt(null, { step: 'Plan' }), 'Answered · Plan');
      assert.equal(answerReceipt({ id: 'q', payload: { decision: 'approve' } }, { id: 'q', planAsk: true, roleReviews: RECORDED, step: 'Plan' }),
        'Plan approved · 5 roles reviewed · 1 open issue accepted');
      assert.equal(answerReceipt({ id: 'q', payload: { decision: 'approve' } }, { id: 'q', planAsk: false, step: 'Plan' }), 'Answer sent · Plan');
      assert.equal(midTrunc('abcdefghij', 5), 'ab…ij');
      assert.equal(midTrunc('short.md'), 'short.md');
    } },
    { name: 'destroy tears the graph down and hands the question host back', run: async () => {
      const q = questionStub({ id: 'q-1', kind: 'clarify', heading: 'H', step: 'S' }, '<button class="btn btn-primary" data-qpanel-submit>Submit</button>');
      const { card, $ } = mk({ controls: q });
      card.update(live({ pendingQuestion: { id: 'q-1', kind: 'questions', questions: [{}] } }));
      assert.ok($('.chat-rc-graph .gv-world'));
      const released = q.log.released;
      card.destroy();
      assert.equal($('.chat-rc-graph .gv-world'), null);
      assert.ok(q.log.released > released);
    } },
  ]);
});

test('chat run card: an answer whose question-resolved frame lands before its 200 still names what was sent', async () => {
  let release;
  const q = questionStub({ id: 'q-1', kind: 'clarify', heading: '2 questions from Plan', step: 'Plan' }, '<button class="btn btn-primary" data-qpanel-submit>Submit</button>', [{ id: 'a', question: 'Q1', choice: 'x' }]);
  const { card, $ } = mk({ controls: { ...q, answer: () => new Promise((r) => { release = r; }) } });
  card.update(live({ pendingQuestion: { id: 'q-1', kind: 'questions', questions: [{}] } }));
  $('.chat-rc-q .btn-primary').click();
  card.update(live({ pendingQuestion: null }));            // ui/server.mjs answerRun: question-resolved goes out before the 200
  assert.equal($('.chat-rc-receipt summary').textContent, 'Answered · Plan');
  release(true);
  await settle();
  assert.equal($('.chat-rc-receipt summary').textContent, '1 answer sent · Plan');
});

test('chat run card: what the card sent and its error survive same-question frames; Create PR only for a run with changes to ship; the gate pip focuses the question', async () => {
  const CLARIFY = { id: 'q-1', kind: 'clarify', heading: 'A question from Planner', step: 'Planner' };
  const PQ = { id: 'q-1', kind: 'questions', nodeId: 'n_plan', questions: [{ id: 'q1', question: 'Which database?' }] };
  const BODY = '<button class="qopt">Postgres</button><div class="qpanel-foot"><button class="btn btn-primary" data-qpanel-submit>Submit</button></div>';
  await checkRows([
    { name: 'a tick between the 200 and question-resolved keeps the receipt counted', run: async () => {
      const q = questionStub(CLARIFY, BODY, [{ id: 'q1', question: 'Which database?', choice: 'Postgres' }]);
      const { card, $ } = mk({ controls: { ...q, answer: () => Promise.resolve(true) } });
      card.update(live({ pendingQuestion: PQ }));
      $('.chat-rc-q .btn-primary').click();
      await settle();
      card.update(live({ pendingQuestion: PQ }));          // the controller's 1 s tick before the run resumes
      card.update(live());
      assert.equal($('.chat-rc-receipt summary').textContent, '1 answer sent · Planner');
    } },
    { name: '"Answer not sent" survives the next tick', run: async () => {
      const q = questionStub(CLARIFY, BODY, [{ id: 'q1', question: 'Which database?', choice: '' }]);
      const { card, $ } = mk({ controls: { ...q, answer: () => Promise.resolve(false) } });
      card.update(live({ pendingQuestion: PQ }));
      $('.chat-rc-q .btn-primary').click();
      await settle();
      card.update(live({ pendingQuestion: PQ }));
      assert.equal($('.chat-rc-q-err').hidden, false);
    } },
    { name: 'no Create pull request on Done (nothing changed), Stopped or Failed', run: async () => {
      const { card, $ } = mk({ controls: { prHost: () => true } });
      card.update(done({ results: { filesChanged: 0, additions: 0, deletions: 0, checks: 0, topFiles: [] }, artifacts: [], moreArtifacts: false, pr: null }));
      assert.equal($('.chat-rc-res-title').textContent, 'Done');
      assert.equal($('.chat-rc-create-pr'), null);
      card.update(live({ status: 'stopped', terminal: true, active: [] }));
      assert.equal($('.chat-rc-res-head'), null);
      assert.equal($('.chat-rc-create-pr'), null);
      card.update(snapshotFromState(STATE({ status: 'error', active: [] }), { now: 0 }));
      assert.equal($('.chat-rc-res-title').textContent, 'See Logs for the error');
      assert.equal($('.chat-rc-create-pr'), null);
    } },
    { name: 'the gate pip moves focus to the card\'s own question', run: async () => {
      const q = questionStub({ id: 'g-1', kind: 'gate', heading: 'Implementer needs a decision', step: 'Implementer' },
        '<div class="qpanel-foot gate-actions"><button class="btn gate-continue">No</button><button class="btn btn-primary gate-another">Yes</button></div>');
      const { card, $, doc, win } = mk({ controls: q });
      card.update(live({ pendingQuestion: { id: 'g-1', kind: 'gate', issues: [] } }, { gate: { wireId: 'w1', fromNode: 'n_plan', askId: 'g-1' } }));
      const pip = $('.chat-rc-graph .ngate');
      assert.ok(pip, 'a gate pip on the wire');
      pip.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      assert.equal(doc.activeElement, $('.chat-rc-q .gate-continue'));
    } },
  ]);
});

test('chat run card result words follow the run page: Ready to review when the review flagged something, PR closed, Finished without facts; an archived run offers no pull request; workspace files name their project', async () => {
  const facts = (over = {}) => ({ results: { filesChanged: 2, additions: 3, deletions: 1, checks: 0,
    topFiles: [{ path: 'srv.mjs', additions: 3, deletions: 1, status: 'M', projectKey: 'api-00000001' }], ...over }, artifacts: [], moreArtifacts: false, pr: null });
  const { card, $ } = mk({ controls: { prHost: () => true } });
  card.update(done(facts({ checks: 2 })));
  assert.equal($('.chat-rc-res-title').textContent, 'Ready to review');
  assert.equal($('.chat-rc-res-sub').textContent, '2 things to check');
  assert.ok($('.chat-rc-create-pr'), 'a flagged run can still open its pull request');
  assert.equal($('.chat-rc-file-path').textContent, 'api-00000001/srv.mjs', 'the Overview\'s workspace rule');
  card.update(done({ ...facts(), pr: { url: 'https://github.com/o/r/pull/9', number: 9, state: 'CLOSED' } }));
  assert.equal($('.chat-rc-res-title').textContent, 'PR closed');
  assert.equal($('.chat-rc-res-sub').textContent, 'Closed without merging');
  assert.equal($('a.chat-rc-view-pr').getAttribute('href'), 'https://github.com/o/r/pull/9');
  card.update(done({ results: null, artifacts: [], moreArtifacts: false, pr: null }));
  assert.equal($('.chat-rc-res-title').textContent, 'Finished');
  assert.equal($('.chat-rc-res-sub'), null, 'no facts, no sub-line');
  assert.ok($('.chat-rc-create-pr'));
  card.update(done(facts(), { archived: true }));
  assert.equal($('.chat-rc-res-title').textContent, 'Clean: no blocking issues flagged');
  assert.equal($('.chat-rc-create-pr'), null, 'an archived run has no branch to ship');
});

test('chat run card question: a pause from any surface leaves no "Answered" receipt — the server resolves the question AFTER the `pausing` frame', () => {
  const CLARIFY = { id: 'q-1', kind: 'clarify', heading: 'A question from Planner', step: 'Planner' };
  const PQ = { id: 'q-1', kind: 'questions', nodeId: 'n_plan', questions: [{ id: 'q1', question: 'Which database?' }] };
  const q = questionStub(CLARIFY, '<div class="qpanel-foot"><button class="btn btn-primary" data-qpanel-submit>Submit</button></div>', []);
  const { card, $ } = mk({ controls: q });
  card.update(live({ pendingQuestion: PQ }));
  card.update(live({ status: 'pausing', pendingQuestion: PQ }));   // ui/server.mjs pauseRun: orch.pause() emits `pausing` …
  card.update(live({ status: 'pausing', pendingQuestion: null }));  // … then resolvePending(entry, { reason: 'paused' })
  assert.equal($('.chat-rc-receipt').hidden, true);
  card.update(live({ status: 'paused', pendingQuestion: null, active: [] }));
  assert.equal($('.chat-rc-receipt').hidden, true, 'not answered: the pause took the question away');
  assert.equal($('.chat-rc-q').hidden, true);
});

test('chat run card controls: the second click of a double-click never undoes the first (Resume flips to Pause in place)', async () => {
  const calls = [];
  const { card, $, win } = mk({ controls: {
    resume: () => { calls.push('resume'); return Promise.resolve(); },
    pause: () => { calls.push('pause'); return Promise.resolve(null); },
  } });
  card.update(live({ status: 'paused', active: [] }));
  $('.chat-rc-pause').dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 1 }));
  await settle();
  card.update(live());                                    // the resumed lineage is running: the same button now says Pause
  assert.equal($('.chat-rc-pause').textContent, 'Pause');
  $('.chat-rc-pause').dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 2 }));
  await settle();
  assert.deepEqual(calls, ['resume'], 'the double-click\'s second press posts nothing');
  $('.chat-rc-pause').dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 0 }));   // keyboard activation
  await settle();
  assert.deepEqual(calls, ['resume', 'pause']);
});

test('chat run card CSS: the Runs page ask card in one column (the run side panel\'s overrides), its amber line in one rule; a narrow card wraps the result head and the answer buttons', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  for (const rule of [
    '.chat-rc-q-head{margin-bottom:10px;font-size:15px;}',
    '.chat-rc-q .qpanel{margin-top:0;padding:16px;}',
    '.chat-rc-q .qpanel .qbody,.chat-rc-q .qpanel .qbody > :first-child{margin-top:0;}',
    '.chat-rc-q .qblock{grid-template-columns:minmax(0,1fr);grid-template-rows:none;column-gap:0;padding:16px;}',
    '.chat-rc-q .qpanel[data-kind="form"] .af-form{padding:16px;}',
    '.chat-rc-q .qpanel:is([data-kind="gate"],[data-kind="recovery"]){grid-template-columns:minmax(0,1fr);row-gap:16px;column-gap:0;}',
    '.chat-rc-q .gate-actions .btn{flex:0 1 auto;max-width:100%;white-space:normal;text-wrap:balance;}',
    '.chat-rc-q .qpanel[data-kind="recovery"] > .issue-detail{overflow-wrap:anywhere;}',
    '.chat-rc-q :is(.qnote,.af-grp,.ask-wfcard-warn){background:var(--panel);}',
    '.chat-rc-q .qpanel-foot{flex-wrap:wrap;row-gap:8px;}',
    '.chat-rc-q .qpanel-foot > button{max-width:100%;white-space:normal;text-wrap:balance;}',
    '.chat-rc-res-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;}',
    '.chat-rc-res-text{flex:1 1 200px;min-width:0;}',
    '.chat-rc-res-sub{margin-top:2px;font-size:12px;color:var(--ink-2);}',
    '.chat-rc-res-churn{flex:0 0 auto;margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink-2);}',
  ]) assert.ok(p3.includes(rule), rule);
  // The card's own copies of Runs page rules are gone: the `:is(.rd-questions,.chat-rc-q)` rules draw both mounts.
  for (const gone of ['.chat-rc-q .issue{border-color', '.chat-rc-q .issue-loc{', '.chat-rc-q .qanswered{', '.chat-rc-q .qtune .select-wrap select{', '.chat-rc-q .qpanel :is(.qfree,.af-inp){']) {
    assert.ok(!p3.includes(gone), `${gone} is the Runs page rule's now`);
  }
  // The user's "maybe": the cards' amber line lives in ONE rule, so dropping or swapping it is a one-line change.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const chatRules = [...bare.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter((m) => /\.chat-rc-q\b/.test(m[1]));
  assert.deepEqual(chatRules.filter((m) => /--amber-line/.test(m[2])).map((m) => m[2].trim()), ['border-color:var(--amber-line);']);
  assert.deepEqual(chatRules.filter((m) => /--amber-wash/.test(m[2])).map((m) => m[1].trim()), [], 'no amber wash in the chat question');
  // Run 4 (D21): the run card's question is a divided section with no tint (the status line's "?" says Needs you).
  assert.deepEqual(chatRules.filter((m) => /^background:var\(--amber-bg\);$/.test(m[2].trim())).map((m) => m[1].trim()), []);
  // P2's ask-card field metrics stand down inside the question, so its fields keep the Runs page's own.
  assert.ok(css.includes('.ask-card :is(select,input[type="text"],textarea):where(:not(.chat-rc-q *)){font-size:12px;padding:8px 11px;border-radius:var(--r-sm);}'));
});

// ---- The question's styles, replayed over style.css. jsdom computes no cascade, so (as test/ui-functional-css.test.mjs
// does for `display`) the winning declaration is picked by hand: importance, then specificity, then source order. Top-level
// rules only: the Runs page's narrow @media block is not the card's.
const CSS_TEXT = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
let cssRulesMemo = null;
const cssRules = () => (cssRulesMemo ??= [...new JSDOM(`<style>${CSS_TEXT}</style>`).window.document.styleSheets[0].cssRules]
  .filter((r) => typeof r.selectorText === 'string'));
/** Split at top-level separators only (never inside (), [] or quotes). */
function splitTop(s, seps) {
  const out = []; let depth = 0, quote = null, cur = '';
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && seps.includes(ch)) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}
const cmpKey = (x, y) => { for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k]; return 0; };
function specificity(sel) {
  let a = 0, b = 0, c = 0, s = sel;
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, ' ');
  s = s.replace(/:(?:not|is|has)\(((?:[^()]|\([^()]*\))*)\)/g, (m, inner) => {
    const [x, y, z] = splitTop(inner, ',').map(specificity).sort(cmpKey).pop() ?? [0, 0, 0];
    a += x; b += y; c += z; return ' ';
  });
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return ' '; });
  s = s.replace(/::[\w-]+/g, () => { c++; return ' '; });
  s = s.replace(/:[\w-]+(?:\([^)]*\))?/g, () => { b++; return ' '; });
  s = s.replace(/#[\w-]+/g, () => { a++; return ' '; });
  s = s.replace(/\.[\w-]+/g, () => { b++; return ' '; });
  for (const _ of s.matchAll(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g)) c++;
  return [a, b, c];
}
/** The value `el` (or its ::before / ::after) gets from the winning declaration of any of `props` (a shorthand and its
 *  longhands compete as one property: list the shorthand first — jsdom expands `border:0` into longhands of the same
 *  rule, so a rule counts with the first of `props` it declares). States (hover, focus) are left out. */
function cascaded(el, props, pseudo = '') {
  let best = null;
  cssRules().forEach((r, i) => {
    const p = props.find((name) => r.style.getPropertyValue(name));
    if (!p) return;
    for (const s of splitTop(r.selectorText, ',')) {
      const pe = /::(?:before|after)$/.exec(s);
      if ((pe ? pe[0] : '') !== pseudo || /:(?:hover|focus|focus-visible|focus-within|active)\b/.test(s)) continue;
      let hit = false;
      try { hit = el.matches(pe ? s.slice(0, pe.index) : s); } catch { /* a selector jsdom cannot parse styles nothing here */ }
      if (!hit) continue;
      const key = [r.style.getPropertyPriority(p) === 'important' ? 1 : 0, ...specificity(s), i];
      if (!best || cmpKey(key, best.key) > 0) best = { key, value: r.style.getPropertyValue(p) };
    }
  });
  return best ? best.value : null;
}
/** The markup app.js's renderers paint for each kind (renderClarifyBody, askFormHost, the gate and recovery step cards,
 *  the workflow body), as far as the question's styles reach — the form's group box (widgets-layout.mjs groupWidget),
 *  the workflow's "Round N revised" echo and its proposal warnings (renderWorkflowBody, auto-proposal.mjs) included. */
const ASK_HTML = {
  clarify: '<div class="qpanel-head"><b>Questions</b></div><div class="qblock"><div class="qtext"><span class="qn">1</span>Which port?</div><div class="qopts"><button type="button" class="qopt" data-key="A"><span class="qopt-txt">8080</span></button></div><input class="qfree" type="text"></div><div class="qpanel-foot"><span class="qanswered">0 of 1 answered</span><button type="button" class="btn btn-primary" data-qpanel-submit>Submit</button></div>',
  form: '<div class="qpanel-head"><b>A form</b></div><div class="qbody"><div class="af-form"><div class="af-grp"><h3 class="af-grp-title">Scope</h3><div class="af-fld"><label class="af-label">Name</label><input type="text" class="af-inp"></div></div></div><div class="qpanel-foot"><span class="qanswered">0 of 1 answered</span><button type="button" class="btn btn-primary" data-qpanel-submit>Submit</button></div></div>',
  gate: '<div class="qpanel-head"><b>Cycle gate</b></div><div class="gate-intro">This cycle reached its limit.</div><ul class="issues"><li class="issue sev-major"><div class="issue-head"><span class="issue-sev">major</span><span class="issue-title">Login leaks</span></div><div class="issue-loc">srv.mjs:12</div></li></ul><div class="qpanel-foot gate-actions"><button type="button" class="btn gate-continue">Don\'t approve another cycle and continue</button><button type="button" class="btn btn-primary gate-another">I approve another cycle</button></div>',
  recovery: '<div class="qpanel-head"><b>Step failed</b></div><div class="gate-intro">This step could not reach the model.</div><div class="issue-detail">429 rate limited</div><div class="qpanel-foot gate-actions"><button type="button" class="btn recovery-pause">Pause run</button><button type="button" class="btn btn-primary recovery-retry">Retry</button></div>',
  workflow: '<div class="qpanel-head"><b>Workflow</b></div><div class="qbody"><div class="ask-wfcard-body"><div class="qnote"><b>Round 1 revised: </b>“skip the docs step”</div><div class="ask-wfcard-warnings"><div class="ask-wfcard-warn">This project\'s saved settings for that workflow are not applied to Auto runs.</div></div></div></div><textarea class="qfree qfree-area" hidden></textarea><div class="qpanel-foot"><button type="button" class="qcancel wf-cancel">Cancel run</button><button type="button" class="btn btn-primary wf-accept" data-qpanel-submit>Accept &amp; run</button></div>',
};
const ASK_KINDS = Object.keys(ASK_HTML);
/** Both mounts of one kind in one document: the chat card's (createChatRunCard, its painter stamping data-kind as
 *  renderQpanel does) and the Runs page's (index.html's `.rd-glance > .rd-questions`). */
function askMounts(kind) {
  const painter = {
    paintQuestion(ref, host) {
      const p = host.querySelector('.qpanel');
      p.dataset.kind = kind;
      p.classList.toggle('qpanel-workflow', kind === 'workflow');
      p.innerHTML = ASK_HTML[kind];
      p.classList.remove('hidden');
      return { id: 'q-1', kind, heading: 'A question from Plan', step: 'Plan' };
    },
    releaseQuestion() {},
  };
  const { card, doc } = mk({ controls: painter });
  card.update(live({ pendingQuestion: { id: 'q-1', kind } }));
  const runs = doc.createElement('div');
  runs.className = 'rd-glance';
  runs.innerHTML = `<div class="rd-questions"><h3 class="rd-ask-head">A question from Plan</h3><div class="qpanel" data-kind="${kind}">${ASK_HTML[kind]}</div></div>`;
  doc.body.appendChild(runs);
  return { chat: card.el.querySelector('.chat-rc-q'), runs: runs.querySelector('.rd-questions') };
}

test('chat run card CSS: one border level (review B2): the question\'s boxes are bare, not boxed (the question and the form no tint), the pill footer keeps its 1px amber line, the Runs page keeps its grey line, and no amber wash anywhere in the chat question', async () => {
  const look = (el) => ({ bg: cascaded(el, ['background', 'background-color']), line: cascaded(el, ['border', 'border-color']) });
  await checkRows(ASK_KINDS.map((kind) => ({ name: kind, run: () => {
    const { chat, runs } = askMounts(kind);
    assert.equal(chat.hidden, false, 'precondition: the question shows');
    // The surfaces that are cards on the Runs page: each question and the pill footer (clarify), the form and the pill
    // footer (form), the panel itself (gate, recovery, workflow).
    const cards = (root) => {
      const panel = root.querySelector('.qpanel');
      if (kind === 'clarify') return [...panel.querySelectorAll('.qblock, .qpanel-foot')];
      if (kind === 'form') return [...panel.querySelectorAll('.af-form, .qpanel-foot')];
      return [panel];
    };
    assert.equal(cards(chat).length, kind === 'clarify' || kind === 'form' ? 2 : 1);
    for (const el of cards(chat)) {
      const want = el.matches('.qpanel-foot') ? { bg: 'var(--panel)', line: 'var(--amber-line)' }
        : { bg: 'none', line: '0px' };
      assert.deepEqual(look(el), want, `chat ${el.className}`);
    }
    for (const el of cards(runs)) assert.deepEqual(look(el), { bg: 'var(--panel)', line: '1px solid var(--line)' }, `Runs page ${el.className}`);
    if (kind === 'clarify' || kind === 'form') {
      assert.deepEqual(look(chat.querySelector('.qpanel')), { bg: 'none', line: '0px' }, 'the stack itself draws nothing');
    }
    for (const el of [chat, ...chat.querySelectorAll('*')]) {
      assert.doesNotMatch(cascaded(el, ['background', 'background-color']) || '', /amber-wash/, `no amber wash: ${el.tagName} ${el.className}`);
    }
    // Boxes inside the cards that the Runs page washes amber: a form's group, a workflow's revise echo and its proposal
    // warnings. In the chat card they sit on the card's white with their own amber line (a warning keeps its amber ink).
    for (const [sel, wash] of { form: [['.af-grp', '--amber-wash-2']], workflow: [['.qnote', '--amber-wash-2'], ['.ask-wfcard-warn', '--amber-wash']] }[kind] ?? []) {
      const [a, b] = [chat.querySelector(sel), runs.querySelector(sel)];
      assert.ok(a && b, `precondition: ${kind} paints ${sel}`);
      assert.deepEqual(look(a), { bg: 'var(--panel)', line: '1px solid var(--amber-line)' }, `chat ${sel}`);
      assert.deepEqual(look(b), { bg: `var(${wash})`, line: '1px solid var(--amber-line)' }, `Runs page ${sel} keeps its wash`);
    }
    const warn = chat.querySelector('.ask-wfcard-warn');
    if (warn) assert.equal(cascaded(warn, ['color']), 'var(--amber-ink)');
  } })));
});

test('chat run card CSS: the question heading is the Runs page heading (amber disc and glyph, red for a failed step); one column like the run side panel; the Runs page fields, issue and answered lead', async () => {
  await checkRows([
    { name: 'the heading: the disc and the glyph, red on a recovery; the Runs page heading keeps its own', run: () => {
      for (const kind of ['clarify', 'recovery']) {
        const { chat, runs } = askMounts(kind);
        const tone = kind === 'recovery' ? 'red' : 'amber';
        for (const head of [chat.querySelector('.chat-rc-q-head'), runs.querySelector('.rd-ask-head')]) {
          assert.equal(cascaded(head, ['background', 'background-color'], '::before'), `var(--${tone}-bg)`, `${kind} ${head.className} disc`);
          assert.equal(cascaded(head, ['background', 'background-color'], '::after'), `var(--${tone}-ink)`, `${kind} ${head.className} glyph`);
          assert.equal(cascaded(head, ['padding']), '0px 4px 0px 52px', `${head.className}: the text clears the disc`);
        }
      }
    } },
    { name: 'one column: the question over its answers, the decision over its issues, a severity chip over its text, answers that shrink', run: () => {
      const { chat: c, runs: r } = askMounts('clarify');
      const cols = (el) => cascaded(el, ['grid-template-columns']);
      assert.equal(cols(c.querySelector('.qblock')), 'minmax(0,1fr)');
      assert.equal(cols(r.querySelector('.qblock')), '380px minmax(0,1fr)', 'the Runs page keeps its two columns');
      assert.equal(cascaded(c.querySelector('.qopts'), ['grid-column']), '1');
      assert.equal(cascaded(c.querySelector('.qfree'), ['grid-column']), '1');
      const { chat: g, runs: gr } = askMounts('gate');
      assert.equal(cols(g.querySelector('.qpanel')), 'minmax(0,1fr)');
      assert.equal(cols(gr.querySelector('.qpanel')), '380px minmax(0,1fr)');
      assert.equal(cascaded(g.querySelector('.issues'), ['grid-column']), '1');
      assert.equal(cols(g.querySelector('.issue')), 'minmax(0,1fr)');
      assert.equal(cols(gr.querySelector('.issue')), '92px minmax(0,1fr)');
      assert.equal(cascaded(g.querySelector('.issue-title'), ['grid-column']), '1');
      for (const btn of g.querySelectorAll('.gate-actions .btn')) assert.equal(cascaded(btn, ['flex']), '0 1 auto', btn.className);
      assert.equal(cascaded(gr.querySelector('.gate-actions .btn'), ['flex']), '0 0 auto');
      // The model's own words are mono and pre-wrap: a long JSON or URL token breaks inside the card, never past its edge.
      const { chat: rc, runs: rr } = askMounts('recovery');
      assert.equal(cascaded(rc.querySelector('.qpanel > .issue-detail'), ['overflow-wrap']), 'anywhere');
      assert.equal(cascaded(rr.querySelector('.qpanel > .issue-detail'), ['overflow-wrap']), null, 'the Runs page box is unchanged');
    } },
    { name: 'the Runs page fields (P2\'s ask-card metrics stand down), its stripe-less issue and its answered lead', run: () => {
      for (const kind of ASK_KINDS) {
        const { chat, runs } = askMounts(kind);
        for (const sel of ['.qblock > .qfree', '.af-inp', '.qfree-area', '.issue-loc', '.qanswered', '.gate-intro', '.qopt', '.qtext']) {
          const [a, b] = [chat.querySelector(sel), runs.querySelector(sel)];
          if (!a) continue;
          for (const props of [['padding'], ['border-radius'], ['font', 'font-size'], ['color']]) {
            assert.equal(cascaded(a, props), cascaded(b, props), `${kind} ${sel} ${props.at(-1)}`);
          }
        }
        const issue = chat.querySelector('.issue');
        if (issue) {
          assert.equal(cascaded(issue, ['border', 'border-color', 'border-left-color']), 'var(--line)', 'no coloured stripe');
          assert.equal(cascaded(issue, ['border', 'border-width', 'border-left-width']), '1px');
        }
      }
      const { chat } = askMounts('clarify');
      assert.equal(cascaded(chat.querySelector('.qblock > .qfree'), ['padding']), '6px 12px', 'run 4 D7: the shared 32px field');
      assert.equal(cascaded(chat.querySelector('.qanswered'), ['color']), 'var(--ink)');
    } },
  ]);
});

test('chat run card: a receipt with nothing to expand is no tab stop and does not toggle; one with answers is a disclosure', async () => {
  const gpq = { id: 'rc-gate-2', kind: 'gate', nodeId: 'n_impl', issues: [] };
  const g = mk({ controls: { ...stepStub(gpq, renderGateCard), answer: async () => true } });
  g.card.update(live({ pendingQuestion: gpq }));
  g.$('.chat-rc-q .gate-another').click();
  await settle();
  g.card.update(live({ pendingQuestion: null }));
  const sum = g.$('.chat-rc-receipt summary');
  assert.equal(sum.textContent, 'Another cycle started');
  forgetAnswer('run-uuid-1', gpq.id);
  assert.equal(sum.tabIndex, -1);
  sum.click();
  assert.equal(g.$('.chat-rc-receipt').open, false);
  const clar = questionStub({ id: 'q-1', kind: 'clarify', heading: 'A question from Plan', step: 'Plan' }, '<button class="btn btn-primary" data-qpanel-submit>Submit</button>', [{ id: 'a', question: 'Q1', choice: 'x' }]);
  const c = mk({ controls: { ...clar, answer: async () => true } });
  c.card.update(live({ pendingQuestion: { id: 'q-1', kind: 'questions', questions: [{}] } }));
  c.$('.chat-rc-q .btn-primary').click();
  await settle();
  c.card.update(live({ pendingQuestion: null }));
  assert.equal(c.$('.chat-rc-receipt summary').tabIndex, 0);
  c.$('.chat-rc-receipt summary').click();
  assert.equal(c.$('.chat-rc-receipt').open, true);
});

test('chat run card: the question section is shown BEFORE controls.paintQuestion mounts the run page body (a workflow body measures its host as it attaches)', () => {
  const seen = [];
  const { card } = mk({ controls: {
    paintQuestion(ref, host) { seen.push([host.hidden, host.closest('.chat-rc-q').hidden]); return { id: 'w-1', kind: 'workflow', heading: 'Review the workflow', step: '' }; },
    releaseQuestion() {} } });
  card.update(live({ pendingQuestion: { id: 'w-1', kind: 'workflow' } }));
  card.update(live());                                     // resolved: the body is hidden again
  card.update(live({ pendingQuestion: { id: 'w-2', kind: 'workflow' } }));
  assert.deepEqual(seen, [[false, false], [false, false]]);
});

test('chat run card: an answer that does not land announces nothing and is never named as sent', async () => {
  const q = questionStub({ id: 'q-1', kind: 'clarify', heading: 'A question from Plan', step: 'Plan' }, '<button class="btn btn-primary" data-qpanel-submit>Submit</button>', [{ id: 'a', question: 'Q1', choice: 'x' }]);
  const { card, $, calls } = mk({ controls: { ...q, answer: () => Promise.resolve(false) } });
  card.update(live({ pendingQuestion: { id: 'q-1', kind: 'questions', questions: [{}] } }));
  $('.chat-rc-q .btn-primary').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c[0] === 'announce'), []);
  card.update(live());                                     // answered elsewhere after all
  assert.equal($('.chat-rc-receipt summary').textContent, 'Answered · Plan');
});

test('chat run card: an accepted pause lets go when the run is interrupted, or when a newer lineage of it is already running', async () => {
  const { card, $ } = mk({ controls: { pause: () => Promise.resolve(null) } });
  card.update(live());
  $('.chat-rc-pause').click();
  await settle();
  card.update(live({ status: 'interrupted', active: [] }));
  assert.equal($('.chat-rc-pause').textContent, 'Resume');
  assert.equal($('.chat-rc-pause').disabled, false, 'interrupted: Resume is offered');
  card.update(live());
  $('.chat-rc-pause').click();
  await settle();
  card.update(live({ runId: 'run-uuid-2' }));
  assert.equal($('.chat-rc-pause').textContent, 'Pause');
  assert.equal($('.chat-rc-pause').disabled, false, 'the pause was asked of another lineage');
});

test('chat run card: one flagged thing reads "Ready to review · 1 thing to check"; the agent and artifact boxes are labelled groups; a workspace file\'s tooltip names its project; PR closed and Finished words', () => {
  const { card, $ } = mk({ controls: { prHost: () => true } });
  card.update(live());
  assert.equal($('.ask-rc-active').getAttribute('role'), 'group');
  card.update(done({ results: { filesChanged: 1, additions: 1, deletions: 0, checks: 1, topFiles: [{ path: 'srv.mjs', additions: 1, deletions: 0, status: 'M', projectKey: 'api-00000001' }] },
    artifacts: [{ kind: 'prompt', relPath: 'prompt.md', bytes: 1, nodeId: null, cycle: null }], moreArtifacts: false, pr: null }));
  assert.equal($('.chat-rc-res-title').textContent, 'Ready to review');
  assert.equal($('.chat-rc-res-sub').textContent, '1 thing to check');
  assert.equal($('.chat-rc-file').title, 'api-00000001/srv.mjs');
  assert.equal($('.chat-rc-arts').getAttribute('role'), 'group');
  assert.deepEqual(resultWord({ status: 'done', pr: { url: 'https://github.com/o/r/pull/9', state: 'CLOSED' } }),
    { key: 'closed', tone: 'red', glyph: 'stop', title: 'PR closed', sub: 'Closed without merging' });
  assert.deepEqual(resultWord({ status: 'done', results: null }), { key: 'ship', tone: 'green', glyph: 'check', title: 'Finished', sub: '' });
});

test('chat run card CSS: an answer label wider than the whole row wraps inside its button, never out of the card', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  // Chrome, 360 px: under `white-space:nowrap` the gate's "Don't approve another cycle and continue" (330 px wide)
  // sat at x -26..304 in a 20..340 card and read "n't approve …". flex-wrap already moves WHOLE buttons to the next row.
  assert.doesNotMatch(p3, /\.chat-rc-q \.qpanel-foot > button\{[^}]*white-space:nowrap/);
  assert.ok(p3.includes('.chat-rc-q .qpanel-foot > button{max-width:100%;white-space:normal;text-wrap:balance;}'));
});

test('step card CSS: inside a question panel the head title wraps (375 px) and never overflows the card', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = (sel) => { const m = css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`)); return m ? m[1] : ''; };
  assert.match(rule('.qpanel .step-head .ask-mcard-title'), /white-space:normal/);
  assert.match(rule('.qpanel .step-head .ask-mcard-title'), /min-width:0/);
  assert.match(rule('.qpanel .step-head'), /flex-wrap:wrap/);
  assert.match(rule('.qpanel .step-head'), /height:auto/);
  assert.match(rule('.outline-row-more'), /margin-left:auto/);
});

test('member rows CSS: the narrow grid areas are the page table\'s only, so the chat card\'s plain rows keep their columns (375 px)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  // Chrome, 375 px: an unscoped `.run-member-title{grid-area:title}` put the chat card's title and line in one implicit
  // cell, drawn over each other at the right edge (the plain list has no grid-template-areas).
  const rules = [...css.matchAll(/([^{}]+)\{grid-area:[a-z]+\}/g)].map((m) => m[1].trim()).filter((s) => /\.run-member/.test(s));
  assert.ok(rules.length >= 6, `the narrow table's area rules (${rules.length})`);
  for (const sel of rules) assert.ok(sel.startsWith('.run-members.is-table '), sel);
});

test('chat run card CSS: the result counts and error, a hovered file row or Stop, the "K of N answered" lead, the agent model label and the Auto well\'s words reach 4.5:1 in both themes', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
  const pair = (name) => {
    const m = root.match(new RegExp(`${name}:light-dark\\((#[0-9A-Fa-f]{6}),\\s*(#[0-9A-Fa-f]{6})\\)`));
    assert.ok(m, `${name} is a light-dark() token`);
    return [m[1], m[2]].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  };
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // Chrome, light theme, as plain status inks: −d on --field 4.45, on a hovered row 4.03; +a on a hovered row 4.44; a
  // hovered Stop was --red-ink on --hover 4.03; Stop is now .btn-danger (red text on --red-bg, hover tinted by the component).
  // The "K of N answered" lead is the Runs page's --ink on the white pill footer.
  const mixed = (tok) => `color-mix(in srgb, var(${tok}) 85%, var(--ink))`;
  for (const rule of [
    `.chat-rc-add{color:${mixed('--green-ink')};}`,
    '.chat-rc-del{color:var(--red-ink-soft);}',
    '.chat-rc-res-err{margin-right:auto;font-size:12px;color:var(--red-ink-soft);}',
    '.chat-rc-agent-model{min-width:0;flex:0 100000 auto;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2);font-family:var(--mono);font-size:11px;font-weight:500;}',
    '.chat-rc-deciding{padding:28px 16px;text-align:center;color:var(--ink-2);font-size:12px;}',
  ]) assert.ok(p3.includes(rule), rule);
  assert.ok(!p3.includes('.chat-rc-stop:hover'), 'Stop takes the .btn-danger hover, no rule of its own');
  assert.ok(css.includes(':is(.rd-questions,.chat-rc-q) .qanswered{font:600 var(--fs-body) var(--sans);color:var(--ink);}'));
  const ink = pair('--ink');
  for (const [fg, mix, bgs] of [['--green-ink', true, ['--field', '--hover']], ['--red-ink', true, ['--field', '--hover']],
    ['--red-ink', false, ['--panel']], ['--ink', false, ['--panel']]]) {
    for (const bg of bgs) {
      for (const t of [0, 1]) {
        const c = mix ? pair(fg)[t].map((v, i) => v * 0.85 + ink[t][i] * 0.15) : pair(fg)[t];
        const r = ratio(c, pair(bg)[t]);
        assert.ok(r >= 4.5, `${fg}${mix ? ' (85% with --ink)' : ''} on ${bg}, ${t ? 'dark' : 'light'}: ${r.toFixed(2)}:1`);
      }
    }
  }
  // The agent chip's model label sits on the chip wash (P1 .ask-rc-agent: color-mix(in srgb, var(--c) 12%, var(--panel)),
  // --c a node colour or --ink-3); the Auto well's words sit on --canvas-2. As --ink-3: 2.47–2.57:1 and 2.70:1 in light.
  const hex = (name) => {
    const m = root.match(new RegExp(`\\s${name}:(#[0-9A-Fa-f]{6});`));
    assert.ok(m, `${name} is one hex`);
    return [1, 3, 5].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  };
  for (const t of [0, 1]) {
    const washes = [...['--violet', '--blue', '--green', '--red', '--peach', '--amber'].map(hex), pair('--ink-3')[t]]
      .map((c) => c.map((v, i) => v * 0.12 + pair('--panel')[t][i] * 0.88));
    for (const bg of [...washes, pair('--canvas-2')[t]]) {
      const r = ratio(pair('--ink-2')[t], bg);
      assert.ok(r >= 4.5, `--ink-2 on rgb(${bg.map(Math.round).join(',')}), ${t ? 'dark' : 'light'}: ${r.toFixed(2)}:1`);
    }
  }
});

test('chat run card CSS: an agent chip never runs out of a narrow card (a long model id ellipsizes first, the cycle label never shrinks)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  // Chrome, 390 px, Expert: "Review Implementation claude-sonnet-4-5-20250929 cycle 3" (a REST card's raw model id) spanned
  // x 39..439 in a 20..370 card under P1's `.ask-rc-agent{white-space:nowrap}`.
  for (const rule of ['.chat-rc-agent{max-width:100%;}', '.chat-rc-agent-name{white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;}',
    '.chat-rc-agent-model{min-width:0;flex:0 100000 auto;overflow:hidden;text-overflow:ellipsis;', '.chat-rc-agent-cycle{flex:none;']) {
    assert.ok(p3.includes(rule), rule);
  }
});

test('chat run card levels (docs/ui-levels.md): the agent model, the artifacts and the pull-request actions are Advanced, a cycle label Expert; the controls, the question and the result words show in Simple', () => {
  const q = questionStub({ id: 'q-1', kind: 'clarify', heading: 'A question from Implementer', step: 'Implementer' }, '<button class="btn btn-primary" data-qpanel-submit>Submit</button>');
  const { card, $ } = mk({ controls: { ...q, prHost: () => true } });
  card.update(live({ active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2', label: 'Implementer', color: 'green', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', cycle: 2 }],
    pendingQuestion: { id: 'q-1', kind: 'questions', nodeId: 'n_impl', questions: [{}] } }));
  assert.equal($('.chat-rc-agent-model').dataset.minLevel, 'advanced', 'the run page\'s model · effort pill');
  assert.equal($('.chat-rc-agent-cycle').dataset.minLevel, 'expert', 'a loop badge');
  for (const sel of ['.chat-rc-agent', '.chat-rc-agent-name', '.chat-rc-foot', '.chat-rc-pause', '.chat-rc-stop', '.chat-rc-q', '.chat-rc-well']) {
    assert.equal($(sel).closest('[data-min-level]'), null, `${sel}: shown in Simple`);
  }
  card.update(done({ results: { filesChanged: 1, additions: 1, deletions: 0, checks: 0, topFiles: [{ path: 'a.mjs', additions: 1, deletions: 0, status: 'M' }] },
    artifacts: [{ kind: 'plan', relPath: 'plan.md', bytes: 1, nodeId: null, cycle: null }], moreArtifacts: true, pr: null }));
  assert.ok($('.chat-rc-create-pr'), 'precondition: Create pull request is painted');
  assert.equal($('.chat-rc-arts').dataset.minLevel, 'advanced', 'the run page\'s Artifacts tab');
  assert.equal($('.chat-rc-res-foot').dataset.minLevel, 'advanced', 'the run page\'s Create PR / View PR');
  for (const sel of ['.chat-rc-result', '.chat-rc-res-title', '.chat-rc-res-churn', '.chat-rc-files']) {
    assert.equal($(sel).closest('[data-min-level]'), null, `${sel}: shown in Simple (the "Files changed" stand-in)`);
  }
  const gated = [...card.el.querySelectorAll('[data-min-level]')].filter((n) => !n.closest('.chat-rc-well')).map((n) => n.className);
  assert.deepEqual(gated, ['chat-rc-arts', 'chat-rc-res-foot']);
  // View pull request carries the same level as Create (an open PR paints only the link).
  card.update(done({ results: null, artifacts: [], moreArtifacts: false, pr: { url: 'https://github.com/o/r/pull/9', number: 9, state: 'OPEN' } }));
  assert.ok($('.chat-rc-view-pr'), 'precondition: View pull request is painted');
  assert.equal($('.chat-rc-view-pr').closest('[data-min-level]').dataset.minLevel, 'advanced', 'View PR: the run page\'s level');
});

test('chat run card controls: a triple-click\'s third press never undoes the first either', async () => {
  const calls = [];
  const { card, $, win } = mk({ controls: {
    resume: () => { calls.push('resume'); return Promise.resolve(); },
    pause: () => { calls.push('pause'); return Promise.resolve(null); },
  } });
  card.update(live({ status: 'paused', active: [] }));
  for (const detail of [1, 2, 3]) {
    $('.chat-rc-pause').dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail }));
    await settle();
    if (detail === 1) card.update(live());                // the resumed lineage runs: the same button now says Pause
  }
  assert.deepEqual(calls, ['resume']);
});

test('chat run card: an answer whose 200 lands before the question goes away keeps its receipt when the run then pauses (a recovery "Pause")', async () => {
  const pq = { id: 'rc-rec-1', kind: 'recovery', nodeId: 'n_impl', recovery: { cls: 'auth', options: [{ id: 'retry' }, { id: 'pause' }] } };
  const q = stepStub(pq, renderRecoveryCard);
  const { card, $ } = mk({ controls: { ...q, answer: async () => true } });
  card.update(live({ pendingQuestion: pq }));
  $('.chat-rc-q .recovery-pause').click();
  await settle();                                          // the 200 landed while the question still showed
  assert.deepEqual(q.log.posts, [{ decision: 'pause' }]);
  card.update(live({ status: 'pausing', pendingQuestion: null }));
  assert.equal($('.chat-rc-receipt').hidden, false, 'the card names what it sent');
  assert.equal($('.chat-rc-receipt summary').textContent, 'Paused');
  // Resumed: the new harness asks `rc-rec-1` again and the network probe answers it by itself. The first answer's name
  // is not this one's.
  card.update(live({ pendingQuestion: pq }));
  card.update(live({ pendingQuestion: null }));
  assert.equal($('.chat-rc-receipt summary').textContent, 'Answered · Implementer');
  assert.deepEqual(q.log.posts, [{ decision: 'pause' }]);
});

test('chat run card: a note this tab left on another run\'s question with the same id never names this run\'s answer', async () => {
  const pq = { id: 'gate-review-1', kind: 'gate', nodeId: 'n_impl', issues: [] };
  noteAnswer('run-other', pq, { decision: 'another' });
  const { card, $ } = mk({ controls: { ...stepStub(pq, renderGateCard), answer: async () => true } });
  card.update(live({ pendingQuestion: pq }));
  card.update(live({ pendingQuestion: null }));                // answered from another device
  assert.equal($('.chat-rc-receipt summary').textContent, 'Answered · Implementer');
  forgetAnswer('run-other', pq.id);
});

test('chat run card while shaping (Shape it first): "Clarify ✓ · Plan ✓ · Refine ✓ while planning", the plan file, Saved to + Open; hidden with nothing approved', async () => {
  const SHAPING = (over = {}) => ({ perspectives: ['ux'], rounds: [{ round: 1 }], approved: { round: 1, file: 'docs/plans/2026-10-14-login.md' }, savedTo: null, ...over });
  await checkRows([
    { name: 'an approved plan shows the line and the plan file name, between the labels and the stats', run: () => {
      const { card, $ } = mk();
      card.update(live({ shaping: SHAPING() }));
      const line = $('.chat-rc-shaped');
      assert.equal(line.hidden, false);
      assert.equal(line.previousElementSibling, $('.chat-rc-fix'), 'only the PR fix-run line (hidden on any other card) sits between');
      assert.deepEqual([$('.chat-rc-fix').hidden, $('.chat-rc-fix').previousElementSibling], [true, $('.chat-rc-labels')]);
      assert.equal(line.nextElementSibling, $('.chat-rc-members'), 'a group card\'s member rows sit between (slice 4)');
      assert.equal($('.chat-rc-members').hidden, true, 'a single run has none');
      assert.equal($('.chat-rc-members').nextElementSibling, $('.ask-rc-stats'));
      assert.equal($('.chat-rc-shaped-stages').textContent, 'Clarify ✓ · Plan ✓ · Refine ✓ while planning');
      assert.equal($('.chat-rc-shaped-plan').textContent, 'Plan: 2026-10-14-login.md');
      assert.equal($('.chat-rc-shaped-saved'), null, 'not saved: no Saved to');
      assert.equal($('.chat-rc-shaped-open'), null);
    } },
    { name: 'no shaping, or nothing approved, hides it — and a later snapshot without it hides a shown line', run: () => {
      const { card, $ } = mk();
      card.update(live());
      assert.equal($('.chat-rc-shaped').hidden, true);
      card.update(live({ shaping: SHAPING({ approved: null }) }));
      assert.equal($('.chat-rc-shaped').hidden, true);
      card.update(live({ shaping: SHAPING() }));
      assert.equal($('.chat-rc-shaped').hidden, false);
      card.update(live({ shaping: SHAPING({ approved: null }) }));
      assert.equal($('.chat-rc-shaped').hidden, true);
    } },
    { name: 'saved: "Saved to <path>" with an Open button that opens the plan through ctx.openArtifact', run: () => {
      const { card, $, calls } = mk();
      card.update(live({ shaping: SHAPING({ savedTo: 'docs/plans/2026-10-14-login.md' }) }));
      assert.equal($('.chat-rc-shaped-saved').textContent, 'Saved to docs/plans/2026-10-14-login.md');
      const open = $('.chat-rc-shaped-open');
      assert.equal(open.tagName, 'BUTTON');
      assert.equal(open.type, 'button');
      assert.equal(open.textContent, 'Open');
      open.click();
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'artifact');
      assert.equal(calls[0][1].pipelineId, 'abcd1234');
      assert.equal(calls[0][1].runId, 'run-uuid-1');
      assert.deepEqual(calls[0][2], { relPath: 'docs/plans/2026-10-14-login.md', kind: 'plan' });
    } },
    { name: 'a repaint never stacks a second line', run: () => {
      const { card } = mk();
      const snap = live({ shaping: SHAPING({ savedTo: 'docs/plans/x.md' }) });
      card.update(snap);
      card.update(snap);
      assert.equal(card.el.querySelectorAll('.chat-rc-shaped-stages').length, 1);
      assert.equal(card.el.querySelectorAll('.chat-rc-shaped-open').length, 1);
    } },
  ]);
});

const PQ_PLAN = { id: 'plan-n_refine-1', kind: 'plan', plan: { round: 1 } };
const SL = (i, state, over = {}) => ({ index: i, title: `Part ${i}`, state, runId: null, pipelineId: null, ticketId: `t${i}`, pr: null, ...over });
const VIEW3 = (slices, over = {}) => ({ id: 'feat-1', title: 'Charts', status: 'active', total: 3, done: slices.filter((s) => s.state === 'done').length,
  halted: null, slices, ask: null, log: [], originPipelineId: 'abcd1234', ship: { ready: false, mode: null }, ...over });
// The file's MANIFEST (planner done, implementer running) gives runProgress the Build stage: a shaping card pins Plan.
const PLAN_PROG = { mode: 'stages', stage: 'plan', label: 'Plan', fraction: 0.1, tone: 'blue', text: 'Plan', stages: [], passes: 0 };
const shaped = (card, snaps = {}, over = {}, stateOver = {}) => live({ shaping: { rounds: [] }, stageProgress: PLAN_PROG, shaper: { card, snaps }, ...over }, stateOver);
// The merge (D4): a feature card's head, status line and member rows are its group row's (groupModel, as app.js
// groupRow builds it); controls.groupOf hands it to the card.
const DONE_RUN = { status: 'done', endReached: true };
const WAITING = { ticket: { status: 'scheduled', after: { index: 2 } } };
const featureRow = (members, over = {}) => {
  const model = groupModel({ kind: 'feature', title: 'Charts', planning: DONE_RUN, members }, { now: NOW });
  return { kind: 'chain', groupKind: 'feature', groupId: 'feat-1', title: 'Charts', model, count: model.count.text,
    planning: { title: 'Planning', href: '#running/r0', model: model.planning },
    members: model.members.map((m, i) => ({ position: i + 1, title: `Part ${i + 1}`, href: '#runs', model: m })), ...over };
};

test('#959 head: dot · title · Open on one line, the meta line right under it, then the status block; the run card well is a .gv-well', () => {
  const { card } = mk();
  assert.deepEqual([...card.el.children].slice(0, 3).map((n) => n.className.split(' ')[0]), ['ask-rc-head', 'ask-rc-sub', 'chat-rc-status']);
  assert.deepEqual([...card.el.querySelector('.ask-rc-head').children].map((n) => n.className.split(' ')[0]), ['status-dot', 'ask-rc-title', 'kind-chip', 'ask-rc-spacer', 'ask-rc-open']);
  assert.ok(card.el.querySelector('.run-flow-wrap.chat-rc-well.gv-well'));
});

test('#959 kind chip: a group row that kindLabel calls a plain run (not a chain) paints no chip', () => {
  // A real row with a model (update() reads curRow.model), but not a chain: kindLabel returns 'Run' for it.
  const row = featureRow([WAITING], { kind: 'single' });
  const { card, $ } = mk({ controls: { memoFor: () => ({}), groupOf: () => row } });
  card.update(live());
  assert.equal($('.kind-chip').hidden, true);
  assert.equal($('.kind-chip').textContent, '');
});

test('feature card: Shaping, then the group row\'s chip, one status line and its member rows Planning, 1, 2, 3', () => {
  let row = null;
  const { card, $, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => row } });
  card.update(shaped({ pipelineId: 'abcd1234', feature: null, log: [] }));
  assert.equal($('.kind-chip').textContent, 'Shaping');
  assert.equal($('.kind-chip').hidden, false);
  assert.ok($('.ask-rc-head > .status-dot'), 'the head dot is the model\'s status dot');
  assert.equal($$('.run-status-word').length, 1);
  assert.equal($('.chat-rc-members').hidden, true);
  const asking = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
  row = featureRow([asking, WAITING, WAITING]);
  card.update(shaped({ pipelineId: 'abcd1234', feature: VIEW3([SL(1, 'approval', { pipelineId: 'abcd1234', runId: 'run-uuid-1' }), SL(2, 'planned'), SL(3, 'planned')]), log: [] },
    {}, { pendingQuestion: PQ_PLAN }));
  assert.equal($('.kind-chip').textContent, 'Feature · 3 runs');
  assert.equal($('.kind-chip').hidden, false);
  assert.deepEqual($$('.run-member-title').map((n) => n.textContent), ['Planning', 'Part 1', 'Part 2', 'Part 3']);
  assert.equal($$('.run-status-word').length, 1, 'one status line');
  assert.equal($$('ol.run-members').length, 1, 'one member list');
  // Fix 1: the chat card's member list is the group page's table — ink title over the status line, PR, cost, quiet ›.
  const ol = $('.chat-rc-members > ol.run-members');
  assert.ok(ol.classList.contains('is-table'), 'the group page\'s table, not the old plain rows');
  const lis = [...ol.querySelectorAll(':scope > li.run-member')];
  assert.equal(lis.length, 4, 'Planning + 3');
  for (const li of lis) {
    assert.deepEqual([...li.children].map((c) => c.className.split(' ')[0]),
      ['status-dot', 'run-member-num', 'run-member-main', 'run-member-pr', 'run-member-cost', 'run-member-go']);
    assert.deepEqual([...li.querySelector('.run-member-main').children].map((c) => c.className), ['run-member-title', 'run-member-line']);
  }
  assert.equal($$('.chat-rc-fstatus, .chat-rc-chain, ol.chat-rc-members, .ask-rc-pill').length, 0, 'no Shaper duplicate');
});

test('feature card: the step log shows Clarify · 2 answers, Plan approved, Split into 3 runs; Show unfolds in place', () => {
  const { card, $, el = card.el } = mk();
  const log = [{ key: 'clarify', run: null, text: 'Clarify · 2 answers', detail: ['Where? → Redis', 'How? → JSON'] },
    { key: 'p-0', run: null, text: 'Split into 3 runs', detail: ['1 · Part 1', '2 · Part 2', '3 · Part 3'] },
    { key: '1-1', run: 1, text: 'Plan approved', detail: ['Goal: Goal 1'] }];
  card.update(shaped({ pipelineId: 'abcd1234', feature: VIEW3([SL(1, 'running', { pipelineId: 'abcd1234' }), SL(2, 'planned'), SL(3, 'planned')], { log }), log }));
  assert.deepEqual([...el.querySelectorAll('.chat-rc-log-text')].map((n) => n.textContent), ['Clarify · 2 answers', 'Split into 3 runs', 'Plan approved']);
  const row = el.querySelector('.chat-rc-log-row[data-key="p-0"]');
  row.querySelector('.chat-rc-log-show').click();
  assert.equal(row.querySelector('.chat-rc-log-detail').hidden, false);
  assert.equal(row.querySelector('.chat-rc-log-detail').parentNode, row, 'unfolded in place, in its own row');
  assert.ok(el.querySelector('.chat-rc-log').compareDocumentPosition(el.querySelector('.chat-rc-q')) & 4, 'the open step sits below the log');
});

test('feature card: an answered step shows once — its receipt gives way to the step log row that names it', () => {
  const pq = { id: 'clarify-once-1', kind: 'clarify', nodeId: 'n_plan' };
  try {
    setShapeFirst(true);
    const q = questionStub({ id: pq.id, kind: 'clarify', heading: 'Clarify', stepCard: false }, '<button class="btn btn-primary">Send</button>');
    const { card, $, $$ } = mk({ controls: q });
    const feature = VIEW3([SL(1, 'planned'), SL(2, 'planned'), SL(3, 'planned')]);
    card.update(shaped({ pipelineId: 'abcd1234', feature, log: [] }, {}, { pendingQuestion: pq }));
    assert.equal($('.chat-rc-q').hidden, false, 'the clarify is the open step');
    noteAnswer('run-uuid-1', pq, { answers: [{ id: 'a', question: 'Where?', choice: 'Redis' }, { id: 'b', question: 'How?', choice: 'JSON' }] }, { shaping: true });
    card.update(shaped({ pipelineId: 'abcd1234', feature, log: [] }));
    assert.equal($('.chat-rc-receipt').hidden, false, 'until the log names it, the receipt says what was sent');
    assert.equal($('.chat-rc-receipt summary').textContent, 'Clarify · 2 answers');
    const log = [{ key: 'clarify', run: null, text: 'Clarify · 2 answers', detail: ['Where? → Redis', 'How? → JSON'] }];
    card.update(shaped({ pipelineId: 'abcd1234', feature: { ...feature, log }, log }));
    assert.deepEqual($$('.chat-rc-log-text').map((n) => n.textContent), ['Clarify · 2 answers']);
    assert.equal($('.chat-rc-receipt').hidden, true, 'the log row names the step: no second "Clarify · 2 answers"');
    assert.equal($('.chat-rc-q').hidden, true, 'and no empty question section');
  } finally {
    forgetAnswer('run-uuid-1', pq.id);
    setShapeFirst(false);
  }
});

test('feature card: run 2\'s plan ask is the open step, painted and answered with run 2\'s ref, status Run 2 of 3 · needs you', async () => {
  const answered = [];
  const stub = questionStub({ id: PQ_PLAN.id, kind: 'plan', heading: 'Plan · run 2', stepCard: false }, '<button class="btn btn-primary" data-qpanel-submit>Approve</button>');
  const painted = [];
  const asking = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
  const row = featureRow([DONE_RUN, asking, WAITING]);
  const { card, $ } = mk({ controls: { ...stub, memoFor: () => ({}), groupOf: () => row,
    paintQuestion: (ref, host) => { painted.push(ref); return stub.paintQuestion(ref, host); },
    answer: (ref, id, payload) => { answered.push([ref.pipelineId, id]); return true; } } });
  const two = { ...live({}, {}), source: 'live', runId: 'run-2', pipelineId: 'beef0002', status: 'running', pendingQuestion: PQ_PLAN };
  const v = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'approval', { pipelineId: 'beef0002', runId: 'run-2' }), SL(3, 'planned')],
    { ask: { index: 2, runId: 'run-2', pipelineId: 'beef0002', id: PQ_PLAN.id, kind: 'plan' } });
  card.update(shaped({ pipelineId: 'abcd1234', feature: v, log: [] }, { beef0002: two }, { status: 'done', terminal: true }, { status: 'done', active: [] }));
  assert.equal($('.run-status').dataset.text, 'Run 2 of 3 · needs you');
  assert.equal($('.ask-rc-head > .status-dot').getAttribute('aria-label'), row.model.word, 'the group\'s word, not the planning run\'s Done');
  assert.equal($('.chat-rc-q').hidden, false, 'D11: the Shaper open step wins over ownIsCurrent()');
  assert.equal(painted.at(-1).pipelineId, 'beef0002');
  $('.chat-rc-q [data-qpanel-submit]').click();
  await settle();
  assert.deepEqual(answered, [['beef0002', PQ_PLAN.id]]);
});

test('feature card: the summary strip is gone — a shaped snapshot never calls ctx.mountFeature', () => {
  const { card, calls } = mk();
  card.update(shaped({ pipelineId: 'abcd1234', feature: VIEW3([SL(1, 'running', { pipelineId: 'abcd1234' }), SL(2, 'planned'), SL(3, 'planned')]), log: [] },
    {}, { shaping: { feature: { id: 'feat-1', index: 1, total: 3 } } }));
  assert.equal(calls.filter((c) => c[0] === 'feature').length, 0);
});

test('controller: ctx.shaperCard feeds the card, member snapshots come from the run store, onChange repaints', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  let cardJson = null; let onChange = null;
  const two = { source: 'live', runId: 'run-2', pipelineId: 'beef0002', status: 'running', pendingQuestion: PQ_PLAN, stageProgress: null };
  const own = live({ shaping: { feature: { id: 'feat-1' } } });
  const runStore = { subscribe: () => () => {}, byPipeline: (pid) => (pid === 'abcd1234' ? own : pid === 'beef0002' ? two : null), get: () => null };
  const painted = [];
  const ctl = createRunCardController({ runStore, tickMs: 0, controls: { paintQuestion: (ref) => { painted.push(ref.pipelineId); return null; } } });
  const built = ctl.build({ id: 'card_00000001', card: { type: PROGRESS_CARD_TYPE, pipelineId: 'abcd1234', runId: 'run-uuid-1', title: 'Fix login' } },
    { doc: dom.window.document, win: dom.window, shaperCard: (pid, fn) => { onChange = fn; return cardJson; } });
  dom.window.document.body.appendChild(built.el);
  assert.equal(built.el.querySelector('.chat-rc-log').hidden, true, 'no card JSON yet');
  const log = [{ key: 'p-0', run: null, text: 'Split into 3 runs', detail: [] }];
  cardJson = { pipelineId: 'abcd1234', log, feature: VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'approval', { pipelineId: 'beef0002', runId: 'run-2' }), SL(3, 'planned')], { log }) };
  onChange();
  assert.equal(built.el.querySelector('.chat-rc-log-text').textContent, 'Split into 3 runs');
  assert.equal(painted.at(-1), 'beef0002', 'the member\'s live snapshot (run store) is the open step');
  built.dispose(); ctl.destroy();
});

test('controller: a finished planning run without shaping (the REST snapshot) still asks for its card; a live plain run never does', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const asked = [];
  const rest = { ...live({}, { status: 'done' }), source: 'rest', terminal: true, status: 'done' };   // rowToState: no shaping
  delete rest.shaping;
  const plain = live({}, {});                                                                        // live, running, no shaping
  for (const [snapOf, pid] of [[rest, 'abcd1234'], [plain, 'abcd1234']]) {
    const runStore = { subscribe: () => () => {}, byPipeline: () => snapOf, get: () => null };
    const ctl = createRunCardController({ runStore, tickMs: 0 });
    const built = ctl.build({ id: 'card_00000001', card: { type: PROGRESS_CARD_TYPE, pipelineId: pid, runId: 'run-uuid-1', title: 'Fix login' } },
      { doc: dom.window.document, win: dom.window, shaperCard: (p) => { asked.push([snapOf.source, p]); return null; } });
    dom.window.document.body.appendChild(built.el);
    built.dispose(); ctl.destroy();
  }
  assert.ok(asked.some(([src, p]) => src === 'rest' && p === 'abcd1234'), JSON.stringify(asked));
  assert.ok(!asked.some(([src]) => src === 'live'), 'a live running snapshot without shaping asks for nothing');
});

test('chat run card: a plan question paints through the registered `plan` ask renderer, and its Submit collects through it', async () => {
  const seen = { render: 0, collect: 0 };
  registerAskRenderer('plan', {
    render(panel, pq) { seen.render += 1; panel.innerHTML = `<div class="plan-body">${pq.round}</div><button class="btn btn-primary" data-qpanel-submit>Approve</button>`; },
    collect() { seen.collect += 1; return { decision: 'approve' }; },
  });
  const pq = { id: 'p-1', kind: 'plan', nodeId: 'n_plan', round: 1 };
  const sent = [];
  // app.js chatPaintQuestion → renderQpanel: askRendererFor(askKindOf(pq)).render(panel, pq).
  const controls = {
    paintQuestion(ref, host) {
      const panel = host.querySelector('.qpanel');
      askRendererFor(askKindOf(pq)).render(panel, pq);
      panel.classList.remove('hidden');
      return { id: pq.id, kind: askKindOf(pq), heading: 'Review the plan', step: 'Planner' };
    },
    releaseQuestion() {},
    answer: async (ref, qid, payload) => { sent.push([qid, payload]); return true; },
  };
  const { card, $ } = mk({ controls });
  card.update(live({ pendingQuestion: pq }));
  assert.equal(seen.render, 1, 'the plan renderer drew the question');
  assert.equal($('.chat-rc-q').hidden, false);
  assert.equal($('.chat-rc-q .plan-body').textContent, '1');
  $('.chat-rc-q .btn-primary').click();
  await settle();
  assert.equal(seen.collect, 1);
  assert.deepEqual(sent, [['p-1', { decision: 'approve' }]]);
});

test('snapshotFromState carries state.shaping; without it the key set is unchanged', () => {
  const shaping = { perspectives: [], rounds: [], approved: { round: 2, file: 'docs/plans/p.md' }, savedTo: 'docs/plans/p.md' };
  assert.deepEqual(snapshotFromState(STATE({ shaping }), { now: 0 }).shaping, shaping);
  const plain = snapshotFromState(STATE(), { now: 0 });
  assert.equal('shaping' in plain, false);
  assert.deepEqual(Object.keys(snapshotFromState(STATE({ shaping: null }), { now: 0 })), Object.keys(plain));
});

test('chat run card result region: the checklist tally of a shaped run (spec D7)', async () => {
  const RES = (checklist) => ({ filesChanged: 1, additions: 1, deletions: 0, checks: 0, topFiles: [], ...(checklist ? { checklist } : {}) });
  const ex = (checklist) => ({ results: RES(checklist), artifacts: [], moreArtifacts: false, pr: null });
  await checkRows([
    { name: 'unmet: the tally line reads out the counts and is open', run: () => {
      const { card, $ } = mk();
      card.update(done(ex({ met: 1, unmet: 1, na: 0, missing: 0, total: 2 })));
      const el = $('.chat-rc-checklist');
      assert.equal(el.querySelector('.chat-rc-checklist-btn').textContent, 'Checklist 1/2');
      assert.ok(el.classList.contains('is-open'));
    } },
    { name: 'all met: not open', run: () => {
      const { card, $ } = mk();
      card.update(done(ex({ met: 2, unmet: 0, na: 1, missing: 0, total: 3 })));
      assert.ok(!$('.chat-rc-checklist').classList.contains('is-open'));
    } },
    { name: 'not reported counts as open and is named', run: () => {
      const { card, $ } = mk();
      card.update(done(ex({ met: 1, unmet: 0, na: 0, missing: 1, total: 2 })));
      assert.equal($('.chat-rc-checklist-btn').textContent, 'Checklist 1/2');
      assert.ok($('.chat-rc-checklist').classList.contains('is-open'));
    } },
    { name: 'pressing the line unfolds the checklist groups in place', run: async () => {
      const reviews = [{ kind: 'plan', cycle: 1, checklist: [{ perspective: 'qa', id: 'R-qa-1', text: 'x', status: 'met' }] }];
      const { card, $, calls } = mk({ ctx: { checklists: async () => reviews } });
      card.update(done(ex({ met: 1, unmet: 0, na: 0, missing: 0, total: 1 })));
      $('.chat-rc-checklist-btn').click();
      await settle();
      assert.equal($('.chat-rc-checklist-btn').getAttribute('aria-expanded'), 'true');
      assert.ok($('.chat-rc-checklist-groups .shape-checklists'));
      assert.equal(calls.filter((c) => c[0] === 'panel').length, 0);
    } },
    { name: 'no reviews load: the line opens the run\'s Overview instead', run: async () => {
      const { card, $, calls } = mk({ ctx: { checklists: async () => null } });
      card.update(done(ex({ met: 1, unmet: 0, na: 0, missing: 0, total: 1 })));
      $('.chat-rc-checklist-btn').click();
      await settle();
      assert.equal($('.chat-rc-checklist-btn').getAttribute('aria-expanded'), 'false');
      assert.deepEqual(calls.filter((c) => c[0] === 'panel').map((c) => c[2]), [{ tab: 'overview' }]);
    } },
    { name: 'no checklist: no line', run: () => {
      const { card, $ } = mk();
      card.update(done(ex(null)));
      assert.equal($('.chat-rc-checklist'), null);
    } },
  ]);
});

test('chat run card progress bar (P9, slice 4): the status block\'s bar from the one model; stopped and finished runs hide it', async () => {
  await checkRows([
    { name: 'a live snapshot shows the status block\'s bar, and no Progress tile', run: () => {
      const { card, $ } = mk();
      card.update(live());
      const bar = $('.chat-rc-status .run-status-bar');
      assert.equal(bar.hidden, false);
      assert.ok(bar.classList.contains('run-prog'));
      assert.equal($('.ask-rc-prog'), null, 'the bar replaces the Progress tile');
      assert.equal($('.chat-rc-prog'), null);
    } },
    { name: 'a paused run keeps its bar', run: () => {
      const { card, $ } = mk();
      card.update(live({ status: 'paused', active: [] }));
      assert.equal($('.chat-rc-status .run-status-bar').hidden, false);
    } },
    { name: 'a stopped run hides the bar', run: () => {
      const { card, $ } = mk();
      card.update(live({ status: 'stopped' }));
      assert.equal($('.chat-rc-status .run-status-bar').hidden, true);
    } },
    { name: 'a frozen done state that reached the end gives stageProgress.fraction 1, green, Finished', run: () => {
      const snap = snapshotFromState(STATE({ status: 'done', endReached: true, active: [], steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1 })] }), { now: 0 });
      assert.equal(snap.stageProgress.fraction, 1);
      assert.equal(snap.stageProgress.tone, 'green');
      assert.equal(snap.stageProgress.text, 'Finished');
    } },
    { name: 'a v1 frozen state carries no stageProgress', run: () => {
      assert.equal(snapshotFromState(STATE({ stepper: null }), { now: 0 }).stageProgress, null);
    } },
  ]);
});

test('chat run card, a folder run: Finished · N files changed and Apply to folder at every level; Applied once settled; never a pull request', async () => {
  const CH = { state: 'pending', counts: { added: 9, modified: 4, deleted: 1 } };
  const EX = { results: null, artifacts: [], moreArtifacts: false, pr: null };
  const applied = []; const openers = [];
  const { card, $, refreshed } = mk({ controls: { prHost: () => true, openApply: (ref, opener) => { applied.push(ref.pipelineId); openers.push(opener); return Promise.resolve({ applied: 13, skipped: [] }); } } });
  card.update(done({ ...EX, changes: CH }, { workMode: 'folder', changes: CH }));
  // Said once: the status line reads "Finished · 14 files changed", so the block keeps only its churn and actions.
  assert.equal($('.chat-rc-res-text'), null);
  assert.equal($('.chat-rc-create-pr'), null);
  const b = $('.chat-rc-apply');
  assert.equal(b.textContent, 'Apply to folder');
  assert.equal(b.closest('[data-min-level]'), null, 'Simple: a plain-folder person lands it from the chat');
  b.click(); b.click();
  assert.equal(b.disabled, false, 'never disabled: the dialog returns focus to it');
  await settle();
  assert.deepEqual(applied, ['abcd1234'], 'one dialog for a double click');
  assert.equal(openers[0], b, 'the dialog returns focus to the card\'s button');
  assert.equal(refreshed.length, 1, 'the card re-reads the run once the dialog settles');
  card.update(done(EX, { workMode: 'folder', changes: { ...CH, state: 'applied' } }));
  assert.equal($('.chat-rc-status').dataset.text.startsWith('Applied'), true, 'the status line says Applied');
  assert.equal($('.chat-rc-res-text'), null);
  assert.equal($('.chat-rc-apply'), null);
  assert.deepEqual(resultWord(done(null, { workMode: 'folder', changes: { ...CH, state: 'discarded' } })),
    { key: 'folder', tone: 'green', glyph: 'check', title: 'Discarded', sub: '14 files changed' });
  assert.deepEqual(resultWord(done(null, { workMode: 'folder', changes: { state: 'discarded', counts: { added: 0, modified: 0, deleted: 0 } } })),
    { key: 'folder', tone: 'green', glyph: 'check', title: 'Finished', sub: 'No files changed' }, 'a run that changed nothing was never discarded');
  const snap = snapshotFromState(STATE({ status: 'done', workMode: 'folder' }), { now: 0, extras: { ...EX, changes: CH } });
  assert.deepEqual([snap.workMode, snap.changes], ['folder', CH]);
  assert.equal('workMode' in snapshotFromState(STATE(), { now: 0 }), false, 'a git run keeps its key set');
  const { card: c2, $: $2, calls } = mk({ controls: { openApply: () => Promise.resolve(null) } });
  c2.update(done({ ...EX, results: { filesChanged: 1, additions: 1, deletions: 0, checks: 0, topFiles: [{ path: 'index.csv', additions: 1, deletions: 0 }] }, changes: CH },
    { workMode: 'folder', changes: CH }));
  $2('.chat-rc-file').click();
  assert.deepEqual(calls.at(-1)[2], { tab: 'changes' }, 'a folder run\'s file opens its Changes tab');
});

test('chat run card: Create pull request asks isGitRun (CONTRACT §2) — a run with no branch never offers one', () => {
  const EX = { results: null, artifacts: [], moreArtifacts: false, pr: null };
  const { card, $ } = mk({ controls: { prHost: () => true } });
  card.update(done(EX));
  assert.ok($('.chat-rc-create-pr'), 'a git run that is ready to ship offers it');
  card.update(done(EX, { workMode: 'none' }));
  assert.equal($('.chat-rc-create-pr'), null);
});

test('chat run card: a Folder run, a run without a project and a git run while git is missing read Finished words and offer no Ship it', async () => {
  const EX = { results: null, artifacts: [], moreArtifacts: false, pr: null };
  const status = ($) => $('.chat-rc-status').dataset.text;
  const ships = ($$) => $$('[data-model-action="ship"]').filter((b) => !b.hidden).length;
  await checkRows([
    { name: 'a git run with git: Ready to ship and Ship it (the control row)', run: () => {
      const { card, $, $$ } = mk({ controls: { prHost: () => true } });
      card.update(done(EX));
      assert.equal(status($), 'Ready to ship');
      assert.equal(ships($$), 1);
    } },
    { name: 'a Folder run that was applied', run: () => {
      const CH = { state: 'applied', counts: { added: 2, modified: 1, deleted: 0 } };
      const { card, $, $$ } = mk({ controls: { prHost: () => true } });
      card.update(done({ ...EX, changes: CH }, { workMode: 'folder', changes: CH }));
      assert.equal(status($), 'Applied · 3 files changed');
      assert.equal(ships($$), 0);
    } },
    { name: 'a run without a project', run: () => {
      const { card, $, $$ } = mk({ controls: { prHost: () => true } });
      card.update(done(EX, { workMode: 'none' }));
      assert.equal(status($), 'Finished');
      assert.equal(ships($$), 0);
    } },
    { name: 'a git run while git is missing', run: () => {
      const { card, doc, $, $$ } = mk({ controls: { prHost: () => true } });
      doc.documentElement.dataset.git = 'off';
      card.update(done(EX));
      assert.equal(status($), 'Finished');
      assert.equal(ships($$), 0);
    } },
  ]);
});

test('chat run card, a folder run: no Apply to folder when nothing changed or the run is archived', () => {
  const EX = { results: null, artifacts: [], moreArtifacts: false, pr: null };
  const { card, $ } = mk({ controls: { openApply: () => Promise.resolve(null) } });
  card.update(done(EX, { workMode: 'folder', changes: { state: 'pending', counts: { added: 0 } } }));
  assert.equal($('.chat-rc-apply'), null, 'nothing to apply');
  card.update(done(EX, { workMode: 'folder', archived: true, changes: { state: 'pending', counts: { added: 2 } } }));
  assert.equal($('.chat-rc-apply'), null, 'an archived run has no copy');
  // Apply keeps its own look; Create PR and View PR are the shared .btn (no rule of their own).
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /(^|\})\.chat-rc-apply\{/m);
  assert.doesNotMatch(css, /\.chat-rc-(?:create|view)-pr[^{}]*\{/);
});

test('progressIdent: a started No project proposal names the reserved key and No project before its first frame', () => {
  assert.deepEqual(progressIdent({ id: 'card_00000001', runId: 'r-np', card: { target: 'none', projectKey: null, projectName: null, title: 'Q3 Hiring Deck' } }),
    { cardId: 'card_00000001', pipelineId: null, runId: 'r-np', projectKey: 'no-project-00000000', workspaceId: null, title: 'Q3 Hiring Deck', label: 'No project' });
});

test('chat run card: a run without a project names No project and lists its files with sizes and Download', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = dom.window.document;
  const got = [];
  const card = createChatRunCard({ doc, snapshot: { source: 'rest', status: 'done', terminal: true, pipelineId: 'a41c09d2', projectKey: 'no-project-00000000', workMode: 'none', title: 'Q3 Hiring Deck',
    artifacts: [{ kind: 'work', relPath: 'work/deck.html', bytes: 86016 }, { kind: 'work', relPath: 'work/charts/headcount.svg', bytes: 12288 }], artifactsTotal: 2, results: null },
  ctx: { downloadArtifact: (ref, a) => got.push([ref.pipelineId, a.relPath]) } });
  doc.body.appendChild(card.el);
  const where = card.el.querySelector('.chat-rc-where');
  assert.equal(where.querySelector('.kind-chip.kind-none').textContent, 'No project');
  assert.equal(where.textContent, 'No project');
  assert.equal(where.title, 'Run a41c09d2');
  const list = card.el.querySelector('.chat-rc-arts-list');
  assert.equal(list.querySelector('.cap').textContent, 'Artifacts · 2');
  assert.equal(list.getAttribute('aria-label'), 'Artifacts');
  assert.equal(list.hasAttribute('data-min-level'), false);
  assert.equal(card.el.querySelector('.chat-rc-create-pr'), null);
});

test('chat run card: a run without a project lists each file as a name, its size and a Download button', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = dom.window.document;
  const got = [];
  const card = createChatRunCard({ doc, snapshot: { source: 'rest', status: 'done', terminal: true, pipelineId: 'a41c09d2', projectKey: 'no-project-00000000', workMode: 'none', title: 'Q3 Hiring Deck',
    artifacts: [{ kind: 'work', relPath: 'work/deck.html', bytes: 86016 }, { kind: 'work', relPath: 'work/charts/headcount.svg', bytes: 12288 }], artifactsTotal: 2, results: null },
  ctx: { downloadArtifact: (ref, a) => got.push([ref.pipelineId, a.relPath]) } });
  const list = card.el.querySelector('.chat-rc-arts-list');
  assert.deepEqual([...list.querySelectorAll('.chat-rc-art-name')].map((b) => b.textContent), ['deck.html', 'charts/headcount.svg']);
  assert.deepEqual([...list.querySelectorAll('.chat-rc-art-size')].map((b) => b.textContent), ['84.0 KB', '12.0 KB']);
  assert.equal(list.querySelectorAll('.chat-rc-art-row')[1].querySelector('.faint').textContent, 'charts/');
  // The NoProjectRun board: one bordered list of rows, a file icon first on each.
  assert.equal(list.querySelectorAll('.chat-rc-art-rows > .chat-rc-art-row').length, 2);
  for (const row of list.querySelectorAll('.chat-rc-art-row')) assert.equal(row.firstElementChild.tagName.toLowerCase(), 'svg');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  // Runs redesign design language: a sentence-case caption (no uppercase tracked micro-label) and token radii.
  for (const rule of ['.chat-rc-arts-list .cap{font-size:12px;font-weight:600;color:var(--ink-2);}',
    '.chat-rc-art-rows{border:1px solid var(--line);border-radius:var(--r-card);overflow:hidden;background:var(--panel);}',
    '.chat-rc-art-row + .chat-rc-art-row{border-top:1px solid var(--line);}']) assert.ok(css.includes(rule), rule);
  const dls = [...list.querySelectorAll('.chat-rc-art-dl')];
  assert.deepEqual(dls.map((b) => b.getAttribute('aria-label')), ['Download deck.html', 'Download headcount.svg']);
  dls[0].click();
  assert.deepEqual(got, [['a41c09d2', 'work/deck.html']]);
});

test('chat run card, a workspace run with Folder members: no Apply to folder (each member applies on its own on the run page)', () => {
  const EX = { results: null, artifacts: [], moreArtifacts: false, pr: null };
  const CH = { state: 'pending', counts: { added: 2, modified: 0, deleted: 0 } };
  const { card, $ } = mk({ controls: { openApply: () => Promise.resolve(null) } });
  card.update(done(EX, { workMode: 'folder', changes: CH }));
  assert.ok($('.chat-rc-apply'), 'a single-project Folder run offers it');
  card.update(done(EX, { kind: 'workspace-run', workspaceId: 'wks-notes-0000abcd', workMode: 'folder', changes: CH }));
  assert.equal($('.chat-rc-apply'), null, 'a live workspace snapshot: its Apply would POST without a memberKey (400)');
  const rest = snapshotFromState(STATE({ status: 'done', target: 'workspace', workspaceId: 'wks-notes-0000abcd', workMode: 'folder', projects: [] }),
    { now: 0, extras: { ...EX, changes: CH } });
  assert.deepEqual([rest.kind, rest.workMode, rest.changes], ['workspace-run', 'folder', CH]);
  card.update(done(EX, { workMode: 'folder', changes: CH }));
  assert.ok($('.chat-rc-apply'));
  card.update({ ...rest, terminal: true });
  assert.equal($('.chat-rc-res-text'), null, 'the status line says Finished');
  assert.equal($('.chat-rc-apply'), null, 'a REST workspace snapshot');
});

test('halted feature: one status line (the group\'s), Shaper\'s Resume · Re-plan the rest beside the model\'s footer, Resume posts the feature resume', async () => {
  const seen = [];
  const failed = RUN_STATE_ROWS.find((r) => r.state === 'failed').run;
  const row = featureRow([DONE_RUN, failed, WAITING]);
  const { card, $, $$, el = card.el } = mk({ controls: { memoFor: () => ({}), groupOf: () => row,
    featureAct: async (id, action, body) => { seen.push([id, action, body]); return { ok: true }; } } });
  const view = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'error', { pipelineId: 'p2' }), SL(3, 'planned')],
    { id: 'feat_1', halted: { index: 2, state: 'error', waiting: [3] }, open: true, originPipelineId: 'abcd1234' });
  card.update(shaped({ pipelineId: 'abcd1234', feature: view, log: [] },
    { p2: { source: 'rest', terminal: true, status: 'failed', pipelineId: 'p2', stageProgress: { label: 'Review', text: 'Review' } } }));
  assert.equal($('.run-status').dataset.text, 'Run 2 of 3 · failed');
  assert.equal($$('.run-status-word').length, 1);
  assert.deepEqual([...el.querySelectorAll('.chat-rc-factions > button')].map((b) => b.textContent || b.getAttribute('aria-label')), ['Resume', 'Re-plan the rest', 'More actions']);
  assert.equal($$('.chat-rc-foot button').filter((b) => !b.hidden && /^Resume$/.test(b.textContent)).length, 1, 'no second Resume');
  $('[data-act="feature-resume"]').click();
  await settle();
  assert.deepEqual(seen, [['feat_1', 'resume', {}]]);
});

test('running feature: the model\'s Pause and Stop act on run 2; ⋯ lists the four items; Ask before each run posts approve-each', async () => {
  const seen = [];
  const working = RUN_STATE_ROWS.find((r) => r.state === 'working').run;
  const row = featureRow([DONE_RUN, working, WAITING]);
  const { card, $ } = mk({ ctx: { openPlan: (ref) => seen.push(['plan', ref.pipelineId]) }, controls: { memoFor: () => ({}), groupOf: () => row,
    act: (t, aid, b, m, r) => { seen.push([aid, r && r.groupId]); return Promise.resolve(true); },
    featureAct: async (id, action, body) => { seen.push([action, body]); return { ok: true }; } } });
  const view = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'running', { pipelineId: 'p2', runId: 'r2' }), SL(3, 'planned')],
    { id: 'feat_1', open: true, approveEach: false, originPipelineId: 'abcd1234' });
  card.update(shaped({ pipelineId: 'abcd1234', feature: view, log: [] },
    { p2: { source: 'live', status: 'running', runId: 'r2', pipelineId: 'p2', stageProgress: { ...PLAN_PROG, stage: 'build', label: 'Build', text: 'Build' } } }));
  assert.equal($('[data-act="feature-pause"]'), null, 'D10: Shaper adds no Pause of its own');
  assert.equal($('[data-act="feature-stop"]'), null);
  $('[data-model-action="pause"]').click();
  $('[data-model-action="stop"]').click();
  await settle();
  $('[data-act="feature-more"]').click();
  const items = [...card.el.ownerDocument.querySelectorAll('.wfv-menu-item')];
  assert.deepEqual(items.map((i) => i.textContent.trim()), ['Re-plan the rest', 'Cancel the rest', 'Ask before each run', 'Open the plan']);
  items[2].click();
  await settle();
  assert.deepEqual(seen, [['pause', 'feat-1'], ['stop', 'feat-1'], ['approve-each', { on: true }]]);
  // A REST snapshot carries no `shaping` (memory-only): Open the plan asks app.js for the run's plan (D7), not the
  // Artifacts tab, which the simple UI level hides.
  $('[data-act="feature-more"]').click();
  [...card.el.ownerDocument.querySelectorAll('.wfv-menu-item')][3].click();
  assert.deepEqual(seen.at(-1), ['plan', 'abcd1234']);
});

test('re-plan from the card: Re-planning runs 2–3 in the log, and the re-plan run\'s Split card opens in the same card', async () => {
  // stepStub's render hook gets (panel, pq, opts), not the ref: wrap paintQuestion to see the ref it paints from.
  const painted = [];
  const stub = stepStub({ id: 'q-split', kind: 'plan', plan: { outline: { why: 'w', slices: [] } } }, renderOutlineBody);
  const { card, $ } = mk({ controls: { ...stub, paintQuestion: (ref, host) => { painted.push(ref.pipelineId); return stub.paintQuestion(ref, host); } } });
  const view = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'canceled'), SL(3, 'canceled')],
    { id: 'feat_1', status: 'replanning', replan: { ticketId: 't9', pipelineId: 'rp1', runId: 'run-rp1' } });
  card.update(shaped({ pipelineId: 'abcd1234', feature: { ...view, log: [{ key: 'replan', run: null, text: 'Re-planning runs 2–3', detail: [] }] }, log: [] },
    { rp1: { source: 'live', status: 'running', runId: 'run-rp1', pipelineId: 'rp1',
      pendingQuestion: { id: 'q-split', kind: 'plan', plan: { outline: { why: 'w', slices: [] } } } } }));
  assert.equal($('.chat-rc-log-row:last-child .chat-rc-log-text').textContent, 'Re-planning runs 2–3');
  assert.ok(painted.includes('rp1'), 'the Split step paints from the re-plan run');
  assert.deepEqual([...card.el.querySelectorAll('.chat-rc-factions > button')].map((b) => b.textContent || b.getAttribute('aria-label')), ['More actions']);
});

test('a PR fix-run card: its kicker, what triggered it, the PR, and the outcome once the watcher is done', () => {
  const fix = { prUrl: 'https://github.com/o/r/pull/7', memberKey: null, trigger: ['checks'], triggerLabel: 'Failing checks', once: false };
  const { $, card } = mk({ ident: { fix } });
  assert.equal($('.kind-chip').hidden, true, 'a fix run is a single run: no chip (#959)');
  assert.deepEqual([...$('.chat-rc-fix').children].slice(0, 3).map((n) => n.textContent), ['PR fix run', '·', 'Failing checks']);
  assert.equal($('.chat-rc-fix').hidden, false);
  assert.equal($('.chat-rc-fix-why').textContent, 'Failing checks');
  const pr = $('.chat-rc-fix-pr');
  assert.deepEqual([pr.textContent, pr.href, pr.target, pr.rel], ['PR #7', 'https://github.com/o/r/pull/7', '_blank', 'noopener noreferrer']);
  assert.equal($('.chat-rc-fix-out'), null, 'no outcome while the watcher has the run');
  card.setFix({ ...fix, outcome: { kind: 'pushed', sha: 'abc1234', stopped: null, fixRuns: 1 } });
  assert.equal($('.chat-rc-fix-out').textContent, 'Pushed the fix (abc1234)');
  assert.ok($('.chat-rc-fix-out').classList.contains('is-ok'));
  // A plain track_run card: no fix line, the usual kind chip.
  const plain = mk();
  assert.equal(plain.$('.kind-chip').hidden, true);
  assert.equal(plain.$('.chat-rc-fix').hidden, true);
});

test('progressIdent carries a fix card\'s `fix`, and adds no key to any other card', () => {
  const fix = { prUrl: 'https://x/pull/1', triggerLabel: 'Merge conflicts' };
  assert.deepEqual(progressIdent({ id: 'card_3', state: 'tracked', card: { type: 'progress', pipelineId: null, runId: 'r', projectKey: 'p', title: 'T', label: 'L', fix } }),
    { cardId: 'card_3', pipelineId: null, runId: 'r', projectKey: 'p', workspaceId: null, title: 'T', label: 'L', fix });
});

test('slice 4: the card head, status block and footer come from the one model for every §2.1 state', async () => {
  await checkRows(RUN_STATE_ROWS.map(({ state, run, symbol }) => ({ name: state, run: () => {
    const { card, $, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => null } });
    card.update(live({ status: run.status || '', pendingQuestion: run.pendingQuestion || null, run }));
    const m = runModel(run, { now: NOW, timeZone: 'UTC' });
    assert.equal($('.chat-rc .run-status').dataset.state, state);
    assert.equal($('.chat-rc .kind-chip').hidden, true);
    const dot = $('.chat-rc .ask-rc-head > .status-dot');
    if (symbol) assert.equal(dot.getAttribute('aria-label'), m.word);
    assert.deepEqual($$('.chat-rc [data-model-action]').filter((b) => !b.hidden && !b.closest('[hidden]')).map((b) => b.dataset.modelAction), m.actions);
  } })));
});

test('slice 4: a feature card shows the kind chip, the group bar, the current run bar and member rows; no feature strip', () => {
  const done = { status: 'done', endReached: true };
  const asking = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
  const model = groupModel({ kind: 'feature', title: 'Run tags', planning: done, members: [done, asking, { ticket: { status: 'scheduled', after: { index: 2 } } }] }, { now: NOW });
  const row = { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'Run tags', model, count: model.count.text,
    planning: { title: 'Planning', href: '#running/r0', model: model.planning },
    members: model.members.map((m, i) => ({ position: i + 1, title: `Slice ${i + 1}`, href: '#runs', model: m })) };
  const { card, $, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => row } });
  card.update(live({ status: 'running', run: asking, shaping: { feature: { id: 'feat_1' } } }));
  assert.equal($('.chat-rc .kind-chip').textContent, 'Feature · 3 runs');
  assert.equal($('.chat-rc .kind-chip').hidden, false);
  assert.equal($('.chat-rc .ask-rc-title').textContent, 'Run tags');
  assert.equal($('.chat-rc .run-status-group').hidden, false);
  assert.equal($('.chat-rc .run-status-group .run-chain-label').textContent, '1 done');
  assert.equal($$('.chat-rc .run-status-bar .run-prog-sec').length, 4);
  assert.equal($$('.chat-rc .run-members .run-member').length, 4, 'Planning + 3');
  assert.equal($('.chat-rc .chat-rc-feature'), null);
  assert.equal($('.chat-rc .ask-rc-open').getAttribute('href'), '#feature/feat_1');
});

test('slice 4: a group card acts on its current member, and its Open follows the group href', () => {
  const asking = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
  const model = groupModel({ kind: 'chain', members: [{ status: 'done' }, asking] }, { now: NOW });
  // As groupRow builds it: the row's runId / pipelineId are the current member's (run 2 here).
  const row = { kind: 'chain', groupKind: 'chain', groupId: 'g_1', title: 'Two runs', model, runId: 'run-other', pipelineId: 'p-other',
    planning: null, members: model.members.map((m, i) => ({ position: i + 1, title: `Run ${i + 1}`, href: '#runs', model: m,
      runId: i === 1 ? 'run-other' : '', pipelineId: i === 1 ? 'p-other' : `p-${i}`, run: i === 1 ? asking : { status: 'done' } })) };
  const acts = [];
  const { card, $, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => row,
    act: (ref, id, btn, m, r) => acts.push([ref.runId, id, r === row]) } });
  card.update(live({ status: 'done', run: { status: 'done' } }));
  assert.deepEqual($$('.chat-rc .chat-rc-actions > button').filter((b) => !b.hidden).map((b) => b.dataset.modelAction), ['answer', 'stop']);
  assert.equal($('.chat-rc .chat-rc-pause').hidden, true, 'the card\'s own Pause is not used for a group');
  $('.chat-rc [data-model-action="stop"]').click();
  assert.deepEqual(acts, [['run-other', 'stop', true]], 'Stop targets the current member with the group row (groupAction), never the card\'s own run');
  assert.equal($('.chat-rc .chat-rc-create-pr')?.dataset.modelAction, undefined,
    'the card\'s own Create pull request never stands for the group\'s ship');
  const ev = new card.el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true });
  $('.chat-rc .ask-rc-open').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, 'Open follows #group/g_1');
});

test('slice 4: a card painted before its group was known: its own Stop stops the group, never only its run', () => {
  const asking = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
  const model = groupModel({ kind: 'chain', members: [{ status: 'running' }, asking] }, { now: NOW });
  const row = { kind: 'chain', groupKind: 'user', groupId: 'g_1', title: 'My group', model, planning: null, members: [] };
  let known = null;
  const acts = [], stops = [];
  const { card, $ } = mk({ controls: { memoFor: () => ({}), groupOf: () => known,
    act: (ref, id, btn, m, r) => acts.push([id, r]), stop: (ref) => stops.push(ref) } });
  card.update(live({ status: 'running' }));
  assert.equal($('.chat-rc .chat-rc-stop').hidden, false, 'painted as a single run');
  known = row;                                       // the groups load; no frame repainted this card yet
  $('.chat-rc .chat-rc-stop').click();
  assert.deepEqual(acts, [['stop', row]], 'the group\'s Stop (groupAction)');
  assert.deepEqual(stops, []);
});

test('slice 4: a stopped run never offers Resume (the server refuses it), never the Pause button', () => {
  const { card, $, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => null } });
  card.update(live({ status: 'stopped', run: { status: 'stopped', resumable: true } }));
  assert.equal($('.chat-rc .chat-rc-pause').hidden, true);
  assert.equal($$('.chat-rc [data-model-action="resume"]').filter((b) => !b.hidden).length, 0);
  assert.equal($$('.chat-rc [data-model-action="archive"]').filter((b) => !b.hidden).length, 1, 'the card keeps its Archive');
});

test('slice 4: the snapshot\'s status wins over a stale raw run; one Resume, no made Pause', () => {
  const { card, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => null } });
  // live(over) lays `status` over a snapshot whose `run` (from snapshotFromState) still reads running.
  card.update(live({ status: 'paused' }));
  const shown = $$('.chat-rc .chat-rc-actions > button').filter((b) => !b.hidden);
  assert.deepEqual(shown.map((b) => b.dataset.modelAction), ['resume', 'stop']);
  assert.ok(shown[0].classList.contains('chat-rc-pause'), 'the own Pause / Resume button, reading Resume, is the one shown');
  assert.ok(shown[0].classList.contains('btn-primary'), 'Resume is the primary, as on the run page');
});

test('slice 4: before the first snapshot the card reads Starting with no actions', () => {
  const { card, $, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => null } });
  card.update(null);
  assert.equal($('.chat-rc .run-status').dataset.state, 'starting');
  assert.deepEqual($$('.chat-rc [data-model-action]').filter((b) => !b.hidden), [], 'never an Archive that acts before the run is known');
});

test('slice 4: paused, then stopped: a stopped run never offers Resume (the server refuses it); Stop re-enables', () => {
  const { card, $, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => null } });
  card.update(live({ status: 'interrupted' }));
  assert.equal($('.chat-rc [data-model-action="stop"]:not([hidden])'), null, 'an interrupted run lists no Stop');
  card.update(live({ status: 'paused' }));
  assert.equal($('.chat-rc [data-model-action="stop"]').disabled, false, 'a paused run stops');
  card.update(live({ status: 'stopped', run: { status: 'stopped', resumable: true } }));
  assert.equal($('.chat-rc .chat-rc-pause').hidden, true, 'its paused-run action was cleared');
  assert.equal($$('.chat-rc [data-model-action="resume"]').filter((b) => !b.hidden).length, 0);
  assert.equal($$('.chat-rc [data-model-action="archive"]').filter((b) => !b.hidden).length, 1);
});

test('slice 4: a finished live run with an open PR on the snapshot reads In review, as the list does', () => {
  const { card, $ } = mk({ controls: { memoFor: () => ({}), groupOf: () => null } });
  card.update(live({ status: 'done', pr: { url: 'https://github.com/acme/app/pull/759', number: 759, state: 'OPEN' },
    run: { status: 'done', endReached: true } }));
  assert.equal($('.chat-rc .run-status').dataset.state, 'in-review');
});

// ── Shaper s5: rounds, Ask for changes, saved ideas, Watch PR fix rounds ─────────────────────────────────────────────
const SP = (label, over = {}) => ({ mode: 'stages', stage: label.toLowerCase(), label, text: label, tone: 'blue', fraction: 0.3, stages: [], passes: 0, ...over });   // run-progress.mjs's shape
const ROUND2 = (over = {}) => ({ ...live({}, {}), source: 'live', runId: 'run-r2', pipelineId: 'beef00r2', status: 'running', stageProgress: SP('Build'), ...over });

test('s5: a round 2 of the last run adds no member row and keeps "Round 1 · …" in the log; the one status line is the group\'s', () => {
  const row = featureRow([DONE_RUN, DONE_RUN, DONE_RUN]);
  const { card, $ } = mk({ controls: { memoFor: () => ({}), groupOf: () => row } });
  const $$ = (q) => [...card.el.querySelectorAll(q)];
  const last = SL(3, 'done', { pipelineId: 'beef0003', rounds: [{ round: 2, pipelineId: 'beef00r2', status: 'running', request: 'make it blue' }] });
  const v = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'done', { pipelineId: 'beef0002' }), last],
    { log: [{ key: 'round-3-1', run: 3, text: 'Round 1 · Part 3', detail: [] }, { key: 'round-3-2', run: 3, text: 'Round 2 · make it blue', detail: [] }] });
  card.update(shaped({ pipelineId: 'abcd1234', feature: v, log: [] }, { beef00r2: ROUND2() }, { status: 'done', terminal: true }, { status: 'done', active: [] }));
  assert.equal($$('.run-status-word').length, 1);
  assert.equal($$('.run-member').length, 4, 'Planning + 3 runs, no row for the round');
  assert.deepEqual($$('.chat-rc-log-text').map((e) => e.textContent), ['Round 1 · Part 3', 'Round 2 · make it blue']);
});

test('s5: a plain run with a live round 2 says so in its status line and log', () => {
  const { card, $ } = mk({ controls: { memoFor: () => ({}) } });
  const $$ = (q) => [...card.el.querySelectorAll(q)];               // the card never reads a run store: the controller fills roundSnaps
  card.update(done(null, { title: 'Add a chart', rounds: [{ round: 2, pipelineId: 'beef00r2', status: 'running', request: 'make it blue' }],
    roundSnaps: { beef00r2: ROUND2() } }));
  assert.equal($('.run-status').dataset.text, 'Running · Round 2 · working');   // runModel's roundLine: the fixture's run has no staged progress
  assert.deepEqual($$('.chat-rc-log-text').map((e) => e.textContent), ['Round 1 · Add a chart', 'Round 2 · make it blue']);
  assert.equal($$('.run-member').length, 0);
});

test('s5: a plain run\'s round that needs you: the model words the round and its dot asks; the run\'s own once it ends', () => {
  const { card, $ } = mk({ controls: { memoFor: () => ({}) } });
  const rounds = [{ round: 2, pipelineId: 'beef00r2', status: 'running', request: 'make it blue' }];
  const asking = ROUND2({ pendingQuestion: { id: 'plan-1', kind: 'plan' }, stageProgress: SP('Plan', { text: 'Plan · 1/3' }) });
  card.update(done(null, { title: 'Add a chart', rounds, roundSnaps: { beef00r2: asking } }));
  assert.match($('.run-status').dataset.text, /^Round 2 · Needs you/);
  assert.equal($('.chat-rc .run-status').dataset.state, 'needs-you');
  card.update(done(null, { title: 'Add a chart', rounds: [{ ...rounds[0], status: 'done' }], roundSnaps: {} }));
  assert.doesNotMatch($('.run-status').dataset.text, /Round 2/);
  assert.notEqual($('.chat-rc .run-status').dataset.state, 'needs-you');
});

test('s5: Ask for changes — a finished run posts its pipeline ref; a finished feature posts its feature ref; typed text survives a repaint', async () => {
  const posts = [];
  const { card, $ } = mk({ ctx: { postChanges: async (ref, text) => posts.push([ref, text]) } });
  card.update(done(null, { pipelineId: 'abcd1234' }));
  const input = $('.chat-rc-changes .ask-changes-input');
  input.value = 'make it blue'; input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));
  card.update(done(null, { pipelineId: 'abcd1234', elapsedMs: 5000 }));
  assert.equal($('.chat-rc-changes .ask-changes-input'), input, 'the same field');
  assert.equal(input.value, 'make it blue');
  $('.chat-rc-changes .ask-changes-send').click(); await settle();
  assert.deepEqual(posts, [[{ pipelineId: 'abcd1234' }, 'make it blue']]);
  // A feature reads the GROUP model's state (ready / in review / merged), from controls.groupOf.
  const row = featureRow([DONE_RUN, DONE_RUN, DONE_RUN]);
  const f = mk({ ctx: { postChanges: async (ref, text) => posts.push([ref, text]) }, controls: { memoFor: () => ({}), groupOf: () => row } });
  const v = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'done', { pipelineId: 'beef0002' }), SL(3, 'done', { pipelineId: 'beef0003' })], { status: 'done' });
  f.card.update(shaped({ pipelineId: 'abcd1234', feature: v, log: [] }, {}, { status: 'done', terminal: true }, { status: 'done', active: [] }));
  assert.equal(f.$('.chat-rc .run-status').dataset.state, 'ready');
  const fi = f.$('.chat-rc-changes .ask-changes-input');
  fi.value = 'one more'; fi.dispatchEvent(new fi.ownerDocument.defaultView.Event('input'));
  f.$('.chat-rc-changes .ask-changes-send').click(); await settle();
  assert.deepEqual(posts[1], [{ featureId: 'feat-1' }, 'one more']);
});

test('s5: ideas saved show under the log', () => {
  const all = [SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'done', { pipelineId: 'beef0002' }), SL(3, 'done', { pipelineId: 'beef0003' })];
  for (const [ideas, want] of [[1, '1 idea saved for the next checkpoint'], [2, '2 ideas saved for the next checkpoint']]) {
    const { card, $ } = mk({});
    card.update(shaped({ pipelineId: 'abcd1234', feature: VIEW3(all, { notes: { ideas } }), log: [] }, {}, { status: 'done', terminal: true }, { status: 'done', active: [] }));
    assert.equal($('.chat-rc-notes').hidden, false);
    assert.equal($('.chat-rc-notes').textContent, want);
  }
  const { card, $ } = mk({});
  card.update(shaped({ pipelineId: 'abcd1234', feature: VIEW3(all, { notes: { ideas: 0 } }), log: [] }, {}, { status: 'done', terminal: true }, { status: 'done', active: [] }));
  assert.equal($('.chat-rc-notes').hidden, true);
});

test('s5: no Ask for changes field on a running card, a halted feature or a workspace run', () => {
  const ctx = { postChanges: async () => {} };
  const shownField = ($) => { const slot = $('.chat-rc-changes'); return !!(slot && !slot.hidden && slot.querySelector('.ask-changes')); };
  const running = mk({ ctx });
  running.card.update(live({}));
  assert.equal(shownField(running.$), false, 'running');
  const ws = mk({ ctx });
  ws.card.update(done(null, { kind: 'workspace-run', workspaceId: 'ws_1' }));
  assert.equal(shownField(ws.$), false, 'workspace run');
  const halted = mk({ ctx });
  const v = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'stopped', { pipelineId: 'beef0002' }), SL(3, 'planned')],
    { halted: { index: 2, state: 'stopped', waiting: [] } });
  halted.card.update(shaped({ pipelineId: 'abcd1234', feature: v, log: [] }, {}, { status: 'done', terminal: true }, { status: 'done', active: [] }));
  assert.equal(shownField(halted.$), false, 'halted feature');
  const ok = mk({ ctx });
  ok.card.update(done(null, {}));
  assert.equal(shownField(ok.$), true, 'a finished plain run has it');
});

test('s5 controller: a round\'s live snapshot reaches the card as roundSnaps; refreshPipeline re-reads the finished card', async () => {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const round = ROUND2();
  const runStore = { subscribe: () => () => {}, byPipeline: (pid) => (pid === 'beef00r2' ? round : null), get: () => null };
  const calls = [];
  const fetch = async (url) => { calls.push(url); return { ok: true, json: async () => ({ state: STATE({ status: 'done', active: [] }), live: null,
    extras: { rounds: [{ round: 2, pipelineId: 'beef00r2', status: 'running', request: 'make it blue' }] } }) }; };
  const ctl = createRunCardController({ runStore, tickMs: 0, controls: { memoFor: () => ({}) } });
  const built = ctl.build({ id: 'card_00000001', card: { type: PROGRESS_CARD_TYPE, pipelineId: 'abcd1234', runId: 'run-uuid-1', title: 'Fix login' } },
    { doc: dom.window.document, win: dom.window, fetch });
  dom.window.document.body.appendChild(built.el);
  await settle(); await settle();
  assert.equal(built.el.querySelector('.run-status').dataset.text, 'Running · Round 2 · working');
  const n = calls.length;
  ctl.refreshPipeline('abcd1234');
  await settle(); await settle();
  assert.equal(calls.length, n + 1);
  assert.equal(calls.at(-1), '/api/ask/runs/abcd1234');
  built.dispose(); ctl.destroy();
});

test('s5 controller: a feature round\'s live snapshot reaches the feature card; the one status line stays the model\'s', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const round = ROUND2({ pendingQuestion: PQ_PLAN, stageProgress: SP('Plan') });
  const own = live({ shaping: { feature: { id: 'feat-1' } } }, { status: 'done' });
  const runStore = { subscribe: () => () => {}, byPipeline: (pid) => (pid === 'abcd1234' ? own : pid === 'beef00r2' ? round : null), get: () => null };
  const last = SL(3, 'done', { pipelineId: 'beef0003', rounds: [{ round: 2, pipelineId: 'beef00r2', status: 'running', request: 'make it blue' }] });
  const log = [{ key: 'round-3-2', run: 3, text: 'Round 2 · make it blue', detail: [] }];
  const cardJson = { pipelineId: 'abcd1234', log, feature: VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'done', { pipelineId: 'beef0002' }), last], { log }) };
  const ctl = createRunCardController({ runStore, tickMs: 0 });
  const built = ctl.build({ id: 'card_00000001', card: { type: PROGRESS_CARD_TYPE, pipelineId: 'abcd1234', runId: 'run-uuid-1', title: 'Fix login' } },
    { doc: dom.window.document, win: dom.window, shaperCard: () => cardJson });
  dom.window.document.body.appendChild(built.el);
  assert.equal(built.el.querySelector('.chat-rc-log-text').textContent, 'Round 2 · make it blue');
  assert.equal(built.el.querySelectorAll('.run-status-word').length, 1);
  assert.equal(built.el.querySelectorAll('.chat-rc-fstatus').length, 0);
  built.dispose(); ctl.destroy();
});

test('s5: a plain run\'s live round hides the Ask for changes field; it comes back once the round is done', () => {
  const { card, $ } = mk({ ctx: { postChanges: async () => {} }, controls: { memoFor: () => ({}) } });
  const shownField = () => { const slot = $('.chat-rc-changes'); return !!(slot && !slot.hidden && slot.querySelector('.ask-changes')); };
  card.update(done(null, { title: 'Add a chart', rounds: [{ round: 2, pipelineId: 'beef00r2', status: 'running', request: 'make it blue' }],
    roundSnaps: { beef00r2: ROUND2() } }));
  assert.equal($('.run-status').dataset.text, 'Running · Round 2 · working');   // runModel's roundLine: the fixture's run has no staged progress
  assert.equal(shownField(), false, 'no field while round 2 runs');
  card.update(done(null, { title: 'Add a chart', rounds: [{ round: 2, pipelineId: 'beef00r2', status: 'done', request: 'make it blue' }] }));
  assert.equal(shownField(), true, 'the field is back once the round is done');
});

test('s5: a Watch PR fix round reports into the run card: status words, outcome on the log line, no member row', () => {
  const fix = { ...live({}, {}), source: 'live', runId: 'run-f2', pipelineId: 'beef00f2', status: 'running', stageProgress: SP('Implement') };
  const { card, $ } = mk({});
  const $$ = (q) => [...card.el.querySelectorAll(q)];
  card.update(done(null, { title: 'Add a chart', roundSnaps: { beef00f2: fix },
    rounds: [{ round: 2, pipelineId: 'beef00f2', status: 'running', request: 'fix failing checks', by: 'watch', kinds: ['checks'] }] }));
  assert.equal($('.run-status').dataset.text, 'Running · Round 2 · fix failing checks');
  assert.equal($$('.run-member').length, 0);
  card.update(done(null, { title: 'Add a chart',
    rounds: [{ round: 2, pipelineId: 'beef00f2', status: 'done', request: 'fix failing checks', by: 'watch', kinds: ['checks'], outcome: { kind: 'pushed', sha: 'a1b2c3d' } }] }));
  assert.deepEqual($$('.chat-rc-log-text').map((e) => e.textContent), ['Round 1 · Add a chart', 'Round 2 · fix failing checks · pushed a1b2c3d']);
});

test('s5: a watch that gave up is said once, by the model\'s status line; its Ask for changes focuses the field', () => {
  const { card, $, $$ } = mk({ ctx: { postChanges: async () => {} } });
  card.update(done(null, { title: 'Add a chart', pipelineId: 'abcd1234',
    watch: { prUrl: 'https://github.com/o/r/pull/781', status: 'needs-person', reason: 'cap', fixRuns: 3 },
    rounds: [{ round: 4, pipelineId: 'beef00f4', status: 'done', request: 'fix failing checks', by: 'watch', kinds: ['checks'], outcome: { kind: 'failed', reason: 'fix-failed' } }] }));
  assert.equal($('.run-status').dataset.text, 'Needs you · Watch stopped · 3 fix runs, checks still failing');
  assert.equal($$('.chat-rc-watch-text').length, 0, 'D9: no second Watch-stopped line');
  const ask = $('[data-model-action="ask-changes"]');
  assert.equal(ask.disabled, false);
  ask.click();
  assert.equal($('.chat-rc-changes .ask-changes-input').ownerDocument.activeElement, $('.chat-rc-changes .ask-changes-input'));
});

// ── The bundle merge: one source for the run card (runs redesign + Shaper) ───────────────────────────────────────────
test('merge: a feature card after the split shows one status line, one member list and Shaper\'s log', () => {
  const doneRun = { status: 'done', endReached: true };
  const asking = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
  const model = groupModel({ kind: 'feature', title: 'Run tags', planning: doneRun, members: [doneRun, asking, { ticket: { status: 'scheduled', after: { index: 2 } } }] }, { now: NOW });
  const row = { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'Run tags', model, count: model.count.text,
    planning: { title: 'Planning', href: '#running/r0', model: model.planning },
    members: model.members.map((m, i) => ({ position: i + 1, title: `Slice ${i + 1}`, href: '#runs', model: m })) };
  const { card, $, $$ } = mk({ controls: { memoFor: () => ({}), groupOf: () => row } });
  const log = [{ key: 'p-0', run: null, text: 'Split into 3 runs', detail: [] }];
  card.update(shaped({ pipelineId: 'abcd1234', feature: VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'approval'), SL(3, 'planned')], { log }), log },
    {}, { status: 'running', run: asking, shaping: { feature: { id: 'feat_1' } } }));
  assert.equal($$('.chat-rc .run-status-word').length, 1);
  assert.equal($$('.chat-rc ol.run-members').length, 1);
  assert.equal($$('.chat-rc .chat-rc-fstatus, .chat-rc .chat-rc-chain, .chat-rc ol.chat-rc-members, .chat-rc .ask-rc-pill').length, 0);
  assert.equal($('.chat-rc .kind-chip').textContent, 'Feature · 3 runs');
  assert.equal($('.chat-rc .kind-chip').hidden, false);
  assert.equal($('.chat-rc .chat-rc-log-text').textContent, 'Split into 3 runs');
});

test('merge: a stopped watch is said once by the model, and its Ask for changes focuses the field', () => {
  const { card, $, $$, doc } = mk({ ctx: { postChanges: async () => {} } });
  card.update(done({ pr: { url: 'https://github.com/o/r/pull/781', state: 'OPEN' } }, { title: 'Add a chart', pipelineId: 'abcd1234',
    watch: { prUrl: 'https://github.com/o/r/pull/781', status: 'needs-person', reason: 'cap', fixRuns: 3 } }));
  assert.equal($('.run-status').dataset.text, 'Needs you · Watch stopped · 3 fix runs, checks still failing');
  assert.equal($$('.chat-rc-watch-text').length, 0, 'D9: no second Watch-stopped line');
  const ask = $('[data-model-action="ask-changes"]');
  assert.equal(ask.disabled, false);
  ask.click();
  assert.equal(doc.activeElement, $('.chat-rc-changes .ask-changes-input'));
});

test('merge: a Watch PR fix-run card keeps its kind word (its fix line, #959)', () => {
  const { card, $ } = mk({ ident: { fix: { prUrl: 'https://x/pull/7', triggerLabel: 'Failing checks' } } });
  card.update(live({ status: 'running' }));
  assert.equal($('.kind-chip').hidden, true, 'a fix run is a single run: no chip (#959)');
  assert.deepEqual([...$('.chat-rc-fix').children].slice(0, 3).map((n) => n.textContent), ['PR fix run', '·', 'Failing checks']);
});

test('merge: a live Watch PR round feeds runModel, so the one status line names the round', () => {
  const fix = { ...live({}, {}), source: 'live', runId: 'run-f2', pipelineId: 'beef00f2', status: 'running' };
  const acts = [];
  const { card, $, $$ } = mk({ controls: { act: (t, aid) => { acts.push([t && t.pipelineId, aid]); return Promise.resolve(true); } } });
  card.update(done(null, { title: 'Add a chart', roundSnaps: { beef00f2: fix },
    rounds: [{ round: 2, pipelineId: 'beef00f2', status: 'running', request: 'fix failing checks', by: 'watch', kinds: ['checks'] }] }));
  assert.equal($('.run-status').dataset.text, 'Running · Round 2 · fix failing checks');
  assert.equal($$('.run-status-word').length, 1);
  assert.equal($$('.chat-rc-fstatus').length, 0);
  $('[data-model-action="stop"]').click();                  // D25: the round's run, not the finished round 1
  assert.deepEqual(acts, [['beef00f2', 'stop']]);
});

test('run labels (slice 1): read-only chips after the status line; none for an empty list or with the flag off', () => {
  const f = mk();
  applyFlags({ runLabels: true }, f.doc);
  f.card.update(live({ labels: ['hotfix'] }));
  assert.equal(f.$$('.chat-rc-labels .label-chip').length, 1);
  assert.equal(f.$('.chat-rc-labels .label-x'), null, 'no remove control on the card');
  assert.equal(f.$('.chat-rc-status').nextElementSibling, f.$('.chat-rc-labels'));
  f.card.update(live({ labels: [] }));
  assert.equal(f.$$('.chat-rc-labels .label-chip').length, 0);
  const off = mk();
  off.card.update(live({ labels: ['hotfix'] }));
  assert.equal(off.$$('.label-chip').length, 0);
});
