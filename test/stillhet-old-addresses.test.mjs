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

// dev's Marketplace forms (app.js enterMarketplace: tabFromParam, targetFromParam), slice 8 D16
const DEV_MARKETPLACE_FORMS = [
  ['#marketplace/browse', '#marketplace/~all'],
  ['#marketplace/installed', '#marketplace/~installed'],
  ['#marketplace/marketplaces', '#marketplace'],
  ['#marketplace/installed/jira-source', '#marketplace/jira-source'],
  ['#marketplace/installed/jira-source/settings', '#marketplace/jira-source'],
  ['#marketplace/browse/worca-official/slack-chat', '#marketplace/slack-chat'],
];

test('Stillhet on: each of dev\'s 6 Marketplace forms lands on its route (never asking has); Stillhet\'s own Marketplace routes stay', () => {
  assert.equal(DEV_MARKETPLACE_FORMS.length, 6);
  const has = () => { throw new Error('the dev-marketplace rule never asks has'); };
  for (const [from, to] of DEV_MARKETPLACE_FORMS) { const r = resolve(from, { has }); assert.equal(r?.hash, to, from); assert.equal(r.pulse, '', from); }
  for (const r of ['#marketplace', '#marketplace/~all', '#marketplace/~src-official', '#marketplace/slack-chat']) assert.equal(resolve(r, { has }), null, r);
  assert.equal(resolve('#plugins').hash, '#marketplace');
  // dev builds these links with encodeURIComponent (global-search.mjs, settings-index.mjs): the plugin id is decoded
  assert.equal(resolve('#marketplace/installed/my%20plugin', { has })?.hash, '#marketplace/my plugin');
  assert.equal(resolve('#marketplace/browse/worca-official/my%20plugin', { has })?.hash, '#marketplace/my plugin');
});

test('Stillhet off: dev\'s Marketplace forms are dev\'s (MOVED_ROUTES has no marketplace key, so each hash reaches enterMarketplace byte-equal)', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  const block = app.slice(app.indexOf('const MOVED_ROUTES'), app.indexOf('});', app.indexOf('const MOVED_ROUTES')));
  const keys = [...block.matchAll(/^\s*'?([a-z/-]+)'?:\s*'/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 10);
  for (const [from] of DEV_MARKETPLACE_FORMS) {
    const path = from.slice(1);
    assert.ok(!keys.some((k) => path === k || path.startsWith(`${k}/`)), `${from} is not moved by dev`);
  }
  assert.match(app, /function enterMarketplace\(param, prevView\)/, 'dev routes them itself');
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

// Projects (slice 9 D17): dev's workspace forms (app.js WS_TABS, routeWsDetail) and project tabs (PROJ_TABS, routeProjectDetail)
const DEV_WORKSPACE_FORMS = [
  ['#workspaces', '#projects'], ['#workspaces/w1', '#projects/ws:w1'], ['#workspaces/w1/map', '#projects/ws:w1'], ['#workspaces/w1/team', '#projects/ws:w1'],
  ['#workspaces/w1/actions', '#projects/ws:w1'], ['#workspaces/w1/automations', '#projects/ws:w1'], ['#workspace-create', '#projects'],
];
const DEV_PROJECT_FORMS = ['team', 'settings', 'mcp', 'actions', 'automations', 'away', 'memory', 'memory/house-rules'].map((t) => [`#projects/web-1/${t}`, '#projects/web-1']);

test('Stillhet on: each of dev\'s 7 workspace forms and 8 project-tab forms lands on its Projects route (never asking has); Stillhet\'s own Projects routes stay', () => {
  assert.equal(DEV_WORKSPACE_FORMS.length, 7);
  assert.equal(DEV_PROJECT_FORMS.length, 8);
  const has = () => { throw new Error('the Projects rules never ask has'); };
  for (const [from, to] of [...DEV_WORKSPACE_FORMS, ...DEV_PROJECT_FORMS]) { const r = resolve(from, { has }); assert.equal(r?.hash, to, from); assert.equal(r.pulse, '', from); }
  for (const r of ['#projects', '#projects/web-1', '#projects/ws:w1', '#projects/web-1@w1', '#projects/web-1/bogus']) assert.equal(resolve(r, { has }), null, r);
});

test('Stillhet off: dev\'s workspace and project-tab forms are dev\'s (no MOVED_ROUTES key or prefix moves them; dev routes them itself)', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  const block = app.slice(app.indexOf('const MOVED_ROUTES'), app.indexOf('});', app.indexOf('const MOVED_ROUTES')));
  const keys = [...block.matchAll(/^\s*'?([a-z/-]+)'?:\s*'/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 10);
  for (const [from] of [...DEV_WORKSPACE_FORMS, ...DEV_PROJECT_FORMS]) {
    const path = from.slice(1);
    assert.ok(!keys.some((k) => path === k || path.startsWith(`${k}/`)), `${from} is not moved by dev`);
  }
  assert.match(app, /function routeWsDetail\(param/, 'dev routes its workspaces itself');
  assert.match(app, /function routeProjectDetail\(param/, 'dev routes its project tabs itself');
});

// Slice 10 D20: dev's Statistics and Team metrics forms
const DEV_INSIGHTS_FORMS = [['#stats', '#insights/spend'], ['#stats/cost', '#insights/spend'], ['#statistics', '#insights/spend'], ['#team-metrics', '#insights/team'], ['#team-metrics/timeline', '#insights/team'], ['#team-metrics/q3', '#insights/team']];

test('Stillhet on: each of dev\'s 6 Statistics and Team metrics forms lands on its Insights route (never asking has)', () => {
  const has = () => { throw new Error('the insights rule never asks has'); };
  for (const [from, to] of DEV_INSIGHTS_FORMS) assert.equal(resolve(from, { has })?.hash, to, from);
  for (const own of ['#insights', '#insights/spend', '#insights/team', '#insights/shaping', '#insights/heat', '#insights/spend?by=client']) assert.equal(resolve(own, { has }), null, own);
});

test('Stillhet off: dev\'s Statistics and Team metrics forms are dev\'s (MOVED_ROUTES moves none; dev\'s router loads its own pages)', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  const block = app.slice(app.indexOf('const MOVED_ROUTES'), app.indexOf('});', app.indexOf('const MOVED_ROUTES')));
  const keys = [...block.matchAll(/^\s*'?([a-z/-]+)'?:\s*'/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 10);
  for (const [from] of DEV_INSIGHTS_FORMS) {
    const path = from.slice(1);
    assert.ok(!keys.some((k) => path === k || path.startsWith(`${k}/`)), `${from} is not moved by dev`);
  }
  assert.match(app, /if \(name === 'stats'\) loadStatsView\(\);/, '#stats and #stats/cost reach loadStatsView');
  assert.match(app, /tmState\.tab = param === 'timeline' \? 'timeline' : 'overview';/, '#team-metrics/timeline opens dev\'s Timeline tab');
  assert.match(app, /else loadTeamMetricsView\(\);/, 'the team-metrics forms reach loadTeamMetricsView');
});

test('Stillhet on below Expert: #team-metrics lands on #insights/team and draws the locked line (Insights at Simple, By person at Advanced), never Spend', async () => {
  const settle = () => new Promise((r) => setTimeout(r, 30));
  for (const level of ['simple', 'advanced']) {
    const w = stillhetHost({ after, hash: '#team-metrics', level, beforeScripts: (win) => win.localStorage.setItem('worca-rail.mode', level) });   // the demo kind's mode
    await settle();
    assert.equal(w.location.hash, '#insights/team', level);
    const t = w.document.body.textContent;
    if (level === 'simple') assert.match(t, /Insights needs Advanced/, 'simple: Insights itself starts at Advanced');
    else { assert.match(t, /By person needs Expert/, 'advanced: the team page\'s own locked line'); }
    assert.doesNotMatch(w.document.getElementById('route-place').hidden ? '' : w.document.getElementById('route-place').textContent, /AI spend/, `${level}: never Spend in its place`);
  }
});
