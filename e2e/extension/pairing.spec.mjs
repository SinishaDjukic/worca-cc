import { test, expect, configure, openSidebar, rawCall } from './fixtures.mjs';

// The two pairing-UI tests use `freshWorca` (their own server): re-pairing rotates a token (D7), so they must never
// touch the shared worker server that the other specs paired once (review M3).
test('pairing: the Worca UI prompt shows the same code; approve connects the sidebar', async ({ context, sw, extensionId, freshWorca, site }) => {
  await configure(sw, freshWorca);
  const page = await context.newPage(); await page.goto(site.url);
  const sidebar = await openSidebar(context, sw, extensionId, page);
  await sidebar.getByRole('button', { name: 'Connect' }).click();
  await expect(sidebar.locator('.wx-code')).toHaveText(/^\d{3} \d{3}$/);
  const code = (await sidebar.locator('.wx-code').textContent()).trim();
  const ui = await context.newPage();
  await ui.goto(freshWorca.url);
  await expect(ui.getByText(`Code: ${code}`)).toBeVisible();
  await ui.getByRole('button', { name: 'Approve' }).click();
  await expect(sidebar.locator('textarea.ask-input')).toBeVisible();
  await ui.goto(`${freshWorca.url}/#settings`);                              // General is plain #settings
  await expect(ui.locator('#extensionPairingsHost .xp-row')).toHaveCount(1);
});

test('deny: the sidebar says so and can ask again', async ({ context, sw, extensionId, freshWorca, site }) => {
  await configure(sw, freshWorca);
  const page = await context.newPage(); await page.goto(site.url);
  const sidebar = await openSidebar(context, sw, extensionId, page);
  await sidebar.getByRole('button', { name: 'Connect' }).click();
  await expect(sidebar.locator('.wx-code')).toBeVisible();
  const { pending } = await (await fetch(`${freshWorca.url}/api/extension/pairings`)).json();
  await fetch(`${freshWorca.url}/api/extension/pair/${pending[0].requestId}/deny`, { method: 'POST' });
  await expect(sidebar.getByText('Pairing was declined')).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Ask again' })).toBeVisible();
});

test('refusals from the extension origin, and from a plain web origin', async ({ context, sw, worca, site }) => {
  await configure(sw, worca);
  // From the service worker: a real chrome-extension:// Origin, so the gate itself answers (no host permission for
  // 127.0.0.1, so CORS applies). Simple requests — no Authorization, POST without a body — get the gate's answer WITH
  // the exact ACAO, so the status is readable (review M4). A preflighted request to a non-allowlisted route is refused
  // at the preflight, so the browser rejects the fetch: that is asserted as 'rejected'.
  const r = await sw.evaluate(async (url) => {
    const s = async (path, { token = null, method = 'GET' } = {}) => {
      try { return (await fetch(url + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })).status; }
      catch { return 'rejected'; }
    };
    return {
      none: await s('/api/ask/threads'),                                       // simple GET, allowlisted, no token
      bogus: await s('/api/ask/threads', { token: 'wex_bogus' }),              // preflight 204 → GET → 401
      settings: await s('/api/settings'),                                      // simple GET, not allowlisted
      health: await s('/api/health'),                                          // simple GET, not allowlisted (m7)
      cards: await s('/api/ask/threads/askt_x/cards/card_x', { method: 'POST' }),   // simple POST, not allowlisted (M2)
      settingsWithToken: await s('/api/settings', { token: 'wex_bogus' }),     // preflighted → refused at the preflight
    };
  }, worca.url);
  expect(r).toEqual({ none: 401, bogus: 401, settings: 403, health: 403, cards: 403, settingsWithToken: 'rejected' });

  // The same refusals as the server sees them (codes), with the extension Origin.
  const origin = `chrome-extension://${new URL(sw.url()).host}`;
  expect((await rawCall(worca, 'GET', '/api/settings', { origin })).body.code).toBe('extension-route');
  expect((await rawCall(worca, 'POST', '/api/ask/threads/askt_x/cards/card_x', { origin })).body.code).toBe('extension-route');

  // A plain web origin, on a page WITHOUT a CSP (/open.html): only the missing ACAO can stop it.
  const page = await context.newPage(); await page.goto(site.openUrl);
  const fromPage = await page.evaluate(async (url) => { try { await fetch(`${url}/api/projects`); return 'read'; } catch { return 'blocked'; } }, worca.url);
  expect(fromPage).toBe('blocked');
  const direct = await rawCall(worca, 'GET', '/api/projects', { origin: site.origin });
  expect(direct.status).toBe(403);                                          // S1, unchanged
  expect(direct.headers['access-control-allow-origin']).toBeUndefined();   // …and no ACAO: why the page fetch failed
});
