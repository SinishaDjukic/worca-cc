// test/ui-skill-pills.test.mjs — main-agent header pills + per-sub-agent row pills,
// escaped + kind-classed; and the run-model wiring (onStepSkills/onState/onSubagent).
// bootLive() copied from test/ui-subagent-pill.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function bootLive() {
  const wsInstances = [];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsInstances.push(this); }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    _fire(type, data) { for (const fn of (this._listeners[type] || [])) fn(data); }
  };
  window.fetch = (url) => {
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

test('skillPillsHtml renders main-agent header pills + per-sub-agent row pills, escaped, kind-classed', async () => {
  const { window } = await bootLive();
  const { skillPillsHtml } = window.__np;
  const panel = window.document.createElement('div');
  const stepSkills = { 'n1|1': ['skill:graphify', 'mcp:playwright', 'mcp:<x>'] };
  panel.innerHTML = skillPillsHtml(stepSkills['n1|1']);

  const head = panel.querySelector('.subs-skills'); // header pill row
  const headPills = [...head.querySelectorAll('.skill-pill')].map((e) => e.textContent);
  assert.deepEqual(headPills, ['graphify', 'playwright', '<x>']);          // names only, escaped
  assert.ok(head.querySelector('.skill-pill.is-mcp'), 'mcp pill carries is-mcp');
  assert.ok(head.querySelector('.skill-pill.is-skill'), 'skill pill carries is-skill');
  assert.equal(head.querySelector('.skill-pill').innerHTML, 'graphify');   // not raw "skill:graphify"
});

// §7.4: three label kinds must render — skill:<slug>, mcp:<server>[:<tool>],
// and §7.1's overflow:<n> sentinel (a muted `+N more` pill, never a label pill).
test('§7.4 three-part MCP labels render "<server> · <tool>" with .is-mcp-tool + a raw-tag tooltip', async () => {
  const { window } = await bootLive();
  const { skillPillsHtml } = window.__np;
  const panel = window.document.createElement('div');
  const stepSkills = { 'n1|1': [
    'skill:graphify',
    'mcp:playwright:browser_navigate',
    'mcp:playwright:browser_click',   // same server, second tool -> its OWN pill
    'mcp:echo',                       // legacy two-part shape still renders
  ] };
  panel.innerHTML = skillPillsHtml(stepSkills['n1|1']);

  const head = panel.querySelector('.subs-skills');
  assert.deepEqual([...head.querySelectorAll('.skill-pill')].map((e) => e.textContent),
    ['graphify', 'playwright · browser_navigate', 'playwright · browser_click', 'echo']);
  const toolPills = head.querySelectorAll('.skill-pill.is-mcp.is-mcp-tool');
  assert.equal(toolPills.length, 2, 'both three-part labels carry is-mcp AND is-mcp-tool');
  assert.equal(toolPills[0].getAttribute('title'), 'playwright:browser_navigate',
    'the tooltip carries the raw server:tool tag');
  const legacy = [...head.querySelectorAll('.skill-pill.is-mcp')].find((e) => e.textContent === 'echo');
  assert.ok(legacy && !legacy.classList.contains('is-mcp-tool'), 'a two-part label is NOT a tool pill');
  assert.equal(head.querySelector('.skill-pill.is-skill').textContent, 'graphify');
});

test('§7.1/§7.4 the overflow sentinel renders as a muted "+N more" pill, last, with a cap tooltip', async () => {
  const { window } = await bootLive();
  const { skillPillsHtml } = window.__np;
  const panel = window.document.createElement('div');
  const labels = Array.from({ length: 64 }, (_, i) => `mcp:srv:tool_${i}`);
  panel.innerHTML = skillPillsHtml([...labels, 'overflow:6']);

  const head = panel.querySelector('.subs-skills');
  const pills = [...head.querySelectorAll('.skill-pill')];
  assert.equal(pills.length, 65, '64 label pills + exactly one overflow pill');
  assert.equal(pills.at(-1).textContent, '+6 more', 'the sentinel is rendered LAST (renderer never re-sorts)');
  assert.ok(pills.at(-1).classList.contains('is-overflow'), 'the sentinel pill carries .is-overflow');
  assert.ok(!pills.at(-1).classList.contains('is-skill'), 'it is not a label pill');
  assert.match(pills.at(-1).getAttribute('title') || '', /64/, 'the tooltip names the cap');
  // The per-sub-agent row renders it too (same helper, both call sites).
  const rowHtml = skillPillsHtml(['skill:x', 'overflow:2']);
  panel.innerHTML = rowHtml;
  assert.equal(panel.querySelector('.skill-pill.is-overflow').textContent, '+2 more');
});

test('§7.4 a malformed overflow tag renders no pill (and no empty pill row)', async () => {
  const { window } = await bootLive();
  const { skillPillsHtml } = window.__np;
  const panel = window.document.createElement('div');
  panel.innerHTML = skillPillsHtml(['overflow:0', 'overflow:nope']);
  assert.equal(panel.querySelector('.subs-skills'), null, 'no pills -> no container');
});

// §7.5 reload: a persisted step array renders through the exact chain the
// reload paths use (subsGroupsForRender + stepSkillsFromSteps -> skillPillsHtml).
// Proves the new label shapes are not just persisted (test/skill-persist) but
// PAINTED after a reload, for both the main-agent group header and a sub-agent row.
test('§7.5 reload: a persisted 64+overflow:6 step array paints 65 pills', async () => {
  const { window } = await bootLive();
  const { subsGroupsForRender, stepSkillsFromSteps, skillPillsHtml } = window.__np;
  const skills = [...Array.from({ length: 64 }, (_, i) => `mcp:srv:tool_${i}`), 'overflow:6'];
  const state = {
    steps: [{ key: '2:plan', nodeId: 'plan', stepIndex: 2, cycle: 0, status: 'done', skills }],
    subAgents: [{ id: 'a1', label: 'AR', nodeId: 'plan', cycle: 0, status: 'finished',
      skills: ['skill:brainstorming', 'mcp:playwright:browser_navigate'] }],
    stepper: { agents: [['plan']] },
  };
  const groups = subsGroupsForRender(state.subAgents, state.steps, state.stepper);
  const key = Object.keys(groups)[0];
  const host = window.document.createElement('div');
  host.innerHTML = skillPillsHtml(stepSkillsFromSteps(state.steps)[key]);
  assert.equal(host.querySelectorAll('.skill-pill').length, 65, '64 label pills + the sentinel');
  assert.equal(host.querySelector('.skill-pill.is-overflow').textContent, '+6 more');
  assert.equal(host.querySelectorAll('.skill-pill.is-mcp-tool').length, 64, 'all three-part labels survived');
  host.innerHTML = skillPillsHtml(groups[key][0].skills);
  assert.deepEqual([...host.querySelectorAll('.skill-pill')].map((e) => e.textContent),
    ['brainstorming', 'playwright · browser_navigate'], 'the sub-agent row reloads its pills too');
});

test('onStepSkills + onState populate r.stepSkills; onSubagent merges skills', async () => {
  const { window } = await bootLive();
  const { makeRun, onState, onSubagent, onStepSkills } = window.__np;
  const r = makeRun({ runId: 'run1' });
  onState(r, { steps: [{ key: '2:n1', nodeId: 'n1', cycle: 1, skills: ['skill:graphify'] }], subAgents: [] });
  assert.deepEqual(r.stepSkills['n1|1'], ['skill:graphify']);              // composite nodeId|cycle key
  onStepSkills(r, { nodeId: 'n1', cycle: 1, skills: ['skill:graphify', 'mcp:playwright'] });
  assert.deepEqual(r.stepSkills['n1|1'], ['skill:graphify', 'mcp:playwright']);
  onSubagent(r, { id: 'a1', nodeId: 'n1', cycle: 1, status: 'running', skills: ['skill:brainstorming'] });
  assert.deepEqual(r.subAgents.find((s) => s.id === 'a1').skills, ['skill:brainstorming']);
});
