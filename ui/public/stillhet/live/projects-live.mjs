// ui/public/stillhet/live/projects-live.mjs — Stillhet's Projects and Workspaces in the live kind (slice 9 D3): the one
// module that writes them through dev's routes. Every request is built from PROJECT_ACTIONS; every action answers
// { ok, text } (text: the toast; a refusal is `Could not WORDS NAME: ` plus dev's answer in plain words, plainWhy). The lists stay the shared
// store's (RailWorld.part('projects' | 'spaces')): after a write this module asks the adapter to read them again and
// never edits a record. Client state of its own: what each action is doing (pending), what waits for its undo window
// (hidden), what was removed until the store drops it (gone), a fresh workspace's draft until Save, each project's and
// workspace's page detail, and clone jobs. An action answers a key to go to only once the store lists it (listed).
import { SET_KEYS, setsOf, patchOf, defaultsOf } from './projects-map.mjs';
import { folderName, reviewSummary } from '../../design-system/components/folder-browser.mjs';

const enc = encodeURIComponent;
// id → [the words a refusal starts with, the pending label its control shows while dev answers (D22), args → [method, url, body?]]
export const PROJECT_ACTIONS = Object.freeze({
  add: ['add', 'Adding…', ({ name, path, useGit }) => ['POST', '/api/projects', { name, path, ...(useGit === true ? { useGit: true } : {}) }]],
  // COV-1: the ways classic adds a project (the folder browser, the probe line, New folder, Several folders…)
  dirs: ['open', '', ({ path }) => ['GET', `/api/fs/dirs?path=${enc(path || '')}`]],
  probe: ['check', '', ({ path }) => ['GET', `/api/projects/probe?path=${enc(path)}`]],
  'git-available': ['read', '', () => ['GET', '/api/git']],
  create: ['create', 'Creating…', ({ name, useGit, dryRun }) => ['POST', '/api/projects/create', { name, ...(useGit ? { useGit: true } : {}), ...(dryRun ? { dryRun: true } : {}) }]],
  bulk: ['add', 'Adding…', ({ rows }) => ['POST', '/api/projects/bulk', { projects: rows.map(({ name, path }) => ({ name, path })) }]],
  clone: ['clone', 'Adding…', ({ url }) => ['POST', '/api/projects/clone', { url }]],
  rename: ['rename', 'Renaming…', ({ key, name }) => ['PATCH', `/api/projects/${enc(key)}`, { name }]],
  relocate: ['move', 'Moving…', ({ key, path }) => ['PATCH', `/api/projects/${enc(key)}`, { path }]],
  sync: ['sync', 'Syncing…', ({ key }) => ['POST', `/api/projects/${enc(key)}/sync`, { mode: 'ff' }]],
  fetch: ['check', 'Checking…', ({ key }) => ['POST', `/api/projects/${enc(key)}/sync`, { mode: 'fetch' }]],
  git: ['set up git in', 'Setting up git…', ({ key }) => ['POST', `/api/projects/${enc(key)}/git-init`, {}]],
  link: ['link', 'Linking…', ({ key, url }) => ['POST', `/api/projects/${enc(key)}/git-init`, { remoteUrl: url }]],
  remove: ['remove', '', ({ name, owned }) => ['DELETE', `/api/projects?name=${enc(name)}${owned ? '&deleteFolder=1' : ''}`]],
  'read-settings': ['read', '', ({ key }) => ['GET', `/api/projects/${enc(key)}/settings`]],
  'read-defaults': ['read', '', ({ key }) => ['GET', `/api/projects/${enc(key)}/tags/defaults`]],
  set: ['change', 'Saving…', ({ key, patch }) => ['PATCH', `/api/projects/${enc(key)}/settings`, patch]],
  team: ['change', 'Saving…', ({ key, patch }) => ['PATCH', `/api/projects/${enc(key)}/settings`, patch]],
  defaults: ['save', 'Saving…', ({ key, tags, labels }) => ['PUT', `/api/projects/${enc(key)}/tags/defaults`, { tags, labels }]],
  'space-create': ['save', 'Saving…', ({ name, paths }) => ['POST', '/api/workspaces', { name, projectPaths: paths }]],
  'space-rename': ['save', 'Saving…', ({ id, name }) => ['PATCH', `/api/workspaces/${enc(id)}`, { name }]],
  'space-add': ['save', 'Saving…', ({ id, paths }) => ['POST', `/api/workspaces/${enc(id)}/members`, { add: paths }]],
  'space-remove': ['save', 'Saving…', ({ id, path }) => ['POST', `/api/workspaces/${enc(id)}/members`, { remove: path, rescan: 'none' }]],
  'space-read-defaults': ['read', '', ({ id }) => ['GET', `/api/workspaces/${enc(id)}/defaults`]],
  'space-defaults': ['save', 'Saving…', ({ id, tags, labels }) => ['PUT', `/api/workspaces/${enc(id)}/defaults`, { tags, labels }]],
  'space-delete': ['delete', '', ({ id }) => ['DELETE', `/api/workspaces/${enc(id)}`]],
  'space-sync': ['sync', 'Syncing…', ({ key }) => ['POST', `/api/projects/${enc(key)}/sync`, { mode: 'ff' }]],
  scan: ['scan', 'Scanning…', ({ id }) => ['POST', `/api/workspaces/${enc(id)}/scan`, {}]],
  answer: ['answer', 'Saving…', ({ id, edgeId, state }) => ['PUT', `/api/workspaces/${enc(id)}/map/edges/${enc(edgeId)}`, { state: state === 'auto' ? null : state }]],
  'open-editor': ['open', 'Opening…', ({ id, projectKey, file }) => ['POST', `/api/workspaces/${enc(id)}/open-in-editor`, { projectKey, file }]],
});
export const NOT_ANSWERING = 'Worca is not answering';
const HIDE_MAX_MS = 30000;   // a sent Remove or Delete that never hears back shows its row again after this (one dev removed stays hidden)
const LISTED_POLL_MS = 100, LISTED_MAX_MS = 10000;   // after an add or a move: how often, and how long, to look for the key in the store
const MAX_MEMBERS = 40;
// dev's refusal phrases → the plain reason of `Could not VERB NAME: REASON` (fail.task-action, fail.no-raw); first match wins
const WHY_WORDS = [
  [/not found/i, 'it no longer exists'],
  [/at least 2 (distinct )?member projects/, 'a workspace needs at least two projects'],
  [/at most 40 member projects/, 'a workspace holds at most 40 projects'],
  [/exact project set already exists/, 'another workspace has exactly these projects'],
  [/once spanned this project set/, 'that name was used for these projects before; choose another'],
  [/while a run or scan owns it/, 'a task or a scan is using it; try again when it ends'],
  [/delete a workspace with a live run/, 'a task is running in it; try again when it ends'],
];
/** Dev's answer as the plain REASON of a refusal line: never `HTTP n`, never a bare code; a plain sentence passes. */
export function plainWhy({ status, error } = {}) {
  if (status === 0) return NOT_ANSWERING;
  const e = String(error || '').trim(), row = WHY_WORDS.find(([re]) => re.test(e));
  if (row) return row[1];
  if (e && !/^[A-Z][A-Z0-9_]+$/.test(e) && !/^HTTP \d+$/.test(e)) return e;
  return status === 404 ? 'it no longer exists' : status === 409 ? 'something else is using it right now' : status === 400 || status === 422 ? 'Worca could not use what was given'
    : status >= 500 ? "something went wrong on Worca's side" : 'Worca refused it';
}
const REPO = /^(https?:\/\/|ssh:\/\/|git@)\S+$/;
const FF_WHY = { diverged: 'it has diverged', dirty: 'it has uncommitted changes', 'not-behind': 'it is not behind' };
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const lastSeg = (v) => (String(v).split(/[/:]/).filter(Boolean).pop() || '').replace(/\.git$/, '');
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

export function startProjectsLive({ fetch, toast = () => {}, refresh = () => {}, world = () => ({ projects: [], spaces: [] }), go = () => {}, at = () => globalThis.location?.hash || '', on = () => {}, setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout }) {
  const busy = new Map(), hide = new Map(), gone = new Set(), moving = new Set(), fresh = new Map(), details = new Map(), spaceDetails = new Map(), clones = new Map();

  async function send(id, args = {}) {
    const [, , build] = PROJECT_ACTIONS[id], [method, url, body] = build(args);
    let r;
    try { r = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { return { ok: false, status: 0, data: {}, error: NOT_ANSWERING }; }
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: data || {}, error: r.ok ? '' : data?.error || data?.message || '' };
  }
  const project = (key) => world().projects?.find((p) => p.id === key) || null;
  const space = (id) => world().spaces?.find((w) => w.id === id) || fresh.get(id) || null;
  const nameOf = (key) => project(key)?.name || key;
  const refused = (action, title, a) => ({ ok: false, text: a.status === 0 ? NOT_ANSWERING : `Could not ${PROJECT_ACTIONS[action][0]} ${title}: ${plainWhy(a)}` });
  const lists = (kind, id) => !!(world()[kind] || []).some((x) => x.id === id);
  /** Resolves true once the store lists `id` (a project: and it is not gone), false after LISTED_MAX_MS. Sends nothing. */
  function listed(kind, id) {
    if (!id) return Promise.resolve(false);
    return new Promise((resolve) => {
      let spent = 0;
      const look = () => {
        if (lists(kind, id) && !(kind === 'projects' && gone.has(id))) { resolve(true); return; }
        if (spent >= LISTED_MAX_MS) { resolve(false); return; }
        spent += LISTED_POLL_MS; later(look, LISTED_POLL_MS);
      };
      look();
    });
  }
  /** What may be read: listed in the store, not waiting for its undo window, not removed, not the old key of a move. */
  const readable = (id) => (lists('projects', id) || lists('spaces', id)) && !hide.has(id) && !gone.has(id) && !moving.has(id);
  /** One action at a time per target: a second press while one runs answers { ok:false, text:'' } and sends nothing. */
  async function once(target, action, fn) {
    if (busy.has(target)) return { ok: false, text: '' };
    busy.set(target, PROJECT_ACTIONS[action][1]); on();
    try { return await fn(); } finally { busy.delete(target); on(); }
  }

  // ---- projects ----
  function addProject(input, { useGit } = {}) {
    const v = String(input || '').trim();
    return once('add', REPO.test(v) ? 'clone' : 'add', async () => {
      const name = lastSeg(v);
      if (REPO.test(v)) {
        const a = await send('clone', { url: v });
        if (!a.ok) return a.status === 400 || a.status === 409 ? { ok: false, field: plainWhy(a) } : refused('clone', name, a);
        clones.set(a.data.jobId || a.data.job?.id, { name: a.data.job?.name || name, from: at() });   // where the person was: it routes only if they still are
        return { ok: true, text: `Cloning ${a.data.job?.name || name}…` };
      }
      const a = await send('add', { name, path: v, useGit });
      if (!a.ok) return a.status === 400 ? { ok: false, field: plainWhy(a) } : refused('add', name, a);
      refresh('projects', 'sync');
      const key = (a.data.projects || []).find((p) => p.name === name)?.key;
      if (key) gone.delete(key);   // the same folder added again right after its removal
      return { ok: true, text: `Added ${name}`, ...(key && await listed('projects', key) ? { key } : {}) };
    });
  }
  // ---- COV-1: the folder browser, the probe line, New folder and Several folders… (classic's routes and bodies) ----
  const down = { ok: false, text: NOT_ANSWERING };
  /** One folder's listing (GET /api/fs/dirs); nothing is cached. */
  async function folders(path = '') {
    const a = await send('dirs', { path });
    if (a.status === 0) return down;
    if (!a.ok) return { ok: false, text: `Could not open ${folderName(path) || 'the folder'}: ${plainWhy(a)}` };
    const d = a.data;
    return { ok: true, path: d.path || '', parent: d.parent ?? null, home: d.home || '', dirs: d.dirs || [], limited: !!d.limited, roots: d.roots || [] };
  }
  /** What a typed folder is (GET /api/projects/probe). A stale answer is the caller's to drop. */
  async function probe(path) {
    const a = await send('probe', { path });
    if (a.status === 0) return down;
    return a.ok ? { ok: true, probe: a.data } : { ok: false, field: plainWhy(a) };
  }
  /** Whether git is installed (GET /api/git): any failure counts as installed, as classic does. */
  async function gitAvailable() {
    const a = await send('git-available');
    return a.ok && a.data?.available === false ? false : true;
  }
  const whereOf = (d = {}) => d.displayPath || d.path || d.rootDisplay || d.root || '';
  // New folder's EXISTS in Stillhet's words, as One folder and the demo say it (F-cov1-07); never dev's path-laden text
  const newWhy = (a, n) => (a.data?.code !== 'EXISTS' ? plainWhy(a) : /a project named/.test(a.error || '') ? `${n} is already a project` : `A folder called ${n} already exists`);
  /** New folder's dry run: where the folder will be made; a refusal is the field's error (an empty name: the root). */
  async function checkNew({ name, useGit } = {}) {
    const n = String(name || '').trim(), a = await send('create', { name: n, useGit, dryRun: true });
    if (a.status === 0) return down;
    if (a.ok || !n) return { ok: true, where: whereOf(a.data) };
    return { ok: false, field: newWhy(a, n), where: whereOf(a.data) };
  }
  /** New folder: POST /api/projects/create; its key once the store lists it. */
  const createProject = ({ name, useGit } = {}) => once('add', 'create', async () => {
    const n = String(name || '').trim(), a = await send('create', { name: n, useGit });
    if (a.status === 0) return down;
    if (!a.ok) return a.status < 500 && a.data?.code !== 'FAILED' ? { ok: false, field: newWhy(a, n) } : refused('create', n, a);
    refresh('projects', 'sync');
    const key = a.data.project?.key;
    if (key) gone.delete(key);
    return { ok: true, text: `Created ${n}`, ...(key && await listed('projects', key) ? { key } : {}) };
  });
  /** Several folders: POST /api/projects/bulk; results keep the server's index into the sent rows. */
  const addMany = (rows) => once('add', 'bulk', async () => {
    const a = await send('bulk', { rows });
    if (a.status === 0) return down;
    if (!a.ok) return { ok: false, text: `Could not add ${plural(rows.length, 'project')}: ${plainWhy(a)}` };
    const results = a.data.results || [];
    const added = results.filter((x) => x.status === 'added').map(({ key, name }) => ({ key, name }));
    const skipped = results.filter((x) => x.status === 'skipped').map(({ index, name, path, reason }) => ({ index, name, path, reason }));
    let key;
    if (added.length) {
      refresh('projects', 'sync');
      added.forEach((x) => gone.delete(x.key));
      const seen = await Promise.all(added.map((x) => listed('projects', x.key)));
      if (added.length === 1 && !skipped.length && seen[0]) key = added[0].key;
    }
    return { ok: true, results, added, skipped, text: reviewSummary({ added: added.map((x) => x.name), skipped }), ...(key ? { key } : {}) };
  });
  const rename = (key, name) => once(key, 'rename', async () => {
    const was = nameOf(key), a = await send('rename', { key, name });
    if (!a.ok) return a.status === 400 ? { ok: false, field: plainWhy(a) } : refused('rename', was, a);   // a name dev refuses is the field's error
    refresh('projects');
    return { ok: true, text: `Renamed ${was} to ${name}` };
  });
  const relocate = (key, path) => once(key, 'relocate', async () => {
    // not read while dev moves it (its projects-changed frame can come before the answer, F-b23m2-02); never again once
    // its key changed; its row stays (the Locate form with it) until the new key is listed
    moving.add(key);
    const was = nameOf(key), a = await send('relocate', { key, path });
    if (!a.ok) { moving.delete(key); return a.status === 400 ? { ok: false, field: plainWhy(a) } : refused('relocate', was, a); }
    refresh('projects', 'sync');
    const to = a.data.project?.key || key;
    if (to !== key) details.delete(key); else moving.delete(key);
    gone.delete(to);
    const at = await listed('projects', to);
    if (to !== key) { moving.delete(key); gone.add(key); }
    return { ok: true, ...(at ? { key: to } : {}), text: `${was} now uses ${path}` };
  });
  const ORIGIN = { sync: ['sync', (n) => `Synced ${n}`], fetch: ['fetch', (n) => `Checked ${n}`], git: ['git', (n) => `${n} uses git now; the first task commits what is there`] };
  const origin = (key, act) => once(key, ORIGIN[act][0], async () => {
    const [action, said] = ORIGIN[act], n = nameOf(key), a = await send(action, { key });
    if (!a.ok) return refused(action, n, a);
    const ff = a.data.sync?.ff;
    if (act === 'sync' && ff && ff.ok === false) return refused(action, n, { status: 200, error: FF_WHY[ff.kind] || ff.kind || 'it could not fast-forward' });
    refresh('projects', 'sync');
    return { ok: true, text: said(n) };
  });
  const linkRemote = (key, url) => once(key, 'link', async () => {
    const n = nameOf(key), a = await send('link', { key, url });
    if (!a.ok) return refused('link', n, a);
    refresh('projects', 'sync');
    return { ok: true, text: 'Linked origin; nothing was pushed' };
  });
  /** Remove waits for the undo window (D10): hidden at once, DELETE only when the window closes, nothing on Undo.
   *  `argsNow()` reads what to send when the window closes (null: it changed meanwhile, so nothing is sent). Once sent,
   *  the hide ends with dev's answer, the next read of `sources`' frame, or HIDE_MAX_MS, whichever is first. */
  function deferred(id, action, argsNow, title, sources, ms) {
    if (hide.has(id)) return hide.get(id).handle;
    const unhide = (h) => { if (hide.get(id) !== h) return; hide.delete(id); refresh(...sources); on(); };
    const t = later(async () => {
      const h = hide.get(id); if (h?.handle !== handle) return;   // undone (or a later one): this window sends nothing
      const args = argsNow();
      if (!args) { toast(`Did not ${PROJECT_ACTIONS[action][0]} ${title}: it changed while you could undo`); unhide(h); return; }
      h.fired = true; h.frame = action === 'space-delete' ? 'workspaces-changed' : 'projects-changed';
      gone.add(id); details.delete(id); spaceDetails.delete(id);   // never read again, even when dev's frame comes before its answer
      // never answered: show it again; answered ok: it stays gone until the store drops it (hidden() clears it then)
      later(() => { if (!h.removed && (!hide.has(id) || hide.get(id) === h)) gone.delete(id); unhide(h); }, HIDE_MAX_MS);
      const a = await send(action, args);
      if (a.ok) h.removed = true;
      else { gone.delete(id); toast(refused(action, title, a).text); }
      unhide(h);
    }, ms);
    const handle = { undo: () => { const h = hide.get(id); if (!h || h.handle !== handle || h.fired) return false; cancel(t); hide.delete(id); on(); return true; } };
    hide.set(id, { handle }); on();
    return handle;
  }
  const deferRemove = (key, ms) => {
    const name = project(key)?.name || key;   // what was confirmed; the folder and the name are read again when the window closes
    const now = () => { const p = project(key); return p && p.name === name ? { name: p.name, owned: !!p.ownedFolder } : null; };
    return deferred(key, 'remove', now, name, ['projects', 'sync', 'workspaces'], ms);
  };

  // ---- a project's page: its settings and defaults, read on open (D16) ----
  async function readDetail(key) {
    if (!readable(key)) return;
    const [s, d] = await Promise.all([send('read-settings', { key }), send('read-defaults', { key })]);
    const was = details.get(key) || {};
    if (!s.ok || !d.ok) { details.set(key, { ...was, status: was.status === 'ready' ? 'ready' : 'failed' }); on(); return; }
    const teamOn = !!s.data.effective?.['memory.team']?.value;
    details.set(key, { status: 'ready', state: s.data, sets: setsOf(s.data, teamOn), ...defaultsOf(d.data), teamMemory: teamOn });
    on();
  }
  function detail(key) {
    if (!readable(key)) return { status: 'loading' };   // not stored: the next draw asks again
    if (!details.has(key)) { details.set(key, { status: 'loading' }); readDetail(key); }
    return details.get(key);
  }
  const fromState = (key, state) => { const teamOn = !!state.effective?.['memory.team']?.value; details.set(key, { ...details.get(key), status: 'ready', state, sets: setsOf(state, teamOn), teamMemory: teamOn }); };
  // pending keys: KEY#set:ID for a sentence, KEY#team, KEY#defaults (each control shows its own label)
  const patch = (key, action, body, target) => once(target, action, async () => {
    const a = await send(action, { key, patch: body });
    if (!a.ok) return refused(action, nameOf(key), a);
    fromState(key, a.data);
    return { ok: true, text: '' };
  });
  const setSet = (key, setId, word) => patch(key, 'set', patchOf(setId, word), `${key}#set:${setId}`);
  const resetSet = (key, setId) => patch(key, 'set', { [SET_KEYS[setId].id]: null }, `${key}#set:${setId}`);   // Use yours: null inherits
  const teamMemory = (key, isOn) => patch(key, 'team', { 'memory.team': !!isOn }, `${key}#team`);
  const saveDefaults = (key, { tags = [], labels = [] }) => once(`${key}#defaults`, 'defaults', async () => {
    const a = await send('defaults', { key, tags, labels });
    if (!a.ok) return refused('defaults', nameOf(key), a);
    details.set(key, { ...details.get(key), ...defaultsOf(a.data) });
    return { ok: true, text: '' };
  });

  // ---- workspaces ----
  /** Make a workspace by hand (D12): a client draft until Save (dev refuses fewer than 2 members). */
  function fresh_(title) {
    const id = `draft:${slug(title)}`;
    if (!fresh.has(id)) fresh.set(id, { id, title, home: '', runs: 0, scanned: 'never', model: '', about: '', projects: [], links: [], paths: [], fresh: true, draft: { projects: [], changes: 0 } });
    on();
    return id;
  }
  const discardFresh = (id) => { fresh.delete(id); on(); };
  const pathOf = (key) => project(key)?.devPath || '';
  /** Save a draft (D13, F-6-16). First what the client can check (members, the name), sending nothing on a refusal; then
   *  a fresh one is one POST, a saved one is one add, one removal each, and its name last, so the name is saved only
   *  when every member change was. Stops at the first refusal; `keep` is the draft of what was not saved. */
  function preflight(id, w, draft, ids, name) {
    const had = w.projects.map(([k]) => k), isFresh = id.startsWith('draft:');
    if (ids.length < 2) return 'a workspace needs at least two projects';
    if (ids.length > MAX_MEMBERS) return `a workspace holds at most ${MAX_MEMBERS} projects`;
    const unknown = ids.find((k) => (isFresh || !had.includes(k)) && !pathOf(k))
      || (isFresh ? '' : had.find((k, i) => !ids.includes(k) && !pathOf(k) && !w.paths?.[i]));
    if (unknown) return `${nameOf(unknown)} is not a project Worca knows`;
    if (name === null) return 'it needs a name';
    const clash = name && [...(world().spaces || []), ...fresh.values()].find((x) => x.id !== id && String(x.title).toLowerCase() === name.toLowerCase());
    return clash ? `there is already a workspace called ${clash.title}` : '';
  }
  function saveSpace(id, draft) {
    // a saved draft leaves once its caller has the answer, not before: the redraw that ends its pending label keeps the
    // draft's page, so the caller can still tell whether the person is on it
    const drop = (a) => { if (a.ok && id.startsWith('draft:')) fresh.delete(id); return a; };
    return once(id, id.startsWith('draft:') ? 'space-create' : 'space-rename', async () => {
      const w = space(id); if (!w) return { ok: false, text: '' };
      const ids = (draft?.projects || []).map(([k]) => k);
      const typed = typeof draft?.name === 'string' ? draft.name.trim() : undefined;
      const name = typed === undefined || typed === w.title ? '' : typed || null;   // null: emptied
      const why = preflight(id, w, draft, ids, name);
      if (why) return { ok: false, text: `Could not save ${w.title}: ${why}`, keep: draft };
      if (id.startsWith('draft:')) {
        const title = name || w.title, a = await send('space-create', { name: title, paths: ids.map(pathOf) });
        if (!a.ok) return refused('space-create', title, a);
        refresh('workspaces');
        const made = a.data.workspace?.id || '';
        return { ok: true, text: `Saved ${title}; a short scan maps what changed`, ...(await listed('spaces', made) ? { id: made } : {}) };
      }
      const had = w.projects.map(([k]) => k);
      const added = ids.filter((k) => !had.includes(k)), removed = had.filter((k) => !ids.includes(k)), done = [];
      let stop = null, left = [...removed];
      if (added.length) { const a = await send('space-add', { id, paths: added.map(pathOf) }); if (!a.ok) stop = ['space-add', a]; else done.push(added.map(nameOf).join(', ')); }
      for (const k of removed) {
        if (stop) break;
        const a = await send('space-remove', { id, path: pathOf(k) || w.paths?.[had.indexOf(k)] || '' });   // a member no project holds: its stored path
        if (!a.ok) { stop = ['space-remove', a]; break; }
        left = left.filter((x) => x !== k); done.push(`taking out ${nameOf(k)}`);
      }
      if (!stop && name) { const a = await send('space-rename', { id, name }); if (!a.ok) stop = ['space-rename', a]; }
      if (added.length || removed.length || name) refresh('workspaces');
      if (!stop) return { ok: true, text: `Saved ${name || w.title}; a short scan maps what changed` };
      const saidDone = done.length ? ` (${done.join(' and ')} ${done.length > 1 || done[0].includes(',') ? 'were' : 'was'} saved)` : '';
      const named = name ? { name } : {}, n = name ? 1 : 0;
      const keep = stop[0] === 'space-rename' ? { name, projects: draft.projects, changes: 1 }
        : stop[0] === 'space-add' ? { ...named, projects: draft.projects, changes: n + added.length + removed.length }
          : { ...named, projects: draft.projects, changes: n + left.length };
      return { ok: false, text: `Could not save ${w.title}: ${plainWhy(stop[1])}${saidDone}`, keep };
    }).then(drop);
  }
  async function readSpaceDetail(id) {
    if (!readable(id)) return;
    const a = await send('space-read-defaults', { id });
    spaceDetails.set(id, a.ok ? { status: 'ready', ...defaultsOf(a.data) } : { ...(spaceDetails.get(id) || {}), status: 'failed' });
    on();
  }
  function spaceDetail(id) {
    if (id.startsWith('draft:')) return { status: 'ready', tags: [], labels: [] };
    if (!readable(id)) return { status: 'loading', tags: [], labels: [] };
    if (!spaceDetails.has(id)) { spaceDetails.set(id, { status: 'loading', tags: [], labels: [] }); readSpaceDetail(id); }
    return spaceDetails.get(id);
  }
  const saveSpaceDefaults = (id, { tags = [], labels = [] }) => once(`${id}#defaults`, 'space-defaults', async () => {
    const a = await send('space-defaults', { id, tags, labels });
    if (!a.ok) return refused('space-defaults', space(id)?.title || id, a);
    spaceDetails.set(id, { status: 'ready', ...defaultsOf(a.data) });
    return { ok: true, text: '' };
  });
  const deferDeleteSpace = (id, ms) => deferred(id, 'space-delete', () => ({ id }), space(id)?.title || id, ['workspaces'], ms);
  const scan = (id) => once(id, 'scan', async () => {
    const t = space(id)?.title || id, a = await send('scan', { id });
    if (!a.ok) return a.status === 428 || a.status === 0 ? { ok: false, text: a.status === 0 ? NOT_ANSWERING : a.error || plainWhy(a) } : refused('scan', t, a);
    refresh('workspaces');
    return { ok: true, text: `Reading ${t}` };
  });
  const syncBehind = (id) => once(id, 'space-sync', async () => {
    const w = space(id), behind = (w?.projects || []).filter(([k]) => project(k)?.origin === 'behind').map(([k]) => k);
    let n = 0;
    for (const key of behind) {
      const a = await send('space-sync', { key });
      if (!a.ok) { refresh('projects', 'sync'); return { ok: false, text: `${refused('space-sync', nameOf(key), a).text}${n ? ` (${plural(n, 'project')} synced)` : ''}` }; }
      n += 1;
    }
    refresh('projects', 'sync');
    return { ok: true, text: `Synced ${plural(n, 'project')} in ${w?.title || id}` };
  });
  const answer = (id, edgeId, state) => once(`edge:${edgeId}`, 'answer', async () => {
    const a = await send('answer', { id, edgeId, state });
    if (!a.ok) return refused('answer', space(id)?.title || id, a);
    refresh('workspaces');
    return { ok: true, text: '' };
  });
  const openInEditor = (id, projectKey, at) => once(`open:${id}`, 'open-editor', async () => {
    const file = String(at).replace(/:\d+$/, ''), base = file.split('/').pop(), a = await send('open-editor', { id, projectKey, file });
    if (!a.ok) return refused('open-editor', base, a);
    return { ok: true, text: `Opened ${base} in your editor` };
  });

  /** A frame: a clone this tab started ends (done: read projects and go to it; failed: toast); settings or projects
   *  changed elsewhere: read the open pages' detail again. Pending labels hold until dev answers. */
  function frame(f = {}) {
    if (f.type === 'clone-changed' && f.job && clones.has(f.job.id) && f.job.state !== 'running') {
      const { name, from } = clones.get(f.job.id); clones.delete(f.job.id);
      const key = f.job.project?.key;
      if (f.job.state === 'done') { refresh('projects', 'sync'); listed('projects', key).then((ok) => ok && at() === from && go(`projects/${key}`)); }   // only once the store lists it, while the person is still where they started it
      else toast(`Could not clone ${name}: ${f.job.error ? plainWhy({ status: 200, error: f.job.error }) : 'it failed'}`);
      return;
    }
    for (const [id, h] of hide) if (h.fired && h.frame === f.type) { hide.delete(id); on(); }   // the lists are read again: they say what is true
    const reread = (map, read) => { for (const id of [...map.keys()]) { if (gone.has(id)) map.delete(id); else if (readable(id)) read(id); } };
    if (f.type === 'settings-changed' || f.type === 'projects-changed') reread(details, readDetail);
    if (f.type === 'workspaces-changed') reread(spaceDetails, readSpaceDetail);
  }

  /** Waiting for its undo window, or removed and still listed by the store. */
  function hidden() {
    for (const id of gone) if (!lists('projects', id) && !lists('spaces', id)) gone.delete(id);
    return new Set([...hide.keys(), ...gone]);
  }

  return {
    addProject, rename, relocate, origin, linkRemote, deferRemove,
    folders, probe, gitAvailable, checkNew, createProject, addMany,
    detail, setSet, resetSet, teamMemory, saveDefaults,
    fresh: fresh_, drafts: () => [...fresh.values()], discardFresh, saveSpace, spaceDetail, saveSpaceDefaults, deferDeleteSpace, scan, syncBehind, answer, openInEditor,
    hidden, pending: (id) => busy.get(id) || '', frame,
  };
}
