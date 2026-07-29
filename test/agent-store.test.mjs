// test/agent-store.test.mjs — user-agent CRUD over <WORCA_HOME>/.worca-cc/agents.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  listAgents, readAgent, createAgent, updateAgent, deleteAgent,
  keyFromName, userAgentsDir, AGENT_KEY_RE,
} from '../src/core/agent-store.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';

useTempHome(after);

const MD = '# Agent: Docs Writer\n\nYou write docs.\n';
const META = {
  displayName: 'Docs Writer', description: 'writes docs', color: 'green',
  runnerType: 'producer', consumes: ['plan'], produces: ['review'], order: 42,
};

test('keyFromName: lower-camel slug', () => {
  assert.equal(keyFromName('API Docs Writer'), 'apiDocsWriter');
  assert.equal(keyFromName('  plan!! '), 'plan');
  assert.equal(keyFromName(''), '');
});

test('createAgent writes the <key>.md + <key>.meta.json pair and lists with origin:user', async () => {
  const { meta, markdown } = await createAgent({ meta: META, markdown: MD });
  assert.equal(meta.key, 'docsWriter');
  assert.equal(meta.origin, 'user');
  assert.equal(meta.agentFile, 'docsWriter.md');
  assert.equal(markdown, MD);
  const onDisk = JSON.parse(await readFile(join(userAgentsDir(), 'docsWriter.meta.json'), 'utf8'));
  assert.equal(onDisk.key, 'docsWriter');
  assert.equal(await readFile(join(userAgentsDir(), 'docsWriter.md'), 'utf8'), MD);
  const all = await listAgents();
  const mine = all.find((m) => m.key === 'docsWriter');
  assert.ok(mine && mine.origin === 'user');
  assert.equal(all.find((m) => m.key === 'planner').origin, 'builtin');
});

test('createAgent rejects a builtin-key collision and an empty markdown', async () => {
  await assert.rejects(
    () => createAgent({ meta: { ...META, key: 'planner' }, markdown: MD }),
    (e) => e.code === 'BUILTIN');
  await assert.rejects(
    () => createAgent({ meta: { ...META, displayName: 'Empty Body' }, markdown: '   ' }),
    (e) => e.code === 'BAD_REQUEST');
  await assert.rejects( // duplicate user key
    () => createAgent({ meta: META, markdown: MD }),
    (e) => e.code === 'DUPLICATE');
});

test('readAgent returns {meta, markdown} for user AND builtin agents', async () => {
  const user = await readAgent('docsWriter');
  assert.equal(user.markdown, MD);
  const builtin = await readAgent('planner');
  assert.equal(builtin.meta.origin, 'builtin');
  assert.match(builtin.markdown, /\w/); // agents/worca-cc-planner.md body loaded
  assert.equal(await readAgent('nope'), null);
});

test('updateAgent edits meta + markdown for user agents; built-ins are 409-coded', async () => {
  const upd = await updateAgent('docsWriter', {
    meta: { ...META, displayName: 'Docs Writer v2' }, markdown: MD + 'More.\n',
  });
  assert.equal(upd.meta.displayName, 'Docs Writer v2');
  assert.equal(upd.meta.key, 'docsWriter'); // key immutable
  assert.equal((await readAgent('docsWriter')).markdown, MD + 'More.\n');
  await assert.rejects(() => updateAgent('planner', { meta: META }), (e) => e.code === 'BUILTIN');
  await assert.rejects(() => updateAgent('ghost', { meta: META }), (e) => e.code === 'NOT_FOUND');
});

test('deleteAgent: 409-coded while referenced by a saved workflow, then removes the pair', async () => {
  const wf = await writeWorkflow({
    name: 'Uses Docs', steps: [[{ id: 's0_0', key: 'docsWriter' }]], feedbacks: [],
  });
  await assert.rejects(() => deleteAgent('docsWriter'), (e) => e.code === 'REFERENCED');
  const { deleteWorkflow } = await import('../src/core/workflows.mjs');
  await deleteWorkflow(wf.id);
  assert.deepEqual(await deleteAgent('docsWriter'), { ok: true });
  assert.equal(await readAgent('docsWriter'), null);
  await assert.rejects(() => deleteAgent('planner'), (e) => e.code === 'BUILTIN');
});

test('AGENT_KEY_RE forecloses path traversal', () => {
  assert.equal(AGENT_KEY_RE.test('../etc'), false);
  assert.equal(AGENT_KEY_RE.test('a/b'), false);
  assert.equal(AGENT_KEY_RE.test('docsWriter'), true);
});
