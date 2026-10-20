// test/ui-git-gate.test.mjs — first paint from the shell, a live flip from the git frame and from GET /api/git, and
// the U4 re-checks when Projects, Add project and New run open.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { renderIndexHtml } from '../src/core/index-html.mjs';
import { gitOn, applyGit, onGitChange, refreshGit, GIT_MISSING_TEXT } from '../ui/public/git-gate.mjs';
import { GIT_MISSING } from '../src/core/git-available.mjs';
import { bootGitApp } from './helpers/git-app-boot.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: async () => body });
const bootApp = (o = {}) => bootGitApp({ trackDom, ...o });

test('git gate', async () => {
  await checkRows([
    { name: 'module: first paint, applyGit flips once, events, refreshGit', run: async () => {
      const { document: doc } = trackDom(new JSDOM(renderIndexHtml(html, 'system', 'expert', undefined, { git: false }))).window;
      assert.equal(gitOn(doc), false);
      const seen = []; const events = [];
      const off = onGitChange((on) => seen.push(on)); doc.addEventListener('worca:git', (e) => events.push(e.detail.available));
      applyGit({ available: true }, doc); applyGit({ available: true }, doc); applyGit({ nope: 1 }, doc);
      assert.equal(doc.documentElement.dataset.git, 'on');
      assert.equal(await refreshGit({ doc, fetchImpl: () => Promise.reject(new Error('down')) }), true, 'a failure keeps the state');
      assert.equal(await refreshGit({ doc, fetchImpl: () => json(503, { available: false }) }), true, 'an error answer keeps the state');
      assert.equal(await refreshGit({ doc, fetchImpl: () => json(200, { available: false }) }), false);
      off(); assert.deepEqual([seen, events], [[true, false], [true, false]]);
      assert.equal(GIT_MISSING_TEXT, GIT_MISSING.message);
    } },
    { name: 'CSS gate beside the level gate', run: () => {
      assert.match(css, /:root\[data-git="off"\] \[data-needs-git\]\{display:none !important;\}/);
    } },
    { name: 'app: Projects, Add project and New run each ask GET /api/git; a git frame flips the shell', run: async () => {
      const { window, doc, calls, ws } = await bootApp();
      const n = () => calls.filter((u) => u.startsWith('/api/git')).length;
      window.location.hash = 'projects'; await tick(); await tick();
      const afterProjects = n(); assert.ok(afterProjects >= 1);
      doc.querySelector('#project-add-btn').dispatchEvent(new window.Event('click', { bubbles: true })); await tick(); await tick();
      assert.ok(n() > afterProjects);
      const afterAdd = n(); window.location.hash = 'new'; await tick(); await tick();
      assert.ok(n() > afterAdd);
      ws._msg({ type: 'git', git: { available: true, version: '2.47.0' } }); await tick();
      assert.equal(doc.documentElement.dataset.git, 'on');
      ws._msg({ type: 'hello', bootId: 'b1', runs: [], git: { available: false } }); await tick();
      assert.equal(doc.documentElement.dataset.git, 'off', 'every hello re-applies git');
    } },
    { name: 'git goes missing while the Add project dialog shows Clone: it goes back to Folder', run: async () => {
      const { window, doc, ws } = await bootApp({ git: true });
      window.location.hash = 'projects'; await tick(); await tick();
      doc.querySelector('#project-add-btn').dispatchEvent(new window.Event('click', { bubbles: true })); for (let i = 0; i < 4; i++) await tick();
      doc.querySelector('#proj-add-tab-clone').dispatchEvent(new window.Event('click', { bubbles: true })); await tick();
      assert.equal(doc.querySelector('#proj-add-clone-pane').hidden, false, 'precondition: Clone shown');
      ws._msg({ type: 'git', git: { available: false, version: null } }); await tick();
      const sel = [...doc.querySelectorAll('#proj-add-tabs .md-tab')].find((t) => t.getAttribute('aria-selected') === 'true');
      assert.deepEqual([sel?.dataset.mode, doc.querySelector('#proj-add-clone-pane').hidden, doc.querySelector('#proj-add-folder-pane').hidden], ['folder', true, false]);
    } },
    { name: 'git goes missing while a Projects filter is selected: back to All (its chips are hidden)', run: async () => {
      const projects = [{ name: 'alpha', path: '/data/alpha', exists: true, key: 'alpha-00000001' }, { name: 'beta', path: '/data/beta', exists: true, key: 'beta-00000002' }];
      const { window, doc, ws } = await bootApp({ git: true, projects });
      const base = globalThis.fetch;   // alpha answers "no git remote" (the Local only chip), beta has no answer yet
      const fake = (url, o) => (String(url).startsWith('/api/sync/projects') ? json(200, { projects: { 'alpha-00000001': { remote: null } } }) : base(url, o));
      window.fetch = fake; globalThis.fetch = fake;
      window.location.hash = 'projects'; await new Promise((r) => setTimeout(r, 400));
      doc.querySelector('.filter-chip[data-filter="local"]').dispatchEvent(new window.Event('click', { bubbles: true }));
      const beta = () => doc.querySelector('.pl-item[data-key="beta-00000002"]');
      assert.equal(beta().hidden, true, 'precondition: Local only hides beta');
      ws._msg({ type: 'git', git: { available: false, version: null } }); await tick();
      assert.equal(beta().hidden, false);
    } },
    { name: 'git goes missing while a clone runs: the dialog keeps Clone and its progress line', run: async () => {
      const { window, doc, ws } = await bootApp({ git: true });
      const base = globalThis.fetch;   // the clone job stays running until the WS frame below
      const fake = (url, o = {}) => (String(url).startsWith('/api/projects/clone') ? json(o.method === 'POST' ? 202 : 200, { jobId: 'cln_00000009', job: { id: 'cln_00000009', state: 'running' } }) : base(url, o));
      window.fetch = fake; globalThis.fetch = fake;
      window.location.hash = 'projects'; await tick(); await tick();
      doc.querySelector('#project-add-btn').dispatchEvent(new window.Event('click', { bubbles: true })); for (let i = 0; i < 4; i++) await tick();
      doc.querySelector('#proj-add-tab-clone').dispatchEvent(new window.Event('click', { bubbles: true })); await tick();
      doc.querySelector('#proj-clone-url').value = 'https://github.com/acme/api';
      doc.querySelector('#proj-add-save').dispatchEvent(new window.Event('click', { bubbles: true })); await tick(); await tick();
      ws._msg({ type: 'git', git: { available: false, version: null } }); await tick();
      const shown = [doc.querySelector('#proj-add-clone-pane').hidden, doc.querySelector('#proj-add-msg').textContent];
      ws._msg({ type: 'clone-changed', job: { id: 'cln_00000009', state: 'error', error: 'x' } });   // ends the 2 s poll
      assert.deepEqual(shown, [false, 'Cloning https://github.com/acme/api …']);
    } },
  ]);
});
