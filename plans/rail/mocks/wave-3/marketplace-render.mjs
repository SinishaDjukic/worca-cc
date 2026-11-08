// node plans/rail/mocks/wave-3/marketplace-render.mjs: renders marketplace.html in light and dark to marketplace-light.png / -dark.png.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const here = new URL('.', import.meta.url);
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const theme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 760, height: 2400 }, deviceScaleFactor: 2, colorScheme: theme });
  p.on('pageerror', (e) => console.error(e.message));
  await p.goto(`${here}marketplace.html`); await p.waitForTimeout(300);
  const box = await p.locator('#m').boundingBox();
  await p.screenshot({ path: fileURLToPath(new URL(`marketplace-${theme}.png`, here)), clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) } });
  await p.close();
}
await b.close();
