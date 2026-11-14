#!/usr/bin/env node
// tools/stillhet-build.mjs — builds the generated files of ui/public/stillhet/ (gitignored there): components.js and
// graph.js (the Rail components and the graph renderer bundled as classic scripts), app.css (dev's /style.css for file://).
// In a source checkout it builds; in an installed package esbuild is absent, so it only checks the files exist.
import { fileURLToPath } from 'node:url';
import { STILLHET_BUNDLES, missingStillhetBundles } from '../src/core/stillhet-shell.mjs';

const PUBLIC = fileURLToPath(new URL('../ui/public/', import.meta.url));
const OUT = PUBLIC + 'stillhet/';
export { STILLHET_BUNDLES };

/** The generated files that are missing from `outDir`. */
export const missingBundles = (outDir = OUT) => missingStillhetBundles(outDir.replace(/stillhet\/?$/, ''));

/**
 * Writes the bundles. Returns the written file names.
 * @throws {Error} 'stillhet build: esbuild is missing' when esbuild is not installed
 */
export async function buildStillhet({ outDir = OUT } = {}) {
  const gates = new URL('../plans/rail/prototype/gates/', import.meta.url);
  try { await import('esbuild'); } catch { throw new Error('stillhet build: esbuild is missing (a source checkout builds; an installed package ships the files)'); }
  (await import(new URL('app-css.mjs', gates))).writeAppCss();
  (await import(new URL('components-js.mjs', gates))).writeComponentsJs();
  const still = missingBundles(outDir);
  if (still.length) throw new Error(`stillhet build: ${still.join(', ')} not written`);
  return [...STILLHET_BUNDLES];
}

/**
 * Makes the bundles exist: builds when a source checkout can, else names the first missing file once.
 * @throws {Error} naming the missing file when the files are absent and cannot be built
 */
export async function ensureStillhet({ outDir = OUT } = {}) {
  if (!missingBundles(outDir).length) return;
  try { await buildStillhet({ outDir }); }
  catch (err) { throw new Error(`ui/public/stillhet/${missingBundles(outDir)[0]} is missing: ${err.message}`); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStillhet().then((f) => console.log('stillhet: wrote ' + f.join(', '))).catch((e) => { console.error(e.message); process.exit(1); });
}
