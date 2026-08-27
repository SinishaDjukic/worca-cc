#!/usr/bin/env node
// Assembles the Worca showcase landing page from the shell + the per-feature
// section fragments, inlining fonts and the logo so the result is one
// self-contained file.
//   node marketing/build-showcase.mjs
// Reads  marketing/showcase.src.html + marketing/sections/*.html
// Writes marketing/showcase.html
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

const ASSETS = {
  __FONT_POPPINS_400__: ['ui/public/fonts/poppins-latin-400-normal.woff2', 'font/woff2'],
  __FONT_POPPINS_500__: ['ui/public/fonts/poppins-latin-500-normal.woff2', 'font/woff2'],
  __FONT_POPPINS_600__: ['ui/public/fonts/poppins-latin-600-normal.woff2', 'font/woff2'],
  __FONT_POPPINS_700__: ['ui/public/fonts/poppins-latin-700-normal.woff2', 'font/woff2'],
  __FONT_MONO_400__: ['ui/public/fonts/jetbrains-mono-latin-400-normal.woff2', 'font/woff2'],
  __LOGO__: ['ui/public/assets/worca-logo.png', 'image/png'],
  __FAVICON__: ['ui/public/assets/worca-favicon.png', 'image/png'],
};

const SECTIONS = ['hero', 'audit', 'diff', 'composer', 'agents', 'plugins', 'guardrails', 'ask'];

let html = await readFile(join(here, 'showcase.src.html'), 'utf8');

for (const id of SECTIONS) {
  const token = `__SECTION_${id}__`;
  if (!html.includes(token)) throw new Error(`token ${token} not found in showcase.src.html`);
  const frag = await readFile(join(here, 'sections', `${id}.html`), 'utf8');
  html = html.replace(token, frag.trimEnd());
}

for (const [token, [rel, mime]] of Object.entries(ASSETS)) {
  const buf = await readFile(join(repo, rel));
  const uri = `data:${mime};base64,${buf.toString('base64')}`;
  if (!html.includes(token)) throw new Error(`token ${token} not found in showcase.src.html`);
  html = html.replaceAll(token, uri);
}

const left = html.match(/__[A-Z0-9_]+__/g);
if (left) throw new Error(`unreplaced tokens: ${[...new Set(left)].join(', ')}`);

const out = join(here, 'showcase.html');
await writeFile(out, html);
console.log(`wrote ${out} — ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
