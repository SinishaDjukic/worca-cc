// The prototype as one file, generated from the branch and never edited by hand: plans/rail/prototype/index.html with its
// stylesheets, scripts, fonts and images inside, so it can be opened anywhere.
//   node tools/rail-prototype-page.mjs [out.html]     default: plans/rail/generated/worca-rail-prototype.html (not committed)
// It only writes the file. Publishing it is a separate step, with a person's yes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAppCss } from '../plans/rail/prototype/gates/app-css.mjs';
import { writeComponentsJs } from '../plans/rail/prototype/gates/components-js.mjs';
import { writeTodayJs } from '../plans/rail/prototype/gates/today-js.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'plans/rail/prototype');
const MIME = { woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif' };
const asData = (file) => { const type = MIME[file.split('.').pop().toLowerCase()]; return type && existsSync(file) ? `data:${type};base64,${readFileSync(file).toString('base64')}` : ''; };
// What the page loads by its path goes in as data; what is missing loads nothing.
const inlineAssets = (text) => text.replace(/\.\.\/\.\.\/\.\.\/ui\/public\/[^"')\\\s]+/g, (m) => asData(resolve(DIR, m.split(/[?#]/)[0])) || 'data:,');

/** The whole page. */
export function buildPrototypePage() {
  let html = readFileSync(join(DIR, 'index.html'), 'utf8');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => `<style>${inlineAssets(readFileSync(join(DIR, f), 'utf8'))}</style>`);
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>${inlineAssets(readFileSync(join(DIR, f), 'utf8')).replace(/<\/script/g, '<\\/script')}</script>`);
  return inlineAssets(html);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeAppCss(); writeComponentsJs(); writeTodayJs();
  const out = process.argv[2] || join(ROOT, 'plans/rail/generated/worca-rail-prototype.html');
  const html = buildPrototypePage();
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, html);
  console.log(`${out} · ${(html.length / 1048576).toFixed(1)} MB`);
}
