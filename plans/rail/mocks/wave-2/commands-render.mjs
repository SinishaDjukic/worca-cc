// node plans/rail/mocks/wave-2/commands-render.mjs: renders commands.html in light and dark to commands-light.png / commands-dark.png.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const here = new URL('.', import.meta.url);
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const theme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 1520, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
  p.on('pageerror', (e) => console.error(e.message));
  await p.goto(`${here}commands.html`); await p.waitForTimeout(300);
  const box = await p.locator('#m').boundingBox();
  await p.screenshot({ path: fileURLToPath(new URL(`commands-${theme}.png`, here)), clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) } });
  await p.close();
}
await b.close();
