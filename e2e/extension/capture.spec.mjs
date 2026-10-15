// Area capture into the chat: the worca-capture command (or the composer's camera) → the Shadow-DOM overlay → a drag →
// captureVisibleTab + crop in the service worker → an image chip → the thread holds the PNG and page-capture.md.
import { test, expect, pairedSidebar, snapshotOf, runCommand, stubCapture } from './fixtures.mjs';

test('area capture end to end: overlay → drag → image chip → the thread has the PNG and page-capture.md with URL and selector', async ({ context, sw, extensionId, worca, site }) => {
  const { page, sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site }, { select: null });
  await page.bringToFront();                                   // captureVisibleTab shoots the window's ACTIVE tab
  await expect(page.locator('[data-worca-pinpoint]')).toHaveCount(1);
  await stubCapture(sw, page);
  await runCommand(sw, page, 'worca-capture');
  const overlay = page.locator('[data-worca-capture] .wx-cap');
  await expect(overlay).toBeVisible();
  const box = await page.locator('#para').boundingBox();
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-worca-capture]')).toHaveCount(0);
  await expect(sidebar.locator('.ask-chip img.ask-chip-thumb')).toHaveCount(1);
  await expect(sidebar.locator('.wx-sends')).toContainText('1 screenshot with their page details');
  await sidebar.locator('textarea.ask-input').fill('What is this paragraph?');
  await sidebar.getByRole('button', { name: 'Send' }).click();
  await expect(sidebar.locator('.ask-msg-assistant .ask-answer')).toContainText('[mock]', { timeout: 30_000 });
  const snap = await snapshotOf(worca, sidebar);
  const names = snap.attachments.map((a) => a.name);
  expect(names.some((n) => /^screenshot-\d+\.png$/.test(n))).toBe(true);
  const md = snap.attachments.find((a) => a.name === 'page-capture.md');
  expect(md).toBeTruthy();
  const text = await (await fetch(`${worca.url}/api/ask/threads/${snap.thread.id}/attachments/${md.id}`)).text();
  expect(text).toContain(site.url);
  expect(text).toContain('selector: #para');
});

test('Esc cancels the overlay; nothing is attached', async ({ context, sw, extensionId, worca, site }) => {
  const { page, sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site }, { select: null });
  await page.bringToFront();
  await expect(page.locator('[data-worca-pinpoint]')).toHaveCount(1);
  await runCommand(sw, page, 'worca-capture');
  await expect(page.locator('[data-worca-capture] .wx-cap')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-worca-capture]')).toHaveCount(0);
  await expect(sidebar.locator('.ask-chip img')).toHaveCount(0);
});

test('the camera button starts the same overlay; Esc pressed in the sidebar (where focus stays) cancels it', async ({ context, sw, extensionId, worca, site }) => {
  const { page, sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site }, { select: null });
  await expect(page.locator('[data-worca-pinpoint]')).toHaveCount(1);
  await sidebar.locator('[data-wx-capture-btn]').click();
  await expect(page.locator('[data-worca-capture] .wx-cap')).toBeVisible();
  await sidebar.keyboard.press('Escape');
  await expect(page.locator('[data-worca-capture]')).toHaveCount(0);
  await sidebar.locator('[data-wx-capture-btn]').click();                    // and a second capture can start after it
  await expect(page.locator('[data-worca-capture] .wx-cap')).toBeVisible();
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-worca-capture]')).toHaveCount(0);
});
