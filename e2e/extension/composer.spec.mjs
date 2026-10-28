// The sidebar's composer is Ask Worca's: attach (+), model and effort, chat scope, cost and the context ring — against a
// real mock-mode worca. The mock catalog offers several models (Claude and Codex sections), so the switch is real.
import { test, expect, pairedSidebar, snapshotOf } from './fixtures.mjs';

test('attach a file, change model and scope, send; cost and context show', async ({ context, sw, extensionId, worca, site }) => {
  const { sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site });
  await sidebar.locator('.ask-composer-row input[type=file]').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n') });
  await expect(sidebar.locator('.ask-chip:not(.wx-page-chip) .ask-chip-name')).toHaveText(['notes.md']);
  await sidebar.locator('.ask-model-btn').click();
  const items = sidebar.locator('.ask-pop-model .ask-model-item');
  await expect(items.first()).toBeVisible();
  const second = items.nth(1);
  const label = (await second.locator('.ask-model-name').textContent()).trim();
  await second.click();
  await expect(sidebar.locator('.ask-pop-model')).toHaveCount(0);
  await expect(sidebar.locator('.ask-model-btn-label')).toHaveText(label);
  // Never a two-letter stub: the whole label, or the icon alone with the label in the tooltip.
  const scopeBtn = sidebar.locator('[data-ask-scope-btn]');
  await expect(scopeBtn).toHaveAttribute('title', /^Chat scope: /);
  const scopeLabel = scopeBtn.locator('.ask-scope-label');
  const fits = await scopeLabel.evaluate((l) => getComputedStyle(l).display === 'none' || l.scrollWidth <= l.clientWidth + 1);
  expect(fits).toBe(true);
  await sidebar.locator('.ask-scope-btn').click();
  await expect(sidebar.locator('.ask-pop-scope .ask-scope-item').first()).toHaveText(/No project/);
  await expect(sidebar.locator('.ask-pop-scope')).toContainText('No projects in this Worca yet');   // the shared server has none
  await sidebar.keyboard.press('Escape');
  await expect(sidebar.locator('.ask-pop-scope')).toHaveCount(0);
  await sidebar.locator('textarea.ask-input').fill('What is in my notes?');
  await sidebar.getByRole('button', { name: 'Send' }).click();
  await expect(sidebar.locator('.ask-msg-assistant .ask-answer')).toContainText('[mock]', { timeout: 30_000 });
  await expect(sidebar.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
  await expect(sidebar.locator('.ask-meter-cost')).toHaveText(/\$\d+\.\d\d/);
  await expect(sidebar.locator('.ask-ctx-ring')).toBeVisible();
  await sidebar.locator('.ask-ctx-ring').click();
  await expect(sidebar.locator('.ask-pop-ctx')).toBeVisible();
  await expect(sidebar.locator('.ask-pop-ctx .ask-pop-caption')).toHaveText('Context window');
  const snap = await snapshotOf(worca, sidebar);
  expect(snap.attachments.map((a) => a.name)).toContain('notes.md');
  // The turn's model/effort are stored on the thread (askUpdateThread), not on the user message.
  const pick = await sidebar.evaluate(() => globalThis.__worcaSidebarTest.pick());
  expect(String(snap.thread.model).toLowerCase()).toBe(pick.model.toLowerCase());
  expect(snap.thread.effort).toBe(pick.effort);
});

test('effort: the Effort row opens its pane; a pick relabels the button and rides the next message', async ({ context, sw, extensionId, worca, site }) => {
  const { sidebar } = await pairedSidebar({ context, sw, extensionId, worca, site });
  await sidebar.locator('.ask-model-btn').click();
  await sidebar.locator('.ask-pop-model [data-ask-effort-row]').click();
  const efforts = sidebar.locator('.ask-pop-model .ask-effort-item');
  await expect(efforts.first()).toBeVisible();
  const current = (await sidebar.locator('.ask-model-btn-effort').textContent()).trim();
  const names = (await efforts.locator('.ask-model-name').allTextContents()).map((t) => t.trim());
  const other = names.find((n) => n !== current);
  await efforts.filter({ hasText: other }).first().click();
  await expect(sidebar.locator('.ask-model-btn-effort')).toHaveText(other);
  await sidebar.locator('textarea.ask-input').fill('Effort check');
  await sidebar.getByRole('button', { name: 'Send' }).click();
  await expect(sidebar.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
  const snap = await snapshotOf(worca, sidebar);
  expect(snap.thread.effort).toBe(other);
});
