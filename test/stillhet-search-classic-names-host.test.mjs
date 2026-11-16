// test/stillhet-search-classic-names-host.test.mjs — F-7b-16: the top-bar search finds every classic Settings card by its
// name and its alts (ui/public/settings-index.mjs CARDS), at the Stillhet row or section that holds that setting, with its
// where line. A home that is still sample data in the live kind is found with the library's not-live words, never nothing.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, UNLISTED_CARDS } from '../ui/public/settings-index.mjs';
import { NOT_LIVE_SENTENCE } from '../ui/public/design-system/components/index.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { liveHost, settle, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

const closers = [];
afterEach(() => { while (closers.length) closers.pop()(); closeHosts(); });
const expert = (win) => win.localStorage.setItem('worca-rail.mode', 'expert');   // every row visible: only a lock note differs
async function demo() { const w = stillhetHost({ hash: '#chat', after: (fn) => closers.push(fn), beforeScripts: expert }); await settle(200); return w; }
async function live() { const { w } = await liveHost({ hash: '#chat', beforeScripts: expert }); await settle(100); return w; }
// the results for `q`, as [label, hint]; the tail (Ask Chat) left out
function search(w, q) {
  const box = w.document.querySelector('[data-search]');
  box.value = q; box.dispatchEvent(new w.Event('input', { bubbles: true }));
  return [...w.document.querySelectorAll('[data-search-res] [data-menu-pick]')].filter((e) => e.dataset.menuPick !== 'srch|ask')
    .map((e) => [e.querySelector('.mi-l')?.textContent || '', e.querySelector('.mi-hint')?.textContent || '']);
}
const pick = async (w, label) => { const el = [...w.document.querySelectorAll('[data-search-res] [data-menu-pick]')].find((e) => e.querySelector('.mi-l')?.textContent === label); assert.ok(el, `${label} is a result`); el.click(); await settle(60); };

test('F-7b-16 coverage: the table covers every classic CARDS entry', async () => {
  const w = await demo();
  const table = w.RailPulse.classicSettings;
  assert.ok(Object.isFrozen(table));
  assert.deepEqual(JSON.parse(JSON.stringify(table.map((x) => ({ card: x.card, name: x.name, alts: x.alts })))), CARDS.filter((c) => !UNLISTED_CARDS.includes(c.id)).map((c) => ({ card: c.id, name: c.title, alts: [...c.alts] })));
});

test('F-7b-16 demo: network proxy, machine load and spawn diagnostics find their Settings rows with their where', async () => {
  const w = await demo();
  for (const [q, label, where] of [['network proxy', 'Proxy', 'Tasks › Network'], ['machine load', 'Capacity', 'Tasks › Machine'], ['spawn diagnostics', 'Diagnostics', 'General › Storage']]) {
    const hits = search(w, q);
    assert.deepEqual(hits[0], [label, where], `${q}: ${JSON.stringify(hits)}`);
  }
});

test('F-7b-16 live: the same names find their homes with the not-live words where the home is sample', async () => {
  const w = await live();
  for (const [q, label, where] of [['network proxy', 'Proxy', 'Tasks › Network'], ['machine load', 'Capacity', 'Tasks › Machine'], ['spawn diagnostics', 'Diagnostics', 'General › Storage']]) {
    const hits = search(w, q);
    assert.deepEqual(hits[0], [label, `${where} · ${NOT_LIVE_SENTENCE}`], `${q}: ${JSON.stringify(hits)}`);
  }
});

test('F-7b-16: every classic name and alt finds a row, demo and live', async () => {
  for (const [kind, w] of [['demo', await demo()], ['live', await live()]]) {
    for (const c of CARDS) for (const q of [c.title, ...c.alts]) {
      const hits = search(w, q);
      assert.ok(hits.length, `${kind}: "${q}" (${c.title}) finds nothing`);
      if (kind === 'demo') assert.ok(!hits.some(([, h]) => h.includes(NOT_LIVE_SENTENCE)), `demo: "${q}" carries the not-live words: ${JSON.stringify(hits)}`);
    }
    // the name itself finds its home row (not only something that happens to share a word)
    assert.ok(search(w, 'Wait for the network').some(([l]) => l === 'Offline'), kind);
    assert.ok(search(w, 'Budget & cost limits').some(([l]) => l === 'Budget'), kind);
  }
});

test('F-7b-16: picking Network proxy lands on Settings › Tasks', async () => {
  const w = await demo();
  const went = []; const go = w.RailShell.go; w.RailShell.go = (h, ...a) => { went.push(h); return go(h, ...a); };
  search(w, 'network proxy');
  await pick(w, 'Proxy');
  assert.ok(went.includes('settings/runs'), went.join(', '));
});

test('F-7b-16: Interface mode opens the profile menu\'s Interface mode, and Workspaces goes to Projects', async () => {
  const w = await demo(), d = w.document;
  assert.deepEqual(search(w, 'interface mode')[0], ['Interface mode', 'Your menu']);
  await pick(w, 'Interface mode');
  assert.ok(d.querySelector('[data-sub="lvl"][aria-expanded="true"]'), 'the Interface mode sub-menu is open');
  const went = []; const go = w.RailShell.go; w.RailShell.go = (h, ...a) => { went.push(h); return go(h, ...a); };
  assert.deepEqual(search(w, 'monorepo')[0], ['Workspaces', 'Projects · by workspace'], 'a classic alt finds its home in Projects');
  await pick(w, 'Workspaces');
  assert.ok(went.includes('projects'), went.join(', '));
  assert.ok(search(w, 'workspaces').some(([l]) => l === 'Workspaces'), 'the name finds it too');
});

test('F-7b-16: \'proxy\' shows the Proxy row once', async () => {
  for (const w of [await demo(), await live()]) {
    const hits = search(w, 'proxy');
    assert.equal(hits.filter(([l]) => l === 'Proxy').length, 1, JSON.stringify(hits));
    assert.equal(search(w, 'appearance').filter(([l]) => l === 'Appearance').length, 1, 'one Appearance row');
  }
});
