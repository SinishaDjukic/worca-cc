// No theme selector: the sidebar and the Pinpoint layer follow the browser's colour scheme, whatever an older build
// stored in worca.theme (which the sidebar clears at startup).
import { test, expect, configure, openSidebar, tokenFor } from './fixtures.mjs';

/** The element's background next to --panel resolved under a forced light and dark scheme. */
const panelColours = (sel) => {
  const probe = (scheme) => { const p = document.createElement('i'); p.style.colorScheme = scheme; p.style.backgroundColor = 'var(--panel)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
  return { got: getComputedStyle(document.querySelector(sel)).backgroundColor, light: probe('light'), dark: probe('dark') };
};

test('a stale worca.theme has no effect: the sidebar follows an emulated colour scheme, and no theme select exists', async ({ context, sw, extensionId, worca, site }) => {
  await configure(sw, worca);
  await sw.evaluate(() => chrome.storage.local.set({ 'worca.theme': 'dark' }));
  const page = await context.newPage(); await page.emulateMedia({ colorScheme: 'light' }); await page.goto(site.url);
  const sidebar = await openSidebar(context, sw, extensionId, page);
  await sidebar.emulateMedia({ colorScheme: 'light' });
  await expect(sidebar.locator('.wx-unpaired')).toBeVisible();
  await sidebar.getByText('Connection settings').click();
  await expect(sidebar.locator('.wx-settings select')).toHaveCount(0);
  await expect(sidebar.getByRole('combobox', { name: 'Theme' })).toHaveCount(0);
  await expect(sidebar.locator('html')).toHaveAttribute('data-theme', 'system');
  await expect.poll(() => sw.evaluate(async () => (await chrome.storage.local.get('worca.theme'))['worca.theme'] ?? null)).toBeNull();
  let c = await sidebar.evaluate(panelColours, 'body');
  expect(c.light).not.toBe(c.dark);
  expect(c.got).toBe(c.light);
  await sidebar.emulateMedia({ colorScheme: 'dark' });
  c = await sidebar.evaluate(panelColours, 'body');
  expect(c.got).toBe(c.dark);
});

test('the Pinpoint layer carries no data-theme and follows the page\'s emulated colour scheme', async ({ context, sw, extensionId, worca, site }) => {
  await configure(sw, worca, { token: await tokenFor(worca, extensionId) });
  await sw.evaluate(() => chrome.storage.local.set({ 'worca.theme': 'light' }));
  const page = await context.newPage(); await page.emulateMedia({ colorScheme: 'dark' }); await page.goto(site.url);
  const sidebar = await openSidebar(context, sw, extensionId, page);
  await expect(sidebar.locator('textarea.ask-input')).toBeVisible();
  await page.bringToFront(); await page.locator('#para').click({ clickCount: 3 });
  await expect(page.locator('[data-worca-pinpoint] .pp-bar')).toBeVisible();
  await expect(page.locator('[data-worca-pinpoint]')).not.toHaveAttribute('data-theme', /.*/);
  const scheme = () => page.evaluate(() => {
    const root = document.querySelector('[data-worca-pinpoint]').shadowRoot;   // open in the test build only (D13)
    const at = (s) => { const p = document.createElement('i'); if (s) p.style.colorScheme = s; p.style.backgroundColor = 'var(--panel)'; root.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
    return { got: at(null), light: at('light'), dark: at('dark') };
  });
  let c = await scheme();
  expect(c.light).not.toBe(c.dark);
  expect(c.got).toBe(c.dark);
  await page.emulateMedia({ colorScheme: 'light' });
  c = await scheme();
  expect(c.got).toBe(c.light);
});
