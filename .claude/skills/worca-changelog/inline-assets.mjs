#!/usr/bin/env node
// Inline every local <img src="…"> in an HTML file as a data URI so the page
// publishes as one self-contained file. Paths resolve relative to the input
// file, then to the repo root. Remote (http/data) sources are left alone.
//
//   node .claude/skills/worca-changelog/inline-assets.mjs <in.html> <out.html>
//
// Exits 1 on a missing file or a result above the Artifact ceiling.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: inline-assets.mjs <in.html> <out.html>');
  process.exit(2);
}

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif',
};
const HARD_LIMIT = 15 * 1024 * 1024;   // Artifact ceiling is 16 MB
const SOFT_LIMIT = 4 * 1024 * 1024;    // a ship log weighs ~1.6 MB; above this a PNG slipped in

const html = readFileSync(inPath, 'utf8');
const baseDir = dirname(resolve(inPath));
const repoRoot = process.cwd();
const seen = new Map();
let missing = 0;
const sizes = [];

const out = html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/g, (m, pre, src, post) => {
  if (/^(data:|https?:|\/\/)/i.test(src)) return m;
  const candidates = [resolve(baseDir, src), resolve(repoRoot, src)];
  const file = candidates.find((p) => existsSync(p));
  if (!file) {
    console.error(`missing: ${src}  (tried ${candidates.join(', ')})`);
    missing++;
    return m;
  }
  if (!seen.has(file)) {
    const mime = MIME[extname(file).toLowerCase()];
    if (!mime) {
      console.error(`unsupported image type: ${src}`);
      missing++;
      return m;
    }
    const buf = readFileSync(file);
    sizes.push([src, buf.length]);
    seen.set(file, `data:${mime};base64,${buf.toString('base64')}`);
  }
  return pre + seen.get(file) + post;
});

if (missing) process.exit(1);

writeFileSync(outPath, out);
const total = statSync(outPath).size;
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';

for (const [src, n] of sizes.sort((a, b) => b[1] - a[1])) {
  const flag = n > 600 * 1024 ? '   ← large; convert to JPEG q82' : '';
  console.log(`  ${(n / 1024).toFixed(0).padStart(6)} KB  ${src}${flag}`);
}
console.log(`\n${outPath}: ${mb(total)} (${seen.size} images inlined)`);

if (total > HARD_LIMIT) {
  console.error(`ERROR: ${mb(total)} exceeds the ${mb(HARD_LIMIT)} limit — compress the screenshots`);
  process.exit(1);
}
if (total > SOFT_LIMIT) {
  console.warn(`WARN: ${mb(total)} is heavy for a ship log (~1.6 MB); check for PNG screenshots`);
}
