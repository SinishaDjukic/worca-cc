#!/usr/bin/env node
// tools/stillhet-seed-projects.mjs — real records for Stillhet's Projects and Workspaces in the live kind (slice 9 D20):
// seven projects in every origin state the page acts on, each made through dev's own routes (POST /api/projects,
// /api/projects/create, /api/projects/:key/sync), over real git folders and local bare remotes, and the workspace
// `Seed shop` over seed-ok and seed-local with one heuristic edge that carries evidence (its map is saved with
// saveWorkspaceScanResult, as tools/stillhet-seed-tasks.mjs does, so this process must share the sandbox's WORCA_HOME).
// It feeds the one Expert walk at the end of the slice; the pixel compare stays demo against demo. Pinned by
// test/stillhet-seed-projects.test.mjs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

/** What is seeded: the project, the state it ends in, and how. */
export const SEEDED_PROJECTS = Object.freeze([
  Object.freeze({ name: 'seed-ok', state: 'up-to-date', what: 'a clone of a local bare remote, nothing new on either side' }),
  Object.freeze({ name: 'seed-behind', state: 'behind', what: 'a clone whose remote then moves on by one commit, fetched' }),
  Object.freeze({ name: 'seed-diverged', state: 'diverged', what: 'a clone with a commit of its own while its remote moves on, fetched' }),
  Object.freeze({ name: 'seed-local', state: 'no-upstream', what: 'a git repository with no remote' }),
  Object.freeze({ name: 'seed-folder', state: 'folder', what: 'a plain folder, no git' }),
  Object.freeze({ name: 'seed-moved', state: 'missing', what: 'added, then its folder deleted: a missing folder' }),
  Object.freeze({ name: 'seed-owned', state: 'owned', what: 'made by Worca (POST /api/projects/create): Remove deletes its folder too' }),
]);
export const SEEDED_WORKSPACE = Object.freeze({ name: 'Seed shop', members: Object.freeze(['seed-ok', 'seed-local']) });

const git = (dir, ...args) => run('git', ['-C', dir, '-c', 'user.email=seed@worca.local', '-c', 'user.name=seed', '-c', 'commit.gpgsign=false', ...args]);
async function commit(dir, file, text, msg) { await writeFile(join(dir, file), text); await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', msg); }
/** A bare remote with one commit on main, and a fresh clone of it at `dir`. `push(text)` moves the remote on by one commit. */
async function cloned(root, name) {
  const src = join(root, `${name}-src`), bare = join(root, `${name}.git`), dir = join(root, name);
  await mkdir(src, { recursive: true });
  await run('git', ['init', '-q', '-b', 'main', src]);
  await commit(src, 'README.md', `# ${name}\n`, 'seed');
  await run('git', ['clone', '-q', '--bare', src, bare]);
  await run('git', ['clone', '-q', bare, dir]);
  const push = async (text) => { await git(src, 'pull', '-q', bare, 'main'); await commit(src, 'CHANGES.md', text, 'remote moves on'); await git(src, 'push', '-q', bare, 'main'); };
  return { dir, push };
}

/**
 * Seeds every state of SEEDED_PROJECTS and SEEDED_WORKSPACE through dev's routes at `base`, in folders under `root`
 * (a fresh temp folder by default). Throws on the first unexpected answer, naming it.
 * @returns {Promise<{root: string, keys: Record<string, string>, workspace: string}>}
 */
export async function seedProjects({ base, root } = {}) {
  root = await realpath(root || await mkdtemp(join(tmpdir(), 'stillhet-seed-projects-')));
  const call = async (method, p, body) => {
    const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  const keys = {};
  const add = async (name, path) => { const out = await call('POST', '/api/projects', { name, path }); keys[name] = out.projects.find((p) => p.name === name).key; };
  const ok = await cloned(root, 'seed-ok'); await add('seed-ok', ok.dir);
  const behind = await cloned(root, 'seed-behind'); await add('seed-behind', behind.dir);
  await behind.push('the remote moved on\n');
  const diverged = await cloned(root, 'seed-diverged'); await add('seed-diverged', diverged.dir);
  await diverged.push('the remote moved on\n');
  await commit(diverged.dir, 'LOCAL.md', 'a change of its own\n', 'local work');
  for (const name of ['seed-behind', 'seed-diverged']) await call('POST', `/api/projects/${keys[name]}/sync`, { mode: 'fetch' });
  const local = join(root, 'seed-local');
  await mkdir(local, { recursive: true }); await run('git', ['init', '-q', '-b', 'main', local]); await commit(local, 'README.md', '# seed-local\n', 'seed');
  await add('seed-local', local);
  const folder = join(root, 'seed-folder');
  await mkdir(folder, { recursive: true }); await writeFile(join(folder, 'notes.md'), 'a folder, no git\n');
  await add('seed-folder', folder);
  const moved = join(root, 'seed-moved');
  await mkdir(moved, { recursive: true }); await run('git', ['init', '-q', '-b', 'main', moved]); await commit(moved, 'README.md', '# seed-moved\n', 'seed');
  await add('seed-moved', moved);
  await rm(moved, { recursive: true, force: true });
  keys['seed-owned'] = (await call('POST', '/api/projects/create', { name: 'seed-owned' })).project.key;

  const { workspace } = await call('POST', '/api/workspaces', { name: SEEDED_WORKSPACE.name, projectPaths: [ok.dir, local] });
  const { saveWorkspaceScanResult } = await import('../src/core/workspaces.mjs');
  const { edgeId } = await import('../src/shared/workspace-map/ids.mjs');
  const [from, to] = [keys['seed-ok'], keys['seed-local']], norm = 'http:GET /invoices/{}';
  const member = (k, name) => ({ key: k, name, role: `Serves ${name}`, roleSource: 'static', aliases: [], stack: ['node'],
    coverage: { level: 'rich', files: 1, scannedFiles: 1, truncated: false, factsStatic: 1, factsLlm: 0, unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus: 'investigated', graph: null } });
  const map = { version: 1, workspace: { name: SEEDED_WORKSPACE.name }, scannedAt: new Date().toISOString(), runId: 'seed0009', members: [member(from, 'seed-ok'), member(to, 'seed-local')],
    edges: [{ id: edgeId(from, to, 'http', norm), from, to, kind: 'http', norm, display: 'GET /invoices/{id}', label: null, detail: '', confidence: 'heuristic', sources: ['static'],
      evidence: { from: [{ file: 'src/client.js', line: 3, match: 'GET /invoices/{id}' }], to: [{ file: 'src/server.js', line: 7, match: 'GET /invoices/{id}' }] } }],
    order: [[to], [from]], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 }, stats: { edges: 1, byKind: { http: 1 }, byConfidence: {}, candidates: 0, candidatesConfirmed: 0, factsRejected: 0 }, errors: [] };
  await saveWorkspaceScanResult(workspace.id, { map, synthesis: { version: 1, overview: 'seed-ok calls seed-local for invoices.', roles: {}, coordination: [], orderNotes: '' } });
  return { root, keys, workspace: workspace.id };
}

/** Refuses unless `base` answers GET /api/projects with no projects: a blank sandbox, never a working Worca. */
export async function sandboxOnly(base, { fetch: get = fetch } = {}) {
  let projects;
  try { projects = (await (await get(`${base}/api/projects`)).json())?.projects; } catch (e) { throw new Error(`${base} is not answering: ${e.message}`); }
  if (!Array.isArray(projects) || projects.length) throw new Error(`${base} is not a blank sandbox (GET /api/projects lists ${Array.isArray(projects) ? projects.length : 'no'} projects): seed only a fresh one`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // it writes into the server it is given: only a named one, only a blank sandbox, and only with that sandbox's WORCA_HOME
  // (the workspace map is saved in this process's database)
  const base = process.argv[2];
  if (!base || !process.env.WORCA_HOME) { console.error('usage: WORCA_HOME=<the sandbox\'s> node tools/stillhet-seed-projects.mjs http://127.0.0.1:PORT   (a blank sandbox server)'); process.exit(2); }
  sandboxOnly(base).then(() => seedProjects({ base })).then((r) => console.log(`stillhet: seeded Projects ${JSON.stringify(r)}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
