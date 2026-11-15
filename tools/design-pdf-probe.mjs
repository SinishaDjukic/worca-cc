#!/usr/bin/env node
// tools/design-pdf-probe.mjs
// Design P6 Task 1 (L6.1, M14): does worca's deck kit, run under the render CSP's nonce from a `file://` URL, still
// inject its `@page` rule, so the printed page count equals the slide count? It prints a three-section
// `<deck-stage width="1920" height="1080">` doc through `staticDoc` (a random nonce, `assets/deck-kit/deck-stage.js`
// as the kit) with `pdfArgs`, counts the PDF's pages and prints `{ pages, slides }`. Run it by hand, never inside
// `npm test`: it starts a real Chrome.
//
//   node tools/design-pdf-probe.mjs            # 0 pages match, 2 no Chrome, 3 pages differ
//
// `WORCA_CHROME` picks the browser (`none` means no Chrome); `CHROME_NO_SANDBOX=1` runs it without its sandbox.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeNoSandbox, pdfArgs } from '../assets/deck-preview/chrome.mjs';
import { designChrome, RENDER_TIMEOUTS, runChrome, staticDoc } from '../src/core/design/render.mjs';

const KIT = fileURLToPath(new URL('../assets/deck-kit/deck-stage.js', import.meta.url));
const SLIDES = 3;
/** One page object per page; `/Type /Pages` is the page tree (scripts/deck-pdf.py's rule). */
const PAGE = /\/Type\s*\/Page[^s]/g;

const sections = Array.from({ length: SLIDES }, (_, i) => `<section><h1>Slide ${i + 1}</h1></section>`).join('');
const html = `<!doctype html><html><head><title>worca PDF probe</title>`
  + '<style>body{margin:0;font-family:sans-serif}section{background:#f4f1ea;color:#1d1b16}h1{font-size:96px;margin:120px}</style>'
  + `</head><body><deck-stage width="1920" height="1080">${sections}</deck-stage></body></html>`;

const chrome = designChrome();
if (!chrome) {
  console.log(JSON.stringify({ pages: null, slides: SLIDES, reason: 'no Chrome: install one, or set WORCA_CHROME' }));
  process.exit(2);
}
console.error(`chrome: ${chrome}`);

const dir = mkdtempSync(join(tmpdir(), 'worca-pdf-probe-'));
try {
  const htmlPath = join(dir, 'deck.html');
  const pdfPath = join(dir, 'deck.pdf');
  const nonce = randomBytes(16).toString('base64url');
  writeFileSync(htmlPath, staticDoc(html, { nonce, kitScript: readFileSync(KIT, 'utf8') }));
  const r = await runChrome(chrome, pdfArgs({ htmlPath, pdfPath, noSandbox: chromeNoSandbox() }), {
    outFile: pdfPath, timeoutMs: RENDER_TIMEOUTS.pdfMs,
  });
  if (!r.ok) {
    console.log(JSON.stringify({ pages: 0, slides: SLIDES, reason: r.reason }));
    process.exitCode = 3;
  } else {
    const pages = readFileSync(pdfPath).toString('latin1').match(PAGE)?.length ?? 0;
    console.log(JSON.stringify({ pages, slides: SLIDES }));
    process.exitCode = pages === SLIDES ? 0 : 3;
  }
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
