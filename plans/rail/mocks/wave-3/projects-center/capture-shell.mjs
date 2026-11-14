// node plans/rail/mocks/wave-3/projects-center/capture-shell.mjs: captures the Projects bar and top bar from the prototype (read only), Advanced and Simple, into projects-shell.js.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(new URL('../render.mjs', import.meta.url))('playwright-core');
const index = new URL('../../../prototype/index.html', import.meta.url).href;
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const out = {}; let facts;
for (const mode of ['advanced', 'simple']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await ctx.addInitScript((m) => { try { localStorage.setItem('worca-rail.mode', m); } catch {} }, mode);
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.error(mode, e.message));
  await p.goto(`${index}#projects`); await p.waitForTimeout(1200);
  out[mode] = await p.evaluate(() => ({ side: document.querySelector('#side-rail').outerHTML, top: document.querySelector('.main-col > :first-child').outerHTML }));
  if (mode === 'advanced') {
    facts = await p.evaluate(() => { const RM = window.RunCardModel; return { projects: window.RailProjects.list().map((x) => [x.id, x.origin]), chats: window.RailChats.data().chats.flatMap((c) => (c.tasks || []).filter((t) => t.kind !== 'schedule').map((t) => [c.project, t.title, RM.stateOf(t.case), window.RailUI.markTone(window.RailUI.runState(RM.stateOf(t.case))), t.detail])), needs: window.RailWorld.tops().filter((x) => !x.archived && x.section === 'needs').map((x) => [x.project, x.title, x.case]), spaces: window.RailSpaces.list().map((w) => [w.id, w.projects.length, w.links.filter((l) => l.state === 'auto' && ['heuristic', 'inferred'].includes(l.sure)).map((l) => `${l.from} ${l.how} ${l.to} ${l.at||''}`)]) }; });
  }
  if (mode === 'advanced') {   // the calm state: what waited is answered, every copy in step, Worca sure of every link
    await p.evaluate(() => { const R = window.RailUI, M = window.RunCardModel; for (const c of window.RailChats.data().chats) for (const t of c.tasks || []) if (t.kind !== 'schedule' && (['fail', 'ask', 'act', 'ok'].includes(R.markTone(R.runState(M.stateOf(t.case)))))) { window.RailWorld.move(t.run, 'merged', 'Merged', { title: t.title }); t.case = 'merged'; }
      window.RailProjects.list().forEach((x) => { if (x.origin !== 'folder') x.origin = 'ok'; }); window.RailSpaces.list().forEach((w) => w.links.forEach((l) => { l.state = 'confirmed'; })); window.RailPlaces.projects.redraw(); });
    await p.waitForTimeout(500);
    out.calm = await p.evaluate(() => ({ side: document.querySelector('#side-rail').outerHTML, top: document.querySelector('.main-col > :first-child').outerHTML }));
  }
  await ctx.close();
}
{ // the bar set to by project, in step with the page's sentence
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('worca-rail.mode', 'advanced'); } catch {} });
  const p = await ctx.newPage(); await p.goto(`${index}#projects`); await p.waitForTimeout(1200);
  await p.locator('#side-rail .bar-list:not([hidden]) .list-sentence button', { hasText: 'workspace' }).first().click(); await p.waitForTimeout(200);
  await p.locator('[data-pick="by|name"]').first().click(); await p.waitForTimeout(500);
  out.byproject = await p.evaluate(() => ({ side: document.querySelector('#side-rail').outerHTML, top: document.querySelector('.main-col > :first-child').outerHTML }));
  await ctx.close();
}
await b.close();
fs.writeFileSync(new URL('projects-shell.js', import.meta.url), `// Captured once from the prototype (Advanced, Simple): the Projects bar and top bar as they are.\nwindow.PROJECTS_SHELL = ${JSON.stringify(out)};\n`);
console.log(JSON.stringify(facts, null, 0));
