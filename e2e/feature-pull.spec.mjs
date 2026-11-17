// e2e/feature-pull.spec.mjs — "Pull from Requirements" on New Run, end to end in mock mode:
// pick a feature, write a note that contradicts the spec (mock mode flags a note holding `[conflict]`), see the warning,
// Start anyway, land on the run; the feature page then shows the note and "Overrode the spec".
// Run it on its own: `npx playwright test e2e/feature-pull.spec.mjs` (the Playwright config is the default one; it needs a Chromium).
import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorca } from './extension/fixtures.mjs';

const TITLE = 'Cancel order';
const NOTE = 'Ship it today [conflict]';

const json = (url, method, body) => fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const must = async (res, what) => { if (!res.ok) throw new Error(`${what} → ${res.status} ${await res.text()}`); return res.json(); };
const poll = async (read, ok, what, ms = 30_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** A mock-mode worca with the Requirements flag on, one project (a git repo) and one feature whose interview is answered. */
const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  worca: [async ({}, use) => {
    const worca = await startWorca();
    const repo = mkdtempSync(join(tmpdir(), 'wx-e2e-pull-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
      await must(await json(`${worca.url}/api/flags`, 'PATCH', { requirements: true }), 'enable the requirements flag');
      const added = await must(await json(`${worca.url}/api/projects`, 'POST', { name: 'shop', path: repo }), 'add the project');
      const project = added.projects.find((p) => p.name === 'shop');
      const created = await must(await json(`${worca.url}/api/requirements`, 'POST',
        { scopeType: 'project', scopeKey: project.key, title: TITLE, description: 'Before it ships' }), 'create the feature');
      const seq = created.feature.seq;
      const view = async () => (await must(await fetch(`${worca.url}/api/requirements/${seq}`), 'read the feature')).feature;
      const asked = await poll(view, (f) => f.status === 'your_turn', 'the first round');
      await must(await json(`${worca.url}/api/requirements/${seq}/answers`, 'POST', { roundTurnId: asked.pending.turnId, useRecommended: true }), 'answer');
      await poll(view, (f) => f.status === 'done', 'the interview to finish');
      await use({ ...worca, seq, view });
    } finally {
      await worca.stop();
      rmSync(repo, { recursive: true, force: true });
    }
  }, { scope: 'test' }],
});

/** New Run with the project chosen, and the picker open on the feature list. */
async function openPicker(page, worca) {
  await page.goto(`${worca.url}/#new`);
  await page.locator('#projectSelect').selectOption({ index: 1 });   // the only project: index 0 is the placeholder
  const pull = page.locator('#pull-from-requirements');
  await expect(pull).toBeVisible();
  return pull;
}

async function pickToNote(page, pull, worca) {
  await pull.click();
  await page.locator('[data-ui="feature-pick-row"]', { hasText: TITLE }).click();
  if (!(await worca.view()).readiness.ok) {   // a mock interview can end short of Ready: the flow asks why before the run setup
    await page.locator('[data-ui="feature-flow-reason"]').fill('Demo on Friday');
    await page.locator('[data-ui="feature-flow-confirm"]').click();
  }
  const note = page.locator('[data-ui="runsetup-note"]');
  await expect(note).toBeVisible();
  return note;
}

test('pull a feature, override the spec with a note, start anyway: the run opens and the feature page records it', async ({ page, worca }) => {
  const pull = await openPicker(page, worca);
  const note = await pickToNote(page, pull, worca);
  await note.fill(NOTE);
  await page.locator('[data-ui="runsetup-go"]').click();
  await expect(page.getByText('Your note may conflict with the spec')).toBeVisible();
  await expect(page.locator('[data-ui="runsetup-anyway"]')).toBeVisible();
  await page.locator('[data-ui="runsetup-anyway"]').click();
  await expect(page).toHaveURL(/#running\/[^/]+/);

  const starts = (await worca.view()).starts;
  expect(starts).toHaveLength(1);
  expect(starts[0].note).toBe(NOTE);
  expect(starts[0].noteOverrides).toBe(true);

  await page.goto(`${worca.url}/#requirements/feature/${worca.seq}`);
  const runs = page.getByRole('region', { name: 'Runs from this feature' });
  await expect(runs.getByText(NOTE)).toBeVisible();
  await expect(runs.getByText('Overrode the spec')).toBeVisible();
});

test('a real double-click on the pull button opens one picker, and starting from it makes one run', async ({ page, worca }) => {
  const pull = await openPicker(page, worca);
  await pull.dblclick();
  const rows = page.locator('[data-ui="feature-pick-row"]', { hasText: TITLE });
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.req-dlg-wrap')).toHaveCount(1);   // the picker was not closed by the second click, nor opened twice

  await rows.click();
  if (!(await worca.view()).readiness.ok) {
    await page.locator('[data-ui="feature-flow-reason"]').fill('Demo on Friday');
    await page.locator('[data-ui="feature-flow-confirm"]').click();
  }
  const note = page.locator('[data-ui="runsetup-note"]');
  await expect(note).toBeVisible();
  await page.locator('[data-ui="runsetup-go"]').dblclick();   // a double Start posts once
  await expect(page).toHaveURL(/#running\/[^/]+/);
  await expect.poll(async () => (await worca.view()).starts.length).toBe(1);
  await new Promise((r) => setTimeout(r, 500));
  expect((await worca.view()).starts).toHaveLength(1);
});
