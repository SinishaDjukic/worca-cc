// ui/public/stillhet/live/projects-live.mjs — Stillhet's Projects and Workspaces in the live kind (slice 9 D3): the one
// module that writes them through dev's routes. Every request is built from PROJECT_ACTIONS; every action answers
// { ok, text } (text: the toast; a refusal is `Could not WORDS NAME: ` plus dev's error). The lists stay the shared
// store's (RailWorld.part('projects' | 'spaces')): after a write this module asks the adapter to read them again and
// never edits a record. Client state of its own: what each action is doing (pending), what waits for its undo window
// (hidden), a fresh workspace's draft until Save, each project's and workspace's page detail, and clone jobs.
import { SET_KEYS, setsOf, patchOf, defaultsOf } from './projects-map.mjs';

const enc = encodeURIComponent;
// id → [the words a refusal starts with, the pending label its control shows while dev answers (D22), args → [method, url, body?]]
export const PROJECT_ACTIONS = Object.freeze({
  add: ['add', 'Adding…', ({ name, path }) => ['POST', '/api/projects', { name, path }]],
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
const HIDE_MAX_MS = 30000;   // a sent Remove or Delete that never hears back shows its row again after this
const REPO = /^(https?:\/\/|ssh:\/\/|git@)\S+$/;
const FF_WHY = { diverged: 'it has diverged', dirty: 'it has uncommitted changes', 'not-behind': 'it is not behind' };
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const lastSeg = (v) => (String(v).split(/[/:]/).filter(Boolean).pop() || '').replace(/\.git$/, '');
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

export function startProjectsLive({ fetch, toast = () => {}, refresh = () => {}, world = () => ({ projects: [], spaces: [] }), go = () => {}, on = () => {}, setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout }) {
  const busy = new Map(), hide = new Map(), fresh = new Map(), details = new Map(), spaceDetails = new Map(), clones = new Map();

  async function send(id, args = {}) {
    const [, , build] = PROJECT_ACTIONS[id], [method, url, body] = build(args);
    let r;
    try { r = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { return { ok: false, status: 0, data: {}, error: NOT_ANSWERING }; }
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: data || {}, error: r.ok ? '' : data?.error || data?.message || `HTTP ${r.status}` };
  }
  const project = (key) => world().projects?.find((p) => p.id === key) || null;
  const space = (id) => world().spaces?.find((w) => w.id === id) || fresh.get(id) || null;
  const nameOf = (key) => project(key)?.name || key;
  const refused = (action, title, a) => ({ ok: false, text: a.status === 0 ? NOT_ANSWERING : `Could not ${PROJECT_ACTIONS[action][0]} ${title}: ${a.error}` });
  /** One action at a time per target: a second press while one runs answers { ok:false, text:'' } and sends nothing. */
  async function once(target, action, fn) {
    if (busy.has(target)) return { ok: false, text: '' };
    busy.set(target, PROJECT_ACTIONS[action][1]); on();
    try { return await fn(); } finally { busy.delete(target); on(); }
  }

  // ---- projects ----
  function addProject(input) {
    const v = String(input || '').trim();
    return once('add', REPO.test(v) ? 'clone' : 'add', async () => {
      const name = lastSeg(v);
      if (REPO.test(v)) {
        const a = await send('clone', { url: v });
        if (!a.ok) return a.status === 400 || a.status === 409 ? { ok: false, field: a.error } : refused('clone', name, a);
        clones.set(a.data.jobId || a.data.job?.id, a.data.job?.name || name);
        return { ok: true, text: `Cloning ${a.data.job?.name || name}…` };
      }
      const a = await send('add', { name, path: v });
      if (!a.ok) return a.status === 400 ? { ok: false, field: a.error } : refused('add', name, a);
      refresh('projects', 'sync');
      const key = (a.data.projects || []).find((p) => p.name === name)?.key;
      return { ok: true, text: `Added ${name}`, ...(key ? { key } : {}) };
    });
  }
  const rename = (key, name) => once(key, 'rename', async () => {
    const was = nameOf(key), a = await send('rename', { key, name });
    if (!a.ok) return a.status === 400 ? { ok: false, field: a.error } : refused('rename', was, a);   // a name dev refuses is the field's error
    refresh('projects');
    return { ok: true, text: `Renamed ${was} to ${name}` };
  });
  const relocate = (key, path) => once(key, 'relocate', async () => {
    const was = nameOf(key), a = await send('relocate', { key, path });
    if (!a.ok) return a.status === 400 ? { ok: false, field: a.error } : refused('relocate', was, a);
    refresh('projects', 'sync');
    return { ok: true, key: a.data.project?.key || key, text: `${was} now uses ${path}` };
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
      later(() => unhide(h), HIDE_MAX_MS);
      const a = await send(action, args);
      if (!a.ok) toast(refused(action, title, a).text);
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
    const [s, d] = await Promise.all([send('read-settings', { key }), send('read-defaults', { key })]);
    const was = details.get(key) || {};
    if (!s.ok || !d.ok) { details.set(key, { ...was, status: was.status === 'ready' ? 'ready' : 'failed' }); on(); return; }
    const teamOn = !!s.data.effective?.['memory.team']?.value;
    details.set(key, { status: 'ready', state: s.data, sets: setsOf(s.data, teamOn), ...defaultsOf(d.data), teamMemory: teamOn });
    on();
  }
  function detail(key) {
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
  /** Save a draft: a fresh one is one POST; a saved one is its name, then one add, then one removal each (D13).
   *  Stops at the first refusal; `keep` is the draft of what was not saved. */
  function saveSpace(id, draft) {
    return once(id, id.startsWith('draft:') ? 'space-create' : 'space-rename', async () => {
      const w = space(id); if (!w) return { ok: false, text: '' };
      const ids = (draft?.projects || []).map(([k]) => k);
      if (id.startsWith('draft:')) {
        const title = (draft?.name || w.title).trim(), a = await send('space-create', { name: title, paths: ids.map(pathOf) });
        if (!a.ok) return refused('space-create', title, a);
        fresh.delete(id); refresh('workspaces');
        return { ok: true, text: `Saved ${title}; a short scan maps what changed`, id: a.data.workspace?.id || '' };
      }
      const had = w.projects.map(([k]) => k), name = draft?.name && draft.name.trim() !== w.title ? draft.name.trim() : '';
      const added = ids.filter((k) => !had.includes(k)), removed = had.filter((k) => !ids.includes(k)), done = [];
      let now = [...w.projects], stop = null;
      const title = name || w.title;
      if (name) { const a = await send('space-rename', { id, name }); if (!a.ok) stop = ['space-rename', a]; else done.push('the name'); }
      if (!stop && added.length) { const a = await send('space-add', { id, paths: added.map(pathOf) }); if (!a.ok) stop = ['space-add', a]; else { done.push(added.map(nameOf).join(', ')); now = [...now, ...added.map((k) => [k, 'ok'])]; } }
      let left = [...removed];
      for (const k of removed) {
        if (stop) break;
        const a = await send('space-remove', { id, path: pathOf(k) || w.paths?.[w.projects.findIndex(([x]) => x === k)] || '' });   // a member no project holds: its stored path
        if (!a.ok) { stop = ['space-remove', a]; break; }
        left = left.filter((x) => x !== k); done.push(`taking out ${nameOf(k)}`); now = now.filter(([x]) => x !== k);
      }
      refresh('workspaces');
      if (!stop) return { ok: true, text: `Saved ${title}; a short scan maps what changed` };
      const saidDone = done.length ? ` (${done.join(' and ')} ${done.length > 1 || done[0].includes(',') ? 'were' : 'was'} saved)` : '';
      const keep = stop[0] === 'space-rename' ? { name, projects: draft.projects, changes: 1 + added.length + removed.length }
        : stop[0] === 'space-add' ? { projects: draft.projects, changes: added.length + removed.length }
          : { projects: now.filter(([k]) => !left.includes(k)), changes: left.length };
      return { ok: false, text: `Could not save ${title}: ${stop[1].status === 0 ? NOT_ANSWERING : stop[1].error}${saidDone}`, keep };
    });
  }
  async function readSpaceDetail(id) {
    const a = await send('space-read-defaults', { id });
    spaceDetails.set(id, a.ok ? { status: 'ready', ...defaultsOf(a.data) } : { ...(spaceDetails.get(id) || {}), status: 'failed' });
    on();
  }
  function spaceDetail(id) {
    if (id.startsWith('draft:')) return { status: 'ready', tags: [], labels: [] };
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
    if (!a.ok) return a.status === 428 || a.status === 0 ? { ok: false, text: a.status === 0 ? NOT_ANSWERING : a.error } : refused('scan', t, a);
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
      const name = clones.get(f.job.id); clones.delete(f.job.id);
      if (f.job.state === 'done') { refresh('projects', 'sync'); if (f.job.project?.key) go(`projects/${f.job.project.key}`); }
      else toast(`Could not clone ${name}: ${f.job.error || 'it failed'}`);
      return;
    }
    for (const [id, h] of hide) if (h.fired && h.frame === f.type) { hide.delete(id); on(); }   // the lists are read again: they say what is true
    if (f.type === 'settings-changed' || f.type === 'projects-changed') for (const key of details.keys()) readDetail(key);
    if (f.type === 'workspaces-changed') for (const id of spaceDetails.keys()) readSpaceDetail(id);
  }

  return {
    addProject, rename, relocate, origin, linkRemote, deferRemove,
    detail, setSet, resetSet, teamMemory, saveDefaults,
    fresh: fresh_, drafts: () => [...fresh.values()], discardFresh, saveSpace, spaceDetail, saveSpaceDefaults, deferDeleteSpace, scan, syncBehind, answer, openInEditor,
    hidden: () => new Set(hide.keys()), pending: (id) => busy.get(id) || '', frame,
  };
}
