// test/ui-agents-dropdown.test.mjs — the "Sub-agents" dropdown is renamed to
// "Agents" and now lists EVERY main agent that ran (incl. graphify/skill-only and
// zero-sub agents), each with its header pills and a muted "No sub-agents spawned"
// placeholder when it spawned none. Boots app.js under JSDOM and drives the
// test-only internals on window.__np. boot() copied from ui-subagent-views.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => String(url).includes('/api/projects')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
    : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, selectProject, recv };
}

// Manifest used by the unit + integration tests. clarify/plan/review are kind:'agents';
// preflight/done are bookends that MUST be excluded from the dropdown.
const STEPPER = { version: 1, steps: [
  { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
  { kind: 'agents', nodes: [{ id: 'clarify', uiPhase: 'clarify', label: 'Clarify' }] },
  { kind: 'agents', nodes: [{ id: 'plan', uiPhase: 'plan', label: 'Plan' }] },
  { kind: 'agents', nodes: [{ id: 'review', uiPhase: 'review', label: 'Review', cycles: true }] },
  { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
], feedbacks: [] };

test('dropdown header reads "Agents" (not "Sub-agents") in both run + history templates', async () => {
  const { window } = await boot();
  for (const tplId of ['#run-card-tpl', '#hist-card-tpl']) {
    const tpl = window.document.querySelector(tplId);
    const clone = tpl.content.firstElementChild.cloneNode(true);
    const bar = clone.querySelector('.subs-bar');
    const btnText = bar.querySelector('.btn-subs').textContent.replace(/\s+/g, ' ').trim();
    assert.match(btnText, /^Agents\b/, `${tplId}: header renamed to "Agents"`);
    assert.doesNotMatch(btnText, /Sub-agents/, `${tplId}: old "Sub-agents" text removed`);
  }
});

test('subsGroupsForRender lists every agent step (∪ sub groups), [] when no subs, skips preflight/done', async () => {
  const { window } = await boot();
  const { subsGroupsForRender } = window.__np;
  const subAgents = [
    { id: 'a1', nodeId: 'plan', cycle: 0, label: 'research', status: 'finished' },
  ];
  const steps = [
    { key: 'preflight', nodeId: 'preflight', cycle: 0, status: 'done' }, // excluded (not kind:'agents')
    { key: 'clarify', nodeId: 'clarify', cycle: 0, status: 'done' },     // ran, NO subs
    { key: 'plan', nodeId: 'plan', cycle: 0, status: 'done' },           // ran, HAS subs
    { key: 'review#1', nodeId: 'review', cycle: 1, status: 'start' },    // ran, NO subs
    { key: 'done', nodeId: 'done', cycle: 0, status: 'done' },           // excluded
  ];
  const groups = subsGroupsForRender(subAgents, steps, STEPPER);
  assert.deepEqual(Object.keys(groups), ['clarify|0', 'plan|0', 'review|1'], 'agent steps only, in step order');
  assert.equal(groups['clarify|0'].length, 0, 'no-sub agent -> empty array');
  assert.deepEqual(groups['plan|0'].map((s) => s.id), ['a1'], 'sub-bearing agent keeps its rows');
  assert.equal(groups['review|1'].length, 0);
});

test('subsGroupsForRender appends a sub-group with no matching step (defensive)', async () => {
  const { window } = await boot();
  const { subsGroupsForRender } = window.__np;
  const groups = subsGroupsForRender(
    [{ id: 'x', nodeId: 'ghost', cycle: 0, status: 'finished' }],
    [{ key: 'plan', nodeId: 'plan', cycle: 0, status: 'done' }],
    STEPPER,
  );
  assert.deepEqual(Object.keys(groups), ['plan|0', 'ghost|0'], 'step groups first, stray sub group appended');
  assert.equal(groups['ghost|0'].length, 1);
});

test('stepStatusByKey maps agent step status -> group status (skips non-agents)', async () => {
  const { window } = await boot();
  const { stepStatusByKey } = window.__np;
  const map = stepStatusByKey([
    { key: 'preflight', nodeId: 'preflight', cycle: 0, status: 'start' }, // excluded
    { key: 'clarify', nodeId: 'clarify', cycle: 0, status: 'done' },
    { key: 'review#1', nodeId: 'review', cycle: 1, status: 'start' },
    { key: 'plan', nodeId: 'plan', cycle: 0, status: 'error' },           // halt -> 'stop'
  ], STEPPER);
  assert.deepEqual(map, { 'clarify|0': 'done', 'review|1': 'run', 'plan|0': 'stop' });
});

test('cycleAwareLabel adds "· cycle N" across rendered group keys (even sub-less cycles)', async () => {
  const { window } = await boot();
  const { cycleAwareLabel } = window.__np;
  // review ran cycles 1 and 2; only cycle 2 spawned a sub. Suffix must still appear for both.
  const subAgents = [{ id: 'r2', nodeId: 'review', cycle: 2, status: 'finished' }];
  const keys = ['review|1', 'review|2'];
  const label = cycleAwareLabel(STEPPER, subAgents, keys);
  assert.equal(label('review|1'), 'Review · cycle 1');
  assert.equal(label('review|2'), 'Review · cycle 2');
  // Legacy 2-arg call (no keys) keeps sub-derived behavior: single sub cycle -> no suffix.
  assert.equal(cycleAwareLabel(STEPPER, subAgents)('review|2'), 'Review');
});

test('renderSubsTree: empty agent group shows header + muted placeholder, keeps header graphify pill', async () => {
  const { window } = await boot();
  const { renderSubsTree } = window.__np;
  const panel = window.document.createElement('div');
  panel.className = 'subs-panel';
  // clarify ran, spawned NO subs, but used graphify ×3 (header pill must still show).
  const byNode = { 'clarify|0': [] };
  renderSubsTree(
    panel, byNode,
    () => 'Clarify',
    /* stepSkills   */ { 'clarify|0': ['skill:graphify'] },
    /* stepGraphify */ { 'clarify|0': 3 },
    /* statusByKey  */ { 'clarify|0': 'done' },
  );
  const step = panel.querySelector('.subs-step');
  assert.ok(step, 'empty agent still renders a step group');
  assert.equal(step.querySelector('.subs-step-head b').textContent, 'Clarify');
  assert.ok(step.querySelector('.subs-stat.done'), 'status from statusByKey colours the header');
  assert.ok(!step.querySelector('.subs-n'), 'no redundant "0 sub-agents" count on an empty group');
  assert.ok(step.querySelector('.graphify-pill'), 'header graphify badge still renders');
  assert.ok(step.querySelector('.skill-pill'), 'header skill pill still renders');
  assert.ok(!step.querySelector('.subs-tree'), 'no <ul> rows for an empty group');
  const empty = step.querySelector('.subs-empty');
  assert.ok(empty, 'muted placeholder present');
  assert.match(empty.textContent, /No sub-agents spawned/);
});

test('renderSubsTree: non-empty group unchanged (rows + count, status from rollup)', async () => {
  const { window } = await boot();
  const { renderSubsTree } = window.__np;
  const panel = window.document.createElement('div');
  renderSubsTree(panel, { 'plan|0': [{ id: 't1', label: 'research', status: 'running' }] }, () => 'Plan');
  const step = panel.querySelector('.subs-step');
  assert.match(step.querySelector('.subs-n').textContent, /1 sub-agents/);
  assert.ok(step.querySelector('.subs-stat.run'));
  assert.equal(step.querySelectorAll('.subs-tree li').length, 1);
  assert.ok(!step.querySelector('.subs-empty'), 'no placeholder when subs exist');
});

test('paintSubsBar shows the bar for agents with zero subs; pill reads "0 sub-agents"', async () => {
  const { window } = await boot();
  const tpl = window.document.querySelector('#run-card-tpl');
  const bar = tpl.content.firstElementChild.cloneNode(true).querySelector('.subs-bar');
  // One agent that ran, spawned no subs; signature (barEl, byNode, labelOf, stepSkills, stepGraphify, statusByKey).
  window.__np.paintSubsBar(bar, { 'clarify|0': [] }, () => 'Clarify', {}, { 'clarify|0': 2 }, { 'clarify|0': 'done' });
  assert.ok(!bar.hidden, 'bar visible when a main agent ran, even with no subs');
  assert.match(bar.querySelector('.sb-count').textContent, /0 sub-agents/);
  // Expand -> the empty group renders with its placeholder + header graphify pill.
  bar.querySelector('.btn-subs').dispatchEvent(new window.Event('click', { bubbles: true }));
  const panel = bar.querySelector('.subs-panel');
  assert.match(panel.querySelector('.subs-empty').textContent, /No sub-agents spawned/);
  assert.ok(panel.querySelector('.graphify-pill'), 'header graphify badge shown for the sub-less agent');
});

test('paintSubsBar still hides when nothing ran (no groups at all)', async () => {
  const { window } = await boot();
  const tpl = window.document.querySelector('#run-card-tpl');
  const bar = tpl.content.firstElementChild.cloneNode(true).querySelector('.subs-bar');
  window.__np.paintSubsBar(bar, {});
  assert.ok(bar.hidden, 'no groups -> bar hidden');
});

test('live state frame: a sub-less main agent appears in the expanded Agents dropdown', async () => {
  const ctx = await boot();
  ctx.selectProject();
  ctx.window.location.hash = 'running';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  // clarify ran with graphify but spawned NO subs; plan ran with one sub.
  ctx.recv({
    type: 'state', runId: 'p1', status: 'running', phase: 'plan', cycle: 0, stepper: STEPPER,
    steps: [
      { key: 'clarify', nodeId: 'clarify', cycle: 0, status: 'done', graphifyCount: 6, skills: [] },
      { key: 'plan', nodeId: 'plan', cycle: 0, status: 'start', graphifyCount: 0, skills: [] },
    ],
    subAgents: [{ id: 'a1', nodeId: 'plan', cycle: 0, label: 'research', status: 'finished' }],
  });
  await new Promise((r) => setTimeout(r, 0));
  const bar = ctx.window.document.querySelector('[data-run-id="p1"] .subs-bar');
  assert.ok(bar && !bar.hidden, 'Agents bar visible (clarify ran with no subs, plan ran with one)');
  bar.querySelector('.btn-subs').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  const panel = bar.querySelector('.subs-panel');
  const heads = [...panel.querySelectorAll('.subs-step-head b')].map((b) => b.textContent);
  assert.deepEqual(heads, ['Clarify', 'Plan'], 'both main agents listed, in step order');
  const clarifyStep = [...panel.querySelectorAll('.subs-step')]
    .find((s) => s.querySelector('.subs-step-head b').textContent === 'Clarify');
  assert.ok(clarifyStep.querySelector('.subs-empty'), 'sub-less Clarify shows the muted placeholder');
  assert.ok(clarifyStep.querySelector('.graphify-pill'), 'Clarify keeps its graphify badge');
  assert.ok(!clarifyStep.querySelector('.subs-tree'), 'no rows under Clarify');
  const planStep = [...panel.querySelectorAll('.subs-step')]
    .find((s) => s.querySelector('.subs-step-head b').textContent === 'Plan');
  assert.equal(planStep.querySelectorAll('.subs-tree li').length, 1, 'Plan shows its one sub-agent row');
  assert.ok(!planStep.querySelector('.subs-empty'), 'no placeholder under Plan');
});
