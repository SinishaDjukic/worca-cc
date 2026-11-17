// Run (with Worca running in mock mode, some runs started): node plans/rail/prototype/gates/capture-today.mjs [url]
// Captures today's Worca for the one prototype: the shell (sidebar, top bar) once, and each page outside Wave 1's
// scope as it renders, with the classes its <html> and <body> carry on that page. Scripts, inline handlers and the
// MOCK mark are dropped; the app's own asset paths are pointed at ui/public. Writes plans/rail/prototype/today/.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const URL_ = process.argv[2] || 'http://localhost:4347';
const OUT = fileURLToPath(new URL('../today/', import.meta.url)); mkdirSync(OUT, { recursive: true });
export const VIEWS = ['chat', 'runs', 'schedules', 'stats', 'team-metrics', 'workflows', 'requirements', 'projects', 'workspaces', 'marketplace'];
const clean = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/\s(on[a-z]+)="[^"]*"/g, '')
  .replace(/\s(src|href)="(?!https?:|data:|#|\/\/)\/?([^"]+)"/g, (m, k, v) => ` ${k}="../../../ui/public/${v}"`);
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const pages = {};
for (const v of VIEWS) {
  await p.goto(`${URL_}/#${v}`); await p.waitForTimeout(1800);
  const got = await p.evaluate((v) => {
    const s = document.querySelector(`section.view[data-view="${v}"]`);
    return { html: s ? s.outerHTML : '', root: document.documentElement.className, body: document.body.className, main: document.querySelector('main.main')?.className || 'main', row: document.querySelector('#main-row')?.className || 'main-row' };
  }, v);
  writeFileSync(`${OUT}${v}.html`, clean(got.html));
  pages[v] = { root: got.root, body: got.body, main: got.main, row: got.row };
  if (v === 'runs') {
    const shell = await p.evaluate(() => { const a = document.querySelector('#side-rail').cloneNode(true), t = document.querySelector('#topnav').cloneNode(true); a.querySelectorAll('[class*="mock"]').forEach((x) => x.remove()); t.querySelectorAll('[class*="mock"]').forEach((x) => x.remove()); return { side: a.outerHTML, top: t.outerHTML }; });
    writeFileSync(`${OUT}shell-sidebar.html`, clean(shell.side)); writeFileSync(`${OUT}shell-top-bar.html`, clean(shell.top));
  }
}
writeFileSync(`${OUT}pages.json`, JSON.stringify(pages, null, 2) + '\n');
console.log(`captured the shell and ${VIEWS.length} pages into today/`); await b.close();
