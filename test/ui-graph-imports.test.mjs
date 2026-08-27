// test/ui-graph-imports.test.mjs — the §3 import convention is a CONTRACT: the
// browser modules reach the shared core by a relative path that walks above the
// static root. An absolute specifier ('/src/shared/...') breaks Node ESM, and the
// UI tests import these files as plain Node modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = fileURLToPath(new URL('../ui/public/graph/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));

test('every ui/public/graph module reaches src/shared by a 3-level relative path', () => {
  // P5a ships model.mjs + view.mjs; P5b adds composer/palette/inspector/save-dialog.
  // Anchor on the modules that must ALWAYS be here rather than on a count that is
  // only reached halfway through the plan.
  for (const must of ['model.mjs', 'view.mjs']) {
    assert.ok(files.includes(must), `expected ${must}, found ${files.join(',')}`);
  }
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/from\s+['"]\/src\//.test(src), `${f} must not use an absolute /src specifier`);
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.includes('src/shared')) continue;
      assert.ok(spec.startsWith('../../../src/shared/'), `${f}: '${spec}' must start with ../../../src/shared/ (depth 3)`);
      assert.ok(existsSync(path.join(dir, spec)), `${f}: '${spec}' resolves on disk`);
    }
  }
});

test('the browser modules never import from src/core (no cross-layer leak)', () => {
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/src\/core\//.test(src), `${f} must not import from src/core`);
  }
});
