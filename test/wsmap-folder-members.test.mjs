// test/wsmap-folder-members.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { templateRepo } from './helpers/git-dir.mjs';
import { checkRows } from './helpers/rows.mjs';
import { listMemberFiles } from '../src/core/workspace-map/files.mjs';
import { extractWorkspace, failedExtract } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import { workspaceEnvelope } from '../src/core/graph/script-runner.mjs';
import { workspaceOf } from '../scripts/workspace-map-io.mjs';

const created = [];
after(() => { for (const d of created) rmSync(d, { recursive: true, force: true }); });

test('a Folder member is listed by walking, never through an enclosing repository', async () => {
  // A copy that sits inside some other repository which ignores it (worca home inside a dotfiles repo).
  const outer = templateRepo('wsmapf', { branch: 'main', user: true, files: { '.gitignore': 'copy/\n' } });
  created.push(outer);
  spawnSync('git', ['-C', outer, 'remote', 'add', 'origin', 'https://github.com/acme/dotfiles.git']);
  const outerHead = spawnSync('git', ['-C', outer, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const copy = join(outer, 'copy');
  mkdirSync(join(copy, 'src'), { recursive: true });
  mkdirSync(join(copy, 'graphify-out'));
  writeFileSync(join(copy, 'package.json'), '{"name":"notes-app"}\n');
  // A relative submodule URL: the git-submodules detector would ask git for this member's origin.
  writeFileSync(join(copy, '.gitmodules'), '[submodule "lib"]\n\tpath = lib\n\turl = ../lib.git\n');
  writeFileSync(join(copy, 'src', 'index.js'), "export {};\nexport const w = '/invoices/' + 1;\n");
  // A graph copied along with the folder, stamped with the enclosing repository's HEAD.
  writeFileSync(join(copy, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [], links: [], built_at_commit: outerHead }));
  const api = mkdtempSync(join(tmpdir(), 'worca-wsmapf-api-'));
  created.push(api);
  mkdirSync(join(api, 'src'));
  writeFileSync(join(api, 'src', 'r.ts'), "router.get('/invoices/:id', h)\n");
  await checkRows([
    { name: 'listMemberFiles({ git: false }) walks the folder', run: async () => {
      assert.deepEqual(await listMemberFiles(copy, { git: false }), { files: ['.gitmodules', 'package.json', 'src/index.js'], truncated: false, via: 'walk' });
      assert.deepEqual((await listMemberFiles(copy)).files, [], 'today\'s git listing honours the outer ignore rule');
    } },
    { name: 'extractWorkspace: a Folder member gets no git-remote alias and no graph head', run: async () => {
      // Every git spawn of the extraction writes to GIT_TRACE: a Folder member's extraction makes none.
      const trace = join(mkdtempSync(join(tmpdir(), 'worca-wsmapf-trace-')), 'git.log');
      created.push(dirname(trace));
      const prev = process.env.GIT_TRACE;
      process.env.GIT_TRACE = trace;
      let doc;
      try { doc = await extractWorkspace({ name: 'WS', members: [{ key: 'notes-00000004', name: 'notes', dir: copy, workMode: 'folder' }] }); }
      finally { if (prev === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = prev; }
      assert.equal(existsSync(trace), false, 'no git ran for the Folder member');
      const m = doc.members['notes-00000004'];
      assert.ok(!m.aliases.some((a) => a.source === 'git-remote'), JSON.stringify(m.aliases));
      assert.ok(m.aliases.some((a) => a.value === 'notes-app'), 'the walk reached package.json');
      assert.equal(m.workMode, 'folder', 'extract.json carries the mode to the catalog card');
      assert.equal(m.graph?.fresh, false, 'no HEAD is read for a Folder member, so a copied graph is never fresh');
      assert.equal(failedExtract({ name: 'WS', members: [{ key: 'notes-00000004', dir: copy, workMode: 'folder' }], error: 'x' })
        .members['notes-00000004'].workMode, 'folder', 'the degraded document keeps the mode too');
    } },
    { name: 'buildCatalog: the candidate scan walks a Folder member too', run: async () => {
      const ex = await extractWorkspace({ name: 'WS', members: [{ key: 'api-00000001', name: 'api', dir: api },
        { key: 'notes-00000004', name: 'notes', dir: copy, workMode: 'folder' }] });
      assert.ok(!('workMode' in ex.members['api-00000001']), 'a Git member\'s extract entry keeps today\'s keys');
      const sv = { version: 1, members: { 'api-00000001': { status: 'investigated', provides: [
        { kind: 'http', key: 'GET /invoices/:id', file: 'src/r.ts', line: 1, match: "router.get('/invoices/:id'" }], consumes: [] } } };
      assert.deepEqual((await buildCatalog({ extract: ex, survey: sv })).candidates['notes-00000004'].map((c) => `${c.file}:${c.line}`),
        ['src/index.js:2']);
    } },
    { name: 'the script envelope carries workMode for a Folder member only, and the cards\' workspaceOf keeps it', run: () => {
      const env = workspaceEnvelope({ workspaceId: 'wks-x-00000000', workspaceName: 'X', projects: [
        { projectKey: 'api-1', projectName: 'api', worktreeDir: '/r/a', projectDir: '/a' },
        { projectKey: 'notes-2', projectName: 'notes', worktreeDir: '/r/n', projectDir: '/n', workMode: 'folder' }] });
      assert.deepEqual(env.members.map((m) => m.workMode ?? null), [null, 'folder']);
      assert.ok(!('workMode' in env.members[0]), 'absent (not null) for a Git member: today\'s envelope bytes');
      assert.deepEqual(workspaceOf({ workspace: env }).members.map((m) => m.workMode ?? null), [null, 'folder']);
    } },
  ]);
});
