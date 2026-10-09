// test/ui-skills-view.test.mjs — Connectors (skills registry spec §6.1–§6.3): the page title "Connectors", the
// Sets · Servers · Skills segments and #connectors/skills, the Skills catalog (source and origin, badges, In sets,
// actions per source, the empty state, the read-only SKILL.md drawer), its actions, the set detail's Skills section
// and Add skill; plus the booted app's deep link.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parseMcpParam, mcpRoute, MCP_SKILLS_ROUTE, createMcpView, skillCountsText, SKILL_HOOKS_TEXT } from '../ui/public/mcp-view.mjs';
import * as texts from '../src/core/skills-registry/texts.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const click = (el) => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
const change = (el) => el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));

const SETS = [
  { id: 'general', name: 'General', group: 'general', greyed: false, home: null, serverCount: 1, skillCount: 1, problem: false,
    usedBy: [{ key: 'shop-2b3c4d5e', name: 'shop' }], members: [] },
  { id: 'billing', name: 'Billing', group: 'set', greyed: false, home: null, serverCount: 0, skillCount: 2, problem: false,
    usedBy: [{ key: 'billing-1a2b3c4d', name: 'billing' }], members: [] },
  { id: 'shop', name: 'Shop', group: 'set', greyed: false, home: null, serverCount: 2, skillCount: 0, problem: false, usedBy: [], members: [] },
  { id: 'team-acme-platform-9333', name: 'Team · acme/platform', group: 'team', greyed: false, home: 'acme/platform', serverCount: 0, skillCount: 1,
    problem: false, usedBy: [{ key: 'billing-1a2b3c4d', name: 'billing' }], members: [] },
];
const fm = (o = {}) => ({ allowedTools: null, hooks: false, shell: false, disableModelInvocation: false, pluginRootRefs: false, ...o });
const skill = (o) => ({ source: 'library', plugin: null, description: '', frontmatter: fm(), files: 1, bytes: 900, scripts: [], shellBlocks: 0,
  code: null, pluginEnabled: true, valid: true, problems: [], inSets: [], updateAvailable: false, installedPluginClash: false, origin: null, ...o });
const SKILLS = [
  skill({ id: 'skill:library:db-migrations', name: 'db-migrations', description: 'Write, review and apply SQL migrations', files: 7,
    scripts: ['scripts/plan.py', 'scripts/apply.sh'], shellBlocks: 1, inSets: [{ id: 'billing', name: 'Billing' }],
    origin: { kind: 'dir', path: '/Users/me/havn/.claude/skills/db-migrations' } }),
  skill({ id: 'skill:library:frontend-design', name: 'frontend-design', description: 'Production-grade UI' }),
  skill({ id: 'skill:library:release-notes', name: 'release-notes', description: 'Draft release notes from merged PRs', files: 4,
    scripts: ['scripts/collect.sh'], shellBlocks: 2, updateAvailable: true, inSets: [{ id: 'billing', name: 'Billing' }, { id: 'general', name: 'General' }],
    origin: { kind: 'git', url: 'https://github.com/havn/skills', ref: 'main', subdir: 'release-notes' } }),
  skill({ id: 'skill:plugin:acme/broken', source: 'plugin', plugin: 'acme', name: 'broken', code: '3f9a1c2', valid: false,
    problems: ['SKILL.md has no frontmatter'] }),
  skill({ id: 'skill:plugin:acme/deploy-checklist', source: 'plugin', plugin: 'acme', name: 'deploy-checklist', description: 'Pre-deploy checks',
    files: 5, scripts: ['scripts/check.mjs', 'scripts/smoke.mjs'], shellBlocks: 1, code: '3f9a1c2', frontmatter: fm({ hooks: true }),
    inSets: [{ id: 'team-acme-platform-9333', name: 'Team · acme/platform' }] }),
  skill({ id: 'skill:plugin:graphify/graphify', source: 'plugin', plugin: 'graphify', name: 'graphify', description: 'Any input to a knowledge graph',
    files: 9, code: 'linked', pluginEnabled: false, frontmatter: fm({ pluginRootRefs: true }) }),
];
const MD = '---\nname: release-notes\ndescription: Draft release notes\n---\n# Release notes\n';

function mount({ sets = SETS, setViews = {}, skills = SKILLS, over = {}, answer = async () => true } = {}) {
  const calls = [];
  const nav = [];
  const confirms = [];
  const modal = { opened: null, open(title, body, actions) { this.opened = { title, body, actions }; }, close() { this.opened = null; } };
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    const key = `${method} ${path}`;
    if (Object.hasOwn(over, key)) return over[key];
    if (key === 'GET /api/mcp/sets') return { ok: true, status: 200, data: { newer: false, sets } };
    if (method === 'GET' && path.startsWith('/api/mcp/sets/')) {
      const v = setViews[decodeURIComponent(path.slice(14))];
      return v ? { ok: true, status: 200, data: v } : { ok: false, status: 404, data: { error: 'set not found' } };
    }
    if (key === 'GET /api/skills') return { ok: true, status: 200, data: { newer: false, skills } };
    if (method === 'GET' && path.endsWith('/skill-md')) return { ok: true, status: 200, data: { id: decodeURIComponent(path.split('/')[3]), bytes: MD.length, text: MD } };
    if (key === 'GET /api/mcp/servers') return { ok: true, status: 200, data: { servers: [] } };
    return { ok: true, status: 200, data: { ok: true } };
  };
  const host = doc.createElement('section');
  doc.body.replaceChildren(host);
  const ctl = createMcpView({ host, api, navigate: (h) => nav.push(h), confirm: async (o) => { confirms.push(o); return answer(o); }, modal, doc });
  return { host, ctl, calls, nav, confirms, modal, writes: () => calls.filter(([m]) => m !== 'GET') };
}
const action = (modal, label) => modal.opened.actions.find(([l]) => l === label)[2];
const rowOf = (host, id) => host.querySelector(`.sk-row[data-skill="${id}"]`);
const acts = (row) => [...row.querySelectorAll('.pl-actions button')].map((b) => b.textContent);

test('routes and labels: #connectors/skills, the title "Connectors", three segments, one primary button per view', async () => {
  await checkRows([
    { name: 'hashes: skills is a view; a set named Skills keeps its own hash', run: () => {
      assert.deepEqual(parseMcpParam('skills'), { view: 'skills', setId: null });
      assert.equal(MCP_SKILLS_ROUTE, 'connectors/skills');
      assert.deepEqual(parseMcpParam('sets/skills'), { view: 'sets', setId: 'skills' });
      assert.equal(mcpRoute('skills'), 'connectors/sets/skills');
    } },
    { name: 'the Skills view: title, sub, segments, Import skill, GET /api/skills', run: async () => {
      const { host, ctl, calls } = mount();
      await ctl.show('skills');
      assert.equal(host.querySelector('.topbar h1'), null, 'the top bar names the page');
      assert.equal(host.querySelector('.topbar .sub').textContent, 'MCP servers and skills worca’s agents and Ask Worca get, grouped in sets attached to projects');
      const seg = [...host.querySelectorAll('.topbar .seg button')];
      assert.deepEqual(seg.map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['Sets', 'false'], ['Servers', 'false'], ['Skills', 'true']]);
      assert.equal(host.querySelector('.topbar .btn-go').textContent, 'Import skill');
      assert.equal(host.querySelector('.topbar .btn-go').dataset.act, 'import-skill');
      assert.ok(calls.some(([m, p]) => m === 'GET' && p === '/api/skills'));
    } },
    { name: 'the segments navigate: Servers, Skills, back to the last set', run: async () => {
      const { host, ctl, nav } = mount({ setViews: { billing: { set: { id: 'billing', name: 'Billing', group: 'set', greyed: false, home: null, usedBy: [] }, members: [] } } });
      await ctl.show('sets/billing');
      assert.equal(host.querySelector('.topbar .btn-go').textContent, 'New set');
      click(host.querySelector('[data-mcp-view="skills"]'));
      await ctl.show('skills');
      click(host.querySelector('[data-mcp-view="servers"]'));
      await ctl.show('servers');
      assert.equal(host.querySelector('.topbar .btn-go').textContent, 'Add MCP server');
      click(host.querySelector('[data-mcp-view="sets"]'));
      assert.deepEqual(nav, [MCP_SKILLS_ROUTE, 'connectors/servers', 'connectors/sets/billing']);
    } },
  ]);
});

test('the Skills catalog: source and origin, badges, the counts line, In sets links, actions per source, invalid rows', async () => {
  const { host, ctl } = mount();
  await ctl.show('skills');
  assert.deepEqual([...host.querySelectorAll('.sk-row')].map((r) => r.dataset.skill), SKILLS.map((s) => s.id));
  const badges = (row) => [...row.querySelectorAll('.pl-head .badge')].map((b) => `${b.className.replace('badge', '').trim() || '-'}:${b.textContent}`);
  await checkRows([
    { name: 'a folder import: Imported, folder, Windows badge for a .sh script, Check for updates, Remove', run: () => {
      const row = rowOf(host, 'skill:library:db-migrations');
      assert.deepEqual(badges(row), ['-:Imported', 'amber:shell scripts — Windows']);
      assert.equal(row.querySelector('.pl-head .mono.hint').textContent, 'folder');
      assert.equal(row.querySelector('small.hint').textContent, 'Write, review and apply SQL migrations · 7 files · 2 scripts · 1 shell block');
      assert.deepEqual(acts(row), ['Add to set', 'Check for updates', 'Remove', 'View SKILL.md']);
      assert.deepEqual([...row.querySelectorAll('a.chip')].map((a) => [a.textContent, a.getAttribute('href')]), [['Billing', '#connectors/sets/billing']]);
    } },
    { name: 'a pasted skill has no origin: no update action', run: () => {
      const row = rowOf(host, 'skill:library:frontend-design');
      assert.equal(row.querySelector('.pl-head .mono.hint').textContent, 'pasted');
      assert.deepEqual(acts(row), ['Add to set', 'Remove', 'View SKILL.md']);
      assert.match(row.querySelector('.mcp-usedby').textContent, /not in a set/);
    } },
    { name: 'a git import with an update: the badge and a primary Update…', run: () => {
      const row = rowOf(host, 'skill:library:release-notes');
      assert.equal(row.querySelector('.pl-head .mono.hint').textContent, 'git · main');
      assert.deepEqual(badges(row), ['-:Imported', 'amber:update available', 'amber:shell scripts — Windows']);
      assert.deepEqual(acts(row), ['Add to set', 'Update…', 'Remove', 'View SKILL.md']);
      assert.ok(row.querySelector('[data-skill-update]').classList.contains('btn-primary'));
      assert.deepEqual([...row.querySelectorAll('a.chip')].map((a) => a.getAttribute('href')), ['#connectors/sets/billing', '#connectors']);
    } },
    { name: 'an invalid plugin skill: red badge, the problem, never mounted, Add to set disabled', run: () => {
      const row = rowOf(host, 'skill:plugin:acme/broken');
      assert.deepEqual(badges(row), ['violet:acme', 'red:invalid']);
      assert.equal(row.querySelector('small.hint.err').textContent, 'invalid: SKILL.md has no frontmatter · never mounted');
      assert.equal(row.querySelector('[data-skill-add-to]').disabled, true);
      assert.deepEqual(acts(row), ['Add to set', 'View SKILL.md'], 'a plugin skill is neither updated nor removed here');
    } },
    { name: 'a plugin skill: violet plugin badge, pinned sha; one that declares hooks says what they do', run: () => {
      const row = rowOf(host, 'skill:plugin:acme/deploy-checklist');
      assert.deepEqual(badges(row), ['violet:acme', 'red:declares hooks']);
      assert.equal(row.querySelector('small.hint.err').textContent,
        "declares hooks — they run shell commands outside Worca's guardrails when the skill is used");
      assert.equal(row.querySelector('.pl-head .mono.hint').textContent, '@ 3f9a1c2');
      assert.equal(row.querySelector('[data-skill-add-to]').disabled, false);
    } },
    { name: 'a linked, disabled plugin with plugin-root refs', run: () => {
      const row = rowOf(host, 'skill:plugin:graphify/graphify');
      assert.equal(row.querySelector('.pl-head .mono.hint').textContent, 'linked');
      assert.deepEqual(badges(row), ['violet:graphify', 'amber:plugin disabled', 'amber:plugin-root refs']);
      assert.equal(row.querySelector('small.hint.warn').textContent, 'references its plugin’s other files — may not work from a set');
    } },
  ]);
  const { host: empty, ctl: c2 } = mount({ skills: [] });
  await c2.show('skills');
  assert.equal(empty.querySelector('.hist-empty').textContent, 'No skills yet. Install a plugin that ships some, or Import skill.');
  // A newer or damaged library.json reads as empty (P1): the view says why no imported skill is listed.
  for (const [library, text] of [
    [{ newer: false, damaged: true }, 'The skill library file skills/library.json is damaged — fix it or remove it: imported skills are not listed'],
    [{ newer: true, damaged: false }, 'The skill library needs a newer Worca: imported skills are not listed']]) {
    const plugins = SKILLS.filter((s) => s.source === 'plugin');
    const v = mount({ over: { 'GET /api/skills': { ok: true, status: 200, data: { newer: false, library, skills: plugins } } } });
    await v.ctl.show('skills');
    assert.equal(v.host.querySelector('.form-msg.err').textContent, text);
    assert.equal(v.host.querySelectorAll('.sk-row').length, plugins.length);
  }
  assert.equal(host.querySelector('.form-msg.err'), null, 'a readable library says nothing');
});

test('View SKILL.md opens a read-only drawer (fetched once per entry), Hide closes it; show() starts closed', async () => {
  const { host, ctl, calls } = mount();
  await ctl.show('skills');
  const id = 'skill:library:release-notes';
  const reads = () => calls.filter(([m, p]) => m === 'GET' && p === `/api/skills/${encodeURIComponent(id)}/skill-md`).length;
  click(rowOf(host, id).querySelector('[data-skill-md]'));
  await settle();
  const btn = rowOf(host, id).querySelector('[data-skill-md]');
  assert.deepEqual([btn.textContent, btn.getAttribute('aria-expanded')], ['Hide SKILL.md', 'true']);
  assert.equal(rowOf(host, id).querySelector('.sk-drawer pre').textContent, MD);
  assert.match(rowOf(host, id).querySelector('.sk-drawer-head').textContent, /read-only · edit the folder and import it again/);
  click(btn);
  await settle();
  assert.equal(rowOf(host, id).querySelector('.sk-drawer'), null);
  click(rowOf(host, id).querySelector('[data-skill-md]'));
  await settle();
  assert.equal(reads(), 1, 'the text is kept while the page is open');
  const plugin = 'skill:plugin:acme/deploy-checklist';
  click(rowOf(host, plugin).querySelector('[data-skill-md]'));
  await settle();
  assert.match(rowOf(host, plugin).querySelector('.sk-drawer-head').textContent, /read-only · ships with acme/);
  await ctl.show('skills');
  assert.equal(host.querySelector('.sk-drawer'), null, 'a new entry starts with every drawer closed');
  const failed = mount({ over: { [`GET /api/skills/${encodeURIComponent(id)}/skill-md`]: { ok: false, status: 404, data: { error: 'SKILL.md not found' } } } });
  await failed.ctl.show('skills');
  click(rowOf(failed.host, id).querySelector('[data-skill-md]'));
  await settle();
  assert.equal(rowOf(failed.host, id).querySelector('.sk-drawer .hint.err').textContent, 'SKILL.md not found');
});

test('the hooks words are the library\'s (P1 SKILL_HOOKS_TEXT): one wording on every surface', () => {
  assert.equal(SKILL_HOOKS_TEXT, texts.SKILL_HOOKS_TEXT);
});

test('the counts line: files only when known, singular and plural', () => {
  assert.equal(skillCountsText({ files: 1, scripts: ['a.sh'], shellBlocks: 1 }), '1 file · 1 script · 1 shell block');
  assert.equal(skillCountsText({ scripts: [], shellBlocks: 0 }), '0 scripts · 0 shell blocks');
  assert.equal(skillCountsText({ files: 4, scripts: 2, shellBlocks: 3 }), '4 files · 2 scripts · 3 shell blocks');
});

test('the sk- CSS is layout on theme tokens: no left-edge accent line, no literal colour (light and dark both hold)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Connectors › Skills');
  assert.ok(start > 0, 'the sk- block is in style.css');
  const block = css.slice(start, css.indexOf('\n\n', start));
  assert.match(block, /\.sk-row\{/);
  // A preview row with several flags wraps instead of squeezing its path to nothing, and long file and skill lists scroll
  // inside the dialog, so Import, Back, Cancel and Add stay near (real Chrome: 258 files put them 11 000 px down).
  assert.match(block, /\.sk-tree-row,\.sk-delta\{[^}]*flex-wrap:wrap/);
  assert.match(block, /\.sk-tree\{[^}]*max-height:[^;]+;overflow:auto/);
  assert.match(block, /\.sk-pick\{[^}]*max-height:[^;]+;overflow:auto/);
  assert.doesNotMatch(block, /border-left/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
});

// ── the booted app ───────────────────────────────────────────────────────────
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
class WSStub { constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; } send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); } _open() { (this._l.open || []).forEach((fn) => fn({})); } }

test('the booted app: Settings has no Sets tab, and #connectors/skills lands on the Skills view of the Connectors page', async () => {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4319/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  const calls = [];
  window.fetch = (u, opts = {}) => {
    const s = String(u);
    calls.push(`${opts.method || 'GET'} ${s}`);
    const json = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
    if (s === '/api/skills') return json({ newer: false, skills: SKILLS });
    if (s === '/api/mcp/sets') return json({ newer: false, sets: SETS });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: 0, pipelines: 0, workspaces: 0, projects_list: [], guardrails: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  if (WSStub.last) WSStub.last._open();
  assert.equal(window.document.querySelector('#settings-tabs button[data-tab="mcp"]'), null);
  window.location.hash = 'connectors/skills';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  const pane = window.document.querySelector('.view[data-view="connectors"]');
  assert.equal(pane.classList.contains('hidden'), false);
  assert.ok(calls.includes('GET /api/skills'));
  assert.equal(pane.querySelectorAll('.sk-row').length, SKILLS.length);
  assert.equal(window.location.hash, '#connectors/skills');
});

// ── Task 3: the Import modal in the booted app ───────────────────────────────
test('the booted app: a preview that lands after the modal\'s own Close opens nothing and drops its stage; a preview on screen is dropped by it too', async () => {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4319/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  const calls = [];
  let land = null;
  window.fetch = (u, opts = {}) => {
    const s = String(u);
    calls.push(`${opts.method || 'GET'} ${s}`);
    const reply = (data) => ({ ok: true, status: 200, json: async () => data });
    if (s === '/api/skills/import/preview') {
      return new Promise((r) => { land = () => r(reply({ stage: '0123456789abcdef', name: 'alpha', inspection: { files: [], findings: [], problems: [] } })); });
    }
    if (s === '/api/skills') return Promise.resolve(reply({ newer: false, folderImports: true, skills: SKILLS }));
    if (s === '/api/mcp/sets') return Promise.resolve(reply({ newer: false, sets: SETS }));
    return Promise.resolve(reply({ config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: 0, pipelines: 0, workspaces: 0, projects_list: [], guardrails: [] }));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  if (WSStub.last) WSStub.last._open();
  window.location.hash = 'connectors/skills';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  const d = window.document;
  const modal = d.getElementById('plugin-modal');
  d.querySelector('.view[data-view="connectors"] [data-act="import-skill"]').click();
  await settle();
  assert.equal(modal.classList.contains('hidden'), false);
  const path = d.querySelector('#plugin-modal-body [data-imp="path"]');
  path.value = '/src/alpha';
  path.dispatchEvent(new window.Event('input', { bubbles: true }));
  [...d.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === 'Preview').click();
  await settle();
  assert.ok(land, 'the preview is in flight');
  d.getElementById('plugin-modal-close').click();
  assert.equal(modal.classList.contains('hidden'), true);
  land();
  await settle();
  assert.equal(modal.classList.contains('hidden'), true, 'the late answer reopens nothing');
  assert.ok(calls.includes('DELETE /api/skills/import/0123456789abcdef'), 'and its stage is dropped');
  // A preview on screen: the dialog's own Close is its Cancel (app.js `afterClose`), so the staged copy goes at once.
  const drops = () => calls.filter((c) => c === 'DELETE /api/skills/import/0123456789abcdef').length;
  const dropped = drops();
  d.querySelector('.view[data-view="connectors"] [data-act="import-skill"]').click();
  await settle();
  const again = d.querySelector('#plugin-modal-body [data-imp="path"]');
  again.value = '/src/alpha';
  again.dispatchEvent(new window.Event('input', { bubbles: true }));
  [...d.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === 'Preview').click();
  await settle();
  land();
  await settle();
  assert.equal(d.getElementById('plugin-modal-title').textContent, 'Import skill · alpha');
  d.getElementById('plugin-modal-close').click();
  await settle();
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(drops(), dropped + 1, 'the Close of a preview on screen discards its stage');
});

// ── Task 4: the Skills view's actions ────────────────────────────────────────
test('Skills view › Add to set: General and user sets, never a Team set; a set it is in is disabled; a refusal shows in the modal', async () => {
  const id = 'skill:library:db-migrations';
  const m = mount({ over: { [`PUT /api/sets/shop/skills/${encodeURIComponent(id)}`]: { ok: false, status: 409, data: { error: 'a skill named db-migrations is already in this set' } } } });
  await m.ctl.show('skills');
  click(rowOf(m.host, id).querySelector('[data-skill-add-to]'));
  await settle();
  assert.equal(m.modal.opened.title, 'Add db-migrations to a set');
  assert.deepEqual([...m.modal.opened.body.querySelectorAll('option')].map((o) => [o.value, o.disabled]),
    [['general', false], ['billing', true], ['shop', false]]);
  await action(m.modal, 'Add')();
  await settle();
  assert.deepEqual(m.writes(), [['PUT', `/api/sets/general/skills/${encodeURIComponent(id)}`, { enabled: true }]]);
  assert.equal(m.modal.opened, null);
  assert.equal(m.calls.filter(([meth, p]) => meth === 'GET' && p === '/api/skills').length, 2, 'the catalog is read again');
  click(rowOf(m.host, id).querySelector('[data-skill-add-to]'));
  await settle();
  m.modal.opened.body.querySelector('select').value = 'shop';
  await action(m.modal, 'Add')();
  assert.ok(m.modal.opened, 'a refused add keeps the modal open');
  assert.equal(m.modal.opened.body.querySelector('.form-msg.err').textContent, 'a skill named db-migrations is already in this set');
});

test('Check for updates → what changed → Update applies the stage; nothing new says so; Cancel discards; problems block Update', async () => {
  const id = 'skill:library:release-notes';
  const P = `/api/skills/${encodeURIComponent(id)}/update`;
  const ins = { files: [{ path: 'SKILL.md', bytes: 2048 }, { path: 'references/style.md', bytes: 1024 }], bytes: 3072, scripts: ['scripts/collect.sh'],
    shellBlocks: 2, findings: [], problems: [] };
  const diff = { stage: 'abcdefabcdefabcd', added: ['references/style.md'], removed: ['scripts/old.sh'], changed: ['SKILL.md'], inspection: ins };
  const m = mount({ over: { [`POST ${P}/preview`]: { ok: true, status: 200, data: diff } } });
  await m.ctl.show('skills');
  click(rowOf(m.host, id).querySelector('[data-skill-update]'));
  await settle();
  assert.equal(m.modal.opened.title, 'Update release-notes');
  const b = m.modal.opened.body;
  assert.deepEqual([...b.querySelectorAll('.sk-delta')].map((r) => [r.className, r.textContent]),
    [['sk-delta', '+ references/style.md'], ['sk-delta err', '− scripts/old.sh'], ['sk-delta warn', '~ SKILL.md']]);
  assert.equal(b.querySelector('small.hint').textContent, '2 files · 3.0 kB · 1 script · 2 shell blocks');
  assert.equal(b.querySelector('.sk-consent b').textContent, 'Worca copies these files into its library. Agents may read them and run the scripts where their guardrails allow.');
  assert.deepEqual([...b.querySelectorAll('.sk-consent-note')].map((p) => p.textContent),
    ['Its inline shell blocks (!`cmd`) run in pipeline runs without guardrail checks; Ask Worca never runs them.'], 'the same honest lines as Import');
  await action(m.modal, 'Update')();
  await settle();
  assert.deepEqual(m.writes(), [['POST', `${P}/preview`, undefined], ['POST', P, { stage: 'abcdefabcdefabcd' }]]);
  assert.equal(m.modal.opened, null);
  assert.equal(m.host.querySelector('.form-msg').textContent, 'Updated release-notes');
  const same = mount({ over: { [`POST ${P}/preview`]: { ok: true, status: 200, data: { stage: '1111111111111111', added: [], removed: [], changed: [], inspection: ins } } } });
  await same.ctl.show('skills');
  click(rowOf(same.host, id).querySelector('[data-skill-update]'));
  await settle();
  assert.equal(same.modal.opened.title, 'release-notes is up to date');
  assert.deepEqual(same.writes().at(-1), ['DELETE', '/api/skills/import/1111111111111111', undefined], 'an unchanged stage is discarded');
  assert.equal(same.calls.filter(([meth, p]) => meth === 'GET' && p === '/api/skills').length, 2, 'the check cleared the badge: the catalog is read again');
  const cancel = mount({ over: { [`POST ${P}/preview`]: { ok: true, status: 200, data: diff } } });
  await cancel.ctl.show('skills');
  click(rowOf(cancel.host, id).querySelector('[data-skill-update]'));
  await settle();
  await action(cancel.modal, 'Cancel')();
  assert.deepEqual(cancel.writes().at(-1), ['DELETE', '/api/skills/import/abcdefabcdefabcd', undefined]);
  assert.equal(cancel.calls.filter(([meth, p]) => meth === 'GET' && p === '/api/skills').length, 2, 'the check set the badge: the catalog is read again');
  // The dialog's own Close (app.js's `afterClose`) is Cancel: the stage goes and the catalog is read again.
  const shut = mount({ over: { [`POST ${P}/preview`]: { ok: true, status: 200, data: diff } } });
  let afterClose = null;
  shut.modal.afterClose = (fn) => { afterClose = fn; };
  await shut.ctl.show('skills');
  click(rowOf(shut.host, id).querySelector('[data-skill-update]'));
  await settle();
  assert.equal(shut.modal.opened.title, 'Update release-notes');
  await afterClose();
  assert.deepEqual(shut.writes().at(-1), ['DELETE', '/api/skills/import/abcdefabcdefabcd', undefined]);
  assert.equal(shut.calls.filter(([meth, p]) => meth === 'GET' && p === '/api/skills').length, 2, 'the row\'s badge is read again');
  const bad = mount({ over: { [`POST ${P}/preview`]: { ok: true, status: 200, data: { ...diff, inspection: { ...ins, problems: ['more than 300 files'] } } } } });
  await bad.ctl.show('skills');
  click(rowOf(bad.host, id).querySelector('[data-skill-update]'));
  await settle();
  assert.equal(bad.modal.opened.body.querySelector('.sk-problem').textContent, 'more than 300 files');
  await action(bad.modal, 'Update')();
  assert.equal(bad.modal.opened.body.querySelector('.form-msg.err').textContent, 'This update cannot be applied: see the problems above.');
  assert.equal(bad.writes().filter(([, p]) => p === P).length, 0);
  const no = mount({ over: { [`POST ${P}/preview`]: { ok: true, status: 200, data: diff },
    [`POST ${P}`]: { ok: false, status: 409, data: { error: 'the skill changed since this update was checked: check for updates again' } } } });
  await no.ctl.show('skills');
  click(rowOf(no.host, id).querySelector('[data-skill-update]'));
  await settle();
  await action(no.modal, 'Update')();
  assert.equal(no.modal.opened.title, 'Update release-notes', 'a refused Update keeps its modal open');
  assert.equal(no.modal.opened.body.querySelector('.form-msg.err').textContent, 'the skill changed since this update was checked: check for updates again');
  const refused = mount({ over: { [`POST ${P}/preview`]: { ok: false, status: 409, data: { error: 'a pasted skill has no origin: import it again to change it' } } } });
  await refused.ctl.show('skills');
  click(rowOf(refused.host, id).querySelector('[data-skill-update]'));
  await settle();
  assert.equal(refused.modal.opened, null);
  assert.equal(refused.host.querySelector('.form-msg.err').textContent, 'a pasted skill has no origin: import it again to change it');
});

test('Remove (library): the confirm names the sets it leaves; DELETE /api/skills/:id; a declined confirm writes nothing', async () => {
  const m = mount();
  await m.ctl.show('skills');
  click(rowOf(m.host, 'skill:library:release-notes').querySelector('[data-skill-delete]'));
  await settle();
  assert.equal(m.confirms[0].message, 'Remove release-notes from worca? It leaves Billing, General. Its files go from the library.');
  assert.equal(m.confirms[0].danger, true);
  assert.deepEqual(m.writes(), [['DELETE', '/api/skills/skill%3Alibrary%3Arelease-notes', undefined]]);
  const n = mount({ answer: async () => false });
  await n.ctl.show('skills');
  click(rowOf(n.host, 'skill:library:frontend-design').querySelector('[data-skill-delete]'));
  await settle();
  assert.equal(n.confirms[0].message, 'Remove frontend-design from worca? Its files go from the library.');
  assert.deepEqual(n.writes(), []);
});

test('Check for updates: one check per skill at a time, said on the page; leaving the Skills view drops its answer; Update posts once and reads an open SKILL.md again', async () => {
  const id = 'skill:library:release-notes';
  const P = `/api/skills/${encodeURIComponent(id)}/update`;
  const MDP = `/api/skills/${encodeURIComponent(id)}/skill-md`;
  const ins = { files: [{ path: 'SKILL.md', bytes: 2048 }], bytes: 2048, scripts: [], shellBlocks: 0, findings: [], problems: [] };
  const diff = { ok: true, status: 200, data: { stage: 'abcdefabcdefabcd', added: [], removed: [], changed: ['SKILL.md'], inspection: ins } };
  let land;
  const m = mount({ over: { [`POST ${P}/preview`]: new Promise((r) => { land = () => r(diff); }) } });
  await m.ctl.show('skills');
  click(rowOf(m.host, id).querySelector('[data-skill-md]'));
  await settle();
  click(rowOf(m.host, id).querySelector('[data-skill-update]'));
  click(rowOf(m.host, id).querySelector('[data-skill-update]'));
  await settle();
  assert.equal(m.writes().filter(([, p]) => p === `${P}/preview`).length, 1, 'a second click waits for the first check');
  assert.equal(m.host.querySelector('.form-msg').textContent, 'Checking release-notes for updates…');
  land();
  await settle();
  assert.equal(m.modal.opened.title, 'Update release-notes');
  assert.equal(m.host.querySelector('.form-msg').textContent, '');
  const update = action(m.modal, 'Update');
  await Promise.all([update(), update()]);
  await settle();
  assert.equal(m.writes().filter(([, p]) => p === P).length, 1, 'Update posts the stage once');
  assert.equal(m.calls.filter(([meth, p]) => meth === 'GET' && p === MDP).length, 2, 'the open drawer reads the updated SKILL.md');
  assert.equal(rowOf(m.host, id).querySelector('.sk-drawer pre').textContent, MD);
  let late;
  const left = mount({ over: { [`POST ${P}/preview`]: new Promise((r) => { late = () => r(diff); }) } });
  await left.ctl.show('skills');
  click(rowOf(left.host, id).querySelector('[data-skill-update]'));
  await settle();
  await left.ctl.show('servers');
  late();
  await settle();
  assert.equal(left.modal.opened, null, 'nothing opens over another view');
  assert.deepEqual(left.writes().at(-1), ['DELETE', '/api/skills/import/abcdefabcdefabcd', undefined]);
});

// ── Task 5: the set detail's Skills section ─────────────────────────────────
const SM = (o) => ({ source: 'library', sourceLabel: 'Imported', description: '', enabled: true, valid: true, problems: [], scripts: [],
  shellBlocks: 0, pluginRootRefs: false, reason: null, problem: null, ...o });
const SET_VIEWS = {
  billing: { set: { id: 'billing', name: 'Billing', group: 'set', greyed: false, home: null, usedBy: [{ key: 'billing-1a2b3c4d', name: 'billing' }],
    pluginName: 'billing', renamedPlugin: false }, members: [], skills: [
    SM({ skillId: 'skill:library:release-notes', name: 'release-notes', qualifiedName: 'billing:release-notes', description: 'Draft release notes',
      files: 4, scripts: ['scripts/collect.sh'], shellBlocks: 2 }),
    SM({ skillId: 'skill:library:db-migrations', name: 'db-migrations', qualifiedName: 'billing:db-migrations', enabled: false, reason: 'off', files: 7,
      scripts: ['scripts/plan.py', 'scripts/apply.mjs'], shellBlocks: 1 }),
    SM({ skillId: 'skill:plugin:graphify/graphify', name: 'graphify', qualifiedName: 'billing:graphify', source: 'plugin', sourceLabel: 'graphify',
      reason: 'plugin-disabled', problem: 'plugin disabled', files: 9 }),
    SM({ skillId: 'skill:plugin:acme/broken', name: 'broken', qualifiedName: 'billing:broken', source: 'plugin', sourceLabel: 'acme', valid: false,
      problems: ['SKILL.md has no frontmatter'], reason: 'invalid-skill', problem: 'invalid' }),
    SM({ skillId: 'skill:plugin:office/pdf-tools', name: 'pdf-tools', qualifiedName: 'billing:pdf-tools', source: 'plugin', sourceLabel: 'office',
      pluginRootRefs: true, hooks: true }),
    // As views.mjs sends a member whose skill left the catalog: valid false, no problems, nothing counted.
    SM({ skillId: 'skill:library:gone', name: 'gone', qualifiedName: 'billing:gone', valid: false, files: 0, reason: 'missing-skill',
      problem: 'the skill is no longer installed' }),
  ] },
  shop: { set: { id: 'shop', name: 'Shop', group: 'set', greyed: false, home: null, usedBy: [], pluginName: 'shop-set', renamedPlugin: true },
    members: [], skills: [] },
  'team-acme-platform-9333': { set: { id: 'team-acme-platform-9333', name: 'Team · acme/platform', group: 'team', greyed: false, home: 'acme/platform',
    usedBy: [{ key: 'billing-1a2b3c4d', name: 'billing' }], pluginName: 'team-platfor', renamedPlugin: false }, members: [], skills: [
    SM({ skillId: 'skill:plugin:acme/deploy-checklist', name: 'deploy-checklist', qualifiedName: 'team-platfor:deploy-checklist', source: 'plugin',
      sourceLabel: 'acme', enabled: false, reason: 'needs-consent', team: { consented: false } }),
    SM({ skillId: 'skill:plugin:acme/release-check', name: 'release-check', qualifiedName: 'team-platfor:release-check', source: 'plugin',
      sourceLabel: 'acme', team: { consented: true } }),
    SM({ skillId: 'skill:plugin:acme/lint-rules', name: 'lint-rules', qualifiedName: 'team-platfor:lint-rules', source: 'plugin',
      sourceLabel: 'acme', enabled: false, reason: 'plugin-disabled', problem: 'plugin disabled', team: { consented: false } }),
  ] },
  'team-acme-other-5095': { set: { id: 'team-acme-other-5095', name: 'Team · acme/other', group: 'team', greyed: false, home: 'acme/other',
    usedBy: [], pluginName: 'team-other', renamedPlugin: false }, members: [], skills: [] },
  legacy: { set: { id: 'legacy', name: 'Legacy', group: 'set', greyed: false, home: null, usedBy: [] }, members: [] },
};
const cardOf = (host, id) => host.querySelector(`.sk-member[data-skill="${id}"]`);

test('the set list counts skills beside servers (nothing when a set has none)', async () => {
  const { host, ctl } = mount({ setViews: SET_VIEWS });
  await ctl.show('sets/billing');
  assert.deepEqual([...host.querySelectorAll('.mcp-setrow small')].map((s) => s.textContent), [
    '1 server · 1 skill · Ask Worca · 1 project', '0 servers · 2 skills · billing', '2 servers · no projects', '0 servers · 1 skill · billing']);
});

test('a user set: the prefix hint, skill cards (qualified name, source, counts, Windows badge, state line); the switch and Remove write /api/sets', async () => {
  const id = 'skill:library:release-notes';
  const path = `/api/sets/billing/skills/${encodeURIComponent(id)}`;
  const m = mount({ setViews: SET_VIEWS });
  await m.ctl.show('sets/billing');
  assert.equal(m.host.querySelector('.mcp-set .sk-prefix').textContent, 'skills load as billing:');
  assert.equal(m.host.querySelector('.sk-head .hint').textContent, 'agents call /billing:<name> · no values, no secrets, no Test');
  assert.ok(m.host.querySelector('.sk-head [data-act="add-skill"]'));
  const cards = [...m.host.querySelectorAll('.sk-member')].map((c) => [c.querySelector('b.mono').textContent, c.querySelector('.pl-head .badge').textContent,
    c.querySelector('.mcp-state').textContent, c.querySelector('.mcp-state').className]);
  assert.deepEqual(cards, [
    ['billing:release-notes', 'Imported', 'in runs', 'mcp-state hint ok'],
    ['billing:db-migrations', 'Imported', 'off', 'mcp-state hint'],
    ['billing:graphify', 'graphify', 'plugin disabled', 'mcp-state hint warn'],
    ['billing:broken', 'acme', 'invalid: SKILL.md has no frontmatter', 'mcp-state hint err'],
    ['billing:pdf-tools', 'office', 'in runs · references its plugin’s other files — may not work from a set', 'mcp-state hint warn'],
    ['billing:gone', 'Imported', 'the skill is no longer installed', 'mcp-state hint err'],
  ]);
  const gone = cardOf(m.host, 'skill:library:gone');
  assert.deepEqual([gone.querySelector('[data-skill-md]'), gone.querySelector('.sk-facts')], [null, null], 'nothing to count or read');
  assert.equal(gone.querySelector('[data-skill-toggle]').disabled, true, 'a skill no longer installed cannot be switched (P2 answers 404), only removed');
  assert.ok(cardOf(m.host, 'skill:plugin:graphify/graphify').querySelector('.badge.violet'), 'a plugin skill wears the violet plugin badge');
  assert.equal(cardOf(m.host, 'skill:plugin:office/pdf-tools').querySelector('.sk-hooks').textContent,
    "declares hooks they run shell commands outside Worca's guardrails when the skill is used", 'the badge, then the rest of SKILL_HOOKS_TEXT');
  assert.equal(cardOf(m.host, id).querySelector('.sk-hooks'), null);
  assert.equal(cardOf(m.host, id).querySelector('.sk-facts').textContent, '4 files · 1 script · 2 shell blocksshell scripts — Windows');
  assert.equal(cardOf(m.host, 'skill:library:db-migrations').querySelector('.sk-facts').textContent, '7 files · 2 scripts · 1 shell block');
  assert.deepEqual([...cardOf(m.host, id).querySelectorAll('.pl-head button')].map((b) => b.textContent), ['View SKILL.md', 'Remove']);
  const sw = cardOf(m.host, id).querySelector('[data-skill-toggle]');
  assert.equal(sw.getAttribute('aria-label'), 'Use billing:release-notes in Billing');
  sw.checked = false;
  change(sw);
  await settle();
  click(cardOf(m.host, 'skill:library:db-migrations').querySelector('[data-skill-remove]'));
  await settle();
  assert.equal(m.confirms[0].message, 'Remove billing:db-migrations from Billing? Runs and chats that use Billing stop getting it.');
  assert.deepEqual(m.writes(), [['PUT', path, { enabled: false }],
    ['DELETE', `/api/sets/billing/skills/${encodeURIComponent('skill:library:db-migrations')}`, undefined]]);
  const refused = mount({ setViews: SET_VIEWS, over: { [`PUT ${path}`]: { ok: false, status: 404, data: { error: 'skill not found' } } } });
  await refused.ctl.show('sets/billing');
  const sw2 = cardOf(refused.host, id).querySelector('[data-skill-toggle]');
  sw2.checked = false;
  change(sw2);
  await settle();
  assert.equal(sw2.checked, true, 'the switch goes back');
  assert.equal(refused.host.querySelector('.form-msg.err').textContent, 'skill not found');
});

test('a renamed prefix badge; an empty set; a Team set (no Add, no Remove, the never-consented switch off with the checklist line); no skills key, no section', async () => {
  const m = mount({ setViews: SET_VIEWS });
  await m.ctl.show('sets/shop');
  assert.equal(m.host.querySelector('.sk-prefix .badge.amber').textContent, 'loads as shop-set:');
  assert.equal(m.host.querySelector('.sk-prefix .hint').textContent, '— a Claude Code plugin named shop is installed');
  assert.equal(m.host.querySelector('.sk-head + .hist-empty').textContent, 'No skills in this set yet.');
  await m.ctl.show('sets/team-acme-platform-9333');
  assert.equal(m.host.querySelector('[data-act="add-skill"]'), null);
  assert.equal(m.host.querySelector('[data-skill-remove]'), null);
  const off = cardOf(m.host, 'skill:plugin:acme/deploy-checklist');
  assert.equal(off.querySelector('[data-skill-toggle]').disabled, true);
  assert.equal(off.querySelector('.mcp-state').textContent, 'turn on in the team checklist');
  assert.equal(cardOf(m.host, 'skill:plugin:acme/release-check').querySelector('[data-skill-toggle]').disabled, false);
  assert.equal(cardOf(m.host, 'skill:plugin:acme/lint-rules').querySelector('.mcp-state').textContent, 'plugin disabled',
    'the reason that keeps it out of runs first, as in the Skills in runs table');
  assert.equal(m.host.querySelector('.mcp-set .sk-prefix').textContent, 'skills load as team-platfor:');
  await m.ctl.show('sets/team-acme-other-5095');
  assert.equal(m.host.querySelector('.sk-head + .hist-empty').textContent,
    'No skill this team policy requires is installed here — its setup checklist lists what it requires.',
    'a required plugin not installed yet brings no skill: the policy may still require some');
  await m.ctl.show('sets/legacy');
  assert.equal(m.host.querySelector('.sk-head'), null);
  assert.equal(m.host.querySelector('.sk-prefix'), null);
});

test('a skill switch and View SKILL.md keep their focus through the repaints they cause', async () => {
  const { host, ctl } = mount({ setViews: SET_VIEWS });
  await ctl.show('sets/billing');
  const sw = cardOf(host, 'skill:library:release-notes').querySelector('[data-skill-toggle]');
  sw.focus();
  sw.checked = false;
  change(sw);
  await settle();
  const again = cardOf(host, 'skill:library:release-notes').querySelector('[data-skill-toggle]');
  assert.notEqual(again, sw, 'the pane was repainted');
  assert.equal(doc.activeElement, again);
  const md = cardOf(host, 'skill:library:release-notes').querySelector('[data-skill-md]');
  md.focus();
  click(md);
  await settle();
  const shown = cardOf(host, 'skill:library:release-notes').querySelector('[data-skill-md]');
  assert.notEqual(shown, md, 'the pane was repainted');
  assert.deepEqual([shown.textContent, doc.activeElement === shown], ['Hide SKILL.md', true]);
});

// ── Task 6: + Add skill ──────────────────────────────────────────────────────
const CATALOG = [...SKILLS.slice(0, 5), skill({ id: 'skill:plugin:acme/release-notes', source: 'plugin', plugin: 'acme', name: 'release-notes',
  code: '3f9a1c2' }), SKILLS[5]];
const pickRows = (modal) => [...modal.opened.body.querySelectorAll('.sk-pick-row')].map((r) => [r.querySelector('.mono').textContent,
  r.querySelector('.badge').textContent, r.querySelector('input').disabled, r.querySelector('.hint').textContent, r.querySelector('.hint').className]);

test('+ Add skill: the catalog as a radio list — the set\'s own skills and names greyed, invalid greyed, plugin disabled noted; Add PUTs it on', async () => {
  const m = mount({ setViews: SET_VIEWS, skills: CATALOG });
  await m.ctl.show('sets/billing');
  click(m.host.querySelector('[data-act="add-skill"]'));
  await settle();
  assert.equal(m.modal.opened.title, 'Add skill to Billing');
  assert.deepEqual(pickRows(m.modal), [
    ['db-migrations', 'Imported', true, 'already in this set', 'hint'],
    ['frontend-design', 'Imported', false, '1 file · 0 scripts · 0 shell blocks', 'hint'],
    ['release-notes', 'Imported', true, 'already in this set', 'hint'],
    ['broken', 'acme', true, 'already in this set', 'hint'],
    ['deploy-checklist', 'acme', false, '5 files · 2 scripts · 1 shell block', 'hint'],
    ['release-notes', 'acme', true, 'a skill named release-notes is already in this set', 'hint'],
    ['graphify', 'graphify', true, 'already in this set', 'hint'],
  ]);
  assert.equal(m.modal.opened.body.querySelector('input[name="sk-pick"]:checked').value, 'skill:library:frontend-design', 'the first free skill is picked');
  m.modal.opened.body.querySelector('input[value="skill:plugin:acme/deploy-checklist"]').checked = true;
  await action(m.modal, 'Add')();
  await settle();
  assert.deepEqual(m.writes(), [['PUT', `/api/sets/billing/skills/${encodeURIComponent('skill:plugin:acme/deploy-checklist')}`, { enabled: true }]]);
  assert.equal(m.modal.opened, null);
  assert.equal(m.calls.filter(([meth, p]) => meth === 'GET' && p === '/api/mcp/sets/billing').length, 2, 'the set is read again');
  const s = mount({ setViews: SET_VIEWS, skills: CATALOG });
  await s.ctl.show('sets/shop');
  click(s.host.querySelector('[data-act="add-skill"]'));
  await settle();
  const rows = pickRows(s.modal);
  assert.deepEqual(rows[3], ['broken', 'acme', true, 'invalid', 'hint err']);
  assert.deepEqual(rows[6], ['graphify', 'graphify', false, 'plugin disabled', 'hint warn']);
});

test('+ Add skill: a refusal shows in the modal; an empty catalog and a set holding every skill say so', async () => {
  const id = 'skill:library:frontend-design';
  const m = mount({ setViews: SET_VIEWS, skills: CATALOG,
    over: { [`PUT /api/sets/billing/skills/${encodeURIComponent(id)}`]: { ok: false, status: 409, data: { error: 'a skill named frontend-design is already in this set' } } } });
  await m.ctl.show('sets/billing');
  click(m.host.querySelector('[data-act="add-skill"]'));
  await settle();
  await action(m.modal, 'Add')();
  assert.ok(m.modal.opened);
  assert.equal(m.modal.opened.body.querySelector('.form-msg.err').textContent, 'a skill named frontend-design is already in this set');
  const e = mount({ setViews: SET_VIEWS, skills: [] });
  await e.ctl.show('sets/shop');
  click(e.host.querySelector('[data-act="add-skill"]'));
  await settle();
  assert.equal(e.modal.opened.body.textContent, 'No skills yet. Install a plugin that ships some, or Import skill in Connectors › Skills.');
  assert.deepEqual(e.modal.opened.actions.map(([l]) => l), ['Close']);
  const full = mount({ setViews: SET_VIEWS, skills: [SKILLS[0], SKILLS[2]] });
  await full.ctl.show('sets/billing');
  click(full.host.querySelector('[data-act="add-skill"]'));
  await settle();
  assert.equal(full.modal.opened.body.textContent, 'Every skill in the catalog is in this set already.');
  const down = mount({ setViews: SET_VIEWS, over: { 'GET /api/skills': { ok: false, status: 500, data: { error: 'boom: catalog read failed' } } } });
  await down.ctl.show('sets/shop');
  click(down.host.querySelector('[data-act="add-skill"]'));
  await settle();
  assert.equal(down.modal.opened.body.textContent, 'boom: catalog read failed', 'a catalog that could not be read never reads "No skills yet"');
});
