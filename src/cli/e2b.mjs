// src/cli/e2b.mjs
// `worca e2b` — the e2b execution environment's housekeeping (docs/e2b.md).
import { sweepConfiguredSandboxes } from '../core/exec-env/sweep.mjs';

export const E2B_HELP = `worca e2b — E2B sandboxes of the e2b execution environment

Usage:
  worca e2b sweep [--dry-run] [--all]   kill this instance's orphan sandboxes
                                         (--all: every sandbox this instance tagged, live runs included)
`;

export async function cmdE2b(argv, { out, fail, sweep = sweepConfiguredSandboxes } = {}) {
  const [verb, ...rest] = argv;
  if (!verb || verb === 'help' || verb === '--help') { out(E2B_HELP); return 0; }
  if (verb !== 'sweep') { fail(`unknown e2b command: ${verb} (see: worca e2b help)`); return 1; }
  const unknown = rest.find((a) => a !== '--dry-run' && a !== '--all');
  if (unknown) { fail(`unknown option ${unknown}`); return 2; }
  const dryRun = rest.includes('--dry-run');
  const r = await sweep({ dryRun, all: rest.includes('--all') });
  if (r.skipped) { out('e2b is not configured (E2B_API_KEY unset or the e2b package missing): nothing to sweep'); return 0; }
  for (const k of r.killed) out(`${dryRun ? 'would kill' : 'killed'} ${k.sandboxId}${k.runId ? ` (run ${k.runId})` : ''}`);
  out(`${dryRun ? 'would kill' : 'killed'} ${r.killed.length}, kept ${r.kept.length}`);
  return 0;
}
