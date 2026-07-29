// test/skills-bundle.test.mjs
// Guards that the imagegen skill is bundled in the repo and python3-corrected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BUNDLE = fileURLToPath(new URL('../skills/imagegen/', import.meta.url));

test('imagegen skill is bundled with SKILL.md and script', async () => {
  for (const rel of [
    'SKILL.md',
    'scripts/generate_image.py',
  ]) {
    await assert.doesNotReject(access(BUNDLE + rel), `missing bundled file: ${rel}`);
  }
});

test('bundled generate_image.py uses python3, never bare python', async () => {
  const src = await readFile(BUNDLE + 'scripts/generate_image.py', 'utf8');
  // \bpython\b not immediately followed by "3" => a bare-python invocation slipped through.
  const offenders = src.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\bpython\b(?!3)/.test(line));
  assert.deepEqual(offenders.map((o) => o.n), [], `bare "python" on lines: ${offenders.map((o) => o.n).join(', ')}`);
});
