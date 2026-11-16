// Stillhet slice 9: Workspaces in the live kind, in the app host. Its ⋯ menu, Scan again and Start a task are drawn; Make
// a workspace and Edit by hand are drafts until Save, which sends dev's routes in order; Delete waits for the undo window;
// a question's evidence link opens the file in the editor. The host is test/helpers/stillhet-projects-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectsHost, KEYS, WS, PJ_SOURCES, sent, gate, noWould, undoTimers, settle, go, clone, closeHosts } from './helpers/stillhet-projects-host.mjs';
import { saidText } from './helpers/stillhet-chat-live-host.mjs';
import { PROJECT_ACTIONS } from '../ui/public/stillhet/live/projects-live.mjs';

afterEach(closeHosts);
const page = (d) => d.getElementById('route-place');
const pickMore = (d, v) => { page(d).querySelector('[data-menu="ws-more"]').click(); const b = page(d).querySelector(`[data-menu-pick="ws-more|${v}"]`); assert.ok(b, `ws-more|${v} is offered`); b.click(); };
const addMember = (d, key) => { page(d).querySelector('[data-menu="ws-add"]').click(); page(d).querySelector(`[data-menu-pick="ws-add|${key}"]`).click(); };
const typeName = (w, d, v) => { const f = page(d).querySelector('#ws-name'); f.value = v; f.dispatchEvent(new w.Event('change', { bubbles: true })); };
const HERE = `#projects/ws:${WS}`;
/** Waits until `f()` holds (or `ms` passed): a read of the store under load takes a while. */
const until = async (f, ms = 8000) => { for (let t = 0; t < ms && !f(); t += 50) await settle(50); };
const behindOk = () => { const s = clone(PJ_SOURCES.sync); s.projects[KEYS.ok] = { ...s.projects[KEYS.ok], state: 'behind', behind: 1 }; return { sync: s }; };

test('Make a workspace by hand: a draft in the bar until Save; Save sends POST /api/workspaces with the members\' folders; Discard sends nothing', async () => {
  let made = false;   // F-5-05: the store lists the new workspace once dev made it
  const spaces = () => ({ workspaces: [...clone(PJ_SOURCES.workspaces.workspaces), ...(made ? [{ id: 'wks-web-store-1234abcd', name: 'Web store', projectKeys: [KEYS.ok, KEYS.local], projectPaths: ['/src/seed-ok', '/src/seed-local'], exists: [true, true], mapSummary: null }] : [])] });
  const h = await projectsHost({ read: (u) => (u === '/api/workspaces' ? [200, spaces()] : null), write: (u) => (u === '/api/workspaces' ? (made = true, [201, { workspace: { id: 'wks-web-store-1234abcd' } }]) : [200, { ok: true }]) });
  noWould(h.w);
  h.w.RailPlaces.projects.newPick('hand-space'); await settle(100);
  page(h.d).querySelector('#pj-hand-v').value = 'Web store'; page(h.d).querySelector('[data-confirm="yes"]').click(); await settle(150);
  assert.equal(h.w.location.hash, '#projects/ws:draft:web-store');
  assert.match(h.d.getElementById('bar-place').textContent, /Web store/, 'the fresh draft is in the bar');
  assert.equal(sent(h.calls).length, 0, 'a draft sends nothing');
  addMember(h.d, KEYS.ok); await settle(60); addMember(h.d, KEYS.local); await settle(60);
  page(h.d).querySelector('[data-draft-save]').click(); await until(() => h.w.location.hash === '#projects/ws:wks-web-store-1234abcd');
  assert.deepEqual(sent(h.calls), [['POST', '/api/workspaces', { name: 'Web store', projectPaths: ['/src/seed-ok', '/src/seed-local'] }]]);
  assert.equal(h.w.location.hash, '#projects/ws:wks-web-store-1234abcd');
  h.w.RailPlaces.projects.newPick('hand-space'); await settle(100);
  page(h.d).querySelector('#pj-hand-v').value = 'Throwaway'; page(h.d).querySelector('[data-confirm="yes"]').click(); await settle(150);
  page(h.d).querySelector('[data-draft-discard]').click(); await settle(100);
  assert.equal(sent(h.calls).length, 1, 'Discard sends nothing');
  assert.ok(!h.d.getElementById('bar-place').textContent.includes('Throwaway'));
  assert.deepEqual(h.w.__would, []);
});

test('F-5-05 review: a new workspace opens once the store lists it only while the person is still on its draft', async () => {
  let made = false;
  const held = gate();
  const spaces = () => ({ workspaces: [...clone(PJ_SOURCES.workspaces.workspaces), ...(made ? [{ id: 'wks-web-store-1234abcd', name: 'Web store', projectKeys: [KEYS.ok, KEYS.local], projectPaths: ['/src/seed-ok', '/src/seed-local'], exists: [true, true], mapSummary: null }] : [])] });
  const h = await projectsHost({ hold: (u) => (made && u === '/api/workspaces' ? held.p : null), read: (u) => (u === '/api/workspaces' ? [200, spaces()] : null), write: (u) => (u === '/api/workspaces' ? (made = true, [201, { workspace: { id: 'wks-web-store-1234abcd' } }]) : [200, { ok: true }]) });
  h.w.RailPlaces.projects.newPick('hand-space'); await settle(100);
  page(h.d).querySelector('#pj-hand-v').value = 'Web store'; page(h.d).querySelector('[data-confirm="yes"]').click(); await settle(150);
  addMember(h.d, KEYS.ok); await settle(60); addMember(h.d, KEYS.local); await settle(60);
  page(h.d).querySelector('[data-draft-save]').click(); await settle(200);
  assert.equal(h.w.location.hash, '#projects/ws:draft:web-store', 'the draft stays open while the store has not listed it');
  await go(h.w, '#projects', 200);   // the person moves on before the store reads it
  held.open(); await settle(600);
  assert.equal(h.w.location.hash, '#projects', 'no route once they left');
});

test('Edit by hand: the Name row and Take out, then Save, send the members, then PATCH, in order; a refused removal keeps the name and it in the draft', async () => {
  const h = await projectsHost({ hash: HERE, write: (u, b) => (b?.remove ? [409, { error: 'a run holds it' }] : [200, { ok: true }]) });
  assert.ok(page(h.d).querySelector('[data-menu="ws-more"]'), 'its ⋯ menu is drawn live');
  pickMore(h.d, 'edit'); await settle(100);
  typeName(h.w, h.d, 'Seed store'); await settle(40);
  addMember(h.d, KEYS.behind); await settle(60);
  page(h.d).querySelector('[data-ws-rm="1"]').click(); await settle(60);   // seed-local
  assert.equal(sent(h.calls).length, 0, 'a draft sends nothing until Save');
  page(h.d).querySelector('[data-draft-save]').click(); await settle(250);
  assert.deepEqual(sent(h.calls), [['POST', `/api/workspaces/${WS}/members`, { add: ['/src/seed-behind'] }], ['POST', `/api/workspaces/${WS}/members`, { remove: '/src/seed-local', rescan: 'none' }]], 'F-6-16: no PATCH after a refused member change');
  assert.match(saidText(h.d), /Could not save Seed shop: a (run|task) holds it \(seed-behind was saved\)/);
  assert.match(page(h.d).textContent, /2 changes/, 'the draft keeps the name and the removal');
});

test('F-6-16: taking out a member so one is left says why and sends nothing; the draft stays', async () => {
  const h = await projectsHost({ hash: HERE });
  pickMore(h.d, 'edit'); await settle(100);
  typeName(h.w, h.d, 'Seed store'); await settle(40);
  page(h.d).querySelector('[data-ws-rm="1"]').click(); await settle(60);   // seed-local: seed-ok is left alone
  page(h.d).querySelector('[data-draft-save]').click(); await settle(200);
  assert.deepEqual(sent(h.calls), [], 'nothing is sent');
  assert.match(saidText(h.d), /Could not save Seed shop: a workspace needs at least two projects/);
  assert.match(page(h.d).textContent, /2 changes/, 'the draft stays');
  assert.ok(page(h.d).querySelector('[data-draft-save]'), 'Save is still offered');
});

test('every workspace-side pending label shows on its control, disabled, while dev answers (each action pressed on its own)', async () => {
  const held = new Map();
  const hold = (u) => { for (const [k, g] of held) if (u.includes(k)) return g.p; return null; };
  // three members, so Save with one taken out still leaves two (F-6-16: fewer is refused before any request)
  const three = clone(PJ_SOURCES.workspaces); Object.assign(three.workspaces[0], { projectKeys: [KEYS.ok, KEYS.local, KEYS.offline], projectPaths: ['/src/seed-ok', '/src/seed-local', '/src/seed-offline'], exists: [true, true, true] });
  const h = await projectsHost({ hash: HERE, hold, sources: { ...behindOk(), workspaces: three } });
  const PRESSED = new Set();
  const P = () => page(h.d);
  // R-qa-3: that very control is disabled (a menu item: aria-disabled) and carries the label
  const heldWith = (el, label) => !!el && (el.disabled === true || el.getAttribute('aria-disabled') === 'true') && el.textContent.trim() === label;
  const press = async (id, key, fn, control) => {
    const label = PROJECT_ACTIONS[id][1], g = gate(); held.set(key, g);
    await fn(); await settle(60);
    assert.ok(heldWith(control(), label), `${id}: its control is disabled and reads ${label}`);
    held.delete(key); g.open(); await settle(200);
    PRESSED.add(id);
  };
  const save = () => P().querySelector('[data-draft-save]');
  const syncItem = () => { if (!P().querySelector('[data-menu-pick="ws-more|sync"]')) P().querySelector('[data-menu="ws-more"]').click(); return P().querySelector('[data-menu-pick="ws-more|sync"]'); };
  const setEnd = (name) => [...P().querySelectorAll('.set-name')].find((n) => n.textContent.trim().startsWith(name))?.closest('.set-row')?.querySelector('.set-end button') || null;
  await press('scan', `/api/workspaces/${WS}/scan`, () => P().querySelector('[data-ws="scan"]').click(), () => P().querySelector('.wb-age button'));
  await press('space-sync', `/api/projects/${KEYS.ok}/sync`, async () => { pickMore(h.d, 'sync'); await settle(30); }, syncItem);
  if (P().querySelector('[data-menu-pick]')) { P().querySelector('[data-menu="ws-more"]').click(); await settle(20); }
  await press('answer', '/map/edges/', () => P().querySelector('[data-ws-yes]').click(), () => P().querySelector('.turn-row .tr-end button'));
  await press('open-editor', '/open-in-editor', () => P().querySelector('[data-ws-at]').click(), () => P().querySelector('[data-ws-at]'));
  await press('space-defaults', `/api/workspaces/${WS}/defaults`, async () => { P().querySelector('[data-def-edit="labels"]').click(); await settle(30); h.d.getElementById('def-labels').value = 'shop, web'; P().querySelector('[data-def-edit="labels"]').click(); }, () => setEnd('Labels'));
  // Save with one change each: the name, one member added, one taken out
  pickMore(h.d, 'edit'); await settle(80); typeName(h.w, h.d, 'Seed store'); await settle(40);
  await press('space-rename', `/api/workspaces/${WS}`, () => save().click(), save);
  pickMore(h.d, 'edit'); await settle(80); addMember(h.d, KEYS.behind); await settle(60);
  await press('space-add', `/api/workspaces/${WS}/members`, () => save().click(), save);
  pickMore(h.d, 'edit'); await settle(80); P().querySelector('[data-ws-rm="1"]').click(); await settle(60);
  await press('space-remove', `/api/workspaces/${WS}/members`, () => save().click(), save);
  await go(h.w, '#projects', 100);
  h.w.RailPlaces.projects.newPick('hand-space'); await settle(100);
  P().querySelector('#pj-hand-v').value = 'Pair two'; P().querySelector('[data-confirm="yes"]').click(); await settle(150);
  addMember(h.d, KEYS.ok); await settle(60); addMember(h.d, KEYS.local); await settle(60);
  await press('space-create', '/api/workspaces', () => save().click(), save);
  const side = Object.entries(PROJECT_ACTIONS).filter(([id, [, label]]) => label && (id.startsWith('space-') || ['scan', 'answer', 'open-editor'].includes(id))).map(([id]) => id);
  assert.deepEqual(side.filter((id) => !PRESSED.has(id)), [], 'every workspace-side pending label was pressed');
});

test('Delete on a fresh draft sends nothing: it is discarded; its menu offers no Scan, Sync or New task', async () => {
  const h = await projectsHost({ beforeScripts: undoTimers });
  h.w.RailPlaces.projects.newPick('hand-space'); await settle(100);
  page(h.d).querySelector('#pj-hand-v').value = 'Scratch'; page(h.d).querySelector('[data-confirm="yes"]').click(); await settle(150);
  page(h.d).querySelector('[data-menu="ws-more"]').click(); await settle(30);
  const offered = [...page(h.d).querySelectorAll('[data-menu-pick^="ws-more|"]')].map((b) => b.dataset.menuPick.split('|')[1]);
  assert.deepEqual(offered, ['edit', 'delete']);
  page(h.d).querySelector('[data-menu-pick="ws-more|delete"]').click(); await settle(80);
  page(h.d).querySelector('[data-confirm="yes"]').click(); await settle(80);
  assert.match(saidText(h.d), /Discarded Scratch/);
  for (const fn of h.w.__undo.splice(0)) await fn();   // any undo window closing still sends nothing
  await settle(80);
  assert.deepEqual(sent(h.calls), [], 'no request for a draft');
  assert.ok(!h.d.getElementById('bar-place').textContent.includes('Scratch'));
  assert.ok(!h.w.RailSpaces.list().some((w) => w.id.startsWith('draft:')));
});

test('fit: while its defaults are still being read, Change is off and a Labels change sends no PUT', async () => {
  const g = gate();
  const h = await projectsHost({ hash: HERE, hold: (u) => (u === `/api/workspaces/${WS}/defaults` ? g.p : null) });
  const change = () => [...page(h.d).querySelectorAll('.set-name')].find((n) => n.textContent.trim() === 'Labels')?.closest('.set-row')?.querySelector('.set-end button');
  assert.ok(change()?.disabled, 'Change is off while the defaults are read');
  change().click(); await settle(60);
  assert.equal(h.d.getElementById('def-labels'), null);
  assert.deepEqual(sent(h.calls), []);
  g.open(); await settle(200);
  assert.equal(change().disabled, false);
});

test('Scan again: a 428 toasts dev\'s message; Delete waits for the undo window and Undo sends no DELETE', async () => {
  const h = await projectsHost({ hash: HERE, beforeScripts: undoTimers, write: (u) => (u.endsWith('/scan') ? [428, { error: 'Pick a model for the scan first', code: 'SCAN_MODEL_REQUIRED' }] : [200, { ok: true }]) });
  page(h.d).querySelector('[data-ws="scan"]').click(); await settle(150);
  assert.match(saidText(h.d), /Pick a model for the scan first/);
  pickMore(h.d, 'delete'); await settle(80);
  page(h.d).querySelector('[data-confirm="yes"]').click(); await settle(80);
  assert.equal(sent(h.calls).filter(([m]) => m === 'DELETE').length, 0, 'nothing before the window closes');
  assert.ok(!h.w.RailSpaces.list().some((w) => w.id === WS), 'hidden at once');
  const undo = [...h.d.querySelectorAll('body > .rc-toast button')].find((b) => /undo|back/i.test(b.textContent + (b.title || '')));
  assert.ok(undo, 'the toast offers its undo');
  undo.click(); await settle(60);
  for (const fn of h.w.__undo.splice(0)) await fn();
  await settle(60);
  assert.equal(sent(h.calls).filter(([m]) => m === 'DELETE').length, 0, 'Undo sends no DELETE');
  assert.ok(h.w.RailSpaces.list().some((w) => w.id === WS), 'back');
});

test('a question\'s at link sends open-in-editor with the evidence file; its Yes sends the edge PUT; Cost tags send PUT …/defaults', async () => {
  const h = await projectsHost({ hash: HERE });
  noWould(h.w);
  const at = page(h.d).querySelector('[data-ws-at]');
  assert.equal(at.textContent.trim(), 'src/client.js:3');
  at.click(); await settle(120);
  assert.deepEqual(sent(h.calls).at(-1), ['POST', `/api/workspaces/${WS}/open-in-editor`, { projectKey: KEYS.ok, file: 'src/client.js' }]);
  assert.match(saidText(h.d), /Opened client\.js in your editor/);
  page(h.d).querySelector('[data-ws-yes]').click(); await settle(120);
  assert.deepEqual(sent(h.calls).at(-1), ['PUT', `/api/workspaces/${WS}/map/edges/e_shop_1`, { state: 'confirmed' }]);
  page(h.d).querySelector('[data-def-edit="tags"]').click(); await settle(30);
  assert.equal(h.d.getElementById('def-tags').value, 'team: shop', 'dev\'s stored tag, in the design\'s form');
  h.d.getElementById('def-tags').value = 'team: shop, cost-center: 7';
  page(h.d).querySelector('[data-def-edit="tags"]').click(); await settle(120);
  assert.deepEqual(sent(h.calls).at(-1), ['PUT', `/api/workspaces/${WS}/defaults`, { tags: ['team: shop', 'cost-center: 7'], labels: ['shop'] }]);
  assert.deepEqual(h.w.__would, []);
});

test('F-G-G5-06: a workspace question names its projects by name, never by key: the page, its Yes toast and the Pulse row', async () => {
  const h = await projectsHost({ hash: HERE });
  const q = page(h.d).querySelector('[data-ws-yes]').closest('.turn-row').textContent;
  assert.match(q, /seed-ok connects to seed-local\?/);
  const need = h.w.RailProjects.needItems().find((x) => x.kind === 'workspace');
  assert.equal(need.meta, 'Does seed-ok connect to seed-local?', 'the Pulse row');
  page(h.d).querySelector('[data-ws-yes]').click(); await settle(120);
  assert.match(saidText(h.d), /seed-ok connects to seed-local/);
  for (const t of [q, need.meta, saidText(h.d)]) assert.ok(!t.includes(KEYS.ok) && !t.includes(KEYS.local), `no raw key in "${t}"`);
});

test('F-G-G4-02: the workspace page names its projects (order, edit rows, map) by name, and draws its markdown description as Prose', async () => {
  const { marked } = await import('marked');
  const createDOMPurify = (await import('dompurify')).default;
  const md = '# Workspace: Seed shop\n\n## Overview\n\nA shop over **two** projects.';
  const spaces = clone(PJ_SOURCES.workspaces); spaces.workspaces[0].description = md;
  const h = await projectsHost({ hash: HERE, sources: { workspaces: spaces }, beforeScripts: (win) => { win.__worcaTestHooks = { askMarkdown: () => Promise.resolve({ marked, createDOMPurify }) }; } });
  await settle(200);
  const p = page(h.d);
  assert.match(p.querySelector('.ws-order').textContent, /seed-(ok|local) then seed-(ok|local)/, 'the order');
  const about = p.querySelector('.ws-about .prose');
  assert.ok(about, 'the description is the library\'s Prose');
  assert.ok(about.querySelector('h1, h2'), 'its headings are drawn, not raw');
  assert.doesNotMatch(p.querySelector('.ws-about').textContent, /^#|## Overview/m);
  pickMore(h.d, 'edit'); await settle(100);
  const names = [...p.querySelectorAll('.set-row-n, .sr-name, [class*="row-n"]')].map((x) => x.textContent.trim());
  for (const t of [p.textContent, ...names]) assert.ok(!t.includes(KEYS.ok) && !t.includes(KEYS.local), 'no raw key on the page');
});
