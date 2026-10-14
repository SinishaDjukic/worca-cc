import { test, expect, configure, openSidebar, startWorca } from './fixtures.mjs';

/** A base URL nothing answers at: start a worca for its free port, then stop it. */
async function deadUrl() {
  const w = await startWorca();
  await w.stop();                                                          // the port is now closed
  return w.url;
}

test('"Worca isn\'t running" when nothing answers', async ({ context, sw, extensionId, site }) => {
  const url = await deadUrl();
  await configure(sw, { url });
  const page = await context.newPage(); await page.goto(site.url);
  const sidebar = await openSidebar(context, sw, extensionId, page);
  await expect(sidebar.locator('.wx-offline')).toContainText("Worca isn't running");
  await expect(sidebar.locator('.wx-offline')).toContainText(url);
});

test('Connection settings stays open with the typed address, focus and caret across offline retries', async ({ context, sw, extensionId, site }) => {
  const url = await deadUrl();
  await configure(sw, { url });
  const page = await context.newPage(); await page.goto(site.url);
  const sidebar = await openSidebar(context, sw, extensionId, page, { retryMs: 300 });
  let probes = 0;
  sidebar.on('requestfailed', (r) => { if (r.url().endsWith('/api/extension/hello')) probes += 1; });
  await expect(sidebar.locator('.wx-offline')).toBeVisible();
  await sidebar.getByText('Connection settings').click();
  const input = sidebar.getByLabel('Worca address');
  await expect(input).toHaveValue(url);
  await input.fill('http://127.0.0.1:5');
  await input.press('ArrowLeft');                                          // the caret one before the end
  const start = probes;
  await expect.poll(() => probes - start, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);   // several retries ran
  await expect(sidebar.locator('details.wx-settings')).toHaveAttribute('open', '');
  await expect(input).toHaveValue('http://127.0.0.1:5');
  await expect(input).toBeFocused();
  expect(await input.evaluate((e) => e.selectionStart)).toBe('http://127.0.0.1:5'.length - 1);
  await expect(sidebar.locator('.wx-offline')).toContainText("Worca isn't running");
});
