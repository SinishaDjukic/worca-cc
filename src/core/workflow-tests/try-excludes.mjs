// src/core/workflow-tests/try-excludes.mjs — the paths a project try keeps out of its own changes, saved in its pipeline
// folder: what "Before each try, run" made (3a D55) and the project's Claude Code settings Worca switched off (3b D72).
// The harness that ran the try holds them in memory; a harness rebuilt from the saved row (a paused try stopped by the
// runner, stopPausedRun) reads them back here, so its change list, diff and commit leave out Worca's own edits too.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TRY_EXCLUDES_FILE = 'try-excludes.json';

const paths = (v) => (Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p) : null);

/** Writes both lists (null for one never set). Never throws: a failed write leaves the live harness's lists as they are. */
export async function writeTryExcludes(pipelineDir, { setup = null, plugins = null } = {}) {
  if (!pipelineDir) return;
  const rec = { setup: paths(setup), plugins: paths(plugins) };
  await writeFile(join(pipelineDir, TRY_EXCLUDES_FILE), `${JSON.stringify(rec, null, 2)}\n`, 'utf8').catch(() => {});
}

/** `{ setup, plugins }` (each an array or null), or null when there is no readable file. */
export async function readTryExcludes(pipelineDir) {
  if (!pipelineDir) return null;
  try {
    const v = JSON.parse(await readFile(join(pipelineDir, TRY_EXCLUDES_FILE), 'utf8'));
    return v && typeof v === 'object' ? { setup: paths(v.setup), plugins: paths(v.plugins) } : null;
  } catch { return null; }
}
