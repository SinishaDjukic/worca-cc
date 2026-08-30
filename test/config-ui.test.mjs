// test/config-ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const appjs = readFileSync(appPath, 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));

// Minimal app boot (mirrors test/ui-settings.test.mjs) so the settings-field
// tests below can exercise the real load/save round trip, not just the markup.
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only global */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  return { window };
}

// Drive the settings view: hashchange is what calls loadSettings() (app.js:7919).
async function openSettings(window) {
  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();
}

test('the agents accordion hosts the model + effort selectors app.js builds', () => {
  // The per-step controls are no longer static markup — index.html supplies the
  // accordion shell and app.js fills one row per node (newpipeline-ux-design.md §4.7).
  assert.ok(html.includes('id="agents-config"'), 'missing the accordion shell');
  assert.ok(html.includes('id="agents-rows"'), 'missing the accordion row host');
  assert.ok(appjs.includes('step-model'), 'missing model select class');
  assert.ok(appjs.includes('step-effort'), 'missing effort select class');
});

test('app.js loads, renders, and saves per-step config', () => {
  assert.ok(appjs.includes('/api/config'), 'app.js does not use /api/config');
  assert.ok(appjs.includes('renderAgentRows'), 'missing renderAgentRows');
  assert.ok(appjs.includes('saveAgentRow'), 'missing the accordion save path');
  // The add flow navigates to the global Models view (configurable-models §4.9).
  assert.ok(appjs.includes('goAddModel'), 'missing add-model navigation flow');
});

// ---------------------------------------------------------------------------
// Phase 6 (§5.1): the `projectsRoot` settings field, beside the Worca CC root.
// ---------------------------------------------------------------------------
const PROJECTS_ROOT_HINT =
  'The top-level folder under which your projects live. Its CLAUDE.md, .claude/skills, and '
  + '.mcp.json are made available to every pipeline agent. Leave empty to use your home folder.';

test('settings markup carries a Projects root folder field, its picker, and the tooltip hint', () => {
  assert.ok(html.includes('id="settingsProjectsRoot"'), 'missing #settingsProjectsRoot input');
  assert.ok(html.includes('<label for="settingsProjectsRoot">Projects root folder</label>'),
    'missing/renamed "Projects root folder" label');
  assert.ok(html.includes('id="settingsProjectsRootBrowse"'), 'missing folder-picker button');
  // The hint lives in the ⓘ tooltip now; it is wrapped across source lines — compare whitespace-collapsed.
  assert.ok(html.replace(/\s+/g, ' ').includes(PROJECTS_ROOT_HINT), 'projectsRoot hint text drifted from §5.1');
});

test('settings view renders the field and reflects the server projectsRoot + default', async () => {
  const { window } = await boot({
    fetchHandler: (url) => (url.includes('/api/settings')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '', projectsRoot: '/home/me/code', projectsRootDefault: '/home/me', default: '/home/me' }) })
      : null),
  });
  await openSettings(window);
  const input = window.document.querySelector('#settingsProjectsRoot');
  assert.ok(input, 'settings view has a projects-root input');
  assert.equal(input.value, '/home/me/code', 'the persisted projectsRoot loaded into the field');
  assert.equal(input.placeholder, '/home/me', 'the blank-field fallback shown as the placeholder');
});

// The pinned hint promises "Leave blank to use your home folder", so an unset
// key MUST reach the user as an empty field — the API reports the RAW setting,
// never the effective one (which is never '').
test('an unset projectsRoot leaves the field blank, with the fallback only as placeholder', async () => {
  const { window } = await boot({
    fetchHandler: (url) => (url.includes('/api/settings')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '', projectsRoot: '', projectsRootDefault: '/home/me', default: '/home/me' }) })
      : null),
  });
  await openSettings(window);
  const input = window.document.querySelector('#settingsProjectsRoot');
  assert.equal(input.value, '', 'unset reads as a blank field, not as the default path');
  assert.equal(input.placeholder, '/home/me');
});

// With WORCA_PROJECTS_ROOT exported and nothing persisted, the server reports
// projectsRoot:'' + the env path as the fallback. The field must sit blank, and
// a Save must not promote the env value into settings.json.
test('an env-only projectsRoot sits blank and a Save does not promote it', async () => {
  let posted = null;
  const state = { root: '', projectsRoot: '', projectsRootDefault: '/env/projects', default: '/home/me' };
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (!url.includes('/api/settings')) return null;
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        posted = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...state, root: posted.root }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => state });
    },
  });
  await openSettings(window);
  const input = window.document.querySelector('#settingsProjectsRoot');
  assert.equal(input.value, '', 'the env override is never pre-filled into the field');
  assert.equal(input.placeholder, '/env/projects', 'it surfaces as the fallback the blank field resolves to');

  window.document.querySelector('#settingsSave').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick();
  assert.equal(posted.projectsRoot, '', 'Save sends blank -> the route clears/skips the key, no env promotion');
  assert.equal(input.value, '', 'and the repaint keeps it blank');
});

test('Save POSTs projectsRoot; a blank field clears the key; Reset clears both', async () => {
  let posted = null;
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (!url.includes('/api/settings')) return null;
      if ((opts.method || 'GET').toUpperCase() === 'POST') {
        // Raw echo, like the real route: what you POST is what comes back.
        posted = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: posted.root, projectsRoot: posted.projectsRoot, projectsRootDefault: '/home/me', default: '/home/me' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '', projectsRoot: '', projectsRootDefault: '/home/me', default: '/home/me' }) });
    },
  });
  await openSettings(window);
  const doc = window.document;
  const click = (node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

  doc.querySelector('#settingsProjectsRoot').value = '  /Users/me/dev  ';
  click(doc.querySelector('#settingsSave'));
  await tick();
  assert.equal(posted.projectsRoot, '/Users/me/dev', 'Save POSTs the trimmed projectsRoot');
  assert.equal(posted.root, '', 'the root key still rides along untouched');

  posted = null;
  doc.querySelector('#settingsProjectsRoot').value = '';
  click(doc.querySelector('#settingsSave'));
  await tick();
  assert.equal(posted.projectsRoot, '', 'a blank field clears the key');

  posted = null;
  click(doc.querySelector('#settingsReset'));
  await tick();
  assert.deepEqual(posted, { root: '', projectsRoot: '' }, 'Reset clears both roots');
});

test('the picker fills the field from the native dialog, falling back to /api/fs/dirs', async () => {
  let pick = { status: 'picked', path: '/srv/projects' };
  const listings = {
    '/home/me': { path: '/home/me', parent: '/home', home: '/home/me', dirs: [{ name: 'code', path: '/home/me/code' }] },
    '/home/me/code': { path: '/home/me/code', parent: '/home/me', home: '/home/me', dirs: [] },
  };
  const { window } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/settings'))
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '', projectsRoot: '/home/me', projectsRootDefault: '/home/me', default: '/home/me' }) });
      if (url.endsWith('/api/fs/pick-folder') && opts.method === 'POST')
        return Promise.resolve({ ok: true, status: 200, json: async () => pick });
      if (url.includes('/api/fs/dirs')) {
        const q = decodeURIComponent(url.split('path=')[1] || '');
        const body = listings[q] || listings['/home/me'];
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
      return null;
    },
  });
  await openSettings(window);
  const doc = window.document;
  const click = (node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

  click(doc.querySelector('#settingsProjectsRootBrowse'));
  await tick(); await tick();
  assert.equal(doc.querySelector('#settingsProjectsRoot').value, '/srv/projects', 'native pick fills the field');
  assert.ok(doc.querySelector('#folder-browser').classList.contains('hidden'), 'no fallback modal on a native pick');

  // No native dialog -> the in-app /api/fs/dirs browser, whose Select must land
  // in the projects-root field (not the add-project path field).
  pick = { status: 'unsupported' };
  click(doc.querySelector('#settingsProjectsRootBrowse'));
  await tick(); await tick(); await tick();
  assert.ok(!doc.querySelector('#folder-browser').classList.contains('hidden'), 'fallback modal opened');
  click([...doc.querySelectorAll('#folderList .folder-item')].find((b) => b.textContent === 'code'));
  await tick(); await tick();
  click(doc.querySelector('#folderSelect'));
  assert.equal(doc.querySelector('#settingsProjectsRoot').value, '/home/me/code', 'Select fills the projects-root field');
  assert.equal(doc.querySelector('#newProjectPath').value, '', 'the add-project field is left alone');
});
