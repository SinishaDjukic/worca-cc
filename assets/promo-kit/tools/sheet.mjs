#!/usr/bin/env node
// Contact sheet of frames/images, rendered by headless Chrome (no platform image tools): a cols-wide grid of
// thumb-px-wide thumbnails, each labelled from its file name (snap's f012_0062.40.jpg → "62.40s").
//   node promo-kit/tools/sheet.mjs --out sheet.jpg [--cols 4] [--thumb 480] <image|dir> …
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, parseArgs } from './cdp.mjs';

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Label for a frame file: "f003_0012.50.jpg" → "12.50s"; anything else → its base name. */
export function labelOf(file) {
  const b = basename(file, extname(file));
  const m = /^f\d+_0*(\d*\.?\d+)$/.exec(b);
  return m ? `${m[1].startsWith('.') ? '0' + m[1] : m[1]}s` : b;
}

/**
 * Render `images` into one JPEG (or PNG when `out` ends in .png). Every thumbnail is `thumb` px wide; rows take the
 * aspect of the first image (like a film strip). Returns `out`.
 */
export async function contactSheet({ images, out, cols = 4, thumb = 480, chrome, quality = 80 } = {}) {
  if (!images || !images.length) throw new Error('contactSheet: no images');
  if (!out) throw new Error('contactSheet: out is required');
  cols = Math.max(1, Math.min(Number(cols) || 4, images.length));
  thumb = Math.max(16, Number(thumb) || 480);
  const work = mkdtempSync(join(tmpdir(), 'promo-sheet-'));
  const b = await launch({ width: cols * thumb, height: 200, scale: 1, chrome });
  try {
    const cells = images.map((f) => `<figure><img src="${pathToFileURL(resolve(f)).href}"><figcaption>${escHtml(labelOf(f))}</figcaption></figure>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:#fff} body{display:grid;grid-template-columns:repeat(${cols},${thumb}px);width:${cols * thumb}px}
      figure{position:relative;margin:0;width:${thumb}px;height:var(--h);overflow:hidden;background:#fff}
      img{display:block;width:${thumb}px;height:var(--h);object-fit:contain}
      figcaption{position:absolute;left:6px;top:4px;font:700 14px/1 system-ui,sans-serif;color:#e00;text-shadow:0 0 2px #fff,0 0 2px #fff}
      </style></head><body>${cells}</body></html>`;
    const page = join(work, 'sheet.html');
    writeFileSync(page, html);
    await b.goto(pathToFileURL(page).href);
    const dims = await b.evaluate(`(async () => {
      const imgs = [...document.images];
      await Promise.all(imgs.map((i) => i.decode().catch(() => null)));
      const f = imgs.find((i) => i.naturalWidth > 0);
      const h = f ? Math.round(${thumb} * f.naturalHeight / f.naturalWidth) : Math.round(${thumb} * 9 / 16);
      document.documentElement.style.setProperty('--h', h + 'px');
      return { h, rows: Math.ceil(imgs.length / ${cols}), broken: imgs.filter((i) => !i.naturalWidth).length };
    })()`);
    const H = dims.h * dims.rows;
    await b.setViewport(cols * thumb, H, 1);
    await b.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const png = /\.png$/i.test(out);
    const buf = await b.capture({ format: png ? 'png' : 'jpeg', quality, clip: { x: 0, y: 0, width: cols * thumb, height: H } });
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, buf);
    if (dims.broken) console.warn(`contactSheet: ${dims.broken} image(s) failed to load`);
    return out;
  } finally {
    await b.close();
    rmSync(work, { recursive: true, force: true });
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const A = parseArgs(process.argv.slice(2));
  const images = A._.flatMap((p) => (statSync(p).isDirectory()
    ? readdirSync(p).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort().map((f) => join(p, f)) : [p]));
  if (!A.out || !images.length) { console.error('usage: sheet.mjs --out sheet.jpg [--cols 4] [--thumb 480] <image|dir> …'); process.exit(1); }
  contactSheet({ images, out: A.out, cols: A.cols, thumb: A.thumb })
    .then((o) => console.log(`sheet (${images.length}) → ${o}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
