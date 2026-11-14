// test/stillhet-old-addresses.test.mjs — dev's old addresses with Stillhet on (ui/public/stillhet/shell/old-addresses.js): one
// table, `resolve(hash)` → null or { hash, pulse }; shell.js route() replaces the address in place and opens Pulse when asked.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readStillhet, stillhetHost } from './helpers/stillhet-host.mjs';

const mod = { module: { exports: {} } };
vm.runInNewContext(readStillhet('shell/old-addresses.js'), mod);
const { TABLE, resolve } = mod.module.exports;

const EXPECT = {
  '#stats': '#insights/spend', '#stats/cost': '#insights/spend', '#statistics': '#insights/spend',
  '#team-metrics': '#insights/team', '#team-metrics/q3': '#insights/team',
  '#pipelines': '#runs', '#pipelines/abc': '#runs', '#running': '#runs', '#running/r1': '#run/r1', '#history': '#runs', '#history/k/p': '#run/p', '#history/k/p/details': '#run/p', '#history/k/p/details/logs': '#run/p', '#history/k': '#runs',
  // a feature's or group's page is not on live data yet: dev's bookmark lands on Tasks, never on "This task no longer exists"
  '#feature': '#runs', '#feature/f1': '#run/group:f1', '#group': '#runs', '#group/g1': '#run/group:g1', '#group/p%3Ap-77': '#run/p-77', '#group/t:t-5': '#schedules', '#schedules/once': '#schedules', '#schedules/repeating': '#schedules', '#schedules/activity': '#schedules',
  '#activity': '#chat',
  '#connectors': '#settings/connectors', '#settings/mcp': '#settings/connectors',
  '#models': '#settings/models', '#providers': '#settings/models', '#settings/providers': '#settings/models',
  '#team-policy': '#settings/team', '#team-policy/x': '#settings/team',
  '#workspaces': '#projects', '#workspaces/w1': '#projects/ws:w1', '#workspace-create': '#projects',
  '#new': '#chat', '#getting-started': '#chat', '#chat/new': '#chat',
  '#plugins': '#marketplace', '#guardrails': '#settings/guardrails',
  '#composer': '#workflows', '#agents': '#workflows', '#scripts': '#workflows', '#agent-create': '#workflows',
};

test('resolve: every table row to its place; #activity opens Pulse on Now', () => {
  for (const [from, to] of Object.entries(EXPECT)) assert.equal(resolve(from)?.hash, to, from);
  assert.equal(resolve('#activity').pulse, 'now');
  assert.equal(resolve('#stats').pulse, '');
  assert.ok(TABLE.length >= 12);
});

test('resolve: Workflows takes its own ways when it has them', () => {
  const has = (a) => ['~agents', '~scripts'].includes(a);
  assert.equal(resolve('#agents', { has }).hash, '#workflows/~agents');
  assert.equal(resolve('#scripts', { has }).hash, '#workflows/~scripts');
  assert.equal(resolve('#agent-create', { has }).hash, '#workflows/~agents');
});

test('resolve never loops: null for every current Stillhet route and for every target', () => {
  const w = stillhetHost({ after });
  const routes = [...w.RailShell.routes(), 'chat', 'insights/spend', 'insights/team', 'settings/connectors', 'settings/team', 'projects/ws:w1'];
  for (const r of routes) assert.equal(resolve(`#${r}`), null, r);
  for (const to of new Set(Object.values(EXPECT))) assert.equal(resolve(to), null, to);
  for (const to of ['#run/r1', '#run/p', '#run/group:g1']) assert.equal(resolve(to), null, to);
  assert.equal(resolve(''), null);
  assert.equal(resolve('#'), null);
});

test('every key of dev\'s MOVED_ROUTES lands somewhere, unless it is a Stillhet route already', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  const block = app.slice(app.indexOf('const MOVED_ROUTES'), app.indexOf('});', app.indexOf('const MOVED_ROUTES')));
  const keys = [...block.matchAll(/^\s*'?([a-z/-]+)'?:\s*'/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 10, 'read MOVED_ROUTES');
  const CURRENT = ['settings/models', 'settings/plugins'];   // Settings sections in Stillhet (settings-model.js SECTIONS)
  for (const k of keys) if (!CURRENT.includes(k)) assert.notEqual(resolve(`#${k}`), null, k);
});

test('jsdom shell: #stats, #team-metrics, #pipelines and #activity are replaced in place; #runs renders Tasks; #activity opens Pulse on Now', async () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));
  for (const [hash, to] of [['#stats', '#insights/spend'], ['#team-metrics', '#insights/team'], ['#pipelines', '#runs'], ['#activity', '#chat']]) {
    const w = stillhetHost({ after, hash });
    await settle();
    assert.equal(w.location.hash, to, hash);
    assert.equal(w.history.length, 1, `${hash}: replaced, not pushed (Back does not loop)`);
    if (hash === '#activity') {
      assert.ok(w.document.querySelector('#app .pz-popover'), 'Pulse is open');
      assert.equal(w.document.querySelector('#app .pz-popover [data-ptab="vitals"]').getAttribute('aria-selected'), 'true', 'on Now');
    }
  }
  const w = stillhetHost({ after, hash: '#runs' });
  await settle();
  assert.equal(w.location.hash, '#runs');
  assert.equal(w.document.getElementById('route-runs').hidden, false, 'Tasks drawn at #runs');
  assert.equal(w.document.getElementById('topnav-title').textContent, 'Tasks');
});

// Slice 7 D18: dev's ten Workflows forms (app.js routeWorkflows), each to its fixed Stillhet place
const DEV_WORKFLOW_FORMS = [
  ['#workflows/wf_full', '#workflows/workflow:wf_full'],
  ['#workflows/agents', '#workflows/~agents'],
  ['#workflows/agents/new', '#workflows/~agents'],
  ['#workflows/agents/new/planner', '#workflows/~agents'],
  ['#workflows/agents/planner', '#workflows/agent:planner'],
  ['#workflows/agents/planner/edit', '#workflows/agent:planner'],
  ['#workflows/scripts', '#workflows/~scripts'],
  ['#workflows/scripts/new', '#workflows/~scripts'],
  ['#workflows/scripts/new/node', '#workflows/~scripts'],
  ['#workflows/scripts/diffGate', '#workflows/script:diffGate'],
];

test('Stillhet on: each of dev\'s 10 Workflows forms lands on its place (never asking has); Stillhet\'s own Workflows routes stay', () => {
  assert.equal(DEV_WORKFLOW_FORMS.length, 10);
  const has = () => { throw new Error('the dev-workflows rule never asks has'); };
  for (const [from, to] of DEV_WORKFLOW_FORMS) { const r = resolve(from, { has }); assert.equal(r?.hash, to, from); assert.equal(r.pulse, '', from); }
  for (const r of ['#workflows', '#workflows/~agents', '#workflows/~for-you', '#workflows/workflow:wf_full', '#workflows/agent:planner', '#workflows/script:diffGate', '#workflows/edit:wf_mine']) assert.equal(resolve(r), null, r);
  for (const [from, to] of [['#composer', '#workflows'], ['#agent-create', '#workflows']]) assert.equal(resolve(from, { has: () => false }).hash, to);
  assert.equal(resolve('#agents', { has: () => true }).hash, '#workflows/~agents');
  assert.equal(resolve('#scripts', { has: () => true }).hash, '#workflows/~scripts');
});

test('Stillhet off: dev\'s Workflows forms are dev\'s (MOVED_ROUTES has no workflows key, so each hash reaches routeWorkflows byte-equal)', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  const block = app.slice(app.indexOf('const MOVED_ROUTES'), app.indexOf('});', app.indexOf('const MOVED_ROUTES')));
  const keys = [...block.matchAll(/^\s*'?([a-z/-]+)'?:\s*'/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 10);
  for (const [from] of DEV_WORKFLOW_FORMS) {
    const path = from.slice(1);
    assert.ok(!keys.some((k) => path === k || path.startsWith(`${k}/`)), `${from} is not moved by dev`);
  }
  assert.match(app, /async function routeWorkflows\(param = ''\)/, 'dev routes them itself');
});
