// test/no-project-identity.test.mjs — P3: the one reserved store key for runs without a project.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { mkdirSync, realpathSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { NO_PROJECT_KEY, NO_PROJECT_NAME, isNoProjectKey } from '../src/shared/no-project.mjs';
import { PROJECT_KEY_RE, projectKey, noProjectWorkDir, isNoProjectWorkDir, runProjectDir, NO_PROJECT_KEY as STORE_KEY } from '../src/core/store.mjs';
import { addProject, insertProject, countProjects, worcaHome } from '../src/core/projects.mjs';

const home = useTempHome(after, 'worca-np-id-');

test('the reserved key has the project-key shape and the store re-exports it', () => {
  assert.equal(NO_PROJECT_KEY, 'no-project-00000000');
  assert.equal(STORE_KEY, NO_PROJECT_KEY);
  assert.match(NO_PROJECT_KEY, PROJECT_KEY_RE);
  assert.equal(NO_PROJECT_NAME, 'No project');
  assert.equal(isNoProjectKey('no-project-00000000'), true);
  for (const k of ['demo-00000001', '', null, undefined, 'workspaces/no-project-00000000']) assert.equal(isNoProjectKey(k), false, String(k));
});

test('a run work folder maps to the reserved key; its neighbours keep their own keys', () => {
  const work = noProjectWorkDir('abcd1234');
  assert.equal(work, join(worcaHome(), 'runs', 'abcd1234', 'work'));
  assert.equal(isNoProjectWorkDir(work), true);
  assert.equal(isNoProjectWorkDir(`${work}${sep}..${sep}work`), true, 'resolved, not string-compared');   // join() would normalize the .. away
  assert.equal(projectKey(work), NO_PROJECT_KEY);
  const upper = process.platform === 'win32' ? [] : [join(worcaHome(), 'runs', 'ABCD1234', 'work')];   // NTFS folds case (below)
  for (const d of [join(worcaHome(), 'runs', 'abcd1234'), ...upper,
    join(worcaHome(), 'runs', 'abcd1234', 'repos', 'x'), join(home, 'elsewhere', 'runs', 'abcd1234', 'work')]) {
    assert.equal(isNoProjectWorkDir(d), false, d);
    assert.notEqual(projectKey(d), NO_PROJECT_KEY, d);
  }
  if (process.platform === 'win32') {
    assert.equal(isNoProjectWorkDir(work.replace(/runs/, 'RUNS')), true, 'NTFS is case-insensitive');
    assert.equal(isNoProjectWorkDir(join(worcaHome(), 'runs', 'ABCD1234', 'WORK')), true, 'the id and work/ too');
  }
  mkdirSync(work, { recursive: true });
  assert.equal(isNoProjectWorkDir(realpathSync(work)), true, 'the realpath spelling (macOS /var ↔ /private/var)');
  assert.throws(() => noProjectWorkDir('not-hex'), { message: 'noProjectWorkDir: pipeline id must be 8 hex characters' });
});

test('runProjectDir: the reserved key resolves to the row\'s own work folder and never asks the registry', async () => {
  let asked = 0;
  const lookup = async () => { asked += 1; return '/registered'; };
  assert.equal(await runProjectDir({ id: 'abcd1234', project_key: NO_PROJECT_KEY }, lookup), noProjectWorkDir('abcd1234'));
  assert.equal(asked, 0);
  assert.equal(await runProjectDir({ id: 'abcd1234', project_key: 'demo-00000001' }, lookup), '/registered');
});

test('a run work folder can never be added as a project', async () => {
  await assert.rejects(addProject({ name: 'Work', path: noProjectWorkDir('abcd1234') }), { message: 'this folder belongs to a run without a project' });
  mkdirSync(noProjectWorkDir('abcd1234'), { recursive: true });   // an existing work folder (no .git) inside a git work tree
  mkdirSync(join(home, '.git'));
  assert.throws(() => insertProject({ name: 'Work', path: noProjectWorkDir('abcd1234') }, { gitOn: false }), { message: 'this folder belongs to a run without a project' });
  assert.equal(countProjects(), 0);
});
