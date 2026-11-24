// test/dev-server.test.mjs — the Browser tab's dev server offer (issue 1064): package.json scripts (dev, then start),
// the package manager, the tool's port flag when it ignores PORT, and the project Action "Use this" saves.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, openSync, closeSync, constants as fsc } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectDevServer, devServerAction } from '../src/core/dev-server.mjs';
import { normalizeProjectActions } from '../src/core/actions/model.mjs';

const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
function project(pkg, files = []) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-devserver-'));
  made.push(dir);
  if (pkg !== undefined) writeFileSync(join(dir, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg));
  for (const f of files) writeFileSync(join(dir, f), '');
  return dir;
}

test('detectDevServer: a Vite dev script gets the port flag after npm\'s --', async () => {
  const d = await detectDevServer(project({ scripts: { dev: 'vite', build: 'vite build' } }));
  assert.deepEqual(d, { script: 'dev', scriptText: 'vite', manager: 'npm', tool: 'vite', command: 'npm run dev',
    cmd: 'npm run dev -- --port {PORT}', port: 5173, pinned: false, setup: null });
});

test('detectDevServer: the install command a run\'s fresh checkout needs, from the manager and the lock file', async () => {
  const dev = { scripts: { dev: 'vite' } };
  assert.equal((await detectDevServer(project({ ...dev, devDependencies: { vite: '^5' } }))).setup, 'npm install');
  assert.equal((await detectDevServer(project({ ...dev, dependencies: { vite: '^5' } }, ['package-lock.json']))).setup, 'npm ci');
  assert.equal((await detectDevServer(project({ ...dev, dependencies: { vite: '^5' } }, ['npm-shrinkwrap.json']))).setup, 'npm ci');
  assert.equal((await detectDevServer(project({ ...dev, devDependencies: { vite: '^5' } }, ['pnpm-lock.yaml']))).setup, 'pnpm install');
  assert.equal((await detectDevServer(project({ ...dev, dependencies: {} }))).setup, null, 'an empty list: nothing to install');
  const rr = await detectDevServer(project({ scripts: { dev: 'react-router dev' } }));
  assert.deepEqual([rr.cmd, rr.tool, rr.port], ['npm run dev -- --port {PORT}', 'react-router', 5173], 'Vite underneath: it ignores PORT');
  assert.equal((await detectDevServer(project({ scripts: { dev: 'vitepress dev docs' } }))).tool, 'vitepress');
});

test('detectDevServer: the package manager from packageManager, else the lock file; pnpm, yarn and bun pass flags through', async () => {
  assert.equal((await detectDevServer(project({ scripts: { dev: 'astro dev' } }, ['pnpm-lock.yaml']))).cmd, 'pnpm run dev --port {PORT}');
  assert.equal((await detectDevServer(project({ scripts: { dev: 'vite' } }, ['yarn.lock']))).cmd, 'yarn run dev --port {PORT}');
  assert.equal((await detectDevServer(project({ scripts: { dev: 'vite' } }, ['bun.lock']))).manager, 'bun');
  assert.equal((await detectDevServer(project({ packageManager: 'pnpm@9.1.0', scripts: { dev: 'vite' } }, ['yarn.lock']))).manager, 'pnpm');
});

test('detectDevServer: tools that read PORT get no flag; start when there is no dev; a pinned port is kept', async () => {
  const next = await detectDevServer(project({ scripts: { dev: 'next dev' } }));
  assert.equal(next.cmd, 'npm run dev');
  assert.equal(next.port, 3000);
  const cra = await detectDevServer(project({ scripts: { start: 'react-scripts start' } }));
  assert.equal(cra.script, 'start');
  assert.equal(cra.tool, 'react-scripts');
  const pinned = await detectDevServer(project({ scripts: { dev: 'vite --port 3001' } }));
  assert.equal(pinned.cmd, 'npm run dev', 'never a second --port');
  assert.deepEqual([pinned.port, pinned.pinned], [3001, true]);
  const glued = await detectDevServer(project({ scripts: { dev: 'next dev -p3001' } }));
  assert.deepEqual([glued.cmd, glued.port, glued.pinned], ['npm run dev', 3001, true], '-p3001 is a pin too');
  assert.equal(await detectDevServer(project({ scripts: { dev: 'vite --port 80' } })), null, 'an Action cannot hold a port below 1024: no offer');
  const chained = await detectDevServer(project({ scripts: { dev: 'tsc -b && vite' } }));
  assert.equal(chained.cmd, 'npm run dev -- --port {PORT}', 'the flag reaches the last command');
  const built = await detectDevServer(project({ scripts: { dev: 'vite build && node x.js' } }));
  assert.deepEqual([built.cmd, built.tool], ['npm run dev', null], 'a tool before the last command gets no flag');
});

test('detectDevServer: a tool a flag cannot reach keeps its own default port, pinned; an unknown script keeps auto', async () => {
  for (const dev of ['concurrently "vite" "node api.js"', 'vite | tee dev.log', 'vite & node api.js']) {
    const d = await detectDevServer(project({ scripts: { dev } }));
    assert.deepEqual([d.cmd, d.tool, d.port, d.pinned], ['npm run dev', null, 5173, true], dev);
  }
  const plain = await detectDevServer(project({ scripts: { dev: 'node server.js' } }));
  assert.deepEqual([plain.cmd, plain.port, plain.pinned], ['npm run dev', 3000, false], 'it most likely reads PORT');
  const vn = await detectDevServer(project({ scripts: { dev: 'vite-node src/server.ts' } }));
  assert.deepEqual([vn.cmd, vn.tool, vn.pinned], ['npm run dev', null, false], 'vite-node is not vite');
  assert.equal((await detectDevServer(project({ scripts: { dev: 'nuxt dev' } }))).tool, 'nuxt');
  const wr = await detectDevServer(project({ scripts: { dev: 'wrangler dev' } }));
  assert.deepEqual([wr.cmd, wr.tool, wr.port], ['npm run dev -- --port {PORT}', 'wrangler', 8787], 'wrangler ignores PORT');
  assert.equal((await detectDevServer(project({ scripts: { dev: 'eleventy --serve' } }))).cmd, 'npm run dev -- --port {PORT}');
  const turbo = await detectDevServer(project({ scripts: { dev: 'next dev --turbo' } }));
  assert.deepEqual([turbo.tool, turbo.pinned], ['next', false], '--turbo is Next\'s bundler flag, not the turbo runner');
  const nxcfg = await detectDevServer(project({ scripts: { dev: 'vite --config vite.nx.config.ts' } }));
  assert.deepEqual([nxcfg.cmd, nxcfg.pinned], ['npm run dev -- --port {PORT}', false], 'a config file name is not the nx runner');
  assert.equal((await detectDevServer(project({ scripts: { dev: 'turbo dev' } }))).tool, null, 'turbo itself is a runner');
});

test('detectDevServer: null without package.json, scripts, a dev or start script, or with broken JSON', async () => {
  assert.equal(await detectDevServer(project(undefined)), null);
  assert.equal(await detectDevServer(project('{nope')), null);
  assert.equal(await detectDevServer(project({ name: 'x' })), null);
  assert.equal(await detectDevServer(project({ scripts: { build: 'vite build', dev: '  ' } })), null);
  const bom = await detectDevServer(project(`${String.fromCharCode(0xfeff)}${JSON.stringify({ scripts: { dev: 'vite' } })}`));
  assert.equal(bom.tool, 'vite', 'a BOM is not broken JSON');
  const big = JSON.stringify({ scripts: { dev: 'vite' }, pad: 'x'.repeat(1024 * 1024) });
  assert.equal(await detectDevServer(project(big)), null, 'over 1 MB is not read');
});

test('detectDevServer: a FIFO named package.json is refused at once, never waited on', { skip: process.platform === 'win32' }, async () => {
  const dir = project(undefined);
  const fifo = join(dir, 'package.json');
  execFileSync('mkfifo', [fifo]);
  let settled = false;
  const got = detectDevServer(dir).then((v) => { settled = true; return v; });
  await new Promise((r) => setTimeout(r, 300));
  const done = settled;
  if (!done) { try { closeSync(openSync(fifo, fsc.O_WRONLY | fsc.O_NONBLOCK)); } catch { /* frees a blocked reader */ } }
  assert.equal(done, true, 'a blocking open would hold a thread until something writes');
  assert.equal(await got, null);
});

test('devServerAction: a service on PORT, opened at localhost, that the Actions config accepts; ids never collide', async () => {
  const found = await detectDevServer(project({ scripts: { dev: 'vite' } }));
  const action = devServerAction(found, ['dev', 'dev-2']);
  assert.equal(action.id, 'dev-3');
  const cfg = normalizeProjectActions({ actions: [action] });
  assert.deepEqual(cfg.actions[0], { id: 'dev-3', label: 'Dev server', kind: 'service', cmd: 'npm run dev -- --port {PORT}', cmdWin32: null,
    cwd: '.', env: [{ name: 'PORT', type: 'port', value: 'auto' }], openUrl: 'http://localhost:{PORT}',
    ready: { kind: 'port', port: 'PORT', timeoutMs: 120000 } });
  const pinned = devServerAction(await detectDevServer(project({ scripts: { dev: 'vite --port 3001' } })));
  assert.deepEqual(normalizeProjectActions({ actions: [pinned] }).actions[0].env, [{ name: 'PORT', type: 'port', value: 3001 }]);
  const runner = devServerAction(await detectDevServer(project({ scripts: { dev: 'concurrently "vite" "node api.js"' } })));
  assert.deepEqual(normalizeProjectActions({ actions: [runner] }).actions[0].env, [{ name: 'PORT', type: 'port', value: 5173 }],
    'the port the server really listens on, so the ready check and openUrl find it');
});

test('lane C: PORT=<n> in front of a tool that ignores PORT is no pin: the tool still gets the flag', async () => {
  for (const dev of ['cross-env PORT=3000 vite', 'PORT=4000 vite', 'PORT=4000 astro dev']) {
    const d = await detectDevServer(project({ scripts: { dev } }));
    assert.deepEqual([d.cmd, d.pinned], ['npm run dev -- --port {PORT}', false], dev);
  }
  const node = await detectDevServer(project({ scripts: { dev: 'PORT=4000 node server.js' } }));
  assert.deepEqual([node.cmd, node.port, node.pinned], ['npm run dev', 4000, true], 'a tool that reads PORT keeps the pin');
  const nx = await detectDevServer(project({ scripts: { dev: 'cross-env PORT=3000 next dev' } }));
  assert.deepEqual([nx.port, nx.pinned], [3000, true]);
});
