// test/ui-sets-project.test.mjs — the project Sets tab (skills registry spec §6.5): the pill label "Sets" (key mcp),
// "Skills in runs on X" from POST /api/mcp/preview's `skills` (qualified names, set links, statuses, skip reasons, the
// blocked-layer and newer lines); the workspace Overview's read-only "Sets from member projects" (§6.6, F7) and the
// Settings › Ask Worca block (§6.12).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderSkillResolution, mountProjectMcp, paintMcpResolution, renderMemberSets, paintAskMcpBlock } from '../ui/public/mcp-view.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

const trackDom = useDomRelease(afterEach);

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

const BILLING = 'billing-1a2b3c4d';
const SHOP = 'shop-2b3c4d5e';
const SKILLS = {
  mounted: [
    { id: 'skill:library:release-notes', name: 'release-notes', qualifiedName: 'billing:release-notes', pluginName: 'billing', setId: 'billing',
      setName: 'Billing', setSlug: 'billing', projects: [BILLING], description: 'Draft release notes', plugin: null },
    { id: 'skill:library:release-notes', name: 'release-notes', qualifiedName: 'general:release-notes', pluginName: 'general', setId: 'general',
      setName: 'General', setSlug: null, projects: [BILLING, SHOP], description: 'Draft release notes', plugin: null },
    { id: 'skill:plugin:office/pdf-tools', name: 'pdf-tools', qualifiedName: 'billing:pdf-tools', pluginName: 'billing', setId: 'billing',
      setName: 'Billing', setSlug: 'billing', projects: [BILLING], description: 'PDF forms', plugin: 'office' },
  ],
  plugins: [{ setId: 'billing', setName: 'Billing', pluginName: 'billing', renamedPlugin: false, skills: ['pdf-tools', 'release-notes'] },
    { setId: 'general', setName: 'General', pluginName: 'general', renamedPlugin: false, skills: ['release-notes'] }],
  // As P4's preview sends them: every skipped row carries its set's plugin name and the qualified name.
  skipped: [
    { setId: 'billing', setName: 'Billing', pluginName: 'billing', qualifiedName: 'billing:db-migrations', skillId: 'skill:library:db-migrations',
      name: 'db-migrations', reason: 'off', why: 'off' },
    { setId: 'team-acme-platform-9333', setName: 'Team · acme/platform', pluginName: 'team-platfor', qualifiedName: 'team-platfor:deploy-checklist',
      skillId: 'skill:plugin:acme/deploy-checklist', name: 'deploy-checklist', reason: 'needs-consent', why: 'turn it on in the team checklist' },
    { setId: 'billing', setName: 'Billing', pluginName: 'billing', qualifiedName: 'billing:graphify', skillId: 'skill:plugin:graphify/graphify',
      name: 'graphify', reason: 'plugin-disabled', why: 'plugin disabled' },
  ],
  started: 3, layer: { blocked: null }, newer: false,
};
const PREVIEW = {
  sets: [
    { id: 'general', name: 'General', group: 'general', routes: [{ project: BILLING, route: null }, { project: SHOP, route: null }], members: 1, started: 1 },
    { id: 'billing', name: 'Billing', group: 'set', routes: [{ project: BILLING, route: null }], members: 2, started: 1 },
    { id: 'team-acme-platform-9333', name: 'Team · acme/platform', group: 'team', routes: [{ project: BILLING, route: null }, { project: SHOP, route: null }],
      members: 1, started: 0 },
  ],
  copies: [
    { name: 'github', copy: 'github', setId: 'general', setName: 'General', serverId: 'manual:github', projects: [BILLING, SHOP] },
    { name: 'sentry_billing', copy: 'sentry_billing', setId: 'billing', setName: 'Billing', serverId: 'plugin:acme-tools/sentry', projects: [BILLING] },
  ],
  skipped: [{ copy: 'github_team-platfor', setId: 'team-acme-platform-9333', setName: 'Team · acme/platform', serverId: 'policy:acme/platform/github',
    reason: 'needs-consent', why: 'turn it on in the team checklist' }],
  started: 2, deviations: [], skills: SKILLS,
};
const SETS = [{ id: 'general', name: 'General', members: [{ serverId: 'manual:github', copy: 'github', problem: null, test: 'ok' }] },
  { id: 'billing', name: 'Billing', members: [{ serverId: 'plugin:acme-tools/sentry', copy: 'sentry_billing', problem: null, test: 'ok' }] }];

function fakeApi({ preview = PREVIEW, assignment = { sets: [{ id: 'billing', name: 'Billing' }], includeGeneral: true, none: false, team: null, choices: [] },
  generalView = null } = {}) {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    if (method === 'GET' && path.startsWith('/api/mcp/projects/')) return { ok: true, status: 200, data: assignment };
    if (path === '/api/mcp/preview') return { ok: true, status: 200, data: preview };
    if (path === '/api/mcp/sets') return { ok: true, status: 200, data: { sets: SETS } };
    if (path === '/api/mcp/sets/general' && generalView) return { ok: true, status: 200, data: generalView };
    return { ok: false, status: 404, data: { error: 'not found' } };
  };
  return { api, calls };
}
const cells = (card) => [...card.querySelectorAll('.mcp-res-row')].map((r) => [...r.children].map((c) => c.textContent));

test('Skills in runs on X: qualified names, set links, statuses and skip reasons; the blocked-layer, newer and empty lines', async () => {
  await checkRows([
    { name: 'rows: mounted and skipped by the name agents call (qualifiedName), sorted; skip reasons; set links', run: () => {
      const card = renderSkillResolution(doc, 'Skills in runs on billing', PREVIEW);
      assert.equal(card.querySelector('h2').textContent, 'Skills in runs on billing');
      assert.ok(card.classList.contains('sk-resolution'));
      assert.deepEqual(cells(card), [
        ['billing:db-migrations', 'Billing', 'off'],
        ['billing:graphify', 'Billing', 'plugin disabled'],
        ['billing:pdf-tools', 'Billing', 'ok'],
        ['billing:release-notes', 'Billing', 'ok'],
        ['general:release-notes', 'General', 'ok'],
        ['team-platfor:deploy-checklist', 'Team · acme/platform', 'off — turn it on in the team checklist'],
      ]);
      assert.deepEqual([...card.querySelectorAll('.mcp-res-row a')].map((a) => a.getAttribute('href')).slice(3),
        ['#settings/mcp/sets/billing', '#settings/mcp', '#settings/mcp/sets/team-acme-platform-9333']);
      assert.equal(card.querySelectorAll('.mcp-res-skip').length, 3, 'skipped rows read as skips');
      assert.match(card.lastChild.textContent, /agents call \/<set>:<skill>/);
    } },
    { name: 'a blocked layer is one muted line; a newer store says so; nothing in runs says so', run: () => {
      const blocked = renderSkillResolution(doc, 'x', { ...PREVIEW, skills: { ...SKILLS, layer: { blocked: 'sideload-disabled' } } });
      assert.equal(blocked.querySelector('p.hint.warn').textContent,
        'skills from sets not loaded: this machine’s managed Claude Code settings turn off --plugin-dir');
      assert.deepEqual(cells(blocked).map((c) => c[2]), ['off', 'plugin disabled', 'not loaded', 'not loaded',
        'not loaded', 'off — turn it on in the team checklist'], 'no row reads ok on a machine that loads no set skill');
      const cli = renderSkillResolution(doc, 'x', { ...PREVIEW, skills: { ...SKILLS, layer: { blocked: 'cli-no-plugin-dir' } } });
      assert.equal(cli.querySelector('p.hint.warn').textContent, 'skills from sets not loaded: this Claude Code has no --plugin-dir');
      const said = renderSkillResolution(doc, 'x', { ...PREVIEW, skills: { ...SKILLS,
        layer: { blocked: 'cli-no-plugin-dir', text: 'this Claude Code has no --plugin-dir option' } } });
      assert.equal(said.querySelector('p.hint.warn').textContent, 'skills from sets not loaded: this Claude Code has no --plugin-dir option',
        'the preview\'s own words (layer.text, P1 skillLayerText) win: one wording on every surface');
      const newer = renderSkillResolution(doc, 'x', { ...PREVIEW, skills: { mounted: [], plugins: [], skipped: [], newer: true } });
      assert.equal(newer.querySelector('p.hint.err').textContent, 'Set files need a newer Worca: no skills from sets reach runs');
      const failed = renderSkillResolution(doc, 'x', { ...PREVIEW, skills: null });
      assert.equal(failed.querySelector('p.hint.err').textContent, 'Skills from sets could not be resolved: reload the page to try again');
      assert.doesNotMatch(failed.textContent, /No skills in runs/, 'a failed skills half is not "no skills"');
      assert.match(renderSkillResolution(doc, 'x', { copies: [], skipped: [] }, 'workspace').textContent, /No skills in runs on this workspace/);
    } },
  ]);
});

test('the project Sets tab paints Servers and Skills in runs on X; paintMcpResolution without skillsTitle paints servers only', async () => {
  const sec = doc.createElement('section');
  const { api } = fakeApi();
  await mountProjectMcp(sec, { key: BILLING, name: 'billing', api, doc });
  assert.deepEqual([...sec.querySelectorAll('.mcp-resolution h2')].map((x) => x.textContent), ['Servers in runs on billing', 'Skills in runs on billing']);
  assert.equal(sec.querySelectorAll('.sk-resolution .mcp-res-row').length, 6);
  const host = doc.createElement('div');
  await paintMcpResolution(host, { target: { projectKey: BILLING }, title: 'Servers in runs on billing', api, doc });
  assert.deepEqual([...host.querySelectorAll('h2')].map((x) => x.textContent), ['Servers in runs on billing']);
});

// ── the booted project page ──────────────────────────────────────────────────
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
class WSStub { constructor() { WSStub.last = this; this._l = {}; } send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); } _open() { (this._l.open || []).forEach((fn) => fn({})); } }

test('the booted project page: the pill reads "Sets" (key mcp) and the tab shows Skills in runs', async () => {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4321/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (u) => {
    const s = String(u);
    const json = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
    if (s.startsWith('/api/mcp/projects/')) return json({ sets: [], includeGeneral: true, none: false, team: null, choices: [] });
    if (s === '/api/mcp/preview') return json(PREVIEW);
    if (s === '/api/mcp/sets') return json({ sets: SETS });
    if (s.includes('/api/projects')) return json({ projects: [{ name: 'alpha', path: '/Users/me/dev/alpha', exists: true, key: 'alpha-00000001' }] });
    if (s.includes('/api/history')) return json({ pipelines: [], ghAvailable: false });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  window.location.hash = 'projects/alpha-00000001/mcp';
  await settle(); await settle();
  const d = window.document;
  const tab = d.querySelector('#proj-detail .pd-tab[data-sec="mcp"]');
  assert.equal(tab.textContent.trim(), 'Sets');
  assert.ok(tab.classList.contains('active'));
  assert.equal(d.querySelector('#proj-detail .pd-sec[data-sec="mcp"] .sk-resolution h2').textContent, 'Skills in runs on alpha');
});

// ── Task 8: the workspace Overview and Settings › Ask Worca ──────────────────
const MEMBERS = [{ key: BILLING, name: 'billing' }, { key: SHOP, name: 'shop' }];

test('workspace Overview: "Sets from member projects" — member chips with set counts, servers and skills with a From column; read-only', async () => {
  const host = doc.createElement('div');
  const { api, calls } = fakeApi();
  await paintMcpResolution(host, { target: { workspaceId: 'wks-checkout-1234abcd' }, title: 'checkout', members: MEMBERS, api, doc });
  assert.deepEqual(calls[0], ['POST', '/api/mcp/preview', { target: { workspaceId: 'wks-checkout-1234abcd' } }]);
  const card = host.querySelector('.sk-members');
  assert.equal(card.querySelector('h2').textContent, 'Sets from member projects');
  assert.equal(card.querySelector('.card-head .hint').textContent, 'read-only · change a set on its project');
  assert.deepEqual([...card.querySelectorAll('.mcp-usedby a.chip')].map((a) => [a.textContent, a.getAttribute('href')]),
    [['billing · 2 sets', `#projects/${BILLING}/mcp`], ['shop · 1 set', `#projects/${SHOP}/mcp`]], 'a Team set is not a member\'s set');
  const [servers, skills] = card.querySelectorAll('.sk-res-group');
  assert.equal(servers.querySelector('.label').textContent, 'Servers in runs on checkout · 3');
  assert.deepEqual([...servers.querySelector('.sk-res-head').children].map((c) => c.textContent), ['Server', 'From set', 'From', 'Status']);
  assert.deepEqual(cells(servers), [
    ['github', 'General', 'billing, shop', 'ok'],
    ['github_team-platfor', 'Team · acme/platform', 'Team', 'off — turn it on in the team checklist'],
    ['sentry_billing', 'Billing', 'billing', 'ok'],
  ]);
  assert.equal(skills.querySelector('.label').textContent, 'Skills in runs on checkout · 6');
  assert.deepEqual([...skills.querySelector('.sk-res-head').children].map((c) => c.textContent), ['Skill', 'From set', 'From', 'Status']);
  assert.deepEqual(cells(skills), [
    ['billing:db-migrations', 'Billing', 'billing', 'off'],
    ['billing:graphify', 'Billing', 'billing', 'plugin disabled'],
    ['billing:pdf-tools', 'Billing', 'billing', 'ok'],
    ['billing:release-notes', 'Billing', 'billing', 'ok'],
    ['general:release-notes', 'General', 'billing, shop', 'ok'],
    ['team-platfor:deploy-checklist', 'Team · acme/platform', 'Team', 'off — turn it on in the team checklist'],
  ]);
  assert.deepEqual([...skills.querySelectorAll('.mcp-res-row')].at(-2).children[2].querySelectorAll('a').length, 2, 'each member links to its Sets tab');
  assert.equal(skills.querySelector('.mcp-res-row .hint a').getAttribute('href'), `#projects/${BILLING}/mcp`);
  assert.equal(card.querySelector('button, input, select'), null, 'nothing to attach on a workspace (F7)');
  assert.equal(card.lastChild.textContent, 'To change what a workspace run gets, open a member project’s Sets tab.');
  const blocked = renderMemberSets(doc, { name: 'checkout', preview: { ...PREVIEW, copies: [], skipped: [], skills: { mounted: [], plugins: [], skipped: [],
    layer: { blocked: 'cli-no-plugin-dir' } } }, sets: SETS, members: MEMBERS });
  assert.deepEqual([...blocked.querySelectorAll('.sk-res-group p.hint')].map((p) => p.textContent), ['No MCP servers in runs on this workspace',
    'skills from sets not loaded: this Claude Code has no --plugin-dir', 'No skills in runs on this workspace']);
  const failed = renderMemberSets(doc, { name: 'checkout', preview: { ...PREVIEW, skills: null }, sets: SETS, members: MEMBERS });
  assert.deepEqual([...failed.querySelectorAll('.sk-res-group')[1].querySelectorAll('p.hint')].map((p) => p.textContent),
    ['Skills from sets could not be resolved: reload the page to try again'], 'a failed skills half is not "no skills"');
  const js = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(js, /paintMcpResolution\(mcp, \{ target: \{ workspaceId: id \}, title: w\.name \|\| w\.id, members: memberProjects, api: mcpApi \}\)/, 'buildWdOverview paints it');
});

test('Settings › Ask Worca: General\'s servers and skills as chips, the edit link, the Skill-tool line', async () => {
  const host = doc.createElement('div');
  const generalView = { set: { id: 'general', name: 'General', group: 'general', greyed: false, home: null, usedBy: [], pluginName: 'general' }, members: [],
    skills: [{ skillId: 'skill:library:worca', name: 'worca', qualifiedName: 'general:worca', description: 'Drive worca', enabled: true },
      { skillId: 'skill:library:release-notes', name: 'release-notes', qualifiedName: 'general:release-notes', description: '', enabled: true },
      { skillId: 'skill:library:old-notes', name: 'old-notes', qualifiedName: 'general:old-notes', description: '', enabled: false, reason: 'off' },
      { skillId: 'skill:plugin:acme/gone', name: 'gone', qualifiedName: 'general:gone', description: '', enabled: true, reason: 'missing-skill' }] };
  const { api, calls } = fakeApi({ generalView });
  await paintAskMcpBlock(host, { api, doc });
  assert.ok(calls.some(([m, p]) => m === 'GET' && p === '/api/mcp/sets/general'));
  assert.equal(host.querySelector('.label-row label').textContent, 'Sets');
  assert.deepEqual([...host.querySelectorAll('.chip')].map((c) => c.textContent), ['github', 'Skillgeneral:worca', 'Skillgeneral:release-notes'],
    'an off or missing skill reaches no chat: no chip');
  assert.equal(host.querySelector('.sk-chip').title, 'Drive worca');
  assert.equal(host.querySelector('.sk-chip .sk-kind').textContent, 'Skill');
  assert.equal(host.querySelector('a').getAttribute('href'), '#settings/mcp/sets/general');
  assert.equal(host.lastChild.textContent, 'The Skill tool is on only for turns that mount at least one skill; shell blocks never run in Ask.');
  const bare = doc.createElement('div');
  await paintAskMcpBlock(bare, { api: fakeApi().api, doc });
  assert.deepEqual([...bare.querySelectorAll('.chip')].map((c) => c.textContent), ['github'], 'no set view, no skill chips');
});
