import { test, expect, configure, openSidebar, pairedSidebar, tokenFor } from './fixtures.mjs';

const bar = (page) => page.locator('[data-worca-pinpoint] .pp-bar');
const pop = (page) => page.locator('[data-worca-pinpoint] .pp-pop');

test('the toolbar appears only while the sidebar is active for the tab', async ({ context, sw, extensionId, worca, site }) => {
  await configure(sw, worca, { token: await tokenFor(worca, extensionId) });
  const page = await context.newPage(); await page.goto(site.url);
  await page.locator('#para').click({ clickCount: 3 });
  await page.waitForTimeout(500);
  await expect(page.locator('[data-worca-pinpoint]')).toHaveCount(0);           // never injected
  const sidebar = await openSidebar(context, sw, extensionId, page);
  await expect(sidebar.locator('textarea.ask-input')).toBeVisible();
  await page.bringToFront();
  await page.locator('#para').click({ clickCount: 3 });                   // a real triple-click selects the paragraph
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('[data-k]')).toHaveCount(4);             // Copy · Explain · Alternatives · Send
  await bar(page).locator('[data-k="explain"]').hover();                  // a real pointer on a toolbar button…
  await page.mouse.down(); await page.mouse.up();                         // …keeps the bar and acts (C1: shadow-resolved target)
  await expect(pop(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await sidebar.close();
  await expect(page.locator('[data-worca-pinpoint]')).toHaveCount(0);           // deactivated with the sidebar
  await page.locator('#para').click({ clickCount: 3 });
  await page.waitForTimeout(500);
  await expect(page.locator('[data-worca-pinpoint]')).toHaveCount(0);
});

test('Explain STREAMS (partial text and Stop before the end), then Go deeper drafts its wording (M6c, M5)', async ({ context, sw, extensionId, worca, site }) => {
  const { page, sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site }, { url: site.openUrl, select: null });
  await page.bringToFront();
  await page.locator('#slow').click({ clickCount: 3 });                   // the quote carries MOCK_SLOW: WORCA_MOCK_SLOW_MS (900 here) per delta
  await bar(page).locator('[data-k="explain"]').click();
  await expect(pop(page)).toContainText('This is a mock');
  const partial = await pop(page).textContent();
  expect(partial).not.toContain('about the selected text.');              // not finished yet…
  await expect(page.locator('[data-worca-pinpoint] .pp-stop')).toBeVisible();     // …and still streaming
  await expect(pop(page)).toContainText('about the selected text.');       // the rest arrives
  await expect(page.locator('[data-worca-pinpoint] .pp-stop')).toHaveCount(0);
  await page.locator('[data-worca-pinpoint] [data-deeper]').click();
  await expect(sidebar.locator('.ask-chip-quote .ask-chip-quote-t')).toContainText('Retry-After header');
  await expect(sidebar.locator('textarea.ask-input')).toHaveValue(/Explain this in more depth/);
});

test('Send to chat puts a quote chip in the composer; Use this also appends its wording to the draft (M5)', async ({ context, sw, extensionId, worca, site }) => {
  const { page, sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site });
  const input = sidebar.locator('textarea.ask-input');
  await input.fill('My question:');
  await page.bringToFront();
  await page.locator('#para').click({ clickCount: 3 });
  await bar(page).locator('[data-k="send"]').click();
  await expect(sidebar.locator('.ask-chip-quote .ask-chip-quote-t')).toContainText('token bucket per API key');
  await expect(sidebar.locator('.ask-chip-quote .ask-chip-quote-k')).toHaveText('From fixture.test');
  await expect(input).toHaveValue('My question:');                        // Send to chat carries no text
  await page.locator('#para').click({ clickCount: 3 });
  await bar(page).locator('[data-k="alts"]').click();
  await expect(pop(page)).toContainText('Narrow it');
  await pop(page).locator('[data-use="0"]').click();
  await expect(input).toHaveValue('My question:\nUse this instead: Narrow it — Do only the part the rest depends on now, and follow up with the rest.');
  await expect(sidebar.locator('.ask-chip-quote .ask-chip-quote-t')).toContainText('token bucket per API key');
});

test('context menu "Ask Worca about selection" quotes into the sidebar', async ({ context, sw, extensionId, worca, site }) => {
  const { page, sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site });
  await sw.evaluate(async (u) => { const [tab] = await chrome.tabs.query({ url: u }); globalThis.__worcaTest.contextMenuClick({ menuItemId: 'worca-ask-selection', selectionText: 'holds at most 100 tokens' }, tab); }, page.url());
  await expect(sidebar.locator('.ask-chip-quote .ask-chip-quote-t')).toHaveText('holds at most 100 tokens');
});
