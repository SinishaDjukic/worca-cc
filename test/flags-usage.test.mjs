// test/flags-usage.test.mjs — the flag usage scan (D11). Every data-flag="…", flagOn('…'),
// flagEnabled('…'), requireFlag('…') and onFlagChange('…') key in ui/public/** and src/** is in the
// registry, and every registry key is used somewhere (a forgotten flag fails here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLAGS, FLAG_KEY_RE } from '../src/shared/flags/registry.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN = ['ui/public', 'src'];
const SCAN_FILES = ['ui/server.mjs'];   // the server checks flagEnabled('…') itself
const EXT = /\.(mjs|js|html)$/;
const PATTERNS = [
  /\bdata-flag="([^"]*)"/g,
  /\b(?:flagOn|flagEnabled|requireFlag|onFlagChange)\(\s*['"]([^'"]*)['"]/g,
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

function scanFlagUses(files) {
  const uses = new Map();   // key -> [file:line]
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const re of PATTERNS) {
        for (const m of line.matchAll(re)) {
          for (const key of m[1].split(/\s+/).filter(Boolean)) {
            if (!uses.has(key)) uses.set(key, []);
            uses.get(key).push(`${relative(ROOT, f)}:${i + 1}`);
          }
        }
      }
    });
  }
  return uses;
}

test('every flag key used in code is in the registry, well-formed, and every registry flag is used', () => {
  const files = [...SCAN.flatMap((d) => walk(join(ROOT, d))), ...SCAN_FILES.map((f) => join(ROOT, f))];
  assert.ok(files.length > 200, 'the scan sees the tree');
  const uses = scanFlagUses(files);
  const known = new Set(FLAGS.map((f) => f.key));
  const unknown = [...uses].filter(([k]) => !known.has(k)).map(([k, at]) => `${k} (${at.join(', ')})`);
  assert.deepEqual(unknown, [], 'flag keys used in code but missing from src/shared/flags/registry.mjs');
  const badShape = [...uses.keys()].filter((k) => !FLAG_KEY_RE.test(k));
  assert.deepEqual(badShape, [], 'flag keys must be camelCase [a-z][a-zA-Z0-9]{2,40}');
  const unused = FLAGS.map((f) => f.key).filter((k) => !uses.has(k));
  assert.deepEqual(unused, [], 'registry flags nothing uses: graduate or remove them (docs/feature-flags.md)');
});
