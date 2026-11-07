// node plans/rail/mocks/wave-2/render.mjs [mock numbers]: renders each mock to wave-2-<n>-<theme>.png beside this file.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const here = new URL('.', import.meta.url);
const names = { 1: 'one-bar', 2: 'chat-dispatch', 3: 'icon-state', 4: 'settings-search', 5: 'backgrounds', 6: 'conversation', 7: 'composer', 8: 'task-page', 9: 'anchors', 10: 'statuses' };
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(names);
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
for (const n of want) for (const theme of n === '5' ? ['light'] : ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 2300, height: 1700 }, deviceScaleFactor: 2, colorScheme: theme });
  p.on('pageerror', (e) => console.error(n, e.message));
  await p.goto(`${here}mock.html?m=${n}&theme=${theme}`);
  const box = await p.locator('#m').boundingBox();
  await p.screenshot({ path: fileURLToPath(new URL(`${n}-${names[n]}-${theme}.png`, here)), clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) } });
  await p.close();
}
await b.close();
