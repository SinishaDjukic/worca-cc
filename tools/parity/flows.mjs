// tools/parity/flows.mjs — #919 slice 2: the main pages and flows, driven with playwright-core and the system Chrome.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { doneStatusWord } from '../../ui/public/ship-words.mjs';
import { finishRun, SEED_PROMPT } from './seed.mjs';

// Same candidates as tools/verify-theme-cdp.mjs (lines 91-93).
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
// The done words for a finished run, minus 'Needs you' (a finished run needs no one).
export const DONE_WORDS = ['ready', 'in-review', 'merged'].map(doneStatusWord);

export function chromePath(env = process.env, exists = existsSync) {
  if (env.CHROME_BIN) return env.CHROME_BIN;
  const hit = CHROME.find((p) => exists(p));
  if (!hit) throw new Error('no Chrome found: set CHROME_BIN');
  return hit;
}

export async function openBrowser() {
  const noSandbox = process.env.CHROME_NO_SANDBOX === '1' || process.getuid?.() === 0;
  return chromium.launch({ executablePath: chromePath(), headless: true,
    args: noSandbox ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
}

export async function newPage(browser, t) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.parityErrors = [];        // 'METHOD path -> status' only (R-sec-4)
  page.parityPageErrors = 0;     // a count: page error text can carry page data
  page.on('pageerror', () => { page.parityPageErrors += 1; });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) page.parityErrors.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
  });
  await page.goto(`http://localhost:${t.port}/`);
  return page;
}

/** Go to a hash the way tools/verify-theme-cdp.mjs go() does: set it, reload, wait for boot, the view and fonts. */
export async function go(page, hash, view, sub) {
  await page.evaluate((h) => { localStorage.removeItem('worca-cc.runs.last'); location.hash = h; }, hash);
  await page.reload();
  await page.waitForFunction(() => !!(window.__np && window.__np.getRun));
  if (view) await page.waitForSelector(`section.view[data-view="${view}"]:not(.hidden)`);
  if (sub) await page.waitForSelector(sub);
  await page.evaluate(() => document.fonts.ready);
  // the page's own lookups (History's PR lookup) settle after load: a shot mid-lookup shows a spinner on one side only
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  // entrance animations (a chat reply's rise) still moving on a first visit would land in the shot: let them end
  await page.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 3000)), Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))]));
}

export const PAGES = [
  { name: 'chat-home', view: 'chat', sub: '[data-chat-page][data-view="home"]', hash: () => '#chat/new' },
  { name: 'chat-thread', view: 'chat', sub: '[data-chat-page][data-view="thread"]', hash: (s) => `#chat/${s.threadId}` },
  { name: 'new-run', view: 'new', hash: () => '#new' },
  { name: 'runs', view: 'runs', hash: () => '#runs' },
  { name: 'live-run', view: 'runs', hash: (s) => `#running/${s.heldRunId}` },
  { name: 'history', view: 'runs', sub: '.run-status-word', hash: (s) => `#history/${s.projectKey}/${s.pipelineId}` },
  { name: 'settings', view: 'settings', hash: () => '#settings' },
  { name: 'labs', view: 'settings', sub: '[data-flag-switch="flagsDemo"]', hash: () => '#settings/experimental' },
  { name: 'stats', view: 'stats', hash: () => '#stats' },
];

const post = (t, path, body, method = 'POST') => fetch(`${t.base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** A failure reason the harness wrote itself (fixed text, or 'METHOD path -> status' entries): kept verbatim. */
export class FlowError extends Error {}

/**
 * What a failed flow stores (R-sec-4): our own FlowError text; for anything else only the error name and the
 * Playwright API name (`locator.waitFor`, `page.waitForFunction`), never the message, which can quote page text.
 */
export function flowError(e, page = {}) {
  const api = /^([a-z]+\.[A-Za-z]+):/.exec(String(e?.message ?? ''))?.[1];
  const own = e instanceof FlowError || /^seed: /.test(String(e?.message));   // seed.mjs errors hold method/path/status only
  const reason = own ? String(e.message).split('\n')[0] : `${e?.name || 'Error'}${api ? ` in ${api}` : ''}`;
  return { error: reason, apiErrors: [...(page.parityErrors || [])], pageErrors: page.parityPageErrors || 0 };
}

export const FLOWS = [
  { name: 'open-pages', async run({ page, seed }) {
    for (const p of PAGES) {
      await go(page, p.hash(seed), p.view, p.sub);
      if (p.name === 'live-run' && !/^#running\//.test(await page.evaluate(() => location.hash))) throw new FlowError('live run handed off before capture');
    }
    if (page.parityErrors.length || page.parityPageErrors) throw new FlowError(`${page.parityErrors.length} API 5xx, ${page.parityPageErrors} page errors`);
  } },
  { name: 'chat-send', async run({ page }) {
    await go(page, '#chat/new', 'chat', '[data-chat-page][data-view="home"]');
    await page.locator('[data-chat-page] textarea.ask-input').fill('parity: say hi');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^#chat\/./.test(location.hash) && location.hash !== '#chat/new');
    await page.locator('.ask-msg-assistant').first().waitFor({ timeout: 30_000 });
  } },
  { name: 'run-finish', async run({ page, t, state }) {
    await go(page, '#new', 'new');
    await page.locator('#projectSelect').selectOption({ label: 'sandbox' });   // the form does not preselect the only project
    await page.locator('#prompt').fill(SEED_PROMPT);
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => /^#running\//.test(location.hash), null, { timeout: 30_000 });
    const runId = decodeURIComponent(await page.evaluate(() => location.hash.split('/')[1]));
    const st = await finishRun(t, runId);   // answers the clarify stop through the API (D21)
    if (state) state.finished = { runId, pipelineId: st.pipelineId };   // history-open opens this run
    await page.waitForFunction(() => /^#history\//.test(location.hash), null, { timeout: 60_000 });  // the live page's own hand-off
    const word = (await page.locator('.run-status-word:visible').first().textContent()).trim();
    if (!DONE_WORDS.includes(word)) throw new FlowError('History status word is not a done word');
  } },
  { name: 'history-open', async run({ page, state }) {
    const pid = state?.finished?.pipelineId;
    if (!pid) throw new FlowError('no finished run to open (run-finish failed)');
    if (!/^[\w-]+$/.test(pid)) throw new FlowError('unexpected pipeline id');   // it goes into a selector below
    const row = `a.runs-row[data-pipeline-id="${pid}"]:visible`;                 // the Chats column renders a.runs-row too
    const done = async () => {
      const word = (await page.locator('.run-status-word:visible').first().textContent()).trim();
      if (!DONE_WORDS.includes(word)) throw new FlowError('History status word is not a done word');
    };
    await go(page, '#runs', 'runs', row);                                       // from the Runs list…
    await page.locator(row).first().click();
    await page.waitForFunction((p) => location.hash.startsWith('#history/') && decodeURIComponent(location.hash.split('/').at(-1)) === p, pid, { timeout: 30_000 });
    await page.locator('.run-status-word:visible').first().waitFor();
    await done();
    await go(page, await page.evaluate(() => location.hash), 'runs', '.run-status-word');   // …and by a cold deep link
    await done();
    if (page.parityErrors.length || page.parityPageErrors) throw new FlowError(`${page.parityErrors.length} API 5xx, ${page.parityPageErrors} page errors`);
  } },
  { name: 'setting-persists', async run({ page, t }) {
    await go(page, '#settings', 'settings');
    await page.locator('#theme-seg button[data-theme-mode="dark"]').click();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await post(t, '/api/settings', { theme: 'light' });
  } },
  { name: 'labs-flag', async run({ page, t }) {
    await go(page, '#settings/experimental', 'settings', '[data-flag-switch="flagsDemo"]');
    await page.locator('[data-flag-switch="flagsDemo"]').click();
    await page.locator('#flags-demo-note').waitFor({ state: 'visible' });
    await page.reload();
    await page.locator('#flags-demo-note').waitFor({ state: 'visible' });
    await post(t, '/api/flags', { flagsDemo: false }, 'PATCH');
  } },
];
