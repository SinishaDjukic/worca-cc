// test/api-scripts.test.mjs — GET /api/scripts + /api/scripts/:key (spec §8.4).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let homeDir, srv, base, prevHome;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-scriptsapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  // A user-layer script beside the built-ins.
  const user = join(homeDir, '.worca-cc', 'scripts');
  await mkdir(user, { recursive: true });
  await writeFile(join(user, 'lint.mjs'), 'export default async () => ({ summary: "lint" });\n');
  await writeFile(join(user, 'lint.meta.json'), JSON.stringify({ key: 'lint', metaVersion: 2, displayName: 'Lint', runtime: 'node', file: 'lint.mjs',
    inputs: [{ id: 'done', type: 'void', required: false }], outputs: [{ id: 'log', type: 'md', filename: 'lint-cycle{cycle}.md' }] }));
  // A user-layer script that collides with an agent key is dropped (D16).
  await writeFile(join(user, 'reviewer.meta.json'), JSON.stringify({ key: 'reviewer', metaVersion: 2, runtime: 'shell', command: 'true', inputs: [], outputs: [] }));
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/scripts lists built-ins + the user layer in order, D16-filtered, with paths stamped', async () => {
  const r = await fetch(`${base}/api/scripts`);
  assert.equal(r.status, 200);
  const { scripts } = await r.json();
  assert.deepEqual(scripts.map((s) => s.key), ['shell', 'js', 'gitDiff', 'lint']);
  assert.equal(scripts.find((s) => s.key === 'reviewer'), undefined, 'an agent key wins');
  const shell = scripts[0];
  assert.equal(shell.origin, 'builtin');
  assert.equal(shell.ports, 'config');
  assert.ok(Array.isArray(shell.defaultPorts.outputs));
  assert.deepEqual(shell.params.map((p) => p.type), ['command']);
  const lint = scripts[3];
  assert.equal(lint.origin, 'user');
  assert.equal(lint.runtime, 'node');
  assert.match(lint.scriptPath, /lint\.mjs$/);
  assert.equal(lint.commandResolved, null);
});

test('GET /api/scripts/:key returns the meta plus the source; unknown and malformed keys are 404', async () => {
  const r = await fetch(`${base}/api/scripts/lint`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.key, 'lint');
  assert.equal(d.source, 'export default async () => ({ summary: "lint" });\n');
  assert.match(d.sourcePath, /lint\.mjs$/);
  assert.equal(d.sourceTruncated, false);
  const sh = await (await fetch(`${base}/api/scripts/shell`)).json();
  assert.equal(sh.source, '', 'a shell card with no file has no source');
  assert.equal(sh.sourcePath, null);
  assert.equal((await fetch(`${base}/api/scripts/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/scripts/..%2Fx`)).status, 404);
});
