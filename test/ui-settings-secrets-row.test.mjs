// test/ui-settings-secrets-row.test.mjs — the About card's Secrets row over the real index.html markup: the flag
// gate (hidden, no fetch), the label, the pill and the action note per state, and a failed fetch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { loadSecretsRow } from '../ui/public/settings/secrets-row.mjs';

const trackDom = useDomRelease(afterEach);

function page({ flagOn = true } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const doc = dom.window.document;
  doc.documentElement.dataset.flags = flagOn ? 'secretVault' : '';
  const $ = (id) => doc.getElementById(id);
  return { doc, row: $('aboutSecretsRow'), label: $('aboutSecretsBackend'), pill: $('aboutSecretsState'), note: $('aboutSecretsNote') };
}
const status = (over) => ({ backend: 'keychain', label: 'macOS Keychain', state: 'ready', vault: 'none', reason: null, message: null, checkedAt: '2026-11-21T10:00:00.000Z', ...over });
const answer = (body) => { const calls = []; return { calls, fetchJson: async (url) => { calls.push(url); return body; } }; };

test('the row sits in the About card, hidden until painted', () => {
  const p = page();
  assert.ok(p.row.closest('#about-card'));
  assert.equal(p.row.hidden, true);
  assert.equal(p.row.querySelector('.about-key').textContent, 'Secrets');
  assert.ok(p.pill.classList.contains('about-update'));
  assert.ok(p.note.classList.contains('about-note'));
});

test('flag off: the row stays hidden and nothing is fetched', async () => {
  const p = page({ flagOn: false });
  const f = answer(status());
  await loadSecretsRow(p.doc, f.fetchJson);
  assert.equal(p.row.hidden, true);
  assert.deepEqual(f.calls, []);
});

test('ready: the label and the Ready pill, no note', async () => {
  const p = page();
  const f = answer(status());
  await loadSecretsRow(p.doc, f.fetchJson);
  assert.deepEqual(f.calls, ['/api/secrets/status', '/api/secrets/notice']);
  assert.equal(p.row.hidden, false);
  assert.equal(p.label.textContent, 'macOS Keychain');
  assert.equal(p.pill.textContent, 'Ready');
  assert.equal(p.pill.dataset.state, undefined);
  assert.equal(p.note.hidden, true);
});

test('locked: the amber pill and an unlock note that does not repeat "locked"', async () => {
  const p = page();
  await loadSecretsRow(p.doc, answer(status({ label: 'Secret Service', state: 'locked', vault: 'unknown', reason: 'store-locked' })).fetchJson);
  assert.equal(p.pill.textContent, 'Locked');
  assert.equal(p.pill.dataset.state, 'warn');
  assert.equal(p.note.hidden, false);
  assert.match(p.note.textContent, /^Unlock the OS key store/);
  assert.ok(!/locked/i.test(p.note.textContent));
});

test('unavailable: amber pill and a set-up note', async () => {
  const p = page();
  await loadSecretsRow(p.doc, answer(status({ backend: 'none', label: 'No OS key store', state: 'unavailable', vault: 'none' })).fetchJson);
  assert.equal(p.label.textContent, 'No OS key store');
  assert.equal(p.pill.textContent, 'Unavailable');
  assert.equal(p.pill.dataset.state, 'warn');
  assert.equal(p.note.hidden, false);
});

test('unreadable: Vault unreadable and a note naming worca secrets reset; a failed fetch keeps the row hidden', async () => {
  const p = page();
  await loadSecretsRow(p.doc, answer(status({ vault: 'unreadable', reason: 'item-missing' })).fetchJson);
  assert.equal(p.pill.textContent, 'Vault unreadable');
  assert.equal(p.pill.dataset.state, 'warn');
  assert.match(p.note.textContent, /worca secrets reset/);

  const q = page();
  await loadSecretsRow(q.doc, async () => { throw new Error('HTTP 404'); });
  assert.equal(q.row.hidden, true);
  // A repaint from a later failure hides a row painted earlier.
  await loadSecretsRow(p.doc, async () => { throw new Error('HTTP 500'); });
  assert.equal(p.row.hidden, true);
});

test('flagOn, not ready, vault none adds: The vault is not active', async () => {
  const p = page();
  await loadSecretsRow(p.doc, answer(status({ backend: 'none', label: 'No OS key store', state: 'unavailable', vault: 'none' })).fetchJson);
  assert.match(p.note.textContent, /^Set up an OS key store/);
  assert.ok(p.note.textContent.endsWith(' The vault is not active: keys are saved in settings.json, protected by its file permissions.'), p.note.textContent);
  const q = page();
  await loadSecretsRow(q.doc, answer(status({ label: 'Secret Service', state: 'locked', vault: 'none', reason: 'store-locked' })).fetchJson);
  assert.match(q.note.textContent, /^Unlock the OS key store/);
  assert.match(q.note.textContent, /The vault is not active: keys are saved in settings\.json, protected by its file permissions\.$/);
});

test('flagOn, locked, vault unknown does not', async () => {
  const p = page();
  await loadSecretsRow(p.doc, answer(status({ label: 'Secret Service', state: 'locked', vault: 'unknown', reason: 'store-locked' })).fetchJson);
  assert.ok(!/not active/.test(p.note.textContent));
  const r = page();
  await loadSecretsRow(r.doc, answer(status({ vault: 'none' })).fetchJson);
  assert.equal(r.note.hidden, true, 'ready: no note');
});

// ---- the moved-secrets notice ----

const NOTICE = { id: 'a1b2c3d4e5f60718', at: '2026-11-21T10:00:00.000Z', label: 'macOS Keychain', left: 0,
  keys: [{ store: 'settings', name: 'Provider key: openai' }, { store: 'proxy', name: 'Proxy login' }] };
const routed = (notice) => {
  const calls = [];
  return { calls, fetchJson: async (url) => { calls.push(url); return url === '/api/secrets/notice' ? { notice } : status(); } };
};

test('notice: the key names render with textContent, the label appears once in the About card', async () => {
  const p = page();
  await loadSecretsRow(p.doc, routed({ ...NOTICE, keys: [...NOTICE.keys, { store: 'mcp', name: '<img src=x onerror=alert(1)>' }] }).fetchJson);
  const box = p.doc.getElementById('aboutSecretsNotice');
  assert.equal(box.hidden, false);
  assert.ok(box.classList.contains('update-callout'));
  assert.equal(box.dataset.tone, 'info');
  assert.deepEqual([...box.querySelectorAll('li')].map((li) => li.textContent), ['Provider key: openai', 'Proxy login', '<img src=x onerror=alert(1)>']);
  assert.equal(box.querySelector('img'), null, 'text only, never markup');
  assert.match(p.doc.getElementById('aboutSecretsNoticeText').textContent, /^Worca moved 3 saved secrets into the vault\. These keys are now in the vault/);
  assert.equal(p.doc.getElementById('about-card').textContent.split('macOS Keychain').length - 1, 1);
  const ack = p.doc.getElementById('aboutSecretsNoticeAck');
  assert.equal(ack.textContent, 'Got it');
  assert.equal(ack.className, 'btn btn-sm btn-quiet');
});

test('notice: Got it posts the shown id, hides the callout and moves focus off body', async () => {
  const p = page();
  const posts = [];
  await loadSecretsRow(p.doc, routed(NOTICE).fetchJson, { postJson: async (url, body) => { posts.push([url, body]); return { ok: true, cleared: true }; } });
  const ack = p.doc.getElementById('aboutSecretsNoticeAck');
  ack.focus();
  ack.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posts, [['/api/secrets/notice/ack', { id: NOTICE.id }]]);
  assert.equal(p.doc.getElementById('aboutSecretsNotice').hidden, true);
  assert.notEqual(p.doc.activeElement, p.doc.body);
  assert.equal(p.doc.activeElement.id, 'aboutSecretsBackend');
});

test('notice: a rejected POST keeps the callout shown and calls notify', async () => {
  const p = page();
  const notes = [];
  await loadSecretsRow(p.doc, routed(NOTICE).fetchJson, { postJson: async () => { throw new Error('HTTP 500'); }, notify: (n) => notes.push(n) });
  p.doc.getElementById('aboutSecretsNoticeAck').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.doc.getElementById('aboutSecretsNotice').hidden, false);
  assert.deepEqual(notes, [{ tone: 'warn', title: 'Not saved', detail: 'The message stays until Got it is saved. Try again, or run worca secrets ack.' }]);
});

test('notice: none pending keeps the callout hidden; the flag off fetches nothing', async () => {
  const p = page();
  await loadSecretsRow(p.doc, routed(null).fetchJson);
  assert.equal(p.doc.getElementById('aboutSecretsNotice').hidden, true);
  const off = page({ flagOn: false });
  const f = routed(NOTICE);
  await loadSecretsRow(off.doc, f.fetchJson);
  assert.deepEqual(f.calls, []);
  assert.equal(off.doc.getElementById('aboutSecretsNotice').hidden, true);
});
