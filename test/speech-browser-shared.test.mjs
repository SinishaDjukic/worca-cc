// test/speech-browser-shared.test.mjs — dev's voice and speech modules have one copy in src/shared/ (D15), and the
// src/shared/ files this slice adds import nothing outside src/shared/ (R-arch-8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NEW_SHARED = ['ask-model.mjs', 'ask-run-snapshot.mjs', 'ask-card-types.mjs', 'ask-voice.mjs', 'speech-browser.mjs', 'terminal-line.mjs'];

test('ui/public re-exports are the shared functions', async () => {
  for (const [ui, shared] of [['speech-browser.mjs', 'speech-browser.mjs'], ['ask-voice.mjs', 'ask-voice.mjs'], ['terminal-line.mjs', 'terminal-line.mjs']]) {
    const a = await import(`../ui/public/${ui}`), b = await import(`../src/shared/${shared}`);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), ui);
    for (const k of Object.keys(b)) assert.equal(a[k], b[k], `${ui} ${k}`);
  }
});

test('every new src/shared/ file of this slice imports only inside src/shared/', () => {
  const sharedDir = resolve(ROOT, 'src/shared');
  for (const f of NEW_SHARED) {
    const file = resolve(sharedDir, f), src = readFileSync(file, 'utf8');
    const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const s of specs) {
      assert.ok(s.startsWith('.'), `${f}: ${s} is not a relative import`);
      const to = relative(sharedDir, resolve(dirname(file), s));
      assert.ok(!to.startsWith('..'), `${f} imports ${s}, outside src/shared/`);
    }
  }
});
