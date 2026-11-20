// test/wf-default-snapshot.test.mjs — the "before" of the engine role-review step: Default, lean and PR fix resolve to
// graphs that deepEqual fixtures recorded before the change, and the Default template is byte-stable. A node without a
// role review must never gain a key (no opt-in, no change).
// Regenerate deliberately with UPDATE_RESOLVED_GRAPHS=1 and review the diff.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { resolveGraph } from '../src/core/workflows.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const FIX = join(HERE, 'fixtures');
const GRAPH_DIR = join(FIX, 'resolved-graphs');
const UPDATE = process.env.UPDATE_RESOLVED_GRAPHS === '1';

const home = useTempHome(after);
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-snap-'));
let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK'];
before(() => {
  sandboxHome = mkdtempSync(join(tmpdir(), 'worca-snap-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

/** JSON-stable: functions dropped, Sets as sorted arrays, keys sorted, the repo and temp dirs as $REPO / $TMP. */
function normalize(v, temps) {
  if (typeof v === 'function' || v === undefined) return undefined;
  if (typeof v === 'string') {
    let s = v.split(REPO).join('$REPO');
    for (const t of temps) s = s.split(t).join('$TMP');
    return s;
  }
  if (v instanceof Set) return [...v].map((x) => normalize(x, temps)).sort();
  if (v instanceof Map) return normalize(Object.fromEntries(v), temps);
  if (Array.isArray(v)) return v.map((x) => normalize(x, temps) ?? null);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const n = normalize(v[k], temps);
      if (n !== undefined) out[k] = n;
    }
    return out;
  }
  return v;
}

const temps = () => [...new Set([projectDir, home, sandboxHome].flatMap((p) => [p, realpathSync(p)]))];
const REG = () => loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });

function compare(file, actual, flag) {
  const text = `${JSON.stringify(actual, null, 2)}\n`;
  if (UPDATE) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, 'utf8');
    return;
  }
  assert.deepEqual(actual, JSON.parse(readFileSync(file, 'utf8')),
    `drifted from ${file.slice(REPO.length + 1)}. If the change is deliberate, review the diff and regenerate with ${flag}=1.`);
}

for (const workflowId of ['wf_default', 'wf_lean_build', 'wf_pr_fix']) {
  test(`${workflowId}: the resolved graph matches test/fixtures/resolved-graphs/${workflowId}.json`, async () => {
    const g = await resolveGraph(projectDir, workflowId, REG(), undefined, { engine: 'claude' });
    const actual = normalize(g, temps());
    // Twice in a row, byte-identical: the capture is deterministic before it is ever written.
    const again = normalize(await resolveGraph(projectDir, workflowId, REG(), undefined, { engine: 'claude' }), temps());
    assert.equal(JSON.stringify(again), JSON.stringify(actual));
    compare(join(GRAPH_DIR, `${workflowId}.json`), actual, 'UPDATE_RESOLVED_GRAPHS');
  });
}

test('the GRAPH_DEFAULT_WORKFLOW template matches test/fixtures/wf-default.snapshot.json', () => {
  compare(join(FIX, 'wf-default.snapshot.json'), JSON.parse(JSON.stringify(GRAPH_DEFAULT_WORKFLOW)), 'UPDATE_RESOLVED_GRAPHS');
});
