// test/agent-derived-description.test.mjs — the .md frontmatter description is a
// COMPUTED value, not authored text (web-UI review F5). The registry resolves it
// so every read surface shows it, marks it `descriptionDerived`, and no write
// path may bake it into the sidecar: a save that does not carry an explicit
// description must leave the stored description empty, so the fallback keeps
// tracking the .md instead of freezing on first save.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { listAgents, updateAgent, userAgentsDir } from '../src/core/agent-store.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

useTempHome(after);

const FM_DESC = 'Came from the .md frontmatter, proving the registry fallback.';

/** A user agent whose sidecar description is empty and whose .md has one. */
function seed(key, { description = '' } = {}) {
  const dir = userAgentsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    metaVersion: 2,
    key, displayName: key, description, color: 'blue', runnerType: 'producer',
    order: 120, agentFile: `${key}.md`,
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
  }, null, 2) + '\n', 'utf8');
  writeFileSync(join(dir, `${key}.md`), `---\nname: ${key}\ndescription: ${FM_DESC}\n---\n\n# ${key}\n`, 'utf8');
  return dir;
}
const onDisk = async (key) =>
  JSON.parse(await readFile(join(userAgentsDir(), `${key}.meta.json`), 'utf8'));

test('the registry resolves the frontmatter description AND flags it as derived', async () => {
  seed('derivedOne');
  const meta = (await listAgents()).find((m) => m.key === 'derivedOne');
  assert.equal(meta.description, FM_DESC, 'read surfaces still get the resolved text');
  assert.equal(meta.descriptionDerived, true, 'flagged so editors do not treat it as authored');
});

test('an authored sidecar description is never flagged derived', async () => {
  seed('authoredOne', { description: 'Sidecar wins here.' });
  const meta = (await listAgents()).find((m) => m.key === 'authoredOne');
  assert.equal(meta.description, 'Sidecar wins here.');
  assert.ok(!meta.descriptionDerived, 'authored text carries no derived flag');
});

test('saving without a description does not bake the derived text into the sidecar', async () => {
  seed('derivedTwo');
  // The review's repro: the user edits ONLY the system-prompt textarea, which
  // carries the whole .md (frontmatter included) and no description of its own.
  await updateAgent('derivedTwo', {
    markdown: `---\nname: derivedTwo\ndescription: ${FM_DESC}\n---\n\n# derivedTwo\n\nEdited body.\n`,
  });
  assert.equal((await onDisk('derivedTwo')).description, '', 'sidecar description stays empty');
  // ...and the fallback still tracks the .md on the next read.
  const meta = (await listAgents()).find((m) => m.key === 'derivedTwo');
  assert.equal(meta.description, FM_DESC);
  assert.equal(meta.descriptionDerived, true);
});

test('re-saving the derived text as the description explicitly still clears it', async () => {
  seed('derivedThree');
  // What a UI that pre-filled the derived text would PUT back. The user asked
  // for no description; an empty string must persist as empty.
  await updateAgent('derivedThree', { meta: { description: '' } });
  assert.equal((await onDisk('derivedThree')).description, '');
  // An explicitly authored value does persist, and drops the derived flag.
  await updateAgent('derivedThree', { meta: { description: 'Now authored.' } });
  assert.equal((await onDisk('derivedThree')).description, 'Now authored.');
  const meta = loadAgentRegistry()['derivedThree'];
  assert.equal(meta.description, 'Now authored.');
  assert.ok(!meta.descriptionDerived);
});

test('descriptionDerived is computed — it never reaches the sidecar on disk', async () => {
  seed('derivedFour');
  await updateAgent('derivedFour', { meta: { displayName: 'Renamed' } });
  const raw = await onDisk('derivedFour');
  assert.equal(raw.displayName, 'Renamed');
  assert.ok(!('descriptionDerived' in raw), 'computed flag is stripped like origin/agentPath');
  assert.ok(!('origin' in raw));
  assert.ok(!('agentPath' in raw));
});
