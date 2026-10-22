#!/usr/bin/env node
// Set up a promo film directory: copy the kit's film runtime, GSAP (from the `gsap` npm package) and the
// fonts (from the app's ui/public/fonts) into <filmDir>, each only if missing — so a re-run keeps a
// re-skinned mascot.js and every scene file. Run it from worca's own checkout/install (a script card),
// never from a staged copy of the kit: GSAP and the fonts are resolved next to THIS file.
//   node assets/promo-kit/tools/init-film.mjs <filmDir>
import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_FILM = fileURLToPath(new URL('../film/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));   // assets/promo-kit/tools → repo root

/** The kit's film runtime files (copied verbatim). */
export const FILM_FILES = ['index.html', 'kit.js', 'film.css', 'main.js', 'mascot.js', 'mascot.css', 'mascot-demo.html'];
/** The fonts film.css declares (Poppins 300–700, JetBrains Mono 400). */
export const FONT_FILES = ['poppins-latin-300-normal.woff2', 'poppins-latin-400-normal.woff2', 'poppins-latin-500-normal.woff2',
  'poppins-latin-600-normal.woff2', 'poppins-latin-700-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2'];

/** Absolute path of gsap's dist/gsap.min.js, resolved from this file's location. */
export function gsapPath() {
  const require = createRequire(import.meta.url);
  let pkg;
  try { pkg = require.resolve('gsap/package.json'); } catch {
    throw new Error('initFilm: the gsap package is not installed next to worca (npm install gsap)');
  }
  const file = join(dirname(pkg), 'dist', 'gsap.min.js');
  if (!existsSync(file)) throw new Error(`initFilm: ${file} is missing`);
  return file;
}

/**
 * Copy-if-missing the film runtime into `filmDir`. Idempotent.
 * @param {{filmDir: string}} o
 * @returns {{copied: string[]}} the files written, relative to filmDir with forward slashes
 */
export function initFilm({ filmDir } = {}) {
  if (!filmDir) throw new Error('initFilm: filmDir is required');
  const dir = resolve(filmDir);
  const fontsDir = join(REPO_ROOT, 'ui', 'public', 'fonts');
  const plan = [
    ...FILM_FILES.map((f) => [join(KIT_FILM, f), f]),
    [gsapPath(), 'vendor/gsap.min.js'],
    ...FONT_FILES.map((f) => [join(fontsDir, f), `fonts/${f}`]),
  ];
  for (const [src] of plan) if (!existsSync(src)) throw new Error(`initFilm: kit file missing: ${src}`);
  const copied = [];
  for (const [src, rel] of plan) {
    const dst = join(dir, ...rel.split('/'));
    if (existsSync(dst)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    copied.push(rel);
  }
  mkdirSync(join(dir, 'scenes'), { recursive: true });
  return { copied };
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const filmDir = process.argv[2];
  if (!filmDir) { console.error('usage: node init-film.mjs <filmDir>'); process.exit(1); }
  try {
    const { copied } = initFilm({ filmDir });
    console.log(copied.length ? `copied ${copied.length} files → ${filmDir}: ${copied.join(', ')}` : `${filmDir} already set up`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
