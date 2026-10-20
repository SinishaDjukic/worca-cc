// The paired sidebar's chat scope (Ask's composer pill + popover): empty, failed and pinned states (worca's own lists
// through the token's routes).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, pairedSidebar, rawCall, snapshotOf } from './fixtures.mjs';

const pill = (sidebar) => sidebar.locator('.ask-scope-btn');
const pop = (sidebar) => sidebar.locator('.ask-pop-scope');

test('no projects: a muted line and Open Worca, which opens Worca in a tab', async ({ context, sw, extensionId, worca, site }) => {
  const { sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site });
  await expect(sidebar.locator('.wx-scope')).toHaveCount(0);
  await pill(sidebar).click();
  await expect(pop(sidebar)).toContainText('No projects in this Worca yet');
  const [tab] = await Promise.all([context.waitForEvent('page'), pop(sidebar).getByRole('menuitem', { name: 'Open Worca' }).click()]);
  await expect.poll(() => tab.url()).toContain(worca.url);
});

test('a failed project load says so, and Retry re-fetches the lists', async ({ context, sw, extensionId, worca, site }) => {
  const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'boom' }) });
  await context.route(`${worca.url}/api/projects`, fail);
  const { sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site });
  await pill(sidebar).click();
  await expect(pop(sidebar)).toContainText("Couldn't load projects");
  await expect(pop(sidebar)).not.toContainText('No projects');
  await context.unroute(`${worca.url}/api/projects`, fail);
  const lists = [];
  sidebar.on('request', (r) => { const p = new URL(r.url()).pathname; if (r.method() !== 'OPTIONS') lists.push(p); });
  await pop(sidebar).getByRole('menuitem', { name: 'Retry' }).click();
  await expect(pop(sidebar)).toContainText('No projects in this Worca yet');      // this Worca really has none
  expect(lists.sort()).toEqual(['/api/projects', '/api/workspaces']);             // only the lists
});

test('pinned: a project picked before the first message pins the chat, and the pin shows when the chat is reopened', async ({ context, sw, extensionId, freshWorca, site }) => {
  const dir = mkdtempSync(join(tmpdir(), 'wx-acme-api-'));
  try {
    const add = await rawCall(freshWorca, 'POST', '/api/projects', { body: { name: 'ACME API', path: dir } });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    const key = add.body.projects.find((p) => p.name === 'ACME API').key;
    const { sidebar } = await pairedSidebar({ context, sw, extensionId, worca: freshWorca, site });
    await expect(sidebar.locator('.ask-scope-label')).toHaveText('No project');
    await expect(pill(sidebar)).toHaveAttribute('title', 'Chat scope: No project');
    await pill(sidebar).click();
    await expect(pop(sidebar).locator('.ask-scope-item').first()).toHaveText(/No project/);
    await pop(sidebar).getByRole('menuitem', { name: 'ACME API' }).click();
    await expect(pill(sidebar)).toHaveAttribute('data-pinned', '');
    await expect(sidebar.locator('.ask-scope-label')).toHaveText('ACME API');
    await sidebar.locator('textarea.ask-input').fill('What is the refill rate?');
    await sidebar.getByRole('button', { name: 'Send' }).click();
    await expect(sidebar.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
    const snap = await snapshotOf(freshWorca, sidebar);
    expect(snap.thread.context).toMatchObject({ pinned: true, projectKey: key });
    await sidebar.reload();                                                       // a fresh sidebar: New chat, No project
    await expect(sidebar.locator('.ask-scope-label')).toHaveText('No project');
    await sidebar.getByRole('combobox', { name: 'Chat' }).selectOption(snap.thread.id);
    await expect(sidebar.locator('.ask-scope-label')).toHaveText('ACME API');
    await expect(pill(sidebar)).toHaveAttribute('data-pinned', '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
