// test/ui-project-add.test.mjs — the Add project dialog: New · Folder · Clone from URL, Use git, the live checks.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { PROBE_DEBOUNCE_MS, defaultAddMode, filesLabel, detectModel } from '../ui/public/project-add.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
class WSStub { constructor() { WSStub.last = this; this.readyState = 0; this._listeners = {}; } send() {} close() {}
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  _open() { this.readyState = 1; (this._listeners.open || []).forEach((fn) => fn({})); }
  _msg(o) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(o) })); } }
const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const DEFAULT_PROJECTS = [{ name: 'alpha', path: '/data/projects/alpha', exists: true, key: 'alpha-00000001', vcs: 'git' }];
// gitOff boots the shell with <html … data-git="off"> (what git-gate.mjs#gitOn reads; P0's git-app-boot does the same).
async function boot({ picker = false, pick, gitOff = false, create, probe, clone, projects = DEFAULT_PROJECTS, storage = {} } = {}) {
  let list = projects; const setProjects = (p) => { list = p; }; const calls = [];
  const shell = readFileSync(htmlPath, 'utf8');
  const html = gitOff ? shell.replace('<html lang="en" data-theme="system">', '<html lang="en" data-theme="system" data-git="off">') : shell;
  if (gitOff) assert.notEqual(html, shell, 'the shell anchor moved');
  const { window } = trackDom(new JSDOM(html, { url: 'http://localhost:4321/' }));
  window.Element.prototype.scrollIntoView = function () {}; window.WebSocket = WSStub; window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts = {}) => {
    const u = String(url); const method = opts.method || 'GET'; const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ u, method, body });
    if (u.startsWith('/api/git')) return json(200, { available: !gitOff, version: gitOff ? null : '2.50.0', reason: gitOff ? 'not-on-path' : 'ok', checkedAt: 0 });
    if (u.includes('/api/fs/pick-folder')) return method === 'GET' ? json(200, { available: picker }) : pick ? pick() : json(200, { status: 'unsupported' });
    if (u.includes('/api/projects/create')) return create ? create(body, { setProjects }) : json(404, { error: 'not found' });
    if (u.includes('/api/projects/clone')) return clone ? clone(u, opts) : json(404, { error: 'not found' });
    if (u.includes('/api/projects/probe')) return probe ? probe(decodeURIComponent(u.split('path=')[1] || '')) : json(404, { error: 'not found' });
    if (u.endsWith('/api/projects') && method === 'POST') { list = [...list, { name: body.name, path: body.path, key: 'new-00000009', exists: true, vcs: body.useGit ? 'git' : 'none' }]; return json(200, { projects: list }); }
    if (u.includes('/api/projects')) return json(200, { projects: list });
    if (u.includes('/api/history')) return json(200, { pipelines: [], ghAvailable: false });
    return json(200, { config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {} }
  globalThis.window = window; globalThis.document = window.document;
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(); if (WSStub.last) WSStub.last._open();
  window.location.hash = 'projects'; await tick(); await tick(); await tick();
  return { window, doc: window.document, calls, ws: WSStub.last, setProjects };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = () => new Promise((r) => setTimeout(r, PROBE_DEBOUNCE_MS + 60));
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const type = (window, node, v) => { node.value = v; node.dispatchEvent(new window.Event('input', { bubbles: true })); };
const $ = (doc, s) => doc.querySelector(s);
const selected = (doc) => [...doc.querySelectorAll('#proj-add-tabs .md-tab')].find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.mode;
async function openAdd(window, doc) { click(window, $(doc, '#project-add-btn')); await tick(); await tick(); }
const PROBES = {
  '/x/tax': { path: '/x/tax', exists: true, isDir: true, vcs: 'none', files: 214, filesCapped: false, insideRepo: false, partOf: null },
  '/x/repo': { path: '/x/repo', exists: true, isDir: true, vcs: 'git', files: null, filesCapped: false, insideRepo: false, partOf: null },
  '/x/repo/docs': { path: '/x/repo/docs', exists: true, isDir: true, vcs: 'none', files: null, filesCapped: false, insideRepo: true, partOf: 'worca-cc' },
  '/x/loose/docs': { path: '/x/loose/docs', exists: true, isDir: true, vcs: 'none', files: null, filesCapped: false, insideRepo: true, partOf: null },
  '/x/gone': { path: '/x/gone', exists: false, isDir: false, vcs: null, files: null, filesCapped: false, insideRepo: false, partOf: null },
};
const chips = (doc) => [...doc.querySelectorAll('#proj-add-detect > *')].map((n) => n.textContent);

test('pure: the default segment, the files label, the detect model', () => {
  assert.equal(defaultAddMode({}), 'new', 'canvas AddNew: New by default, picker or not');
  assert.equal(defaultAddMode({ path: '/Users/me/dev/cool' }), 'folder', 'a path handed in opens on Folder');
  assert.equal(defaultAddMode({ asked: 'clone', git: false }), 'new');
  assert.equal(defaultAddMode({ asked: 'clone', git: true }), 'clone');
  assert.equal(defaultAddMode({ asked: 'new', path: '/x' }), 'new');
  assert.deepEqual([filesLabel(1, false), filesLabel(214, false), filesLabel(5000, true), filesLabel(null, false)], ['1 file', '214 files', '5000+ files', '']);
  assert.deepEqual(detectModel(PROBES['/x/tax'], { git: true }).chips.map((c) => c.text), ['Folder', 'No git', '214 files']);
  assert.deepEqual(detectModel(PROBES['/x/tax'], { git: false }).chips.map((c) => c.text), ['Folder', '214 files'], 'no git word without git (S61)');
  assert.equal(detectModel(PROBES['/x/tax'], { git: false }).useGit, false);
  assert.deepEqual(detectModel({ projects: [] }), { chips: [], refused: false, useGit: false }, 'an answer without a probe shape is unknown, never a refusal');
});

test('detectModel (#693): a nested folder offers Add <root> or Open <name>; a worca-made nested repo warns with the fix', () => {
  assert.deepEqual(detectModel({ ...PROBES['/x/loose/docs'], repoRoot: '/x/loose' }, { git: true }).action,
    { kind: 'add-root', path: '/x/loose', label: 'Add loose' });
  assert.deepEqual(detectModel({ ...PROBES['/x/repo/docs'], repoRoot: '/x/repo' }, { git: true }).action,
    { kind: 'open', name: 'worca-cc', label: 'Open worca-cc' });
  assert.equal(detectModel(PROBES['/x/loose/docs'], { git: true }).action, undefined, 'no root (a limited viewer): no action');
  const made = detectModel({ path: '/x/r/svc', exists: true, isDir: true, vcs: 'git', files: null, filesCapped: false,
    insideRepo: false, partOf: null, repoRoot: '/x/r', nestedHint: 'HINT' }, { git: true });
  assert.deepEqual(made, { chips: [{ kind: 'git', text: 'Git', tone: '' }, { text: 'Nested repository', tone: 'warn' }],
    refused: false, useGit: false, note: 'HINT', action: { kind: 'add-root', path: '/x/r', label: 'Add r' } });
});

test('Add project opens on New (canvas AddNew) — Name, Location from the dry run, Use git off; Create project posts {name}', async () => {
  const R = '/Users/me/.worca-cc/projects';
  const made = { key: 'site-00000001', name: 'site', path: `${R}/site`, displayPath: '~/.worca-cc/projects/site', exists: true, vcs: 'none' };
  const { window, doc, calls } = await boot({ create: (b, { setProjects }) => {
    const roots = { root: R, rootDisplay: '~/.worca-cc/projects' };
    if (b.dryRun && !b.name) return json(400, { error: 'a project name is required', code: 'INVALID', ...roots });   // Task 4's route
    if (b.dryRun) return json(200, { ok: true, ...roots, path: `${R}/${b.name}`, displayPath: `~/.worca-cc/projects/${b.name}`, name: b.name });
    setProjects([made]);
    return json(201, { project: made, projects: [made], ...roots });
  } });
  await openAdd(window, doc); await settle();
  assert.equal(selected(doc), 'new');
  assert.equal($(doc, '#proj-add-new-pane').hidden, false);
  assert.equal($(doc, '#proj-add-folder-pane').hidden, true);
  assert.equal($(doc, '#proj-add-clone-pane').hidden, true);
  assert.equal($(doc, '#proj-add-name-field').hidden, false);
  assert.equal($(doc, '#proj-add-save').textContent, 'Create project');
  assert.equal($(doc, '#proj-add-location').readOnly, true);
  assert.equal($(doc, '#proj-add-location').value, '~/.worca-cc/projects', 'the S22 display path, like the canvas');
  assert.equal($(doc, '#proj-add-msg').textContent, '', 'an empty name is not a refusal');
  assert.equal($(doc, '#proj-add-save').disabled, false);
  assert.equal($(doc, '#proj-add-git-row').hidden, false);
  assert.ok($(doc, '#proj-add-git-row').hasAttribute('data-needs-git'));
  assert.equal($(doc, '#proj-add-git').checked, false, 'Use git is off by default (U11)');
  type(window, $(doc, '#proj-add-name'), 'site'); await settle();
  assert.equal($(doc, '#proj-add-location').value, '~/.worca-cc/projects/site');
  assert.equal($(doc, '#proj-add-location').title, `${R}/site`, 'the absolute path on hover');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects/create') && !c.body.dryRun).map((c) => c.body), [{ name: 'site' }]);
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), true);
  assert.ok([...doc.querySelectorAll('#projects-list .pl-item')].some((n) => n.dataset.name === 'site'));
});

test('New: a refusal shows inside the dialog and disables Create; Use git re-checks and rides the create body', async () => {
  const { window, doc, calls } = await boot({ create: (b) => {
    if (b.dryRun && b.name === 'CON') return json(400, { error: '"CON" is a reserved name on Windows', code: 'INVALID', root: '/w/p' });
    if (b.dryRun) return json(200, { ok: true, root: '/w/p', path: `/w/p/${b.name}`, name: b.name });
    return json(201, { project: { key: 'ok-00000002', name: b.name, path: `/w/p/${b.name}`, exists: true, vcs: 'git' }, projects: [], root: '/w/p' });
  } });
  await openAdd(window, doc);
  type(window, $(doc, '#proj-add-name'), 'CON'); await settle();
  assert.equal($(doc, '#proj-add-msg').textContent, '"CON" is a reserved name on Windows');
  assert.ok($(doc, '#proj-add-msg').classList.contains('err'));
  assert.equal($(doc, '#proj-add-save').disabled, true);
  type(window, $(doc, '#proj-add-name'), 'ok'); await settle();
  assert.equal($(doc, '#proj-add-save').disabled, false);
  assert.equal($(doc, '#proj-add-msg').textContent, '');
  const sw = $(doc, '#proj-add-git'); sw.checked = true; sw.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
  assert.equal(calls.filter((c) => c.u.endsWith('/api/projects/create')).at(-1).body.useGit, true, 'the dry run re-checks with Use git on');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects/create') && !c.body.dryRun).map((c) => c.body), [{ name: 'ok', useGit: true }]);
});

test('Folder pane (#693): a nested folder offers "Add <root>", which adds the repository root', async () => {
  const probes = {
    '/x/loose/docs': { ...PROBES['/x/loose/docs'], repoRoot: '/x/loose' },
    '/x/loose': { path: '/x/loose', exists: true, isDir: true, vcs: 'git', files: null, filesCapped: false, insideRepo: false, partOf: null },
  };
  const { window, calls } = await boot({ probe: (p) => json(200, probes[p]) });
  const doc = window.document;
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/loose/docs'); await settle();
  assert.deepEqual(chips(doc), ['Git', 'Inside a git repository'], 'the detect row is unchanged');
  const btn = $(doc, '#proj-add-root');
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, 'Add loose');
  assert.equal(btn.title, '/x/loose');
  click(window, btn); await settle();
  const posts = calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body);
  assert.deepEqual(posts, [{ name: 'loose', path: '/x/loose' }]);
});

test('Folder pane (#693): a folder inside a registered project offers "Open <name>"; a plain folder offers nothing', async () => {
  const probes = {
    '/x/repo/docs': { ...PROBES['/x/repo/docs'], repoRoot: '/x/repo' },
    '/x/plain': { path: '/x/plain', exists: true, isDir: true, vcs: 'none', files: 2, filesCapped: false, insideRepo: false, partOf: null },
  };
  const { window } = await boot({ probe: (p) => json(200, probes[p]),
    projects: [{ name: 'worca-cc', path: '/x/repo', key: 'worca-cc-00000001', exists: true, vcs: 'git' }] });
  const doc = window.document;
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/plain'); await settle();
  assert.equal($(doc, '#proj-add-root').hidden, true);
  type(window, $(doc, '#proj-add-path'), '/x/repo/docs'); await settle();
  assert.equal($(doc, '#proj-add-root').textContent, 'Open worca-cc');
  click(window, $(doc, '#proj-add-root')); await tick(); await tick();
  assert.ok(window.location.hash.startsWith('#projects/worca-cc-00000001'), window.location.hash);
  assert.ok($(doc, '#project-add-modal').classList.contains('hidden'));
});

test('Folder pane (AddFolder board): Folder · No git · 214 files + Use git; Git; Part of <name> / Inside a git repository / Not found block Add', async () => {
  const { window, doc, calls } = await boot({ picker: true, probe: (p) => json(200, PROBES[p]) });
  await openAdd(window, doc);
  assert.equal(selected(doc), 'new', 'New by default even where a folder picker exists (S61)');
  click(window, $(doc, '#proj-add-tab-folder'));
  const at = async (p) => { type(window, $(doc, '#proj-add-path'), p); await settle(); };
  await at('/x/tax');
  assert.deepEqual(chips(doc), ['Folder', 'No git', '214 files']);
  assert.ok($(doc, '#proj-add-detect .kind-chip.kind-folder'));
  assert.equal($(doc, '#proj-add-git-row').hidden, false);
  assert.equal($(doc, '#proj-add-save').disabled, false);
  await at('/x/repo');
  assert.deepEqual(chips(doc), ['Git']);
  assert.equal($(doc, '#proj-add-git-row').hidden, true, 'a folder with git needs no Use git');
  await at('/x/repo/docs');
  assert.deepEqual(chips(doc), ['Git', 'Part of worca-cc']);
  assert.ok($(doc, '#proj-add-detect .pad-chip.warn .ws-icon svg'), 'the AddFolder board\'s warning triangle');
  assert.match(readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8'), /#proj-add-path\{font-family:var\(--mono\);\}/, 'the folder path is mono, as on the board');
  assert.equal($(doc, '#proj-add-save').disabled, true);
  assert.equal($(doc, '#proj-add-save').getAttribute('aria-describedby'), 'proj-add-detect');
  assert.equal($(doc, '#proj-add-git-row').hidden, true);
  await at('/x/loose/docs');
  assert.deepEqual(chips(doc), ['Git', 'Inside a git repository']);
  await at('/x/gone');
  assert.deepEqual(chips(doc), ['Not found']);
  assert.equal($(doc, '#proj-add-save').disabled, true);
  await at('/x/tax');
  type(window, $(doc, '#proj-add-name'), 'Tax papers 2026');
  const sw = $(doc, '#proj-add-git'); sw.checked = true; sw.dispatchEvent(new window.Event('change', { bubbles: true }));
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body),
    [{ name: 'Tax papers 2026', path: '/x/tax', useGit: true }]);
});

test('git off: never Clone from URL, no `No git` chip and no Use git on Folder; the hidden git-only parts carry data-needs-git', async () => {
  const { window, doc } = await boot({ gitOff: true, probe: (p) => json(200, PROBES[p]) });
  await window.__projects.addProjectFlow({ mode: 'clone' }); await tick();
  assert.equal(selected(doc), 'new');
  assert.ok($(doc, '#proj-add-tab-clone').hasAttribute('data-needs-git'));
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/tax'); await settle();
  assert.deepEqual(chips(doc), ['Folder', '214 files']);
  assert.equal($(doc, '#proj-add-git-row').hidden, true, 'no Use git without git (U2)');
});

test('onAdded: the created project is reported once, and a closed dialog reports nothing', async () => {
  const made = { key: 'site-00000001', name: 'site', path: '/w/p/site', exists: true, vcs: 'none' };
  const { window, doc } = await boot({ create: (b) => (b.dryRun ? json(200, { ok: true, root: '/w/p' }) : json(201, { project: made, projects: [made], root: '/w/p' })) });
  const got = [];
  await window.__projects.addProjectFlow({ mode: 'new', onAdded: (p) => got.push(p.key) });
  click(window, $(doc, '#proj-add-cancel'));
  await window.__projects.addProjectFlow({ mode: 'new' });
  type(window, $(doc, '#proj-add-name'), 'site');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(got, [], 'closing drops the callback');
  await window.__projects.addProjectFlow({ mode: 'new', onAdded: (p) => got.push(p.key) });
  type(window, $(doc, '#proj-add-name'), 'site');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(got, ['site-00000001']);
});

test('onAdded follows a clone done from this dialog; a dialog closed while the clone runs reports nothing', async () => {
  let n = 0;
  const { window, doc, ws } = await boot({ clone: () => { n += 1; return json(202, { jobId: `cln_0000000${n}`, job: { id: `cln_0000000${n}`, state: 'running' } }); } });
  const got = [];
  const cloneIt = async () => {
    await window.__projects.addProjectFlow({ mode: 'clone', onAdded: (p) => got.push(p.key) }); await tick();
    type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
    click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  };
  await cloneIt();
  click(window, $(doc, '#proj-add-cancel'));
  ws._msg({ type: 'clone-changed', job: { id: 'cln_00000001', state: 'done', project: { key: 'api-00000001', name: 'api', path: '/w/p/api' } } }); await tick(); await tick();
  assert.deepEqual(got, [], 'closed while cloning: dropped');
  await cloneIt();
  ws._msg({ type: 'clone-changed', job: { id: 'cln_00000002', state: 'done', project: { key: 'api-00000002', name: 'api', path: '/w/p/api' } } }); await tick(); await tick();
  assert.deepEqual(got, ['api-00000002']);
});

test('a dialog reopened while an earlier clone runs never reports that clone to the new opener', async () => {
  const { window, doc, ws } = await boot({ clone: () => json(202, { jobId: 'cln_00000001', job: { id: 'cln_00000001', state: 'running' } }) });
  const got = [];
  await window.__projects.addProjectFlow({ mode: 'clone' }); await tick();
  type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  click(window, $(doc, '#proj-add-cancel'));
  await window.__projects.addProjectFlow({ mode: 'new', onAdded: (p) => got.push(p.key) }); await tick();
  assert.equal(selected(doc), 'clone', 'the running clone keeps its progress line');
  ws._msg({ type: 'clone-changed', job: { id: 'cln_00000001', state: 'done', project: { key: 'api-00000001', name: 'api', path: '/w/p/api' } } }); await tick(); await tick();
  assert.deepEqual(got, []);
});

test('a refusal names its reason: the detect row and an invalid path on Folder, the message on New — never a hidden row', async () => {
  const { window, doc } = await boot({ probe: (p) => json(200, PROBES[p]), create: (b) => (b.dryRun && b.name === 'CON'
    ? json(400, { error: '"CON" is a reserved name on Windows', code: 'INVALID', root: '/w/p' }) : json(200, { ok: true, root: '/w/p' })) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/repo/docs'); await settle();
  assert.equal($(doc, '#proj-add-save').getAttribute('aria-describedby'), 'proj-add-detect');
  assert.equal($(doc, '#proj-add-path').getAttribute('aria-describedby'), 'proj-add-detect');
  assert.equal($(doc, '#proj-add-path').getAttribute('aria-invalid'), 'true');
  click(window, $(doc, '#proj-add-tab-new'));
  type(window, $(doc, '#proj-add-name'), 'CON'); await settle();
  assert.equal($(doc, '#proj-add-save').disabled, true);
  assert.equal($(doc, '#proj-add-save').getAttribute('aria-describedby'), 'proj-add-msg');
  assert.equal($(doc, '#proj-add-path').hasAttribute('aria-invalid'), false);
});

test('a late probe answer never paints over a newer path (the sequence guard)', async () => {
  let release; const slow = new Promise((r) => { release = r; });
  const { window, doc } = await boot({ probe: (p) => (p === '/x/repo/docs' ? slow.then(() => json(200, PROBES[p])) : json(200, PROBES[p])) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/repo/docs'); await settle();
  type(window, $(doc, '#proj-add-path'), '/x/tax'); await settle();
  release(); await tick(); await tick(); await tick();
  assert.deepEqual(chips(doc), ['Folder', 'No git', '214 files']);
  assert.equal($(doc, '#proj-add-save').disabled, false);
});

test('a folder the native picker returns after a switch to New lands on Folder; Enter in Name saves', async () => {
  let release; const picked = new Promise((r) => { release = r; });
  const { window, doc, calls } = await boot({ picker: true, pick: () => picked.then(() => json(200, { status: 'picked', path: '/x/tax' })), probe: (p) => json(200, PROBES[p]) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  click(window, $(doc, '#proj-add-browse')); await tick();
  click(window, $(doc, '#proj-add-tab-new'));
  release(); await settle();
  assert.equal(selected(doc), 'folder');
  assert.equal($(doc, '#proj-add-path').value, '/x/tax');
  assert.deepEqual(chips(doc), ['Folder', 'No git', '214 files']);
  $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), [{ name: 'tax', path: '/x/tax' }]);
});

test('git going missing while the Folder pane shows re-checks the path: no `No git` chip, no Use git (S61)', async () => {
  const { window, doc, ws } = await boot({ probe: (p) => json(200, PROBES[p]) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/tax'); await settle();
  assert.deepEqual(chips(doc), ['Folder', 'No git', '214 files']);
  ws._msg({ type: 'git', git: { available: false, version: null } }); await settle();   // P0's frame (app.js applyGit(msg.git))
  assert.deepEqual(chips(doc), ['Folder', '214 files']);
  assert.equal($(doc, '#proj-add-git-row').hidden, true);
});

test('Enter while a save is in flight sends one request, and the save drops the pending live check', async () => {
  let release; const slow = new Promise((r) => { release = r; });
  const made = { key: 'site-00000001', name: 'site', path: '/w/p/site', exists: true, vcs: 'none' };
  const { window, doc, calls } = await boot({ create: (b) => (b.dryRun ? json(200, { ok: true, root: '/w/p', path: `/w/p/${b.name}`, name: b.name })
    : slow.then(() => json(201, { project: made, projects: [made], root: '/w/p' }))) });
  await openAdd(window, doc); await settle();
  const enter = () => $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  type(window, $(doc, '#proj-add-name'), 'site');             // no settle: the debounced dry run is still pending
  enter(); await tick(); enter(); await tick();
  await settle();
  const creates = calls.filter((c) => c.u.endsWith('/api/projects/create'));
  assert.deepEqual(creates.filter((c) => !c.body.dryRun).map((c) => c.body), [{ name: 'site' }], 'one create');
  assert.equal(creates.filter((c) => c.body.dryRun && c.body.name === 'site').length, 0, 'the save dropped the pending dry run');
  release(); await tick(); await tick();
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), true);
});

test('closing the dialog drops a live check still in flight', async () => {
  let release; const slow = new Promise((r) => { release = r; });
  const { window, doc } = await boot({ create: (b) => (b.dryRun && b.name === 'CON'
    ? slow.then(() => json(400, { error: '"CON" is a reserved name on Windows', code: 'INVALID', root: '/w/p' })) : json(200, { ok: true, root: '/w/p' })) });
  await openAdd(window, doc); await settle();
  type(window, $(doc, '#proj-add-name'), 'CON'); await settle();   // its dry run is in flight
  click(window, $(doc, '#proj-add-cancel'));
  release(); await tick(); await tick();
  assert.equal($(doc, '#proj-add-msg').textContent, '');
  assert.equal($(doc, '#proj-add-save').disabled, false);
});

test('git going missing during a clone: its error stays in the dialog, and a reopen keeps the progress line locked', async () => {
  let n = 0;
  const { window, doc, ws } = await boot({ clone: () => { n += 1; return json(202, { jobId: `cln_0000000${n}`, job: { id: `cln_0000000${n}`, state: 'running' } }); } });
  const start = async () => {
    await window.__projects.addProjectFlow({ mode: 'clone' }); await tick();
    type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
    click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  };
  await start();
  ws._msg({ type: 'git', git: { available: false, version: null } }); await tick();
  ws._msg({ type: 'clone-changed', job: { id: 'cln_00000001', state: 'error', error: 'git is not installed on this machine' } }); await settle();
  assert.equal($(doc, '#proj-add-msg').textContent, 'git is not installed on this machine');
  ws._msg({ type: 'git', git: { available: true, version: '2.50.0' } }); await tick();
  await start();
  click(window, $(doc, '#proj-add-cancel'));
  ws._msg({ type: 'git', git: { available: false, version: null } }); await tick();
  const realFetch = globalThis.fetch;                          // the reopen's refreshGit() must see no git either
  globalThis.fetch = window.fetch = (u, o) => (String(u).startsWith('/api/git')
    ? json(200, { available: false, version: null, reason: 'not-on-path', checkedAt: 0 }) : realFetch(u, o));
  await window.__projects.addProjectFlow(); await settle();
  assert.match($(doc, '#proj-add-msg').textContent, /^Cloning https:\/\/github\.com\/acme\/api/);
  assert.equal($(doc, '#proj-add-save').disabled, true, 'the clone form stays locked');
});

test('git going missing while New shows re-checks the name: a refusal without Use git disables Create', async () => {
  const { window, doc, ws } = await boot({ create: (b) => (b.dryRun && b.name === 'inrepo' && !b.useGit
    ? json(400, { error: 'Inside a git repository', code: 'NESTED_IN_REPO', root: '/w/p' }) : json(200, { ok: true, root: '/w/p', path: `/w/p/${b.name}`, name: b.name })) });
  await openAdd(window, doc);
  const sw = $(doc, '#proj-add-git'); sw.checked = true; sw.dispatchEvent(new window.Event('change', { bubbles: true }));
  type(window, $(doc, '#proj-add-name'), 'inrepo'); await settle();
  assert.equal($(doc, '#proj-add-save').disabled, false, 'Use git makes it its own repository');
  ws._msg({ type: 'git', git: { available: false, version: null } }); await settle();
  assert.equal($(doc, '#proj-add-save').disabled, true);
  assert.equal($(doc, '#proj-add-msg').textContent, 'Inside a git repository');
});

test('Folder: Enter before the probe answers never adds a folder the probe refuses', async () => {
  let rel; const slow = new Promise((r) => { rel = r; });
  const { window, doc, calls } = await boot({ probe: (p) => (p === '/x/gone' ? slow.then(() => json(200, PROBES[p])) : json(200, PROBES[p])) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/gone');
  type(window, $(doc, '#proj-add-name'), 'gone');
  $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(); await tick();
  rel(); await settle();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), [], 'Not found blocks Add, Enter or not');
  assert.deepEqual(chips(doc), ['Not found']);
  assert.equal($(doc, '#proj-add-save').disabled, true);
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false);
});

test('Folder: a quick Enter on a path the probe accepts still adds it', async () => {
  let rel; const slow = new Promise((r) => { rel = r; });
  const { window, doc, calls } = await boot({ probe: (p) => (p === '/x/tax' ? slow.then(() => json(200, PROBES[p])) : json(200, PROBES[p])) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/tax');
  type(window, $(doc, '#proj-add-name'), 'tax');
  $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
  rel(); await settle();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), [{ name: 'tax', path: '/x/tax' }]);
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), true);
});

test('Folder: two Enters while the probe and the save are in flight send one request', async () => {
  let rel; const slow = new Promise((r) => { rel = r; });
  let relPost; const slowPost = new Promise((r) => { relPost = r; });
  const { window, doc, calls } = await boot({ probe: (p) => (p === '/x/tax' ? slow.then(() => json(200, PROBES[p])) : json(200, PROBES[p])) });
  const real = globalThis.fetch;
  globalThis.fetch = window.fetch = (u, o = {}) => (String(u).endsWith('/api/projects') && o.method === 'POST' ? (calls.push({ u: String(u), method: 'POST', body: JSON.parse(o.body), held: true }), slowPost.then(() => json(200, { projects: [{ name: 'tax', path: '/x/tax', key: 'tax-00000001', exists: true, vcs: 'none' }] }))) : real(u, o));
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/tax');
  type(window, $(doc, '#proj-add-name'), 'tax');
  const enter = () => $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  enter(); await tick(); enter(); await tick();
  rel(); await tick(); await tick(); enter(); await tick();
  relPost(); await settle();
  assert.equal(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').length, 1);
  assert.equal(calls.filter((c) => c.u.includes('/api/projects/probe')).length, 1, 'one probe: the wait is not restarted');
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), true);
});

test('Folder: an Add after the probe answered asks the probe nothing more', async () => {
  const { window, doc, calls } = await boot({ probe: (p) => json(200, PROBES[p]) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/tax'); await settle();
  type(window, $(doc, '#proj-add-name'), 'tax');
  const n = calls.length;
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(calls.slice(n).filter((c) => c.u.includes('/api/projects/probe')).length, 0);
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), [{ name: 'tax', path: '/x/tax' }]);
});

test('Folder: a reopened dialog waits for its own probe, even for the path the last open probed', async () => {
  let slowGone = false; let rel; const slow = new Promise((r) => { rel = r; });
  const { window, doc, calls } = await boot({ probe: (p) => (p === '/x/gone' && slowGone ? slow.then(() => json(200, PROBES[p])) : json(200, PROBES[p])) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/gone'); await settle();
  assert.deepEqual(chips(doc), ['Not found']);
  click(window, $(doc, '#proj-add-cancel'));
  slowGone = true;
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/gone');
  type(window, $(doc, '#proj-add-name'), 'gone');
  $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(); await tick();
  rel(); await settle();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), []);
});

test('Folder: a refused path cleared and typed again waits for its probe before Add', async () => {
  let slowGone = false; let rel; const slow = new Promise((r) => { rel = r; });
  const { window, doc, calls } = await boot({ probe: (p) => (p === '/x/gone' && slowGone ? slow.then(() => json(200, PROBES[p])) : json(200, PROBES[p])) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/gone'); await settle();
  assert.deepEqual(chips(doc), ['Not found']);
  type(window, $(doc, '#proj-add-path'), ''); await settle();
  assert.equal($(doc, '#proj-add-save').disabled, false, 'an empty path clears the refusal');
  slowGone = true;
  type(window, $(doc, '#proj-add-path'), '/x/gone');
  type(window, $(doc, '#proj-add-name'), 'gone');
  $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(); await tick();
  rel(); await settle();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), [], 'Not found blocks Add again');
  assert.deepEqual(chips(doc), ['Not found']);
});

test('Folder: a path edited while Add waits for the probe is never added unprobed', async () => {
  let rel; const slow = new Promise((r) => { rel = r; });
  const { window, doc, calls } = await boot({ probe: (p) => (p === '/x/tax' ? slow.then(() => json(200, PROBES[p])) : json(200, PROBES[p])) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/tax');
  type(window, $(doc, '#proj-add-name'), 'tax');
  $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
  type(window, $(doc, '#proj-add-path'), '/x/gone'); await tick();
  rel(); await settle();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), []);
  assert.deepEqual(chips(doc), ['Not found']);
  assert.equal($(doc, '#proj-add-save').disabled, true);
});

test('Use git turned on in New is off again on Folder: an existing folder is git-initialised only when asked there (U11)', async () => {
  const { window, doc, calls } = await boot({ probe: (p) => json(200, PROBES[p]) });
  await openAdd(window, doc);
  const sw = $(doc, '#proj-add-git'); sw.checked = true; sw.dispatchEvent(new window.Event('change', { bubbles: true }));
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/tax'); await settle();
  type(window, $(doc, '#proj-add-name'), 'tax');
  assert.equal($(doc, '#proj-add-git-row').hidden, false);
  assert.equal($(doc, '#proj-add-git').checked, false);
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), [{ name: 'tax', path: '/x/tax' }]);
});

test('the AddNew board\'s Location box holds a folder icon; the AddFolder path takes its own row', () => {
  const doc = new JSDOM(readFileSync(htmlPath, 'utf8')).window.document;
  const loc = doc.getElementById('proj-add-location');
  assert.ok(loc.parentElement.matches('#proj-add-new-pane .field > .proj-add-loc'), 'Location is wrapped by .proj-add-loc');
  const ico = loc.parentElement.querySelector(':scope > svg[aria-hidden="true"]');
  assert.ok(ico, 'a decorative icon');
  assert.match(ico.innerHTML, /M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z/, 'the board\'s folder path');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.proj-add-loc > #proj-add-location\{padding-left:40px;\}/);
  assert.match(css, /#proj-add-folder-pane \.path-row\{flex-wrap:wrap;\}/);
  assert.match(css, /#proj-add-folder-pane \.path-row > input\{flex:1 1 100%;\}/);
});

test('Folder: back from New, an Add before the re-probe answers still waits for it', async () => {
  let hold = false; let rel; const slow = new Promise((r) => { rel = r; });
  const { window, doc, calls } = await boot({ probe: (p) => (hold ? slow.then(() => json(200, PROBES[p])) : json(200, PROBES[p])),
    create: (b) => json(200, { ok: true, root: '/w/p', path: `/w/p/${b.name}`, name: b.name }) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/gone'); await settle();
  type(window, $(doc, '#proj-add-name'), 'gone');
  assert.deepEqual(chips(doc), ['Not found']);
  click(window, $(doc, '#proj-add-tab-new')); await settle();
  hold = true;
  click(window, $(doc, '#proj-add-tab-folder')); await tick(); await tick();   // its re-probe is in flight
  $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(); await tick();
  rel(); await settle();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), [], 'Not found still blocks Add after a segment switch');
  assert.deepEqual(chips(doc), ['Not found']);
  assert.equal($(doc, '#proj-add-save').disabled, true);
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false);
});

test('Folder: a probe that fails during Add\'s wait leaves Save usable after "Name is required."', async () => {
  let reject = true;
  const { window, doc, calls } = await boot({ probe: (p) => (reject ? Promise.reject(new TypeError('Failed to fetch')) : json(200, PROBES[p])) });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  type(window, $(doc, '#proj-add-path'), '/x/tax');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick(); await settle();
  assert.equal($(doc, '#proj-add-msg').textContent, 'Name is required.');
  assert.equal($(doc, '#proj-add-save').disabled, false, 'nothing refused: Save stays usable');
  reject = false;
  type(window, $(doc, '#proj-add-name'), 'tax');
  $(doc, '#proj-add-name').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick(); await tick(); await settle();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').map((c) => c.body), [{ name: 'tax', path: '/x/tax' }]);
});

test('a projects-changed frame refreshes the list on any view: New run lists a project made elsewhere and keeps the selection', async () => {
  const alpha = { name: 'alpha', path: '/p/alpha', exists: true, key: 'alpha-00000001', vcs: 'git' };
  const { window, doc, ws, calls, setProjects } = await boot({ projects: [alpha] });
  window.location.hash = 'new'; await tick(); await tick();
  const sel = doc.querySelector('#projectSelect');
  sel.selectedIndex = 1; sel.dispatchEvent(new window.Event('change', { bubbles: true })); await tick();
  setProjects([alpha, { name: 'site', path: '/w/p/site', exists: true, key: 'site-00000001', vcs: 'none' }]);
  const n = calls.length;
  ws._msg({ type: 'projects-changed', action: 'created' }); await tick(); await tick();
  assert.deepEqual(calls.slice(n).map((c) => c.u).filter((u) => /^\/api\/(config|run-defaults|branches)\b/.test(u)), [], 'quiet: New run keeps its engine and branch state');
  assert.deepEqual([...sel.options].map((o) => o.textContent).filter((t) => t === 'site'), ['site']);
  assert.equal(sel.selectedOptions[0].dataset.name, 'alpha');
});

test('a projects-changed frame keeps New run\'s inline "+ Add project…" form selected', async () => {
  const alpha = { name: 'alpha', path: '/p/alpha', exists: true, key: 'alpha-00000001', vcs: 'git' };
  const { window, doc, ws, setProjects } = await boot({ projects: [alpha] });
  window.location.hash = 'new'; await tick(); await tick();
  const sel = doc.querySelector('#projectSelect');
  sel.value = '__add__'; sel.dispatchEvent(new window.Event('change', { bubbles: true })); await tick();
  setProjects([alpha, { name: 'site', path: '/w/p/site', exists: true, key: 'site-00000001', vcs: 'none' }]);
  ws._msg({ type: 'projects-changed', action: 'created' }); await tick(); await tick();
  assert.equal(sel.value, '__add__');
  assert.deepEqual([...sel.options].map((o) => o.textContent).filter((t) => t === 'site'), ['site'], 'the list still refreshed');
});

test('a projects-changed refresh keeps a project the user picked while its GET was in flight', async () => {
  const alpha = { name: 'alpha', path: '/p/alpha', exists: true, key: 'alpha-00000001', vcs: 'git' };
  const beta = { name: 'beta', path: '/p/beta', exists: true, key: 'beta-00000001', vcs: 'git' };
  const { window, doc, ws, setProjects } = await boot({ projects: [alpha, beta], storage: { 'worca-cc.lastProject': 'alpha' } });
  window.location.hash = 'new'; await tick(); await tick(); await tick();
  const sel = doc.querySelector('#projectSelect');
  assert.equal(sel.value, '/p/alpha');
  let rel; const hold = new Promise((r) => { rel = r; });
  const real = globalThis.fetch;
  globalThis.fetch = window.fetch = (u, o = {}) => (String(u) === '/api/projects' && (o.method || 'GET') === 'GET' ? hold.then(() => real(u, o)) : real(u, o));
  setProjects([alpha, beta, { name: 'site', path: '/w/p/site', exists: true, key: 'site-00000001', vcs: 'none' }]);
  ws._msg({ type: 'projects-changed', action: 'created' }); await tick();
  sel.selectedIndex = 2; sel.dispatchEvent(new window.Event('change', { bubbles: true })); await tick();
  rel(); await tick(); await tick(); await tick();
  assert.equal(sel.value, '/p/beta', 'the pick made during the refresh stays');
  assert.deepEqual([...sel.options].map((o) => o.textContent).filter((t) => t === 'site'), ['site'], 'the list still refreshed');
});

test('a projects-changed refresh that fails keeps New run\'s list and selection', async () => {
  const alpha = { name: 'alpha', path: '/p/alpha', exists: true, key: 'alpha-00000001', vcs: 'git' };
  const beta = { name: 'beta', path: '/p/beta', exists: true, key: 'beta-00000001', vcs: 'git' };
  const { window, doc, ws, calls } = await boot({ projects: [alpha, beta], storage: { 'worca-cc.lastProject': 'beta' } });
  window.location.hash = 'new'; await tick(); await tick(); await tick();
  const sel = doc.querySelector('#projectSelect');
  assert.equal(sel.value, '/p/beta');
  const real = globalThis.fetch; let fail = 'reject';
  globalThis.fetch = window.fetch = (u, o = {}) => (String(u) === '/api/projects' && (o.method || 'GET') === 'GET'
    ? (fail === 'reject' ? Promise.reject(new TypeError('Failed to fetch')) : json(500, { error: 'EBUSY' })) : real(u, o));
  const n = calls.length;
  ws._msg({ type: 'projects-changed', action: 'created' }); await tick(); await tick(); await tick();
  fail = '500';
  ws._msg({ type: 'projects-changed', action: 'created' }); await tick(); await tick(); await tick();
  assert.equal(sel.value, '/p/beta');
  assert.deepEqual([...sel.options].map((o) => o.dataset.name).filter(Boolean), ['alpha', 'beta']);
  assert.deepEqual(calls.slice(n).map((c) => c.u).filter((u) => /^\/api\/(config|run-defaults|branches)\b/.test(u)), [], 'New run keeps its engine and branch state');
});

test('a projects-changed refresh under the Workspace target leaves New run\'s engine pick alone', async () => {
  const alpha = { name: 'alpha', path: '/p/alpha', exists: true, key: 'alpha-00000001', vcs: 'git' };
  const beta = { name: 'beta', path: '/p/beta', exists: true, key: 'beta-00000001', vcs: 'git' };
  const { window, doc, ws, calls, setProjects } = await boot({ projects: [alpha, beta], storage: { 'worca-cc.lastProject': 'alpha', 'worca-cc.runTarget': 'workspace' } });
  const real = globalThis.fetch;
  globalThis.fetch = window.fetch = (u, o = {}) => (String(u).startsWith('/api/run-defaults')
    ? (calls.push({ u: String(u), method: 'GET', body: null }), json(200, { engine: { value: 'claude', source: 'user' }, steps: null, tags: [] })) : real(u, o));
  window.location.hash = 'new'; await tick(); await tick(); await tick(); await tick(); await tick();
  const eng = doc.querySelector('#engineSelect');
  eng.value = 'codex'; eng.dispatchEvent(new window.Event('change', { bubbles: true })); await tick();
  setProjects([beta]);
  const n = calls.length;
  ws._msg({ type: 'projects-changed', action: 'deleted' }); await tick(); await tick(); await tick(); await tick();
  assert.deepEqual([...doc.querySelector('#projectSelect').options].map((o) => o.dataset.name).filter(Boolean), ['beta'], 'the list refreshed');
  assert.equal(eng.value, 'codex', 'the hidden project select is not the workspace run\'s');
  assert.deepEqual(calls.slice(n).map((c) => c.u).filter((u) => /^\/api\/(config|run-defaults|branches)\b/.test(u)), []);
});

test('New: a refusal from Create itself keeps Create off until the name changes; a failure (500) leaves it on', async () => {
  const { window, doc, calls } = await boot({ create: (b) => {
    if (b.dryRun) return json(200, { ok: true, root: '/w/p', path: `/w/p/${b.name}`, name: b.name });
    if (b.name === 'site') return json(400, { error: '/w/p/site already exists; pick another name', code: 'EXISTS', root: '/w/p' });
    if (b.name === 'boom') return json(500, { error: 'could not create /w/p/boom: EACCES', code: 'FAILED', root: '/w/p' });
    return json(201, { project: { key: 'site2-00000002', name: b.name, path: `/w/p/${b.name}`, exists: true, vcs: 'none' }, projects: [], root: '/w/p' });
  } });
  await openAdd(window, doc);
  type(window, $(doc, '#proj-add-name'), 'boom'); await settle();
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.equal($(doc, '#proj-add-msg').textContent, 'could not create /w/p/boom: EACCES');
  assert.equal($(doc, '#proj-add-save').disabled, false, 'a failure is no refusal: Create stays on for another try');
  type(window, $(doc, '#proj-add-name'), 'site'); await settle();
  assert.equal($(doc, '#proj-add-save').disabled, false, 'the dry run passed (the folder appeared after it)');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.equal($(doc, '#proj-add-msg').textContent, '/w/p/site already exists; pick another name');
  assert.equal($(doc, '#proj-add-save').disabled, true, 'a refused name keeps Create off');
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false, 'the dialog stays open');
  type(window, $(doc, '#proj-add-name'), 'site2'); await settle();
  assert.equal($(doc, '#proj-add-save').disabled, false, 'a new name that passes the live check turns it back on');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects/create') && !c.body.dryRun).map((c) => c.body.name), ['boom', 'site', 'site2']);
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), true);
});

test('New: a late refusal for a name the user changed while Create was in flight leaves Create on for the new name', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { window, doc, calls } = await boot({ create: (b) => {
    if (b.dryRun) return json(200, { ok: true, root: '/w/p', path: `/w/p/${b.name}`, name: b.name });
    if (b.name === 'site') return held.then(() => json(400, { error: '/w/p/site already exists; pick another name', code: 'EXISTS', root: '/w/p' }));
    return json(201, { project: { key: 'site2-00000002', name: b.name, path: `/w/p/${b.name}`, exists: true, vcs: 'none' }, projects: [], root: '/w/p' });
  } });
  await openAdd(window, doc);
  type(window, $(doc, '#proj-add-name'), 'site'); await settle();
  click(window, $(doc, '#proj-add-save')); await tick();
  type(window, $(doc, '#proj-add-name'), 'site2'); await settle();
  release(); await tick(); await tick(); await tick();
  assert.equal($(doc, '#proj-add-save').disabled, false, 'the refusal named "site"; "site2" passed its own check');
  click(window, $(doc, '#proj-add-save')); await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.u.endsWith('/api/projects/create') && !c.body.dryRun).map((c) => c.body.name), ['site', 'site2']);
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), true);
});
