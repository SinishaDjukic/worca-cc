// tools/parity/crawl-seed.mjs — the crawl's seeded template (D2): one per worker, built with target A at that worker's fixed
// paths, so every A, control and B server starts on a byte-identical copy (same ids, paths and sandbox commits).
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { devNull } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startTarget } from './launch.mjs';
import { seed } from './seed.mjs';

const TOOL_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GIT_ENV = { GIT_AUTHOR_NAME: 'parity', GIT_AUTHOR_EMAIL: 'parity@example.invalid', GIT_COMMITTER_NAME: 'parity',
  GIT_COMMITTER_EMAIL: 'parity@example.invalid', GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };
/** Every route param the catalogue fills; one left unset makes its routes "unfillable" (D6). */
export const PARAM_KEYS = ['projectKey', 'pipelineId', 'threadId', 'runId', 'groupId', 'featureId', 'workspaceId', 'workflowId',
  'agentKey', 'scriptKey', 'requirementN', 'memoryName', 'mcpServerId', 'skillSetId', 'modelId', 'marketplaceId', 'pluginName'];

async function api(t, path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${t.base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!r.ok) throw new Error(`crawl seed: ${method} ${path} -> ${r.status}`);
  return r.json();
}
/** The first array in a list response (`{ workflows: […] }`, `[…]`, …). */
const listOf = (j) => (Array.isArray(j) ? j : Object.values(j ?? {}).find(Array.isArray) ?? []);

function gitRepo(dir) {
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, ...GIT_ENV };
  const safe = ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${devNull}`];
  execFileSync('git', [...safe, 'init', '-q', '-b', 'main', dir], { env });
  execFileSync('git', [...safe, '-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init'], { env });
}

/** Every entity a route param needs beyond seed(): through the public API, so it works for tree and package alike. */
export async function extraSeed(t, ids, log = () => {}) {
  const out = {};
  const step = async (key, fn) => { try { const v = await fn(); if (v != null) out[key] = String(v); else log(`crawl seed: ${key}: none`); } catch (e) { log(`crawl seed: ${key}: ${e.message}`); } };
  await step('groupId', async () => (await api(t, '/api/run-groups', { title: 'parity group', pipelineIds: [ids.pipelineId] })).group?.id);
  await step('workspaceId', async () => {
    const p2 = join(t.home, 'sandbox-2'); gitRepo(p2);
    await api(t, '/api/projects', { name: 'sandbox-2', path: p2 });
    return (await api(t, '/api/workspaces', { name: 'parity-ws', projectPaths: [t.projectPath, p2] })).workspace?.id;
  });
  await step('workflowId', async () => listOf(await api(t, '/api/workflows')).map((w) => w.id).sort()[0]);
  await step('agentKey', async () => listOf(await api(t, '/api/agents')).map((a) => a.key ?? a.id).filter(Boolean).sort()[0]);
  await step('scriptKey', async () => listOf(await api(t, '/api/scripts')).map((s) => s.key ?? s.id).filter(Boolean).sort()[0]);
  await step('requirementN', async () => {
    await api(t, '/api/flags', { requirements: true }, 'PATCH');
    try {
      const r = await api(t, '/api/requirements', { scopeType: 'project', scopeKey: ids.projectKey, title: 'parity feature', description: 'a feature for the crawl' });
      return (r.requirement ?? r.feature ?? r).seq;
    } finally { await api(t, '/api/flags', { requirements: false }, 'PATCH'); }
  });
  await step('memoryName', async () => {
    await api(t, `/api/memory/projects/${encodeURIComponent(ids.projectKey)}/files/parity-note`, { text: '# parity note\n\nA memory for the crawl.\n' }, 'PUT');
    return 'parity-note';   // a memory name has no extension (memory-store.mjs assertName)
  });
  await step('mcpServerId', async () => (await api(t, '/api/mcp/servers', { name: 'parity', type: 'http', url: 'http://127.0.0.1:9/mcp' })).id);
  await step('skillSetId', async () => listOf(await api(t, '/api/mcp/sets')).map((s) => s.id).sort()[0]);
  await step('modelId', async () => { const j = await api(t, '/api/models'); return [...(j.models ?? []), ...(j.predefined ?? [])].map((m) => m.id).filter(Boolean)[0]; });
  await step('marketplaceId', async () => listOf(await api(t, '/api/marketplaces')).map((m) => m.id).sort()[0]);
  await step('pluginName', async () => {
    const dir = join(t.home, 'plugin-src', 'mock-source');
    cpSync(join(TOOL_ROOT, 'test/fixtures/plugins/mock-source'), dir, { recursive: true });
    const r = await api(t, '/api/plugins/link', { dir });
    return r.name ?? r.plugin?.name ?? 'mock-source';
  });
  return out;
}

/**
 * No public route creates a feature: write one into the stopped server's DB with the target's own createSliceFeature.
 * Slice 1 is the held seed run, which never finishes: on the finished run, slice 2's ticket ("after: done") would fire
 * on every server start and mint a pipeline with a new random id, so no two servers would match.
 */
export function seedFeature(t, ids, log = () => {}) {
  const mod = join(t.root, 'src/core/shape/features.mjs');
  if (!existsSync(mod)) { log('crawl seed: featureId: no src/core/shape/features.mjs in the target'); return null; }
  const script = `const { createSliceFeature } = await import(${JSON.stringify(pathToFileURL(mod).href)});
const sl = (n, title) => ({ id: 's' + n, title, goal: 'Goal ' + n, inScope: [], outOfScope: [], acceptance: ['ok ' + n], dependsOn: [], estimate: 'M' });
const f = createSliceFeature({ pipelineId: ${JSON.stringify(ids.heldPipelineId ?? ids.pipelineId)}, projectDir: ${JSON.stringify(t.projectPath)}, title: 'parity feature',
  outline: { why: 'parity crawl', slices: [sl(1, 'First slice'), sl(2, 'Second slice')] }, perspectives: ['product'], workflowId: 'wf_shape', now: 1700000000000 });
console.log(f.id);`;
  try {
    const env = { PATH: process.env.PATH, HOME: t.home, USERPROFILE: t.home, WORCA_HOME: t.home, WORCA_MOCK: '1', ...GIT_ENV };
    return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script], { cwd: t.home, env, encoding: 'utf8' }).trim().split('\n').at(-1);
  } catch (e) { log(`crawl seed: featureId: ${String(e.stderr ?? e.message).split('\n')[0]}`); return null; }
}

/**
 * Build one template: start `spec` on `fixed` (offline), seed it, stop it (SIGTERM checkpoints the WAL), add the feature,
 * then copy home (without server.log) and sandbox to dir. Writes dir/ids.json and dir/clock.json ({ now }: the epoch ms
 * the browser clock is fixed to, the seed end + 1 h).
 */
export async function buildTemplate(spec, fixed, dir, log = () => {}, { port } = {}) {
  const t = await startTarget(spec, { fixed, offline: true, ...(port ? { port } : {}) });
  let ids;
  try {
    const s = await seed(t);
    ids = { ...s, ...(await extraSeed(t, s, log)) };
  } finally { await t.stop(); }
  const featureId = seedFeature(t, ids, log);
  if (featureId) ids.featureId = featureId;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  cpSync(t.home, join(dir, 'home'), { recursive: true, filter: (src) => src !== join(t.home, 'server.log') });
  cpSync(t.projectPath, join(dir, 'sandbox'), { recursive: true });
  writeFileSync(join(dir, 'ids.json'), JSON.stringify(ids, null, 2));
  writeFileSync(join(dir, 'clock.json'), JSON.stringify({ now: Date.now() + 3600_000 }));
  return { ids, missing: PARAM_KEYS.filter((k) => ids[k] == null) };
}
