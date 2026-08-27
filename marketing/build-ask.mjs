#!/usr/bin/env node
// Inlines fonts + logos into the Ask Worca release page.
//   node marketing/build-ask.mjs
// Reads  marketing/ask.src.html  (content only, no <html> wrapper)
// Writes marketing/ask-artifact.html  (content only — for Artifact publishing)
//        marketing/ask.html           (standalone document — open in a browser)
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

let body = await readFile(join(here, 'ask.src.html'), 'utf8');
for (const [token, [rel, mime]] of Object.entries(ASSETS)) {
  const buf = await readFile(join(repo, rel));
  if (!body.includes(token)) throw new Error(`token ${token} not found in ask.src.html`);
  body = body.replaceAll(token, `data:${mime};base64,${buf.toString('base64')}`);
}

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${body}
</html>
`;

await writeFile(join(here, 'ask-artifact.html'), body);
await writeFile(join(here, 'ask.html'), standalone);
console.log(`ask-artifact.html — ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`);
console.log(`ask.html          — ${(Buffer.byteLength(standalone) / 1024).toFixed(0)} KB`);
