import { test, expect, configure, openSidebar, startWorca } from './fixtures.mjs';

test('"Worca isn\'t running" when nothing answers', async ({ context, sw, extensionId, site }) => {
  const w = await startWorca();
  const url = w.url;
  await w.stop();                                                          // the port is now closed
  await configure(sw, { url });
  const page = await context.newPage(); await page.goto(site.url);
  const sidebar = await openSidebar(context, sw, extensionId, page);
  await expect(sidebar.locator('.wx-offline')).toContainText("Worca isn't running");
  await expect(sidebar.locator('.wx-offline')).toContainText(url);
});
