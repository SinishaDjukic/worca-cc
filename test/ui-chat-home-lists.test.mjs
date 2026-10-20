// test/ui-chat-home-lists.test.mjs — worca Chat P6: the home's tab strip (roles, roving focus, the Needs-you count,
// the sliding underline), the default-tab rule, the Recent chats rows and the Workflows grid (Library thumbnails).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  HOME_TABS, HOME_TAB_EMPTY, RECENT_CHATS_MAX, WORKFLOWS_MAX, defaultTab, createHomeTabs, buildChatsList, chatMeta, chatDot,
  buildWorkflowsGrid, workflowMeta, runWorkflowText, emptyState,
} from '../ui/public/chat/home-lists.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const trackDom = useDomRelease(afterEach);
const docOf = () => trackDom(new JSDOM('<!doctype html><body></body>')).window.document;

const WF_DEFAULT = { id: 'wf_default', name: 'Default', version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w2', from: { node: 'n_impl', port: 'diff' }, to: { node: 'n_end', port: 'result' } }] };
const WF_MINE = { id: 'wf_mine', name: 'Plan and build', version: 2, updatedAt: 't1',
  nodes: [{ id: 'a', kind: 'agent', key: 'planner', x: 0, y: 0, config: {} }, { id: 'b', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'a', port: 'plan' }, to: { node: 'b', port: 'plan' } }] };
const WF_LEGACY = { id: 'wf_old', name: 'Old one', version: 1, steps: [] };

test('defaultTab: Needs you, else Running, else Recent chats, else Workflows — undecided until the chats are known', () => {
  assert.equal(defaultTab({ needs: 1, running: 3, chats: null }), 'needs');
  assert.equal(defaultTab({ needs: 0, running: 2, chats: null }), 'running');
  assert.equal(defaultTab({ needs: 0, running: 0, chats: null }), null, 'wait for the chat list');
  assert.equal(defaultTab({ needs: 0, running: 0, chats: 2 }), 'chats');
  assert.equal(defaultTab({ needs: 0, running: 0, chats: 0 }), 'workflows');
  assert.equal(defaultTab(), null);
  assert.deepEqual([...HOME_TABS], ['needs', 'running', 'chats', 'plans', 'workflows']);
  assert.equal(defaultTab({ needs: 0, running: 0, chats: 0 }), 'workflows', 'never plans');
});

test('the tab strip: a tablist with five tabs (Plans hidden), one panel, roving focus and arrow keys', () => {
  const doc = docOf();
  const picks = [];
  const tabs = createHomeTabs({ doc, onSelect: (t, o) => { picks.push([t, o]); tabs.select(t); } });
  doc.body.appendChild(tabs.el);
  const list = tabs.el.querySelector('[role="tablist"]');
  assert.equal(list.getAttribute('aria-label'), 'Runs and chats');
  const btn = (t) => tabs.el.querySelector(`.chat-home-tab[data-tab="${t}"]`);
  assert.deepEqual([...list.querySelectorAll('[role="tab"]')].map((b) => b.textContent), ['Needs you', 'Running', 'Recent chats', 'Plans', 'Workflows']);
  assert.equal(btn('plans').hidden, true, 'Plans starts hidden');
  assert.equal(tabs.panel.getAttribute('role'), 'tabpanel');
  assert.equal(btn('needs').getAttribute('aria-controls'), tabs.panel.id);
  assert.equal(tabs.selected(), null);
  assert.equal(btn('needs').tabIndex, 0, 'nothing selected yet: the strip is still reachable');
  tabs.select('running');
  assert.equal(btn('running').getAttribute('aria-selected'), 'true');
  assert.equal(btn('running').tabIndex, 0);
  assert.equal(btn('needs').tabIndex, -1);
  assert.equal(tabs.panel.getAttribute('aria-labelledby'), btn('running').id);
  btn('running').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.deepEqual(picks.at(-1), ['chats', { user: true }]);
  assert.equal(doc.activeElement, btn('chats'));
  btn('chats').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(tabs.selected(), 'workflows', 'End skips the hidden Plans');
  btn('workflows').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(tabs.selected(), 'needs', 'wraps');
  btn('needs').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(tabs.selected(), 'workflows', 'wraps back');
  tabs.setVisible('plans', true);
  assert.equal(btn('plans').hidden, false);
  assert.deepEqual(tabs.visibleTabs(), ['needs', 'running', 'chats', 'plans', 'workflows']);
  btn('chats').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(tabs.selected(), 'plans', 'a shown Plans sits between Recent chats and Workflows');
  btn('plans').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(tabs.selected(), 'workflows');
  btn('workflows').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(tabs.selected(), 'plans');
  btn('plans').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(tabs.selected(), 'workflows');
  tabs.setVisible('plans', false);
  assert.equal(btn('plans').hidden, true);
  assert.deepEqual(tabs.visibleTabs(), ['needs', 'running', 'chats', 'workflows']);
  tabs.select('workflows');
  btn('workflows').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(tabs.selected(), 'needs', 'wraps');
  btn('needs').click();
  assert.deepEqual(picks.at(-1), ['needs', { user: true }]);
  tabs.destroy();
});

test('the Needs-you count: amber number while > 0, hidden at 0; the selected tab carries aria-selected (the one .tab underline)', () => {
  const doc = docOf();
  const tabs = createHomeTabs({ doc, onSelect: () => {} });
  doc.body.appendChild(tabs.el);
  const n = tabs.el.querySelector('.chat-home-tab[data-tab="needs"] .chat-home-tab-n');
  assert.equal(n.hidden, true);
  tabs.setNeeds(2);
  assert.equal(n.hidden, false);
  assert.equal(n.textContent, '2');
  tabs.setNeeds(0);
  assert.equal(n.hidden, true);
  assert.equal(tabs.el.querySelector('.chat-home-ink'), null, 'review B4: no sliding underline element');
  assert.ok(tabs.el.querySelector('.chat-home-tablist').classList.contains('tabs'));
  tabs.select('chats');
  const sel = tabs.el.querySelector('.chat-home-tab[aria-selected="true"]');
  assert.equal(sel.dataset.tab, 'chats');
  assert.ok(sel.classList.contains('tab'));
});

test('Recent chats: dot by state, title, "ago · topic · $cost", chevron; a click opens the chat', () => {
  const doc = docOf();
  const now = Date.parse('2026-10-11T12:00:00Z');
  const threads = [
    { id: 'ask_00000001', title: 'Offline sync banner', updatedAt: '2026-10-11T10:00:00Z', inFlight: false, waiting: true,
      contexts: [{ kind: 'project', id: 'worca-cc', label: 'worca-cc' }], totals: { costUsd: 0.42 } },
    { id: 'ask_00000002', title: null, updatedAt: '2026-10-11T11:59:50Z', inFlight: true, totals: { costUsd: 0 } },
    { id: 'ask_00000003', title: 'Header', updatedAt: '2026-10-09T12:00:00Z', tracking: true },
  ];
  const opened = [];
  const ul = buildChatsList(doc, threads, { onOpen: (id) => opened.push(id), now });
  doc.body.appendChild(ul);
  const rows = [...ul.querySelectorAll('button.chat-home-chat')];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('.chat-home-chat-t').textContent, 'Offline sync banner');
  assert.equal(rows[0].querySelector('.chat-home-chat-m').textContent, '2h ago · worca-cc · $0.42');
  assert.ok(rows[0].querySelector('.chat-home-dot').classList.contains('is-wait'));
  assert.equal(rows[0].querySelector('.sr-only').textContent, 'Needs you', 'P1 History-row words');
  assert.equal(rows[1].querySelector('.chat-home-chat-t').textContent, 'New chat');
  assert.equal(rows[1].querySelector('.chat-home-chat-m').textContent, 'just now', 'a zero cost is left out');
  assert.ok(rows[1].querySelector('.chat-home-dot').classList.contains('is-think'));
  assert.ok(rows[2].querySelector('.chat-home-dot').classList.contains('is-live'));
  assert.ok(rows[2].querySelector('.chat-home-chev svg'));
  rows[1].click();
  assert.deepEqual(opened, ['ask_00000002']);
  assert.equal(chatDot({}), '');
  assert.equal(chatDot({ inFlight: true, waiting: true }), 'think', 'a reply in flight outranks a waiting run');
  assert.equal(chatMeta({ createdAt: 'nope' }, now), '');
  assert.equal(RECENT_CHATS_MAX, 6);
});

test('Workflows: Library thumbnails for v2 rows, "N agents · N loops · built-in", a click hands the workflow back', () => {
  const doc = docOf();
  const portsFn = portsFnFor({}, {});
  const run = [];
  const grid = buildWorkflowsGrid(doc, [WF_DEFAULT, WF_MINE, WF_LEGACY], portsFn, { onRun: (w) => run.push(w.id) });
  doc.body.appendChild(grid);
  const cards = [...grid.querySelectorAll('button.chat-home-wf')];
  assert.deepEqual(cards.map((c) => c.dataset.workflowId), ['wf_default', 'wf_mine', 'wf_old']);
  assert.ok(cards[0].querySelector('.chat-home-wf-tb svg'), 'thumbnailFor drew the v2 graph');
  assert.equal(cards[2].querySelector('.chat-home-wf-tb svg'), null, 'a legacy row has no graph to draw');
  assert.equal(cards[0].querySelector('.chat-home-wf-n').textContent, 'Default');
  assert.equal(cards[0].querySelector('.chat-home-wf-m').textContent, '1 agent · built-in');
  assert.equal(cards[1].querySelector('.chat-home-wf-m').textContent, '2 agents');
  assert.equal(workflowMeta(WF_LEGACY, portsFn), '');
  assert.equal(workflowMeta({ id: 'wf_memory_defrag', nodes: [] }, null), '0 agents · built-in');
  cards[1].click();
  assert.deepEqual(run, ['wf_mine']);
  assert.equal(WORKFLOWS_MAX, 12);
});

test('runWorkflowText and the empty state', () => {
  assert.equal(runWorkflowText('Default', 'worca-cc'), 'Run Default on worca-cc: ');
  assert.equal(runWorkflowText('Default', ''), 'Run Default: ');
  const doc = docOf();
  const p = emptyState(doc, HOME_TAB_EMPTY.needs);
  assert.equal(p.tagName, 'P');
  assert.equal(p.className, 'chat-home-empty');
  assert.equal(p.textContent, 'Nothing needs you');
  assert.deepEqual({ ...HOME_TAB_EMPTY }, { needs: 'Nothing needs you', running: 'Nothing running', chats: 'No saved chats.', plans: 'No plans yet', workflows: 'No workflows' });
});

test('a visit that has not chosen a tab yet keeps the strip reachable, even after an earlier selection', () => {
  const doc = docOf();
  const tabs = createHomeTabs({ doc, onSelect: () => {} });
  doc.body.appendChild(tabs.el);
  tabs.select('chats');
  tabs.select(null);                                                // visit(): no stored pick, the default not known yet
  assert.deepEqual([...tabs.el.querySelectorAll('.chat-home-tab')].map((b) => b.tabIndex), [0, -1, -1, -1, -1]);
  tabs.destroy();
});

test('a strip wider than its box keeps the selected tab in view', () => {
  const doc = docOf();
  const tabs = createHomeTabs({ doc, onSelect: () => {} });
  doc.body.appendChild(tabs.el);
  const list = tabs.el.querySelector('.chat-home-tablist');
  let left = 0;
  Object.defineProperty(list, 'scrollWidth', { value: 400, configurable: true });
  Object.defineProperty(list, 'clientWidth', { value: 300, configurable: true });
  Object.defineProperty(list, 'scrollLeft', { get: () => left, set: (v) => { left = v; }, configurable: true });
  const wf = tabs.el.querySelector('.chat-home-tab[data-tab="workflows"]');
  Object.defineProperty(wf, 'offsetLeft', { value: 320, configurable: true });
  Object.defineProperty(wf, 'offsetWidth', { value: 80, configurable: true });
  tabs.select('workflows');
  assert.equal(left, 100, 'scrolled so the tab\'s right edge is in the box');
  tabs.select('needs');
  assert.equal(left, 0, 'and back to the first tab');
  tabs.destroy();
});

test('the 1 s re-read never scrolls a strip the user swiped: only a new selection brings its tab into view', () => {
  const doc = docOf();
  const tabs = createHomeTabs({ doc, onSelect: () => {} });
  doc.body.appendChild(tabs.el);
  const list = tabs.el.querySelector('.chat-home-tablist');
  let left = 0;
  Object.defineProperty(list, 'scrollWidth', { value: 400, configurable: true });
  Object.defineProperty(list, 'clientWidth', { value: 300, configurable: true });
  Object.defineProperty(list, 'scrollLeft', { get: () => left, set: (v) => { left = v; }, configurable: true });
  const wf = tabs.el.querySelector('.chat-home-tab[data-tab="workflows"]');
  Object.defineProperty(wf, 'offsetLeft', { value: 320, configurable: true });
  Object.defineProperty(wf, 'offsetWidth', { value: 80, configurable: true });
  tabs.select('workflows');
  assert.equal(left, 100);
  left = 0;                                                         // the user swipes the strip back to its start
  tabs.setNeeds(2);                                                 // every 1 s re-read
  assert.equal(left, 0, 'the strip stays where the user left it');
  tabs.select('workflows');
  assert.equal(left, 100, 'a selection brings its tab into view');
  tabs.destroy();
});

test('a workflow with review loops says how many; a chat\'s topic shows its label', () => {
  const portsFn = portsFnFor({
    implementer: { key: 'implementer', inputs: [{ id: 'review', type: 'md', loop: true }], outputs: [{ id: 'diff', type: 'md', when: 'always' }] },
    reviewer: { key: 'reviewer', inputs: [{ id: 'diff', type: 'md' }], outputs: [{ id: 'review', type: 'md', when: 'blocking' }] },
  }, {});
  const n = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, config: {} });
  const loop = { id: 'wf_loop', name: 'Build and review', version: 2, nodes: [n('b', 'implementer'), n('c', 'reviewer')],
    wires: [{ id: 'w1', from: { node: 'b', port: 'diff' }, to: { node: 'c', port: 'diff' } },
      { id: 'w2', from: { node: 'c', port: 'review' }, to: { node: 'b', port: 'review' } }] };
  assert.equal(workflowMeta(loop, portsFn), '2 agents · 1 loop');
  const two = { ...loop, nodes: [...loop.nodes, n('d', 'reviewer')], wires: [...loop.wires,
    { id: 'w3', from: { node: 'b', port: 'diff' }, to: { node: 'd', port: 'diff' } },
    { id: 'w4', from: { node: 'd', port: 'review' }, to: { node: 'b', port: 'review' } }] };
  assert.equal(workflowMeta(two, portsFn), '3 agents · 2 loops');
  assert.equal(workflowMeta(loop, null), '2 agents', 'no port facts: no loop count');
  assert.equal(chatMeta({ contexts: [{ kind: 'project', id: 'k1', label: 'Proj A' }] }), 'Proj A');
});

test('the tab strip: Home goes to the first tab (no page scroll), ArrowLeft wraps from it to the last', () => {
  const doc = docOf();
  const tabs = createHomeTabs({ doc, onSelect: (t) => tabs.select(t) });
  doc.body.appendChild(tabs.el);
  const btn = (t) => tabs.el.querySelector(`.chat-home-tab[data-tab="${t}"]`);
  tabs.select('chats');
  const home = new doc.defaultView.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true });
  btn('chats').dispatchEvent(home);
  assert.equal(tabs.selected(), 'needs');
  assert.equal(home.defaultPrevented, true);
  btn('needs').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(tabs.selected(), 'workflows', 'wraps');
  assert.equal(doc.activeElement, btn('workflows'));
  tabs.destroy();
});
