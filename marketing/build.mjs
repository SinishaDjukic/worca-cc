#!/usr/bin/env node
// Inlines fonts + logo into a single self-contained landing page.
//   node marketing/build.mjs
// Reads  marketing/page.src.html  ->  writes  marketing/index.html
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

let html = await readFile(join(here, 'page.src.html'), 'utf8');

for (const [token, [rel, mime]] of Object.entries(ASSETS)) {
  const buf = await readFile(join(repo, rel));
  const uri = `data:${mime};base64,${buf.toString('base64')}`;
  if (!html.includes(token)) throw new Error(`token ${token} not found in page.src.html`);
  html = html.replaceAll(token, uri);
}

const out = join(here, 'index.html');
await writeFile(out, html);
console.log(`wrote ${out} — ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
