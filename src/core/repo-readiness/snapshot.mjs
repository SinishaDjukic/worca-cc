// src/core/repo-readiness/snapshot.mjs
// Run-start readiness snapshot: the primary project's level for the run's own engine (always judged, whatever
// readiness.tools says) together with the repository checks, merged into run.json. Evaluates directly and never touches the shared cache, so a run cannot rewrite the
// engine or ignore list the Projects chip reads.
import { resolve } from 'node:path';
import { evaluateReadiness, readinessEnabled } from './evaluate.mjs';
import { updateRunManifest } from '../run-manifest.mjs';
import { readinessIgnore } from '../settings.mjs';
import { INTERACTIVE_TIMEOUT_MS } from '../git-sync.mjs';

const RANK = { ready: 0, partial: 1, 'not-ready': 2, unknown: 3 };

/**
 * Best-effort: never throws, and records nothing when disabled or when evaluation yields no row
 * for `engine`. Resolves to the recorded snapshot, or null.
 */
export async function writeReadinessSnapshot({ runRoot, projectDir, projectKey, engine, ignore } = {}) {
  try {
    const dir = projectDir && resolve(projectDir);
    if (!dir || !runRoot || !readinessEnabled()) return null;
    // The project's own ignore list, as the Projects chip applies it.
    const skip = ignore ?? readinessIgnore({ projectDir: dir, projectKey });
    const base = await evaluateReadiness({ dir, projectKey, ignore: skip, timeoutMs: INTERACTIVE_TIMEOUT_MS });
    const tool = base?.engines?.[engine];
    if (!tool) return null;
    const level = [tool.level, base.repository.level].reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
    const readiness = { catalogVersion: base.catalogVersion, engine, level, failing: [...base.repository.failing, ...tool.failing] };
    await updateRunManifest(runRoot, { readiness });
    return readiness;
  } catch {
    return null;
  }
}
