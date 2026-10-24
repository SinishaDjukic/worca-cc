// test/fixtures/team-memory/machine-child.mjs — a second "machine" for test/memory-team-sync.test.mjs and
// test/memory-team-lifecycle.test.mjs: its own WORCA_HOME (store, DB, team-memory state), a clone of the same bare
// origin. Reads its command as JSON on stdin (a note can be past Linux's 128 KiB per-argument cap), prints ONE JSON line
// and exits.
import { readFileSync } from 'node:fs';
import { addProject } from '../../../src/core/projects.mjs';
import { projectKey } from '../../../src/core/store.mjs';
import { writeProjectSettings } from '../../../src/core/settings-cascade.mjs';
import { memoryRoot, projectScope, writeMemory, readMemory, removeMemory, listMemory } from '../../../src/core/memory-store.mjs';
import { queueTeamChanges, flushTeamMemory, refreshTeamLayer, deleteTeamNote, TEAM_MARKER_KEY } from '../../../src/core/memory-team.mjs';

const cmd = JSON.parse(readFileSync(0, 'utf8'));
const key = projectKey(cmd.dir);
const scope = projectScope(key);
const push = () => flushTeamMemory(key, { projectDir: cmd.dir, sleep: async () => {} });
let out;
if (cmd.op === 'join') {
  await addProject({ name: cmd.name, path: cmd.dir });
  writeProjectSettings({ projectDir: cmd.dir }, { 'memory.team': true });
  out = await refreshTeamLayer(key, { projectDir: cmd.dir, maxAgeMs: 0 });
} else if (cmd.op === 'write') {          // any local writer: store write → queue → push
  await writeMemory(memoryRoot(), scope, cmd.note, cmd.text, { source: 'user' });
  await queueTeamChanges(key, [cmd.note], { flush: false });
  out = await push();
} else if (cmd.op === 'forget') {
  await removeMemory(memoryRoot(), scope, cmd.note, { source: 'user' });
  await queueTeamChanges(key, [cmd.note], { flush: false });
  out = await push();
} else if (cmd.op === 'teamdelete') {     // a team delete (API / CLI) → push
  await deleteTeamNote(key, cmd.note, { flush: false });
  out = await push();
} else if (cmd.op === 'refresh') {
  out = await refreshTeamLayer(key, { projectDir: cmd.dir, maxAgeMs: 0 });
} else if (cmd.op === 'local') {
  out = {};
  for (const e of await listMemory(memoryRoot(), scope)) {
    const f = await readMemory(memoryRoot(), scope, e.name);
    out[e.name] = { body: f.body.trim(), marker: f.meta.extra[TEAM_MARKER_KEY] || null };
  }
} else {
  throw new Error(`unknown op ${cmd.op}`);
}
process.stdout.write(JSON.stringify(out ?? null), () => process.exit(0));   // never hang on open handles (DB, timers)
