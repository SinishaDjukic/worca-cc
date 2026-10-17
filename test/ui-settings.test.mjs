// test/ui-settings.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

test('Settings sits in the account menu (not the page list), loads root, and saves a new one', async () => {
  let posted = null;
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/settings')) {
        if ((opts.method || 'GET').toUpperCase() === 'POST') {
          posted = JSON.parse(opts.body);
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: posted.root, default: '/home/me' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ root: '', default: '/home/me' }) });
      }
      return null;
    },
  });
  const { window } = ctx;

  // (1) Settings left the page list for the account menu: after Interface mode, before the away row.
  const doc = window.document;
  assert.equal(doc.querySelector('.nav [data-nav="settings"]'), null, 'not a sidebar page any more');
  const rows = [...doc.querySelectorAll('#acct-menu > .msect > button')].map((el) => el.id);
  assert.deepEqual(rows, ['acct-lvl', 'acct-settings', 'acct-away'], 'Interface mode, Settings, then the away row last');
  assert.equal(doc.getElementById('acct-settings').dataset.nav, 'settings');

  // (2) navigating to it loads the current root (default shown as placeholder).
  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const input = window.document.querySelector('#settingsRoot');
  assert.ok(input, 'settings view has a root input');
  assert.equal(input.value, '');
  assert.equal(input.placeholder, '/home/me', 'default shown as placeholder');

  // (3) typing a new root + Save POSTs it.
  input.value = '/Volumes/ext';
  window.document.querySelector('#settingsSave').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(posted && posted.root === '/Volumes/ext', 'Save POSTs the typed root');

  // (4) Reset posts an empty root.
  posted = null;
  window.document.querySelector('#settingsReset').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(posted && posted.root === '', 'Reset POSTs an empty root');
});

const okJson = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));
/** Boot with runTags on and open Settings › Tags. `settings` is the GET body; `team` the machine-wide lock. */
async function openTags({ settings = {}, team = null, posts = [] } = {}) {
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/settings')) {
        if ((opts.method || 'GET').toUpperCase() === 'POST') {
          const b = JSON.parse(opts.body); posts.push(b);
          return okJson({ root: '', default: '/home/me', tagDimensions: [], enforceTags: false, ...b });
        }
        return okJson({ root: '', default: '/home/me', tagDimensions: [], enforceTags: false, ...settings });
      }
      if (url === '/api/tag-dimensions') return okJson({ dims: [], team });
      return null;
    },
  });
  const { window } = ctx;
  applyFlags({ runTags: true }, window.document);
  window.location.hash = 'settings/tags';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 4; i++) await tick();
  return { window, doc: window.document, posts };
}

test('Settings › Tags: rows, Values chips, Default picker, Mandatory, Save posts both keys', async () => {
  const { window, doc, posts } = await openTags();
  const card = doc.getElementById('tag-dims-settings-card');
  assert.equal(card.closest('.settings-pane').dataset.tab, 'tags');
  assert.equal(card.querySelectorAll('.tag-dim-row').length, 0);
  card.querySelector('.tag-dim-add').click();
  const row = card.querySelector('.tag-dim-row');
  const label = row.querySelector('.tag-dim-label-input');
  label.value = 'Cost centre'; label.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(row.querySelector('.tag-dim-key').value, 'cost-centre', 'key follows the label until edited');
  const vin = row.querySelector('.tag-value-input');
  for (const v of ['4410', '4420']) { vin.value = v; vin.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
  const def = row.querySelector('.tag-dim-default');
  assert.equal(def.tagName, 'SELECT');
  def.value = '4420'; def.dispatchEvent(new window.Event('change', { bubbles: true }));
  row.querySelector('.tag-dim-required').click();
  doc.getElementById('tagsEnforce').click();
  doc.getElementById('tagDimsSave').click();
  for (let i = 0; i < 6 && !posts.length; i++) await tick();
  assert.deepEqual(posts.at(-1), { enforceTags: true, tagDimensions: [{ key: 'cost-centre', label: 'Cost centre', values: ['4410', '4420'], required: true, default: '4420' }] });
});

test('Settings › Tags: a team policy makes the tab read-only with "Set by your team"', async () => {
  const team = { home: 'acme/web', dims: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }], enforce: true };
  const { doc } = await openTags({ settings: { tagDimensions: [{ key: 'mine', label: 'Mine', values: [], required: false }] }, team });
  const card = doc.getElementById('tag-dims-settings-card');
  assert.equal(doc.getElementById('tagsTeamNote').textContent, 'Set by your team (acme/web).');
  assert.equal(doc.getElementById('tagsTeamNote').hidden, false);
  assert.deepEqual([...card.querySelectorAll('.tag-dim-label-input')].map((i) => i.value), ['Cost centre'], 'policy replaces the person\'s rows');
  assert.ok([...card.querySelectorAll('#tagDimsEditor input, #tagDimsEditor select, #tagsEnforce')].every((i) => i.disabled));
  assert.equal(card.querySelector('.tag-dim-add').hidden, true);
  assert.equal(doc.getElementById('tagsEnforce').checked, true);
  assert.equal(doc.getElementById('tagDimsSave').hidden, true);
});

test('Settings › Tags: a values-only edit makes the card dirty and saves the new list', async () => {
  const { window, doc, posts } = await openTags({ settings: { tagDimensions: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] } });
  const save = doc.getElementById('tagDimsSave');
  assert.equal(save.disabled, true, 'clean after paint');
  const vin = doc.querySelector('#tag-dims-settings-card .tag-value-input');
  vin.value = '4420'; vin.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick();
  assert.equal(save.disabled, false);
  save.click();
  for (let i = 0; i < 6 && !posts.length; i++) await tick();
  assert.deepEqual(posts.at(-1).tagDimensions[0].values, ['4410', '4420']);
});

test('Settings › Tags: the switch is off by default; on with no tag ticked Mandatory, a hint says runs are not blocked', async () => {
  const { window, doc } = await openTags();
  const sw = doc.getElementById('tagsEnforce');
  const hint = doc.getElementById('tagsEnforceNone');
  assert.equal(sw.checked, false, 'off by default');
  assert.equal(hint.hidden, true, 'off: no hint');
  sw.click();
  assert.equal(hint.hidden, false, 'on, nothing Mandatory: the hint shows');
  assert.equal(hint.textContent, 'No tag is marked Mandatory yet, so runs are not blocked.');
  const card = doc.getElementById('tag-dims-settings-card');
  card.querySelector('.tag-dim-add').click();
  const row = card.querySelector('.tag-dim-row');
  const label = row.querySelector('.tag-dim-label-input');
  label.value = 'Client'; label.dispatchEvent(new window.Event('input', { bubbles: true }));
  row.querySelector('.tag-dim-required').click();
  assert.equal(hint.hidden, true, 'a Mandatory tag: the hint goes');
});
