// test/fixtures/team-metrics/flush-child.mjs — a second "machine" (its own WORCA_HOME + DB)
import { addProject } from '../../../src/core/projects.mjs';
import { enableTeamMetrics, discoverProject, writeOutbox, flushSlug } from '../../../src/core/metrics/sync.mjs';

const cmd = JSON.parse(process.argv[2]);
let out;
if (cmd.op === 'add-enable') {
  await addProject({ name: cmd.name, path: cmd.dir });
  out = await enableTeamMetrics(cmd.dir, { mode: 'here' });
} else if (cmd.op === 'write-flush') {
  await discoverProject(cmd.dir, { force: true });
  await writeOutbox(cmd.slug, cmd.record);
  out = await flushSlug(cmd.slug, { sleep: async () => {} });
} else {
  throw new Error(`unknown op ${cmd.op}`);
}
process.stdout.write(JSON.stringify(out), () => process.exit(0)); // never hang on open handles (DB, timers)
