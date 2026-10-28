// test/ui-git-free.test.mjs — Needs git inside the action's own dialog, the GitHub repository field, and the four
// git-free surfaces still on screen without git (P6 Task 12).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderEnableDialogBody } from '../ui/public/team-metrics-surfaces.mjs';
import { renderPolicyEnableDialogBody, renderProjectTpCell, projectTpSummary } from '../ui/public/team-policy-view.mjs';
import { renderInstallConsent } from '../ui/public/plugins-view.mjs';
import { renderMarketplaceCard } from '../ui/public/marketplace/marketplaces-view.mjs';
import { openSkillImport } from '../ui/public/skill-import.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const doc = new JSDOM('<!doctype html><body></body>').window.document;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

test('Set up team metrics / team policy: a GitHub repository field when the repo is unknown, Needs git for another host', () => {
  for (const [render, cls] of [[renderEnableDialogBody, 'tm'], [renderPolicyEnableDialogBody, 'tp']]) {
    const base = { project: { name: 'billing' }, origin: 'github.com/acme/billing', candidates: [] };
    const plain = render(base, { doc });
    assert.deepEqual([plain.querySelector(`.${cls}-repo`), plain.querySelector('.pl-needs-git'), plain.querySelector('.sub').textContent],
      [null, null, 'for billing · origin github.com/acme/billing']);
    const ask = render({ ...base, origin: null, repoInput: true, repo: 'acme/bi' }, { doc });
    const input = ask.querySelector(`input.${cls}-repo`);
    assert.deepEqual([input.placeholder, input.value, ask.querySelector(`label[for="${input.id}"]`).textContent, ask.querySelector('.sub').textContent],
      ['owner/name', 'acme/bi', 'GitHub repository', 'for billing']);
    const gl = render({ ...base, origin: 'gitlab.com/acme/billing', needsGit: true }, { doc });
    assert.equal(gl.querySelector('.sub').textContent, 'for billing · origin gitlab.com/acme/billing · Needs git');
    assert.equal(gl.querySelector('.sub .pl-needs-git').className, 'badge waiting pl-needs-git');
  }
});

test('Marketplace card: Needs git in place of Refresh; the consent dialog names it on the source line', () => {
  const gl = renderMarketplaceCard(doc, { id: 'gl', url: 'https://gitlab.com/a/m', name: 'GL', plugins: [], lastSync: null, needsGit: true });
  const hub = renderMarketplaceCard(doc, { id: 'gh', url: 'https://github.com/a/m', name: 'GH', plugins: [], lastSync: null });
  assert.deepEqual([gl.querySelector('.mk-mkt-refresh'), gl.querySelector('.pl-needs-git').textContent], [null, 'Needs git']);
  assert.deepEqual([!!hub.querySelector('.mk-mkt-refresh'), hub.querySelector('.pl-needs-git')], [true, null]);
  const consent = renderInstallConsent({ repoUrl: 'https://gitlab.com/a/m', sha: 'a'.repeat(40) }, {}, { doc, needsGit: true });
  assert.equal(consent.querySelector('.pl-consent-src .pl-needs-git').textContent, 'Needs git');
  // The source line is .mono (an ancestor rule sets the monospace font): the chip keeps the UI font every badge has.
  assert.ok(readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8').includes('\n.pl-consent-src .pl-needs-git{font-family:var(--sans);}\n'), 'style.css: .pl-consent-src .pl-needs-git{font-family:var(--sans);}');
});

test('Import skill: a 409 GIT_MISSING preview says Needs git inside the dialog; Git URL stays offered with data-git off', async () => {
  doc.documentElement.dataset.git = 'off';
  try {
    const modal = { opened: null, open(title, body, actions) { this.opened = { title, body, actions }; }, close() { this.opened = null; } };
    const api = async (method, path) => (path === '/api/skills/import/preview'
      ? { ok: false, status: 409, data: { error: 'git is not installed on this machine', code: 'GIT_MISSING' } } : { ok: true, status: 200, data: {} });
    openSkillImport({ api, modal, doc, onDone: () => {} });
    const gitBtn = [...modal.opened.body.querySelectorAll('.seg button')].find((b) => b.textContent === 'Git URL');
    gitBtn.click();
    const url = modal.opened.body.querySelector('[data-imp="url"]');
    url.value = 'https://gitlab.com/acme/skills';
    url.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await modal.opened.actions.find(([l]) => l === 'Preview')[2]();
    await settle();
    assert.equal(modal.opened.body.querySelector('.form-msg').textContent, 'Needs git');
  } finally {
    delete doc.documentElement.dataset.git;
  }
});

test('index.html: Marketplace, Team metrics and Team policy carry no data-needs-git (U2a)', () => {
  const page = new JSDOM(readFileSync(htmlPath, 'utf8')).window.document;
  for (const sel of ['[data-view="marketplace"]', '#mk-root', '[data-view="team-metrics"]', '[data-view="team-policy"]']) {
    const node = page.querySelector(sel);
    assert.ok(node, sel);
    assert.equal(node.closest('[data-needs-git]'), null, sel);
  }
});

async function boot(handlers, { level = null } = {}) {
  const html = readFileSync(htmlPath, 'utf8');
  const shell = level ? html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`) : html;
  const dom = trackDom(new JSDOM(shell, { url: 'http://localhost:4319/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    const u = String(url);
    for (const [prefix, fn] of Object.entries(handlers)) if (u.includes(prefix)) return fn(u, opts || {});
    if (u.includes('/api/projects')) return json({ projects: [] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement', 'Element']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  await import(`${pathToFileURL(appPath).href}?b=${Date.now()}_${Math.random()}`);
  await settle();
  return window.document;
}
const actions = (d) => [...d.querySelectorAll('#plugin-modal-actions button')].map((b) => b.textContent);
const GIT_MISSING = { error: 'git is not installed on this machine', code: 'GIT_MISSING' };

test('app: Add marketplace 409 → the chip inside the Add dialog; Update 409 → the review card says Needs git; consent → Cancel only', async () => {
  const MKT = { id: 'gl', url: 'https://gitlab.com/a/m', name: 'GL', builtin: false, needsGit: true, warnings: [],
    lastSync: { sha: 'a'.repeat(40), at: '2026-10-01T00:00:00.000Z' }, plugins: [{ name: 'gl-plugin', subdir: 'p', inventory: {} }] };
  const d = await boot({
    '/api/marketplaces/refresh': () => json({ ok: true, marketplaces: [MKT] }),
    '/api/marketplaces': (u, o) => ((o.method || 'GET') === 'POST' ? json(GIT_MISSING, 409) : json({ marketplaces: [MKT] })),
    '/api/plugins/alpha/update': () => json(GIT_MISSING, 409),
    '/api/plugins': () => json({ plugins: [{ name: 'alpha', version: '1.0.0', enabled: true, contributions: {}, latest: { version: '1.1.0', sha: 'b'.repeat(40), marketplace: 'gl', access: [] }, setup: { ok: true, missing: [], noProfiles: [] }, notes: [] }], orphans: [] }),
    '/api/chat/status': () => json({ channels: [] }),
    '/api/policy/scopes': () => json({ projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false }),
  });
  d.defaultView.location.hash = '#marketplace';
  await settle();
  d.querySelector('#mk-root .mk-head-actions .mk-add-mkt').click();
  await settle();
  const url = d.getElementById('mk-add-url');
  url.value = 'https://gitlab.com/a/m';
  url.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  d.querySelector('#mk-dialog .mk-add-primary').click();
  await settle();
  assert.equal(d.querySelector('#mk-dialog .pl-needs-git').textContent, 'Needs git');
  assert.equal(d.getElementById('mk-dialog').closest('[data-needs-git]'), null);
  d.querySelector('#mk-dialog .mk-dlg-close').click();
  await settle();
  assert.equal(d.getElementById('plugins-msg').textContent, '');
  d.defaultView.location.hash = '#marketplace/installed';
  await settle();
  d.querySelector('section.mk-attention li.mk-row[data-name="alpha"] [data-act="update"]').click();
  await settle();
  await settle();
  assert.deepEqual([d.getElementById('mk-sheet').dataset.mode, d.querySelector('#mk-sheet .mk-upd[data-name="alpha"] .pl-needs-git').textContent,
    d.getElementById('plugin-modal').classList.contains('hidden')], ['update', 'Needs git', true]);
  d.querySelector('#mk-sheet-host .mk-close').click();
  await settle();
  d.querySelector('button.mk-tile[data-key="gl/gl-plugin"]').click();
  await settle();
  assert.deepEqual([...d.querySelectorAll('#mk-sheet .mk-sheet-foot [data-act]')].map((b) => b.textContent), ['Cancel']);
});

test('app: Set up team metrics posts the typed repo; Needs git disables Create branch and enable', async () => {
  const posts = [];
  const status = (o) => ({ key: 'k1', name: 'billing', slug: 'billing', hasOrigin: null, enabled: false, record: true, recordsLocally: false, ...o });
  let proj = status({ repoInput: true });
  const d = await boot({
    '/api/team-metrics/scopes': () => json({ projects: [proj], workspaces: [], scopes: { projects: [], workspaces: [] }, anyEnabled: false }),
    '/api/projects/k1/team-metrics/enable': (u, o) => { posts.push(JSON.parse(o.body)); return json({ action: 'created', slug: 'acme/billing', status: proj }); },
  });
  const open = async () => {
    const cell = d.createElement('div'); cell.className = 'tm-cell'; cell.dataset.key = 'k1';
    const b = d.createElement('button'); b.className = 'tm-enable'; cell.appendChild(b);
    d.getElementById('proj-detail').replaceChildren(cell);
    b.click();
    await settle();
  };
  await open();
  const input = d.querySelector('#plugin-modal-body input.tm-repo');
  input.value = 'acme/billing';
  input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  d.querySelector('#plugin-modal .tm-enable-submit').click();
  await settle();
  assert.deepEqual(posts, [{ mode: 'here', attribution: 'git-user', repo: 'acme/billing' }]);
  proj = status({ hasOrigin: true, needsGit: true, origin: 'gitlab.com/acme/billing' });
  await open();
  assert.equal(d.querySelector('#plugin-modal .tm-enable-submit').disabled, true);
  assert.equal(d.querySelector('#plugin-modal-body .sub .pl-needs-git').textContent, 'Needs git');
});

// ---- Killers (refiner lane D): rules the six tests above leave unpinned ----
import { createMcpView } from '../ui/public/mcp-view.mjs';

test('Marketplace card: the chip takes the refresh slot (after Browse, before ⋯), as span.badge.waiting', () => {
  const card = renderMarketplaceCard(doc, { id: 'gl', url: 'https://gitlab.com/a/m', name: 'GL', plugins: [], lastSync: null, needsGit: true });
  assert.deepEqual([...card.querySelector('.mk-mkt-actions').children].map((c) => c.className),
    ['btn btn-sm mk-mkt-browse', 'badge waiting pl-needs-git', 'btn btn-sm btn-quiet btn-icon mk-mkt-more']);
});

test('app: consent names Needs git on the source line; the Add dialog\'s chip is one, and typing removes it; a 409 without GIT_MISSING stays a message', async () => {
  const MKT = { id: 'gl', url: 'https://gitlab.com/a/m', name: 'GL', builtin: false, needsGit: true, warnings: [],
    lastSync: { sha: 'a'.repeat(40), at: '2026-10-01T00:00:00.000Z' }, plugins: [{ name: 'gl-plugin', subdir: 'p', inventory: {} }] };
  const d = await boot({
    '/api/marketplaces/refresh': () => json({ ok: true, marketplaces: [MKT] }),
    '/api/marketplaces': (u, o) => ((o.method || 'GET') === 'POST' ? json(GIT_MISSING, 409) : json({ marketplaces: [MKT] })),
    '/api/plugins/beta/update': () => json({ error: 'an update is already running' }, 409),
    '/api/plugins': () => json({ plugins: [{ name: 'beta', version: '1.0.0', enabled: true, contributions: {}, latest: { version: '1.1.0', sha: 'b'.repeat(40), marketplace: 'gl', access: [] }, setup: { ok: true, missing: [], noProfiles: [] }, notes: [] }], orphans: [] }),
    '/api/chat/status': () => json({ channels: [] }),
    '/api/policy/scopes': () => json({ projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false }),
  });
  d.defaultView.location.hash = '#marketplace';
  await settle();
  d.querySelector('button.mk-tile[data-key="gl/gl-plugin"]').click();
  await settle();
  assert.equal(d.querySelector('#mk-sheet .mk-src .pl-needs-git').textContent, 'Needs git');
  d.querySelector('#mk-sheet .mk-close').click();
  d.querySelector('#mk-root .mk-head-actions .mk-add-mkt').click();
  await settle();
  const url = d.getElementById('mk-add-url');
  url.value = 'https://gitlab.com/a/m';
  url.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  d.querySelector('#mk-dialog .mk-add-primary').click();
  await settle();
  d.querySelector('#mk-dialog .mk-add-primary').click();
  await settle();
  assert.equal(d.querySelectorAll('#mk-dialog .pl-needs-git').length, 1);
  url.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  assert.equal(d.querySelector('#mk-dialog .pl-needs-git'), null);
  d.querySelector('#mk-dialog .mk-dlg-close').click();
  await settle();
  d.defaultView.location.hash = '#marketplace/installed';
  await settle();
  d.querySelector('section.mk-attention li.mk-row[data-name="beta"] [data-act="update"]').click();
  await settle();
  await settle();
  assert.equal(d.getElementById('plugin-modal').classList.contains('hidden'), true, 'another 409 is a toast, no dialog');
  assert.equal(d.querySelector('#toasts > .toast.err .tt').textContent, 'an update is already running');
});

test('app: a required plugin\'s Update 409 → the Update dialog says Needs git, and Update all waits for it', async () => {
  const req = (name) => ({ name, state: 'outdated', homes: [], marketplace: '' });
  const d = await boot({
    '/api/policy/scopes': () => json({ projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [req('alpha'), req('beta')], blockedPlugins: [], anyEnabled: false }),
    '/api/plugins/alpha/update': () => json(GIT_MISSING, 409),
    '/api/plugins/beta/update': () => json(GIT_MISSING, 409),
  });
  const all = d.createElement('button'); all.className = 'pl-policy-all';
  d.querySelector('section[data-view="team-policy"]').append(all);
  all.click();
  await settle();
  assert.deepEqual([d.getElementById('plugin-modal-title').textContent, d.querySelector('#plugin-modal-body .pl-needs-git').textContent, actions(d)], ['Update alpha', 'Needs git', []]);
  d.getElementById('plugin-modal-close').click();
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(d.getElementById('plugin-modal-title').textContent, 'Update beta');
  d.getElementById('plugin-modal-close').click();
  await new Promise((r) => setTimeout(r, 450));
});

test('app: team metrics with git posts no repo; the typed repo survives a repaint and is trimmed', async () => {
  const posts = [];
  const status = (o) => ({ key: 'k1', name: 'billing', slug: 'billing', hasOrigin: null, enabled: false, record: true, recordsLocally: false, ...o });
  let proj = status({ hasOrigin: true, origin: 'github.com/acme/billing' });
  const d = await boot({
    '/api/team-metrics/scopes': () => json({ projects: [proj], workspaces: [], scopes: { projects: [], workspaces: [] }, anyEnabled: false }),
    '/api/projects/k1/team-metrics/enable': (u, o) => { posts.push(JSON.parse(o.body)); return json({ action: 'created', slug: 'acme/billing', status: proj }); },
  });
  const open = async () => {
    const cell = d.createElement('div'); cell.className = 'tm-cell'; cell.dataset.key = 'k1';
    const b = d.createElement('button'); b.className = 'tm-enable'; cell.appendChild(b);
    d.getElementById('proj-detail').replaceChildren(cell);
    b.click();
    await settle();
  };
  await open();
  d.querySelector('#plugin-modal .tm-enable-submit').click();
  await settle();
  proj = status({ repoInput: true });
  await open();
  const typed = d.querySelector('#plugin-modal-body input.tm-repo');
  typed.value = ' acme/billing ';
  typed.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  for (const v of ['delegate', 'here']) {   // the "Where to record" radio repaints the body
    const r = d.querySelector(`#plugin-modal-body input[name="tm-where"][value="${v}"]`);
    r.checked = true;
    r.dispatchEvent(new d.defaultView.Event('change', { bubbles: true }));
  }
  assert.equal(d.querySelector('#plugin-modal-body input.tm-repo').value, ' acme/billing ');
  d.querySelector('#plugin-modal .tm-enable-submit').click();
  await settle();
  assert.deepEqual(posts, [{ mode: 'here', attribution: 'git-user' }, { mode: 'here', attribution: 'git-user', repo: 'acme/billing' }]);
});

test('app: Set up team policy posts the typed repo (kept across a repaint), none with git; Needs git disables its submit', async () => {
  const posts = [];
  const status = (o) => ({ key: 'k1', name: 'billing', slug: 'billing', hasOrigin: null, enabled: false, carries: false, ...o });
  let proj = status({ hasOrigin: true, origin: 'github.com/acme/billing' });
  const d = await boot({
    '/api/policy/scopes': () => json({ projects: [proj], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false }),
    '/api/projects/k1/policy/enable': (u, o) => { posts.push(JSON.parse(o.body)); return json({ action: 'joined', slug: 'acme/billing' }); },
  });
  const open = async () => {
    const cell = d.createElement('div'); cell.className = 'tp-cell'; cell.dataset.key = 'k1';
    const b = d.createElement('button'); b.className = 'tp-enable'; cell.appendChild(b);
    d.getElementById('proj-detail').replaceChildren(cell);
    b.click();
    await settle();
  };
  await open();
  d.querySelector('#plugin-modal .tp-enable-submit').click();
  await settle();
  proj = status({ repoInput: true });
  await open();
  const typed = d.querySelector('#plugin-modal-body input.tp-repo');
  typed.value = ' acme/billing ';
  typed.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
  for (const v of ['follow', 'here']) {
    const r = d.querySelector(`#plugin-modal-body input[name="tp-where"][value="${v}"]`);
    r.checked = true;
    r.dispatchEvent(new d.defaultView.Event('change', { bubbles: true }));
  }
  assert.equal(d.querySelector('#plugin-modal-body input.tp-repo').value, ' acme/billing ');
  d.querySelector('#plugin-modal .tp-enable-submit').click();
  await settle();
  assert.deepEqual(posts, [{ mode: 'here' }, { mode: 'here', repo: 'acme/billing' }]);
  proj = status({ hasOrigin: true, needsGit: true, origin: 'gitlab.com/acme/billing' });
  await open();
  assert.equal(d.querySelector('#plugin-modal .tp-enable-submit').disabled, true);
  assert.equal(d.querySelector('#plugin-modal-body .sub .pl-needs-git').textContent, 'Needs git');
});

test('Skills › Check for updates: a 409 GIT_MISSING opens Update <name> with the chip and Close; another 409 stays a message', async () => {
  const id = 'skill:library:release-notes';
  const skills = [{ id, name: 'release-notes', source: 'library', plugin: null, description: '', frontmatter: {}, files: 1, bytes: 900, scripts: [], shellBlocks: 0,
    code: null, pluginEnabled: true, valid: true, problems: [], inSets: [], updateAvailable: false, installedPluginClash: false,
    origin: { kind: 'git', url: 'https://gitlab.com/acme/skills', ref: 'main', subdir: 'release-notes' } }];
  for (const [answer, want] of [[{ ok: false, status: 409, data: GIT_MISSING }, ['Update release-notes', 'Needs git', 'badge waiting pl-needs-git', ['Close']]],
    [{ ok: false, status: 409, data: { error: 'a check is already running' } }, null]]) {
    const modal = { opened: null, open(title, body, acts) { this.opened = { title, body, actions: acts }; }, close() { this.opened = null; } };
    const said = [];
    const api = async (method, path) => {
      if (method === 'POST' && path.endsWith('/update/preview')) return answer;
      if (method === 'GET' && path === '/api/skills') return { ok: true, status: 200, data: { newer: false, skills } };
      if (method === 'GET' && path === '/api/mcp/sets') return { ok: true, status: 200, data: { newer: false, sets: [] } };
      return { ok: true, status: 200, data: {} };
    };
    const host = doc.createElement('section');
    doc.body.replaceChildren(host);
    const ctl = createMcpView({ host, api, navigate: () => {}, confirm: async () => true, modal, doc, notify: (n) => said.push(n) });
    await ctl.show('skills');
    host.querySelector(`.sk-row[data-skill="${id}"] [data-skill-update]`).dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
    await settle();
    if (want) assert.deepEqual([modal.opened.title, modal.opened.body.textContent, modal.opened.body.className, modal.opened.actions.map(([l]) => l)], want);
    else assert.deepEqual([modal.opened, said.length], [null, 1]);
  }
});

test('Import skill: Needs git is the chip (span.badge.waiting) in the message line', async () => {
  const modal = { opened: null, open(title, body, acts) { this.opened = { title, body, actions: acts }; }, close() { this.opened = null; } };
  const api = async (method, path) => (path === '/api/skills/import/preview' ? { ok: false, status: 409, data: GIT_MISSING } : { ok: true, status: 200, data: {} });
  openSkillImport({ api, modal, doc, onDone: () => {} });
  [...modal.opened.body.querySelectorAll('.seg button')].find((b) => b.textContent === 'Git URL').click();
  const url = modal.opened.body.querySelector('[data-imp="url"]');
  url.value = 'https://gitlab.com/acme/skills';
  url.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  await modal.opened.actions.find(([l]) => l === 'Preview')[2]();
  await settle();
  const m = modal.opened.body.querySelector('.form-msg');
  assert.deepEqual([m.className, m.querySelector('.pl-needs-git').className, m.textContent], ['form-msg', 'badge waiting pl-needs-git', 'Needs git']);
});

test('Import skill: a 409 without GIT_MISSING shows its own error', async () => {
  const modal = { opened: null, open(title, body, acts) { this.opened = { title, body, actions: acts }; }, close() { this.opened = null; } };
  const api = async (method, path) => (path === '/api/skills/import/preview'
    ? { ok: false, status: 409, data: { error: 'library.json is from a newer Worca' } } : { ok: true, status: 200, data: {} });
  openSkillImport({ api, modal, doc, onDone: () => {} });
  [...modal.opened.body.querySelectorAll('.seg button')].find((b) => b.textContent === 'Git URL').click();
  const url = modal.opened.body.querySelector('[data-imp="url"]');
  url.value = 'https://github.com/acme/skills';
  url.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  await modal.opened.actions.find(([l]) => l === 'Preview')[2]();
  await settle();
  assert.equal(modal.opened.body.querySelector('.form-msg').textContent, 'library.json is from a newer Worca');
});

test('app: a typed repository off GitHub answers 409 GIT_MISSING: both setup dialogs show the chip on their error line', async () => {
  const tm = { key: 'k1', name: 'billing', slug: 'billing', hasOrigin: null, enabled: false, record: true, recordsLocally: false, repoInput: true };
  const tp = { key: 'k1', name: 'billing', slug: 'billing', hasOrigin: null, enabled: false, carries: false, repoInput: true };
  const d = await boot({
    '/api/team-metrics/scopes': () => json({ projects: [tm], workspaces: [], scopes: { projects: [], workspaces: [] }, anyEnabled: false }),
    '/api/policy/scopes': () => json({ projects: [tp], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false }),
    '/api/projects/k1/team-metrics/enable': () => json(GIT_MISSING, 409),
    '/api/projects/k1/policy/enable': () => json(GIT_MISSING, 409),
  });
  for (const cls of ['tm', 'tp']) {
    const cell = d.createElement('div'); cell.className = `${cls}-cell`; cell.dataset.key = 'k1';
    const b = d.createElement('button'); b.className = `${cls}-enable`; cell.appendChild(b);
    d.getElementById('proj-detail').replaceChildren(cell);
    b.click();
    await settle();
    const input = d.querySelector(`#plugin-modal-body input.${cls}-repo`);
    input.value = 'https://gitlab.com/acme/billing';
    input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
    d.querySelector(`#plugin-modal .${cls}-enable-submit`).click();
    await settle();
    const err = d.querySelector('#plugin-modal-body .tm-enable-err');   // both dialogs share the error line's class
    assert.deepEqual([err.hidden, err.querySelector('.pl-needs-git')?.className, err.textContent], [false, 'badge waiting pl-needs-git', 'Needs git'], cls);
    assert.equal(d.getElementById('plugin-modal').classList.contains('hidden'), false, cls);
    d.getElementById('plugin-modal-close').click();
  }
});

test('app: an Add marketplace that succeeds after a 409 takes the Add dialog\'s chip away', async () => {
  let posts = 0;
  const added = { id: 'gh', url: 'https://github.com/a/m', name: 'GH', builtin: false, warnings: [], lastSync: null, plugins: [] };
  const d = await boot({
    '/api/marketplaces/refresh': () => json({ ok: true, marketplaces: [] }),
    '/api/marketplaces': (u, o) => ((o.method || 'GET') === 'POST' ? (posts++ ? json({ ok: true, marketplace: added }) : json(GIT_MISSING, 409)) : json({ marketplaces: [] })),
    '/api/plugins': () => json({ plugins: [], orphans: [] }),
    '/api/chat/status': () => json({ channels: [] }),
    '/api/policy/scopes': () => json({ projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false }),
  });
  d.defaultView.location.hash = '#marketplace';
  await settle();
  const form = d.querySelector('.mk-panel[data-tab="browse"] form.mk-empty-add');   // no marketplaces: Browse's header is empty
  form.querySelector('input').value = 'https://gitlab.com/a/m';
  form.dispatchEvent(new d.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(d.querySelectorAll('#mk-dialog .pl-needs-git').length, 1);
  const url = d.getElementById('mk-add-url');
  url.value = 'https://github.com/a/m';   // no input event: the success itself clears the chip
  d.querySelector('#mk-dialog .mk-add-primary').click();
  await settle();
  assert.deepEqual([posts, d.querySelector('#mk-dialog .pl-needs-git'), d.getElementById('mk-dialog').dataset.state], [2, null, 'result']);
  d.querySelector('#mk-dialog .mk-dlg-close').click();
  await settle();
});

test('Team policy cell: a GitHub team repository never read (unread) says not read yet, never Off with Set up', () => {
  const why = 'not found on GitHub: acme/secret-team (a private repository needs GH_TOKEN)';
  const s = { key: 'k1', name: 'secret', slug: 'acme/secret-team', hasOrigin: true, present: false, docKnown: false, unread: true,
    blocked: 'DOC_UNKNOWN', delegateCode: 'DOC_UNKNOWN', delegateDetail: why, lastDiscoveryError: why, checkedAt: null };
  const cell = renderProjectTpCell(s, { doc });
  assert.deepEqual([cell.dataset.kind, cell.querySelector('.tm-status').textContent, [...cell.querySelectorAll('button')].map((b) => b.textContent)],
    ['blocked', 'On · branch not read yet · your settings apply', []]);
  assert.deepEqual([projectTpSummary(s).short, projectTpSummary(s).detail], ['on · not read yet', `${why} · your settings apply`]);
  const off = renderProjectTpCell({ ...s, unread: undefined, blocked: null, delegateCode: null, delegateDetail: null }, { doc });
  assert.deepEqual([off.dataset.kind, [...off.querySelectorAll('button')].map((b) => b.textContent)], ['off', ['Set up policy…']]);
});

test('Getting started: with Needs git in the setup dialog the team tours end on Done at the dialog\'s Needs git chip, not on its disabled submit', async () => {
  const STEPS = ['claude', 'project', 'run', 'ask', 'realRun', 'workflows', 'workspace', 'teamMetrics', 'teamPolicy'];
  const onboarding = { steps: Object.fromEntries(STEPS.map((id) => [id, id === 'claude' || id === 'project'])), done: 2, total: 9,
    claude: { bin: 'claude', hint: null }, hidden: false, welcomeSeen: true };
  const gl = { key: 'k1', name: 'billing', slug: 'gitlab.com/acme/billing', hasOrigin: true, needsGit: true, origin: 'gitlab.com/acme/billing' };
  for (const [step, cls] of [['teamMetrics', 'tm'], ['teamPolicy', 'tp']]) {
    const d = await boot({
      '/api/onboarding': () => json(onboarding),
      '/api/team-metrics/scopes': () => json({ projects: [{ ...gl, enabled: false, record: true, recordsLocally: false }], workspaces: [], scopes: { projects: [], workspaces: [] }, anyEnabled: false }),
      '/api/policy/scopes': () => json({ projects: [{ ...gl, present: false, carries: false }], workspaces: [], scopes: { projects: [], workspaces: [] }, homes: [], requirements: [], blockedPlugins: [], anyEnabled: false }),
      '/api/projects': () => json({ projects: [{ name: 'billing', path: '/tmp/billing', key: 'k1', exists: true }] }),
    }, { level: 'expert' });
    d.defaultView.Element.prototype.getBoundingClientRect = function () {   // jsdom has no layout: guide-spot rings only a control with a box
      const n = this.isConnected && !this.closest('[hidden], .hidden') ? 20 : 0;
      return { x: 10, y: 10, top: 10, left: 10, width: n, height: n, right: 10 + n, bottom: 10 + n };
    };
    const lit = () => d.querySelector('.guide-layer')?.dataset.target || '';
    const submit = `#plugin-modal .${cls}-enable-submit`;
    // The closing stop rings the chip on the dialog's origin line: scrolled into view, it says why the submit is off.
    const chip = '#plugin-modal .pl-needs-git';
    d.querySelector('.gs-pill').click();
    await settle();
    d.querySelector(`.gs-tile[data-step="${step}"]`).click();
    for (let i = 0; i < 8 && !d.querySelector(`${chip}.guide-target`); i++) {   // the Projects row, the project, the Team tab, Set up…
      for (let w = 0; w < 100 && !(lit() && d.querySelector(lit())); w++) await new Promise((r) => setTimeout(r, 20));
      const at = lit();
      d.querySelector(at).click();
      for (let w = 0; w < 75 && lit() === at; w++) await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual([lit(), d.querySelector(submit).disabled, d.querySelector('#plugin-modal-body .pl-needs-git').textContent, d.querySelector('.guide-balloon .guide-text').textContent,
      [...d.querySelectorAll('.guide-actions button')].map((b) => b.textContent)], [chip, true, 'Needs git', 'Needs git', ['Done', 'Skip']], step);
    assert.equal(d.querySelector('.guide-layer').classList.contains('pointer'), true, `${step}: the closing stop rides above the open dialog (a spotlight balloon sits under .viewer-modal)`);
    d.querySelector('.guide-actions .guide-next').click();
    await settle();
    assert.equal(d.querySelector('.guide-layer'), null, step);
  }
});
