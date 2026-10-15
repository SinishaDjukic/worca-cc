#!/usr/bin/env node
// tools/try-extension.mjs — try the Chrome extension by hand (docs/browser-extension.md "Trying a build"):
//   WORCA_EXT_PORT=4327 npm run ext:try
// Builds extension/dist/chrome (honouring WORCA_EXT_PORT / WORCA_EXT_BASE_URL, tools/build-extension.mjs) and opens
// Playwright's Chromium, headed, in a throwaway profile with only that build loaded. It opens on a neutral page, not
// on Worca: the sidebar must also work on Worca's own tab, but that is a case to try on purpose. Runs until the
// browser closes; the profile is deleted then.
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOne, defaultBaseUrlFromEnv } from './build-extension.mjs';

const START_URL = 'https://example.com/';

async function main() {
  try { defaultBaseUrlFromEnv(); } catch (err) { console.error(`ext:try: ${err.message}`); process.exit(1); }
  const { out, baseUrl } = await buildOne('chrome');
  console.log(`built chrome → ${out} (default Worca address ${baseUrl || 'http://127.0.0.1:4317'})`);
  const profile = mkdtempSync(join(tmpdir(), 'worca-ext-try-'));
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: null, args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`] });
  const closed = new Promise((r) => ctx.once('close', r));
  const [first] = ctx.pages();
  await (first || await ctx.newPage()).goto(START_URL).catch(() => {});   // offline: the blank tab stays
  console.log('Chromium is open with the extension loaded. Pin it from the puzzle icon, then click it to open the sidebar.');
  console.log('Close the browser to finish.');
  await closed;
  rmSync(profile, { recursive: true, force: true });
}

await main();
