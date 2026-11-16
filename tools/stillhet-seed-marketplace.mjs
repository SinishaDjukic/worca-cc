#!/usr/bin/env node
// tools/stillhet-seed-marketplace.mjs — real records for Stillhet's Marketplace in the live kind (slice 8 D21): a local git
// market with four plugins, and each plugin's state made through dev's own routes (POST /api/marketplaces,
// /api/plugins/install, /api/marketplaces/:id/refresh). It feeds the one Expert walk at the end of the slice; the pixel
// compare stays demo against demo. Pinned by test/stillhet-seed-marketplace.test.mjs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

/** What is seeded: the plugin, the state it ends in, and why. */
export const SEEDED_MARKETPLACE = Object.freeze([
  Object.freeze({ name: 'seed-ready', state: 'installed', what: 'installed; asks for nothing (one skill)' }),
  Object.freeze({ name: 'seed-update', state: 'update', what: 'installed at 0.1.0; the market then moves to 0.2.0 and is synced' }),
  Object.freeze({ name: 'seed-setup', state: 'needs-setup', what: 'installed; a task source whose one required secret is empty' }),
  Object.freeze({ name: 'seed-broken', state: 'failed-install', what: 'offered, never installed: it declares setup.node with no package-lock.json, so dev refuses the install' }),
]);

const CONNECTOR = 'export default () => ({ async validateConfig() { return { ok: true }; } });\n';
const source = (id, displayName, required) => ({ id, displayName, module: './index.mjs', configSchema: [{ key: 'token', type: 'text', label: `${displayName} token`, secret: true, ...(required ? { required: true } : {}) }], inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] });
const SKILL = (name) => `---\nname: ${name}\ndescription: Keeps the change tidy.\n---\n\nTidy the change before it is reviewed.\n`;
const PLUGINS = {
  'seed-ready': () => ({ manifest: { name: 'seed-ready', version: '0.1.0', description: 'A skill that keeps the change tidy; it asks for nothing.' }, files: { 'skills/tidy/SKILL.md': SKILL('tidy') } }),
  'seed-update': (version = '0.1.0') => ({ manifest: { name: 'seed-update', version, description: 'A tracker that has a newer version.', taskSources: [source('tracker', 'Seed tracker', false)] }, files: { 'index.mjs': CONNECTOR } }),
  'seed-setup': () => ({ manifest: { name: 'seed-setup', version: '0.1.0', description: 'A tracker that needs its token.', taskSources: [source('main', 'Seed issues', true)] }, files: { 'index.mjs': CONNECTOR } }),
  'seed-broken': () => ({ manifest: { name: 'seed-broken', version: '0.1.0', description: 'Declares a Node set-up with no lockfile.', setup: { node: true } }, files: { 'skills/broken/SKILL.md': SKILL('broken'), 'package.json': '{"name":"seed-broken","version":"0.1.0"}\n' } }),
};

async function writePlugin(dir, name, version) {
  const { manifest, files } = name === 'seed-update' ? PLUGINS[name](version) : PLUGINS[name]();
  const at = join(dir, 'plugins', name);
  await mkdir(at, { recursive: true });
  await writeFile(join(at, 'worca-cc-plugin.json'), JSON.stringify(manifest, null, 2));
  for (const [f, text] of Object.entries(files)) { await mkdir(join(at, f, '..'), { recursive: true }); await writeFile(join(at, f), text); }
}

/** A local git market holding the four plugins; `bump(version)` commits seed-update at that version and answers the new sha. */
export async function makeSeedMarket(dir) {
  dir ||= await mkdtemp(join(tmpdir(), 'stillhet-seed-market-'));
  const git = (...args) => run('git', ['-C', dir, ...args]);
  await writeFile(join(dir, 'worca-cc-marketplace.json'), JSON.stringify({ name: 'Seed market', description: 'Stillhet Marketplace seed', plugins: SEEDED_MARKETPLACE.map((p) => `plugins/${p.name}`) }));
  for (const { name } of SEEDED_MARKETPLACE) await writePlugin(dir, name, '0.1.0');
  await run('git', ['init', '-q', '-b', 'main', dir]);
  await git('config', 'user.email', 'seed@worca.local');
  await git('config', 'user.name', 'seed');
  const commit = async (msg) => { await git('add', '-A'); await git('commit', '-q', '-m', msg); return (await git('rev-parse', 'HEAD')).stdout.trim(); };
  const sha = await commit('seed market');
  return { dir, sha, bump: async (version) => { await writePlugin(dir, 'seed-update', version); return commit(`seed-update ${version}`); } };
}

/**
 * Seeds every state of SEEDED_MARKETPLACE through dev's routes at `base`. Throws on the first unexpected answer, naming
 * it; the broken install must be refused.
 * @returns {Promise<{market: string, dir: string, refused: string}>}
 */
export async function seedMarketplace({ base, dir } = {}) {
  const call = async (method, p, body, ok = true) => {
    const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => null);
    if (ok && !r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${JSON.stringify(data)}`);
    return { status: r.status, data };
  };
  const m = await makeSeedMarket(dir);
  const market = (await call('POST', '/api/marketplaces', { url: m.dir })).data.marketplace;
  const install = (name, ok = true) => call('POST', '/api/plugins/install', { repoUrl: m.dir, name, sha: m.sha, subdir: `plugins/${name}`, marketplace: market.id }, ok);
  for (const name of ['seed-ready', 'seed-update', 'seed-setup']) await install(name);
  const broken = await install('seed-broken', false);
  if (broken.status < 400) throw new Error('POST /api/plugins/install seed-broken: dev installed it; the failed-install seed needs a refusal');
  await m.bump('0.2.0');
  await call('POST', `/api/marketplaces/${encodeURIComponent(market.id)}/refresh`, {});
  return { market: market.id, dir: m.dir, refused: broken.data?.error || '' };
}

/** Refuses unless `base` answers GET /api/projects with no projects: a blank sandbox, never a working Worca. */
export async function sandboxOnly(base, { fetch: get = fetch } = {}) {
  let projects;
  try { projects = (await (await get(`${base}/api/projects`)).json())?.projects; } catch (e) { throw new Error(`${base} is not answering: ${e.message}`); }
  if (!Array.isArray(projects) || projects.length) throw new Error(`${base} is not a blank sandbox (GET /api/projects lists ${Array.isArray(projects) ? projects.length : 'no'} projects): seed only a fresh one`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // it installs into the server it is given: only a named one, and only a blank sandbox (no projects yet)
  const base = process.argv[2];
  if (!base) { console.error('usage: node tools/stillhet-seed-marketplace.mjs http://127.0.0.1:PORT   (a blank sandbox server)'); process.exit(2); }
  sandboxOnly(base).then(() => seedMarketplace({ base })).then((r) => console.log(`stillhet: seeded the Marketplace ${JSON.stringify(r)}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
