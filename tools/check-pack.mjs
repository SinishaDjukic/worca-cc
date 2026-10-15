#!/usr/bin/env node
// tools/check-pack.mjs — the @worca/app tarball rule for the browser extension (docs/RELEASING.md §4.4):
// the three production builds extension/dist/{chrome,edge,firefox}/ and nothing else from extension/ or e2e/
// (no source, no *-test build, no zip).
//   npm pack --dry-run --json --ignore-scripts | node tools/check-pack.mjs --require-extension
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PACKED_BROWSERS = Object.freeze(['chrome', 'edge', 'firefox']);
const BUILT = /^extension\/dist\/(chrome|edge|firefox)\//;

/** Problems with a packed file list (paths relative to the package root, `/`-separated); [] when it is right. */
export function checkPackFiles(paths, { requireExtension = false } = {}) {
  const problems = [];
  for (const p of paths) {
    if (p.startsWith('extension/') && !BUILT.test(p)) problems.push(`not a packaged build: ${p}`);
    else if (p.startsWith('e2e/')) problems.push(`E2E suite in the package: ${p}`);
    else if (/\.zip$/i.test(p)) problems.push(`zip in the package: ${p}`);
  }
  if (requireExtension) {
    for (const b of PACKED_BROWSERS) {
      if (!paths.includes(`extension/dist/${b}/manifest.json`)) problems.push(`missing extension/dist/${b}/manifest.json (run npm run ext:build)`);
    }
  }
  return problems;
}

/** The file paths from `npm pack --dry-run --json` output. */
export function packJsonPaths(text) {
  const parsed = JSON.parse(text);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return (entry?.files || []).map((f) => f.path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const problems = checkPackFiles(packJsonPaths(readFileSync(0, 'utf8')), { requireExtension: process.argv.includes('--require-extension') });
  for (const p of problems) console.error(`check-pack: ${p}`);
  if (problems.length) process.exit(1);
  console.log('check-pack: the package carries extension/dist/{chrome,edge,firefox}/ and no other extension files');
}
