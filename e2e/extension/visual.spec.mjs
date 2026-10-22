import { test, expect, configure, openSidebar, pairedSidebar, tokenFor, runCommand, stubCapture } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenMap } from '../../tools/extension-css.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // not the cwd (review m10)
const COLOR_TOKENS = Object.entries(tokenMap(readFileSync(join(ROOT, 'ui/public/style.css'), 'utf8'))).filter(([, v]) => /light-dark\(|^#/.test(v)).map(([k]) => k);
const resolveTokens = (names) => names.map((n) => { const p = document.createElement('i'); p.style.color = `var(${n})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });

// Computed-style parity (review M5): the same element in the real Worca Chat page vs the sidebar.
const PROPS = ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'border-top-color', 'border-top-width',
  'border-top-left-radius', 'border-bottom-right-radius', 'padding-top', 'padding-left', 'padding-bottom', 'padding-right'];
const STYLE_TARGETS = ['.ask-msg-user .ask-user-bubble', '.ask-msg-assistant .ask-answer', '.ask-user-pills .ask-attachment-pill',
  '.ask-composer-box', 'textarea.ask-input', '.ask-send', '.ask-model-btn', '.ask-scope-btn'];
const styleOf = ([sels, props]) => Object.fromEntries(sels.map((s) => {
  const e = [...document.querySelectorAll(s)].at(-1);
  if (!e) return [s, null];
  const cs = getComputedStyle(e);
  return [s, Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]))];
}));
// The Chat page autofocuses its composer and `textarea` carries `transition: border-color .15s` (style.css), so without
// this the page's textarea is sampled mid-way to its focus colour while the sidebar's is not focused. Compare both at
// rest, in the same (unfocused) state: blur, flush style, then wait out the running CSS transitions.
const atRest = async () => {
  document.activeElement?.blur();
  void getComputedStyle(document.body).color;
  await Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {})));
};
const unWorca = (o) => JSON.parse(JSON.stringify(o).replace(/\\"Worca (Poppins|JetBrains Mono)\\", /g, ''));

/** A paired sidebar with one finished exchange, plus the same thread open in the real Worca Chat page. */
async function chatted(fx, scheme) {
  const { page, sidebar } = await pairedSidebar(fx, { scheme, pinpointOnSelect: true });   // these specs select to open Pinpoint
  await sidebar.locator('textarea.ask-input').fill('What is the refill rate?');
  await sidebar.getByRole('button', { name: 'Send' }).click();
  await expect(sidebar.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
  // The sidebar's own thread, never threads[0]: a late title write on the shared server reorders by updated_at (v7).
  const threadId = await sidebar.evaluate(() => globalThis.__worcaSidebarTest.threadId());
  const ui = await fx.context.newPage(); await ui.emulateMedia({ colorScheme: scheme });
  await ui.setViewportSize({ width: 1280, height: 860 });
  await ui.goto(`${fx.worca.url}/#chat/${threadId}`);
  await expect(ui.locator('.ask-msg-assistant .ask-answer').last()).not.toBeEmpty();
  return { page, sidebar, ui };
}

for (const scheme of ['light', 'dark']) {
  test(`tokens resolve to worca's colours in the sidebar and the Pinpoint shadow root (${scheme})`, async ({ context, sw, extensionId, worca, site }) => {
    const { page, sidebar, ui } = await chatted({ context, sw, extensionId, worca, site }, scheme);
    const want = await ui.evaluate(resolveTokens, COLOR_TOKENS);
    expect(await sidebar.evaluate(resolveTokens, COLOR_TOKENS)).toEqual(want);
    await page.bringToFront(); await page.locator('#para').click({ clickCount: 3 });
    await expect(page.locator('[data-worca-pinpoint] .pp-bar')).toBeVisible();
    const inShadow = await page.evaluate((names) => {
      const root = document.querySelector('[data-worca-pinpoint]').shadowRoot;   // open in the test build only (D13)
      return names.map((n) => { const p = document.createElement('i'); p.style.color = `var(${n})`; root.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    }, COLOR_TOKENS);
    expect(inShadow).toEqual(want);
  });

  test(`computed styles of Ask elements and the Pinpoint bar match the real Worca Chat page (${scheme})`, async ({ context, sw, extensionId, worca, site }) => {
    const { page, sidebar, ui } = await chatted({ context, sw, extensionId, worca, site }, scheme);
    // The Send click left the pointer on the sidebar's Send, and a primary button tints on hover: move it off first.
    await sidebar.mouse.move(0, 0);
    await ui.evaluate(atRest); await sidebar.evaluate(atRest);
    const want = await ui.evaluate(styleOf, [STYLE_TARGETS, PROPS]);
    const got = await sidebar.evaluate(styleOf, [STYLE_TARGETS, PROPS]);
    for (const s of STYLE_TARGETS) {
      expect(want[s], `worca rendered ${s}`).not.toBeNull();
      expect(got[s], `sidebar rendered ${s}`).toEqual(want[s]);
    }
    await ui.bringToFront();
    // A triple-click extends the selection's focus past the answer, and the Chat page's Pinpoint wants anchor and focus
    // in the same `.ask-answer` unit (pinpoint.mjs readSelection): drag-select across the answer's first line instead.
    const line = await ui.evaluate(() => {
      const a = [...document.querySelectorAll('.ask-msg-assistant .ask-answer')].at(-1);
      const t = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim().length > 8 ? 1 : 3) }).nextNode();
      const r = document.createRange(); r.selectNodeContents(t);
      const box = r.getClientRects()[0];
      return { y: box.top + box.height / 2, x0: box.left + 1, x1: box.right - 1 };
    });
    await ui.mouse.move(line.x0, line.y); await ui.mouse.down();
    await ui.mouse.move(line.x1, line.y, { steps: 8 }); await ui.mouse.up();
    await expect(ui.locator('.pp-bar')).toBeVisible();
    const BAR = ['.pp-bar', '.pp-bar [data-k="explain"]'];
    const wantBar = await ui.evaluate(styleOf, [BAR, [...PROPS, 'box-shadow']]);
    await page.bringToFront(); await page.locator('#para').click({ clickCount: 3 });
    await expect(page.locator('[data-worca-pinpoint] .pp-bar')).toBeVisible();
    const gotBar = await page.evaluate(([sels, props]) => {
      const root = document.querySelector('[data-worca-pinpoint]').shadowRoot;
      return Object.fromEntries(sels.map((s) => { const e = root.querySelector(s); const cs = e && getComputedStyle(e); return [s, cs ? Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])) : null]; }));
    }, [BAR, [...PROPS, 'box-shadow']]);
    expect(unWorca(gotBar)).toEqual(unWorca(wantBar));
  });

  test(`screenshots: sidebar and Pinpoint (${scheme})`, async ({ context, sw, extensionId, worca, site }) => {
    await configure(sw, worca);                                            // no token: the Connect screen, no pairing request
    const page = await context.newPage(); await page.emulateMedia({ colorScheme: scheme }); await page.goto(site.url);
    const sidebar = await openSidebar(context, sw, extensionId, page); await sidebar.emulateMedia({ colorScheme: scheme });
    await expect(sidebar.locator('.wx-unpaired')).toBeVisible();
    await expect(sidebar).toHaveScreenshot(`sidebar-unpaired-${scheme}.png`);
    await sidebar.locator('details.wx-settings > summary').click();                // the labelled address row, Save, the hint
    await expect(sidebar.getByLabel('Worca address')).toBeVisible();
    await expect(sidebar).toHaveScreenshot(`sidebar-settings-${scheme}.png`);
    await configure(sw, worca, { token: await tokenFor(worca, extensionId), pinpointOnSelect: true });   // the worker's one pairing
    await sidebar.reload();
    await expect(sidebar.locator('textarea.ask-input')).toBeVisible();
    await sidebar.locator('textarea.ask-input').fill('What is the refill rate?');
    await sidebar.getByRole('button', { name: 'Send' }).click();
    await expect(sidebar.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
    await expect(sidebar).toHaveScreenshot(`sidebar-chat-${scheme}.png`, { mask: [sidebar.locator('.chat-head select')] });
    await page.bringToFront(); await page.locator('#para').click({ clickCount: 3 });
    await page.locator('[data-worca-pinpoint] .pp-bar [data-k="explain"]').click();
    await expect(page.locator('[data-worca-pinpoint] .pp-pop')).toContainText('about the selected text.');   // complete
    await expect(page).toHaveScreenshot(`pinpoint-explain-${scheme}.png`);
  });

  test(`screenshots: Ask's composer, its model popover and the capture overlay (${scheme})`, async ({ context, sw, extensionId, worca, site }) => {
    const { page, sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site }, { scheme, select: null });
    await sidebar.locator('textarea.ask-input').fill('What is the refill rate?');
    await sidebar.getByRole('button', { name: 'Send' }).click();
    await expect(sidebar.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
    await sidebar.locator('.ask-composer-row input[type=file]').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n') });
    await page.bringToFront();
    await expect(page.locator('[data-worca-pinpoint]')).toHaveCount(1);
    await stubCapture(sw, page);
    await runCommand(sw, page, 'worca-capture');
    await expect(page.locator('[data-worca-capture] .wx-cap')).toBeVisible();
    const box = await page.locator('#para').boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 6 });
    await expect(page.locator('[data-worca-capture] .wx-cap-box')).toBeVisible();
    await expect(page).toHaveScreenshot(`capture-overlay-${scheme}.png`);   // mid-drag
    await page.mouse.up();
    await expect(sidebar.locator('.ask-chip img.ask-chip-thumb')).toHaveCount(1);
    await sidebar.bringToFront();
    const mask = [sidebar.locator('.chat-head select'), sidebar.locator('.ask-chip-thumb'), sidebar.locator('.ask-chip:not(.wx-page-chip) .ask-chip-name')];
    await expect(sidebar).toHaveScreenshot(`sidebar-composer-${scheme}.png`, { mask });
    await sidebar.locator('.ask-model-btn').click();
    await expect(sidebar.locator('.ask-pop-model')).toBeVisible();
    await expect(sidebar).toHaveScreenshot(`sidebar-model-pop-${scheme}.png`, { mask });
  });
}
