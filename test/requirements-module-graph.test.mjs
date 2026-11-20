// test/requirements-module-graph.test.mjs — the Requirements modules' import graph (review of #1041): no new import cycle, and each
// module loads alone in a fresh process, so no module relies on another having been loaded first. The one cycle left is A8's
// attachment-job.mjs ↔ interview.mjs (neither uses the other's bindings at module top level); any other cycle fails here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = fileURLToPath(new URL('../src/core/requirements/', import.meta.url));
const modules = readdirSync(DIR).filter((f) => f.endsWith('.mjs')).sort();
/** Cycles known before A6.1, each as its sorted module names. */
const ALLOWED = new Set([['attachment-job.mjs', 'interview.mjs'].join(' ')]);

/** Each module's sibling imports (static `import … from './x.mjs'`, multi-line import lists included). */
function siblingImports(file) {
  const src = readFileSync(join(DIR, file), 'utf8');
  return [...src.matchAll(/^(?:import|export)\s[^;]*?from\s+'\.\/([\w-]+\.mjs)'/gms)].map((m) => m[1]);
}

/** Tarjan's strongly connected components; returns those with more than one module. */
function cycles(graph) {
  let index = 0;
  const idx = new Map(); const low = new Map(); const stack = []; const on = new Set(); const out = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index += 1; stack.push(v); on.add(v);
    for (const w of graph.get(v) || []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const scc = [];
      let w;
      do { w = stack.pop(); on.delete(w); scc.push(w); } while (w !== v);
      if (scc.length > 1) out.push(scc.sort());
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) visit(v);
  return out;
}

test('no import cycle among the Requirements modules but the A8 one (attachment-job ↔ interview)', () => {
  const graph = new Map(modules.map((m) => [m, siblingImports(m)]));
  assert.ok(graph.get('import.mjs').includes('trackers.mjs'), 'the parser sees the imports');
  const found = cycles(graph).map((c) => c.join(' '));
  assert.deepEqual(found.filter((c) => !ALLOWED.has(c)), [], `new import cycles: ${found.join('; ')}`);
});

test('each Requirements module loads alone in a fresh process', () => {
  const home = mkdtempSync(join(tmpdir(), 'worca-req-graph-'));
  after(() => rmSync(home, { recursive: true, force: true }));
  // one child loads each module in its own fresh child, so a failure names the module
  const failed = [];
  for (const m of modules) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(DIR, m)).href)});`],
      { env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1' }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
    if (r.status !== 0) failed.push(`${m}: ${String(r.stderr || r.error || '').split('\n').find((l) => /Error/.test(l)) || r.status}`);
  }
  assert.deepEqual(failed, []);
});
