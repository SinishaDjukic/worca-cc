#!/usr/bin/env node
// find-playwright.mjs — print the absolute path of a usable playwright-core entry (index.mjs), or exit 1.
// Looks in the project's node_modules (walking up), then npm's npx cache (any OS). Nothing is installed here: when
// none is found, run `npx -y playwright@latest --version` once (it populates the npx cache) and try again. Browsers
// are not needed when a system Chrome exists — harness.mjs drives it, else Playwright's own chromium.
// Imported by video.mjs (`check`) as `findPlaywright()`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

/** npm's cache folders that may hold `_npx` (npm_config_cache wins; then the per-OS default). */
function npmCaches() {
  const out = [];
  if (process.env.npm_config_cache) out.push(process.env.npm_config_cache);
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) out.push(join(process.env.LOCALAPPDATA, 'npm-cache'));
    if (process.env.APPDATA) out.push(join(process.env.APPDATA, 'npm-cache'));
  }
  out.push(join(homedir(), '.npm'));
  return out;
}

export function findPlaywright(from = process.cwd()) {
  const found = [];
  for (let d = from; ; d = dirname(d)) {
    const p = join(d, 'node_modules', 'playwright-core', 'index.mjs');
    if (existsSync(p)) found.push(p);
    if (dirname(d) === d) break;
  }
  for (const cache of npmCaches()) {
    const npx = join(cache, '_npx');
    if (!existsSync(npx)) continue;
    for (const h of readdirSync(npx)) {
      const p = join(npx, h, 'node_modules', 'playwright-core', 'index.mjs');
      if (existsSync(p)) found.push(p);
    }
  }
  const version = (p) => { try { return JSON.parse(readFileSync(join(dirname(p), 'package.json'), 'utf8')).version || '0'; } catch { return '0'; } };
  const stable = found.filter((p) => !/-(alpha|beta|next)/.test(version(p)));
  return (stable.length ? stable : found).sort((a, b) => version(b).localeCompare(version(a), undefined, { numeric: true }))[0] || null;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const pick = findPlaywright();
  if (!pick) { console.error('no playwright-core found — run: npx -y playwright@latest --version'); process.exit(1); }
  console.log(pick);
}
