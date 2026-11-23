// test/workflow-export-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

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
  srv = appServer(app);
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

test('POST export answers 400 for a missing destination, an unknown onConflict and a bogus per-path resolution', async () => {
  const cases = [
    { name: 'POST export requires a valid destination', body: {}, error: /destination/ },
    { name: 'apply rejects an unknown onConflict value (no silent overwrite)',
      body: { destination: 'project', projectDir: await tmp(), onConflict: 'Overwrite' }, error: /onConflict must be one of/ },
    { name: 'apply rejects a bogus per-path resolution value',
      body: { destination: 'project', projectDir: await tmp(), resolutions: { '/some/path': 'Overwrite' } }, error: /invalid resolution/ },
  ];
  await checkRows(cases.map(({ name, body, error }) => ({ name, run: async () => {
    const r = await fetch(`${base}/api/workflows/wf_default/export`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, error);
  } })));
});

test('apply writes the tree — plain and with onConflict=overwrite (never a silent no-op plan)', async () => {
  await checkRows([
    { name: 'apply honors onConflict=overwrite and writes the tree', run: async () => {
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
    } },
    { name: 'a plain apply (no dryRun/onConflict/resolutions) writes, not a silent no-op plan', run: async () => {
      const dest = await tmp();
      const r = await fetch(`${base}/api/workflows/wf_default/export`, {
        method: 'POST', headers: JSONH,
        body: JSON.stringify({ destination: 'project', projectDir: dest }),
      });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.ok(Array.isArray(j.written) && j.written.length > 0, 'apply actually wrote files');
      assert.equal(existsSync(join(dest, '.claude/skills/default/SKILL.md')), true);
    } },
  ]);
});

test('unknown workflow id maps to 404', async () => {
  const r = await fetch(`${base}/api/workflows/wf_does_not_exist/export`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ destination: 'project', projectDir: await tmp(), dryRun: true }),
  });
  assert.equal(r.status, 404);
});
