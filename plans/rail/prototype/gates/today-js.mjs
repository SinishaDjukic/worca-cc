// Run: node plans/rail/prototype/gates/today-js.mjs
// Writes the prototype's today.js: today's Worca as captured in today/ (gates/capture-today.mjs), as one script a
// file:// page can load: window.Today = { sidebar, topBar, pages: { view: { html, body, main, row } } }. Generated and
// not committed; the gates write it before they run.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
export const TODAY_JS = here('../today.js');
export function writeTodayJs() {
  const dir = here('../today/'), meta = JSON.parse(readFileSync(dir + 'pages.json', 'utf8'));
  const pages = Object.fromEntries(Object.entries(meta).map(([v, m]) => [v, { ...m, html: readFileSync(`${dir}${v}.html`, 'utf8') }]));
  const today = { sidebar: readFileSync(dir + 'shell-sidebar.html', 'utf8'), topBar: readFileSync(dir + 'shell-top-bar.html', 'utf8'), pages };
  writeFileSync(TODAY_JS, `window.Today = ${JSON.stringify(today)};\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) writeTodayJs();
