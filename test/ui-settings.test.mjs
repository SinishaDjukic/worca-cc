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

  // (1) Settings left the page list for the account menu: after Interface mode (and the hidden team-setup row), before the away row.
  const doc = window.document;
  assert.equal(doc.querySelector('.nav [data-nav="settings"]'), null, 'not a sidebar page any more');
  const rows = [...doc.querySelectorAll('#acct-menu > .msect > button')].map((el) => el.id);
  assert.deepEqual(rows, ['acct-team-setup', 'acct-lvl', 'acct-settings', 'acct-away', 'acct-keepawake'], 'the team-setup row, Interface mode, Settings, then the two switches');
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
  for (let i = 0; i < 6; i++) await tick();   // let the save settle (it raises the Saved toast) before the DOM is released
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
  for (let i = 0; i < 6; i++) await tick();   // let the save settle before the DOM is released
  assert.deepEqual(posts.at(-1).tagDimensions[0].values, ['4410', '4420']);
});

test('Settings › Tags: the switch is off by default; on with no tag ticked Mandatory, a hint says runs are not blocked', async () => {
  const { window, doc } = await openTags();
  const sw = doc.getElementById('tagsEnforce');
  const hint = doc.getElementById('tagsEnforceNone');
  assert.equal(sw.checked, false, 'off by default');
  const rowEl = sw.closest('.drow');
  assert.ok(rowEl.classList.contains('switch-drow'), 'a settings row: label left, switch right');
  assert.equal(rowEl.querySelector('.drow-label').getAttribute('for'), 'tagsEnforce');
  assert.ok(sw.closest('.drow-control'), 'the switch sits in the right-hand control cell');
  assert.equal(hint.hidden, true, 'off: no hint');
  sw.click();
  assert.equal(hint.hidden, false, 'on, nothing Mandatory: the hint shows');
  assert.equal(hint.textContent, 'No cost tag is marked Mandatory yet, so runs are not blocked.');
  const card = doc.getElementById('tag-dims-settings-card');
  card.querySelector('.tag-dim-add').click();
  const row = card.querySelector('.tag-dim-row');
  const label = row.querySelector('.tag-dim-label-input');
  label.value = 'Client'; label.dispatchEvent(new window.Event('input', { bubbles: true }));
  row.querySelector('.tag-dim-required').click();
  assert.equal(hint.hidden, true, 'a Mandatory tag: the hint goes');
});

async function openLabels({ flags = { runTags: true, runLabels: true }, labels = [], sent = [], answer = () => okJson({}) } = {}) {
  const ctx = await boot({ fetchHandler: (url, opts) => {
    // as openTags: the Settings view reads its settings before painting the tags pane
    if (url.includes('/api/settings')) return okJson({ root: '', default: '/home/me', tagDimensions: [], enforceTags: false });
    if (url === '/api/labels') { sent.push(['GET', url]); return okJson({ labels }); }
    if (url.startsWith('/api/labels/')) { sent.push([opts.method || 'GET', url, opts.body ? JSON.parse(opts.body) : null]); return answer(url, opts); }
    if (url.startsWith('/api/tag-dimensions')) return okJson({ dims: [], team: null });
    return null;
  } });
  const { window } = ctx;
  applyFlags(flags, window.document);
  window.location.hash = 'settings/tags';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 4; i++) await tick();
  return { window, doc: window.document, sent };
}
const menuPick = (doc, card, text) => {
  card.querySelector('.lbl-set-more').click();
  [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((i) => i.textContent.trim() === text).click();
};

test('Settings › Labels & cost tags: the Labels section lists labels; Delete names the run count, then sends DELETE', async () => {
  const { doc, sent } = await openLabels({ labels: [{ label: 'hotfix', count: 3 }] });
  const card = doc.getElementById('labels-settings-card');
  assert.equal(card.closest('.settings-pane').dataset.tab, 'tags');
  assert.equal(card.querySelector('h2').textContent, 'Labels');
  assert.deepEqual([...card.querySelectorAll('.lbl-set-name')].map((n) => n.textContent), ['hotfix']);
  assert.equal(card.querySelector('.lbl-set-count').textContent, 'on 3 runs');
  menuPick(doc, card, 'Delete'); await tick();
  assert.equal(doc.getElementById('confirm-message').textContent, 'Remove “hotfix” from 3 runs?');
  doc.getElementById('confirm-ok').click();
  for (let i = 0; i < 3; i++) await tick();
  assert.deepEqual(sent.filter((s) => s[0] === 'DELETE').map((s) => s[1]), ['/api/labels/hotfix']);
});

test('Settings › Labels & cost tags: Rename onto an existing label asks to merge, then posts { from, to }', async () => {
  const { window, doc, sent } = await openLabels({ labels: [{ label: 'hotfix', count: 3 }, { label: 'urgent', count: 2 }] });
  const card = doc.getElementById('labels-settings-card');
  menuPick(doc, card, 'Rename'); await tick();
  const input = doc.querySelector('#confirm-fields input');
  input.value = 'Urgent'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.getElementById('confirm-ok').click(); await tick(); await tick();
  assert.equal(doc.getElementById('confirm-message').textContent, 'Merge “hotfix” into “urgent” on 3 runs?');
  doc.getElementById('confirm-ok').click();
  for (let i = 0; i < 3; i++) await tick();
  assert.deepEqual(sent.filter((s) => s[0] === 'POST').map((s) => [s[1], s[2]]), [['/api/labels/rename', { from: 'hotfix', to: 'Urgent' }]]);
});

test('Settings › Labels & cost tags: a refused rename shows the server message in the section error line', async () => {
  const bad = () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'a label is at most 32 characters' }) });
  const { window, doc } = await openLabels({ labels: [{ label: 'hotfix', count: 3 }], answer: bad });
  menuPick(doc, doc.getElementById('labels-settings-card'), 'Rename'); await tick();
  const input = doc.querySelector('#confirm-fields input');
  input.value = 'x'.repeat(40); input.dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.getElementById('confirm-ok').click();
  for (let i = 0; i < 4; i++) await tick();
  const err = doc.getElementById('labelsSettingsError');
  assert.deepEqual([err.hidden, err.textContent], [false, 'a label is at most 32 characters']);
});

test('Settings › Labels & cost tags: with runLabels off the Labels section is gated and /api/labels is never read', async () => {
  const { doc, sent } = await openLabels({ flags: { runTags: true } });
  const card = doc.getElementById('labels-settings-card');
  assert.equal(card.dataset.flag, 'runLabels');
  assert.equal(card.querySelectorAll('.lbl-set-row').length, 0);
  assert.equal(sent.length, 0);
  assert.ok(doc.getElementById('tag-dims-settings-card'), 'the Cost tags section is still there');
});

test('F-23: every successful Settings card save raises one "Saved" toast (deduped by key)', async () => {
  const { doc } = await openTags();
  const saved = () => [...doc.querySelectorAll('#toasts .toast.ok')].filter((t) => t.querySelector('.tt').textContent === 'Saved');
  assert.equal(saved().length, 0);
  for (let n = 0; n < 2; n++) {
    doc.getElementById('tagsEnforce').click();
    doc.getElementById('tagDimsSave').click();
    for (let i = 0; i < 8; i++) await tick();
  }
  assert.equal(saved().length, 1, 'two saves in a row leave one toast');
});

test('F-19: the Settings tab row is as wide and as centred as the content column', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  const tabs = css.match(/^\.settings-tabs\{([^}]*)\}/m)[1];
  assert.match(tabs, /max-width:760px/);
  assert.match(tabs, /margin:0 auto/);
  assert.match(css.match(/^\.settings-card\{([^}]*)\}/m)[1], /max-width:760px/);
});
