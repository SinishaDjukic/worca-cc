// The prototype as one file, generated from the branch and never edited by hand: plans/rail/prototype/index.html with its
// stylesheets, scripts, fonts and images inside, so it can be opened anywhere.
//   node tools/rail-prototype-page.mjs [out.html]     default: plans/rail/generated/worca-rail-prototype.html (not committed)
// It only writes the file. Publishing it is a separate step, with a person's yes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { railStamp } from '../plans/rail/prototype/gates/components-js.mjs';
import { buildStillhet } from './stillhet-build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'plans/rail/prototype');
const APP_PUBLIC = '../../../' + 'ui' + '/public/';   // where the generated app.css's relative urls land, from plans/rail/prototype/
const STILLHET = join(ROOT, 'ui/public/stillhet');
const bootList = (() => { const sb = { module: { exports: {} } }; vm.runInNewContext(readFileSync(join(STILLHET, 'boot.js'), 'utf8'), sb); return sb.module.exports.list('prototype'); })();   // the one load order, shared with the page
const MIME = { woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif' };
const asData = (file) => { const type = MIME[file.split('.').pop().toLowerCase()]; return type && existsSync(file) ? `data:${type};base64,${readFileSync(file).toString('base64')}` : ''; };
// What the page loads by its path goes in as data; what is missing loads nothing.
const inlineAssets = (text) => text.replace(/\.\.\/\.\.\/\.\.\/ui\/public\/[^"')\\\s]+/g, (m) => asData(resolve(DIR, m.split(/[?#]/)[0])) || 'data:,');

/** The whole page. */
export function buildPrototypePage() {
  const page = join(DIR, 'index.html');
  let html = readFileSync(page, 'utf8');
  // boot.js adds the stylesheets and scripts at run time; the one file carries them in the same order instead
  const fromStillhet = (f) => inlineAssets(readFileSync(join(STILLHET, f), 'utf8').replace(/url\((['"]?)\.\.\//g, `url($1${APP_PUBLIC}`));
  const styles = bootList.styles.map((f) => `<style>${fromStillhet(f)}</style>`).join('\n');
  const scripts = bootList.scripts.map((f) => `<script>${fromStillhet(f).replace(/<\/script/g, '<\\/script')}</script>`).join('\n');
  html = html.replace('</head>', `${styles}\n</head>`).replace(/<script src="[^"]*boot\.js"[^>]*><\/script>/, () => scripts);
  // Agreed and Shaping publish as two pages: the name says which
  if (railStamp().branch === 'docs/rail-shaping') html = html.replace('<title>Worca Rail · Prototype</title>', '<title>Worca Rail · Shaping</title>');
  return inlineAssets(html);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildStillhet();
  const out = process.argv[2] || join(ROOT, 'plans/rail/generated/worca-rail-prototype.html');
  const html = buildPrototypePage();
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, html);
  console.log(`${out} · ${(html.length / 1048576).toFixed(1)} MB`);
}
