// POST /api/workspaces/:id/open-in-editor {projectKey, file} (Stillhet slice 9 D15): a workspace question's evidence file
// opens in the editor. Only a file inside a member folder opens; every refusal comes before any launch. The editor is a
// recorder script set as the editor command (Settings › Actions), which writes what it was given to a file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

useTempHome(after, 'worca-cc-wsedit-');
const prevEnv = {};
const NODE = `"${process.execPath}"`;
let sandboxHome, srv, base, ws, a, b, rec, out;
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const open = (body) => call('POST', `/api/workspaces/${ws.id}/open-in-editor`, body);
const recorded = async () => (existsSync(out) ? (await readFile(out, 'utf8')).trim().split('\n').filter(Boolean) : []);

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-wsedit-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const repo = (tag) => { const dir = realpathSync(templateRepo(tag, { files: { 'src/receipts.ts': 'export {}\n' } })); return { dir, key: projectKey(dir) }; };
  a = repo('wsedit-a'); b = repo('wsedit-b');
  await addProject({ name: 'wsedit-a', path: a.dir });
  await addProject({ name: 'wsedit-b', path: b.dir });
  const made = await call('POST', '/api/workspaces', { name: 'Edit pair', projectPaths: [a.dir, b.dir] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  ws = made.body.workspace;
  out = join(sandboxHome, 'opened.txt');
  rec = join(sandboxHome, 'rec.mjs');
  await writeFile(rec, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(out)}, process.argv[2] + '\\n');\n`);
  assert.equal((await call('POST', '/api/settings', { actions: { editor: `${NODE} "${rec}" {folder}` } })).status, 200);
});
after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(sandboxHome, { recursive: true, force: true });
});

test('a member file opens: the recorder editor gets its absolute path, and the answer is {ok:true}', async () => {
  const r = await open({ projectKey: b.key, file: 'src/receipts.ts' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(await recorded(), [join(b.dir, 'src/receipts.ts')]);
});

test('refusals come before any launch: the recorder runs 0 times', async () => {
  const n = (await recorded()).length;
  await mkdir(join(sandboxHome, 'outside'), { recursive: true });
  await writeFile(join(sandboxHome, 'outside', 'secret.txt'), 'x');
  await symlink(join(sandboxHome, 'outside'), join(a.dir, 'leaves'));
  const cases = [
    [{ projectKey: 'other-0000abcd', file: 'src/receipts.ts' }, 400, 'that project is not in this workspace'],
    [{ projectKey: a.key, file: '../x' }, 400, 'that file is outside wsedit-a'],
    [{ projectKey: a.key, file: join(a.dir, 'src/receipts.ts') }, 400, 'that file is outside wsedit-a'],
    [{ projectKey: a.key, file: 'leaves/secret.txt' }, 400, 'that file is outside wsedit-a'],
    [{ projectKey: a.key, file: 'src/gone.ts' }, 404, 'that file is not there any more'],
    [{ projectKey: a.key, file: 'src' }, 404, 'that file is not there any more'],
    [{ projectKey: a.key, file: '.' }, 404, 'that file is not there any more'],
    [{ projectKey: a.key, file: 42 }, 400, 'file is required'],
    [{ projectKey: a.key, file: 'src/receipts.ts', cmd: 'rm -rf /' }, 400, null],
  ];
  for (const [body, status, error] of cases) {
    const r = await open(body);
    assert.equal(r.status, status, JSON.stringify([body, r.body]));
    if (error) assert.equal(r.body.error, error);
  }
  assert.equal((await open({ projectKey: a.key, file: 'src/gone.ts' })).body.code, 'NOT_FOUND');
  assert.equal((await open({ projectKey: a.key, file: '../x' })).body.code, 'INVALID');
  assert.equal((await call('POST', '/api/workspaces/wks-nope-0000abcd/open-in-editor', { projectKey: a.key, file: 'x' })).status, 404);
  assert.equal((await call('PUT', `/api/projects/${a.key}/actions`, { builtins: { editor: false } })).status, 200);
  const off = await open({ projectKey: a.key, file: 'src/receipts.ts' });
  assert.deepEqual([off.status, off.body.code], [409, 'DISABLED']);
  assert.equal((await recorded()).length, n);
});

test('an editor command that does not start answers 409 NOT_AVAILABLE or LAUNCH_FAILED, and the recorder runs 0 times', async () => {
  const n = (await recorded()).length;
  assert.equal((await call('POST', '/api/settings', { actions: { editor: `${NODE} -e "process.exit(3)"` } })).status, 200);
  try {
    const r = await open({ projectKey: b.key, file: 'src/receipts.ts' });
    assert.equal(r.status, 409);
    assert.ok(['NOT_AVAILABLE', 'LAUNCH_FAILED'].includes(r.body.code), r.body.code);
  } finally {
    await call('POST', '/api/settings', { actions: { editor: `${NODE} "${rec}" {folder}` } });
  }
  assert.equal((await recorded()).length, n);
});
