// node plans/rail/mocks/wave-3/cockpit/capture.mjs [only]: real prototype before; prototype + cockpit.css + cockpit-dom.js after; 1440 wide, light and dark.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const here = new URL('.', import.meta.url);
const index = new URL('../../../prototype/index.html', import.meta.url).href;
const css = fs.readFileSync(new URL('cockpit.css', here), 'utf8'), dom = fs.readFileSync(new URL('cockpit-dom.js', here), 'utf8');
const SCENES = [['chat', 'chat/c1'], ['task-failing', 'chat/c17'], ['tasks', 'runs'], ['schedules', 'schedules']];
const CALM = [['calm-chat', 'chat/c5'], ['calm-tasks', 'runs'], ['calm-schedules', 'schedules']];
const only = process.argv[2];
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('worca-rail.mode', 'advanced'); } catch {} });
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.error(theme, e.message));
  const go = async (route) => { await p.goto('about:blank'); await p.goto(`${index}#${route}`); await p.waitForTimeout(800); await p.addStyleTag({ content: '.mk-tools{display:none!important}' }); };
  const shot = (name) => p.screenshot({ path: fileURLToPath(new URL(`${name}-${theme}.png`, here)) });
  for (const [name, route] of SCENES) {
    if (only && !name.includes(only)) continue;
    await go(route); await shot(`${name}-before`);
    await p.addStyleTag({ content: css }); await p.evaluate(dom); await p.evaluate(() => window.cockpit(false)); await p.waitForTimeout(200); await shot(`${name}-after`);
  }
  for (const [name, route] of CALM) {
    if (only && !name.includes(only)) continue;
    await go(route);
    await p.addStyleTag({ content: css }); await p.evaluate(dom); await p.evaluate(() => window.cockpit(true)); await p.waitForTimeout(200); await shot(`${name}-after`);
  }
  await ctx.close();
}
const lc = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: "dark" }); const lp = await lc.newPage(); lp.on("pageerror", (e) => console.error(e.message)); await lp.goto(new URL("ladder.html", here).href); await lp.waitForTimeout(300); const lb = await lp.locator("#m").boundingBox(); await lp.setViewportSize({ width: 1440, height: Math.ceil(lb.height) }); await lp.screenshot({ path: fileURLToPath(new URL("ladder.png", here)) });
await b.close();
