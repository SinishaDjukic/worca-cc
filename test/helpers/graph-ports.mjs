// test/helpers/graph-ports.mjs
// THE test port source: the REAL agents/*.meta.json, never a copied fixture
// table. A drifting sidecar must break the tests that depend on its ports —
// that is the whole point of the seed drift guard.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
import { indexByKey, normalizeAgentMeta } from '../../src/shared/graph/agent-meta.mjs';
import { MOCK_WRITER_ROLES } from '../../src/core/claude-runner.mjs';

const AGENTS_DIR = fileURLToPath(new URL('../../agents/', import.meta.url));

/** Every builtin sidecar, normalized. Throws (loudly, with the rule text) when
 *  one is invalid — a broken builtin must never silently degrade a test. */
export function realAgentMetas() {
  return readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.meta.json')).sort().map((f) => {
    const raw = JSON.parse(readFileSync(join(AGENTS_DIR, f), 'utf8'));
    const { meta, errors } = normalizeAgentMeta(raw, { mockWriterRoles: MOCK_WRITER_ROLES, warn: () => {} });
    if (errors.length) throw new Error(`agents/${f}: ${errors.join('; ')}`);
    return meta;
  });
}

export function realRegistryIndex() {
  return indexByKey(realAgentMetas());
}

export function realPortsFn() {
  return portsFnFor(realRegistryIndex());
}
