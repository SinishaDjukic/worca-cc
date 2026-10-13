#!/usr/bin/env node
// tools/build-extension.mjs — build the Worca browser extension (docs/browser-extension.md).
//   node tools/build-extension.mjs                       # chrome, edge, firefox → extension/dist/<browser>/
//   node tools/build-extension.mjs --browser firefox
//   node tools/build-extension.mjs --zip                 # + extension/dist/worca-<browser>-<version>.zip
//   node tools/build-extension.mjs --test --browser chrome   # → extension/dist/chrome-test/ (E2E only: fixture host, open shadow root)
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildManifest, manifestVersion } from '../extension/src/manifest.mjs';
import { sidebarCss, shadowCss } from './extension-css.mjs';
import { zipDirectory } from './zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension/src');
const DIST = join(ROOT, 'extension/dist');
const BROWSERS = ['chrome', 'edge', 'firefox'];
export const ICON_SIZES = [16, 32, 48, 128];
const FONTS = ['poppins-latin-300-normal', 'poppins-latin-400-normal', 'poppins-latin-500-normal', 'poppins-latin-600-normal', 'poppins-latin-700-normal', 'jetbrains-mono-latin-400-normal'];

export function parseArgs(argv) {
  const o = { browsers: BROWSERS, zip: false, test: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--zip') o.zip = true;
    else if (a === '--test') o.test = true;
    else if (a === '--browser') { const b = argv[++i]; if (!BROWSERS.includes(b) && b !== 'all') { console.error(`unknown browser: ${b}`); process.exit(2); } o.browsers = b === 'all' ? BROWSERS : [b]; }
    else if (a === '--help') { console.log('usage: build-extension.mjs [--browser chrome|edge|firefox|all] [--zip] [--test]'); process.exit(0); }
    else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  return o;
}

export async function buildOne(browser, { test = false, dist = DIST } = {}) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const { version, versionName } = manifestVersion(pkg.version);
  const out = join(dist, test ? `${browser}-test` : browser);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'fonts'), { recursive: true });
  mkdirSync(join(out, 'icons'), { recursive: true });
  const style = readFileSync(join(ROOT, 'ui/public/style.css'), 'utf8');
  const shadow = shadowCss(style, readFileSync(join(SRC, 'content/shadow.css'), 'utf8'));
  const define = { __WORCA_EXT_TEST__: JSON.stringify(test), __WORCA_EXT_BROWSER__: JSON.stringify(browser) };
  const shadowPlugin = { name: 'worca-shadow-css', setup(b) {
    b.onResolve({ filter: /^worca:shadow-css$/ }, () => ({ path: 'shadow-css', namespace: 'worca' }));
    b.onLoad({ filter: /.*/, namespace: 'worca' }, () => ({ contents: `export default ${JSON.stringify(shadow)};`, loader: 'js' }));
  } };
  // Two things together drop the E2E hooks from production bundles (proven with esbuild 0.25.12):
  //  1. minifySyntax: without it esbuild does not fold `if (false) {…}`.
  //  2. TEST_BUILD declared in extension/src/build-flags.mjs, a module with ONLY constant exports. Otherwise esbuild
  //     keeps `var TEST_BUILD = !1` and `TEST_BUILD && (…)`, and the check below throws.
  // test/extension-build.test.mjs runs this production build in `npm test`. Whitespace and identifiers stay readable for store review.
  // legalComments 'eof' keeps the licence headers of the bundled marked (MIT) and DOMPurify (Apache-2.0/MPL-2.0).
  const common = { bundle: true, minifySyntax: true, minifyWhitespace: false, minifyIdentifiers: false, sourcemap: false, target: ['chrome116', 'firefox140'], define, legalComments: 'eof', logLevel: 'warning' };
  await build({ ...common, entryPoints: [join(SRC, 'background.mjs')], format: 'iife', outfile: join(out, 'background.js') });
  await build({ ...common, entryPoints: [join(SRC, 'content/content.mjs')], format: 'iife', outfile: join(out, 'content.js'), plugins: [shadowPlugin] });
  await build({ ...common, entryPoints: [join(SRC, 'sidebar/sidebar.mjs')], format: 'esm', outfile: join(out, 'sidebar.js') });
  writeFileSync(join(out, 'sidebar.css'), sidebarCss(style, readFileSync(join(SRC, 'sidebar/sidebar.css'), 'utf8')));
  cpSync(join(SRC, 'sidebar/sidebar.html'), join(out, 'sidebar.html'));
  for (const f of FONTS) cpSync(join(ROOT, 'ui/public/fonts', `${f}.woff2`), join(out, 'fonts', `${f}.woff2`));
  // Committed, correctly sized icons: extension/icons/worca-<n>.png, cut once from ui/public/assets/worca-favicon.png with sips.
  for (const s of ICON_SIZES) cpSync(join(ROOT, 'extension/icons', `worca-${s}.png`), join(out, 'icons', `worca-${s}.png`));
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(buildManifest(browser, { version, versionName, test }), null, 2)}\n`);
  // A production bundle never carries the E2E hooks (TEST_BUILD is a define; minifySyntax folds it and drops the branches).
  if (!test) for (const f of ['background.js', 'content.js', 'sidebar.js']) {
    const js = readFileSync(join(out, f), 'utf8');
    if (/__worcaTest|__worcaSidebarTest/.test(js)) throw new Error(`${browser}/${f}: a test hook leaked into the production build`);
  }
  return { out, version: versionName };
}

/** PNG width/height from the IHDR chunk (bytes 16–23). */
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// realpath, as import.meta.url is: a symlinked checkout or tools dir must still run the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const o = parseArgs(process.argv.slice(2));
  for (const b of o.browsers) {
    const { out, version } = await buildOne(b, { test: o.test });
    console.log(`built ${b}${o.test ? ' (test)' : ''} → ${out}`);
    if (o.zip && !o.test) { const z = join(DIST, `worca-${b}-${version}.zip`); const r = zipDirectory(out, z); console.log(`  zip → ${z} (${r.files} files, ${r.bytes} bytes)`); }
  }
}
