// The sidebar opened on the tab showing Worca itself. activeTab then grants the extension Worca's own origin, and
// Chrome sends the extension's requests there WITHOUT an Origin header. An E2E build cannot hold that grant (it needs a
// real toolbar click), so this spec strips Origin from the sidebar's requests to Worca the same way, and the sidebar
// must still connect through X-Worca-Extension (src/core/extension-pairing.mjs decideExtensionRequest).
import { test, expect, configure, tokenFor, rawCall } from './fixtures.mjs';

test('opened on Worca\'s own tab, with no Origin on its requests, the sidebar connects and loads its threads', async ({ context, sw, extensionId, worca }) => {
  const token = await tokenFor(worca, extensionId);
  // A chat the sidebar must list: created as the extension would, so it is an Ask thread.
  const made = await rawCall(worca, 'POST', '/api/ask/threads', { origin: `chrome-extension://${extensionId}`, headers: { authorization: `Bearer ${token}` }, body: {} });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  await configure(sw, worca, { token });
  const ui = await context.newPage();
  await ui.goto(worca.url);
  // No host permission for Worca's address, so tabs.query cannot match its URL: take the active tab instead.
  await ui.bringToFront();
  const { tabId, windowId } = await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return { tabId: t.id, windowId: t.windowId }; });
  const sidebar = await context.newPage();
  await sidebar.setViewportSize({ width: 400, height: 760 });
  const seen = [];
  await sidebar.route(`${worca.url}/api/**`, (route) => {
    const req = route.request();
    const { origin, ...headers } = req.headers();
    seen.push({ path: new URL(req.url()).pathname, method: req.method(), origin: origin ?? null, named: headers['x-worca-extension'] ?? null });
    return route.continue({ headers });
  });
  await sidebar.goto(`chrome-extension://${extensionId}/sidebar.html?tabId=${tabId}&windowId=${windowId}`);
  await expect(sidebar.locator('textarea.ask-input')).toBeVisible();
  await expect(sidebar.locator('.wx-offline')).toHaveCount(0);
  const select = sidebar.getByRole('combobox', { name: 'Chat' });
  await expect(select.locator(`option[value="${made.body.thread.id}"]`)).toHaveCount(1);
  await select.selectOption(made.body.thread.id);
  await expect.poll(() => sidebar.evaluate(() => globalThis.__worcaSidebarTest.threadId())).toBe(made.body.thread.id);
  const gets = seen.filter((r) => r.method === 'GET');
  for (const p of ['/api/extension/hello', '/api/extension/status', '/api/ask/threads', `/api/ask/threads/${made.body.thread.id}`]) {
    expect(gets.map((r) => r.path), p).toContain(p);
  }
  for (const r of seen) expect(r.named, r.path).toBe(`chrome-extension://${extensionId}`);
});
