// Run (with Worca running in mock mode, some runs started): node plans/rail/prototype/gates/capture-today.mjs [url]
// Or, with no run started: node plans/rail/prototype/gates/capture-today.mjs --serve --only requirements,workspaces
//   --serve  boots Worca in this process on a throwaway home, in mock mode, with every Labs flag on and one project.
//            Pages that need runs (Runs, Chat) are not refreshed this way: they would lose their rows.
//   --only   the pages to capture; the shell and the others keep what they have.
// Captures today's Worca for the one prototype: the shell (sidebar, top bar) once, and each page outside Wave 1's
// scope as it renders, with the classes its <html> and <body> carry on that page. Scripts, inline handlers and the
// MOCK mark are dropped; the app's own asset paths are pointed at ui/public. Writes plans/rail/prototype/today/.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ARGS = process.argv.slice(2);
const SERVE = ARGS.includes('--serve');
const ONLY = ARGS.includes('--only') ? ARGS[ARGS.indexOf('--only') + 1].split(',') : null;
let URL_ = ARGS.find((a) => /^https?:/.test(a)) || 'http://localhost:4347';
let srv = null;
if (SERVE) {
  const home = mkdtempSync(join(tmpdir(), 'worca-capture-'));
  const realHome = process.env.HOME;
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: join(home, '.worca-cc'), WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_MOCK: '1' });
  const proj = join(home, 'worca-cc'); mkdirSync(proj);
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'capture@worca.local'], ['config', 'user.name', 'capture'], ['commit', '-q', '--allow-empty', '-m', 'init']]) execFileSync('git', a, { cwd: proj });
  const { server } = await import(new URL('../../../../ui/server.mjs', import.meta.url).href);
  srv = server; await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  URL_ = `http://127.0.0.1:${srv.address().port}`;
  const post = (path, body) => fetch(URL_ + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await post('/api/settings', { uiLevel: 'expert', theme: 'light' }); await post('/api/onboarding', { welcomeSeen: true, hidden: true });
  await post('/api/projects', { name: 'worca-cc', path: proj });
  const { FLAGS } = await import(new URL('../../../../src/shared/flags/registry.mjs', import.meta.url).href);
  for (const f of FLAGS) await fetch(URL_ + '/api/flags', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [f.key]: true }) }).catch(() => {});
  process.env.HOME = realHome;   // Chrome keeps its own home
}
const OUT = fileURLToPath(new URL('../today/', import.meta.url)); mkdirSync(OUT, { recursive: true });
export const VIEWS = ['chat', 'runs', 'schedules', 'stats', 'team-metrics', 'workflows', 'requirements', 'projects', 'workspaces', 'marketplace'];
const clean = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/\s(on[a-z]+)="[^"]*"/g, '')
  .replace(/\s(src|href)="(?!https?:|data:|#|\/\/)\/?([^"]+)"/g, (m, k, v) => ` ${k}="../../../ui/public/${v}"`);
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const pages = ONLY ? JSON.parse(readFileSync(`${OUT}pages.json`, 'utf8')) : {};
for (const v of ONLY || VIEWS) {
  await p.goto(`${URL_}/#${v}`); await p.waitForTimeout(1800);
  const got = await p.evaluate((v) => {
    const s = document.querySelector(`section.view[data-view="${v}"]`);
    return { html: s ? s.outerHTML : '', root: document.documentElement.className, body: document.body.className, main: document.querySelector('main.main')?.className || 'main', row: document.querySelector('#main-row')?.className || 'main-row' };
  }, v);
  writeFileSync(`${OUT}${v}.html`, clean(got.html));
  pages[v] = { root: got.root, body: got.body, main: got.main, row: got.row };
  if (v === 'runs' && !ONLY) {
    const shell = await p.evaluate(() => { const a = document.querySelector('#side-rail').cloneNode(true), t = document.querySelector('#topnav').cloneNode(true); a.querySelectorAll('[class*="mock"]').forEach((x) => x.remove()); t.querySelectorAll('[class*="mock"]').forEach((x) => x.remove()); return { side: a.outerHTML, top: t.outerHTML }; });
    writeFileSync(`${OUT}shell-sidebar.html`, clean(shell.side)); writeFileSync(`${OUT}shell-top-bar.html`, clean(shell.top));
  }
}
writeFileSync(`${OUT}pages.json`, JSON.stringify(pages, null, 2) + '\n');
console.log(`captured ${ONLY ? ONLY.join(', ') : `the shell and ${VIEWS.length} pages`} into today/`); await b.close();
if (srv) { srv.close(); process.exit(0); }
