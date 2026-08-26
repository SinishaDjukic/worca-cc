// test/ask-projects-key.test.mjs
// P1/T3: listProjects() exposes the registry key (ask-worca-design.md §6.8) so the
// chat catalog and propose_run resolve projects by key without re-deriving it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject, listProjects } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

test('every row carries key = projectKey(path) and exactly {exists, key, name, path}', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-ask-proj-'));
  const list = await addProject({ name: 'demo', path: dir });
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ['exists', 'key', 'name', 'path']);
  assert.equal(list[0].key, projectKey(dir));
  assert.match(list[0].key, /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/);
  _resetForTests();                                    // reopen the DB: the key must come from the row, not from memory
  const again = await listProjects();
  assert.deepEqual(again, list, 'the persisted row carries the key');
});
