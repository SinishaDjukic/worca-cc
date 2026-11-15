// COV-1 (#1388): Stillhet's Add a project by hand offers every way classic adds a project — One folder (Choose folder…
// and the probe line), New folder (a name, Use git, where it is made) and Several folders… (the folder browser, then
// the review list) — and sends exactly classic's routes and bodies. The host is test/helpers/stillhet-projects-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectsHost, PJ_SOURCES, sent, noWould, settle, clone, closeHosts } from './helpers/stillhet-projects-host.mjs';
import { saidText } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const page = (d) => d.getElementById('route-place');
const yes = (d) => page(d).querySelector('.card-form [data-form="hand"] [data-confirm="yes"]');
const until = async (f, ms = 8000) => { for (let t = 0; t < ms && !f(); t += 50) await settle(50); };
const type = (h, sel, v) => { const el = page(h.d).querySelector(sel); el.value = v; el.dispatchEvent(new h.w.Event('input', { bubbles: true })); };
const rec = (key, name, path = `/src/${name}`) => ({ key, name, path, displayPath: path, exists: true, vcs: 'git', ownedFolder: false });
const ROOT = { root: '/w/projects', rootDisplay: '~/worca/projects' };
const DIRS = {
  '': { path: '/src', parent: '/', home: '/home/me', dirs: [{ name: 'a', path: '/src/a' }, { name: 'b', path: '/src/b' }, { name: 'c', path: '/src/c' }] },
  '/src/a': { path: '/src/a', parent: '/src', home: '/home/me', dirs: [] },
  '/home/me': { path: '/home/me', parent: '/home', home: '/home/me', dirs: [{ name: 'x', path: '/home/me/x' }, { name: 'y', path: '/home/me/y' }] },
};
const dirsOf = (u) => { const p = decodeURIComponent(u.split('path=')[1] || ''); return DIRS[p] ? [200, DIRS[p]] : [400, { error: 'no such directory' }]; };

/** The live host on Projects with the add form open on `way`; `list` is the store's projects (it grows with each add). */
async function addHost(way, { write = () => [200, { ok: true }], read = () => null, probe = () => [200, { exists: true, isDir: true, vcs: 'git' }], more = [] } = {}) {
  const st = { list: [...clone(PJ_SOURCES.projects.projects), ...more] };
  const h = await projectsHost({ write: (u, b, m) => write(u, b, m, st),
    read: (u) => (u === '/api/projects' ? [200, { projects: st.list }] : u.startsWith('/api/fs/dirs') ? dirsOf(u) : u.startsWith('/api/projects/probe') ? probe(decodeURIComponent(u.split('path=')[1])) : read(u)) });
  h.st = st;
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(120);
  if (way !== 'folder') { page(h.d).querySelector(`[data-pa-way="${way}"]`).click(); await settle(120); }
  return h;
}
const create = (u, b, m, st) => {
  if (u !== '/api/projects/create') return [200, { ok: true }];
  if (b.name === 'taken') return [400, { error: '/w/projects/taken already exists; pick another name', code: 'EXISTS', ...ROOT }];   // dev's own text (F-cov1-07)
  if (!b.name) return [400, { error: 'name is required', code: 'INVALID', ...ROOT }];
  if (b.dryRun) return [200, { ok: true, ...ROOT, path: `/w/projects/${b.name}`, displayPath: `~/worca/projects/${b.name}`, name: b.name }];
  st.list = [...st.list, rec(`${b.name}-1234abcd`, b.name, `/w/projects/${b.name}`)];
  return [201, { project: { key: `${b.name}-1234abcd`, name: b.name }, projects: st.list, ...ROOT }];
};

test('COV-1: the add form offers the three ways as one Segmented', async () => {
  const h = await addHost('folder');
  const ways = [...page(h.d).querySelectorAll('[data-pa-way]')];
  assert.deepEqual(ways.map((b) => b.textContent), ['One folder', 'New folder', 'Several folders…']);
  assert.equal(ways[0].getAttribute('aria-pressed'), 'true');
  assert.ok(page(h.d).querySelector('#pj-hand-v'), 'One folder: today\'s field');
  assert.ok(page(h.d).querySelector('[data-pa-choose]'), 'and Choose folder…');
  // F-cov1-04: + › Add a project… closes the bar's drawer (390px) instead of leaving it over the form
  h.d.body.classList.add('nav-open');
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  assert.equal(h.d.body.classList.contains('nav-open'), false, 'the drawer is closed');
  // F-cov1-03: before any pick, Several folders… shows one Browse folders…, the form's yes
  page(h.d).querySelector('[data-pa-way="many"]').click(); await settle(60);
  assert.equal([...page(h.d).querySelectorAll('.card-form button')].filter((b) => b.textContent.trim() === 'Browse folders…').length, 1);
});

test('COV-1 New folder: the dry run says where it is made (POST …/create {name, useGit, dryRun})', async () => {
  const h = await addHost('new', { write: create });
  type(h, '#pj-new-name', 'alpha'); await settle(400);
  assert.match(page(h.d).textContent, /Makes ~\/worca\/projects\/alpha/);
  assert.deepEqual(sent(h.calls).at(-1), ['POST', '/api/projects/create', { name: 'alpha', useGit: true, dryRun: true }]);
  assert.ok(page(h.d).querySelector('[data-pa-newgit]'), 'Use git shows: git is there');
});

test('COV-1 New folder: Create sends {name, useGit:true} and opens the project once the store lists it', async () => {
  const h = await addHost('new', { write: create });
  type(h, '#pj-new-name', 'alpha'); await settle(300);
  yes(h.d).click();
  await until(() => h.w.location.hash === '#projects/alpha-1234abcd');
  assert.deepEqual(sent(h.calls).at(-1), ['POST', '/api/projects/create', { name: 'alpha', useGit: true }]);
  assert.equal(h.w.location.hash, '#projects/alpha-1234abcd');
});

test('COV-1 New folder: with Use git off, Create sends no useGit', async () => {
  const h = await addHost('new', { write: create });
  page(h.d).querySelector('[data-pa-newgit]').click(); await settle(60);
  assert.equal(page(h.d).querySelector('[data-pa-newgit]').getAttribute('aria-checked'), 'false');
  type(h, '#pj-new-name', 'beta'); await settle(300);
  yes(h.d).click();
  await until(() => h.w.location.hash === '#projects/beta-1234abcd');
  assert.deepEqual(sent(h.calls).at(-1), ['POST', '/api/projects/create', { name: 'beta' }]);
});

test('COV-1 New folder: a refusal (400 EXISTS) is the field\'s words and the form stays', async () => {
  const h = await addHost('new', { write: create });
  type(h, '#pj-new-name', 'taken'); await settle(300);
  assert.match(page(h.d).querySelector('.fld-err')?.textContent || '', /A folder called taken already exists/);
  assert.equal(yes(h.d).disabled, true, 'Create is off while the dry run refuses');
  assert.equal(page(h.d).querySelector('#pj-new-name').value, 'taken');
  assert.equal(sent(h.calls).filter(([, , b]) => b && !b.dryRun).length, 0, 'nothing was created');
  assert.ok(!h.w.RailProjects.list().some((p) => p.name === 'taken'));
});

test('COV-1 Choose folder… reads GET /api/fs/dirs, goes into a folder, and Select fills the path and probes it', async () => {
  const h = await addHost('folder');
  page(h.d).querySelector('[data-pa-choose]').click(); await settle(150);
  assert.ok(h.calls.some((c) => c.method === 'GET' && c.url === '/api/fs/dirs?path='), 'opens at the top');
  const dlg = () => page(h.d).querySelector('.fb');
  assert.equal(dlg().querySelector('.dlg-title').textContent, 'Select a folder');
  dlg().querySelector('[data-fb-go="/src/a"]').click(); await settle(150);
  assert.ok(h.calls.some((c) => c.url === '/api/fs/dirs?path=%2Fsrc%2Fa'));
  assert.match(dlg().textContent, /No subfolders\./);
  dlg().querySelector('[data-dialog="yes"]').click(); await settle(200);
  assert.equal(dlg(), null, 'the dialog closes');
  assert.equal(page(h.d).querySelector('#pj-hand-v').value, '/src/a');
  assert.ok(h.calls.some((c) => c.method === 'GET' && c.url === '/api/projects/probe?path=%2Fsrc%2Fa'), 'the pick is probed');
  assert.match(page(h.d).querySelector('.fb-probe')?.textContent || '', /Git/);
});

test('COV-1 the probe line: Not found blocks Add; a plain folder shows Use git and Add sends useGit:true', async () => {
  const h = await addHost('folder', { probe: (p) => [200, p === '/src/gone' ? { exists: false } : { exists: true, isDir: true, vcs: 'none', files: 3 }],
    write: (u, b, m, st) => { st.list = [...st.list, rec('plain-1234abcd', 'plain')]; return [200, { projects: st.list }]; } });
  type(h, '#pj-hand-v', '/src/gone'); await settle(400);
  assert.match(page(h.d).querySelector('.fb-probe').textContent, /Not found/);
  assert.equal(yes(h.d).disabled, true, 'Not found blocks Add');
  assert.equal(page(h.d).querySelector('[data-pa-git]'), null);
  type(h, '#pj-hand-v', '/src/plain'); await settle(400);
  assert.match(page(h.d).querySelector('.fb-probe').textContent, /Folder.*No git.*3 files/s);
  const sw = page(h.d).querySelector('[data-pa-git]');
  assert.equal(sw.getAttribute('aria-checked'), 'false', 'Use git starts off');
  sw.click(); await settle(60);
  yes(h.d).click();
  await until(() => h.w.location.hash === '#projects/plain-1234abcd');
  assert.deepEqual(sent(h.calls).at(-1), ['POST', '/api/projects', { name: 'plain', path: '/src/plain', useGit: true }]);
});

test('COV-1 the probe line: a refused probe (400) shows its words in the field and blocks Add', async () => {
  const h = await addHost('folder', { probe: (p) => (p === '/etc/x' ? [400, { error: 'path is outside the allowed folders' }] : [200, { exists: true, isDir: true, vcs: 'git' }]) });
  type(h, '#pj-hand-v', '/etc/x'); await settle(400);
  assert.match(page(h.d).querySelector('.fld-err')?.textContent || '', /outside the allowed folders/);
  assert.equal(yes(h.d).disabled, true, 'a refused probe blocks Add');
  yes(h.d).click(); await settle(200);
  assert.equal(sent(h.calls).filter(([m, u]) => m === 'POST' && u === '/api/projects').length, 0, 'nothing was added');
  type(h, '#pj-hand-v', '/src/ok'); await settle(400);
  assert.equal(page(h.d).querySelector('.fld-err'), null, 'a new path clears it');
  assert.equal(yes(h.d).disabled, false);
});

const bulk = (skip = () => false) => (u, b, m, st) => {
  if (u !== '/api/projects/bulk') return [200, { ok: true }];
  const results = b.projects.map((p, index) => (skip(p) ? { index, status: 'skipped', name: p.name, path: p.path, reason: 'that name is taken' } : { index, status: 'added', key: `${p.name}-1234abcd`, name: p.name, path: p.path, vcs: 'git' }));
  st.list = [...st.list, ...results.filter((x) => x.status === 'added').map((x) => rec(x.key, x.name, x.path))];
  return [200, { projects: st.list, results }];
};
async function review(h) {
  yes(h.d).click(); await settle(150);   // Browse folders…
  const dlg = page(h.d).querySelector('.fb');
  assert.equal(dlg.querySelector('.dlg-title').textContent, 'Select folders');
  for (const p of ['/src/a', '/src/b']) { page(h.d).querySelector(`[data-fb-pick="${p}"]`).click(); await settle(30); }
  assert.equal(page(h.d).querySelector('.fb [data-dialog="yes"]').textContent, 'Add 2 selected');
  page(h.d).querySelector('.fb [data-dialog="yes"]').click(); await settle(100);
}

test('COV-1 Several folders: browse, tick two, Add 2 selected opens the review list with editable names', async () => {
  const h = await addHost('many', { write: bulk() });
  await review(h);
  assert.equal(page(h.d).querySelector('.fb'), null);
  const names = [...page(h.d).querySelectorAll('[data-fr-name]')];
  assert.deepEqual(names.map((n) => n.value), ['a', 'b']);
  assert.ok(names.every((n) => !n.disabled));
  assert.equal(yes(h.d).textContent, 'Add 2 projects');
});

test('COV-1 Several folders: Add 2 projects sends POST /api/projects/bulk with the picked paths and the edited names, kept across a redraw', async () => {
  const h = await addHost('many', { write: bulk() });
  await review(h);
  type(h, '[data-fr-name="1"]', 'bee');
  // a redraw between the rename and Add (a tick off and on again) keeps the edited name
  page(h.d).querySelector('[data-fr-pick="0"]').click(); await settle(60);
  page(h.d).querySelector('[data-fr-pick="0"]').click(); await settle(60);
  assert.equal(page(h.d).querySelector('[data-fr-name="1"]').value, 'bee', 'the field keeps the edited name');
  yes(h.d).click();
  await until(() => !page(h.d).querySelector('[data-fr-name]'));
  assert.deepEqual(sent(h.calls).at(-1), ['POST', '/api/projects/bulk', { projects: [{ name: 'a', path: '/src/a' }, { name: 'bee', path: '/src/b' }] }]);
  assert.match(saidText(h.d), /Added 2 projects/);
  assert.equal(h.w.location.hash, '#projects', 'two added: the Projects home stays');
});

test('COV-1 Several folders: a skipped row keeps its reason; renamed and added again, only that row is sent', async () => {
  const h = await addHost('many', { write: bulk((p) => p.name === 'b') });
  await review(h);
  const row = (i) => page(h.d).querySelector(`[data-fr-row="${i}"]`);
  yes(h.d).click(); await until(() => /Added/.test(row(0)?.textContent || ''));
  assert.match(row(0).textContent, /Added/);
  assert.equal(row(0).querySelector('[data-fr-name]').disabled, true);
  assert.match(row(1).textContent, /that name is taken/);
  row(1).querySelector('[data-fr-name]').value = 'b2';
  yes(h.d).click();
  await until(() => h.w.location.hash === '#projects/b2-1234abcd');
  assert.deepEqual(sent(h.calls).at(-1), ['POST', '/api/projects/bulk', { projects: [{ name: 'b2', path: '/src/b' }] }]);
  assert.equal(h.w.location.hash, '#projects/b2-1234abcd', 'the one project added: its page');
});

test('COV-1 Several folders: a folder the store keeps as ~/x is matched by its absolute path and starts unticked', async () => {
  const h = await addHost('many', { write: bulk(), more: [rec('x-1234abcd', 'x', '~/x')] });
  yes(h.d).click(); await settle(150);
  page(h.d).querySelector('.fb [data-fb-home]').click(); await settle(150);
  for (const p of ['/home/me/x', '/home/me/y']) { page(h.d).querySelector(`[data-fb-pick="${p}"]`).click(); await settle(30); }
  page(h.d).querySelector('.fb [data-dialog="yes"]').click(); await settle(100);
  assert.equal(page(h.d).querySelector('[data-fr-pick="0"]').checked, false, '~/x is already registered');
  assert.match(page(h.d).querySelector('[data-fr-row="0"]').textContent, /already registered as “x”/);
  assert.equal(page(h.d).querySelector('[data-fr-pick="1"]').checked, true);
});

test('COV-1 the folder browser: a 400 shows its words in the dialog and the listing stays', async () => {
  const h = await addHost('folder');
  page(h.d).querySelector('[data-pa-choose]').click(); await settle(150);
  page(h.d).querySelector('[data-fb-go="/src/c"]').click(); await settle(150);
  assert.equal(page(h.d).querySelector('.fb .dlg-status').textContent, 'Could not open c: no such directory');
  assert.ok(page(h.d).querySelector('.fb [data-fb-go="/src/a"]'), 'the last listing stays');
});

test('COV-1 nothing fake on live: before RailProjectsLive is up, Create says Worca is not answering and adds nothing', async () => {
  const h = await addHost('folder', { write: create });
  noWould(h.w);
  h.w.RailProjectsLive = undefined;
  page(h.d).querySelector('[data-pa-way="new"]').click(); await settle(120);
  type(h, '#pj-new-name', 'ghost'); await settle(300);
  assert.ok(!/~\/worca\/projects/.test(page(h.d).textContent), 'no demo location');
  yes(h.d).click(); await settle(150);
  assert.match(saidText(h.d), /Worca is not answering/);
  page(h.d).querySelector('[data-pa-way="many"]').click(); await settle(60);
  yes(h.d).click(); await settle(150);
  assert.equal(page(h.d).querySelector('.fb'), null, 'no demo folders');
  assert.deepEqual(sent(h.calls).filter(([, u]) => u.startsWith('/api/projects')), []);
  assert.ok(!h.w.RailProjects.list().some((p) => p.name === 'ghost'));
  assert.deepEqual(h.w.__would, []);
});
