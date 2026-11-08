// node plans/rail/mocks/wave-3/render.mjs <name> [width]: renders <name>.html in light and dark to <name>-light.png / -dark.png.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const here = new URL('.', import.meta.url);
const [name, width = '760'] = process.argv.slice(2);
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const theme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: +width, height: 3000 }, deviceScaleFactor: 2, colorScheme: theme });
  p.on('pageerror', (e) => console.error(e.message));
  await p.goto(`${here}${name}.html`); await p.waitForTimeout(400);
  const box = await p.locator('#m').boundingBox();
  await p.screenshot({ path: fileURLToPath(new URL(`${name}-${theme}.png`, here)), clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) } });
  await p.close();
}
await b.close();
console.log(`${name}: light and dark`);
