// test/workflow-export-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, srv, base, prevHome;
const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'wf-exp-api-')); dirs.push(d); return d; };
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-xpapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('POST export requires a valid destination', async () => {
  const r = await fetch(`${base}/api/workflows/wf_default/export`, { method: 'POST', headers: JSONH, body: JSON.stringify({}) });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /destination/);
});

test('dry-run returns classification with zero writes', async () => {
  const dest = await tmp();
  const r = await fetch(`${base}/api/workflows/wf_default/export`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ destination: 'project', projectDir: dest, dryRun: true }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.created) && j.created.length > 0);
  assert.equal(existsSync(join(dest, '.claude')), false, 'dry-run writes nothing');
});

test('apply honors onConflict=overwrite and writes the tree', async () => {
  const dest = await tmp();
  const r = await fetch(`${base}/api/workflows/wf_default/export`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ destination: 'project', projectDir: dest, onConflict: 'overwrite' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.written) && j.written.length > 0);
  const skill = await readFile(join(dest, '.claude/skills/default/SKILL.md'), 'utf8');
  assert.match(skill, /## Invariants/);
});

test('apply rejects an unknown onConflict value (no silent overwrite)', async () => {
  const r = await fetch(`${base}/api/workflows/wf_default/export`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ destination: 'project', projectDir: await tmp(), onConflict: 'Overwrite' }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /onConflict must be one of/);
});

test('apply rejects a bogus per-path resolution value', async () => {
  const r = await fetch(`${base}/api/workflows/wf_default/export`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ destination: 'project', projectDir: await tmp(), resolutions: { '/some/path': 'Overwrite' } }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /invalid resolution/);
});

test('a plain apply (no dryRun/onConflict/resolutions) writes, not a silent no-op plan', async () => {
  const dest = await tmp();
  const r = await fetch(`${base}/api/workflows/wf_default/export`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ destination: 'project', projectDir: dest }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.written) && j.written.length > 0, 'apply actually wrote files');
  assert.equal(existsSync(join(dest, '.claude/skills/default/SKILL.md')), true);
});

test('unknown workflow id maps to 404', async () => {
  const r = await fetch(`${base}/api/workflows/wf_does_not_exist/export`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ destination: 'project', projectDir: await tmp(), dryRun: true }),
  });
  assert.equal(r.status, 404);
});
